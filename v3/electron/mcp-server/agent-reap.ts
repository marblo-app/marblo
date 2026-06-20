/**
 * Pure decision logic for reaping stale agents whose connected task has reached
 * a terminal state.
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
 *   1. The agent must be bound to a task (`currentTaskId`). With no task we
 *      cannot prove its work is done, so we never reap it here.
 *   2. That task must be terminal (DONE/FAILED). This is the load-bearing
 *      signal — a live task means live work, full stop.
 *   3. The agent must have been PTY-silent for at least `staleMs`. This keeps
 *      the agent that *just* reported DONE and is still finishing its turn
 *      from being rug-pulled mid-sentence.
 *
 * Only when all three hold do we return `{ reap: true }`. The PTY status
 * (`working` vs `idle`) is intentionally NOT a gate: a zombie can keep emitting
 * spinner noise and stay `working` indefinitely, which is exactly the case the
 * old status-only filter missed.
 */

/** Task statuses that mean the task is closed and its agent has no live work. */
export function isTerminalTaskStatus(status: unknown): boolean {
  return status === "DONE" || status === "FAILED";
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
   * Status of the task named by `currentTaskId`, as read from the board.
   * `null`/`undefined` when the task could not be resolved (missing doc /
   * lookup failure) — treated as non-terminal (preserve).
   */
  taskStatus: string | null | undefined;
  /** epoch-ms of the agent's most recent PTY output. */
  lastPtyActivity: number;
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
    taskStatus,
    lastPtyActivity,
    now,
    staleMs = STALE_TERMINAL_REAP_MS,
  } = input;

  // The orchestrator is a permanent coordinator, never a finished worker. No
  // terminal-task + idle combination should ever reap it — preserve before any
  // other check.
  if (role === "orchestrator") {
    return {
      reap: false,
      reason: "orchestrator is a long-lived coordinator — never auto-reaped",
    };
  }

  if (!currentTaskId) {
    return {
      reap: false,
      reason: "no connected task — cannot prove work done",
    };
  }

  if (!isTerminalTaskStatus(taskStatus)) {
    return {
      reap: false,
      reason: `connected task ${currentTaskId} is ${
        taskStatus ?? "unknown"
      } (not terminal)`,
    };
  }

  const idleMs = now - lastPtyActivity;
  if (idleMs < staleMs) {
    return {
      reap: false,
      reason: `connected task ${currentTaskId} ${taskStatus} but agent active ${Math.round(
        idleMs / 1000,
      )}s ago (< ${Math.round(staleMs / 1000)}s grace)`,
    };
  }

  return {
    reap: true,
    reason: `connected task ${currentTaskId} ${taskStatus}; PTY idle ${Math.round(
      idleMs / 1000,
    )}s ≥ ${Math.round(staleMs / 1000)}s`,
  };
}
