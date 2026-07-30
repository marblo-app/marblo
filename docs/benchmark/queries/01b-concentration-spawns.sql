-- Same concentration check on agent spawns, which reach more installs than cost_logs does.
SELECT rank_, spawns, ROUND(100 * spawns / SUM(spawns) OVER (PARTITION BY 1), 2) AS pct_of_total
FROM (
  SELECT ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC) AS rank_, COUNT(*) AS spawns
  FROM `marblo-2253d.marblo_telemetry.events`
  WHERE event = 'agent:spawned' AND timestamp < TIMESTAMP('2026-07-30')
  GROUP BY userId
)
ORDER BY rank_
