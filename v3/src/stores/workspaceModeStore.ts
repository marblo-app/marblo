import { create } from "zustand";

/**
 * Single opt-in flag for the new unified Workspace shell (chrome-tab panes +
 * collapsible orchestrator spine + agent dock + browser pane + diff-A).
 *
 * ★ DEFAULT OFF, and OFF must be a total no-op: App renders the existing
 * <Layout /> verbatim when this is false. The only reachable effect of this
 * store when disabled is that the Settings toggle reads `enabled === false`.
 *
 * Persisted to localStorage so the choice survives restarts. A read failure
 * (private mode, storage disabled) falls back to OFF — never accidentally ON.
 */
const STORAGE_KEY = "marblo.workspaceMode.enabled";

function readInitial(): boolean {
  if (typeof window === "undefined") return false;
  try {
    // Explicit "1" only. Anything else (missing, "0", garbage) → OFF.
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

interface WorkspaceModeState {
  /** When true, the app renders the new WorkspaceShell instead of Layout. */
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  toggle: () => void;
}

export const useWorkspaceModeStore = create<WorkspaceModeState>((set, get) => ({
  enabled: readInitial(),
  setEnabled: (enabled) => {
    try {
      localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
    } catch {
      // Persisting failed (private mode) — keep the in-memory value so the
      // toggle still works for this session; it just won't survive restart.
    }
    set({ enabled });
  },
  toggle: () => get().setEnabled(!get().enabled),
}));
