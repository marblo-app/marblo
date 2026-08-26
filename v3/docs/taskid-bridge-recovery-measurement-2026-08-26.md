# TaskId Bridge Recovery Measurement - 2026-08-26

Ticket: `WpbEVqLy14y5WOuNWgKw`

Bottom line: most purchasers did not run agents, so they never entered
`cost_logs`; only 5 distinct uids have `cost_logs.taskId`, which is why the
taskId bridge cannot recover purchaser-install links broadly.

Question: can historical person <-> install pairs be recovered by joining account-axis
`cost_logs` and install-axis outcomes through `taskId`?

## Method

- Access: john.kim ADC token, BigQuery REST `jobs.query`, project `marblo-2253d`, location `US`.
- Datasets checked: `marblo_telemetry`, `marblo_identity`.
- No writes were performed.
- No raw uid, clientId, or salt value is recorded here.
- `cost_logs.totalCost` was not globally summed. This measurement uses row counts,
  distinct key counts, and distinct bridge pairs.

## Schema Checks

| Table | Relevant identity/key columns | Finding |
| --- | --- | --- |
| `marblo_telemetry.cost_logs` | `userId`, `taskId` | `userId` is raw Firebase uid length 28. `taskId` is mostly raw length 20. |
| `marblo_telemetry.task_outcomes` | `userId`, `taskId` | `userId` is install clientId length 36. `taskId` is mixed: raw length 20 and HMAC length 27. |
| `marblo_telemetry.agent_heartbeats` | `userId` | No `taskId` column exists, so it cannot participate in the taskId bridge. |
| `marblo_telemetry.analytics_purchase` | `user_key` | HMAC account key length 27. Direct raw uid join is invalid. |
| `marblo_identity.analytics_user_install` | `user_key`, `install_key` | Existing direct links are HMAC keys; current rows use `link_source=telemetry_auth`. |

## Counts

| Step | Measurement | Count | Pass-through |
| --- | ---: | ---: | ---: |
| 1 | `cost_logs` rows | 396,534 | 100.00% |
| 1 | `cost_logs` rows with non-empty `taskId` | 83,747 | 21.12% |
| 1 | `cost_logs` distinct uid with `taskId` | 5 | - |
| 1 | `cost_logs` distinct `taskId` | 2,061 | - |
| 2 | `task_outcomes` rows | 1,589 | 100.00% |
| 2 | `task_outcomes` rows with non-empty `taskId` | 1,589 | 100.00% |
| 2 | `task_outcomes` distinct install with `taskId` | 7 | - |
| 2 | `task_outcomes` distinct `taskId` | 1,484 | - |
| 2 | `agent_heartbeats` rows | 13,383,289 | No `taskId` column |
| 3 | overlapping raw `taskId`s between cost and outcomes | 830 | - |
| 3 | bridge rows at distinct `(uid, install, taskId)` grain | 831 | - |
| 3 | distinct `(uid, install)` candidate pairs | 7 | - |
| 3 | distinct bridged uid count | 2 | - |
| 3 | distinct bridged install count | 7 | - |
| 4 | purchase ledger distinct users, all kinds | 34 | - |
| 4 | purchase ledger distinct external users, any kind | 33 | - |
| 4 | purchase ledger distinct external paid users | 1 | - |
| 4 | bridged users in purchase ledger, all kinds | 2 | 100.00% of bridged users |
| 4 | bridged users in purchase ledger, external any kind | 1 | 50.00% of bridged users |
| 4 | bridged users in purchase ledger, external paid | 0 | 0.00% of bridged users |

## Many-to-Many Shape

| Class | Pairs | Users | Already linked pairs | Pairs in purchase all | Pairs in external paid | Supporting task range |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| one-to-one | 1 | 1 | 0 | 1 | 0 | 2..2 |
| ambiguous | 6 | 1 | 2 | 6 | 0 | 1..382 |
| all | 7 | 2 | 2 | 7 | 0 | 1..382 |

There is one low-risk one-to-one candidate. The other six candidates are one uid
mapped to multiple installs. That is a legitimate product shape, but not a
deterministic historical identity link. Those six must not be force-loaded as
person-install links.

## Verdict

Partial recovery is possible, but narrow:

- The salt answer is not enough by itself. The recoverable evidence is the recorded
  `(uid, taskId)` plus `(install clientId, taskId)` fact.
- `agent_heartbeats` cannot help because it has no `taskId`.
- The taskId bridge only covers the raw-taskId era. Newer `task_outcomes.taskId`
  rows are HMAC `tk_...` and do not join to raw `cost_logs.taskId`.
- At current data volume, automatic loading would produce at most one new
  one-to-one inferred pair. It does not recover any external paid purchaser.
- Six candidate pairs are ambiguous and should be quarantined for manual/product
  policy review, not inserted.

## Loading Design If Product Accepts Inferred Recovery

Do not write directly from ad hoc SQL. Add a controlled backfill path in Cloud
Functions/runtime code where `ANALYTICS_ID_SALT` is available without exposing it
to BigQuery job text:

1. Read distinct legacy bridge candidates:
   `cost_logs(userId, taskId)` joined to `task_outcomes(userId, taskId)` on raw
   20-character `taskId`.
2. Derive keys with the existing single HMAC implementation:
   `user_key = pseudonymizeAnalyticsId("user", cost_logs.userId, salt)` and
   `install_key = pseudonymizeAnalyticsId("install", task_outcomes.userId, salt)`.
3. Classify degrees before writing:
   `COUNT(DISTINCT install_key) OVER user_key` and
   `COUNT(DISTINCT user_key) OVER install_key`.
4. Only auto-load candidates where both degrees are 1, the pair is not already in
   `analytics_user_install`, and the pair has at least two supporting tasks.
5. Write inferred rows with a distinct source marker:
   `link_source = "task_id_bridge_inferred"`,
   `policy_version = "task-id-bridge-inferred-v1"`,
   `id_scheme = "uuid36"`, plus first/last observed timestamps from the support
   tasks.
6. Persist rejected/ambiguous candidates only in an internal audit/report table or
   job log summary, never mixed into `analytics_user_install`.

This keeps directly observed `telemetry_auth` links separate from retrospective
inference.
