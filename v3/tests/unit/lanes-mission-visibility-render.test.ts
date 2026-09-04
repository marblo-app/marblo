/**
 * @vitest-environment jsdom
 *
 * 레인 탭 미션 섹션 — 사장님이 실제로 숫자를 보시는 자리.
 * 티켓 pfEBF4VEhyM1P1iw7Aem (진단 #1402 §6-6).
 *
 * 사고: 이 프로젝트의 active 미션 3건이 전부 `missionKind: "implicit"`(지난
 * 작업에 붙인 Replay 이름표, `steps: []`)이었다. 엔진은 이것들을 픽업하지
 * 않으므로 운전할 대상은 0건인데, 이 섹션은 셋을 실행 중인 미션과 **같은
 * 자리·같은 초록 Active 배지**로 그렸고, "미션을 걸어라" CTA 는 미션 doc 이
 * 하나라도 있으면 뜨지 않아 **영원히 숨어 있었다.**
 *
 * 그래서 여기서 고정하는 것:
 *   1. 이름표만 있을 때 → "돌고 있는 미션 0건" + 미션 거는 진입점이 보인다.
 *   2. 실행 가능한 미션이 있을 때 → 예전대로 카드가 보이고 0건 문구는 없다.
 *   3. 섹션 헤더 집계가 이름표를 세지 않는다.
 *   4. 이름표는 지워지지 않고 별도 접힌 그룹으로 남는다(Replay 역할 유지).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
// 테스트 런타임 로케일은 en 이다 — 문장을 베끼지 않고 사전에서 꺼낸다.
import { en } from "../../src/locales/en";
import type { Mission, MissionStatus } from "../../src/types/mission";

/**
 * ★스토어 스냅샷은 hoisted 상수로 고정한다. selector 호출마다 새 객체·새 함수를
 * 만들면 `subscribeToTasks` 등의 참조가 매 렌더 바뀌고, 그것들을 deps 로 쓰는
 * 구독 effect 가 매 렌더 재실행되어 setMissions → 재렌더 → … 무한 루프가 된다
 * (실제로 이 테스트를 처음 쓸 때 힙을 터뜨렸다).
 */
const state = vi.hoisted(() => {
  const noopUnsub = () => undefined;
  return {
    missionListener: null as null | ((missions: unknown[]) => void),
    project: { currentProject: { id: "p1", name: "marblo" } },
    editor: { rootPath: "/tmp/repo" },
    task: { tasks: [], subscribeToTasks: () => noopUnsub },
    agent: {
      agents: [],
      subscribeToAgents: () => noopUnsub,
      restartAgent: () => undefined,
    },
    worktree: {
      worktrees: [],
      refresh: async () => undefined,
      remove: () => undefined,
    },
    subscription: { getPlan: () => "free" as const },
    ui: { showUpgrade: () => undefined },
    terminal: { attachSession: () => undefined },
    sessionMap: { sessions: {} },
    navigation: { requestJump: () => undefined },
  };
});

vi.mock("../../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { uid: "u1" } }),
}));
vi.mock("../../src/stores/projectStore", () => ({
  useProjectStore: (selector: (s: unknown) => unknown) =>
    selector(state.project),
}));
vi.mock("../../src/stores/editorStore", () => ({
  useEditorStore: (selector: (s: unknown) => unknown) => selector(state.editor),
}));
vi.mock("../../src/stores/taskStore", () => ({
  useTaskStore: (selector: (s: unknown) => unknown) => selector(state.task),
}));
vi.mock("../../src/stores/agentStore", () => ({
  useAgentStore: (selector: (s: unknown) => unknown) => selector(state.agent),
}));
vi.mock("../../src/stores/worktreeStore", () => ({
  useWorktreeStore: (selector: (s: unknown) => unknown) =>
    selector(state.worktree),
}));
vi.mock("../../src/stores/subscriptionStore", () => ({
  useSubscriptionStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector(state.subscription),
    { getState: () => state.subscription },
  ),
}));
vi.mock("../../src/stores/uiStore", () => ({
  useUiStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector(state.ui),
    { getState: () => state.ui },
  ),
}));
vi.mock("../../src/stores/terminalStore", () => ({
  useTerminalStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector(state.terminal),
    { getState: () => state.terminal },
  ),
}));
vi.mock("../../src/stores/agentSessionMap", () => ({
  useAgentSessionMap: (selector: (s: unknown) => unknown) =>
    selector(state.sessionMap),
}));
vi.mock("../../src/stores/navigationStore", () => ({
  useNavigationStore: (selector: (s: unknown) => unknown) =>
    selector(state.navigation),
}));
// LanesTab 이 끌고 오는 서비스 모듈들이 import 만으로 실제 firebase 앱을
// 초기화한다(렌더에는 아무 상관 없다) — 껍데기로 끊는다.
vi.mock("../../src/lib/firebase", () => ({
  app: {},
  auth: {},
  db: {},
  functions: {},
  isPackagedLoopbackAuth: false,
  FIREBASE_FUNCTIONS_REGION: "us-central1",
}));
vi.mock("../../src/services/taskService", () => ({
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
}));
vi.mock("../../src/services/agentService", () => ({
  spawnAgent: vi.fn(),
  stopAgent: vi.fn(),
  deleteAgent: vi.fn(),
}));
vi.mock("../../src/services/onrampBlockSignal", () => ({
  reportOnrampExecBlocked: vi.fn(),
}));
vi.mock("../../src/services/missionService", () => ({
  subscribeToMissions: (_projectId: string, cb: (m: unknown[]) => void) => {
    state.missionListener = cb;
    cb([]);
    return () => {
      state.missionListener = null;
    };
  },
}));

/** 이 테스트가 보는 최소 미션 doc — 나머지 필드는 섹션이 읽지 않는다. */
function mission(
  id: string,
  status: MissionStatus,
  opts: { implicit?: boolean; taskIds?: string[]; steps?: number } = {},
): Mission {
  const now = new Date("2026-09-04T00:00:00Z");
  return {
    id,
    projectId: "p1",
    goal: `goal for ${id}`,
    templateId: opts.implicit ? "adhoc" : "quick-fix",
    status,
    ...(opts.implicit
      ? { missionKind: "implicit" as const, implicitLabel: `label-${id}` }
      : {}),
    ownerOrchestratorSessionId: "s1",
    steps: Array.from({ length: opts.steps ?? 0 }, (_, i) => ({
      id: `step-${i}`,
      type: "dispatch" as const,
      skill: "frontend",
      status: "pending" as const,
    })),
    currentStepIndex: 0,
    taskIds: opts.taskIds ?? [],
    contextLog: [],
    launchedAt: now,
    lastActivityAt: now,
    completedAt: null,
  } as Mission;
}

/** 사고 당시 그대로 — active 3건이 전부 이름표이고 실행 계획이 없다. */
const IMPLICIT_ONLY = [
  mission("27CNOI0pdxvsSjVwuB3x", "active", {
    implicit: true,
    taskIds: ["t1", "t2", "t3"],
  }),
  mission("N2hEH1t7Eh8WdAxQS0KC", "active", {
    implicit: true,
    taskIds: ["t4"],
  }),
  mission("uiig9mvbutT5SV1Op5JD", "active", {
    implicit: true,
    taskIds: ["t5"],
  }),
];

// 미션 섹션은 VITE_DEV_FEATURES 게이트 뒤에 있고 그 판정이 모듈 로드 시점에 한 번
// 굳는다 — stub 을 먼저 걸고 딱 한 번 동적 import 한다. (테스트마다
// resetModules + 재import 하면 이 모듈 그래프가 통째로 여러 벌 살아남아 힙이
// 터진다.)
vi.stubEnv("VITE_DEV_FEATURES", "missions");
const { LanesTab } = await import("../../src/components/lanes/LanesTab");

async function renderLanesTab(missions: Mission[]) {
  render(createElement(LanesTab));
  await act(async () => {
    state.missionListener?.(missions);
  });
}

function missionSection(): HTMLElement {
  const section = document.querySelector<HTMLElement>(
    '[data-testid="lanes-missions-section"]',
  );
  if (!section) throw new Error("mission section did not render");
  return section;
}

describe("LanesTab 미션 섹션 — 실행 가능한 미션 0건을 화면이 말하는가", () => {
  beforeEach(() => {
    state.missionListener = null;
  });
  afterEach(() => {
    cleanup();
  });

  it("★이름표만 있으면 '돌고 있는 미션 0건' 과 미션 거는 진입점을 보여준다", async () => {
    await renderLanesTab(IMPLICIT_ONLY);

    // 무엇이 없는지 — 사람 말로.
    expect(screen.getByText(en["lanes.missions.idle.title"])).toBeInstanceOf(
      HTMLElement,
    );
    expect(screen.getByText(en["lanes.missions.idle.hint"])).toBeInstanceOf(
      HTMLElement,
    );

    // 무엇을 하면 되는지 — 그 자리에서 미션을 걸 수 있어야 한다.
    const cta = screen.getByRole("button", {
      name: en["lanes.missions.idle.cta"],
    });
    const opened = vi.fn();
    window.addEventListener("marblo:open-missions", opened);
    fireEvent.click(cta);
    expect(opened).toHaveBeenCalledTimes(1);
    window.removeEventListener("marblo:open-missions", opened);
  });

  it("이름표 3건이 실행 중으로 세어지지 않는다 — 헤더 집계가 0", async () => {
    await renderLanesTab(IMPLICIT_ONLY);
    const count = missionSection().querySelector(
      '[data-testid="lanes-missions-count"]',
    );
    expect(count?.textContent).toBe("0");
  });

  it("이름표는 실행 중인 미션과 같은 모양으로 놓이지 않는다 — Active 배지가 없다", async () => {
    await renderLanesTab(IMPLICIT_ONLY);
    // MissionStatusBadge(compact) 는 active 를 "▶" 로 그린다. 이름표에는
    // 그 배지가 붙으면 안 된다 — 붙는 순간 실행 중인 미션과 구분이 사라진다.
    expect(screen.queryByText("▶")).toBeNull();
    // 이름표 카드가 미션 카드 자리에 그려지지도 않는다.
    expect(
      screen.queryByLabelText(
        en["lanes.missions.openDetail"].replace(
          "{title}",
          "label-27CNOI0pdxvsSjVwuB3x: goal for 27CNOI0pdxvsSjVwuB3x",
        ),
      ),
    ).toBeNull();
  });

  it("이름표는 지워지지 않는다 — 접힌 별도 그룹으로 남고 펼치면 보인다", async () => {
    await renderLanesTab(IMPLICIT_ONLY);
    const group = missionSection().querySelector<HTMLElement>(
      '[data-testid="lanes-mission-labels"]',
    );
    expect(group).toBeInstanceOf(HTMLElement);
    expect(
      screen.getByText(en["lanes.missions.labels.heading"]),
    ).toBeInstanceOf(HTMLElement);

    // 기본은 접힘 — 목록이 안 보인다.
    expect(screen.queryByText(/goal for 27CNOI0pdxvsSjVwuB3x/)).toBeNull();

    fireEvent.click(
      screen.getByRole("button", {
        name: en["lanes.missions.labels.expand"].replace("{count}", "3"),
      }),
    );
    expect(screen.getByText(/goal for 27CNOI0pdxvsSjVwuB3x/)).toBeInstanceOf(
      HTMLElement,
    );
    expect(screen.getByText(en["lanes.missions.labels.note"])).toBeInstanceOf(
      HTMLElement,
    );
  });

  it("★반대 방향 — 실행 가능한 미션이 있으면 예전대로 카드가 보이고 0건 문구는 없다", async () => {
    await renderLanesTab([
      ...IMPLICIT_ONLY,
      mission("real-1", "active", { steps: 3, taskIds: ["t9"] }),
    ]);

    // 0건 문구/패널이 사라진다.
    expect(screen.queryByText(en["lanes.missions.idle.title"])).toBeNull();
    expect(
      document.querySelector('[data-testid="lanes-missions-idle"]'),
    ).toBeNull();

    // 실행 가능한 미션은 예전 그대로 — 카드 + active 배지("▶") 정확히 1개.
    expect(screen.getByText("goal for real-1")).toBeInstanceOf(HTMLElement);
    expect(screen.getAllByText("▶")).toHaveLength(1);

    // 집계는 실행 가능한 1건만 센다(이름표 3건은 빠진다).
    const count = missionSection().querySelector(
      '[data-testid="lanes-missions-count"]',
    );
    expect(count?.textContent).toBe("1");

    // 이름표 그룹은 여전히 따로 남아 있다.
    expect(
      missionSection().querySelector('[data-testid="lanes-mission-labels"]'),
    ).toBeInstanceOf(HTMLElement);
  });

  it("미션이 하나도 없으면 기존 첫-미션 빈 상태를 그대로 쓴다", async () => {
    await renderLanesTab([]);
    expect(screen.getByText(en["lanes.missions.empty.title"])).toBeInstanceOf(
      HTMLElement,
    );
    expect(
      screen.getByRole("button", { name: en["lanes.missions.empty.cta"] }),
    ).toBeInstanceOf(HTMLElement);
    // 이름표가 없으니 그룹도 안 뜬다.
    expect(
      document.querySelector('[data-testid="lanes-mission-labels"]'),
    ).toBeNull();
  });
});
