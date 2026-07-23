import { create } from "zustand";
import {
  DEFAULT_RATIO,
  clampRatio,
  parseStoredRatio,
  parseStoredTab,
  parseStoredCollapsed,
  type RightTabId,
} from "../lib/splitWorkspaceLayout";

/**
 * Persisted layout state for the IDE split Workspace shell (flag ON only):
 *  - `ratio`             left (terminal) pane width fraction
 *  - `activeTab`         which right-pane work view is showing
 *  - `terminalCollapsed` user's manual collapse of the terminal column
 *
 * Each value is mirrored to localStorage so the split survives restarts. Reads
 * and writes are wrapped so a storage failure (private mode, node test env)
 * degrades to in-memory defaults rather than throwing — mirroring
 * workspaceModeStore. Inert when the flag is OFF (nothing imports this then).
 */
const RATIO_KEY = "marblo.workspaceSplit.ratio";
const TAB_KEY = "marblo.workspaceSplit.activeTab";
const COLLAPSE_KEY = "marblo.workspaceSplit.terminalCollapsed";

function readString(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeString(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // Persisting failed (private mode) — keep the in-memory value for this
    // session; it just won't survive a restart.
  }
}

interface SplitWorkspaceState {
  ratio: number;
  activeTab: RightTabId;
  terminalCollapsed: boolean;
  setRatio: (n: number) => void;
  setActiveTab: (tab: RightTabId) => void;
  setTerminalCollapsed: (collapsed: boolean) => void;
  toggleTerminalCollapsed: () => void;
}

export const useSplitWorkspaceStore = create<SplitWorkspaceState>(
  (set, get) => ({
    ratio: parseStoredRatio(readString(RATIO_KEY)),
    activeTab: parseStoredTab(readString(TAB_KEY)),
    terminalCollapsed: parseStoredCollapsed(readString(COLLAPSE_KEY)),

    setRatio: (n) => {
      const ratio = clampRatio(n);
      writeString(RATIO_KEY, String(ratio));
      set({ ratio });
    },

    setActiveTab: (tab) => {
      writeString(TAB_KEY, tab);
      set({ activeTab: tab });
    },

    setTerminalCollapsed: (collapsed) => {
      writeString(COLLAPSE_KEY, collapsed ? "1" : "0");
      set({ terminalCollapsed: collapsed });
    },

    toggleTerminalCollapsed: () =>
      get().setTerminalCollapsed(!get().terminalCollapsed),
  }),
);

export { DEFAULT_RATIO };
