-- Ticket outcomes bucketed by the harness that worked the ticket.
-- `success` is the agent's own report (it called submit_for_review rather than
-- FAILED/BLOCKED). It is self-declared, not independently verified -- see
-- ../methodology.md, "What `success` does and does not mean".
-- durationMs is ticket wall-clock (createdAt -> completedAt) and includes queueing
-- and idle time; it is not agent working time.
WITH task_agent AS (
  SELECT DISTINCT taskId, agentId
  FROM `marblo-2253d.marblo_telemetry.events`
  WHERE taskId IS NOT NULL AND agentId IS NOT NULL AND timestamp < TIMESTAMP('2026-07-30')
),
harness AS (
  SELECT agentId, ANY_VALUE(model) AS harness
  FROM `marblo-2253d.marblo_telemetry.events`
  WHERE event = 'agent:spawned' AND agentId IS NOT NULL AND timestamp < TIMESTAMP('2026-07-30')
  GROUP BY agentId
),
per_task AS (
  SELECT ta.taskId, ARRAY_AGG(DISTINCT h.harness ORDER BY h.harness) AS harnesses
  FROM task_agent ta JOIN harness h USING (agentId)
  GROUP BY ta.taskId
)
SELECT CASE WHEN ARRAY_LENGTH(p.harnesses) = 1
            THEN p.harnesses[OFFSET(0)]
            ELSE FORMAT('mixed (%d harnesses)', ARRAY_LENGTH(p.harnesses)) END AS bucket,
       COUNT(*) AS tickets,
       SUM(CAST(o.success AS INT64)) AS self_reported_success,
       ROUND(APPROX_QUANTILES(o.durationMs, 2)[OFFSET(1)] / 60000, 1) AS median_wallclock_min,
       SUM(o.retriesCount) AS retries_recorded
FROM `marblo-2253d.marblo_telemetry.task_outcomes` o
JOIN per_task p USING (taskId)
WHERE o.createdAt < TIMESTAMP('2026-07-30')
GROUP BY 1
ORDER BY tickets DESC
