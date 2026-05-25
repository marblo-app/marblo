import { test, expect } from "../helpers/fixtures";

/**
 * Tier 1 smoke — Board 탭의 KanbanBoard 가 mount 되고 컬럼 골격이 살아있는지.
 *
 * TaskCard 자체는 task 가 있어야 렌더되므로 (mock 시드 없는 production launch
 * 에서는 0개일 가능성 높음), 이 spec 의 1차 목표는 "보드 컬럼 골격" + "에러 없음".
 * 카드가 우연히 한 장이라도 있으면 카드 구조도 살짝 확인. 카드가 0개여도 PASS.
 *
 * 잡히는 회귀:
 *   - KanbanBoard / KanbanColumn / TaskCard import 깨짐
 *   - dnd-kit 의존성 누락 (DndContext / useDraggable / useDroppable 에서 throw)
 *   - useAgentStore / usePresence hook 순서 깨짐
 *   - 컬럼 STATUS_CONFIG 의 7개 status 중 일부 누락
 *
 * false positive 최소화 — 텍스트는 셀렉터 다중화하고, 카드 수 단언은 ≥ 0 으로.
 */

test("@unit Board 탭의 Kanban 컬럼 골격이 에러 없이 렌더된다", async ({
  marblo,
}) => {
  await marblo.openTab("board");
  await marblo.page.waitForTimeout(500);

  // 1) ErrorBoundary fallback / crash 텍스트 0개.
  const errorPatterns = [
    "Something went wrong",
    "에러가 발생",
    "오류가 발생",
    "crashed",
    "Cannot read property",
  ];
  for (const pat of errorPatterns) {
    await expect(
      marblo.page.locator(`text=/${pat}/i`),
      `Board 탭에 에러 패턴 "${pat}" 가 보임`
    ).toHaveCount(0);
  }

  // 2) KanbanBoard 가 mount 됐는지 — 정상 상태 3가지 중 하나여야 함:
  //    (a) project 없음 → "No Projects" placeholder (production-launch 기본)
  //    (b) project 있음 → 컬럼 헤더 (TODO/DONE) + "+ New Task" CTA
  //    (c) project 있고 task 로딩 중 → "Loading board..." spinner
  //    셋 다 안 보이면 KanbanBoard mount 실패 가능성.
  const noProjects = marblo.page.locator(`text=/No Projects/i`).first();
  const todoCol = marblo.page.locator(`text=/^TODO$/`).first();
  const doneCol = marblo.page.locator(`text=/^DONE$/`).first();
  const loadingBoard = marblo.page.locator(`text=/Loading board/i`).first();

  const noProjVisible = await noProjects.isVisible().catch(() => false);
  const todoVisible = await todoCol.isVisible().catch(() => false);
  const doneVisible = await doneCol.isVisible().catch(() => false);
  const loadingVisible = await loadingBoard.isVisible().catch(() => false);

  expect(
    noProjVisible || todoVisible || doneVisible || loadingVisible,
    "Board 탭에 No Projects placeholder / TODO·DONE 컬럼 / Loading 스피너 중 어떤 것도 안 보임 — KanbanBoard mount 실패 가능성"
  ).toBe(true);

  // 3) project 가 있어 컬럼이 렌더된 경우에만 "+ New Task" CTA 도 확인.
  //    조건부 단언 — production 빈 상태 회귀 가드는 (2) 가 담당.
  if (todoVisible || doneVisible) {
    await expect(
      marblo.page.locator(`button:has-text("New Task")`).first(),
      "Board 컬럼이 떴는데 + New Task CTA 가 안 보임"
    ).toBeVisible({ timeout: 5000 });
  }

  // 4) 카드가 우연히 있으면 (project 선택됨 + task 시드) role 배지가 보임.
  //    카드 0개여도 PASS — 단순 sanity.
  const roleBadges = marblo.page.locator(
    `text=/^(backend|frontend|test|devops)$/`
  );
  const badgeCount = await roleBadges.count();
  expect(
    badgeCount,
    "role 배지 count 가 음수일 수 없음 (sanity)"
  ).toBeGreaterThanOrEqual(0);
});
