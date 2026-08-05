import { test, expect } from "../helpers/fixtures";
import type { Page } from "@playwright/test";
import {
  AUDIT_ADMIN_IDS,
  AUDIT_ADMIN_PROJECT_ID,
  auditAdminSeed,
} from "../helpers/auditAdminFixture";

/**
 * 감사 로그 **관리자 뷰** 회귀 (티켓 MQxp9261g3JXU8GSFoSQ).
 *
 * 이 spec 이 지키는 것은 픽셀이 아니라 **화면이 말하는 사실**이다:
 *   1. 문제 우선 — 실패/고아 티켓이 스크롤 없이 맨 위에 뜬다.
 *   2. 묶음     — 한 티켓의 이벤트가 카드 하나로 접히고, 미션이 그 위를 묶는다.
 *   3. 링크     — [티켓 상세]·[PR]·[워크트리]가 완료 이력과 같은 모양으로 뜨고,
 *                 정리된 워크트리는 아카이브 안내로 떨어진다.
 *   4. 필터     — actor 축 · 상태 · 미션이 걸리고, 배너는 필터에 안 가려진다.
 *   5. 워크로드 — 구성원 타일이 필터로 동작한다.
 *
 * ★스크린샷: `MARBLO_SHOT=before` 로 (재설계 전 빌드에서) 한 번, 기본값
 * (`after`)으로 재설계 후 한 번 돌리면 같은 시드의 before/after 가 남는다.
 */
const SHOT = process.env.MARBLO_SHOT ?? "after";

async function seedAuditAdmin(page: Page) {
  const seed = auditAdminSeed();

  await page.evaluate((seed) => {
    localStorage.setItem("marblo:locale", "ko");
    localStorage.removeItem("marblo.firstRun.inProgress");
    localStorage.setItem(
      "marblo:test:projectAuditHarness",
      JSON.stringify({ projectId: seed.projectId, members: seed.members }),
    );
    localStorage.setItem(
      "marblo:test:projectAuditData",
      JSON.stringify(seed.auditData),
    );
    localStorage.setItem(
      "marblo:test:worktreeLightData",
      JSON.stringify(seed.worktreeLight),
    );
  }, seed);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("감사 로그")).toBeVisible({ timeout: 8000 });

  // 고아 클레임 판정의 근거를 심는다. ★`hydrated: true` 를 같이 세워야 한다 —
  // 패널은 하이드레이트 전에는 판정을 아예 하지 않는다(거짓 경보 방지).
  // 감사 harness 는 ProjectAuditPanel 만 단독 마운트하므로 이 상태를 덮어쓸
  // 에이전트 구독이 없다.
  await page.evaluate((seed) => {
    const hatch = (
      window as unknown as {
        __marbloTest?: {
          stores: {
            agent: {
              setState: (s: Record<string, unknown>) => void;
            };
          };
        };
      }
    ).__marbloTest;
    if (!hatch) throw new Error("__marbloTest hatch 미노출");
    hatch.stores.agent.setState({
      agents: [
        {
          id: seed.liveAgentId,
          name: "codex-1",
          projectId: seed.projectId,
          role: "frontend",
          model: "codex",
          status: "working",
        },
      ],
      hydrated: true,
      loading: false,
    });
  }, seed);
}

test("@mocked 감사 관리자 뷰: 문제 우선 배너 · 미션/티켓 묶음 · 링크 클러스터", async ({
  marblo,
}) => {
  const { page } = marblo;
  await seedAuditAdmin(page);

  await page.screenshot({
    path: `test-results/project-audit-admin-${SHOT}.png`,
    fullPage: true,
  });

  // ① 문제 우선 — 배너가 건수를 세고, 실패 티켓과 고아 클레임이 거기 있다.
  const banner = page.getByTestId("audit-attention");
  await expect(banner).toBeVisible();
  await expect(banner.getByText("결제 UI 연결")).toBeVisible();
  await expect(banner.getByText("실패로 종료")).toBeVisible();
  await expect(banner.getByText("고아 클레임")).toBeVisible();

  // ② 미션 섹션이 소속 티켓을 묶고 진행도를 보여준다.
  const missionSection = page
    .getByTestId("audit-section")
    .filter({ has: page.getByText("결제 플로우 리팩터") })
    .first();
  await expect(missionSection).toBeVisible();
  await expect(missionSection.getByText("1/2 완료")).toBeVisible();
  await expect(missionSection.getByText("결제 API 리팩터")).toBeVisible();
  await expect(missionSection.getByText("결제 UI 연결")).toBeVisible();

  // 미션 없는 티켓은 보드 섹션에 모인다.
  const boardSection = page.locator('[data-mission-id="__board__"]');
  await expect(boardSection.getByText("감사로그 관리자 뷰")).toBeVisible();

  // ③ 링크 클러스터 — DONE 티켓은 PR 이 있고 워크트리는 정리돼 아카이브 안내.
  const doneCard = missionSection
    .getByTestId("audit-ticket")
    .filter({ hasText: "결제 API 리팩터" })
    .first();
  await expect(doneCard.getByRole("link", { name: /PR/ })).toHaveAttribute(
    "href",
    AUDIT_ADMIN_IDS.prUrl,
  );
  await expect(doneCard.getByText("아카이브됨")).toBeVisible();

  // PR 이 없는 티켓엔 PR 링크가 **아예 없다**(죽은 링크 금지).
  const failedCard = missionSection
    .getByTestId("audit-ticket")
    .filter({ hasText: "결제 UI 연결" })
    .first();
  await expect(failedCard.getByRole("link", { name: /PR/ })).toHaveCount(0);

  // 라이브 워크트리가 있는 티켓만 "이 워크트리 보기".
  const orphanCard = boardSection
    .getByTestId("audit-ticket")
    .filter({ hasText: "감사로그 관리자 뷰" })
    .first();
  await expect(
    orphanCard.getByRole("button", { name: /이 워크트리 보기/ }),
  ).toBeVisible();

  // ④ 접힌 카드를 펼치면 원본 이벤트가 그대로 다시 보인다(캡처 불변).
  await expect(doneCard.getByText("리뷰 제출")).toHaveCount(0);
  await doneCard.getByRole("button", { expanded: false }).first().click();
  await expect(doneCard.getByText("리뷰 제출")).toBeVisible();
  await expect(doneCard.getByText("태스크 선점")).toBeVisible();
});

test("@mocked 감사 관리자 뷰: 필터는 목록만 좁히고 문제 우선 배너는 안 가린다", async ({
  marblo,
}) => {
  const { page } = marblo;
  await seedAuditAdmin(page);

  // 미션 필터를 "보드"로 — 미션 섹션은 사라지지만 배너의 실패 티켓은 남아야 한다.
  await page.getByLabel("미션").selectOption("__board__");
  await expect(
    page
      .getByTestId("audit-section")
      .filter({ has: page.getByText("결제 플로우 리팩터") }),
  ).toHaveCount(0);
  await expect(page.getByTestId("audit-attention")).toContainText(
    "결제 UI 연결",
  );

  // 상태 필터.
  await page.getByLabel("미션").selectOption("all");
  await page.getByLabel("티켓 상태").selectOption("FAILED");
  await expect(page.getByText("결제 UI 연결").first()).toBeVisible();
  await expect(page.getByText("문서 오탈자 정리")).toHaveCount(0);

  // 행위자 축 필터 — 사람만 보면 오케/에이전트 행이 빠지고, 가려진 수를 밝힌다.
  await page.getByLabel("티켓 상태").selectOption("all");
  await page.getByLabel("행위자 축").selectOption("human");
  await expect(page.getByText(/필터로 \d+건 가림/)).toBeVisible();

  await page
    .getByRole("button", { name: /필터 초기화/ })
    .first()
    .click();
  await expect(page.getByText("문서 오탈자 정리")).toBeVisible();

  await page.screenshot({
    path: `test-results/project-audit-admin-filters-${SHOT}.png`,
    fullPage: true,
  });
});

test("@mocked 감사 관리자 뷰: 구성원 워크로드 타일이 필터로 동작한다", async ({
  marblo,
}) => {
  const { page } = marblo;
  await seedAuditAdmin(page);

  await expect(page.getByText("구성원별 행위")).toBeVisible();

  // 미귀속 타일 — uid 없는 기록이 있을 때만 뜬다.
  const unattributed = page.getByRole("button", { name: /미귀속/ }).first();
  await expect(unattributed).toBeVisible();
  await unattributed.click();
  await expect(unattributed).toHaveAttribute("aria-pressed", "true");
  // 귀속 불가 행 하나만 남으므로 그 티켓 외의 티켓은 사라진다.
  await expect(page.getByText("결제 API 리팩터")).toHaveCount(0);

  await page.getByRole("button", { name: "전체" }).first().click();
  await expect(page.getByText("결제 API 리팩터").first()).toBeVisible();
});

test("@mocked 감사 관리자 뷰: 티켓 상세 모달은 그대로 열린다", async ({
  marblo,
}) => {
  const { page } = marblo;
  await seedAuditAdmin(page);

  await page
    .getByTestId("audit-ticket")
    .filter({ hasText: "결제 API 리팩터" })
    .first()
    .getByRole("button", { name: "티켓 상세" })
    .click();

  await expect(
    page.getByRole("heading", { name: "결제 API 리팩터" }),
  ).toBeVisible();
  expect(AUDIT_ADMIN_PROJECT_ID).toBeTruthy();
});
