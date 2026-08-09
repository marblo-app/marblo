/**
 * Single choke point that emits `task_outcomes` ML rows.
 *
 * ── Why this is not in updateTaskStatus() ────────────────────────────────
 * The outcome writer used to live inside `taskService.updateTaskStatus`, which
 * only the *renderer* calls. Agents don't use it: the MCP `update_task_status`
 * tool (electron/mcp-server/tools.ts) writes Firestore directly via
 * applyProjection, and the MCP server contains no telemetry code at all.
 *
 * That is the real reason BigQuery held 216 dispatch decisions against 29
 * outcome rows with exactly 1 successful join (doc §2.3): only the rare
 * "human clicked DONE in the UI" path ever produced a row. Fixing the label
 * fields in place would have left that gap wide open — correct labels that
 * still never get written.
 *
 * So reporting is driven off the tasks *subscription* instead. Every writer —
 * UI, MCP, orchestrator, watchdog — lands in Firestore, so observing the
 * collection catches all of them with one implementation.
 *
 * ── Two things that must not happen ──────────────────────────────────────
 * 1. **Backfill flood.** On first snapshot every historical DONE task would
 *    look like a fresh completion and emit a row with a retroactive timestamp
 *    and no cost. Guarded by seeding: the first snapshot only records current
 *    statuses and emits nothing. Only an observed *transition* reports.
 * 2. **Duplicate rows.** Several windows may subscribe to the same project.
 *    Guarded by a Firestore transaction that claims the report on the task
 *    doc; only the winner sends.
 *
 * ── Reading the data downstream ──────────────────────────────────────────
 * A task can legitimately produce more than one row over its life
 * (BLOCKED → later DONE). Rows are append-only and each carries its own
 * `completedAt`, so **the latest row per taskId is the authoritative outcome**;
 * earlier rows are the recovery history.
 *
 * `errorCategory` 는 이제 터미널 상태가 아니라 **실패 귀책 어휘**다
 * (#890 F-6 / 감사 G10 — `MODEL_FAIL` / `NO_OUTPUT` / `TIMEOUT` / `TOOL` /
 * `AUTH` / `BLOCKED_DEP` / `CANCELLED`). 상태 자체는 `success` 로 남고, 이 축은
 * "모델이 못한 것" 과 "태스크가 막힌 것" 을 가른다 — 그 구분 없이는 음성 라벨의
 * 85% 가 BLOCKED 라 학습이 정반대 정책을 배운다. ★이 변경 **이전** 행은 옛
 * 어휘("FAILED"/"BLOCKED")를 담고 있으므로 두 시기를 섞어 세지 말 것.
 */

import { doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../lib/firebase";
import type { Task } from "../types/task";
import { getClientId, isTelemetryEnabled } from "./telemetryService";
import { getDocument } from "./firestore";
import { flushTaskRollups } from "./taskRollups";
import {
  buildTaskOutcome,
  isTerminalTaskStatus,
  type AgentModelSnapshot,
  type TerminalTaskStatus,
} from "../lib/telemetry/taskOutcome";

const logTaskOutcomeFn = httpsCallable(functions, "logTaskOutcome");

/** Last status we observed per taskId, so we only act on real transitions. */
const observedStatus = new Map<string, string>();
/** Guards against re-entrancy while an async report is in flight. */
const inFlight = new Set<string>();

/** Shape of the rollup counters as stored on the task doc. */
interface TaskRollupFields {
  costTotal?: number;
  costInputTokens?: number;
  costOutputTokens?: number;
  retriesCount?: number;
  outcomeReportedStatus?: string;
}

/**
 * Claim the right to report `status` for this task, atomically.
 *
 * Returns false if another window (or an earlier run) already reported this
 * exact status. Keyed on the status rather than a plain boolean so a task that
 * moves BLOCKED → DONE still emits its final, positive outcome.
 */
async function claimOutcomeReport(
  taskId: string,
  status: TerminalTaskStatus,
): Promise<boolean> {
  const ref = doc(db, "tasks", taskId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return false;
    if ((snap.data() as TaskRollupFields).outcomeReportedStatus === status) {
      return false;
    }
    tx.update(ref, {
      outcomeReportedStatus: status,
      outcomeReportedAt: serverTimestamp(),
    });
    return true;
  });
}

/**
 * Build and send the outcome row for a task that just reached a terminal
 * status. Best-effort: analytics must never break task completion.
 */
export async function reportTaskOutcome(
  task: Task,
  status: TerminalTaskStatus,
): Promise<void> {
  // Same gate as every other first-party sink — opted-out installs send
  // nothing. Checked before the Firestore claim so an opted-out client
  // doesn't consume the marker and mute a teammate's window.
  if (!isTelemetryEnabled()) return;
  if (inFlight.has(task.id)) return;
  inFlight.add(task.id);

  try {
    // Land buffered cost deltas first so the row carries the full spend
    // instead of everything up to the last 15s flush.
    await flushTaskRollups(task.id);

    if (!(await claimOutcomeReport(task.id, status))) return;

    // Re-read after the flush + claim so the rollups are the post-flush values.
    const fresh = await getDocument<TaskRollupFields>("tasks", task.id);

    let agent: AgentModelSnapshot | null = null;
    if (task.claimedBy) {
      try {
        agent = await getDocument<AgentModelSnapshot>("agents", task.claimedBy);
      } catch {
        agent = null; // orchestrator sessions have no agent doc
      }
    }

    const outcome = buildTaskOutcome({
      clientId: getClientId(),
      taskId: task.id,
      status,
      task,
      rollups: fresh,
      agent,
    });

    await logTaskOutcomeFn({ outcome });
  } catch (err) {
    console.warn("[TaskOutcome] Failed to log outcome:", err);
  } finally {
    inFlight.delete(task.id);
  }
}

/**
 * Feed each tasks snapshot through here. Emits an outcome for every task
 * observed transitioning into a terminal status.
 *
 * A task seen for the first time is only recorded, never reported — that is
 * what prevents the backfill flood described above, and it also means a
 * completion that happens while no window is subscribed is not captured. That
 * gap is acceptable in practice: agents run inside the app, so a window is
 * open whenever an agent moves a task.
 */
export function observeTaskSnapshot(tasks: Task[]): void {
  for (const task of tasks) {
    const previous = observedStatus.get(task.id);
    observedStatus.set(task.id, task.status);

    if (previous === undefined) continue; // first sighting — seed only
    if (previous === task.status) continue;
    if (!isTerminalTaskStatus(task.status)) continue;

    void reportTaskOutcome(task, task.status);
  }
}

/**
 * Drop observation state — call when switching projects or tearing down the
 * subscription so the next snapshot re-seeds instead of reporting the new
 * project's existing terminal tasks as fresh completions.
 */
export function resetTaskOutcomeObserver(): void {
  observedStatus.clear();
  inFlight.clear();
}
