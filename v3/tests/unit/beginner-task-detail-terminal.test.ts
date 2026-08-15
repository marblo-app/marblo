/**
 * @vitest-environment jsdom
 *
 * 비기너 셸 티켓 상세 → "터미널 보기" 배선 회귀.
 *
 * 실 셸은 미니 보드 카드 클릭 시 어드밴스드 `TaskDetailModal` 을 연다.
 * 그 모달의 "터미널 보기" 는 기본으로 `openTerminalForSession`(어드밴스드
 * 터미널 탭)을 탄다. 심플 모드엔 그 탭이 없어서, 콜백 없이 누르면 모달만
 * 닫히고 BeginnerAgentTerminalModal 은 안 뜬다.
 *
 * 여기서 못박는 것:
 *   ① onOpenAgentTerminal 이 있으면 그 콜백만 탄다(탭 경로 안 탐)
 *   ② 콜백이 없으면 기존 어드밴스드 경로(openTerminalForSession)를 유지
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const openTerminalForSession = vi.fn();
const setFocusedAgent = vi.fn();
const agents = vi.hoisted(() => [] as unknown[]);

vi.mock("../../src/stores/agentStore", () => ({
  useAgentStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ agents }),
  ),
}));

vi.mock("../../src/stores/terminalStore", () => ({
  useTerminalStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      sessions: [{ id: "pty-mapped", name: "🟣 프론트-1", isAgent: true }],
      openTerminalForSession,
    }),
  ),
}));

vi.mock("../../src/stores/agentFocusStore", () => ({
  useAgentFocusStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ setFocusedAgent }),
  ),
}));

vi.mock("../../src/stores/agentSessionMap", () => ({
  getSessionIdForAgent: (id: string) =>
    id === "a1" ? "pty-mapped" : `agent-${id}`,
}));

vi.mock("../../src/stores/projectStore", () => ({
  useProjectStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ currentProject: { id: "p1", name: "demo" } }),
  ),
}));

vi.mock("../../src/stores/worktreeStore", () => ({
  useWorktreeStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      worktrees: [],
      resolveWorktree: vi.fn(),
      ensureFresh: vi.fn(() => Promise.resolve()),
      loading: false,
    }),
  ),
}));

vi.mock("../../src/stores/taskStore", () => ({
  useTaskStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ tasks: [] }),
  ),
}));

vi.mock("../../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { uid: "u1" } }),
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

vi.mock("../../src/services/activityService", () => ({
  subscribeToActivities: () => () => {},
  addActivity: vi.fn(),
}));

vi.mock("../../src/services/commentService", () => ({
  subscribeToComments: () => () => {},
  addComment: vi.fn(),
}));

vi.mock("../../src/services/taskService", () => ({
  updateTask: vi.fn(),
  updateTaskStatus: vi.fn(),
  deleteTask: vi.fn(),
}));

import { TaskDetailModal } from "../../src/components/board/TaskDetailModal";
import { useLocaleStore } from "../../src/lib/i18n";
import type { Agent } from "../../src/types/agent";
import type { Task } from "../../src/types/task";

const AGENT: Agent = {
  id: "a1",
  projectId: "p1",
  ownerId: "u1",
  name: "프론트-1",
  model: "claude",
  spawnedModel: "claude-fable-5",
  role: "frontend",
  status: "working",
  currentTaskId: "t1",
  command: "claude",
  skillFile: "",
  createdAt: new Date(0),
};

function makeTask(): Task {
  return {
    id: "t1",
    projectId: "p1",
    contextId: "",
    title: "가이드 초안",
    description: "본문",
    status: "IN_PROGRESS",
    role: "frontend",
    priority: 3,
    dependsOn: [],
    dependsOnCompleted: true,
    claimedBy: "a1",
    claimedAt: null,
    scope: [],
    comment: "",
    prUrl: "",
    hasPmFeedback: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

beforeEach(() => {
  useLocaleStore.setState({ locale: "ko" });
  openTerminalForSession.mockClear();
  setFocusedAgent.mockClear();
  agents.length = 0;
  agents.push(AGENT);
  // jsdom 은 scrollIntoView 가 없다 — TaskDetailModal 의 activity 스크롤 effect 용.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => cleanup());

describe("TaskDetailModal — 비기너 onOpenAgentTerminal 배선", () => {
  it("★onOpenAgentTerminal 이 있으면 그 콜백만 타고 어드밴스드 탭 경로는 안 탄다", () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    render(
      createElement(TaskDetailModal, {
        task: makeTask(),
        onClose,
        onOpenAgentTerminal: onOpen,
      }),
    );

    fireEvent.click(screen.getByTestId("task-detail-view-terminal"));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0].id).toBe("a1");
    expect(onOpen.mock.calls[0][0].name).toBe("프론트-1");
    expect(openTerminalForSession).not.toHaveBeenCalled();
    expect(setFocusedAgent).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("콜백이 없으면 기존 어드밴스드 경로(openTerminalForSession)를 유지한다", () => {
    const onClose = vi.fn();
    render(
      createElement(TaskDetailModal, {
        task: makeTask(),
        onClose,
      }),
    );

    fireEvent.click(screen.getByTestId("task-detail-view-terminal"));

    expect(openTerminalForSession).toHaveBeenCalledTimes(1);
    expect(openTerminalForSession.mock.calls[0][0]).toBe("pty-mapped");
    expect(setFocusedAgent).toHaveBeenCalledWith("a1");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
