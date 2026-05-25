import { test, expect } from "../helpers/fixtures";

/**
 * Tier 1 smoke 테스트. 가장 기본적인 회귀 가드:
 *   - Electron 앱이 LLM 키 없이도 부팅되는가? (accfffc 의 LLM lazy init 회귀 방지)
 *   - 메인 윈도우 + TabBar 가 렌더되는가?
 *   - 탭 전환이 가능한가?
 *
 * 이 테스트가 깨지면 다른 시나리오 테스트도 전부 의미 없음 → 첫 게이트.
 */

test("@unit Electron 앱이 LLM 키 없이도 부팅된다", async ({ marblo }) => {
  // launchMarblo 자체가 부팅 대기 → 여기 도달했으면 launch 성공.
  await expect(marblo.page).toHaveTitle(/Marblo|marblo|v3/i, {
    timeout: 15_000,
  });
});

test("@unit 상단 TabBar 가 렌더되고 주요 탭이 표시된다", async ({ marblo }) => {
  // 주요 탭 라벨이 DOM 에 존재하는지만 확인. 아이콘은 SVG 이므로 텍스트 기준.
  for (const label of ["Board", "Missions", "Agents", "Settings"]) {
    await expect(
      marblo.page.locator(`button:has-text("${label}")`).first(),
    ).toBeVisible({ timeout: 15_000 });
  }
});

test("@unit 탭 전환이 작동한다 (Missions → Board)", async ({ marblo }) => {
  await marblo.openTab("missions");
  // 탭 전환 후 활성 컨텐츠 영역 변화 — 셀렉터는 너무 strict 하지 않게.
  await marblo.page.waitForTimeout(300);
  await marblo.openTab("board");
  await marblo.page.waitForTimeout(300);
  // 단순 smoke: 에러 다이얼로그가 안 뜨면 OK.
  await expect(marblo.page.locator("text=/error|에러|crashed/i")).toHaveCount(
    0,
  );
});
