-- Attribution funnel for ticket outcomes. Every drop-off is printed rather than
-- silently filtered, so the denominator of the next table is auditable.
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
  SELECT ta.taskId, ARRAY_AGG(DISTINCT h.harness IGNORE NULLS) AS harnesses
  FROM task_agent ta LEFT JOIN harness h USING (agentId)
  GROUP BY ta.taskId
),
o AS (
  SELECT * FROM `marblo-2253d.marblo_telemetry.task_outcomes`
  WHERE createdAt < TIMESTAMP('2026-07-30')
)
SELECT 1 AS step, 'ticket outcome rows recorded' AS stage, COUNT(*) AS tickets FROM o
UNION ALL
SELECT 2, 'linked to at least one agent', COUNT(*) FROM o WHERE taskId IN (SELECT taskId FROM task_agent)
UNION ALL
SELECT 3, 'that agent has a resolvable harness', COUNT(*) FROM o
  WHERE taskId IN (SELECT taskId FROM per_task WHERE ARRAY_LENGTH(harnesses) >= 1)
UNION ALL
SELECT 4, 'worked by exactly one harness (usable for comparison)', COUNT(*) FROM o
  WHERE taskId IN (SELECT taskId FROM per_task WHERE ARRAY_LENGTH(harnesses) = 1)
ORDER BY step
