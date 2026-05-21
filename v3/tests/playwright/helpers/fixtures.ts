import { test as base, expect } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { launchMarblo, type LaunchOptions } from "./launch";
import { TerminalPage } from "../pages/TerminalPage";

/**
 * Marblo 전용 Playwright fixture.
 *
 * 사용:
 *   import { test, expect } from "../helpers/fixtures";
 *   test("...", async ({ marblo }) => {
 *     await marblo.openTab("agents");
 *     const term = await marblo.terminal("orchestrator");
 *     ...
 *   });
 *
 * 매 테스트마다 자동 launch + 자동 close. test.use({ marbloOptions: { mock: true } })
 * 로 옵션 주입 가능.
 */

export interface MarbloHandle {
  app: ElectronApplication;
  page: Page;
  /** 상단 TabBar 의 탭으로 전환. id 는 TabBar.tsx 정의와 일치해야 함. */
  openTab(
    tabId:
      | "guide"
      | "board"
      | "missions"
      | "code"
      | "agents"
      | "flows"
      | "deploy"
      | "harness"
      | "settings",
  ): Promise<void>;
  /** 오케스트레이터 또는 에이전트 PTY 터미널에 대한 POM 반환. */
  terminal(kind: "orchestrator" | "agent"): Promise<TerminalPage>;
}

type Fixtures = {
  marbloOptions: LaunchOptions;
  marblo: MarbloHandle;
};

export const test = base.extend<Fixtures>({
  // 테스트별로 override 가능. 기본은 mock 모드 비활성 (production build 그대로).
  marbloOptions: [{}, { option: true }],

  marblo: async ({ marbloOptions }, use) => {
    const launched = await launchMarblo(marbloOptions);
    const { app, page } = launched;

    // 첫 실행 시 뜨는 모달들을 자동 dismiss. 마블로 부팅 직후 PrivacyConsent /
    // welcome / onboarding 등이 차례로 나타날 수 있어 핸들러 한 곳에 모은다.
    // 모든 spec 의 첫 번째 인터랙션 직전에 호출.
    await dismissFirstRunDialogs(page);

    const handle: MarbloHandle = {
      app,
      page,
      async openTab(tabId) {
        // 모달이 뒤늦게 떴을 수 있으니 클릭 직전 한 번 더 확인.
        await dismissFirstRunDialogs(page);
        const sel = `[data-testid="tab-${tabId}"], button:has-text("${labelOf(tabId)}")`;
        await page.locator(sel).first().click();
      },
      async terminal(kind) {
        return new TerminalPage(page, kind);
      },
    };

    await use(handle);
    await launched.close();
  },
});

/**
 * 부팅 직후 떠 있을 수 있는 모달들을 모두 dismiss.
 * 모달이 없으면 조용히 통과 (selector waitFor 짧은 timeout).
 *
 * 현재 처리:
 *   - PrivacyConsentModal: "나중에" 버튼 클릭 (텔레메트리 옵트인)
 *   - (추후 onboarding 등 추가 시 여기 확장)
 */
async function dismissFirstRunDialogs(page: Page): Promise<void> {
  // PrivacyConsent — 텔레메트리 동의. "나중에" = 옵트아웃 후 다시 안 뜸.
  const consentLater = page.locator('button:has-text("나중에")').first();
  try {
    await consentLater.waitFor({ state: "visible", timeout: 1500 });
    await consentLater.click();
    // 모달이 사라질 때까지 대기.
    await consentLater.waitFor({ state: "hidden", timeout: 5000 });
  } catch {
    /* 모달이 없으면 통과 */
  }
}

function labelOf(tabId: string): string {
  // TabBar.tsx 의 label 과 일치. 신규 탭 추가 시 여기도 갱신.
  const m: Record<string, string> = {
    guide: "Guide",
    board: "Board",
    missions: "Missions",
    code: "Code",
    agents: "Agents",
    flows: "Flows (Beta)",
    deploy: "Deploy",
    harness: "Harness",
    settings: "Settings",
  };
  return m[tabId] ?? tabId;
}

export { expect };
