import { defineConfig } from "@playwright/test";

/**
 * Marblo v3 Playwright + Electron 회귀 테스트 설정.
 *
 * Tier 구조 (tests/playwright/ 하위):
 *   - unit/    : UI shape 회귀 (렌더·셀렉터·라우팅). 무비용, CI 매번.
 *   - mocked/  : PTY/Firestore/IPC mock 격리 시나리오. 매번.
 *   - live/    : 진짜 LLM + 진짜 Firestore. RUN_LLM_E2E=1 게이트.
 *
 * 디버그:
 *   PWDEBUG=1 npm run test:e2e:pw       — Inspector + headed
 *   npm run test:e2e:pw -- --ui          — UI 모드 (런너 패널)
 *   npm run test:e2e:pw -- --headed      — GUI 띄움
 *   PW_TRACE=on npm run test:e2e:pw      — 모든 테스트 trace 저장
 */
export default defineConfig({
  testDir: "./tests/playwright",
  // Tier 폴더 안에 spec 파일이 떨어져 있음.
  testMatch: /.*\.spec\.ts/,

  // 클린룸 하네스의 임시 루트(런당 ~280MB)를 실행 후 정리. 없으면 개발 맥의
  // 디스크가 차서 스위트가 ENOSPC 로 깨진다(실측). KEEP_CLEANROOM_ROOTS=1 로 보존.
  globalTeardown: "./tests/playwright/global-teardown.ts",

  // Electron 앱은 동시에 여러 인스턴스 띄우면 PTY/Firestore handle 충돌 위험.
  // workers=1 로 직렬 실행 — Tier 1 unit 만 별도로 병렬화하고 싶으면 추후
  // describe.parallel 로 명시.
  workers: 1,
  fullyParallel: false,

  retries: process.env.CI ? 2 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },

  // Trace + screenshot 은 실패 시에만 저장. CI 환경에서도 가벼움.
  // PW_TRACE=on 으로 모든 테스트 추적 가능.
  use: {
    trace: process.env.PW_TRACE === "on" ? "on" : "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],

  outputDir: "test-results/playwright",
});
