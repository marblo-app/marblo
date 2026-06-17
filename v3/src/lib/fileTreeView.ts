import type { Worktree } from "../types/worktree";

/**
 * Pure helpers backing the FileTree sidebar header.
 *
 * The sidebar tree follows `editorStore.rootPath`, which switches as the user
 * activates a task / worktree / project. Because a worktree's basename is
 * often a generated id, the header must spell out *which* root is currently
 * being viewed so a worktree switch is unmistakable.
 */

export type RootKind = "project" | "worktree" | "folder";

export interface RootView {
  /** Short label for the header (worktree branch, else basename). */
  label: string;
  /** Absolute path currently being viewed. */
  fullPath: string;
  /** How this root relates to the active project. */
  kind: RootKind;
  /** Secondary detail for a worktree (task id, when present). */
  detail?: string;
}

function basename(p: string): string {
  return p.split("/").pop() || p;
}

/**
 * Describe the root the tree is currently showing.
 *
 * - matches a known worktree  → kind "worktree" (label = branch, detail = taskId)
 * - equals the project folder → kind "project"
 * - anything else             → kind "folder"
 */
export function describeRootView(
  rootPath: string | null,
  worktrees: Worktree[],
  projectRootPath: string | null,
): RootView | null {
  if (!rootPath) return null;
  const base = basename(rootPath);

  const worktree = worktrees.find((w) => w.path === rootPath);
  if (worktree) {
    return {
      label: worktree.branch || base,
      fullPath: rootPath,
      kind: "worktree",
      detail: worktree.taskId ?? undefined,
    };
  }

  if (projectRootPath && rootPath === projectRootPath) {
    return { label: base, fullPath: rootPath, kind: "project" };
  }

  return { label: base, fullPath: rootPath, kind: "folder" };
}

/**
 * Stable signature of a loaded tree + git status, used to skip redundant
 * re-renders when a poll / watcher reload returns identical data.
 */
export function treeSignature(
  nodes: unknown,
  statuses: Record<string, string>,
): string {
  return JSON.stringify([nodes, statuses]);
}
