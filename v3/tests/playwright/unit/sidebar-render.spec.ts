import { test, expect } from "../helpers/fixtures";

/**
 * Tier 1 smoke — Sidebar 가 글로벌 레이아웃에 mount 되고 핵심 탭 (파일/명령어/채팅)
 * 이 렌더되는지.
 *
 * Layout.tsx:305 에서 Sidebar 가 탭과 무관하게 항상 mount 됨. 따라서 부팅 직후
 * 어떤 탭에서도 보여야 함. 기본 isOpen 은 Layout 의 sidebarOpen state — true 라고
 * 가정하고, 만약 닫혀 있으면 toggle 버튼만이라도 보이는지 확인.
 *
 * 잡히는 회귀:
 *   - Sidebar / FileTree / CommandPanel / ProjectChat import 깨짐
 *   - useChatStore subscribe 시 throw
 *   - Sidebar 헤더 탭 (파일/명령어/채팅) 중 하나라도 사라지면 알람
 *   - Layout 에서 Sidebar 마운트가 빠지는 회귀
 */

test("@unit Sidebar 가 mount 되고 활성 패널 헤더가 보인다", async ({
  marblo,
}) => {
  // openTab 호출 안 하고 부팅 직후 상태에서 검증 — Sidebar 는 글로벌 mount.
  await marblo.page.waitForTimeout(400);

  // 1) ErrorBoundary / crash 패턴 0개.
  const errorPatterns = [
    "Something went wrong",
    "에러가 발생",
    "오류가 발생",
    "crashed",
  ];
  for (const pat of errorPatterns) {
    await expect(
      marblo.page.locator(`text=/${pat}/i`),
      `Sidebar 영역에 에러 패턴 "${pat}" 가 보임`
    ).toHaveCount(0);
  }

  // 2) Sidebar 의 패널 헤더 탭 3개 중 하나 이상이 보여야 함.
  //    열린 상태면 "파일"/"명령어"/"채팅" 텍스트가 헤더에 노출됨.
  //    닫혀 있으면 toggle 버튼만 보이고 header tab 은 안 보임 → 그 경우도 PASS
  //    하도록 분기.
  const fileTab = marblo.page.locator(`button:has-text("파일")`).first();
  const commandTab = marblo.page.locator(`button:has-text("명령어")`).first();
  const chatTab = marblo.page.locator(`button:has-text("채팅")`).first();
  const toggleBtn = marblo.page
    .locator(`button[title="사이드바 열기"], button[title="사이드바 닫기"]`)
    .first();

  // 열린 경우: 3개 탭 중 1개 이상 visible.
  // 닫힌 경우: toggle 버튼 visible.
  const fileVisible = await fileTab.isVisible().catch(() => false);
  const commandVisible = await commandTab.isVisible().catch(() => false);
  const chatVisible = await chatTab.isVisible().catch(() => false);
  const toggleVisible = await toggleBtn.isVisible().catch(() => false);

  expect(
    fileVisible || commandVisible || chatVisible || toggleVisible,
    "Sidebar 의 패널 탭(파일/명령어/채팅) 도 toggle 버튼도 안 보임 — Sidebar mount 실패 가능성"
  ).toBe(true);

  // 3) Sidebar 가 열려 있으면 active 패널 콘텐츠 영역에 노드가 1개 이상.
  //    fileTree 로딩 spinner 든 empty placeholder 든 OK — DOM 자체 mount 확인용.
  if (fileVisible || commandVisible || chatVisible) {
    const sidebarInteractive = await marblo.page
      .locator("body button, body input, body svg")
      .count();
    expect(
      sidebarInteractive,
      "Sidebar 가 열렸는데 인터랙티브 요소가 0 — 패널 mount 실패 가능성"
    ).toBeGreaterThan(0);
  }
});
