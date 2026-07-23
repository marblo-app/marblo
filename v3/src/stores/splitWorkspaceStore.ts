import { create } from "zustand";
import {
  DEFAULT_RATIO,
  DEFAULT_V_RATIO,
  clampRatio,
  clampVerticalRatio,
  parseStoredRatio,
  parseStoredVerticalRatio,
  parseStoredTab,
  parseStoredCollapsed,
  type RightTabId,
} from "../lib/splitWorkspaceLayout";

/**
 * Persisted layout state for the IDE split Workspace shell (flag ON only):
 *  - `ratio`             left (terminal) pane width fraction
 *  - `verticalRatio`     orchestrator height fraction within the left column
 *  - `activeTab`         which right-pane work view is showing
 *  - `terminalCollapsed` user's manual collapse of the terminal column
 *  - `fileTreeOpen`      far-left file-tree toggle panel (default closed)
 *
 * Each value is mirrored to localStorage so the split survives restarts. Reads
 * and writes are wrapped so a storage failure (private mode, node test env)
 * degrades to in-memory defaults rather than throwing — mirroring
 * workspaceModeStore. Inert when the flag is OFF (nothing imports this then).
 */
const RATIO_KEY = "marblo.workspaceSplit.ratio";
const V_RATIO_KEY = "marblo.workspaceSplit.verticalRatio";
const TAB_KEY = "marblo.workspaceSplit.activeTab";
const COLLAPSE_KEY = "marblo.workspaceSplit.terminalCollapsed";
const FILETREE_KEY = "marblo.workspaceSplit.fileTreeOpen";

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
  verticalRatio: number;
  activeTab: RightTabId;
  terminalCollapsed: boolean;
  fileTreeOpen: boolean;
  setRatio: (n: number) => void;
  setVerticalRatio: (n: number) => void;
  setActiveTab: (tab: RightTabId) => void;
  setTerminalCollapsed: (collapsed: boolean) => void;
  toggleTerminalCollapsed: () => void;
  setFileTreeOpen: (open: boolean) => void;
  toggleFileTree: () => void;
}

export const useSplitWorkspaceStore = create<SplitWorkspaceState>(
  (set, get) => ({
    ratio: parseStoredRatio(readString(RATIO_KEY)),
    verticalRatio: parseStoredVerticalRatio(readString(V_RATIO_KEY)),
    activeTab: parseStoredTab(readString(TAB_KEY)),
    terminalCollapsed: parseStoredCollapsed(readString(COLLAPSE_KEY)),
    // File tree defaults CLOSED — the split's terminals + work tabs are the
    // primary surface; the tree is an opt-in navigator. Explicit "1" → open.
    fileTreeOpen: readString(FILETREE_KEY) === "1",

    setRatio: (n) => {
      const ratio = clampRatio(n);
      writeString(RATIO_KEY, String(ratio));
      set({ ratio });
    },

    setVerticalRatio: (n) => {
      const verticalRatio = clampVerticalRatio(n);
      writeString(V_RATIO_KEY, String(verticalRatio));
      set({ verticalRatio });
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

    setFileTreeOpen: (open) => {
      writeString(FILETREE_KEY, open ? "1" : "0");
      set({ fileTreeOpen: open });
    },

    toggleFileTree: () => get().setFileTreeOpen(!get().fileTreeOpen),
  }),
);

export { DEFAULT_RATIO, DEFAULT_V_RATIO };
