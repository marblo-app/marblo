-- How many distinct installs reach each stage. This is the query that sets the
-- ceiling on every other number in the directory: an install that never spawned
-- an agent contributes nothing to any comparison.
--
-- The stages are NOT strictly nested, and that is itself a finding: cost
-- telemetry covers fewer installs than ticket outcomes do, so stage 3 can come
-- out below stage 4. Read it as per-signal coverage, not as a funnel.
SELECT 1 AS step, 'opened the app (session started)' AS stage,
       COUNT(DISTINCT userId) AS installs
FROM `marblo-2253d.marblo_telemetry.events`
WHERE event = 'session:started' AND timestamp < TIMESTAMP('2026-07-30')
UNION ALL
SELECT 2, 'spawned at least one agent', COUNT(DISTINCT userId)
FROM `marblo-2253d.marblo_telemetry.events`
WHERE event = 'agent:spawned' AND timestamp < TIMESTAMP('2026-07-30')
UNION ALL
SELECT 3, 'produced at least one usage row', COUNT(DISTINCT userId)
FROM `marblo-2253d.marblo_telemetry.cost_logs`
WHERE timestamp < TIMESTAMP('2026-07-30')
UNION ALL
SELECT 4, 'completed at least one ticket', COUNT(DISTINCT userId)
FROM `marblo-2253d.marblo_telemetry.task_outcomes`
WHERE createdAt < TIMESTAMP('2026-07-30')
UNION ALL
SELECT 5, 'completed at least 10 tickets', COUNT(*)
FROM (SELECT userId FROM `marblo-2253d.marblo_telemetry.task_outcomes`
      WHERE createdAt < TIMESTAMP('2026-07-30')
      GROUP BY userId HAVING COUNT(*) >= 10)
ORDER BY step
