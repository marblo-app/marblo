/**
 * Pure decision logic for reconciling an agent's live working/idle status after
 * it has finished a turn (W1).
 *
 * Background: when a worker calls submit_for_review / update_task_status(REVIEW·
 * DONE·FAILED·BLOCKED), the MCP tool POSTs /set-agent-status → AgentManager
 * demotes the agent working→idle. But the worker is STILL flushing its final
 * turn output, and every PTY chunk runs the onData hook which promotes
 * idle→working again. The agent therefore snaps back to `working` a beat after
 * the completion signal and stays there until the 5-min heartbeat idle window —
 * so the orchestrator sees a permanently `[working]` slot that never frees, and
 * treats a finished agent as "still running" (the exact stale-slot bug: 3 agents
 * — qa-freshuser / onboarding-cli-gate / web-guide-page — all stuck [working]
 * after completing).
 *
 * The fix is a short "turn-complete settle window": once an agent's bound task
 * goes terminal we stamp `turnCompletedAt`, and for a brief window afterwards we
 * SUPPRESS the trailing-output idle→working promotion (that output is the render
 * flush of the just-finished turn, not new work). The heartbeat additionally
 * demotes any agent still marked `working` whose turn completed and whose PTY
 * has been quiet for the settle window — a belt-and-suspenders in case a chunk
 * promoted it to `working` in the race BEFORE the completion signal landed.
 *
 * All decisions are pure (no clock, no I/O) so they unit-test without a live
 * PTY / Electron. AgentManager owns the mutable `turnCompletedAt` field and
 * feeds these functions.
 */

/** Settle window after a turn completes during which trailing PTY output must
 * NOT re-promote the agent to `working`, and after which a still-`working`
 * completed agent is demoted. Short (vs IDLE_INACTIVITY_MS = 5 min) so the slot
 * frees within seconds of submit — the W1 acceptance criterion — while still
 * long enough to absorb a normal end-of-turn render flush. A genuinely NEW turn
 * (dispatch / route / nudge) clears `turnCompletedAt`, so real follow-up work is
 * never suppressed beyond this window. */
export const TURN_COMPLETE_SETTLE_MS = 12_000; // 12s

export interface PromotionInput {
  /** Current live status of the agent. */
  status: "idle" | "working" | "error" | "stopped";
  /** True once stop()/kill() has been requested — never auto-promote then. */
  stopRequested: boolean;
  /** epoch-ms the agent's bound task last went terminal (turn finished), or
   * null when the agent has no just-completed turn. */
  turnCompletedAt: number | null;
  /** epoch-ms now. */
  now: number;
  /** Override the settle window (defaults to TURN_COMPLETE_SETTLE_MS). */
  settleMs?: number;
}

/**
 * Should a PTY-output chunk promote an `idle` agent to `working`?
 *
 * Normally yes (that is how AgentManager auto-derives "working"). But within the
 * settle window after a completed turn we say NO: the bytes are the trailing
 * flush of the finished turn, and promoting on them is exactly what strands the
 * slot at `[working]`. Returns false for stopRequested / non-idle as well (the
 * caller only promotes from idle, but the guard is explicit).
 */
export function shouldPromoteOnPtyOutput(input: PromotionInput): boolean {
  const { status, stopRequested, turnCompletedAt, now } = input;
  const settleMs = input.settleMs ?? TURN_COMPLETE_SETTLE_MS;
  if (stopRequested) return false;
  if (status !== "idle") return false;
  if (turnCompletedAt !== null && now - turnCompletedAt < settleMs) {
    // Inside the settle window — trailing output of a finished turn.
    return false;
  }
  return true;
}

/**
 * Heartbeat reconcile: should a `working` agent whose turn has completed be
 * demoted to `idle`? True when the bound task went terminal (`turnCompletedAt`
 * set) and the PTY has been quiet for the settle window — i.e. the race where a
 * chunk promoted it to `working` just before the completion signal, so the
 * immediate /set-agent-status demote was overwritten. Does NOT wait the full
 * 5-min IDLE_INACTIVITY_MS, so the slot frees promptly.
 */
export function shouldDemoteCompletedTurn(input: {
  status: "idle" | "working" | "error" | "stopped";
  stopRequested: boolean;
  turnCompletedAt: number | null;
  lastPtyActivity: number;
  now: number;
  settleMs?: number;
}): boolean {
  const settleMs = input.settleMs ?? TURN_COMPLETE_SETTLE_MS;
  if (input.stopRequested) return false;
  if (input.status !== "working") return false;
  if (input.turnCompletedAt === null) return false;
  // Turn completed AND the PTY has settled → the trailing flush is over and no
  // new work resumed. Free the slot.
  return input.now - input.lastPtyActivity >= settleMs;
}

/** Task statuses that mean the agent's turn is finished and its slot should be
 * released immediately (idempotent completion signal from the MCP tools). */
export function isTurnEndingStatus(status: unknown): boolean {
  return (
    status === "REVIEW" ||
    status === "DONE" ||
    status === "FAILED" ||
    status === "BLOCKED"
  );
}
