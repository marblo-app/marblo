-- What kind of work the sample actually contains. A benchmark whose sample is
-- 90% bug-fix tickets cannot speak about greenfield feature work, so the mix
-- is published alongside every comparison.
SELECT IFNULL(NULLIF(taskType, ''), '(unclassified)') AS task_type,
       IFNULL(NULLIF(role, ''), '(unset)')            AS role,
       COUNT(*)                                       AS tickets,
       SUM(CAST(success AS INT64))                    AS self_reported_success,
       ROUND(APPROX_QUANTILES(durationMs, 2)[OFFSET(1)] / 60000, 1) AS median_wallclock_min
FROM `marblo-2253d.marblo_telemetry.task_outcomes`
WHERE createdAt < TIMESTAMP('2026-07-30')
GROUP BY 1, 2
ORDER BY tickets DESC
