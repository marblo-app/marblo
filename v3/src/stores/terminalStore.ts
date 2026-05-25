import { create } from "zustand";
import { useEditorStore } from "./editorStore";

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
    // Only kill if it's not an agent session (agent manages its own lifecycle)
    if (!session?.isAgent) {
      await window.electronAPI.pty.kill(id);
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
