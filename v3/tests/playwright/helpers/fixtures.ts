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

/**
 * openMockMissions 가 돌려주는 in-memory 미션 백엔드 구동 핸들.
 * missionService 가 (MARBLO_TEST_MISSIONS_INMEM=1 일 때) Firestore 대신 쓰는
 * in-memory 스토어를 테스트에서 직접 조작/조회한다. 미션 진행(상태/스텝/
 * 타임라인)을 결정적으로 구동해 UI 재렌더를 단언하는 데 사용.
 */
export interface MissionsMockHandle {
  /** in-mem 미션 개수 (UI createMission 직후 폴링용). */
  count(): Promise<number>;
  /** lastActivityAt 내림차순 첫 미션 id — 가장 최근 활동한 미션. */
  latestId(): Promise<string | null>;
  /** 미션 리스트 스냅샷 (읽기 전용 핵심 필드). */
  list(): Promise<
    Array<{ id: string; status: string; goal: string; templateId: string }>
  >;
  /** 미션 필드 patch — status/steps/contextLog 등 구동 (엔진 진행 흉내). */
  patch(id: string, partial: Record<string, unknown>): Promise<void>;
  /** UI 없이 미션 직접 주입. */
  seed(missions: Array<Record<string, unknown>>): Promise<void>;
  /** 전체 초기화. */
  reset(): Promise<void>;
}

export interface MarbloHandle {
  app: ElectronApplication;
  page: Page;
  /** 상단 TabBar 의 탭으로 전환. id 는 TabBar.tsx 정의와 일치해야 함. */
  openTab(
    tabId:
      | "guide"
      | "startHere"
      | "board"
      | "lanes"
      | "missions"
      | "code"
      | "agents"
      | "flows"
      | "deploy"
      | "store"
      | "harness"
      | "settings",
  ): Promise<void>;
  /** 오케스트레이터 또는 에이전트 PTY 터미널에 대한 POM 반환. */
  terminal(kind: "orchestrator" | "agent"): Promise<TerminalPage>;
  /**
   * Tier 2 mock helper — claude 없이 OrchestratorPanel 을 활성화한다.
   * TerminalView 가 mount 된 뒤 dummy sh PTY 를 붙이고 seq 명령으로 충분히 긴
   * 출력을 발사 → xterm 스크롤 가능 상태 + wantBottomRef 회귀 시나리오 검증.
   *
   * 흐름:
   *   1. mock project inject 후 project-switch cleanup settle 대기
   *   2. orchestratorStore.setSession + setStatus("running") inject
   *      (window.__marbloTest 통해)
   *   3. OrchestratorPanel 이 자동으로 OrchestratorTerminal mount
   *   4. xterm mount 뒤 main 의 ptyManager 에 sh spawn + 한글 seq 출력
   *   5. TerminalView 의 onData handler 가 xterm.write
   *
   * @returns 생성된 ptySessionId
   */
  openMockOrchestrator(): Promise<string>;
  /**
   * Tier 2 mock helper — Firestore 없이 taskStore.setState 로 mock 카드들을
   * 직접 inject + Board 탭으로 전환. KanbanBoard 가 currentProject + tasks 를
   * 즉시 받아 컬럼/카드 렌더.
   *
   * 흐름:
   *   1. projectStore.setCurrentProject — KanbanBoard 의 "No Projects" 게이트 통과
   *   2. taskStore.setState({ tasks, loading: false }) — Firestore subscribe 없이
   *      mock 카드들을 직접 주입 (TODO 2장 + IN_PROGRESS 1장 기본)
   *   3. Board 탭으로 전환 → KanbanBoard mount → 컬럼 5개 + 카드 visible
   *
   * @returns inject 된 mock 카드 id 목록 (시나리오에서 카드 클릭/단언에 사용)
   */
  openMockKanban(): Promise<{ todoIds: string[]; inProgressIds: string[] }>;
  /**
   * Tier 2 mock helper — missionService in-memory 백엔드를 활성화하고 Missions
   * 탭으로 전환한다. 진짜 Firestore/LLM 없이 미션탭 end-to-end 흐름(템플릿 카드
   * → LaunchDialog → createMission → 리스트/디테일/타임라인 → 상태 전이)을
   * 결정적으로 검증할 수 있다.
   *
   * 전제: launch 옵션 missionsInMem=true (test.use({ marbloOptions:
   * { missionsInMem: true } })). 그래야 preload 가 testMode.missionsInMemory 를
   * 노출하고 missionService 가 in-memory 로 분기한다.
   *
   * 흐름:
   *   1. projectStore.setCurrentProject — MissionsTab 의 projectId 게이트 통과
   *   2. Missions 탭 전환 → MissionsTab mount → subscribeToMissions →
   *      in-mem 백엔드의 ensureHatch() 가 window.__marbloTest.missions 설치
   *   3. 핸들 반환 — 미션 생성(UI)/주입(seed)/구동(patch)/조회(list/count)
   *
   * @returns in-memory 미션 백엔드 구동 핸들
   */
  openMockMissions(): Promise<MissionsMockHandle>;
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
        // 셸 탭(role=tab, i18n 라벨)을 먼저 보고, 없으면 레거시 TabBar(영어
        // 라벨)로 떨어진다. 셸의 탭 바는 가로 스크롤이라 화면 밖일 수 있어
        // 클릭 전에 스크롤해 들여온다.
        const shellTab = page.locator(
          `[role="tab"]:has-text("${shellLabelOf(tabId)}")`,
        );
        if (
          await shellTab
            .first()
            .isVisible()
            .catch(() => false)
        ) {
          await shellTab.first().scrollIntoViewIfNeeded();
          await shellTab.first().click();
          return;
        }
        const sel = `[data-testid="tab-${tabId}"], button:has-text("${labelOf(
          tabId,
        )}")`;
        await page.locator(sel).first().click();
      },
      async terminal(kind) {
        return new TerminalPage(page, kind);
      },
      async openMockOrchestrator() {
        return openMockOrchestrator(page);
      },
      async openMockKanban() {
        return openMockKanban(page, handle);
      },
      async openMockMissions() {
        return openMockMissions(page, handle);
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
 * Mock OrchestratorPanel 활성화. 진짜 claude 대신 출력 없는 sh PTY 를 띄운 뒤
 * zustand orchestratorStore 를 직접 manipulate 한다. window.__marbloTest hatch 가
 * bypassAuth 모드에서만 노출되므로 production 영향 0.
 */
export async function openMockOrchestrator(page: Page): Promise<string> {
  // 0) session id 만 먼저 정한다. TerminalView 는 PTY 가 아직 없어도 mount 할 수
  //    있고, onData listener 도 session id 기준으로 먼저 붙는다. 실제 sh spawn 은
  //    xterm 이 열린 뒤 실행해 mount 전 IPC/replay 경합과 macOS pty fd teardown
  //    지연을 분리한다.
  const ptySessionId = `test-mock-orch-${Date.now()}`;

  // 1) Project inject. 이전 실제 프로젝트가 복원된 상태라면 project-switch
  //    cleanup 이 한 번 돌며 orchestratorStore 를 clear 한다. 그래서 프로젝트
  //    전환을 먼저 settle 시키고, 그 뒤 mock session 을 꽂는다.
  await page.evaluate(() => {
    const tw = (
      window as unknown as {
        __marbloTest?: {
          stores: {
            project: {
              getState: () => {
                setCurrentProject: (p: unknown) => void;
              };
              setState: (partial: Record<string, unknown>) => void;
            };
          };
        };
      }
    ).__marbloTest;
    if (!tw)
      throw new Error(
        "__marbloTest hatch 가 노출되지 않음 (bypassAuth 모드 확인)",
      );
    const project = {
      id: "test-mock-project",
      name: "Mock Project",
      ownerId: "test-user-bypass",
      members: ["test-user-bypass"],
      enabledModels: ["claude"],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    // A live projects snapshot from the developer profile must never replace
    // the deterministic fixture after it mounts. Deliberately change the
    // subscription owner stamp so any in-flight callback is ignored.
    tw.stores.project.setState({
      currentProject: project,
      projects: [project],
      subscribedUserId: "test-user-bypass",
      projectsHydrated: true,
      loading: false,
    });
  });
  await page.waitForTimeout(100);

  // 2) orchestratorStore inject.
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
  try {
    await page
      .locator(".xterm")
      .first()
      .waitFor({ state: "visible", timeout: 5000 });
  } catch (err) {
    const debug = await page.evaluate(() => {
      const tw = (
        window as unknown as {
          __marbloTest?: {
            stores: {
              project: {
                getState: () => {
                  currentProject: { id?: string; name?: string } | null;
                };
              };
              orchestrator: {
                getState: () => {
                  sessionId: string | null;
                  ptySessionId: string | null;
                  status: string;
                  isCollapsed: boolean;
                };
              };
            };
          };
        }
      ).__marbloTest;
      const project = tw?.stores.project.getState().currentProject;
      const orchestrator = tw?.stores.orchestrator.getState();
      return {
        bodyText: document.body.innerText.slice(0, 800),
        xtermCount: document.querySelectorAll(".xterm").length,
        orchestratorText: Array.from(
          document.querySelectorAll("body *"),
          (el) => el.textContent ?? "",
        ).filter((text) => text.includes("Orchestrator")).length,
        project: project ? { id: project.id, name: project.name } : null,
        orchestrator: orchestrator
          ? {
              sessionId: orchestrator.sessionId,
              ptySessionId: orchestrator.ptySessionId,
              status: orchestrator.status,
              isCollapsed: orchestrator.isCollapsed,
            }
          : null,
      };
    });
    throw new Error(
      `.xterm mount 대기 실패: ${err instanceof Error ? err.message : String(err)}\n${JSON.stringify(
        debug,
        null,
        2,
      )}`,
    );
  }

  // 4) xterm/listener 가 붙은 뒤 실제 PTY 를 만들고 한글 scrollback 을 생성.
  //    300줄이면 기본 24행 viewport 에서 scrollback 검증에 충분하고, spawn-time
  //    출력 폭주를 피한다.
  await page.evaluate(async (sessionId) => {
    await window.electronAPI.pty.create({
      id: sessionId,
      name: "MockOrchestrator",
      command: "sh",
      args: [],
      cwd: undefined,
    });
    window.electronAPI.pty.write(
      sessionId,
      'for i in $(seq 1 300); do printf "한글 line %s\\r\\n" "$i"; done\r',
    );
  }, ptySessionId);
  // PTY 데이터 chunk 가 xterm 에 충분히 적재되어 scroll 가능 상태 보장.
  await page.waitForTimeout(800);
  return ptySessionId;
}

/**
 * Mock 칸반 보드 활성화. Firestore subscribe 를 우회하고 taskStore 에 mock
 * Task 배열을 직접 inject. KanbanBoard.useEffect (subscribeToTasks) 가 fire
 * 하더라도 그 결과로 set 되는 빈 배열은 our injection 이후 빠르게 덮어쓴다 —
 * 그래서 inject 는 Board 탭 mount 직후 두 번 (즉시 + 짧은 지연 후) 수행.
 */
async function openMockKanban(
  page: Page,
  handle: MarbloHandle,
): Promise<{ todoIds: string[]; inProgressIds: string[] }> {
  await dismissFirstRunDialogs(page);

  // Mock 카드 id (시나리오에서 클릭 / store 단언에 사용)
  const todoIds = [
    `test-task-todo-1-${Date.now()}`,
    `test-task-todo-2-${Date.now()}`,
  ];
  const inProgressIds = [`test-task-inprog-1-${Date.now()}`];

  // 0) Project inject — KanbanBoard 의 "No Projects" 게이트 통과.
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

  // 1) Board 탭으로 전환 — KanbanBoard mount.
  await handle.openTab("board");

  // 2) taskStore inject — Firestore 없이 mock 카드들을 직접 setState.
  //    KanbanBoard 의 subscribeToTasks 가 fire 해도 service 가 (mock 환경에서)
  //    빈 배열을 돌려주거나 throw → 직후 inject 가 덮어씀. 충분히 안정화하기
  //    위해 mount 직후 + 600ms 후 두 번 inject.
  const injectFn = async () => {
    return await page.evaluate(
      ({ todoIds, inProgressIds }) => {
        const tw = (
          window as unknown as {
            __marbloTest?: {
              stores: {
                task: {
                  getState: () => { tasks: unknown[] };
                  setState: (s: Record<string, unknown>) => void;
                };
              };
            };
          }
        ).__marbloTest;
        if (!tw) throw new Error("__marbloTest hatch 가 노출되지 않음");
        const now = new Date();
        const makeTask = (id: string, status: string, title: string) => ({
          id,
          projectId: "test-mock-project",
          title,
          description: `Mock task ${id}`,
          status,
          role: "backend",
          priority: 3,
          dependsOn: [],
          dependsOnCompleted: true,
          claimedBy: null,
          claimedAt: null,
          scope: [],
          comment: "",
          prUrl: "",
          hasPmFeedback: false,
          createdAt: now,
          updatedAt: now,
        });
        const tasks = [
          makeTask(todoIds[0], "TODO", "Mock TODO #1"),
          makeTask(todoIds[1], "TODO", "Mock TODO #2"),
          makeTask(inProgressIds[0], "IN_PROGRESS", "Mock IN_PROGRESS #1"),
        ];
        tw.stores.task.setState({ tasks, loading: false });
        return tw.stores.task.getState().tasks.length;
      },
      { todoIds, inProgressIds },
    );
  };

  // hatch 가 노출될 때까지 대기 (main.tsx 의 useEffect 이후).
  await page.waitForFunction(
    () => {
      const tw = (
        window as unknown as {
          __marbloTest?: { stores: { task?: unknown } };
        }
      ).__marbloTest;
      return !!tw?.stores?.task;
    },
    null,
    { timeout: 5000 },
  );

  let injectedCount = await injectFn();
  // 짧은 대기 후 재 inject — subscribeToTasks 의 초기 empty snapshot 이
  // 우리 inject 를 덮어쓰지 않도록.
  await page.waitForTimeout(600);
  injectedCount = await injectFn();

  if (injectedCount !== 3) {
    throw new Error(
      `taskStore inject 실패: expected 3 tasks, got ${injectedCount}`,
    );
  }

  // 3) KanbanBoard 의 컬럼 5개 (TODO/CLAIMED/IN_PROGRESS/REVIEW/DONE) mount 대기.
  //    컬럼 헤더 텍스트는 KanbanColumn 의 STATUS_CONFIG.label.
  await page
    .locator("text=/TODO/i")
    .first()
    .waitFor({ state: "visible", timeout: 5000 });
  // 카드가 실제로 그려질 때까지 한 박자 더.
  await page.waitForTimeout(300);

  return { todoIds, inProgressIds };
}

/**
 * Mock 미션탭 활성화. missionService 의 in-memory 백엔드(MARBLO_TEST_MISSIONS_INMEM
 * =1 전제)를 띄우고 Missions 탭으로 전환한다. Firestore/LLM 없이 미션 흐름을
 * 결정적으로 구동/단언하기 위한 핸들을 돌려준다.
 *
 * window.__marbloTest.missions 해치는 첫 in-mem 호출(MissionsTab mount 의
 * subscribeToMissions) 시점에 설치되므로, 탭 전환 후 해치 노출을 명시 대기한다.
 */
async function openMockMissions(
  page: Page,
  handle: MarbloHandle,
): Promise<MissionsMockHandle> {
  await dismissFirstRunDialogs(page);

  // 0) Project inject — MissionsTab 의 `if (!projectId)` 게이트 통과.
  //    projectStore hatch 노출 대기 → inject → race 흡수 위해 짧은 후 재 inject.
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
    { timeout: 5000 },
  );

  const injectProject = async () =>
    page.evaluate(() => {
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
      return tw.stores.project.getState().currentProject?.id ?? null;
    });

  await injectProject();
  await page.waitForTimeout(300);
  await injectProject();

  // 1) Missions 탭으로 전환 → MissionsTab mount → subscribeToMissions →
  //    in-mem 백엔드 ensureHatch() 가 window.__marbloTest.missions 설치.
  await handle.openTab("missions");

  // 2) missions 해치 노출 대기 (in-mem 활성 + subscribe 발생 확인).
  await page.waitForFunction(
    () => {
      const tw = (
        window as unknown as { __marbloTest?: { missions?: unknown } }
      ).__marbloTest;
      return !!tw?.missions;
    },
    null,
    { timeout: 5000 },
  );

  // 모든 구동/조회는 page.evaluate 로 해치를 직접 호출. latestId/sort 는
  // Date 직렬화 경계를 피하려 브라우저 컨텍스트 안에서 계산한다.
  type MissionsHatch = {
    count(): number;
    list(): Array<Record<string, unknown>>;
    patch(id: string, partial: Record<string, unknown>): void;
    seed(missions: Array<Record<string, unknown>>): void;
    reset(): void;
  };
  return {
    async count() {
      return page.evaluate(() => {
        const m = (
          window as unknown as { __marbloTest: { missions: MissionsHatch } }
        ).__marbloTest.missions;
        return m.count();
      });
    },
    async latestId() {
      return page.evaluate(() => {
        const m = (
          window as unknown as { __marbloTest: { missions: MissionsHatch } }
        ).__marbloTest.missions;
        const list = m.list() as Array<{ id: string; lastActivityAt: Date }>;
        const sorted = [...list].sort(
          (a, b) =>
            new Date(b.lastActivityAt).getTime() -
            new Date(a.lastActivityAt).getTime(),
        );
        return sorted[0]?.id ?? null;
      });
    },
    async list() {
      return page.evaluate(() => {
        const m = (
          window as unknown as { __marbloTest: { missions: MissionsHatch } }
        ).__marbloTest.missions;
        return (
          m.list() as Array<{
            id: string;
            status: string;
            goal: string;
            templateId: string;
          }>
        ).map((x) => ({
          id: x.id,
          status: x.status,
          goal: x.goal,
          templateId: x.templateId,
        }));
      });
    },
    async patch(id: string, partial: Record<string, unknown>) {
      await page.evaluate(
        ({ id, partial }) => {
          const m = (
            window as unknown as { __marbloTest: { missions: MissionsHatch } }
          ).__marbloTest.missions;
          m.patch(id, partial);
        },
        { id, partial },
      );
    },
    async seed(missions: Array<Record<string, unknown>>) {
      await page.evaluate((missions) => {
        const m = (
          window as unknown as { __marbloTest: { missions: MissionsHatch } }
        ).__marbloTest.missions;
        m.seed(missions);
      }, missions);
    },
    async reset() {
      await page.evaluate(() => {
        const m = (
          window as unknown as { __marbloTest: { missions: MissionsHatch } }
        ).__marbloTest.missions;
        m.reset();
      });
    },
  };
}

async function dismissFirstRunDialogs(page: Page): Promise<void> {
  // LanguageFirstRun — fresh app profiles can show this before any tab click.
  // Pick the default Korean locale used by the rest of these Playwright specs.
  try {
    const languageDialog = page.getByRole("dialog", {
      name: "언어를 선택하세요",
    });
    await languageDialog.waitFor({ state: "visible", timeout: 1500 });
    await languageDialog.getByRole("button", { name: /한국어/ }).click();
    await languageDialog.getByRole("button", { name: "계속" }).click();
    await languageDialog.waitFor({ state: "hidden", timeout: 5000 });
  } catch {
    /* 모달이 없으면 통과 */
  }

  // PrivacyConsent — 텔레메트리 동의. "나중에" = 옵트아웃 후 다시 안 뜸.
  // PrivacyConsentGate 의 useEffect 가 auth user uid 받은 후에야 needsPrompt
  // 판정하므로 부팅 직후 ~1-3초 윈도우. timeout 을 넉넉하게 (4s) 잡되, 모달이
  // 없으면 즉시 통과.
  const consentLater = page.getByRole("button", { name: /^나중에$/ }).first();
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
    startHere: "Start here",
    board: "Board",
    lanes: "Quick Lanes",
    missions: "Missions",
    code: "Code",
    agents: "Agents",
    flows: "Flows (Beta)",
    deploy: "Deploy",
    store: "Store",
    harness: "Harness",
    settings: "Settings",
  };
  return m[tabId] ?? tabId;
}

/**
 * 워크스페이스 셸(기본 ON)의 탭 라벨 — `src/locales/ko/workspace.ts` 의
 * `workspace.tab.*` 와 일치해야 한다.
 *
 * 왜 두 벌인가: 앱은 두 개의 탭 바를 갖고 있다. 레거시 `TabBar`(하드코딩 영어
 * 라벨)와 워크스페이스 셸의 `WorkTabs`(i18n, 기본 로케일 ko). 헬퍼가 영어
 * 라벨만 찾던 시절엔 셸이 기본이 된 뒤로 board·code·harness·settings 등
 * 대부분의 탭 클릭이 30초 타임아웃으로 죽어 있었다 — 스펙이 빨간 게 아니라
 * 헬퍼가 낡은 것이었다. 둘 다 시도하므로 어느 셸이 켜져 있어도 동작한다.
 */
function shellLabelOf(tabId: string): string {
  const m: Record<string, string> = {
    guide: "가이드",
    startHere: "시작하기",
    board: "보드",
    lanes: "퀵레인",
    missions: "미션",
    code: "코드",
    agents: "에이전트",
    flows: "플로우 (베타)",
    deploy: "배포",
    store: "스토어",
    harness: "하네스",
    settings: "설정",
  };
  return m[tabId] ?? tabId;
}

export { expect };
