/**
 * @vitest-environment jsdom
 *
 * ★비기너 셸 배선 — "눌렀을 때 무엇이 열리는가" 의 회귀 테스트.
 *
 * 컴포넌트별 테스트는 각자 자기 콜백이 불렸는지까지만 본다(`onTaskClick` 이
 * 불렸다 / `onAgentClick` 이 불렸다). 그런데 재시연에서 사장님이 보신 건 그
 * 다음이다 — **그래서 화면에 무엇이 떴는가.** 콜백이 엉뚱한 곳에 물려 있으면
 * 각 유닛테스트는 전부 초록인 채로 화면만 틀린다.
 *
 * 그래서 여기서는 셸이 하는 배선을 재현한 하네스를 올리고, **DOM 에 뜬 것**을
 * 본다. 셸 전체(`BeginnerShell`)를 마운트하지 않는 이유는 그것이 오케 PTY·CLI
 * 프로브·라이프사이클 훅을 통째로 끌고 오기 때문이다 — 여기서 검증하려는 건 그
 * 배선이지 부팅이 아니다.
 *
 * ★단, 하네스가 셸의 로직을 **베끼지는 않는다.** 종전 이 파일은 선택 상태
 * (`openTaskId` → `tasks.find`)를 손으로 복사해 들고 있었는데, 그러면 복사본이
 * 맞는 한 테스트는 초록이고 정작 셸에서만 어긋나는 결함은 못 잡는다. 실제로
 * #880 이 이 테스트를 깔았음에도 프리뷰 시연에서 같은 지문이 다시 나왔다. 이제
 * 셸과 하네스가 **같은 훅**(`useBeginnerDetail`)을 부른다.
 *
 * 못박는 계약:
 *   ① 미니 보드 카드 클릭 → **티켓 상세 모달** (프리필만 되고 마는 게 아니다)
 *   ② ★구독 스냅샷에 **없는** 데모/프리뷰 티켓을 눌러도 모달이 뜬다
 *   ③ 에이전트 행 클릭 → **그 에이전트의 터미널**
 *   ④ 두 모달은 겹치지 않는다
 *   ⑤ 오케가 첫 마디를 받으면 상단 컴포저는 접힌다(대화 표면 하나)
 *   ⑥ 단, 티켓 상세의 "물어보기" 는 그 컴포저를 문장과 함께 되살린다
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

const stores = vi.hoisted(() => ({
  tasks: [] as unknown[],
  agents: [] as unknown[],
}));

const routeSpy = vi.hoisted(() =>
  vi.fn(async () => "local" as "local" | "queued" | "failed"),
);

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

vi.mock("../../src/stores/projectStore", () => ({
  useProjectStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ currentProject: { id: "p1", name: "demo" } }),
  ),
}));

vi.mock("../../src/services/orchestratorInstructionService", () => ({
  routeInstructionToOrchestrator: routeSpy,
}));

vi.mock("../../src/services/telemetryService", () => ({
  default: { cliSetupStep: vi.fn() },
}));

// TaskCard(compact) 가 무는 나머지 스토어들 — compact 경로는 읽기만 하고
// 아무것도 그리지 않는다.
vi.mock("../../src/stores/worktreeStore", () => ({
  useWorktreeStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      worktrees: [],
      ensureFresh: vi.fn(() => Promise.resolve()),
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

// subscribeToCollection: 티켓 상세가 진행 기록(activities)을 구독한다.
vi.mock("../../src/services/firestore", () => ({
  subscribeToDocument: vi.fn(() => () => {}),
  subscribeToCollection: vi.fn(() => () => {}),
}));

// 실 xterm 은 태우지 않는다 — 이 파일의 관심사는 "어느 세션이 열렸나" 다.
vi.mock("../../src/components/terminal/TerminalView", () => ({
  default: ({ sessionId }: { sessionId: string }) =>
    createElement("div", {
      "data-testid": "stub-terminal",
      "data-session-id": sessionId,
    }),
}));

import { BeginnerAgentsPane } from "../../src/components/beginner/BeginnerAgentsPane";
import { BeginnerAgentTerminalModal } from "../../src/components/beginner/BeginnerAgentTerminalModal";
import { BeginnerChatBar } from "../../src/components/beginner/BeginnerChatBar";
import { BeginnerLiveStrip } from "../../src/components/beginner/BeginnerLiveStrip";
import { BeginnerTaskModal } from "../../src/components/beginner/BeginnerTaskModal";
import { useBeginnerAsk } from "../../src/hooks/useBeginnerAsk";
import { useBeginnerDetail } from "../../src/hooks/useBeginnerDetail";
import { findAgentPtySessionId } from "../../src/lib/agentTerminal";
import { beginnerComposerMode } from "../../src/lib/beginnerMode";
import { useLocaleStore } from "../../src/lib/i18n";
import { ko } from "../../src/locales/ko";
import type { Agent } from "../../src/types/agent";
import type { Task, TaskStatus } from "../../src/types/task";

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
    claimedBy: status === "TODO" ? null : "a1",
    claimedAt: null,
    scope: [],
    comment: "",
    prUrl: "",
    hasPmFeedback: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

const AGENT: Agent = {
  id: "a1",
  projectId: "p1",
  ownerId: "u1",
  name: "프론트-1",
  model: "claude",
  spawnedModel: "claude-fable-5",
  role: "frontend",
  status: "working",
  currentTaskId: "t2",
  command: "claude",
  skillFile: "",
  createdAt: new Date(0),
};

const SESSIONS = [{ id: "pty-7", name: "🟣 프론트-1", isAgent: true }];

/**
 * 데모/프리뷰 티켓 — 구독 스냅샷(`stores.tasks`)에는 없고, 카드로만 존재하는 것.
 * 셸 밖에서 티켓 객체를 건네는 표면(온보딩 시연·프리뷰 보드)을 대신한다.
 */
const DEMO_TASK = task("demo-1", "TODO", "샘플: 시작 가이드 정리");

/**
 * 셸이 하는 배선 그대로. 선택 상태는 셸과 **같은 훅**을 부른다 — 여기서 로직을
 * 베끼면 베낀 쪽만 맞아도 초록이 된다(이 파일 상단 주석 참조).
 */
function Harness() {
  const tasks = stores.tasks as Task[];
  const agents = stores.agents as Agent[];
  const ask = useBeginnerAsk();
  const [draft, setDraft] = useState("");
  const {
    openTask,
    openAgent,
    openTaskDetail,
    closeTaskDetail,
    openAgentTerminal,
    closeAgentTerminal,
  } = useBeginnerDetail({ tasks, agents, projectId: "p1" });

  const composerMode = beginnerComposerMode({
    sentCount: ask.sentCount,
    totalTasks: tasks.length,
    draft,
  });

  return createElement(
    "div",
    null,
    composerMode !== "hidden" &&
      createElement(BeginnerChatBar, {
        key: "composer",
        ask,
        draft,
        onDraftChange: setDraft,
        mode: composerMode,
        onDismiss: composerMode === "followUp" ? () => setDraft("") : undefined,
      }),
    createElement(BeginnerLiveStrip, {
      key: "strip",
      sentAt: 1,
      onResend: () => {},
      resending: false,
      onTaskClick: openTaskDetail,
    }),
    createElement(BeginnerAgentsPane, {
      key: "agents",
      agents,
      tasks,
      onTaskClick: openTaskDetail,
      onAgentClick: openAgentTerminal,
    }),
    // ★스토어 밖에서 티켓 객체를 건네는 표면(데모/프리뷰 보드)의 자리. 미니
    // 보드는 구독 스냅샷만 그리므로, 그 밖에서 온 티켓의 도착지는 여기서 본다.
    createElement("button", {
      key: "demo-card",
      type: "button",
      "data-testid": "harness-demo-task",
      onClick: () => openTaskDetail(DEMO_TASK),
    }),
    openTask &&
      createElement(BeginnerTaskModal, {
        key: "task-modal",
        task: openTask,
        agents,
        onAsk: setDraft,
        onClose: closeTaskDetail,
      }),
    openAgent &&
      createElement(BeginnerAgentTerminalModal, {
        key: "agent-modal",
        agent: openAgent,
        task: tasks.find((x) => x.id === openAgent.currentTaskId) ?? null,
        sessionId: findAgentPtySessionId(SESSIONS, openAgent.name),
        onClose: closeAgentTerminal,
      }),
  );
}

beforeEach(() => {
  useLocaleStore.setState({ locale: "ko" });
  routeSpy.mockClear();
  routeSpy.mockImplementation(async () => "local");
  stores.tasks = [
    task("t1", "TODO", "리드미 읽기"),
    task("t2", "IN_PROGRESS", "가이드 초안"),
  ];
  stores.agents = [AGENT];
});

afterEach(() => cleanup());

describe("비기너 셸 배선 — 클릭의 도착지", () => {
  it("★미니 보드 카드를 누르면 티켓 상세 모달이 뜬다 (프리필만 되고 마는 게 아니다)", () => {
    render(createElement(Harness));
    expect(screen.queryByTestId("beginner-task-modal")).toBeNull();

    fireEvent.click(screen.getAllByTestId("beginner-mini-task")[1]);

    const modal = screen.getByTestId("beginner-task-modal");
    expect(modal.dataset.taskId).toBe("t2");
    expect(modal.textContent).toContain("가이드 초안");
    // 상단 컴포저(=Ask)만 채워지고 끝나는 동작이 시연에서 관측된 지문이다.
    expect(
      (
        screen.queryByTestId(
          "beginner-first-ask-input",
        ) as HTMLTextAreaElement | null
      )?.value ?? "",
    ).toBe("");
  });

  it("★구독 스냅샷에 없는 데모/프리뷰 티켓을 눌러도 상세 모달이 뜬다", () => {
    render(createElement(Harness));

    fireEvent.click(screen.getByTestId("harness-demo-task"));

    // 종전 배선(id 만 들고 tasks.find 로 재조회)에서는 여기서 아무 일도 일어나지
    // 않았다 — 유저에게 남는 건 아래 대화바뿐이었고, 그게 보고된 지문이다.
    const modal = screen.getByTestId("beginner-task-modal");
    expect(modal.dataset.taskId).toBe("demo-1");
    expect(modal.textContent).toContain("샘플: 시작 가이드 정리");
  });

  it("데모 티켓 상세도 닫힌다 — 스냅샷이 남아 다시 뜨지 않는다", () => {
    render(createElement(Harness));

    fireEvent.click(screen.getByTestId("harness-demo-task"));
    fireEvent.click(screen.getByTestId("beginner-task-modal-close"));

    expect(screen.queryByTestId("beginner-task-modal")).toBeNull();
  });

  it("★에이전트 행을 누르면 그 에이전트의 터미널이 열린다", () => {
    render(createElement(Harness));

    fireEvent.click(screen.getByTestId("beginner-agent-row"));

    const modal = screen.getByTestId("beginner-agent-terminal-modal");
    expect(modal.dataset.agentId).toBe("a1");
    expect(screen.getByTestId("stub-terminal").dataset.sessionId).toBe("pty-7");
  });

  it("에이전트 패널의 티켓 줄은 미니 보드 카드와 같은 상세로 간다 (터미널 아님)", () => {
    render(createElement(Harness));

    fireEvent.click(screen.getByTestId("beginner-agent-task"));

    expect(screen.getByTestId("beginner-task-modal").dataset.taskId).toBe("t2");
    expect(screen.queryByTestId("beginner-agent-terminal-modal")).toBeNull();
  });

  it("★두 모달은 겹치지 않는다 — 나중에 연 것만 남는다", () => {
    render(createElement(Harness));

    fireEvent.click(screen.getAllByTestId("beginner-mini-task")[0]);
    fireEvent.click(screen.getByTestId("beginner-agent-row"));

    expect(screen.getByTestId("beginner-agent-terminal-modal")).toBeTruthy();
    expect(screen.queryByTestId("beginner-task-modal")).toBeNull();
  });
});

describe("비기너 셸 배선 — 대화 표면은 하나", () => {
  it("★첫 마디를 오케가 받으면 상단 컴포저가 접힌다", async () => {
    stores.tasks = [];
    render(createElement(Harness));
    expect(screen.getByTestId("beginner-first-ask")).toBeTruthy();

    fireEvent.change(screen.getByTestId("beginner-first-ask-input"), {
      target: { value: "가이드 정리해 줘" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("beginner-first-ask-send"));
    });

    expect(routeSpy).toHaveBeenCalledTimes(1);
    // 아래 오케 대화창(실 PTY)이 이어받는다 — 입력칸이 둘일 이유가 없다.
    expect(screen.queryByTestId("beginner-first-ask")).toBeNull();
  });

  it("★티켓이 이미 있는 설치에서는 처음부터 안 뜬다 (재시작 후 중복 방지)", () => {
    render(createElement(Harness));
    expect(screen.queryByTestId("beginner-first-ask")).toBeNull();
  });

  it("★티켓 상세의 '물어보기' 는 그 컴포저를 문장과 함께 되살린다", () => {
    render(createElement(Harness));
    fireEvent.click(screen.getAllByTestId("beginner-mini-task")[1]);
    fireEvent.click(screen.getByTestId("beginner-task-modal-ask"));

    // 모달은 닫히고, 프리필이 도착할 곳이 다시 생긴다.
    expect(screen.queryByTestId("beginner-task-modal")).toBeNull();
    const input = screen.getByTestId(
      "beginner-first-ask-input",
    ) as HTMLTextAreaElement;
    expect(input.value).toBe(
      ko["beginner.taskDetail.askProgress"].replace("{title}", "가이드 초안"),
    );
  });

  it("되살아난 컴포저는 치울 수 있다 — 치우면 다시 하나로 접힌다", () => {
    render(createElement(Harness));
    fireEvent.click(screen.getAllByTestId("beginner-mini-task")[1]);
    fireEvent.click(screen.getByTestId("beginner-task-modal-ask"));

    fireEvent.click(screen.getByTestId("beginner-composer-dismiss"));
    expect(screen.queryByTestId("beginner-first-ask")).toBeNull();
  });
});
