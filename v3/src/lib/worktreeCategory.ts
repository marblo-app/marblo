import type { Task } from "../types/task";
import type { Worktree } from "../types/worktree";
import { archiveSafetyBlocker, type ArchiveSignals } from "./worktreeHygiene";

/**
 * Audit lifecycle category for a worktree — the "where is this in its life?"
 * lens the Worktrees tab groups and colours rows by.
 *
 * ── Why task status, not git ─────────────────────────────────────────────────
 * A branch that was **squash-merged** (the default merge here) leaves NO merge
 * ancestry on the worktree's own commits — `git branch --merged` and
 * `merge-base` both say "not merged" even though the work landed on base. So a
 * git-only verdict mislabels finished, landed work as still-in-flight. The
 * board ticket does not lie: #561 already joins each worktree to its `taskId`
 * (the worktree path encodes it), and the ticket's own DONE / REVIEW status is
 * the ground truth for lifecycle. We read that instead of guessing from git.
 *
 * The four categories:
 *  - **developing**    an agent is attached, the tree has uncommitted changes,
 *                      or the ticket is still open (anything but DONE/REVIEW).
 *                      This is the *protected* state — see the ordering note.
 *  - **mergeNeeded**   ticket is in REVIEW: the work is done and waiting for a
 *                      human/orchestrator to merge it.
 *  - **cleanupMerged** ticket is DONE: landed work whose worktree can be reaped.
 *  - **cleanupStale**  no ticket at all (ad-hoc / orphaned branch): a leftover
 *                      to prune.
 */
export type WorktreeCategory =
  | "developing"
  | "mergeNeeded"
  | "cleanupMerged"
  | "cleanupStale";

/**
 * Whether this worktree holds live, unsaved, or in-flight work that a bulk
 * cleanup must never touch: an attached agent, uncommitted changes, or a busy
 * ticket. Kept as its own predicate because it is the ★ protection invariant —
 * it ranks ABOVE every "finished" signal, so a DONE ticket whose worktree is
 * still dirty stays `developing`, not `cleanupMerged`.
 *
 * `dirty` is only known where a status probe ran (the Worktrees tab has one);
 * `agentId` / `busyTaskIds` are the two "an agent is in here now" signals, the
 * same pair {@link archiveSafetyBlocker} reads.
 */
function isDeveloping(worktree: Worktree, signals: ArchiveSignals): boolean {
  if (worktree.status?.dirty === true) return true;
  if (worktree.agentId != null) return true;
  return (
    worktree.taskId != null &&
    signals.busyTaskIds?.has(worktree.taskId) === true
  );
}

/**
 * Classify a worktree for the audit view.
 *
 * `task` is the worktree's board ticket (resolved from `worktree.taskId`), or
 * null when the worktree is ad-hoc / the ticket is not loaded.
 *
 * ★ Ordering is load-bearing. The developing check runs FIRST so live or
 * uncommitted work is protected regardless of what the ticket says — the
 * data-loss incident this guards against was an uncommitted worktree swept by a
 * cleanup because some other signal read "finished".
 */
export function worktreeCategory(
  worktree: Worktree,
  task: Task | null,
  signals: ArchiveSignals = {},
): WorktreeCategory {
  // 1. Live / uncommitted work — protected above everything else.
  if (isDeveloping(worktree, signals)) return "developing";

  // 2. No ticket → orphan/ad-hoc branch → prune candidate.
  if (!task) return "cleanupStale";

  // 3. Lifecycle from the ticket's own status (squash-proof).
  switch (task.status) {
    case "DONE":
      return "cleanupMerged";
    case "REVIEW":
      return "mergeNeeded";
    default:
      // TODO / CLAIMED / IN_PROGRESS / BLOCKED / FAILED — an open ticket. Every
      // one is work someone still owns (BLOCKED/FAILED are exactly the ones to
      // come back to), so none is cleanup-eligible: treat as developing.
      return "developing";
  }
}

/** Cleanup-eligible categories (the ones a bulk prune may target). */
export function isCleanupCategory(category: WorktreeCategory): boolean {
  return category === "cleanupMerged" || category === "cleanupStale";
}

/**
 * Whether a worktree is a SAFE bulk-cleanup candidate.
 *
 * Two independent gates, both required:
 *  1. its lifecycle category is a cleanup one ({@link isCleanupCategory}) — the
 *     ticket is DONE or absent, and (by category ordering) it is not developing,
 *     so it is neither dirty nor agent-held; AND
 *  2. {@link archiveSafetyBlocker} clears it — this re-asserts dirty/busy AND
 *     adds the `unpushed` veto (local-only commits that removal would destroy).
 *
 * ★ The `unpushed` gate matters because the renderer now drives cleanup by
 * removing each candidate explicitly (the main-process repo-wide `cleanupStale`
 * skips unpushed for us, but force-removes dirty — the bug we route around).
 * Replicating the unpushed guard here keeps the explicit path strictly safer
 * than the old one: it loses neither uncommitted nor unpushed work.
 */
export function isCleanupCandidate(
  worktree: Worktree,
  task: Task | null,
  signals: ArchiveSignals = {},
): boolean {
  if (!isCleanupCategory(worktreeCategory(worktree, task, signals))) {
    return false;
  }
  return archiveSafetyBlocker(worktree, signals) === null;
}
