import { create } from 'zustand';

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
  createSession: (name: string, command?: string, args?: string[], cwd?: string) => Promise<string>;
  attachSession: (id: string, name: string) => void;
  closeSession: (id: string) => Promise<void>;
}

const terminalStore = create<TerminalState>((set, get) => ({
  sessions: [],
  activeSessionId: null,

  setActiveSessionId: (id) => set({ activeSessionId: id }),

  createSession: async (name, command, args, cwd) => {
    const id = crypto.randomUUID();
    const result = await window.electronAPI.pty.create({ id, name, command, args, cwd });
    const session: TerminalSession = { id: result.id, name, shell: result.shell };
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
      activeSessionId: activeSessionId === id ? (next.length > 0 ? next[next.length - 1].id : null) : activeSessionId,
    });
  },
}));

export const useTerminalStore = terminalStore;
