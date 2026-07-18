/**
 * Per-task cost / retry rollups on the `tasks/<id>` doc.
 *
 * Why these live on the task doc rather than being computed at completion:
 * the numbers they accumulate arrive as a *stream* (cost deltas from the PTY
 * cost tracker, restart events from the agent watchdog) that is gone by the
 * time the task reaches a terminal status. Firestore `increment()` is atomic
 * across windows and survives an app restart, which an in-memory counter does
 * not — and tasks routinely stay open for hours (7.3h median lead time).
 *
 * Dual-use (see docs/research/routing-slm-data-collection.md §5): the same
 * counters answer "what did this ticket cost us?" for the audit wedge and
 * "what did this label cost?" for SLM training, from one write.
 *
 * ── Write amplification ──────────────────────────────────────────────────
 * cost:update fires every few seconds per agent. Writing Firestore on each
 * delta would burn quota and, worse, retrigger the tasks subscription on every
 * tick — re-rendering the board continuously. So cost deltas are buffered in
 * memory and flushed on an interval; retries are rare and flush immediately.
 * `flushTaskRollups(taskId)` forces a flush so a completing task's final row
 * includes the tail of the stream.
 */

import { doc, updateDoc, increment } from "firebase/firestore";
import { db } from "../lib/firebase";

/** Buffered cost deltas awaiting a flush, keyed by taskId. */
interface PendingCost {
  cost: number;
  inputTokens: number;
  outputTokens: number;
}

const pending = new Map<string, PendingCost>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Long enough to collapse a burst of token deltas, short enough that a
 *  crash loses at most one window of cost attribution. */
const FLUSH_INTERVAL_MS = 15_000;

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushTaskRollups();
  }, FLUSH_INTERVAL_MS);
}

/**
 * Apply buffered deltas for one task (or all tasks when `taskId` is omitted).
 * Best-effort: a missing task doc (deleted ticket, ad-hoc agent) is not an
 * error — the deltas are simply dropped rather than retried forever.
 */
export async function flushTaskRollups(taskId?: string): Promise<void> {
  const ids = taskId ? [taskId] : [...pending.keys()];
  await Promise.all(
    ids.map(async (id) => {
      const buffered = pending.get(id);
      if (!buffered) return;
      // Remove BEFORE awaiting so concurrent deltas accumulate into a fresh
      // bucket instead of being double-counted or lost by this flush.
      pending.delete(id);
      try {
        await updateDoc(doc(db, "tasks", id), {
          costTotal: increment(buffered.cost),
          costInputTokens: increment(buffered.inputTokens),
          costOutputTokens: increment(buffered.outputTokens),
        });
      } catch (err) {
        console.warn(
          `[TaskRollups] cost rollup skipped for task=${id}:`,
          (err as { code?: string; message?: string })?.code ||
            (err as { message?: string })?.message ||
            err,
        );
      }
    }),
  );
}

/**
 * Buffer one cost delta against a task. Called from the cost:update stream,
 * which already carries the agent's currentTaskId — the same stamp that gives
 * cost_logs its 98.6% join rate.
 */
export function recordTaskCost(
  taskId: string,
  delta: { cost?: number; inputTokens?: number; outputTokens?: number },
): void {
  if (!taskId) return;
  const cost = Number(delta.cost) || 0;
  const inputTokens = Number(delta.inputTokens) || 0;
  const outputTokens = Number(delta.outputTokens) || 0;
  if (cost === 0 && inputTokens === 0 && outputTokens === 0) return;

  const current = pending.get(taskId) ?? {
    cost: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
  current.cost += cost;
  current.inputTokens += inputTokens;
  current.outputTokens += outputTokens;
  pending.set(taskId, current);
  scheduleFlush();
}

/**
 * Increment a task's retry counter. Fired when the agent bound to the task is
 * auto-restarted after a crash — the signal the research doc calls out as
 * "재시도 많음 = 그 모델이 이 태스크에 안 맞음" (§3.3), previously observable
 * only per-agent and therefore never attributable to a task.
 *
 * Written immediately: restarts are rare, and losing one to a buffer window
 * would silently understate the very signal this exists to capture.
 */
export async function recordTaskRetry(taskId: string): Promise<void> {
  if (!taskId) return;
  try {
    await updateDoc(doc(db, "tasks", taskId), {
      retriesCount: increment(1),
    });
  } catch (err) {
    console.warn(
      `[TaskRollups] retry rollup skipped for task=${taskId}:`,
      (err as { code?: string; message?: string })?.code ||
        (err as { message?: string })?.message ||
        err,
    );
  }
}

/** Test seam — drops buffered state without writing. */
export function __resetTaskRollupsForTest(): void {
  pending.clear();
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}
