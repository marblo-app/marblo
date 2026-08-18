const BUSY_ACTIVITY_STATES = new Set([
  "active",
  "busy",
  "generating",
  "in-progress",
  "in_progress",
  "pending",
  "responding",
  "running",
  "starting",
  "streaming",
  "thinking",
  "working",
]);

const SETTLED_ACTIVITY_STATES = new Set([
  "complete",
  "completed",
  "done",
  "error",
  "failed",
  "idle",
  "ready",
  "stopped",
  "success",
]);

function normalizeActivityState(state: string | undefined): string {
  return (state ?? "").trim().toLowerCase();
}

export type TerminalActivitySettleIntent = "schedule" | "cancel" | "ignore";

export function isBusyTerminalActivityState(
  state: string | undefined,
): boolean {
  return BUSY_ACTIVITY_STATES.has(normalizeActivityState(state));
}

export function isSettledTerminalActivityState(
  state: string | undefined,
): boolean {
  return SETTLED_ACTIVITY_STATES.has(normalizeActivityState(state));
}

export function isTerminalActivitySettlingTransition(
  previous: string | undefined,
  next: string | undefined,
): boolean {
  const prev = normalizeActivityState(previous);
  const nextState = normalizeActivityState(next);
  if (!prev || !nextState || prev === nextState) return false;
  const wasBusy = BUSY_ACTIVITY_STATES.has(prev);
  if (!wasBusy) return false;
  return (
    SETTLED_ACTIVITY_STATES.has(nextState) ||
    !BUSY_ACTIVITY_STATES.has(nextState)
  );
}

export function getTerminalActivitySettleIntent(
  previous: string | undefined,
  next: string | undefined,
): TerminalActivitySettleIntent {
  if (isBusyTerminalActivityState(next)) return "cancel";
  if (isTerminalActivitySettlingTransition(previous, next)) return "schedule";
  return "ignore";
}
