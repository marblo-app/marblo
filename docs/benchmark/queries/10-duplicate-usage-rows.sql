-- Double-counting, measured instead of hand-waved.
--
-- The cost pipeline has no idempotency key, so the same 15-second delta can be
-- written more than once (two app windows open on one project each write it; a
-- reconnect re-reads the session file from the start). This query bounds the
-- FIRST path only: rows that are byte-identical on (install, receipt timestamp,
-- model, all four token counts) but were written under different agent ids.
--
-- Zero-token rows are excluded because rate-limit-only emits carry no tokens and
-- collide by coincidence rather than by duplication, which would inflate the
-- estimate roughly tenfold.
--
-- This is a LOWER BOUND. The reconnect path re-sums a whole session file into one
-- oversized row rather than an identical copy, so it is invisible here and stays
-- unquantified.
WITH nonzero AS (
  SELECT * FROM `marblo-2253d.marblo_telemetry.cost_logs`
  WHERE timestamp < TIMESTAMP('2026-07-30')
    AND (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens) > 0
),
grouped AS (
  SELECT COUNT(*) AS copies, COUNT(DISTINCT agentId) AS agents, SUM(totalCost) AS cost
  FROM nonzero
  GROUP BY userId, timestamp, model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens
)
SELECT (SELECT COUNT(*) FROM nonzero)                                  AS token_bearing_rows,
       SUM(IF(copies > 1, copies - 1, 0))                              AS redundant_rows,
       SUM(IF(copies > 1 AND agents > 1, copies - 1, 0))               AS redundant_across_agent_ids,
       ROUND(SUM(IF(copies > 1, cost * (copies - 1) / copies, 0)), 2)  AS redundant_imputed_cost_usd
FROM grouped
