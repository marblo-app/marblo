import type { Worktree } from "../types/worktree";
import type { Task } from "../types/task";
import type { Agent } from "../types/agent";

/**
 * Pure helpers linking a task ↔ its worktree ↔ its agent.
 *
 * These back the "이 워크트리 보기" (view-this-worktree) button on the board
 * card and ticket detail, and the sanctioned {@link viewWorktree} action.
 * Kept side-effect-free so they can be unit-tested without stores.
 */

/** Strip trailing separators so "/repo" and "/repo/" compare equal. */
function normalizePath(p: string): string {
  return p.replace(/[\\/]+$/, "");
}

/**
 * Trailing-separator-tolerant path equality. The renderer can't resolve
 * symlinks, so this only normalises trailing separators — the same tolerance
 * `fileTreeView.samePath` uses for the sidebar header.
 */
export function sameWorktreePath(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;
  return normalizePath(a) === normalizePath(b);
}

/**
 * Resolve the worktree backing a task.
 *
 * Worktrees don't carry an explicit task link on every creation path, so match
 * with progressively looser fallbacks: an explicit `taskId`, then the id
 * embedded in the worktree path (`.../<projectId>/<taskId>`), then the branch
 * name. Moved out of TaskDetailModal so the card, the detail modal and the
 * view-worktree action all resolve the *same* worktree.
 */
export function findTaskWorktree(
  worktrees: Worktree[],
  task: Pick<Task, "id">,
): Worktree | null {
  return (
    worktrees.find((worktree) => worktree.taskId === task.id) ??
    worktrees.find((worktree) =>
      worktree.path.split(/[\\/]+/).includes(task.id),
    ) ??
    worktrees.find((worktree) => worktree.branch.includes(task.id)) ??
    null
  );
}

/**
 * Resolve the agent working a task → its agent-doc id (the key the bottom
 * AgentListPanel focuses on).
 *
 * Worktrees always carry `agentId: null`, so the link runs through the task:
 *   1. `claimedBy` — stored as either the agent's name (manual UI assign) or
 *      its id (MCP `claim_task`). Match both, mirroring TaskCard / AgentAssign;
 *      one-sided matching silently misses the other write path.
 *   2. `currentTaskId` — the agent's own pointer back at the task, used as a
 *      fallback when `claimedBy` is stale/unset.
 * Returns null when no agent can be resolved (button then just switches the
 * file tree without a focus change).
 */
export function resolveTaskAgentId(
  agents: Pick<Agent, "id" | "name" | "currentTaskId">[],
  task: Pick<Task, "id" | "claimedBy">,
): string | null {
  const claimedBy = task.claimedBy;
  if (claimedBy) {
    const normalized = claimedBy.toLowerCase();
    const byClaim = agents.find(
      (a) =>
        a.id === claimedBy ||
        a.name === claimedBy ||
        a.name.toLowerCase() === normalized,
    );
    if (byClaim) return byClaim.id;
  }
  const byTask = agents.find((a) => a.currentTaskId === task.id);
  return byTask?.id ?? null;
}

/**
 * The `Worktree.id` whose checkout the file tree is currently rooted at, given
 * the authoritative `rootPath`. This is the reconcile function behind the
 * `activeWorktree` concept: rather than storing a second id that can drift from
 * rootPath, we derive it from rootPath (the single source of truth) and cache
 * it. Returns null when the root isn't a known worktree (main checkout via its
 * project-folder path, an ad-hoc browse folder, etc.).
 */
export function resolveActiveWorktreeId(
  worktrees: Worktree[],
  rootPath: string | null,
): string | null {
  if (!rootPath) return null;
  const match = worktrees.find((w) => sameWorktreePath(w.path, rootPath));
  return match?.id ?? null;
}
