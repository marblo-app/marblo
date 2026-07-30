-- Work mix rolled up across roles, so the prose figures are query output rather
-- than a column added up by hand.
SELECT IFNULL(NULLIF(taskType, ''), '(unclassified)') AS task_type,
       COUNT(*) AS tickets,
       ROUND(100 * COUNT(*) / SUM(COUNT(*)) OVER (PARTITION BY 1), 1) AS pct_of_sample
FROM `marblo-2253d.marblo_telemetry.task_outcomes`
WHERE createdAt < TIMESTAMP('2026-07-30')
GROUP BY 1
ORDER BY tickets DESC
