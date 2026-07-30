-- Process reliability per harness: how often a spawned agent process ended abnormally.
-- `agent:crashed` means the CLI child process exited non-zero as our supervisor saw it.
-- It does NOT mean the model produced a wrong answer, and it counts auth failures,
-- rate-limit exits, and some user-initiated kills.
WITH harness AS (
  SELECT agentId, ANY_VALUE(model) AS harness
  FROM `marblo-2253d.marblo_telemetry.events`
  WHERE event = 'agent:spawned' AND agentId IS NOT NULL AND timestamp < TIMESTAMP('2026-07-30')
  GROUP BY agentId
)
SELECT h.harness,
       COUNTIF(e.event = 'agent:spawned')   AS spawned,
       COUNTIF(e.event = 'agent:crashed')   AS abnormal_exit,
       COUNTIF(e.event = 'agent:restarted') AS restarted,
       COUNTIF(e.event = 'agent:stopped')   AS stopped,
       COUNT(DISTINCT e.userId)             AS installs
FROM `marblo-2253d.marblo_telemetry.events` e
JOIN harness h USING (agentId)
WHERE e.event IN ('agent:spawned', 'agent:crashed', 'agent:restarted', 'agent:stopped')
  AND e.timestamp < TIMESTAMP('2026-07-30')
GROUP BY 1
ORDER BY spawned DESC
