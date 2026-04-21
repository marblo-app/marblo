import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';
import type { CostLog, CostSummary } from '../types/cost';

const getCostLogsFn = httpsCallable(functions, 'getCostLogs');

function parseTimestamp(ts: unknown): Date {
  if (!ts) return new Date();
  // Firestore Timestamp object { _seconds, _nanoseconds } or { seconds, nanoseconds }
  if (typeof ts === 'object' && ts !== null) {
    const obj = ts as Record<string, unknown>;
    const secs = (obj._seconds ?? obj.seconds) as number | undefined;
    if (typeof secs === 'number') return new Date(secs * 1000);
  }
  const d = new Date(ts as string | number);
  return isNaN(d.getTime()) ? new Date() : d;
}

export async function fetchCostLogs(projectId: string): Promise<CostLog[]> {
  const result = await getCostLogsFn({ projectId, limit: 200 });
  const data = result.data as { logs: Array<Record<string, unknown>> };

  return data.logs.map((row) => ({
    id: `${row.agentId}_${row.timestamp}`,
    projectId,
    agentId: (row.agentId as string) || '',
    model: (row.model as string) || '',
    inputTokens: (row.inputTokens as number) || 0,
    outputTokens: (row.outputTokens as number) || 0,
    cacheReadTokens: (row.cacheReadTokens as number) || 0,
    cacheWriteTokens: (row.cacheWriteTokens as number) || 0,
    totalCost: (row.totalCost as number) || 0,
    createdAt: parseTimestamp(row.timestamp),
  }));
}

export function calculateSummary(logs: CostLog[]): CostSummary {
  const summary: CostSummary = {
    totalCost: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
    byAgent: {},
    byDay: {},
  };

  for (const log of logs) {
    summary.totalCost += log.totalCost;
    summary.totalInputTokens += log.inputTokens;
    summary.totalOutputTokens += log.outputTokens;
    summary.totalCacheReadTokens += log.cacheReadTokens || 0;
    summary.totalCacheWriteTokens += log.cacheWriteTokens || 0;

    if (!summary.byAgent[log.agentId]) {
      summary.byAgent[log.agentId] = {
        cost: 0, inputTokens: 0, outputTokens: 0,
        cacheReadTokens: 0, cacheWriteTokens: 0, model: '',
      };
    }
    const agent = summary.byAgent[log.agentId];
    agent.cost += log.totalCost;
    agent.inputTokens += log.inputTokens;
    agent.outputTokens += log.outputTokens;
    agent.cacheReadTokens += log.cacheReadTokens || 0;
    agent.cacheWriteTokens += log.cacheWriteTokens || 0;
    if (log.model) agent.model = log.model;

    const date = log.createdAt instanceof Date ? log.createdAt : new Date(log.createdAt);
    const day = isNaN(date.getTime()) ? 'unknown' : date.toISOString().split('T')[0];
    summary.byDay[day] = (summary.byDay[day] || 0) + log.totalCost;
  }

  return summary;
}
