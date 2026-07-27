export const DEFAULT_COST_LOGS_LIMIT = 200;
export const MAX_COST_LOGS_LIMIT = 1000;

export interface CostLogsLimit {
  limit: number;
  capped: boolean;
}

/**
 * Normalize the client-provided cost log page size before it reaches BigQuery.
 * Invalid, missing, and non-positive values retain the historical default.
 */
export function normalizeCostLogsLimit(value: unknown): CostLogsLimit {
  if (value === undefined || value === null || value === "") {
    return { limit: DEFAULT_COST_LOGS_LIMIT, capped: false };
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { limit: DEFAULT_COST_LOGS_LIMIT, capped: false };
  }

  const normalized = Math.trunc(parsed);
  if (normalized <= 0) {
    return { limit: DEFAULT_COST_LOGS_LIMIT, capped: false };
  }

  return {
    limit: Math.min(normalized, MAX_COST_LOGS_LIMIT),
    capped: normalized > MAX_COST_LOGS_LIMIT,
  };
}
