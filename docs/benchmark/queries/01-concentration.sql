-- Concentration: what share of the sample comes from the single heaviest install.
-- Installs are ranked, never named. This is the query that decides whether any
-- comparison in this directory is allowed to be called a result. It is not.
SELECT 'cost_logs.usage_rows' AS measure, rank_, n,
       ROUND(100 * n / SUM(n) OVER (PARTITION BY 1), 2) AS pct_of_total
FROM (
  SELECT ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC) AS rank_, COUNT(*) AS n
  FROM `marblo-2253d.marblo_telemetry.cost_logs`
  WHERE timestamp < TIMESTAMP('2026-07-30')
  GROUP BY userId
)
ORDER BY rank_
