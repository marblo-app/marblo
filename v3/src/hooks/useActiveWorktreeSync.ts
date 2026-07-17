import { useEffect } from "react";
import { useEditorStore } from "../stores/editorStore";
import { useWorktreeStore } from "../stores/worktreeStore";
import { useWorktreeViewStore } from "../stores/worktreeViewStore";
import { resolveActiveWorktreeId } from "../lib/taskWorktree";

/**
 * Central reconciler for the `activeWorktree` concept.
 *
 * Keeps `worktreeViewStore.activeWorktreeId` a faithful, non-drifting cache of
 * `editorStore.rootPath` (the single source of truth). Whenever rootPath OR the
 * worktree list changes — a ticket "이 워크트리 보기" click, the sidebar
 * worktree dropdown, Open Folder, home-reset, or a fresh worktree list load —
 * we recompute the active id from rootPath. Because it is always derived here,
 * the id can never disagree with the file tree.
 *
 * Mounted once, at Layout, so there is exactly one reconciler (no per-component
 * subscriptions racing to write the store). Holds no OS resources, so it never
 * leaks across worktree switches.
 */
export function useActiveWorktreeSync(): void {
  const rootPath = useEditorStore((s) => s.rootPath);
  const worktrees = useWorktreeStore((s) => s.worktrees);
  const setActiveWorktree = useWorktreeViewStore((s) => s.setActiveWorktree);

  useEffect(() => {
    setActiveWorktree(resolveActiveWorktreeId(worktrees, rootPath));
  }, [rootPath, worktrees, setActiveWorktree]);
}
