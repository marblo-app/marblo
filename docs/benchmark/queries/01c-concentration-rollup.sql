-- Concentration rolled up, so the headline share is itself a query result and not
-- arithmetic done by hand in the prose.
WITH ranked AS (
  SELECT ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC) AS rank_, COUNT(*) AS spawns
  FROM `marblo-2253d.marblo_telemetry.events`
  WHERE event = 'agent:spawned' AND timestamp < TIMESTAMP('2026-07-30')
  GROUP BY userId
)
SELECT COUNT(*) AS installs_that_spawned,
       SUM(spawns) AS total_spawns,
       ROUND(100 * SUM(IF(rank_ = 1, spawns, 0)) / SUM(spawns), 1) AS top1_pct,
       ROUND(100 * SUM(IF(rank_ <= 5, spawns, 0)) / SUM(spawns), 1) AS top5_pct
FROM ranked
