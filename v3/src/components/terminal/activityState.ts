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
  if (!previous || !next || previous === next) return false;
  const wasBusy = isBusyTerminalActivityState(previous);
  if (!wasBusy) return false;
  return (
    isSettledTerminalActivityState(next) || !isBusyTerminalActivityState(next)
  );
}
