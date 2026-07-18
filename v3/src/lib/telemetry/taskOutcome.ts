/**
 * Builder for `task_outcomes` ML rows — the "수도꼭지" (faucet) that was
 * emitting constants instead of labels.
 *
 * Prior behaviour (taskService.ts, before this module):
 *   success: true            // constant — zero negative labels, so a
 *                            // classifier had nothing to contrast against
 *   taskType: null           // hardcoded TODO
 *   retriesCount: 0          // hardcoded
 *   totalCost / tokens       // agent LIFETIME totals, not per-task; landed
 *                            // as 0/NULL in 29/29 BigQuery rows
 *
 * Evidence: docs/research/routing-slm-data-collection.md §1 (status table)
 * and §3 (defects A/B/C).
 *
 * This module is deliberately pure so the label logic can be tested without
 * Firestore, Cloud Functions or an Electron window. IO lives in
 * services/taskOutcomeReporter.ts.
 *
 * ── Schema contract ──────────────────────────────────────────────────────
 * Every field below is ALREADY part of the `task_outcomes` BigQuery table:
 * functions/src/index.ts (logTaskOutcome) writes all of them on every insert,
 * defaulting to null. Today's inserts succeed, which proves the columns
 * exist — so this change needs **no BigQuery migration**, same as PR#480.
 * Do not add a field here without adding it to the server row first; a
 * streaming insert with an unknown column fails and drops the whole row.
 */

import { classifyTaskType, type TaskType } from "./taskType";

/** Statuses that produce an outcome row. */
export type TerminalTaskStatus = "DONE" | "FAILED" | "BLOCKED";

export const TERMINAL_TASK_STATUSES: readonly TerminalTaskStatus[] = [
  "DONE",
  "FAILED",
  "BLOCKED",
] as const;

export function isTerminalTaskStatus(
  status: string,
): status is TerminalTaskStatus {
  return (TERMINAL_TASK_STATUSES as readonly string[]).includes(status);
}

/** Per-task cost/retry rollups accumulated on the `tasks/<id>` doc. */
export interface TaskRollups {
  costTotal?: number | null;
  costInputTokens?: number | null;
  costOutputTokens?: number | null;
  retriesCount?: number | null;
}

/** Subset of `agents/<id>` used as a fallback model source. */
export interface AgentModelSnapshot {
  model?: string | null;
  detectedModelId?: string | null;
}

export interface BuildTaskOutcomeInput {
  clientId: string;
  taskId: string;
  status: TerminalTaskStatus;
  task: {
    projectId?: string | null;
    title?: string | null;
    goal?: string | null;
    description?: string | null;
    role?: string | null;
    priority?: number | null;
    scope?: string[] | null;
    claimedAt?: Date | null;
    createdAt?: Date | null;
  };
  rollups?: TaskRollups | null;
  agent?: AgentModelSnapshot | null;
  /** Injected for determinism in tests. */
  now?: Date;
}

export interface TaskOutcomeRow {
  clientId: string;
  taskId: string;
  projectId: string | null;
  taskType: TaskType | null;
  taskComplexity: number | null;
  role: string | null;
  model: string | null;
  promptLength: number | null;
  scopeFileCount: number;
  success: boolean;
  durationMs: number | null;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  totalCost: number | null;
  retriesCount: number;
  errorCategory: string | null;
  createdAt: string;
  completedAt: string;
}

/**
 * Non-negative finite number, or null. Guards the cost/retry rollups: a
 * corrupt or partially-written counter must not poison the training set with
 * NaN / Infinity / negative values, and BigQuery would reject NaN outright.
 */
function sanitizeCount(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

export function buildTaskOutcome(input: BuildTaskOutcomeInput): TaskOutcomeRow {
  const { clientId, taskId, status, task, rollups, agent } = input;
  const now = input.now ?? new Date();

  // ── Defect ① — success is now the real terminal status ────────────────
  // DONE means the work was accepted; FAILED and BLOCKED are the negative
  // class that did not exist before. `errorCategory` keeps the *reason*
  // distinguishable so an analyst can drop BLOCKED (often recoverable) while
  // keeping FAILED, without needing a new column.
  const success = status === "DONE";

  // ── durationMs — claimed → terminal ────────────────────────────────────
  // NOTE: this is ticket lead time, NOT agent working time. The research doc
  // (§3.2) reports a 7.3h median and attributes it to createdAt→DONE; the code
  // has always measured claimedAt→terminal, which is narrower but still
  // wall-clock and still includes idle/overnight gaps. It is left as-is
  // (measuring true agent-active time needs a session-level clock that does
  // not exist yet) and must NOT be used as the ML-3 cost-prediction target —
  // join `cost_logs` on taskId for that. See doc §6 [3].
  const durationMs = task.claimedAt
    ? Math.max(0, now.getTime() - new Date(task.claimedAt).getTime())
    : null;

  // ── Defect ② — per-task cost, not agent-lifetime cost ─────────────────
  // Rollups are incremented on the task doc from the cost:update stream,
  // which already carries a taskId (that stamp is what gives cost_logs its
  // 98.6% join rate). Falls back to null — never to the agent's lifetime
  // total, which is what made these columns meaningless.
  const totalCost = sanitizeCount(rollups?.costTotal);
  const totalInputTokens = sanitizeCount(rollups?.costInputTokens);
  const totalOutputTokens = sanitizeCount(rollups?.costOutputTokens);

  // ── Defect ③ — real retry count ───────────────────────────────────────
  const retriesCount = sanitizeCount(rollups?.retriesCount) ?? 0;

  // ── Defect ④ — derived task type ──────────────────────────────────────
  const taskType = classifyTaskType(task);

  // Model: prefer the cost-tracker-detected versioned id ("claude-opus-4-8")
  // over the family enum ("claude") for training fidelity.
  const model = agent?.detectedModelId ?? agent?.model ?? null;

  // promptLength: the column exists server-side but the client never sent it
  // (doc §3.2 — "서버는 받는데 클라가 안 보냄"). Description length is a
  // legitimate task-size feature and, like promptHash/promptLength on the
  // events table, ships a LENGTH only — never the text.
  const descriptionLength = task.description?.length ?? null;

  return {
    clientId,
    taskId,
    projectId: task.projectId ?? null,
    taskType,
    // Still `priority`, NOT true complexity. Kept numeric on purpose: the
    // column holds integers today and writing a "simple|standard|complex"
    // string would fail the streaming insert and drop the row. Real
    // complexity is recoverable by joining `events` (dispatch:decision
    // metadata.complexity) on taskId. Doc §1 marks this 🟡, not 🔴.
    taskComplexity: task.priority ?? null,
    role: task.role ?? null,
    model,
    promptLength: descriptionLength,
    scopeFileCount: task.scope?.length ?? 0,
    success,
    durationMs,
    totalInputTokens,
    totalOutputTokens,
    totalCost,
    retriesCount,
    // null for DONE so the column stays a clean "why did this fail" axis.
    errorCategory: success ? null : status,
    createdAt:
      task.createdAt instanceof Date
        ? task.createdAt.toISOString()
        : now.toISOString(),
    completedAt: now.toISOString(),
  };
}
