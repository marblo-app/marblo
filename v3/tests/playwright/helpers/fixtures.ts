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
  /**
   * Tier 2 mock helper — claude 없이 dummy sh PTY 를 띄워서 OrchestratorPanel
   * 을 활성화한다. seq 명령으로 충분히 긴 출력을 발사 → xterm 스크롤 가능
   * 상태 + wantBottomRef 회귀 시나리오 검증.
   *
   * 흐름:
   *   1. main 의 ptyManager 에 sh -c "seq..." spawn (IPC pty:create)
   *   2. orchestratorStore.setSession + setStatus("running") inject
   *      (window.__marbloTest 통해)
   *   3. OrchestratorPanel 이 자동으로 OrchestratorTerminal mount
   *   4. PTY 데이터가 setupPtyForwarding 통해 webContents.send 됨
   *   5. TerminalView 의 onData handler 가 xterm.write
   *
   * @returns 생성된 ptySessionId
   */
  openMockOrchestrator(): Promise<string>;
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
      async openMockOrchestrator() {
        return openMockOrchestrator(page);
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
/**
 * Mock OrchestratorPanel 활성화. 진짜 claude 대신 sh dummy command 로 PTY 띄움
 * + zustand orchestratorStore 직접 manipulate. window.__marbloTest hatch 가
 * bypassAuth 모드에서만 노출되므로 production 영향 0.
 */
async function openMockOrchestrator(page: Page): Promise<string> {
  // PrivacyConsent 모달이 PrivacyConsentGate 의 useEffect 지연 mount 로 부팅 후
  // 1-3초 뒤에 떠서 첫 dismissFirstRunDialogs 를 놓치는 경우가 있다. mock 흐름
  // 시작 직전에 한 번 더 dismiss.
  await dismissFirstRunDialogs(page);

  // 0) Mock project inject — OrchestratorPanel:94 의 `if (!currentProject)
  //    return null` 게이트 통과 위해 가짜 Project 객체를 projectStore 에 set.
  //    Firebase Auth 의 mock user uid 와 일치하는 ownerId 로 — 향후 권한 체크
  //    분기에도 자연스럽게 통과.
  await page.evaluate(() => {
    const tw = (
      window as unknown as {
        __marbloTest?: {
          stores: {
            project: {
              getState: () => {
                setCurrentProject: (p: unknown) => void;
              };
            };
          };
        };
      }
    ).__marbloTest;
    if (!tw) throw new Error("__marbloTest hatch 가 노출되지 않음");
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
  });

  // 1) PTY spawn — sh seq 1 5000 → 약 5천 줄 출력 (xterm scroll 가능 분량)
  //    + sleep 60 으로 프로세스 살아있게 (자식 종료 시 PTY 정리되어 회귀 검증 못함).
  const ptySessionId = `test-mock-orch-${Date.now()}`;
  await page.evaluate(async (sessionId) => {
    await window.electronAPI.pty.create({
      id: sessionId,
      name: "MockOrchestrator",
      command: "sh",
      args: ["-c", "for i in $(seq 1 5000); do echo line $i; done; sleep 60"],
      cwd: undefined,
    });
  }, ptySessionId);

  // 2) orchestratorStore inject — setSession + setStatus("running") 후
  //    OrchestratorPanel 이 isRunning=true 로 판단해 OrchestratorTerminal mount.
  //    setCollapsed(false) 로 펼침 보장. inject 후 store state 즉시 read 해서
  //    실제 적용됐는지 확인 (실패 시 즉시 throw 로 빠른 진단).
  const stateAfter = await page.evaluate((sessionId) => {
    const tw = (
      window as unknown as {
        __marbloTest?: {
          stores: {
            orchestrator: {
              getState: () => {
                sessionId: string | null;
                ptySessionId: string | null;
                status: string;
                isCollapsed: boolean;
                setSession: (sid: string, pid: string) => void;
                setStatus: (s: string) => void;
                setCollapsed: (c: boolean) => void;
              };
            };
          };
        };
      }
    ).__marbloTest;
    if (!tw)
      throw new Error(
        "__marbloTest hatch 가 노출되지 않음 (bypassAuth 모드 확인)",
      );
    const store = tw.stores.orchestrator;
    const orch = store.getState();
    orch.setSession("test-mock-session", sessionId);
    orch.setStatus("running");
    orch.setCollapsed(false);
    const after = store.getState();
    return {
      sessionId: after.sessionId,
      ptySessionId: after.ptySessionId,
      status: after.status,
      isCollapsed: after.isCollapsed,
    };
  }, ptySessionId);

  // 진단: 핵심 조건 (isRunning && !isCollapsed && ptySessionId) 모두 충족 확인.
  if (
    stateAfter.status !== "running" ||
    stateAfter.isCollapsed ||
    !stateAfter.ptySessionId
  ) {
    throw new Error(
      `orchestratorStore inject 실패: ${JSON.stringify(stateAfter)}`,
    );
  }

  // 3) OrchestratorTerminal mount + xterm DOM 그려질 때까지 대기 (최대 5s).
  //    .xterm wrapper 가 나타나야 후속 wheel/scroll 검증 가능.
  await page
    .locator(".xterm")
    .first()
    .waitFor({ state: "visible", timeout: 5000 });
  // PTY 데이터 chunk 가 xterm 에 충분히 적재되어 scroll 가능 상태 보장.
  await page.waitForTimeout(800);
  return ptySessionId;
}

async function dismissFirstRunDialogs(page: Page): Promise<void> {
  // PrivacyConsent — 텔레메트리 동의. "나중에" = 옵트아웃 후 다시 안 뜸.
  // PrivacyConsentGate 의 useEffect 가 auth user uid 받은 후에야 needsPrompt
  // 판정하므로 부팅 직후 ~1-3초 윈도우. timeout 을 넉넉하게 (4s) 잡되, 모달이
  // 없으면 즉시 통과.
  const consentLater = page.locator('button:has-text("나중에")').first();
  try {
    await consentLater.waitFor({ state: "visible", timeout: 4000 });
    await consentLater.click();
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
