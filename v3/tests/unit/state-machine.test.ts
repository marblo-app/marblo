import { describe, it, expect } from 'vitest';
import { canTransition, getAction, getNextStatuses, type TaskStatus } from '../../electron/mcp-server/state-machine';

describe('canTransition', () => {
  const validPairs: [TaskStatus, TaskStatus][] = [
    ['TODO', 'CLAIMED'],
    ['CLAIMED', 'IN_PROGRESS'],
    ['CLAIMED', 'FAILED'],
    ['IN_PROGRESS', 'REVIEW'],
    ['IN_PROGRESS', 'BLOCKED'],
    ['IN_PROGRESS', 'FAILED'],
    ['REVIEW', 'DONE'],
    ['REVIEW', 'TODO'],
    ['BLOCKED', 'IN_PROGRESS'],
    ['FAILED', 'TODO'],
  ];

  it.each(validPairs)('allows %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  const invalidPairs: [TaskStatus, TaskStatus][] = [
    ['TODO', 'IN_PROGRESS'],
    ['TODO', 'DONE'],
    ['CLAIMED', 'REVIEW'],
    ['CLAIMED', 'DONE'],
    ['IN_PROGRESS', 'TODO'],
    ['IN_PROGRESS', 'DONE'],
    ['REVIEW', 'IN_PROGRESS'],
    ['REVIEW', 'BLOCKED'],
    ['DONE', 'TODO'],
    ['DONE', 'IN_PROGRESS'],
    ['BLOCKED', 'TODO'],
    ['FAILED', 'IN_PROGRESS'],
  ];

  it.each(invalidPairs)('blocks %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });
});

describe('getAction', () => {
  it('returns correct action names', () => {
    expect(getAction('TODO', 'CLAIMED')).toBe('claim');
    expect(getAction('CLAIMED', 'IN_PROGRESS')).toBe('start_work');
    expect(getAction('IN_PROGRESS', 'REVIEW')).toBe('submit_review');
    expect(getAction('IN_PROGRESS', 'BLOCKED')).toBe('blocked');
    expect(getAction('IN_PROGRESS', 'FAILED')).toBe('failed');
    expect(getAction('REVIEW', 'DONE')).toBe('approve');
    expect(getAction('REVIEW', 'TODO')).toBe('reject');
    expect(getAction('BLOCKED', 'IN_PROGRESS')).toBe('resolve');
    expect(getAction('FAILED', 'TODO')).toBe('retry');
  });

  it('returns null for invalid transitions', () => {
    expect(getAction('TODO', 'DONE')).toBeNull();
    expect(getAction('DONE', 'TODO')).toBeNull();
  });
});

describe('getNextStatuses', () => {
  it('returns valid targets from TODO', () => {
    expect(getNextStatuses('TODO')).toEqual(['CLAIMED']);
  });

  it('returns valid targets from IN_PROGRESS', () => {
    const next = getNextStatuses('IN_PROGRESS');
    expect(next).toContain('REVIEW');
    expect(next).toContain('BLOCKED');
    expect(next).toContain('FAILED');
  });

  it('returns empty array from DONE', () => {
    expect(getNextStatuses('DONE')).toEqual([]);
  });

  it('returns valid targets from REVIEW', () => {
    const next = getNextStatuses('REVIEW');
    expect(next).toContain('DONE');
    expect(next).toContain('TODO');
  });
});
