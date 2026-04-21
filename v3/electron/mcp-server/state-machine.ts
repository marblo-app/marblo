export type TaskStatus = 'TODO' | 'CLAIMED' | 'IN_PROGRESS' | 'REVIEW' | 'BLOCKED' | 'FAILED' | 'DONE';

const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  TODO: ['CLAIMED'],
  CLAIMED: ['IN_PROGRESS', 'FAILED'],
  IN_PROGRESS: ['REVIEW', 'BLOCKED', 'FAILED'],
  REVIEW: ['DONE', 'TODO'],
  BLOCKED: ['IN_PROGRESS'],
  FAILED: ['TODO'],
  DONE: [],
};

const STATUS_ACTION_MAP: Record<string, string> = {
  'TODO->CLAIMED': 'claim',
  'TODO->FAILED': 'cancel',
  'CLAIMED->IN_PROGRESS': 'start_work',
  'IN_PROGRESS->REVIEW': 'submit_review',
  'IN_PROGRESS->BLOCKED': 'blocked',
  'IN_PROGRESS->FAILED': 'failed',
  'REVIEW->DONE': 'approve',
  'REVIEW->TODO': 'reject',
  'BLOCKED->IN_PROGRESS': 'resolve',
  'FAILED->TODO': 'retry',
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function getAction(from: TaskStatus, to: TaskStatus): string | null {
  return STATUS_ACTION_MAP[`${from}->${to}`] ?? null;
}

export function getNextStatuses(current: TaskStatus): TaskStatus[] {
  return VALID_TRANSITIONS[current] ?? [];
}
