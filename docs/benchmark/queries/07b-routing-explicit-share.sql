-- How many dispatches the scorer actually decided. Anything with
-- explicitModel = true was a human naming the harness, so it cannot be
-- evidence about routing quality either way.
SELECT IFNULL(JSON_VALUE(metadata, '$.explicitModel'), '(unrecorded)') AS human_named_the_model,
       COUNT(*) AS decisions,
       ROUND(100 * COUNT(*) / SUM(COUNT(*)) OVER (PARTITION BY 1), 1) AS pct
FROM `marblo-2253d.marblo_telemetry.events`
WHERE event = 'dispatch:decision' AND timestamp < TIMESTAMP('2026-07-30')
GROUP BY 1
ORDER BY decisions DESC
