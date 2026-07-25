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
  // ── Enriched routing ctx (recovered from the task's dispatchMeta) ──
  // The anonymous-auth MAIN process may NOT read member-scoped `tasks`
  // (#406/L2 — tasks read requires isProjectMember), so its own fetchMeta
  // backfill silently fails and a forwarded merge lands with NO model/role/
  // complexity → the cell never learns (seen-only). The renderer IS the
  // authenticated project member, so it resolves these here and passes them
  // through the IPC payload. All optional/null-safe: an un-enriched payload
  // still degrades to `{ taskType: changeType }` on the main side.
  role?: string | null;
  taskType?: string | null;
  complexity?: string | null;
  model?: string | null;
  /** ★P2-2 — 실스폰 관측 model@effort 키. 그래프 셀의 모델 축이 이 값이다.
   * 구 dispatchMeta 엔 없으므로 null 이 정상이고, 그때는 프로바이더 키로 학습한다. */
  spawnedModelKey?: string | null;
}

/** The subset of a task's dispatchMeta the routing graph attributes an outcome
 * to. Mirrors what the dispatch-meta persister writes (electron/main.ts). */
export interface MergeDispatchMeta {
  role?: string | null;
  taskType?: string | null;
  complexity?: string | null;
  model?: string | null;
  spawnedModelKey?: string | null;
}

/**
 * Fold a task's dispatchMeta into a base merge payload so the main-process
 * `recordOutcome` receives full routing ctx (role/taskType/complexity/model)
 * instead of a bare taskId. Pure — the async task read happens at the call site
 * (App.tsx), keeping this unit-testable without the firestore import chain.
 *
 * taskType falls back to the de-identified `changeType` so the cell still learns
 * a taskType signal even when dispatchMeta is absent (older / externally-created
 * tasks). A completely un-resolvable meta leaves the base payload's `taskType`
 * as `changeType` and everything else null — identical to prior behavior, never
 * worse.
 */
export function enrichMergePayload(
  base: MergeOutcomePayload,
  meta: MergeDispatchMeta | null | undefined,
): MergeOutcomePayload {
  const clean = (v: string | null | undefined): string | null =>
    typeof v === "string" && v.trim() ? v : null;
  return {
    ...base,
    role: clean(meta?.role) ?? clean(base.role),
    taskType: clean(meta?.taskType) ?? clean(base.taskType) ?? base.changeType,
    complexity: clean(meta?.complexity) ?? clean(base.complexity),
    model: clean(meta?.model) ?? clean(base.model),
    spawnedModelKey:
      clean(meta?.spawnedModelKey) ?? clean(base.spawnedModelKey),
  };
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
