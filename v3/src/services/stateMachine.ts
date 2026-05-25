import type { TaskStatus } from "../types/task";

const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  // CLAIMED → TODO is the manual claim-recall path: a teammate's claim
  // gets reverted because that teammate is offline (or stuck) and another
  // member wants to pick the task up. See `unclaimTask` in taskService.
  TODO: ["CLAIMED", "IN_PROGRESS"],
  CLAIMED: ["IN_PROGRESS", "REVIEW", "DONE", "FAILED", "TODO"],
  IN_PROGRESS: ["REVIEW", "DONE", "BLOCKED", "FAILED"],
  REVIEW: ["DONE", "TODO", "IN_PROGRESS"],
  BLOCKED: ["IN_PROGRESS", "TODO"],
  FAILED: ["TODO", "IN_PROGRESS"],
  DONE: [],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid status transition: ${from} → ${to}`);
  }
}

export function getNextStatuses(current: TaskStatus): TaskStatus[] {
  return VALID_TRANSITIONS[current] ?? [];
}
