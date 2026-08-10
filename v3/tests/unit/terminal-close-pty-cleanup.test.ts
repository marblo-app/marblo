/**
 * 닫기의 **자원 정리** 계약.
 *
 * PTY 는 두 소유자를 갖는다: 사용자가 띄운 셸은 이 창이, 에이전트 PTY 는
 * AgentManager 가 갖는다. 그래서 "누가 kill 을 부르는가" 가 이 파일의 전부다 —
 * 잘못 부르면 이미 destroy 된 pty 를 두 번 만지고(경합), 안 부르면 node-pty 의
 * master fd 가 그대로 남는다(pty_master_fd_leak).
 *
 * main 쪽 fd 회수(killProcessTree + destroy + orphan master closeSync)는
 * ptyManager.kill 안에 이미 있고 tests/integration/pty-fd-leak.cjs 가 지킨다.
 * 여기서 고정하는 건 렌더러가 그 초크포인트를 **정확히 한 번, 맞는 대상에만**
 * 부르는지, 그리고 렌더러 쪽 잔재(ipcRenderer 리스너 / 미러 / sessions 엔트리)를
 * 남기지 않는지다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronAPI = {
  pty: {
    kill: vi.fn(async () => undefined),
    removeListeners: vi.fn(),
    create: vi.fn(async ({ id }: { id: string }) => ({
      id,
      shell: "/bin/zsh",
    })),
  },
  agent: {
    stop: vi.fn(async () => undefined),
    remove: vi.fn(async () => ({ success: true })),
  },
};

vi.stubGlobal("window", { electronAPI });

// agentStore → services/firestore → lib/firebase. 실 Firebase 초기화는 이
// 환경에서 터지므로 구독 계층만 무해한 스텁으로 바꾼다.
vi.mock("../../src/services/firestore", () => ({
  subscribeToCollection: vi.fn(() => () => {}),
  subscribeToDocument: vi.fn(() => () => {}),
  convertTimestamps: vi.fn((raw: unknown) => raw),
}));

vi.mock("../../src/services/agentService", () => ({
  deleteAgent: vi.fn(async () => undefined),
  updateAgent: vi.fn(async () => undefined),
  createAgent: vi.fn(async () => "new-id"),
  stampSpawnedModel: vi.fn(),
}));

vi.mock("../../src/lib/terminalPersist", () => ({
  addPersistedTerminal: vi.fn(),
  removePersistedTerminal: vi.fn(),
}));

const { useTerminalStore } = await import("../../src/stores/terminalStore");
const { useAgentStore } = await import("../../src/stores/agentStore");
const { usePtyMirrorStore } = await import("../../src/stores/ptyMirrorStore");
const { useProjectStore } = await import("../../src/stores/projectStore");
const { removePersistedTerminal } =
  await import("../../src/lib/terminalPersist");
const agentService = await import("../../src/services/agentService");

beforeEach(() => {
  vi.clearAllMocks();
  useTerminalStore.setState({ sessions: [], activeSessionId: null });
  usePtyMirrorStore.setState({ buffers: {}, attached: {} });
  // 영속 entry 제거는 프로젝트 스코프 — 프로젝트가 없으면 조용히 건너뛴다.
  useProjectStore.setState({
    currentProject: { id: "p1", name: "proj" },
  } as never);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("terminalStore.closeSession — 소유자별 kill 라우팅", () => {
  it("셸 터미널은 pty:kill 로 죽이고 영속 entry 까지 지운다", async () => {
    useTerminalStore.setState({
      sessions: [{ id: "s1", name: "Terminal 1" }],
      activeSessionId: "s1",
    });

    await useTerminalStore.getState().closeSession("s1");

    expect(electronAPI.pty.kill).toHaveBeenCalledWith("s1");
    expect(electronAPI.pty.removeListeners).toHaveBeenCalledWith("s1");
    expect(removePersistedTerminal).toHaveBeenCalled();
    expect(useTerminalStore.getState().sessions).toEqual([]);
    expect(useTerminalStore.getState().activeSessionId).toBeNull();
  });

  it("에이전트 세션은 pty:kill 을 부르지 않는다 (AgentManager 가 소유자)", async () => {
    useTerminalStore.setState({
      sessions: [{ id: "agent-a1", name: "🟣 backend-1", isAgent: true }],
      activeSessionId: "agent-a1",
    });

    await useTerminalStore.getState().closeSession("agent-a1");

    expect(electronAPI.pty.kill).not.toHaveBeenCalled();
    // 그래도 렌더러 잔재는 회수한다 — 이게 없으면 죽은 에이전트의 리스너가 남는다.
    expect(electronAPI.pty.removeListeners).toHaveBeenCalledWith("agent-a1");
    expect(useTerminalStore.getState().sessions).toEqual([]);
  });

  it("추적하지 않는 id 는 아무것도 죽이지 않는다 (에이전트 PTY 오폭 방지)", async () => {
    // 회귀 가드: 종전 `!session?.isAgent` 는 미추적 id 를 "셸" 로 접어서
    // 렌더러가 남의 PTY 에 직접 kill 을 쏘는 경로였다.
    await useTerminalStore.getState().closeSession("agent-unknown");

    expect(electronAPI.pty.kill).not.toHaveBeenCalled();
    expect(removePersistedTerminal).not.toHaveBeenCalled();
  });

  it("닫힌 세션이 활성이었으면 남은 세션으로 활성이 넘어간다", async () => {
    useTerminalStore.setState({
      sessions: [
        { id: "s1", name: "Terminal 1" },
        { id: "s2", name: "Terminal 2" },
      ],
      activeSessionId: "s2",
    });

    await useTerminalStore.getState().closeSession("s2");

    expect(useTerminalStore.getState().activeSessionId).toBe("s1");
  });
});

describe("agentStore.deleteAgent — agent-manager 초크포인트 + 렌더러 회수", () => {
  it("stop → remove → 문서 삭제 순으로 지나고, 터미널 세션도 걷힌다", async () => {
    useTerminalStore.setState({
      sessions: [{ id: "agent-a1", name: "🟣 backend-1", isAgent: true }],
      activeSessionId: "agent-a1",
    });

    await useAgentStore.getState().deleteAgent("a1");

    expect(electronAPI.agent.stop).toHaveBeenCalledWith("a1");
    expect(electronAPI.agent.remove).toHaveBeenCalledWith("a1");
    expect(agentService.deleteAgent).toHaveBeenCalledWith("a1");
    // 렌더러 세션이 사라져야 목록/그리드가 죽은 세션을 더 매칭하지 않는다.
    expect(useTerminalStore.getState().sessions).toEqual([]);
    // ★그리고 그 정리는 agent:stop 을 통해서만 죽였다 — 중복 pty:kill 없음.
    expect(electronAPI.pty.kill).not.toHaveBeenCalled();
  });
});
