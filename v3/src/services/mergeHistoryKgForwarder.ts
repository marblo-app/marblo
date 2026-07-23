/**
 * Pure selection logic for the KG v1 feedback loop (spec #559 §7): decide which
 * merges from a `merge_history` snapshot should be forwarded to the main process
 * to fold into the machine-local routing graph.
 *
 * Why this exists: the app's own Merge button already folds its merges directly
 * in the main process (electron/main.ts recordMergeHistory). But gh/GitHub
 * merges are captured server-side into `merge_history` (#566) and never pass
 * through that path, so the local routing-graph.json stayed empty while every
 * real merge went to gh. The renderer (the authenticated project member allowed
 * to read member-scoped merge_history — cf #406/L2; the anonymous-auth main
 * process is not) subscribes and forwards each new merge to main.
 *
 * Kept dependency-free (types only) so it unit-tests without dragging the
 * firebase/firestore import chain. The thin subscribe+IPC wiring lives at the
 * App level (src/App.tsx), reusing #541's subscribeToMergeHistory.
 */
import type { MergeHistoryEntry } from "../types/mergeHistory";
import type { Task } from "../types/task";
import type { Worktree } from "../types/worktree";

export interface MergeOutcomePayload {
  taskId: string;
  /** De-identified diff category; a taskType fallback for ctx recovery. */
  changeType: string | null;
  /** Merge server-time (ms) so the graph decays historical merges correctly. */
  mergedAtMs: number | null;
}

/**
 * From a merge_history snapshot, pick the merges not yet forwarded this session.
 * Only merges attributable to a task (taskId present) can feed the routing graph
 * — a taskId-less merge can't be mapped to a dispatch's model+context, so the
 * main-side recordOutcome would drop it; we skip it here to avoid pointless IPC.
 * Mutates `forwarded` (records what we've emitted this session) — that Set dedups
 * re-delivery within a run; the graph's persistent `seen` guard (keyed
 * `taskId:merged`) absorbs cross-session re-delivery AND the app-merge path's own
 * direct fold of the same doc, so double counting is impossible either way.
 */
export function pickMergeOutcomesToForward(
  entries: MergeHistoryEntry[],
  forwarded: Set<string>,
): MergeOutcomePayload[] {
  const out: MergeOutcomePayload[] = [];
  for (const e of entries) {
    if (!e.taskId) continue;
    if (forwarded.has(e.id)) continue;
    forwarded.add(e.id);
    const mergedAtMs =
      e.mergedAt instanceof Date && !Number.isNaN(e.mergedAt.getTime())
        ? e.mergedAt.getTime()
        : null;
    out.push({
      taskId: e.taskId,
      changeType: e.changeType ?? null,
      mergedAtMs,
    });
  }
  return out;
}

export interface MergedTaskCompletionCandidate {
  mergeHistoryId: string;
  taskId: string;
}

export interface MergedTaskCompletionGuard {
  worktrees?: readonly Worktree[];
  busyTaskIds?: ReadonlySet<string>;
}

/**
 * Select merge_history docs whose task ticket should be reconciled to DONE.
 * This deliberately uses its own session guard instead of sharing the KG guard:
 * KG delivery and task status reconciliation are separate side effects, so a
 * bridge failure on one path must not suppress the other.
 */
export function pickMergedTaskCompletionCandidates(
  entries: MergeHistoryEntry[],
  seen: Set<string>,
): MergedTaskCompletionCandidate[] {
  const out: MergedTaskCompletionCandidate[] = [];
  for (const e of entries) {
    if (!e.taskId) continue;
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push({ mergeHistoryId: e.id, taskId: e.taskId });
  }
  return out;
}

/**
 * A merge_history row is hard evidence that the PR landed. The only renderer
 * status transition we allow from that evidence is REVIEW -> DONE: REVIEW means
 * the task already passed review and was waiting on merge, while all open
 * statuses still represent owned work. Local protection signals rank above the
 * merge signal so dirty, conflicting, or agent-held worktrees are never moved.
 */
export function shouldMarkMergedTaskDone(
  task: Task | null,
  guard: MergedTaskCompletionGuard = {},
): boolean {
  if (!task) return false;
  if (task.status === "DONE") return false;
  if (task.status !== "REVIEW") return false;
  if (guard.busyTaskIds?.has(task.id) === true) return false;

  const worktrees = guard.worktrees ?? [];
  for (const wt of worktrees) {
    if (wt.taskId !== task.id) continue;
    if (wt.agentId != null) return false;
    if (wt.status?.dirty === true) return false;
    if (wt.status?.mergeable === false) return false;
    if ((wt.status?.conflicts.length ?? 0) > 0) return false;
  }

  return true;
}
