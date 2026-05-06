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
 * Open/closed, filter chip, and stream/macro toggle persist across tab
 * switches but reset on window restart — intentional, the panel is a
 * transient observability tool.
 */
export const useActivityStreamStore = create<ActivityStreamState>((set) => ({
  // Default open — the panel is the canonical "what's happening right now"
  // surface, paired with the kanban as the macro view. Users who want it
  // hidden close via header toggle or ⌘⇧A.
  open: true,
  filter: "all",
  viewMode: "stream",
  toggle: () => set((s) => ({ open: !s.open })),
  setOpen: (open) => set({ open }),
  setFilter: (filter) => set({ filter }),
  setViewMode: (viewMode) => set({ viewMode }),
}));
