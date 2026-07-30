-- The harness x model grid.
--
-- Two different axes live in two different columns, which is easy to get wrong:
--   * events.model on an `agent:spawned` row is the HARNESS id (claude, gpt,
--     gemini, antigravity, grok, custom, local, codex) -- the CLI we launched.
--   * cost_logs.model is the MODEL id the harness reported for that turn.
-- agentId is the only key that joins them.
WITH harness AS (
  SELECT agentId, ANY_VALUE(model) AS harness
  FROM `marblo-2253d.marblo_telemetry.events`
  WHERE event = 'agent:spawned' AND agentId IS NOT NULL AND timestamp < TIMESTAMP('2026-07-30')
  GROUP BY agentId
)
SELECT h.harness, c.model,
       COUNT(*) AS usage_rows,
       COUNT(DISTINCT c.agentId) AS agents,
       COUNT(DISTINCT c.userId) AS installs,
       ROUND(AVG(c.inputTokens)) AS avg_input_tokens,
       ROUND(AVG(c.outputTokens)) AS avg_output_tokens,
       ROUND(AVG(c.cacheReadTokens)) AS avg_cache_read_tokens,
       ROUND(SAFE_DIVIDE(SUM(c.cacheReadTokens), SUM(c.cacheReadTokens) + SUM(c.inputTokens)) * 100, 1) AS cache_read_share_pct,
       ROUND(SUM(c.totalCost), 2) AS imputed_cost_usd
FROM `marblo-2253d.marblo_telemetry.cost_logs` c
JOIN harness h USING (agentId)
WHERE c.timestamp < TIMESTAMP('2026-07-30')
GROUP BY 1, 2
ORDER BY usage_rows DESC
