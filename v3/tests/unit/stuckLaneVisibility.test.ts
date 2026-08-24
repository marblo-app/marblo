/**
 * @vitest-environment jsdom
 *
 * ★정체 레인 가시성 — 외부 리포트 AYJyHabfdG1DqeUvun9H 회귀.
 *
 * 이 버그의 본체는 오판 하나가 아니라 **두 층이 겹쳐 사람이 티켓을 못 찾게
 * 되는 것**이었다: (1) 살아 일하는 티켓이 STALE 로 찍혀 활성 컬럼에서 빠지고,
 * (2) 정체 레인이 기본 접힘이라 그 뒤 어디에도 안 보인다. 그래서 판정 로직
 * (tests/unit/stuckLane.test.ts)과 별개로, **화면에서 발견 가능한가**를 여기서
 * 못 박는다.
 *
 * 계약:
 *   ① 접힌 레인이 총계뿐 아니라 BLOCKED·FAILED·STALE **그룹별 건수**를 보여준다
 *   ② 정체로 빠진 티켓은 원래 컬럼에 "n건 정체 레인" 흔적을 남긴다
 *   ③ 그 흔적을 누르면 레인이 펴져 카드에 실제로 도달한다
 *   ④ 다른 프로젝트의 에이전트 스냅샷이 물려 있어도 진행 중 티켓을 정체로
 *      몰지 않는다(agentStore 단일 슬롯 × MissionDetail 교차구독)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { Agent } from "../../src/types/agent";
import type { Task, TaskStatus } from "../../src/types/task";

const stores = vi.hoisted(() => ({
  tasks: [] as unknown[],
  agents: [] as unknown[],
  agentsHydrated: true,
  agentsProjectId: "p1" as string | null,
}));

vi.mock("../../src/stores/taskStore", () => ({
  useTaskStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      tasks: stores.tasks,
      loading: false,
      subscribeToTasks: () => () => {},
      refreshTasks: () => Promise.resolve(),
    }),
  ),
}));

vi.mock("../../src/stores/agentStore", () => ({
  useAgentStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      agents: stores.agents,
      hydrated: stores.agentsHydrated,
      agentsProjectId: stores.agentsProjectId,
    }),
  ),
}));

vi.mock("../../src/stores/projectStore", () => ({
  useProjectStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      currentProject: {
        id: "p1",
        name: "Demo",
        ownerId: "u1",
        folderPath: "/tmp/demo",
      },
      loading: false,
      projectsHydrated: true,
    }),
  ),
}));

vi.mock("../../src/stores/subscriptionStore", () => ({
  useSubscriptionStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ canUse: () => false }),
  ),
}));

vi.mock("../../src/stores/navigationStore", () => ({
  useNavigationStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ pendingJump: null, consumeJump: () => {} }),
  ),
}));

vi.mock("../../src/stores/worktreeStore", () => ({
  useWorktreeStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      worktrees: [],
      ensureFresh: () => Promise.resolve(),
      statusPill: () => ({ tone: "ready", icon: "✓", label: "ready" }),
    }),
  ),
}));

vi.mock("../../src/stores/editorStore", () => ({
  useEditorStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ rootPath: "/tmp/repo" }),
  ),
}));

vi.mock("../../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { uid: "u1" } }),
}));

vi.mock("../../src/hooks/usePresence", () => ({
  usePresence: () => null,
}));

vi.mock("../../src/lib/firebase", () => ({
  app: {},
  auth: {},
  db: {},
  functions: {},
}));

vi.mock("../../src/services/firestore", () => ({
  subscribeToDocument: vi.fn(() => () => {}),
  subscribeToCollection: vi.fn(() => () => {}),
}));

vi.mock("../../src/services/taskService", () => ({
  updateTaskStatus: vi.fn(),
  createTask: vi.fn(),
  setTaskArchived: vi.fn(),
  softDeleteTask: vi.fn(),
  restoreTask: vi.fn(),
  unclaimTask: vi.fn(),
}));

vi.mock("../../src/services/telemetryService", () => ({
  default: {
    taskCreated: vi.fn(),
    taskStatusChanged: vi.fn(),
    taskCompleted: vi.fn(),
    cliSetupStep: vi.fn(),
  },
}));

vi.mock("../../src/components/work-history/FirstMissionShareNudge", () => ({
  FirstShareNudge: () => null,
}));

vi.mock("../../src/components/orchestrator/OrchestratorChat", () => ({
  OrchestratorChat: () => null,
}));

vi.mock("../../src/components/board/TaskCreateModal", () => ({
  TaskCreateModal: () => null,
}));

vi.mock("../../src/components/board/TaskDetailModal", () => ({
  TaskDetailModal: () => null,
}));

vi.mock("../../src/components/board/TaskGraphView", () => ({
  TaskGraphView: () => null,
}));

import { KanbanBoard } from "../../src/components/board/KanbanBoard";
import { useLocaleStore } from "../../src/lib/i18n";
import { resetAgentTokenObservations } from "../../src/lib/agentProgress";

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;

function task(overrides: Partial<Task> & { id: string }): Task {
  return {
    projectId: "p1",
    contextId: "board",
    title: overrides.id,
    description: "",
    status: "IN_PROGRESS",
    role: "frontend",
    priority: 3,
    dependsOn: [],
    dependsOnCompleted: true,
    claimedBy: null,
    claimedAt: null,
    scope: [],
    comment: "",
    prUrl: "",
    hasPmFeedback: false,
    createdAt: new Date(NOW - 120 * MINUTE),
    updatedAt: new Date(NOW),
    ...overrides,
  } as Task;
}

function agent(id: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id,
    projectId: "p1",
    ownerId: "u1",
    name: id,
    model: "claude",
    role: "frontend",
    status: "working",
    currentTaskId: null,
    command: "claude",
    skillFile: "",
    createdAt: new Date(NOW - 120 * MINUTE),
    ...overrides,
  } as Agent;
}

/** 담당을 못 찾아 정체로 빠질 티켓(오래 무진척). */
function stuckTicket(id: string, status: TaskStatus): Task {
  return task({
    id,
    status,
    claimedBy: "ghost-agent",
    claimedAt: new Date(NOW - 120 * MINUTE),
    updatedAt: new Date(NOW - 120 * MINUTE),
  });
}

function mount() {
  return render(createElement(KanbanBoard));
}

function column(status: TaskStatus): HTMLElement {
  const found = screen
    .getAllByTestId("kanban-column")
    .find((el) => el.dataset.columnStatus === status);
  if (!found) throw new Error(`column ${status} not rendered`);
  return found;
}

beforeEach(() => {
  useLocaleStore.setState({ locale: "ko" });
  stores.tasks = [];
  stores.agents = [];
  stores.agentsHydrated = true;
  stores.agentsProjectId = "p1";
  resetAgentTokenObservations();
  try {
    localStorage.clear();
  } catch {
    /* jsdom without storage — 기본값(접힘)이 그대로 쓰인다 */
  }
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("① 접힌 정체 레인도 무엇이 몇 건인지 보여준다", () => {
  it("BLOCKED·FAILED·STALE 세 그룹이 접힌 상태에서 전부 발견 가능하다", () => {
    stores.tasks = [
      task({ id: "blocked-1", status: "BLOCKED" }),
      task({ id: "failed-1", status: "FAILED" }),
      task({ id: "failed-2", status: "FAILED" }),
      stuckTicket("stale-1", "IN_PROGRESS"),
    ];
    mount();

    const lane = screen.getByTestId("stuck-lane");
    // 접혀 있다 — 기본값.
    const header = lane.querySelector("button");
    expect(header?.getAttribute("aria-expanded")).toBe("false");

    // 총계뿐 아니라 그룹별 건수가 보인다.
    expect(
      screen.getByTestId("stuck-collapsed-count-BLOCKED").textContent,
    ).toContain("1");
    expect(
      screen.getByTestId("stuck-collapsed-count-FAILED").textContent,
    ).toContain("2");
    expect(
      screen.getByTestId("stuck-collapsed-count-STALE").textContent,
    ).toContain("1");

    // 스크린리더도 같은 사실을 듣는다.
    const label = header?.getAttribute("aria-label") ?? "";
    expect(label).toContain("(4)");
    expect(label).toContain("BLOCKED 1");
    expect(label).toContain("FAILED 2");
    expect(label).toContain("STALE 1");
  });

  it("0건 그룹은 배지를 그리지 않는다 — 없는 것을 세는 배지는 소음이다", () => {
    stores.tasks = [task({ id: "failed-1", status: "FAILED" })];
    mount();

    expect(screen.getByTestId("stuck-collapsed-count-FAILED")).toBeTruthy();
    expect(screen.queryByTestId("stuck-collapsed-count-BLOCKED")).toBeNull();
    expect(screen.queryByTestId("stuck-collapsed-count-STALE")).toBeNull();
  });
});

describe("② 정체로 빠진 티켓은 원래 컬럼에 흔적을 남긴다", () => {
  it("CLAIMED·IN_PROGRESS 컬럼이 각각 자기 건수를 보여준다", () => {
    stores.tasks = [
      stuckTicket("claimed-stale", "CLAIMED"),
      stuckTicket("running-stale-1", "IN_PROGRESS"),
      stuckTicket("running-stale-2", "IN_PROGRESS"),
      task({ id: "todo-1", status: "TODO" }),
    ];
    mount();

    // 카드는 컬럼에 없다(정체 판정) — 그러나 사라지지는 않았다.
    expect(column("IN_PROGRESS").textContent).toContain("2건 정체 레인");
    expect(column("CLAIMED").textContent).toContain("1건 정체 레인");
    // 정체가 없는 컬럼엔 흔적도 없다.
    expect(
      column("TODO").querySelector('[data-testid="column-stuck-away"]'),
    ).toBeNull();
  });

  it("BLOCKED/FAILED 는 활성 컬럼이 아니므로 어느 컬럼에도 흔적을 만들지 않는다", () => {
    stores.tasks = [
      task({ id: "blocked-1", status: "BLOCKED" }),
      task({ id: "failed-1", status: "FAILED" }),
    ];
    mount();

    expect(screen.queryAllByTestId("column-stuck-away")).toHaveLength(0);
    // 대신 접힌 레인의 그룹 배지로 발견된다.
    expect(screen.getByTestId("stuck-collapsed-count-BLOCKED")).toBeTruthy();
    expect(screen.getByTestId("stuck-collapsed-count-FAILED")).toBeTruthy();
  });
});

describe("③ 흔적을 누르면 레인이 펴져 실제 카드에 도달한다", () => {
  it("컬럼 흔적 → 레인 펼침 → 카드 표시", () => {
    stores.tasks = [stuckTicket("running-stale", "IN_PROGRESS")];
    mount();

    // 펴기 전엔 제목이 어디에도 없다 — 이것이 리포트의 "사라짐" 이다.
    expect(screen.queryByText("running-stale")).toBeNull();

    fireEvent.click(screen.getByTestId("column-stuck-away"));

    const header = screen.getByTestId("stuck-lane").querySelector("button");
    expect(header?.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("running-stale")).toBeTruthy();
  });
});

describe("⑤ ★살아서 일하는 티켓은 20분이 지나도 정체로 안 찍힌다 (배선 회귀)", () => {
  // 판정 로직은 tests/unit/stuckLane.test.ts 가 본다. 여기서 보는 것은 **배선**
  // 이다: agentStore 의 과금 토큰 카운터가 오르는 것을 useStuckLane 이 실제로
  // 관측해 무진척 시계에 접는가. 이 배선이 끊기면 로직이 옳아도 화면에서는
  // 여전히 카드가 사라진다.
  function quietButWorking(): Task {
    return task({
      id: "hard-worker",
      status: "IN_PROGRESS",
      priority: 5, // 가장 빡빡한 20분 임계
      claimedBy: "a-mine",
      claimedAt: new Date(NOW - 60 * MINUTE),
      updatedAt: new Date(NOW - 60 * MINUTE), // 60분째 보드 보고 없음
    });
  }

  it("보고 없이 60분이어도, 담당이 실제로 토큰을 태우고 있으면 컬럼에 남는다", () => {
    stores.agents = [agent("a-mine", { totalOutputTokens: 100 })];
    stores.agentsProjectId = "p1";
    stores.tasks = [quietButWorking()];
    const { rerender } = mount();

    // 관측 전(앱 켠 직후 기준선만 잡힌 상태)에는 종전 동작 그대로 — 정체다.
    expect(column("IN_PROGRESS").textContent).not.toContain("hard-worker");
    expect(screen.getByTestId("column-stuck-away").textContent).toContain(
      "1건 정체 레인",
    );

    // 다음 cost:update 가 도착해 카운터가 올랐다 = 모델 턴이 돌았다.
    stores.agents = [agent("a-mine", { totalOutputTokens: 4200 })];
    rerender(createElement(KanbanBoard));

    // 보드 write 는 여전히 60분째 없지만, 카드는 활성 컬럼으로 돌아온다.
    expect(column("IN_PROGRESS").textContent).toContain("hard-worker");
    expect(screen.queryAllByTestId("column-stuck-away")).toHaveLength(0);
  });

  it("카운터가 그대로면 관측이 안 생긴다 — 이 축은 무조건 면제가 아니다", () => {
    stores.agents = [agent("a-mine", { totalOutputTokens: 100 })];
    stores.agentsProjectId = "p1";
    stores.tasks = [quietButWorking()];
    const { rerender } = mount();

    stores.agents = [agent("a-mine", { totalOutputTokens: 100 })];
    rerender(createElement(KanbanBoard));

    expect(column("IN_PROGRESS").textContent).not.toContain("hard-worker");
    expect(screen.getByTestId("column-stuck-away")).toBeTruthy();
  });
});

describe("④ 다른 프로젝트의 에이전트 스냅샷이 물려 있어도 티켓을 잃지 않는다", () => {
  // agentStore 는 슬롯이 하나인데 구독자는 여럿이다. MissionDetail 은
  // mission.projectId 로 구독하므로 다른 프로젝트 미션을 한 번 열면 목록이
  // 통째로 바뀐 채 hydrated=true 로 남는다. 그 목록으로 담당을 찾으면 당연히
  // 못 찾고, 진행 중 티켓 전부가 agent-missing 으로 접힌 레인에 빨려 들어간다.
  function freshlyClaimed(id: string): Task {
    return task({
      id,
      status: "IN_PROGRESS",
      claimedBy: "a-mine",
      claimedAt: new Date(NOW - MINUTE),
      updatedAt: new Date(NOW - MINUTE),
    });
  }

  it("★교차 프로젝트 스냅샷이면 '에이전트 없음' 을 정체 근거로 쓰지 않는다", () => {
    stores.agents = [agent("a-other", { projectId: "p-other" })];
    stores.agentsProjectId = "p-other";
    stores.tasks = [freshlyClaimed("mine-1")];
    mount();

    expect(column("IN_PROGRESS").textContent).toContain("mine-1");
    expect(screen.queryAllByTestId("column-stuck-away")).toHaveLength(0);
  });

  it("같은 프로젝트 스냅샷이고 담당이 정말 없으면 종전대로 정체로 잡는다", () => {
    stores.agents = [agent("a-other")];
    stores.agentsProjectId = "p1";
    stores.tasks = [freshlyClaimed("mine-1")];
    mount();

    expect(column("IN_PROGRESS").textContent).not.toContain("mine-1");
    expect(screen.getByTestId("column-stuck-away").textContent).toContain(
      "1건 정체 레인",
    );
  });

  it("담당이 목록에 있으면(같은 프로젝트) 그대로 활성 컬럼에 남는다", () => {
    stores.agents = [agent("a-mine")];
    stores.agentsProjectId = "p1";
    stores.tasks = [freshlyClaimed("mine-1")];
    mount();

    expect(column("IN_PROGRESS").textContent).toContain("mine-1");
  });
});
