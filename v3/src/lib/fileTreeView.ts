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
  // Handle both POSIX (/) and Windows (\) separators so native Windows paths
  // collapse to their last segment instead of returning the whole path.
  return p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;
}

export function filterWorktreesByProject(
  worktrees: Worktree[],
  projectId: string | null | undefined,
): Worktree[] {
  if (!projectId) return [];
  return worktrees.filter((worktree) => worktree.projectId === projectId);
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

/** A switch target offered in the header (main worktree or a task worktree). */
export interface RootSwitchTarget {
  /** Absolute path to switch the tree root to. */
  path: string;
  /** Short label (branch, else basename). */
  label: string;
  /** Task id, when this is a task worktree. */
  taskId?: string;
}

export interface WorktreeMenuAnchorRect {
  left: number;
  right: number;
  bottom: number;
}

export interface WorktreeMenuPosition {
  left: number;
  top: number;
}

/**
 * Position the portal worktree menu opening *rightwards* from the trigger.
 *
 * The trigger lives in the narrow left sidebar header, so anchoring the menu's
 * right edge to the button (the old behaviour) made a 260–360px menu spill off
 * the left edge of the screen. Anchor the menu's *left* edge to the button and
 * clamp it inside the viewport so the menu always opens toward the roomy editor
 * area and never gets clipped.
 */
export function calculateWorktreeMenuPosition(
  anchorRect: WorktreeMenuAnchorRect,
  viewportWidth: number,
  gap = 4,
): WorktreeMenuPosition {
  const width = Math.max(260, Math.min(360, viewportWidth * 0.8));
  const margin = 8;
  let left = anchorRect.left; // open rightwards from the button's left edge
  left = Math.min(left, viewportWidth - width - margin); // clamp to right edge
  left = Math.max(margin, left); // clamp to left edge
  return { left, top: anchorRect.bottom + gap };
}

/**
 * Decide what the header's root-switch control should offer.
 *
 * The control only appears once a *main* worktree is detected (an entry whose
 * `path === repoRoot`, taskId null — falling back to the project folder path)
 * and there is at least one alternative to switch to.
 *
 * - viewing a task worktree → offer a jump back to MAIN (`toMain`)
 * - viewing MAIN / project / folder → offer the task worktree(s) (`toTasks`)
 *
 * Targets are stable-sorted by branch so the menu order doesn't flicker.
 */
export interface RootSwitch {
  mainPath: string;
  /** Set when currently on a task worktree: jump back to this main path. */
  toMain: string | null;
  /** Set when currently on main/project/folder: task worktrees to choose from. */
  toTasks: RootSwitchTarget[];
}

/**
 * Is this worktree an *active task* worktree worth offering as a switch target?
 *
 * The dropdown used to list every worktree under the project, but
 * `~/.marblo/worktrees` accumulates dozens of stale / abandoned
 * feat·fix·security branches that were created outside the task flow. We only
 * offer worktrees that:
 *
 *  1. belong to a task — `taskId != null`. This is the load-bearing filter:
 *     ad-hoc branches (e.g. `.claude/worktrees/feat/*`) have no inferred taskId,
 *     so they drop out here regardless of the stale heuristic.
 *  2. aren't stale. `stale` is computed in the electron main process
 *     (`merged into base` or `idle > N days`, see {@link WorktreeStaleInfo}) and
 *     acts as a *secondary* guard. We keep taskId as the primary signal so a
 *     recently-touched task worktree is never hidden just because the stale
 *     verdict is aggressive.
 */
export function isActiveTaskWorktree(worktree: Worktree): boolean {
  return worktree.taskId != null && !worktree.stale;
}

export function resolveRootSwitch(
  rootPath: string | null,
  worktrees: Worktree[],
  projectRootPath: string | null,
): RootSwitch | null {
  // Locate the main worktree: explicit entry (path === repoRoot) first, else
  // the project folder path as a graceful fallback.
  const mainWorktree = worktrees.find(
    (w) => w.path === w.repoRoot && w.taskId == null,
  );
  const mainPath = mainWorktree?.path ?? projectRootPath ?? null;
  if (!mainPath) return null;

  // Switch targets: active task worktrees only — exclude the main worktree path,
  // ad-hoc branches without a taskId, and stale worktrees (see
  // isActiveTaskWorktree). Main-jump (`toMain`) and describeRootView are
  // intentionally left untouched.
  const toTasks: RootSwitchTarget[] = worktrees
    .filter((w) => w.path !== mainPath)
    .filter(isActiveTaskWorktree)
    .map((w) => ({
      path: w.path,
      label: w.branch || basename(w.path),
      taskId: w.taskId ?? undefined,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const onMain = rootPath === mainPath;

  // Only offer a control when there is somewhere to go.
  if (onMain) {
    if (toTasks.length === 0) return null;
    return { mainPath, toMain: null, toTasks };
  }

  // Off-main: always offer a jump back to main, plus any *other* task worktrees.
  return {
    mainPath,
    toMain: mainPath,
    toTasks: toTasks.filter((t) => t.path !== rootPath),
  };
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
