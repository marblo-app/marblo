/**
 * @vitest-environment jsdom
 *
 * ★비기너 상단 보드 — 마블로 KanbanBoard(5단계+그래프) 재사용 회귀.
 *
 * 종전 3열 세로 미니보드(할 일/진행/완료)는 제거됐다. 계약:
 *   ① 티켓이 5단계(TODO·CLAIMED·IN_PROGRESS·REVIEW·DONE)로 **보여야** 한다
 *   ② 칸반↔그래프 토글이 있다
 *   ③ 카드는 compact 이고 눌리면 상세로 간다
 *   ④ 브랜치 이름·모델명은 안 보인다
 *   ⑤ "바뀐 코드"·에이전트 칩 진입은 엑스퍼트와 같은 액션
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { Agent, AgentStatus } from "../../src/types/agent";
import type { Task, TaskStatus } from "../../src/types/task";

const stores = vi.hoisted(() => ({
  tasks: [] as unknown[],
  agents: [] as unknown[],
  agentsHydrated: true,
  // 신규 유저는 폴더 선택 전에도 프로젝트 스토어가 비어 있다. 이 상태에서
  // KanbanBoard가 일반 모드의 "프로젝트를 선택하세요" 조기 return으로 빠지면
  // LiveStrip DOM은 있어도 보드가 보이지 않는다.
  currentProject: {
    id: "p1",
    name: "Demo",
    ownerId: "u1",
    folderPath: "/tmp/demo",
  } as {
    id: string;
    name: string;
    ownerId: string;
    folderPath: string;
  } | null,
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
    selector({ agents: stores.agents, hydrated: stores.agentsHydrated }),
  ),
}));

vi.mock("../../src/stores/projectStore", () => ({
  useProjectStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      currentProject: stores.currentProject,
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

vi.mock("../../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { uid: "u1" } }),
}));

vi.mock("../../src/stores/worktreeStore", () => ({
  useWorktreeStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      worktrees: [
        {
          path: "/tmp/wt/task-blocked",
          branch: "marblo/task-blocked",
          taskId: "t-blocked",
        },
      ],
      ensureFresh: ensureFreshSpy,
      statusPill: () => ({ tone: "ready", icon: "✓", label: "ready" }),
    }),
  ),
}));

vi.mock("../../src/stores/editorStore", () => ({
  useEditorStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ rootPath: "/tmp/repo" }),
  ),
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
  TaskGraphView: ({
    tasks,
    onSelect,
  }: {
    tasks: Task[];
    onSelect: (t: Task) => void;
  }) =>
    createElement(
      "div",
      { "data-testid": "task-graph-view" },
      tasks.map((task) =>
        createElement(
          "button",
          {
            key: task.id,
            type: "button",
            "data-testid": `graph-node-${task.id}`,
            onClick: () => onSelect(task),
          },
          task.title,
        ),
      ),
    ),
}));

const ensureFreshSpy = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const viewWorktreeSpy = vi.hoisted(() => vi.fn());
vi.mock("../../src/lib/viewWorktree", () => ({
  viewWorktree: viewWorktreeSpy,
}));

import { BeginnerAgentsPane } from "../../src/components/beginner/BeginnerAgentsPane";
import { BeginnerLiveStrip } from "../../src/components/beginner/BeginnerLiveStrip";
import { useLocaleStore } from "../../src/lib/i18n";
import { ko } from "../../src/locales/ko";

function task(id: string, status: TaskStatus, title: string): Task {
  // ★최근 시각 — createdAt=epoch 이면 useStuckLane 이 STALE 로 보내
  // 활성 5열에서 카드가 사라진다(마블로 Board 와 같은 정체 판정).
  const now = new Date();
  return {
    id,
    projectId: "p1",
    contextId: "",
    title,
    description: "",
    status,
    role: "frontend",
    priority: 3,
    dependsOn: [],
    dependsOnCompleted: true,
    claimedBy: status === "TODO" ? null : "agent-1",
    claimedAt: status === "TODO" ? null : now,
    scope: [],
    comment: "",
    prUrl: status === "REVIEW" ? "https://github.com/x/y/pull/1" : "",
    hasPmFeedback: false,
    createdAt: now,
    updatedAt: now,
  };
}

function agent(id: string, status: AgentStatus): Agent {
  return {
    id,
    projectId: "p1",
    ownerId: "u1",
    name: id,
    model: "claude",
    spawnedModel: "claude-fable-5",
    role: "frontend",
    status,
    currentTaskId: null,
    command: "claude",
    skillFile: "",
    createdAt: new Date(0),
  };
}

function mount(props?: Partial<Parameters<typeof BeginnerLiveStrip>[0]>) {
  return render(
    createElement(BeginnerLiveStrip, {
      sentAt: 1,
      onResend: () => {},
      resending: false,
      ...props,
    }),
  );
}

function mountAgents(
  props?: Partial<Parameters<typeof BeginnerAgentsPane>[0]>,
) {
  return render(
    createElement(BeginnerAgentsPane, {
      agents: stores.agents as Agent[],
      tasks: stores.tasks as Task[],
      ...props,
    }),
  );
}

beforeEach(() => {
  useLocaleStore.setState({ locale: "ko" });
  stores.tasks = [];
  stores.agents = [];
  stores.agentsHydrated = true;
  stores.currentProject = {
    id: "p1",
    name: "Demo",
    ownerId: "u1",
    folderPath: "/tmp/demo",
  };
  ensureFreshSpy.mockClear();
  viewWorktreeSpy.mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(10_000));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("비기너 상단 — 마블로 5단계 칸반", () => {
  it("티켓 흐름을 5컬럼(TODO/CLAIMED/IN_PROGRESS/REVIEW/DONE)으로 그린다", () => {
    stores.agents = [agent("agent-1", "working")];
    stores.tasks = [
      task("t1", "TODO", "리드미 읽기"),
      task("t2", "CLAIMED", "담당 잡힘"),
      task("t3", "IN_PROGRESS", "가이드 초안"),
      task("t4", "REVIEW", "가이드 검토"),
      task("t5", "DONE", "폴더 구조 설명"),
    ];
    mount();

    expect(screen.getByTestId("beginner-marblo-board")).toBeTruthy();
    expect(screen.getByTestId("beginner-mini-board")).toBeTruthy();

    const columns = screen.getAllByTestId("kanban-column");
    expect(columns).toHaveLength(5);
    expect(columns.map((c) => c.dataset.columnStatus)).toEqual([
      "TODO",
      "CLAIMED",
      "IN_PROGRESS",
      "REVIEW",
      "DONE",
    ]);

    expect(screen.getByText("리드미 읽기")).toBeTruthy();
    expect(screen.getByText("담당 잡힘")).toBeTruthy();
    expect(screen.getByText("가이드 초안")).toBeTruthy();
    expect(screen.getByText("가이드 검토")).toBeTruthy();
    expect(screen.getByText("폴더 구조 설명")).toBeTruthy();
    expect(screen.getAllByTestId("beginner-mini-task")).toHaveLength(5);
  });

  it("칸반↔그래프 전환이 있다", () => {
    stores.tasks = [task("t1", "TODO", "리드미 읽기")];
    mount();

    expect(screen.getByTestId("board-view-kanban")).toBeTruthy();
    expect(screen.getByTestId("board-view-graph")).toBeTruthy();

    fireEvent.click(screen.getByTestId("board-view-graph"));
    expect(screen.getByTestId("task-graph-view")).toBeTruthy();
    expect(screen.queryAllByTestId("kanban-column")).toHaveLength(0);

    fireEvent.click(screen.getByTestId("board-view-kanban"));
    expect(screen.getAllByTestId("kanban-column")).toHaveLength(5);
  });

  it("idle 이 아니면 티켓 0개여도 5열 보드를 띄운다 (마블로와 동일)", () => {
    mount({ sentAt: 1 });
    expect(screen.getByTestId("beginner-live-strip")).toBeTruthy();
    expect(screen.getByTestId("beginner-marblo-board")).toBeTruthy();
    expect(screen.getAllByTestId("kanban-column")).toHaveLength(5);
  });

  it("티켓 0개 첫 화면(idle)에도 빈 5단계 보드를 보여 준다", () => {
    mount({ sentAt: 0 });
    expect(screen.getByTestId("beginner-live-strip")).toBeTruthy();
    expect(screen.getByTestId("beginner-live-strip").dataset.phase).toBe("idle");
    expect(screen.getByTestId("beginner-marblo-board")).toBeTruthy();
    const columns = screen.getAllByTestId("kanban-column");
    expect(columns).toHaveLength(5);
    expect(columns.map((column) => column.querySelector("span")?.textContent)).toEqual([
      "TODO",
      "CLAIMED",
      "IN PROGRESS",
      "REVIEW",
      "DONE",
    ]);
  });

  it("★신규 유저 첫 실행(프로젝트/폴더 없음)에도 빈 5단계 보드를 그린다", () => {
    stores.currentProject = null;

    mount({ sentAt: 0 });

    expect(screen.getByTestId("beginner-live-strip")).toBeTruthy();
    expect(screen.getByTestId("beginner-marblo-board")).toBeTruthy();
    expect(screen.getAllByTestId("kanban-column")).toHaveLength(5);
  });

  it("★막힌 티켓은 정체 레인에 남는다 (사라지지 않음)", () => {
    stores.tasks = [task("t-blocked", "BLOCKED", "권한 필요")];
    mount();

    const lane = screen.getByTestId("stuck-lane");
    expect(lane).toBeTruthy();
    // 접혀 있어도 건수는 보인다 — 펴면 제목도.
    expect(lane.textContent).toMatch(/1/);
    const toggle = lane.querySelector("button");
    if (toggle) fireEvent.click(toggle);
    expect(screen.getByText("권한 필요")).toBeTruthy();
    // 활성 5열에는 안 들어간다 — 마블로 Board 와 같은 정체 레인.
    const columns = screen.getAllByTestId("kanban-column");
    for (const col of columns) {
      expect(col.textContent).not.toContain("권한 필요");
    }
  });

  it("★복잡성은 숨긴다 — 워크트리 브랜치·모델명·PR 칩이 없다", () => {
    stores.agents = [agent("agent-1", "working")];
    stores.tasks = [
      task("t-blocked", "IN_PROGRESS", "권한 필요"),
      task("t-review", "REVIEW", "가이드 검토"),
    ];
    const { container } = mount();

    expect(container.textContent).not.toContain("marblo/task-blocked");
    expect(container.textContent).not.toContain("claude-fable-5");
    // compact 카드는 PR 칩을 그리지 않는다(풀 TaskCard 의 "PR" 배지).
    expect(
      container.querySelector('[data-testid="beginner-mini-task"]')?.textContent,
    ).not.toMatch(/\bPR\b/);
  });

  it("진입을 켜지 않은 호스트에는 두 버튼이 아예 없다", () => {
    stores.tasks = [task("t-blocked", "IN_PROGRESS", "권한 필요")];
    stores.agents = [agent("agent-1", "working")];
    mount({ onTaskClick: vi.fn() });

    expect(screen.queryByTestId("beginner-mini-task-diff")).toBeNull();
    expect(screen.queryByTestId("beginner-mini-task-agent")).toBeNull();
  });

  it("★카드를 누르면 그 티켓이 상세로 올라온다", () => {
    stores.agents = [agent("agent-1", "working")];
    stores.tasks = [
      task("t1", "TODO", "리드미 읽기"),
      task("t2", "IN_PROGRESS", "가이드 초안"),
    ];
    const onTaskClick = vi.fn();
    mount({ onTaskClick });

    fireEvent.click(screen.getByText("가이드 초안"));
    expect(onTaskClick).toHaveBeenCalledTimes(1);
    expect(onTaskClick.mock.calls[0][0].id).toBe("t2");
  });

  it("핸들러가 없으면 카드는 눌리지 않는다 — 커서도 붙지 않는다", () => {
    stores.tasks = [task("t1", "TODO", "리드미 읽기")];
    mount();
    expect(screen.getByTestId("beginner-mini-task").className).not.toContain(
      "cursor-pointer",
    );
  });

  it("simplified 툴바에 New Task / AI 분해가 없다", () => {
    stores.tasks = [task("t1", "TODO", "리드미 읽기")];
    const { container } = mount();
    expect(container.textContent).not.toContain("New Task");
    expect(container.textContent).not.toContain(ko["board.aiBreakdown"]);
  });
});

describe("비기너 보드 — 바뀐 코드 / 담당 에이전트 진입", () => {
  it("★'바뀐 코드 보기' 는 엑스퍼트 카드와 **같은** 액션을 같은 인자로 부른다", () => {
    stores.tasks = [task("t-blocked", "IN_PROGRESS", "권한 필요")];
    stores.agents = [agent("agent-1", "working")];
    mount({ showWorktreeDiff: true, onTaskClick: vi.fn() });

    fireEvent.click(screen.getByTestId("beginner-mini-task-diff"));
    expect(viewWorktreeSpy).toHaveBeenCalledTimes(1);
    const [worktree, options] = viewWorktreeSpy.mock.calls[0];
    expect(worktree.branch).toBe("marblo/task-blocked");
    expect(options.focusAgentId).toBe("agent-1");
  });

  it("★브랜치 이름은 그래도 안 보인다 — 버튼은 결과로만 말한다", () => {
    stores.tasks = [task("t-blocked", "IN_PROGRESS", "권한 필요")];
    stores.agents = [agent("agent-1", "working")];
    const { container } = mount({ showWorktreeDiff: true });

    expect(screen.getByTestId("beginner-mini-task-diff").textContent).toContain(
      ko["beginner.board.viewDiff"],
    );
    expect(container.textContent).not.toContain("marblo/task-blocked");
    expect(ensureFreshSpy).toHaveBeenCalled();
  });

  it("워크트리가 없는 티켓에는 버튼을 만들지 않는다", () => {
    stores.tasks = [task("t-none", "IN_PROGRESS", "아직 코드 없음")];
    stores.agents = [agent("agent-1", "working")];
    mount({ showWorktreeDiff: true });

    expect(screen.queryByTestId("beginner-mini-task-diff")).toBeNull();
  });

  it("★에이전트 칩을 누르면 그 에이전트로 간다 — 티켓 상세는 열리지 않는다", () => {
    stores.tasks = [task("t-blocked", "IN_PROGRESS", "권한 필요")];
    stores.agents = [agent("agent-1", "working")];
    const onAgentClick = vi.fn();
    const onTaskClick = vi.fn();
    mount({ onAgentClick, onTaskClick });

    const chip = screen.getByTestId("beginner-mini-task-agent");
    expect(chip.textContent).toContain("agent-1");
    fireEvent.click(chip);
    expect(onAgentClick).toHaveBeenCalledTimes(1);
    expect(onAgentClick.mock.calls[0][0].id).toBe("agent-1");
    expect(onTaskClick).not.toHaveBeenCalled();
  });

  it("diff 버튼도 카드 클릭을 삼킨다", () => {
    stores.tasks = [task("t-blocked", "IN_PROGRESS", "권한 필요")];
    stores.agents = [agent("agent-1", "working")];
    const onTaskClick = vi.fn();
    mount({ showWorktreeDiff: true, onTaskClick });

    fireEvent.click(screen.getByTestId("beginner-mini-task-diff"));
    expect(onTaskClick).not.toHaveBeenCalled();
  });

  it("아직 아무도 안 붙은 티켓엔 에이전트 칩이 없다", () => {
    stores.tasks = [task("t1", "TODO", "리드미 읽기")];
    stores.agents = [agent("agent-1", "idle")];
    mount({ onAgentClick: vi.fn() });

    expect(screen.queryByTestId("beginner-mini-task-agent")).toBeNull();
  });
});

describe("비기너 에이전트 패널 (하단 2분할 오른쪽)", () => {
  it("에이전트 수와 상태를 요약한다", () => {
    stores.tasks = [task("t1", "IN_PROGRESS", "가이드 초안")];
    stores.agents = [agent("a1", "working"), agent("a2", "idle")];
    mountAgents();

    const mini = screen.getByTestId("beginner-mini-agents");
    expect(mini.textContent).toContain("2");
    expect(mini.textContent).toContain(ko["agents.status.working"]);
    expect(mini.textContent).toContain(ko["agents.status.idle"]);
    expect(mini.textContent).not.toContain(ko["agents.status.error"]);
  });

  it("★누가 무슨 티켓에 붙어 있는지 한 줄로 말한다", () => {
    stores.tasks = [
      task("t1", "IN_PROGRESS", "가이드 초안"),
      task("t2", "TODO", "리드미 읽기"),
    ];
    stores.agents = [
      { ...agent("a1", "working"), currentTaskId: "t1" },
      agent("a2", "idle"),
    ];
    mountAgents();

    const rows = screen.getAllByTestId("beginner-agent-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("가이드 초안");
    expect(rows[1].textContent).toContain(ko["beginner.agents.noTask"]);
  });

  it("★티켓 줄을 누르면 보드 카드와 **같은** 상세가 열린다", () => {
    stores.tasks = [task("t1", "IN_PROGRESS", "가이드 초안")];
    stores.agents = [{ ...agent("a1", "working"), currentTaskId: "t1" }];
    const onTaskClick = vi.fn();
    mountAgents({ onTaskClick });

    fireEvent.click(screen.getByTestId("beginner-agent-task"));
    expect(onTaskClick.mock.calls[0][0].id).toBe("t1");
  });

  it("★모델명은 여기서도 안 보인다", () => {
    stores.tasks = [task("t1", "IN_PROGRESS", "가이드 초안")];
    stores.agents = [{ ...agent("a1", "working"), currentTaskId: "t1" }];
    const { container } = mountAgents();

    expect(container.textContent).not.toContain("claude-fable-5");
    expect(container.textContent).not.toContain("claude");
  });

  it("에이전트가 아직 없으면 요약 대신 다음 행동을 말한다", () => {
    stores.tasks = [task("t1", "TODO", "리드미 읽기")];
    stores.agents = [];
    mountAgents();

    expect(screen.queryByTestId("beginner-mini-agents")).toBeNull();
    expect(screen.getByTestId("beginner-agents-empty")).toBeTruthy();
  });
});

describe("S4 dead-end 안내는 그대로", () => {
  it("90초 넘게 티켓이 없으면 막힘 안내 + 다시 보내기가 뜬다", () => {
    vi.setSystemTime(new Date(200_000));
    mount({ sentAt: 1 });

    expect(screen.getByTestId("beginner-live-strip").dataset.phase).toBe(
      "stalled",
    );
    expect(screen.getByTestId("beginner-live-resend")).toBeTruthy();
  });

  it("전송 중이면 다시 보내기가 잠긴다", () => {
    vi.setSystemTime(new Date(200_000));
    mount({ sentAt: 1, resending: true });

    const button = screen.getByTestId(
      "beginner-live-resend",
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
