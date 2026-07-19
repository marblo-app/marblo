import { create } from "zustand";

/**
 * Cross-tab navigation hand-off. The Activity Stream panel (and other
 * future call sites) writes a pending jump here; Layout switches tabs and
 * the destination tab consumes the entry on mount, then clears it.
 *
 * Why a store and not a custom event: tabs in Marblo unmount when
 * inactive, so an immediately-dispatched event would fire into a tab
 * that hasn't mounted yet. The store latches the target until the new
 * tab reads + clears it.
 */
export type JumpTarget =
  | { type: "task"; id: string }
  | { type: "agent"; id: string }
  | { type: "code" }
  // Worktrees surface — the escape hatch from the Code tab's per-file diff to
  // the whole-branch diff, for work the agent already committed (which the
  // per-file working-tree diff cannot show). Both shells handle it.
  | { type: "worktrees" };

interface NavigationState {
  pendingJump: JumpTarget | null;
  requestJump: (target: JumpTarget) => void;
  consumeJump: () => JumpTarget | null;
}

export const useNavigationStore = create<NavigationState>((set, get) => ({
  pendingJump: null,
  requestJump: (target) => set({ pendingJump: target }),
  consumeJump: () => {
    const t = get().pendingJump;
    if (t) set({ pendingJump: null });
    return t;
  },
}));
