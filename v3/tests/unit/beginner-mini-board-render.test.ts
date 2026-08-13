/**
 * @vitest-environment jsdom
 *
 * ★비기너 미니 보드 + 미니 에이전트 패널 — 실제 DOM 렌더 회귀 테스트.
 *
 * 순수 규칙(`groupBeginnerBoard`)만 고정하면 "스토어 → 그룹핑 → 재사용하는
 * KanbanColumn/TeamSummary" 배선이 끊겨도 못 잡는다. 그리고 이 화면의 계약은
 * 세 방향이다:
 *
 *   ① 티켓이 움직이는 게 **보여야** 한다 (그게 S4 dead-end 의 해결책)
 *   ② ★그 카드가 **눌려야** 한다 (시연 피드백 ② — 안 눌리는 보드는 그림이다)
 *   ③ 브랜치 이름·모델명은 **안 보여야** 한다 (비기너 추상화 수준)
 *   ④ ★그 카드에서 **나갈 수** 있어야 한다 — 결과(바뀐 코드)와 사람(에이전트).
 *      ②와 같은 이유다: 정보를 줄이는 것과 갈 곳을 없애는 것은 다른 일이고,
 *      후자를 하면 보드는 다시 그림이 된다.
 *
 * ③은 "안 그린다" 라서 눈으로 확인하기 가장 어렵고, compact 프롭이 나중에
 * 누락되면 조용히 깨진다 — 그래서 부재를 여기서 못박는다. ④는 반대로 "새 로직을
 * 만들지 않는다" 가 계약이라, 엑스퍼트 카드와 **같은 액션**(`viewWorktree`)이
 * 같은 인자로 불리는지를 본다.
 *
 * ★"누가 뭐하나"(에이전트)는 라이브 스트립을 떠나 `BeginnerAgentsPane`(하단
 * 2분할의 오른쪽 열)으로 갔다. 그래서 아래 에이전트 describe 는 스트립이 아니라
 * 그 패널을 마운트한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { Agent, AgentStatus } from "../../src/types/agent";
import type { Task, TaskStatus } from "../../src/types/task";

const stores = vi.hoisted(() => ({
  tasks: [] as unknown[],
  agents: [] as unknown[],
}));

vi.mock("../../src/stores/taskStore", () => ({
  useTaskStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ tasks: stores.tasks }),
  ),
}));

vi.mock("../../src/stores/agentStore", () => ({
  useAgentStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ agents: stores.agents }),
  ),
}));

// TaskCard 가 무는 나머지 스토어들. compact 경로는 이들을 **읽기만** 하고
// 아무것도 그리지 않는다 — 워크트리 목록을 하나 심어 두고, 그럼에도 브랜치
// 이름이 화면에 안 나오는 것을 아래에서 확인한다.
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

// TaskCard 는 FlowKanbanLink 를 통해 firestore 를 끌어온다(compact 에서는 절대
// 렌더되지 않지만 import 는 평가된다). 실 Firebase 초기화는 jsdom 에서 터진다.
vi.mock("../../src/services/firestore", () => ({
  subscribeToDocument: vi.fn(() => () => {}),
}));

const ensureFreshSpy = vi.hoisted(() => vi.fn(() => Promise.resolve()));

// ★"바뀐 코드 보기" 는 새 액션을 만들지 않는다 — 엑스퍼트 카드와 같은
// `viewWorktree` 를 부른다. 실물은 스토어 넷과 IPC 를 건드리므로 여기선 스파이.
const viewWorktreeSpy = vi.hoisted(() => vi.fn());
vi.mock("../../src/lib/viewWorktree", () => ({
  viewWorktree: viewWorktreeSpy,
}));

import { BeginnerAgentsPane } from "../../src/components/beginner/BeginnerAgentsPane";
import { BeginnerLiveStrip } from "../../src/components/beginner/BeginnerLiveStrip";
import { BEGINNER_COLUMN_LIMIT } from "../../src/lib/beginnerMode";
import { useLocaleStore } from "../../src/lib/i18n";
import { ko } from "../../src/locales/ko";

function task(id: string, status: TaskStatus, title: string): Task {
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
    claimedAt: null,
    scope: [],
    comment: "",
    prUrl: status === "REVIEW" ? "https://github.com/x/y/pull/1" : "",
    hasPmFeedback: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
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
  // jsdom 의 navigator.language 는 en 이라 문구 단정이 로케일에 흔들린다.
  useLocaleStore.setState({ locale: "ko" });
  stores.tasks = [];
  stores.agents = [];
  ensureFreshSpy.mockClear();
  viewWorktreeSpy.mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(10_000));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("비기너 미니 보드", () => {
  it("티켓 흐름을 3컬럼(할 일/진행 중/완료)으로 그린다", () => {
    stores.tasks = [
      task("t1", "TODO", "리드미 읽기"),
      task("t2", "IN_PROGRESS", "가이드 초안"),
      task("t3", "REVIEW", "가이드 검토"),
      task("t4", "DONE", "폴더 구조 설명"),
    ];
    mount();

    const columns = screen.getAllByTestId("beginner-mini-column");
    expect(columns).toHaveLength(3);
    expect(columns.map((c) => c.dataset.columnStatus)).toEqual([
      "TODO",
      "IN_PROGRESS",
      "DONE",
    ]);
    expect(columns.map((c) => c.textContent)).toEqual([
      expect.stringContaining(ko["beginner.board.todo"]),
      expect.stringContaining(ko["beginner.board.doing"]),
      expect.stringContaining(ko["beginner.board.done"]),
    ]);

    // REVIEW 는 "진행 중" 으로 접힌다 → 가운데 칸에 2건.
    expect(columns[1].textContent).toContain("가이드 초안");
    expect(columns[1].textContent).toContain("가이드 검토");
    expect(screen.getAllByTestId("beginner-mini-task")).toHaveLength(4);
  });

  it("★티켓이 아직 없으면 빈 보드를 띄우지 않는다 (헤드라인이 그 국면의 답)", () => {
    mount();
    expect(screen.queryByTestId("beginner-mini-board")).toBeNull();
    expect(screen.getByTestId("beginner-live-strip")).toBeTruthy();
  });

  it("★막힌 티켓은 사라지지 않고 '진행 중' 에 막힘 표시로 남는다", () => {
    stores.tasks = [task("t-blocked", "BLOCKED", "권한 필요")];
    mount();

    const doing = screen.getAllByTestId("beginner-mini-column")[1];
    expect(doing.textContent).toContain("권한 필요");
    expect(doing.textContent).toContain(ko["board.taskCard.stuck"]);
  });

  it("컬럼 배지는 자른 뒤가 아니라 진짜 총 개수를 보여 준다", () => {
    stores.tasks = Array.from({ length: BEGINNER_COLUMN_LIMIT + 2 }, (_, i) =>
      task(`t${i}`, "TODO", `할 일 ${i}`),
    );
    mount();

    const todo = screen.getAllByTestId("beginner-mini-column")[0];
    expect(todo.textContent).toContain(String(BEGINNER_COLUMN_LIMIT + 2));
    expect(screen.getAllByTestId("beginner-mini-task")).toHaveLength(
      BEGINNER_COLUMN_LIMIT,
    );
    expect(todo.textContent).toContain("+2");
  });

  it("★복잡성은 여전히 숨긴다 — 워크트리 브랜치·모델명·PR 칩이 없다", () => {
    stores.tasks = [
      task("t-blocked", "BLOCKED", "권한 필요"),
      task("t-review", "REVIEW", "가이드 검토"),
    ];
    stores.agents = [agent("agent-1", "working")];
    const { container } = mount();

    expect(container.textContent).not.toContain("marblo/task-blocked");
    expect(container.textContent).not.toContain("claude-fable-5");
    expect(container.textContent).not.toContain("PR");
    // 워크트리 목록 갱신 IPC 도 태우지 않는다 (미니 카드가 마운트될 때마다
    // worktree:list 를 부를 이유가 없다).
    expect(ensureFreshSpy).not.toHaveBeenCalled();
  });

  it("진입을 켜지 않은 호스트에는 두 버튼이 아예 없다 (종전 동작)", () => {
    stores.tasks = [task("t-blocked", "BLOCKED", "권한 필요")];
    stores.agents = [agent("agent-1", "working")];
    mount({ onTaskClick: vi.fn() });

    expect(screen.queryByTestId("beginner-mini-task-diff")).toBeNull();
    expect(screen.queryByTestId("beginner-mini-task-agent")).toBeNull();
  });

  // ── ★클릭커블(시연 피드백 ②) ────────────────────────────────────────────
  it("★카드를 누르면 그 티켓이 상세로 올라온다", () => {
    stores.tasks = [
      task("t1", "TODO", "리드미 읽기"),
      task("t2", "IN_PROGRESS", "가이드 초안"),
    ];
    const onTaskClick = vi.fn();
    mount({ onTaskClick });

    fireEvent.click(screen.getAllByTestId("beginner-mini-task")[1]);
    expect(onTaskClick).toHaveBeenCalledTimes(1);
    expect(onTaskClick.mock.calls[0][0].id).toBe("t2");
  });

  it("핸들러가 없으면 카드는 눌리지 않는다 — 커서도 붙지 않는다", () => {
    stores.tasks = [task("t1", "TODO", "리드미 읽기")];
    mount();
    // 클릭이 예외를 던지지 않는 것만으론 부족하다: 누를 수 있는 것처럼 **보이면**
    // 안 된다(눌러도 아무 일 없는 카드가 바로 그 시연 피드백의 자리다).
    expect(screen.getByTestId("beginner-mini-task").className).not.toContain(
      "cursor-pointer",
    );
  });
});

// ── ★카드의 두 진입(결과 / 사람) ─────────────────────────────────────────
describe("비기너 미니 보드 — 바뀐 코드 / 담당 에이전트 진입", () => {
  it("★'바뀐 코드 보기' 는 엑스퍼트 카드와 **같은** 액션을 같은 인자로 부른다", () => {
    stores.tasks = [task("t-blocked", "IN_PROGRESS", "권한 필요")];
    stores.agents = [agent("agent-1", "working")];
    mount({ showWorktreeDiff: true, onTaskClick: vi.fn() });

    fireEvent.click(screen.getByTestId("beginner-mini-task-diff"));
    expect(viewWorktreeSpy).toHaveBeenCalledTimes(1);
    const [worktree, options] = viewWorktreeSpy.mock.calls[0];
    // 워크트리 매칭도 담당 에이전트 해석도 공용 헬퍼(findTaskWorktree /
    // resolveTaskAgentId)를 그대로 탄다 — 심플 전용 규칙은 없다.
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
    // 진입을 켠 호스트만 워크트리 목록 신선도를 챙긴다 — 버튼의 존재 여부가
    // 곧 워크트리 매칭이라, 낡은 목록은 버튼을 조용히 지운다.
    expect(ensureFreshSpy).toHaveBeenCalled();
  });

  it("워크트리가 없는 티켓에는 버튼을 만들지 않는다 (막다른 버튼 금지)", () => {
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
    // 카드도 눌리는 표면이라, 칩이 클릭을 삼키지 않으면 상세가 함께 뜬다.
    expect(onTaskClick).not.toHaveBeenCalled();
  });

  it("diff 버튼도 카드 클릭을 삼킨다 (두 목적지가 겹치지 않는다)", () => {
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
    // 0 인 상태는 지운다 — 아무 일도 없는데 "오류" 항목이 보이면 안 된다.
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
    // 맡은 게 없는 에이전트는 티켓 줄 대신 그 사실을 말한다(빈칸 금지).
    expect(rows[1].textContent).toContain(ko["beginner.agents.noTask"]);
  });

  it("★티켓 줄을 누르면 미니 보드 카드와 **같은** 상세가 열린다", () => {
    stores.tasks = [task("t1", "IN_PROGRESS", "가이드 초안")];
    stores.agents = [{ ...agent("a1", "working"), currentTaskId: "t1" }];
    const onTaskClick = vi.fn();
    mountAgents({ onTaskClick });

    fireEvent.click(screen.getByTestId("beginner-agent-task"));
    expect(onTaskClick.mock.calls[0][0].id).toBe("t1");
  });

  it("★모델명은 여기서도 안 보인다 (어드밴스드 에이전트 탭과의 경계)", () => {
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

  it("전송 중이면 다시 보내기가 잠긴다 (중복 전송 가드)", () => {
    vi.setSystemTime(new Date(200_000));
    mount({ sentAt: 1, resending: true });

    const button = screen.getByTestId(
      "beginner-live-resend",
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
