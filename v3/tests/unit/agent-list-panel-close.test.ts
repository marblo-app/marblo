/**
 * @vitest-environment jsdom
 *
 * 하단 에이전트/터미널 패널의 **닫기(X)** — 실제 DOM 렌더 회귀.
 *
 * 사장님 신고: "에이전트 탭의 터미널을 닫을 방법이 없다". 원인은 AgentRow 가
 * `row.isAgent` 일 때만 액션 버튼을 그려서, 셸 터미널 행에는 닫기 수단이 아예
 * 없었던 것. 그래서 이 파일이 못박는 계약은 네 가지다:
 *
 *   ① 모든 행(에이전트 + 터미널)에 X 가 있다
 *   ② 터미널 X 는 즉시 닫고, 자원 정리는 terminalStore.closeSession 경유다
 *   ③ working 에이전트만 손실 경고 모달을 거치고, 확인 후 deleteAgent
 *      (= agent:stop → agent:remove 초크포인트)로 간다. stopped 는 즉시.
 *   ④ 닫은 뒤 포커스는 인접 항목으로 가고, 마지막 하나였으면 빈 상태로 떨어진다
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// 이 jsdom 환경은 window.localStorage 를 노출하지 않는다. 패널은 마운트 시
// 저장된 높이를 읽으므로 최소 스텁을 깔아 준다.
if (!globalThis.localStorage) {
  const mem = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
    },
  });
}

const stores = vi.hoisted(() => ({
  agents: [] as unknown[],
  sessions: [] as unknown[],
  focusedAgentId: null as string | null,
}));

const spies = vi.hoisted(() => ({
  deleteAgent: vi.fn(async () => undefined),
  stopAgent: vi.fn(async () => undefined),
  restartAgent: vi.fn(async () => undefined),
  updateAgent: vi.fn(async () => undefined),
  closeSession: vi.fn(async () => undefined),
  createSession: vi.fn(async () => "new"),
  setFocusedAgent: vi.fn((id: string | null) => {
    stores.focusedAgentId = id;
  }),
}));

vi.mock("../../src/stores/agentStore", () => ({
  useAgentStore: Object.assign(
    vi.fn((selector: (s: unknown) => unknown) =>
      selector({
        agents: stores.agents,
        subscribeToAgents: () => () => {},
        restartAgent: spies.restartAgent,
        updateAgent: spies.updateAgent,
        stopAgent: spies.stopAgent,
        deleteAgent: spies.deleteAgent,
      }),
    ),
    { getState: () => ({ deleteAgent: spies.deleteAgent }) },
  ),
}));

vi.mock("../../src/stores/terminalStore", () => ({
  useTerminalStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      sessions: stores.sessions,
      createSession: spies.createSession,
      closeSession: spies.closeSession,
    }),
  ),
}));

vi.mock("../../src/stores/navigationStore", () => ({
  useNavigationStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ requestJump: vi.fn() }),
  ),
}));

vi.mock("../../src/stores/projectStore", () => ({
  useProjectStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ currentProject: { id: "p1" } }),
  ),
}));

vi.mock("../../src/stores/agentFocusStore", () => ({
  useAgentFocusStore: Object.assign(
    vi.fn((selector: (s: unknown) => unknown) =>
      selector({
        focusedAgentId: stores.focusedAgentId,
        setFocusedAgent: spies.setFocusedAgent,
      }),
    ),
    {
      getState: () => ({
        focusedAgentId: stores.focusedAgentId,
        setFocusedAgent: spies.setFocusedAgent,
      }),
    },
  ),
}));

// xterm 을 끌고 오는 실 TerminalView 는 jsdom 에서 의미가 없다 — 자리만 잡는다.
vi.mock("../../src/components/terminal/TerminalView", () => ({
  default: () => null,
}));

import { AgentListPanel } from "../../src/components/agents/list-panel/AgentListPanel";
import { useLocaleStore } from "../../src/lib/i18n";
import { ko } from "../../src/locales/ko";

function makeAgent(over: Record<string, unknown>) {
  return {
    id: "a1",
    name: "backend-1",
    model: "claude",
    role: "backend",
    status: "idle",
    currentTaskId: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  };
}

function renderPanel() {
  return render(
    createElement(AgentListPanel, {
      onJumpToAgent: vi.fn(),
      onSpawnClick: vi.fn(),
    }),
  );
}

/** 행/헤더의 X 버튼들 — aria-label 은 "{name} 닫기". */
function closeButtons() {
  return screen
    .getAllByRole("button")
    .filter((b) => (b.getAttribute("aria-label") ?? "").endsWith("닫기"));
}

beforeEach(() => {
  vi.clearAllMocks();
  stores.agents = [];
  stores.sessions = [];
  stores.focusedAgentId = null;
  useLocaleStore.setState({ locale: "ko" });
});

afterEach(cleanup);

describe("AgentListPanel — 닫기(X) 노출", () => {
  it("셸 터미널 행에도 X 가 붙는다 (종전엔 닫을 방법이 없었다)", () => {
    stores.sessions = [{ id: "s1", name: "Terminal 1", isAgent: false }];
    renderPanel();

    expect(closeButtons()).toHaveLength(1);
  });

  it("에이전트 행과 터미널 행 모두 X 를 갖는다", () => {
    stores.agents = [makeAgent({})];
    stores.sessions = [
      { id: "agent-a1", name: "🟣 backend-1", isAgent: true },
      { id: "s1", name: "Terminal 1", isAgent: false },
    ];
    renderPanel();

    expect(closeButtons()).toHaveLength(2);
  });
});

describe("AgentListPanel — 닫기 동작과 자원 정리 경로", () => {
  it("터미널 X 는 확인 없이 closeSession(PTY kill 경유)으로 간다", async () => {
    stores.sessions = [{ id: "s1", name: "Terminal 1", isAgent: false }];
    renderPanel();

    fireEvent.click(closeButtons()[0]);

    await vi.waitFor(() =>
      expect(spies.closeSession).toHaveBeenCalledWith("s1"),
    );
    expect(spies.deleteAgent).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stopped 에이전트는 즉시 닫힌다 — 모달 없음", () => {
    stores.agents = [makeAgent({ status: "stopped" })];
    renderPanel();

    fireEvent.click(closeButtons()[0]);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(spies.deleteAgent).toHaveBeenCalledWith("a1");
  });

  it("working 에이전트는 손실 경고 모달을 먼저 띄운다", () => {
    stores.agents = [makeAgent({ status: "working" })];
    renderPanel();

    fireEvent.click(closeButtons()[0]);

    // 아직 아무것도 죽이지 않았다.
    expect(spies.deleteAgent).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("backend-1");

    fireEvent.click(screen.getByText(ko["agents.close.confirm"]));
    expect(spies.deleteAgent).toHaveBeenCalledWith("a1");
  });

  it("경고 모달에서 취소하면 아무것도 죽지 않는다", () => {
    stores.agents = [makeAgent({ status: "working" })];
    renderPanel();

    fireEvent.click(closeButtons()[0]);
    fireEvent.click(screen.getByText(ko["agents.close.cancel"]));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(spies.deleteAgent).not.toHaveBeenCalled();
    expect(spies.closeSession).not.toHaveBeenCalled();
  });

  it("살아있는 에이전트는 렌더러가 직접 kill 하지 않고 agent 초크포인트만 탄다", async () => {
    stores.agents = [makeAgent({ status: "idle" })];
    stores.sessions = [{ id: "agent-a1", name: "🟣 backend-1", isAgent: true }];
    renderPanel();

    // 에이전트 행이 먼저다 (agentRows → shellRows 순).
    fireEvent.click(closeButtons()[0]);

    expect(spies.deleteAgent).toHaveBeenCalledWith("a1");
    // closeSession 은 렌더러 잔재 회수용 — 에이전트 세션엔 pty:kill 을 안 부른다
    // (terminal-close-pty-cleanup.test.ts 가 그 계약을 따로 지킨다).
    await vi.waitFor(() =>
      expect(spies.closeSession).toHaveBeenCalledWith("agent-a1"),
    );
  });
});

describe("AgentListPanel — 닫은 뒤 포커스", () => {
  it("포커스된 항목을 닫으면 인접 항목으로 옮겨 간다", () => {
    stores.agents = [
      makeAgent({ id: "a1", name: "backend-1", status: "stopped" }),
      makeAgent({ id: "a2", name: "frontend-1", status: "stopped" }),
    ];
    stores.focusedAgentId = "a1";
    renderPanel();

    // FocusView 헤더의 X (드릴인 상태에서도 닫을 수 있어야 한다).
    fireEvent.click(closeButtons()[0]);

    expect(spies.setFocusedAgent).toHaveBeenCalledWith("a2");
    expect(spies.deleteAgent).toHaveBeenCalledWith("a1");
  });

  it("마지막 하나를 닫으면 포커스는 비고 빈 상태로 떨어진다", () => {
    stores.agents = [makeAgent({ status: "stopped" })];
    stores.focusedAgentId = "a1";
    renderPanel();

    fireEvent.click(closeButtons()[0]);

    expect(spies.setFocusedAgent).toHaveBeenCalledWith(null);
  });
});
