import { create } from "zustand";

/**
 * The "activeWorktree" concept — a minimally-scoped handle for *which* task
 * worktree the user is currently viewing.
 *
 * ── Why a separate store instead of reusing `editorStore.rootPath`? ──────────
 * `rootPath` stays the single source of truth for the file tree and is read by
 * ~14 consumers (Code tab, orchestrator, agents, session-restore …). We do NOT
 * rip that out. Instead this store is the *strangler seam*: `rootPath` remains
 * the compatibility fallback, and new UI (the ticket "이 워크트리 보기" button's
 * active-state) references `activeWorktreeId` — a `Worktree.id`.
 *
 * ── No drift ────────────────────────────────────────────────────────────────
 * `activeWorktreeId` is never authored independently. It is *reconciled* from
 * `rootPath` by {@link useActiveWorktreeSync} (resolveActiveWorktreeId), so it
 * is always a cached derivation of rootPath — it can't disagree with the file
 * tree even when the root is switched through another path (the sidebar
 * worktree dropdown, Open Folder, home-reset).
 */
interface WorktreeViewState {
  /** `Worktree.id` currently rooted in the file tree, or null (main / folder). */
  activeWorktreeId: string | null;
  setActiveWorktree: (id: string | null) => void;
}

export const useWorktreeViewStore = create<WorktreeViewState>((set) => ({
  activeWorktreeId: null,
  setActiveWorktree: (id) =>
    // Skip the set when unchanged so subscribers don't re-render on every
    // rootPath poll/reconcile tick.
    set((s) => (s.activeWorktreeId === id ? s : { activeWorktreeId: id })),
}));
