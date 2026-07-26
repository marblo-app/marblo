import { create } from "zustand";
import type { ActivityType } from "../services/activityStreamService";

export type ActivityFilter = ActivityType | "all";
export type ActivityViewMode = "stream" | "macro";

interface ActivityStreamState {
  open: boolean;
  filter: ActivityFilter;
  viewMode: ActivityViewMode;
  toggle: () => void;
  setOpen: (open: boolean) => void;
  setFilter: (filter: ActivityFilter) => void;
  setViewMode: (mode: ActivityViewMode) => void;
}

/**
 * Per-window UI state for the right-side Activity Stream panel.
 *
 * The open/closed flag is persisted to localStorage so the choice survives a
 * restart (the Workspace shell's far-right toggle needs sticky state). Filter
 * chip and stream/macro toggle stay in-memory — they're transient view options.
 * Reads/writes are wrapped so a storage failure (private mode / node test env)
 * degrades to the default rather than throwing.
 */
const OPEN_KEY = "marblo.activityStream.open";

function readOpen(): boolean {
  if (typeof window === "undefined") return false;
  try {
    // Default CLOSED when unset. The shell's cold-open shape is the three-way
    // split (files · terminals · work view) and Activity is its opt-in fourth
    // region — one click away on the far-right rail, or ⌘⇧A. Only an explicit
    // "1" (the user opened it) restores it on the next start.
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function writeOpen(open: boolean): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    // private mode / quota — keep the in-memory value for this session.
  }
}

export const useActivityStreamStore = create<ActivityStreamState>((set) => ({
  open: readOpen(),
  filter: "all",
  viewMode: "stream",
  toggle: () =>
    set((s) => {
      const open = !s.open;
      writeOpen(open);
      return { open };
    }),
  setOpen: (open) => {
    writeOpen(open);
    set({ open });
  },
  setFilter: (filter) => set({ filter }),
  setViewMode: (viewMode) => set({ viewMode }),
}));
