-- Coverage: how much telemetry exists per table, over what window, from how many installs.
-- Snapshot cutoff is inclusive of 2026-07-30 UTC.
SELECT 'cost_logs' AS table_name, COUNT(*) AS rows_, COUNT(DISTINCT userId) AS installs,
       COUNT(DISTINCT agentId) AS agents,
       FORMAT_TIMESTAMP('%Y-%m-%d', MIN(timestamp)) AS first_day,
       FORMAT_TIMESTAMP('%Y-%m-%d', MAX(timestamp)) AS last_day
FROM `marblo-2253d.marblo_telemetry.cost_logs`
WHERE timestamp < TIMESTAMP('2026-07-30')
UNION ALL
SELECT 'events', COUNT(*), COUNT(DISTINCT userId), COUNT(DISTINCT agentId),
       FORMAT_TIMESTAMP('%Y-%m-%d', MIN(timestamp)), FORMAT_TIMESTAMP('%Y-%m-%d', MAX(timestamp))
FROM `marblo-2253d.marblo_telemetry.events`
WHERE timestamp < TIMESTAMP('2026-07-30')
UNION ALL
SELECT 'task_outcomes', COUNT(*), COUNT(DISTINCT userId), COUNT(DISTINCT taskId),
       FORMAT_TIMESTAMP('%Y-%m-%d', MIN(createdAt)), FORMAT_TIMESTAMP('%Y-%m-%d', MAX(createdAt))
FROM `marblo-2253d.marblo_telemetry.task_outcomes`
WHERE createdAt < TIMESTAMP('2026-07-30')
UNION ALL
SELECT 'agent_heartbeats', COUNT(*), COUNT(DISTINCT userId), COUNT(DISTINCT agentId),
       FORMAT_TIMESTAMP('%Y-%m-%d', MIN(timestamp)), FORMAT_TIMESTAMP('%Y-%m-%d', MAX(timestamp))
FROM `marblo-2253d.marblo_telemetry.agent_heartbeats`
WHERE timestamp < TIMESTAMP('2026-07-30')
UNION ALL
SELECT 'flow_executions', COUNT(*), COUNT(DISTINCT userId), 0,
       FORMAT_TIMESTAMP('%Y-%m-%d', MIN(timestamp)), FORMAT_TIMESTAMP('%Y-%m-%d', MAX(timestamp))
FROM `marblo-2253d.marblo_telemetry.flow_executions`
WHERE timestamp < TIMESTAMP('2026-07-30')
ORDER BY rows_ DESC
