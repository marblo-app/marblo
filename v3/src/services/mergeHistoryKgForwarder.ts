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
