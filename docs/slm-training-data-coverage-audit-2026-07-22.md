# SLM Training Data Coverage Audit

> Date: 2026-07-22
> Scope: read-only audit of `marblo-2253d.marblo_telemetry` in BigQuery US.
> Method: BigQuery REST queries with ADC and `x-goog-user-project=marblo-2253d`.
> Constraint: no `routing_data_pipeline` rewrite; this report only audits live coverage and gaps.

## Executive Summary

The routing data pipeline is live enough to support offline analysis, but not yet enough to train a reliable SLM router/model-selector without targeted label fixes.

- `dispatch:decision` is healthy: 1,276 rows, 408 distinct taskIds, and 100% coverage for `decisionReason`, `complexity`, `reuseVsSpawn`, `eligibleModels`, `perModelScores`, and `tags`.
- Cost join is strong: 404 of 408 dispatch taskIds join to `cost_logs` (99.0%).
- Outcome join is now materially better than the 2026-07-18 research note, but still incomplete: 143 of 408 dispatch taskIds join to `task_outcomes` (35.0%); 141 have dispatch + cost + outcome.
- Negative labels exist now, but label quality is still weak: all 13 negative `task_outcomes` rows are `BLOCKED`; there are 0 `FAILED` labels in `errorCategory`.
- Merge-derived quality labels are not live in BQ: `task:merged` has 0 rows, and `marblo_telemetry.merge_history` is not a BigQuery table.
- Crash/restart quality signals are still non-joinable: 957 `agent:crashed` and 1,159 `agent:restarted` rows have 0 taskIds.
- Prompt raw text is intentionally not collected. Only `promptHash` and `promptLength` exist, which is privacy-preserving but limits supervised learning features.

## BigQuery Snapshot

| Table | Rows | First Seen | Last Seen | SLM Readiness |
| --- | ---: | --- | --- | --- |
| `events` | 76,462 | 2026-04-18 14:12:23 UTC | 2026-07-22 07:37:06 UTC | Good routing features, weak outcome labels |
| `cost_logs` | 66,840 | 2026-04-18 14:12:13 UTC | 2026-07-22 07:37:11 UTC | Good cost target; task join mostly healthy |
| `task_outcomes` | 195 | 2026-06-15 07:33:02 UTC | 2026-07-22 06:23:34 UTC | Improving, but still sparse and negative labels are low quality |
| `agent_heartbeats` | 1,670,696 | 2026-04-19 05:06:01 UTC | 2026-07-22 07:37:09 UTC | Useful for liveness, not directly joined in this audit |
| `flow_executions` | 0 | - | - | Non-starter |
| `merge_history` | BQ table missing | - | - | Non-starter for BQ training unless mirrored or joined from Firestore |

## Signal Readiness

| SLM Signal | Source | Schema Exists | Rows / Fill Rate | Readiness | Notes |
| --- | --- | --- | ---: | --- | --- |
| `promptHash` | `events.promptHash` | Yes | 1,800 / 76,462 overall; 1,800 / 4,151 `agent:spawned` (43.4%) | Partial | Hash supports grouping and dedupe, not semantic learning. |
| `promptLength` | `events.promptLength` and `task_outcomes.promptLength` | Yes | 1,800 / 4,151 `agent:spawned` (43.4%); 166 / 195 outcomes (85.1%) | Partial | Length is useful as size proxy. Raw prompt is intentionally absent. |
| Raw prompt text | None | No | 0 | Non-starter | Important feature for SLM training, but conflicts with privacy policy. Needs explicit product/privacy decision before collection. |
| `taskType` | `events.taskType`, `cost_logs.taskType`, `task_outcomes.taskType` | Yes | events 0 / 76,462; cost 0 / 66,840; outcomes 140 / 195 (71.8%) | Partial | Outcome classifier is now writing derived types; event/cost paths are still empty. |
| `role` | `events.role`, `task_outcomes.role` | Yes | 5,435 / 76,462 events; 1,276 / 1,276 dispatch; 195 / 195 outcomes | Good | Strong for dispatch/outcome analysis. |
| `model` | `events.model`, `cost_logs.model`, `task_outcomes.model` | Yes | 72,251 / 76,462 events; 66,840 / 66,840 cost; 129 / 195 outcomes | Good for cost/events, partial for outcomes | Outcome model missing rate is 33.8%. |
| `parentAgentId` | `events.parentAgentId` | Yes | 0 / 76,462 | Non-starter | Schema exists but no BQ rows populate it. Human/orchestrator handoff lineage cannot be learned. |
| `retryOf` | `events.retryOf` | Yes | 0 / 76,462 | Non-starter | Schema exists but no retry lineage is populated. |
| `success` | `events.success`, `task_outcomes.success` | Yes | events 44 / 76,462; outcomes 195 / 195 | Partial | Latest outcome labels: 182 success, 5 failure-class rows after latest-per-task collapse, all failure class is BLOCKED. |
| `exitCode` | `events.exitCode` | Yes | 1,619 / 76,462; 957 / 957 crashes | Partial | Captured for crashes/stops, but crash taskId is 0 so it cannot train task-level routing. |
| `errorCategory` | `events.errorCategory`, `task_outcomes.errorCategory` | Yes | events 0 / 76,462; outcomes 13 / 195 | Weak | Outcome negatives are only `BLOCKED`; crash category is 0 / 957. |
| `durationMs` | `events.durationMs`, `task_outcomes.durationMs` | Yes | events 113 / 76,462; outcomes 168 / 195 | Partial | Outcome p50 is 5,643,101 ms (about 1.57h), p95 is 193,506,548 ms (about 53.8h). Treat as lead time, not active model time. |
| `filesChanged` | `events.filesChanged`, Firestore `merge_history.filesChanged` | Yes | BQ events 0 / 76,462; `task:merged` 0 rows | Non-starter in BQ | Code supports derived merge features, but no BQ rows have arrived. |
| `linesChanged` | `events.linesChanged`, merge-derived `linesAdded + linesDeleted` | Yes | BQ events 0 / 76,462; `task:merged` 0 rows | Non-starter in BQ | Same as above. |
| `task:merged` features | `events` event=`task:merged`, Firestore `merge_history` | Partly | 0 BQ rows | Non-starter | Firestore type has `filesChanged`, `linesAdded`, `linesDeleted`, `changeType`; BQ mirror is empty. |
| `dispatch:decision` | `events` + `metadata` JSON | Yes | 1,276 rows; 408 distinct taskIds | Good | Strongest feature set. |
| Dispatch decision reason | `events.metadata.decisionReason` | Yes | 1,276 / 1,276 dispatch rows | Good | Orchestrator/model decision reason is present for dispatch. |
| Dispatch complexity | `events.metadata.complexity` | Yes | 1,276 / 1,276 dispatch rows | Good | This is the best available task complexity signal. |
| Dispatch model scores | `events.metadata.perModelScores` | Yes | 1,276 / 1,276 dispatch rows | Good | Enables supervised comparison once labels improve. |
| `model:tier_resolved` | `events` event=`model:tier_resolved` | Event exists | 273 rows, but only model column survives | Weak | `complexity` and `resolvedClaudeModel` are not persisted in first-class columns or metadata. |
| `model:top_fallback` | `events` event=`model:top_fallback` | Event exists | 103 rows, but reason/request/fallback fields are not persisted | Weak | Event count exists, training features are effectively missing. |
| Cost tokens/cost | `cost_logs` | Yes | 66,840 / 66,840 rows have model, token data, and totalCost | Good | `taskId` exists on 13,022 rows and 426 distinct tasks. |
| Cost `taskType` | `cost_logs.taskType` | Yes | 0 / 66,840 | Non-starter | Can be recovered by joining to task/outcome where available, but not directly populated. |
| Cost `sessionId` | `cost_logs.sessionId` | Yes | 0 / 66,840 | Non-starter | Cannot model session-level spending or active time from this table alone. |
| Cost `pricingSnapshot` | `cost_logs.pricingSnapshot` | Yes | 0 / 66,840 | Non-starter | Price drift cannot be audited from row-local data. |
| Human intervention count | None | No | 0 | Non-starter | Needed for quality labels: PM nudge, manual retry, conflict resolution, manual merge, review reject. |
| Orchestrator decomposition rationale | Partial | Partial | Dispatch reason exists; task decomposition reason not measured | Weak | Dispatch has reasons; upstream task split/assignment rationale is not captured as structured data. |

## Joinability

| Join | Count | Rate | Readiness |
| --- | ---: | ---: | --- |
| Dispatch taskIds | 408 | - | Base population |
| Dispatch -> cost | 404 | 99.0% | Good |
| Dispatch -> outcome | 143 | 35.0% | Partial |
| Dispatch -> merge | 0 | 0.0% | Non-starter |
| Dispatch -> crash/restart | 0 | 0.0% | Non-starter |
| Dispatch + cost + outcome | 141 | 34.6% | Minimum viable offline sample, still small |
| Dispatch + cost + merge | 0 | 0.0% | Non-starter |

## Recent Ingestion Since 2026-07-18

This separates current behavior from older sparse rows.

| Signal | Recent Coverage |
| --- | --- |
| `dispatch:decision` | 441 rows; taskId, role, model, decisionReason, complexity, reuseVsSpawn all 441 / 441 |
| `agent:spawned` prompt features | 444 / 768 rows have `promptHash` and `promptLength` (57.8%) |
| `task_outcomes` | 146 rows, 139 distinct taskIds |
| Recent outcome labels | 134 success, 12 negative |
| Recent outcome `taskType` | 122 / 146 (83.6%) |
| Recent outcome `model` | 120 / 146 (82.2%) |
| Recent outcome `totalCost` | 131 / 146 (89.7%) |
| Recent crash/restart taskId | 0 / 511 |

## Label Quality Assessment

`task_outcomes` is no longer all-positive, which is an improvement over the older research note. However, it is not yet a reliable training label set.

- All rows: 182 `success=true`, 13 `success=false`, 0 null.
- Latest row per task: 187 tasks, 182 positive, 5 negative.
- Negative class reason: 13 `BLOCKED`, 0 `FAILED`.
- This means the model would learn "not completed yet / blocked" more than "bad model choice caused failure."
- `durationMs` is still wall-clock lead time. It can help operations analysis but should not be used as a direct model-efficiency target without active-time instrumentation.
- `task:merged` remains the best intended acceptance label, but there are 0 BQ rows.

## Privacy Tension: Prompt Raw Text

For SLM routing/model selection, prompt text would be one of the highest-value inputs: intent, ambiguity, domain, API mentions, file paths, and error snippets are all semantically predictive. The current telemetry intentionally avoids this by sending only:

- `promptHash`: same-prompt grouping, dedupe, retry clustering.
- `promptLength`: coarse size proxy.

This is the right default for the current privacy contract, but it limits model quality. Any raw or semi-raw prompt feature collection should be a separate privacy/product decision, not a quiet telemetry change. Safer alternatives:

- On-device extraction of allowlisted coarse features: language, task verb, requested role, explicit model request, dependency count, mentioned file extension categories.
- One-way category tags produced locally, not raw prompt text.
- Explicit opt-in training mode for raw prompt samples, with visible retention and deletion policy.

## Gaps And Follow-Up Tickets

| Gap | Impact | Proposed Ticket |
| --- | --- | --- |
| `task:merged` has 0 BQ rows | No acceptance/merge quality label; files/lines/changeType unusable for SLM | Verify `recordMergeHistory -> mainTelemetry.taskMerged -> telemetryService -> logTelemetryBatch` in packaged app and add a live post-merge BQ probe. Do not rewrite the pipeline. |
| No BQ `merge_history` table | Firestore audit trail cannot be queried directly with BQ features | Decide whether to export/mirror `merge_history` to BQ or rely only on `events task:merged`; document single source of truth. |
| Crash/restart taskId is 0 | Cannot learn model instability per task/model | Wire current taskId into `agent:crashed` and `agent:restarted` live path; add BQ probe requiring nonzero taskId on a forced crash/restart fixture. |
| `events.errorCategory` is 0 | Failure analysis cannot distinguish auth/env/runtime/model problems | Populate coarse error categories for crash, launch failure, CLI auth, timeout, and tool failure events. Keep messages scrubbed. |
| `model:top_fallback` payload not persisted | Cannot learn when top-tier fallback changes outcome/cost | Persist fallback reason/requested/installed/fallbackTo in metadata or first-class columns. |
| `model:tier_resolved` lacks resolved tier metadata | Tier resolution event count exists but features are mostly lost | Persist complexity and resolved model in metadata for `model:tier_resolved`. |
| `parentAgentId` and `retryOf` are 0 | Handoff and retry lineage cannot be learned | Populate lineage for spawned children, retries, conflict resolvers, and review-fix agents. |
| Human intervention count missing | SLM cannot distinguish autonomous success from human-rescued success | Add structured events for PM feedback, manual merge, manual retry, review reject, conflict resolve, and orchestrator override counts. |
| Task decomposition rationale missing | Router cannot learn why a task was split or routed before dispatch | Add structured decomposition/assignment decision event with reason categories, not freeform prompt text. |
| Cost `taskType`, `sessionId`, `pricingSnapshot` are 0 | Cost prediction and price-drift analysis are weaker | Populate taskType from local classifier, sessionId from agent session, and pricingSnapshot from cost tracker price table version. |
| Raw prompt not collected | Semantic model quality is capped | Keep raw prompt out by default; create explicit privacy review ticket for local feature extraction or opt-in raw prompt training corpus. |
| `flow_executions` is empty | Process optimization ML cannot learn flow graphs | Either wire live flow execution events or deprecate the table from SLM scope until flows are product-critical. |

## Recommendation

Do not train or ship an SLM router yet. The next step is a small, read/write instrumentation follow-up focused on labels, not a routing rewrite:

1. Prove `task:merged` BQ ingestion with a real merge.
2. Restore taskId/errorCategory on crash and restart rows.
3. Persist fallback/tier metadata.
4. Add human-intervention counters.
5. Re-run this audit until dispatch + cost + accepted/failed label rows exceed a minimum offline sample threshold.

The existing `routing_data_pipeline` should remain in place. The audit shows the pipeline's routing side is healthy; the missing part is label coverage and label semantics.
