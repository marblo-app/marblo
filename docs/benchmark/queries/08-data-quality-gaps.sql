-- Known holes in the pipeline, measured rather than described. Anything that
-- shows up here is reported as "not measured" in the data appendix instead of
-- being quietly dropped from a denominator.
SELECT 'cost_logs rows with an unresolved model id' AS gap,
       COUNTIF(model IN ('claude', '<synthetic>') OR model IS NULL) AS n,
       COUNT(*) AS out_of
FROM `marblo-2253d.marblo_telemetry.cost_logs` WHERE timestamp < TIMESTAMP('2026-07-30')
UNION ALL
SELECT 'cost_logs rows carrying a pricing snapshot',
       COUNTIF(pricingSnapshot IS NOT NULL AND pricingSnapshot != ''), COUNT(*)
FROM `marblo-2253d.marblo_telemetry.cost_logs` WHERE timestamp < TIMESTAMP('2026-07-30')
UNION ALL
SELECT 'cost_logs rows carrying a taskId',
       COUNTIF(taskId IS NOT NULL AND taskId != ''), COUNT(*)
FROM `marblo-2253d.marblo_telemetry.cost_logs` WHERE timestamp < TIMESTAMP('2026-07-30')
UNION ALL
SELECT 'cost_logs rows carrying a taskType',
       COUNTIF(taskType IS NOT NULL AND taskType != ''), COUNT(*)
FROM `marblo-2253d.marblo_telemetry.cost_logs` WHERE timestamp < TIMESTAMP('2026-07-30')
UNION ALL
SELECT 'ticket outcomes with a non-zero retry count',
       COUNTIF(retriesCount > 0), COUNT(*)
FROM `marblo-2253d.marblo_telemetry.task_outcomes` WHERE createdAt < TIMESTAMP('2026-07-30')
UNION ALL
SELECT 'ticket outcomes with an error category on failure',
       COUNTIF(success = FALSE AND errorCategory IS NOT NULL AND errorCategory != ''),
       COUNTIF(success = FALSE)
FROM `marblo-2253d.marblo_telemetry.task_outcomes` WHERE createdAt < TIMESTAMP('2026-07-30')
UNION ALL
SELECT 'ticket outcomes with a declared task type',
       COUNTIF(taskType IS NOT NULL AND taskType != ''), COUNT(*)
FROM `marblo-2253d.marblo_telemetry.task_outcomes` WHERE createdAt < TIMESTAMP('2026-07-30')
UNION ALL
SELECT 'workflow executions recorded', COUNT(*), COUNT(*)
FROM `marblo-2253d.marblo_telemetry.flow_executions`
