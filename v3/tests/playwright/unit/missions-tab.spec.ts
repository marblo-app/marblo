import { expect, type Page } from "@playwright/test";
import { test as marbloTest } from "../helpers/fixtures";

const _test = marbloTest;
void _test;

/**
 * Tier 1 smoke — 미션탭 (Phase 3 진행 중).
 *
 * 잡히는 회귀:
 *   - MissionsTab/MissionTemplateCatalog/MissionLaunchDialog import 깨짐
 *   - templates.ts 의 listTemplates() shape 변경 (카드 0개)
 *   - LaunchDialog 의 cancel 버튼 라벨/onClose 핸들러 깨짐
 *
 * Deep 시나리오 (mission inject, Timeline 진행, MissionDetail) 는 missionStore
 * 도입 후 별도 spec — Phase 3 가 zustand store 없이 useState + missionService
 * 직접 호출 구조라 store inject 패턴 불가.
 */

// projectStore 의 subscribeToProjects (firestore) 가 시간차로 currentProject 를
// 덮어쓸 수 있어, hatch 노출 대기 → inject → 잠시 후 재 inject → currentProject
// readback 확인 까지 모두 거친다. 칸반 openMockKanban 패턴과 동일.
async function injectMockProject(page: Page) {
  await page.waitForFunction(
    () => {
      const tw = (
        window as unknown as {
          __marbloTest?: { stores: { project?: unknown } };
        }
      ).__marbloTest;
      return !!tw?.stores?.project;
    },
    null,
    { timeout: 5000 }
  );

  const setOnce = async () => {
    return await page.evaluate(() => {
      const tw = (
        window as unknown as {
          __marbloTest?: {
            stores: {
              project: {
                getState: () => {
                  currentProject: { id: string } | null;
                  setCurrentProject: (p: unknown) => void;
                };
              };
            };
          };
        }
      ).__marbloTest;
      if (!tw) throw new Error("__marbloTest hatch 노출 안 됨");
      tw.stores.project.getState().setCurrentProject({
        id: "test-mock-project",
        name: "Mock Project",
        ownerId: "test-user-bypass",
        members: ["test-user-bypass"],
        folderPath: "/tmp/marblo-test",
        enabledModels: ["claude"],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      return tw.stores.project.getState().currentProject?.id ?? null;
    });
  };

  await setOnce();
  await page.waitForTimeout(600);
  const after = await setOnce();
  if (after !== "test-mock-project") {
    throw new Error(`projectStore inject 실패: currentProject=${after}`);
  }
}

marbloTest(
  "@unit Missions 탭이 mount 되고 핵심 placeholder/카탈로그가 보인다",
  async ({ marblo }) => {
    await marblo.openTab("missions");
    await marblo.page.waitForTimeout(500);

    const errorPatterns = [
      "Something went wrong",
      "에러가 발생",
      "오류가 발생",
      "crashed",
    ];
    for (const pat of errorPatterns) {
      await expect(
        marblo.page.locator(`text=/${pat}/i`),
        `에러 패턴 "${pat}" 가 보임`
      ).toHaveCount(0);
    }

    // 다음 중 1개 이상 보여야 함 (production-launch 시 currentProject=null
    // 이라 A 가 가장 흔함).
    //   A) No-Project placeholder
    //   B) 템플릿 카탈로그
    //   C) 빈 mission state
    //   D) 사이드바 헤더
    const signals = [
      "text=/프로젝트를 선택/",
      "text=/Quick Fix/",
      "text=/선택된 미션이 없습니다/",
      "text=/Active Missions/",
    ];
    let visibleCount = 0;
    for (const sel of signals) {
      visibleCount += await marblo.page.locator(sel).count();
    }
    expect(
      visibleCount,
      "MissionsTab placeholder/카탈로그/empty state 중 어느 것도 안 보임"
    ).toBeGreaterThanOrEqual(1);
  }
);

marbloTest(
  "@unit MissionTemplateCatalog 가 템플릿 5종을 렌더한다 (프로젝트 inject 후)",
  async ({ marblo }) => {
    await injectMockProject(marblo.page);
    await marblo.openTab("missions");

    // 카탈로그 첫 카드가 visible 될 때까지 명시적 대기 (firestore subscribe
    // race 흡수). 5개 라벨 전부 단언.
    const labels = [
      "Quick Fix",
      "Polish",
      "Feature",
      "Full Feature",
      "Research",
    ];
    for (const label of labels) {
      await expect(
        marblo.page.locator(`text=${label}`).first(),
        `템플릿 "${label}" 카드가 안 보임`
      ).toBeVisible({ timeout: 8000 });
    }
  }
);

marbloTest(
  "@unit MissionLaunchDialog 가 템플릿 클릭 시 열리고 취소로 닫힌다",
  async ({ marblo }) => {
    await injectMockProject(marblo.page);
    await marblo.openTab("missions");

    // Quick Fix 카드 (button 안에 h3) 가 visible 될 때까지 대기 후 클릭.
    const quickFix = marblo.page.locator("text=/Quick Fix/").first();
    await expect(quickFix).toBeVisible({ timeout: 8000 });
    await quickFix.click();

    const cancelBtn = marblo.page.locator('button:has-text("취소")').first();
    await expect(cancelBtn, "LaunchDialog 의 취소 버튼이 안 보임").toBeVisible({
      timeout: 3000,
    });

    await cancelBtn.click();
    await expect(
      marblo.page.locator('button:has-text("취소")'),
      "취소 클릭 후 LaunchDialog 가 닫히지 않음"
    ).toHaveCount(0, { timeout: 3000 });
  }
);

// 옵션 A — 5개 템플릿 각각의 LaunchDialog 흐름 smoke.
//
// 카탈로그 카드(h3 label) 클릭 → MissionLaunchDialog mount → 다이얼로그 안에
// 해당 템플릿의 미리보기(`{description} · {N} step`) 가 보이는지 → 취소로 닫힘.
//
// 잡히는 회귀:
//   - templates.ts 의 라벨/description/step 수 변경 (다이얼로그 미리보기 깨짐)
//   - 카드 onSelect → setLaunchTemplate → initialTemplateId wiring 깨짐
//   - LaunchDialog 의 description·step 미리보기 또는 취소 핸들러 깨짐
//
// 일부러 src/templates.ts 를 import 하지 않고 기대값을 리터럴로 박는다
// (블랙박스 가드 — 기존 spec 들과 동일한 컨벤션).
//
// 실제 createMission(Firestore write) 는 트리거하지 않는다 — "취소"만 누른다.
//
// 주의: "Feature" 카드를 exact 매칭하지 않으면 "Full Feature" 와 충돌하므로
// heading exact 매칭을 쓴다. (preview 는 templates.ts description 과 동기화)
const LAUNCH_TEMPLATES = [
  {
    label: "Quick Fix",
    preview: "버그 하나를 빠르게 — 원인 추적부터 수정·리뷰·배포까지",
    steps: 4,
  },
  {
    label: "Polish",
    preview: "이미 있는 화면을 더 깔끔하게 — 디자인 점검 후 배포",
    steps: 3,
  },
  {
    label: "Feature",
    preview: "기획이 끝난 기능 구현 — 설계 검토 후 만들고 QA·배포",
    steps: 6,
  },
  {
    label: "Full Feature",
    preview:
      "아이디어부터 배포까지 통째로 — 기획·설계·디자인 검토를 거쳐 끝까지",
    steps: 10,
  },
  {
    label: "Research",
    preview: "코드는 그대로, 방향만 — 요구사항을 파고들어 기획·전략 정리",
    steps: 2,
  },
] as const;

for (const tpl of LAUNCH_TEMPLATES) {
  marbloTest(
    `@unit LaunchDialog — "${tpl.label}" 템플릿 열림/미리보기/취소`,
    async ({ marblo }) => {
      await injectMockProject(marblo.page);
      await marblo.openTab("missions");

      // 카탈로그 카드는 button 안에 <h3>{label}</h3>. 라벨은 다이얼로그 내부의
      // 템플릿 선택 버튼(span)에도 나오므로, heading(role) + exact 로 카탈로그
      // 카드만 정확히 집는다 ("Feature" vs "Full Feature" 충돌도 회피).
      const card = marblo.page
        .getByRole("heading", { name: tpl.label, exact: true })
        .first();
      await expect(card, `카탈로그 카드 "${tpl.label}" 가 안 보임`).toBeVisible(
        { timeout: 8000 }
      );
      await card.click();

      // LaunchDialog mount 확인 (정적 헤더 + 오버레이).
      const dialog = marblo.page.locator("div.fixed.inset-0.z-50").first();
      await expect(dialog, "LaunchDialog 오버레이가 안 뜸").toBeVisible({
        timeout: 3000,
      });
      // "🚀 Launch Mission" 텍스트는 헤더(h3)와 submit 버튼 둘 다에 있으므로
      // heading role 로 헤더만 정확히 집는다.
      await expect(
        dialog.getByRole("heading", { name: "🚀 Launch Mission" }),
        "LaunchDialog 헤더가 안 보임"
      ).toBeVisible();

      // 선택된 템플릿의 미리보기(`{description} · {N} step`)가 다이얼로그 안에
      // 보여야 한다. description 과 step 수를 각각 단언.
      await expect(
        dialog.getByText(tpl.preview),
        `다이얼로그에 "${tpl.label}" description 미리보기가 안 보임`
      ).toBeVisible();
      await expect(
        dialog.getByText(`${tpl.steps} step`),
        `다이얼로그에 "${tpl.label}" step 수(${tpl.steps})가 안 보임`
      ).toBeVisible();

      // 취소 → 다이얼로그 닫힘 (createMission 미호출).
      const cancelBtn = dialog.locator('button:has-text("취소")').first();
      await expect(cancelBtn, "취소 버튼이 안 보임").toBeVisible({
        timeout: 3000,
      });
      await cancelBtn.click();
      await expect(
        marblo.page.locator('button:has-text("취소")'),
        "취소 클릭 후 LaunchDialog 가 닫히지 않음"
      ).toHaveCount(0, { timeout: 3000 });
    }
  );
}
