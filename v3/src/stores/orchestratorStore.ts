import { create } from 'zustand';

export type OrchestratorStatus = 'stopped' | 'starting' | 'running' | 'error';

interface OrchestratorState {
  sessionId: string | null;
  ptySessionId: string | null;
  status: OrchestratorStatus;
  isCollapsed: boolean;

  setSession: (sessionId: string, ptySessionId: string) => void;
  setStatus: (status: OrchestratorStatus) => void;
  setCollapsed: (collapsed: boolean) => void;
  toggleCollapsed: () => void;
  clear: () => void;
}

export const useOrchestratorStore = create<OrchestratorState>((set, get) => ({
  sessionId: null,
  ptySessionId: null,
  status: 'stopped',
  isCollapsed: true,

  setSession: (sessionId, ptySessionId) =>
    set({ sessionId, ptySessionId, status: 'starting' }),

  setStatus: (status) => set({ status }),

  setCollapsed: (collapsed) => set({ isCollapsed: collapsed }),

  toggleCollapsed: () => set({ isCollapsed: !get().isCollapsed }),

  clear: () =>
    set({ sessionId: null, ptySessionId: null, status: 'stopped' }),
}));
