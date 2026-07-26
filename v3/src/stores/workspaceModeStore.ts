import { create } from "zustand";

/**
 * Single flag for the unified Workspace shell (IDE split: file tree ·
 * orchestrator + agent terminals · tabbed work view · activity).
 *
 * ★ DEFAULT ON since the shell became the product's cold-open experience. The
 * flag did not disappear — it inverted: it is now an opt-OUT back to the legacy
 * <Layout />, and OFF must still be a total no-op (App renders <Layout />
 * verbatim, pixel-identical to before the shell existed).
 *
 * The polarity change is deliberately expressed as "explicit "0" wins", not as
 * a flipped default with the same read: users who turned the shell OFF wrote
 * "0" and keep the legacy layout across this change, while everyone who never
 * touched the Settings toggle (no key at all) graduates to the shell. A read
 * failure (private mode, storage disabled) lands on the shell too, since that
 * is now the default experience rather than an experiment.
 */
const STORAGE_KEY = "marblo.workspaceMode.enabled";

function readInitial(): boolean {
  if (typeof window === "undefined") return true;
  try {
    // Explicit "0" only (a deliberate opt-out). Missing / "1" / garbage → ON.
    return localStorage.getItem(STORAGE_KEY) !== "0";
  } catch {
    return true;
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
