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
export function isTerminalTaskStatus(status) {
    return status === "DONE" || status === "FAILED";
}
/**
 * PTY-silence window an agent on a terminal task must exceed before it's
 * considered stale. Mirrors AgentManager's working→idle demotion window
 * (IDLE_INACTIVITY_MS, 5 min) so a reap never races a status the heartbeat is
 * still about to flip on its own.
 */
export const STALE_TERMINAL_REAP_MS = 300_000; // 5 min
/**
 * Decide whether a stale agent bound to a terminal task should be reaped.
 * Pure: no I/O, no clock — every input is supplied by the caller.
 */
export function evaluateTerminalTaskReap(input) {
    const { currentTaskId, taskStatus, lastPtyActivity, now, staleMs = STALE_TERMINAL_REAP_MS, } = input;
    if (!currentTaskId) {
        return {
            reap: false,
            reason: "no connected task — cannot prove work done",
        };
    }
    if (!isTerminalTaskStatus(taskStatus)) {
        return {
            reap: false,
            reason: `connected task ${currentTaskId} is ${taskStatus ?? "unknown"} (not terminal)`,
        };
    }
    const idleMs = now - lastPtyActivity;
    if (idleMs < staleMs) {
        return {
            reap: false,
            reason: `connected task ${currentTaskId} ${taskStatus} but agent active ${Math.round(idleMs / 1000)}s ago (< ${Math.round(staleMs / 1000)}s grace)`,
        };
    }
    return {
        reap: true,
        reason: `connected task ${currentTaskId} ${taskStatus}; PTY idle ${Math.round(idleMs / 1000)}s ≥ ${Math.round(staleMs / 1000)}s`,
    };
}
//# sourceMappingURL=agent-reap.js.map