/**
 * Pure decision logic for reaping stale agents whose connected task has reached
 * a terminal state — or whose own completion report (`turnCompletedAt`) proves
 * the turn is finished.
 *
 * Background: `cleanup_agents` only ever reclaimed agents whose *PTY* had
 * already died (`stopped` / `error`). An agent that finished its task — the
 * task is DONE/FAILED on the board — but whose CLI is still sitting at its
 * prompt stays `working`/`idle` forever, so the batch cleanup skipped it. A
 * single session accrued 57 such zombies that had to be killed by hand.
 *
 * This module isolates the "should I reap THIS agent?" decision so it can be
 * unit-tested without a live bridge, PTY, or Firestore. The gate is
 * deliberately conservative (requirement: never misjudge a genuinely-working
 * agent):
 *
 *   1. The agent must prove its work is done — either a live/retained task
 *      binding whose board status is terminal (or a completion-report status
 *      like REVIEW when the binding was already released), OR an explicit
 *      `turnCompletedAt` stamp from submit_for_review / update_task_status.
 *   2. Real work output must have been quiet for at least `staleMs`. Prompt
 *      repaints bump raw `lastPtyActivity` forever (memo
 *      `agent_working_derived_from_pty_bytes`); we prefer `lastWorkOutput`.
 *
 * Only when both hold do we return `{ reap: true }`. The PTY status
 * (`working` vs `idle`) is intentionally NOT a gate: a zombie can keep emitting
 * spinner noise and stay `working` indefinitely, which is exactly the case the
 * old status-only filter missed.
 *
 * ── Why `lastTaskId` exists (2026-07-19, load average 44) ──────────────────
 *
 * Gate 1 originally accepted only `currentTaskId`. But `markTurnComplete` —
 * which runs on the worker's completion report, the very event that makes an
 * agent reapable — CLEARS `currentTaskId`. So the moment an agent qualified for
 * reaping it also lost the evidence proving it, and the gate could never match:
 * an agent that finished *cleanly* became permanently unreapable, while only
 * ones that died messily were collectable. A reporter saw 11 of 13 agents
 * stranded and `cleanup_agents` insisting "no reapable agents found" while the
 * 12-core box sat at load average 44; hand-killing 11 agents brought it to 1.85.
 *
 * AgentManager therefore retains the id in `lastTaskId` when it releases the
 * binding, and gate 1 accepts either. Note this does NOT loosen gate 2 — the
 * named task's board status is still re-read and still has to be terminal. We
 * are recovering evidence that was being thrown away, not lowering the bar.
 *
 * ── Why `turnCompletedAt` is authoritative (waiting-notif spam) ────────────
 *
 * After submit_for_review the board status is REVIEW, which is deliberately
 * NOT a hard terminal (a human may still send the agent back). But the agent
 * already reported it is done: `markTurnComplete` stamped `turnCompletedAt` and
 * released the binding. Holding those agents forever produced "X is waiting for
 * you" badges on finished workers that cleanup_agents refused as
 * "never bound to a task" when lastTaskId was missing. The completion stamp is
 * the load-bearing signal — board status is a secondary check when present.
 *
 * Deliberately NOT reaped: an agent that is merely unbound and quiet, with no
 * completion report behind it. "Idle and nobody claims it" is not proof of
 * finished work — it also describes an agent still starting up, one whose
 * binding was never set, and (before the status fix) one that was simply
 * thinking. Reaping on absence of evidence is how live sessions get killed, so
 * cleanup_agents reports those as suspects instead of killing them.
 */

/** Task statuses that mean the task is closed on the board. */
export function isTerminalTaskStatus(status: unknown): boolean {
  return status === "DONE" || status === "FAILED";
}

/**
 * Statuses that count as a worker completion report when the agent already
 * released its binding (`viaCompletedTurn`) or stamped `turnCompletedAt`.
 * REVIEW/BLOCKED are included because submit_for_review /
 * update_task_status(BLOCKED) free the agent the same way DONE/FAILED do.
 */
export function isCompletedReportTaskStatus(status: unknown): boolean {
  return (
    status === "DONE" ||
    status === "FAILED" ||
    status === "REVIEW" ||
    status === "BLOCKED"
  );
}

/**
 * PTY-silence window an agent on a terminal task must exceed before it's
 * considered stale. Mirrors AgentManager's working→idle demotion window
 * (IDLE_INACTIVITY_MS, 5 min) so a reap never races a status the heartbeat is
 * still about to flip on its own.
 */
export const STALE_TERMINAL_REAP_MS = 300_000; // 5 min

export interface AgentReapInput {
  /**
   * The agent's role. The orchestrator is a long-lived singleton coordinator —
   * it legitimately sits PTY-silent while waiting on its subagents to report
   * back, and it stays bound (currentTaskId) to tasks it has just driven to a
   * terminal state. It must NEVER be auto-reaped, or it vanishes from the agent
   * list AND its terminal tab mid-session, taking its in-flight context with
   * it. Any other role (or omitted) is reaped under the normal gate.
   */
  role?: string;
  /** The task this agent is currently bound to, or null if unbound. */
  currentTaskId: string | null;
  /**
   * The task this agent was LAST bound to, retained after `markTurnComplete`
   * released the binding on the agent's completion report. Used only when
   * `currentTaskId` is null — see the header note. null when the agent never
   * had a binding (never dispatched a task), which stays unreapable unless
   * `turnCompletedAt` is set.
   */
  lastTaskId?: string | null;
  /**
   * Status of the task named by `currentTaskId ?? lastTaskId`, as read from the
   * board. `null`/`undefined` when the task could not be resolved (missing doc
   * / lookup failure) — treated as non-terminal for the board-status path.
   */
  taskStatus: string | null | undefined;
  /**
   * epoch-ms the agent reported its turn finished (submit_for_review /
   * update_task_status → REVIEW·DONE·FAILED·BLOCKED). When set and the agent
   * is unbound, this alone proves the turn is done — see header.
   */
  turnCompletedAt?: number | null;
  /** epoch-ms of the agent's most recent PTY output (includes prompt repaint). */
  lastPtyActivity: number;
  /**
   * epoch-ms of the last frame that counted as real work (not idle-prompt
   * repaint). Preferred silence clock — falls back to `lastPtyActivity`.
   */
  lastWorkOutput?: number | null;
  /** epoch-ms "now" (injected for deterministic tests). */
  now: number;
  /** Override the silence window; defaults to STALE_TERMINAL_REAP_MS. */
  staleMs?: number;
}

export interface AgentReapDecision {
  reap: boolean;
  /** Human-readable rationale, logged on every decision (reap or preserve). */
  reason: string;
}

function silenceClock(input: AgentReapInput): number {
  return input.lastWorkOutput ?? input.lastPtyActivity;
}

function pastGrace(
  input: AgentReapInput,
  staleMs: number,
): { ok: boolean; idleMs: number } {
  const idleMs = input.now - silenceClock(input);
  return { ok: idleMs >= staleMs, idleMs };
}

/**
 * Decide whether a stale agent bound to a terminal task should be reaped.
 * Pure: no I/O, no clock — every input is supplied by the caller.
 */
export function evaluateTerminalTaskReap(
  input: AgentReapInput,
): AgentReapDecision {
  const {
    role,
    currentTaskId,
    lastTaskId,
    taskStatus,
    turnCompletedAt = null,
    staleMs = STALE_TERMINAL_REAP_MS,
  } = input;

  // Prefer the live binding; fall back to the binding retained across a
  // completion report. Both name a task whose board status gate 2 re-checks.
  const taskId = currentTaskId ?? lastTaskId ?? null;
  const viaCompletedTurn = !currentTaskId && !!lastTaskId;
  const completionMarked = turnCompletedAt !== null && !currentTaskId;

  // The orchestrator is a permanent coordinator, never a finished worker. No
  // terminal-task + idle combination should ever reap it — preserve before any
  // other check.
  if (role === "orchestrator") {
    return {
      reap: false,
      reason: "orchestrator is a long-lived coordinator — never auto-reaped",
    };
  }

  // ── Path A: explicit completion stamp, binding already released ─────────
  // submit_for_review / DONE / FAILED / BLOCKED all call markTurnComplete.
  // Board status is optional corroboration: if a retained task is somehow back
  // in live work, preserve; otherwise the stamp alone is enough.
  if (completionMarked) {
    // Live board status on the retained id (e.g. reopened IN_PROGRESS) —
    // don't rug-pull a worker that got more work after reporting.
    if (
      taskId &&
      (taskStatus === "TODO" ||
        taskStatus === "CLAIMED" ||
        taskStatus === "IN_PROGRESS")
    ) {
      return {
        reap: false,
        reason: `completed turn but retained task ${taskId} is ${taskStatus} (live)`,
      };
    }
    const { ok, idleMs } = pastGrace(input, staleMs);
    if (!ok) {
      return {
        reap: false,
        reason: `completion reported but work-output active ${Math.round(
          idleMs / 1000,
        )}s ago (< ${Math.round(staleMs / 1000)}s grace)`,
      };
    }
    return {
      reap: true,
      reason: `completion reported${
        taskId ? ` (task ${taskId}${taskStatus ? ` ${taskStatus}` : ""})` : ""
      }; work idle ${Math.round(idleMs / 1000)}s ≥ ${Math.round(
        staleMs / 1000,
      )}s`,
    };
  }

  if (!taskId) {
    return {
      reap: false,
      reason: "no connected or completed task — cannot prove work done",
    };
  }

  const label = viaCompletedTurn ? "completed task" : "connected task";

  // Live binding still held → only hard terminals (DONE/FAILED). REVIEW while
  // still bound is unusual and must not kill an agent mid-hand-back.
  // Released binding (viaCompletedTurn) → completion-report statuses count too.
  const statusOk = viaCompletedTurn
    ? isCompletedReportTaskStatus(taskStatus)
    : isTerminalTaskStatus(taskStatus);

  if (!statusOk) {
    return {
      reap: false,
      reason: `${label} ${taskId} is ${taskStatus ?? "unknown"} (not terminal)`,
    };
  }

  const { ok, idleMs } = pastGrace(input, staleMs);
  if (!ok) {
    return {
      reap: false,
      reason: `${label} ${taskId} ${taskStatus} but agent active ${Math.round(
        idleMs / 1000,
      )}s ago (< ${Math.round(staleMs / 1000)}s grace)`,
    };
  }

  return {
    reap: true,
    reason: `${label} ${taskId} ${taskStatus}; work idle ${Math.round(
      idleMs / 1000,
    )}s ≥ ${Math.round(staleMs / 1000)}s`,
  };
}
