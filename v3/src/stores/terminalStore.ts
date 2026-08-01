import { create } from "zustand";
import { useEditorStore } from "./editorStore";
import { useProjectStore } from "./projectStore";
import { usePtyMirrorStore } from "./ptyMirrorStore";
import {
  addPersistedTerminal,
  removePersistedTerminal,
} from "../lib/terminalPersist";

export interface TerminalSession {
  id: string;
  name: string;
  shell?: string;
  isAgent?: boolean;
}

interface TerminalState {
  sessions: TerminalSession[];
  activeSessionId: string | null;
  setActiveSessionId: (id: string | null) => void;
  createSession: (
    name: string,
    command?: string,
    args?: string[],
    cwd?: string,
  ) => Promise<string>;
  attachSession: (id: string, name: string) => void;
  closeSession: (id: string) => Promise<void>;
  /**
   * 점프 헬퍼: attachSession + setActive + 'marblo:focus-terminal' 이벤트.
   * Fleet 그리드/Activity 점프 등 여러 surface 에서 같은 흐름을 부르므로
   * store 에 모았다.
   */
  openTerminalForSession: (id: string, name: string) => void;
  /**
   * Detach every terminal session from THIS window's UI without killing the
   * backing PTYs. Used when the window switches projects — agent PTYs may be
   * owned by other windows / live across project switches, so we only drop
   * UI listeners and clear local state. Non-agent (user-spawned) terminal
   * sessions are killed since no other window can adopt them.
   */
  detachAllSessions: () => Promise<void>;
}

const terminalStore = create<TerminalState>((set, get) => ({
  sessions: [],
  activeSessionId: null,

  setActiveSessionId: (id) => set({ activeSessionId: id }),

  createSession: async (name, command, args, cwd) => {
    const id = crypto.randomUUID();
    // Default cwd to the project's rootPath so user-spawned terminals open
    // in the project folder instead of the user's home (or "/" when
    // Electron was launched from Finder). Explicit cwd still wins.
    const resolvedCwd = cwd ?? useEditorStore.getState().rootPath ?? undefined;
    const result = await window.electronAPI.pty.create({
      id,
      name,
      command,
      args,
      cwd: resolvedCwd,
    });
    const session: TerminalSession = {
      id: result.id,
      name,
      shell: result.shell,
    };
    set((s) => ({ sessions: [...s.sessions, session], activeSessionId: id }));
    // 영속화: name 기준 dedup 으로 useTerminalRestore 가 재spawn 시 같은
    // entry 를 다시 push 하지 않음. 프로젝트 단위 키.
    //
    // ★resolvedCwd 가 아니라 **명시적으로 받은 cwd 만** 저장한다
    // (티켓 D8yiihCWgDMd3AU7xkEy). resolvedCwd 를 저장하면 생성 시점의
    // rootPath 가 핀으로 박히고, name dedup 때문에 그 값이 영구히 이긴다 —
    // 워크트리를 한 번 본 뒤 연 터미널이 이후 모든 재시작에서 그 워크트리로
    // 뜨던 실버그의 원인. cwd 없이 저장된 탭은 복구 시 그때의 rootPath 를
    // 따라간다 = "지금 열려 있는 폴더에서 터미널이 뜬다".
    const projectId = useProjectStore.getState().currentProject?.id;
    if (projectId) {
      addPersistedTerminal(projectId, {
        name,
        ...(cwd ? { cwd } : {}),
        command,
        args,
      });
    }
    return id;
  },

  attachSession: (id, name) => {
    const { sessions } = get();
    if (sessions.some((s) => s.id === id)) {
      // Already attached, just focus
      set({ activeSessionId: id });
      return;
    }
    const session: TerminalSession = { id, name, isAgent: true };
    set((s) => ({ sessions: [...s.sessions, session], activeSessionId: id }));
  },

  openTerminalForSession: (id, name) => {
    get().attachSession(id, name);
    set({ activeSessionId: id });
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("marblo:focus-terminal", { detail: { sessionId: id } }),
      );
    }
  },

  closeSession: async (id) => {
    const { activeSessionId, sessions } = get();
    const session = sessions.find((s) => s.id === id);
    window.electronAPI.pty.removeListeners(id);
    // removeListeners 는 이 채널의 모든 ipcRenderer 리스너를 제거한다 — Fleet
    // 프리뷰용 ptyMirror 리스너까지 함께 사라진다. 미러의 attached 플래그를
    // 정리하지 않으면 다음 attach()가 early-return 해 데드 미러가 된다(P2-7).
    usePtyMirrorStore.getState().release(id);
    // Only kill if it's not an agent session (agent manages its own lifecycle)
    if (!session?.isAgent) {
      await window.electronAPI.pty.kill(id);
      // 영속 entry 도 제거 → 다음 재시작 때 부활하지 않음.
      const projectId = useProjectStore.getState().currentProject?.id;
      if (projectId && session?.name) {
        removePersistedTerminal(projectId, session.name);
      }
    }
    const next = sessions.filter((s) => s.id !== id);
    set({
      sessions: next,
      activeSessionId:
        activeSessionId === id
          ? next.length > 0
            ? next[next.length - 1].id
            : null
          : activeSessionId,
    });
  },

  detachAllSessions: async () => {
    const { sessions } = get();
    for (const s of sessions) {
      window.electronAPI.pty.removeListeners(s.id);
      // 프로젝트 전환 지점 — 미러 리스너가 removeListeners 로 제거됐으니 미러
      // 상태(attached/buffer)도 회수해야 복귀 후 재마운트 시 재등록된다(P2-7).
      usePtyMirrorStore.getState().release(s.id);
      // User-spawned terminals (not isAgent) belong to this window only and
      // would leak if we just dropped them from the UI. Agent PTYs may be
      // owned by other windows or AgentManager — don't kill them.
      if (!s.isAgent) {
        await window.electronAPI.pty.kill(s.id).catch(() => {});
      }
    }
    set({ sessions: [], activeSessionId: null });
  },
}));

export const useTerminalStore = terminalStore;
