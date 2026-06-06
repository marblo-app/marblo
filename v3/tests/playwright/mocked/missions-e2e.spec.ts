import { test, expect } from "../helpers/fixtures";
import type { Page } from "@playwright/test";

/**
 * Tier 2 (@mocked) — 미션탭 end-to-end 흐름.
 *
 * missionService 의 in-memory 백엔드(MARBLO_TEST_MISSIONS_INMEM=1)를 켜서 진짜
 * Firestore/LLM/CLI 없이 미션 lifecycle UI 배선을 결정적으로 검증한다:
 *   1. 템플릿 카드 클릭 → LaunchDialog → 목표 입력 → 🚀 Launch
 *      → createMission(in-mem) → MissionDetail 렌더
 *   2. 상태 구동(planning→active→completed) → StatusBadge / Pause / 다시 실행 /
 *      Active↔Archive 재배치
 *   3. contextLog 구동 → MissionTimeline 렌더
 *
 * 메인 프로세스 mission-engine(decompose/dispatchOne)은 의도적으로 관여하지
 * 않는다(별도 Firestore 인스턴스 + 주입 포트로 별도 트랙 검증). 이 spec 은
 * "렌더러가 미션 데이터 변화를 올바르게 그리는가" 만 본다.
 *
 * 전제: in-memory 백엔드는 launch 옵션 missionsInMem=true 에서만 활성.
 */
test.use({ marbloOptions: { missionsInMem: true } });

// quick-fix 템플릿은 4 step (templates.ts). 상태/단계 단언의 기준.
const CARD_LABEL = "Quick Fix";

// 템플릿 카드 클릭 → LaunchDialog → 목표 입력 → 🚀 Launch → 다이얼로그 닫힘.
// createMission(in-mem)이 호출돼 미션 1개가 생긴 상태로 반환.
async function launchViaUI(page: Page, goal: string): Promise<void> {
  const card = page
    .getByRole("heading", { name: CARD_LABEL, exact: true })
    .first();
  await expect(card, `카탈로그 카드 "${CARD_LABEL}" 가 안 보임`).toBeVisible({
    timeout: 8000,
  });
  await card.click();

  const dialog = page.locator("div.fixed.inset-0.z-50").first();
  await expect(dialog, "LaunchDialog 오버레이가 안 뜸").toBeVisible({
    timeout: 3000,
  });
  await dialog.locator('input[type="text"]').fill(goal);

  await dialog.getByRole("button", { name: "🚀 Launch Mission" }).click();

  // 성공 시 launchTemplate=null → 다이얼로그 unmount → 취소 버튼 사라짐.
  await expect(
    page.locator('button:has-text("취소")'),
    "Launch 후 다이얼로그가 안 닫힘",
  ).toHaveCount(0, { timeout: 5000 });
}

test.describe("미션탭 E2E (in-memory 백엔드)", () => {
  test("@mocked 템플릿 카드 → LaunchDialog → createMission → MissionDetail 렌더", async ({
    marblo,
  }) => {
    const missions = await marblo.openMockMissions();
    const goal = "E2E 미션 — 결정적 로그인 흐름";

    await launchViaUI(marblo.page, goal);

    // 1) in-mem 백엔드에 미션이 정확히 1개 생성됨.
    await expect
      .poll(() => missions.count(), {
        message: "createMission(in-mem) 후 미션 1개가 있어야 함",
        timeout: 5000,
      })
      .toBe(1);

    // 2) MissionDetail 헤더(h2)에 목표가 렌더됨 (subscribeToMissions →
    //    setMissions → selected = 새 미션). 목표 텍스트는 리스트 카드 span 과
    //    타임라인 note 에도 나오므로 heading role 로 디테일 헤더만 정확히 집는다.
    await expect(
      marblo.page.getByRole("heading", { name: goal }),
      "MissionDetail 헤더에 목표가 안 보임",
    ).toBeVisible({ timeout: 5000 });

    // 3) 새 미션은 status=planning → Planning 배지.
    await expect(
      marblo.page.getByText("Planning").first(),
      "Planning 상태 배지가 안 보임",
    ).toBeVisible();

    // 4) 에러 패턴 0개 (ErrorBoundary fallback 없음).
    for (const pat of ["Something went wrong", "에러가 발생", "crashed"]) {
      await expect(
        marblo.page.locator(`text=/${pat}/i`),
        `에러 패턴 "${pat}" 가 보임`,
      ).toHaveCount(0);
    }
  });

  test("@mocked 상태 구동: planning → active → completed 가 UI 에 반영된다", async ({
    marblo,
  }) => {
    const missions = await marblo.openMockMissions();
    const goal = "E2E 미션 — 상태 전이";

    await launchViaUI(marblo.page, goal);
    await expect.poll(() => missions.count()).toBe(1);

    const id = await missions.latestId();
    expect(id, "생성된 미션 id 를 못 찾음").toBeTruthy();

    // planning → active: Active 배지 + Pause 버튼(canPause = active) 노출.
    await missions.patch(id!, { status: "active", currentStepIndex: 1 });
    await expect(
      marblo.page.getByText("Active").first(),
      "Active 상태 배지가 안 보임",
    ).toBeVisible({ timeout: 5000 });
    await expect(
      marblo.page.locator('button:has-text("Pause")'),
      "active 미션에 Pause 버튼이 안 보임",
    ).toBeVisible();

    // active → completed: Completed 배지 + 다시 실행 버튼(isTerminal) + 사이드바
    // Archive 섹션 노출(완료 미션이 archive 로 재배치됨).
    await missions.patch(id!, {
      status: "completed",
      completedAt: new Date(),
    });
    await expect(
      marblo.page.getByText("Completed").first(),
      "Completed 상태 배지가 안 보임",
    ).toBeVisible({ timeout: 5000 });
    await expect(
      marblo.page.locator('button:has-text("다시 실행")'),
      "완료 미션에 '다시 실행' 버튼이 안 보임",
    ).toBeVisible();
    await expect(
      marblo.page.getByText("Archive", { exact: true }),
      "사이드바 Archive 섹션이 안 보임",
    ).toBeVisible();
  });

  test("@mocked contextLog 구동이 MissionTimeline 에 렌더된다", async ({
    marblo,
  }) => {
    const missions = await marblo.openMockMissions();
    const goal = "E2E 미션 — 타임라인";

    await launchViaUI(marblo.page, goal);
    await expect.poll(() => missions.count()).toBe(1);
    const id = await missions.latestId();
    expect(id).toBeTruthy();

    // step.started 이벤트를 contextLog 에 주입 → 타임라인 행 렌더 확인.
    // (patch 는 contextLog 를 통째로 교체하므로 원하는 이벤트만 명시.)
    await missions.patch(id!, {
      status: "active",
      contextLog: [
        {
          ts: new Date(),
          type: "step.started",
          payload: { index: 0, skill: "/investigate" },
        },
      ],
    });

    // formatType("step.started") = "Step · Started", describe = "Step 1 · /investigate".
    await expect(
      marblo.page.getByText("Step · Started").first(),
      "타임라인에 step.started 행이 안 보임",
    ).toBeVisible({ timeout: 5000 });
    await expect(
      marblo.page.getByText(/Step 1 · \/investigate/).first(),
      "타임라인 step 설명이 안 보임",
    ).toBeVisible();
  });
});
