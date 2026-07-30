-- Who actually chose the model. If a human named the harness in the prompt, the
-- orchestrator's scorer was bypassed, and that dispatch says nothing about routing
-- quality. Splitting explicit from scored is what keeps the routing numbers honest.
SELECT JSON_VALUE(metadata, '$.complexity')    AS declared_complexity,
       JSON_VALUE(metadata, '$.explicitModel') AS human_named_the_model,
       JSON_VALUE(metadata, '$.reuseVsSpawn')  AS reuse_or_spawn,
       model                                   AS selected,
       COUNT(*)                                AS decisions
FROM `marblo-2253d.marblo_telemetry.events`
WHERE event = 'dispatch:decision' AND timestamp < TIMESTAMP('2026-07-30')
GROUP BY 1, 2, 3, 4
ORDER BY decisions DESC
