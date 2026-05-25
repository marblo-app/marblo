import { test, expect } from "../helpers/fixtures";

/**
 * Tier 1 smoke — Settings 탭의 SettingsPage 가 mount 되고 핵심 탭 네비게이션이
 * 보이는지.
 *
 * SettingsPage.tsx 의 TABS 배열은 7개 (profile, models, billing, team, privacy,
 * language, apikeys). 라벨은 i18n (ko/en) 으로 번역되므로 양쪽 다 매칭하는
 * 정규식으로 단언.
 *
 * 잡히는 회귀:
 *   - SettingsPage / APIKeysSettings / PrivacySettings / BillingPage import 깨짐
 *   - useTranslation hook / locale store 의존성 깨짐
 *   - useProjectStore / useSubscriptionStore subscribe 시 throw
 *   - TABS 배열에서 핵심 탭 (profile, apikeys) 누락
 *   - i18n key 누락으로 raw key ("settings.tab.profile") 가 그대로 표시
 */

test("@unit Settings 탭이 mount 되고 핵심 탭 네비게이션이 표시된다", async ({
  marblo,
}) => {
  await marblo.openTab("settings");
  await marblo.page.waitForTimeout(500);

  // 1) ErrorBoundary / crash 패턴 0개.
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
      `Settings 탭에 에러 패턴 "${pat}" 가 보임`
    ).toHaveCount(0);
  }

  // 2) i18n raw key 가 그대로 노출되지 않았는지. "settings.tab.profile" 같은
  //    문자열이 보이면 ko/en 번역 누락. 회귀 가드 핵심.
  await expect(
    marblo.page.locator(`text=/settings\\.tab\\./`),
    "raw i18n key 가 settings 탭에 노출됨 — ko/en 번역 누락 가능성"
  ).toHaveCount(0);

  // 3) 헤더 — ko "설정" 또는 en "Settings" 중 하나. 페이지 타이틀 h1.
  await expect(
    marblo.page.locator(`h1:has-text("설정"), h1:has-text("Settings")`).first(),
    "Settings 페이지 헤더 (설정/Settings) 가 안 보임"
  ).toBeVisible({ timeout: 5000 });

  // 4) Profile 탭 버튼 — ko "프로필" / en "Profile". TABS 의 첫 항목이라
  //    기본 활성 탭. 둘 중 하나는 반드시 보여야 함.
  await expect(
    marblo.page
      .locator(`button:has-text("프로필"), button:has-text("Profile")`)
      .first(),
    "Settings 의 Profile 탭 버튼이 안 보임 — TABS 배열에서 누락 가능성"
  ).toBeVisible({ timeout: 5000 });

  // 5) API Keys 탭 버튼 — ko/en 둘 다 "API Keys" 로 동일. APIKeysSettings
  //    컴포넌트 회귀 가드.
  await expect(
    marblo.page.locator(`button:has-text("API Keys")`).first(),
    "Settings 의 API Keys 탭 버튼이 안 보임 — TABS 배열에서 누락 가능성"
  ).toBeVisible({ timeout: 5000 });
});
