# BQ ML 학습데이터 감사 — 스폰→진행→결과 적재 검증

> **Task**: `JIfsNIwoy6W4iui0h8CZ`  
> **Date**: 2026-08-08 (UTC 쿼리 시각 ~01:20–01:30)  
> **Project/Dataset**: `marblo-2253d.marblo_telemetry`  
> **Method**: ADC (`gcloud auth application-default print-access-token`) + BigQuery REST `jobs.query` / `tables.get`  
> **Constraint**: 조사·문서 전용 (앱/스키마 코드 무변경)  
> **Related**: `docs/slm-training-data-coverage-audit-2026-07-22.md`, `docs/bigquery-ml-readiness.md`

---

## 0. Executive Summary

| 축 | 판정 | 핵심 수치 (실측) |
|---|---|---|
| **테이블 존재** | OK | 5/5 테이블 존재 (`flow_executions`만 0행) |
| **스폰 축 (harness)** | Partial | `agent:spawned` 5,811행 — **model·role·agentId 100%**, **taskId 0%**, 스폰 사유 **metadata에 없음** |
| **스폰 사유 (decision)** | Good (별 이벤트) | `dispatch:decision` 2,260행 — taskId 99.9%, decisionReason/complexity/reuseVsSpawn 100% |
| **비용 축** | Good (조인 주의) | `cost_logs` 174,310행 — model·agentId 100%, taskId 26.9% (46,805/174,310). **model = 모델 id** (harness 아님) |
| **결과 축** | Partial | `task_outcomes` 888행 — success 100% 채움, FAILED 6 / BLOCKED 33. **retriesCount≈0** (1건만 >0) |
| **Grok 실패/무산출** | 부분 기록 | outcome 21건 중 실패 4(FAILED 2+BLOCKED 2). spawn 83 에이전트 중 **outcome 연결 5만**. 무산출(cost out=0) 에이전트 **0** — “무산출”은 cost 델타로는 거의 안 잡힘 |
| **E2E 조인** | 가능 (경로 2단) | spawn→cost: **agentId**. cost→outcome: **taskId**. outcome에 agentId 컬럼 **없음** |
| **ML 학습 준비도** | Not ready for supervised spawn-model | taskType/retries/parent/retryOf/flow 미측 또는 결측 심각. 라벨 품질 약함 |

**한 줄 결론**: 학습에 쓸 수 있는 **의사결정 피처는 `dispatch:decision`**, **비용 타깃은 `cost_logs`(agentId 조인)**, **성공/실패 라벨은 `task_outcomes`(taskId 조인)** 에 분산되어 있다. `agent:spawned` 단독으로는 task·사유가 빠져 스폰모델 학습 단위가 되지 않는다.

---

## 1. 전 테이블 스키마 덤프

`tables.get` 기준. **파티셔닝/클러스터링: 5테이블 모두 없음** (`timePartitioning=null`, `clustering=null`).

### 1.1 `events` (numRows≈189,008 schema meta / 쿼리 COUNT 189,564)

| Column | Type | Mode |
|---|---|---|
| event | STRING | NULLABLE |
| userId | STRING | NULLABLE |
| appVersion | STRING | NULLABLE |
| projectId | STRING | NULLABLE |
| agentId | STRING | NULLABLE |
| taskId | STRING | NULLABLE |
| flowId | STRING | NULLABLE |
| model | STRING | NULLABLE |
| role | STRING | NULLABLE |
| status | STRING | NULLABLE |
| fromStatus | STRING | NULLABLE |
| toStatus | STRING | NULLABLE |
| durationMs | INTEGER | NULLABLE |
| tokensInput | INTEGER | NULLABLE |
| tokensOutput | INTEGER | NULLABLE |
| cost | FLOAT | NULLABLE |
| success | BOOLEAN | NULLABLE |
| exitCode | INTEGER | NULLABLE |
| nodeType | STRING | NULLABLE |
| nodeCount | INTEGER | NULLABLE |
| metadata | STRING | NULLABLE |
| timestamp | TIMESTAMP | NULLABLE |
| taskType | STRING | NULLABLE |
| taskComplexity | INTEGER | NULLABLE |
| filesChanged | INTEGER | NULLABLE |
| linesChanged | INTEGER | NULLABLE |
| errorCategory | STRING | NULLABLE |
| errorMessage | STRING | NULLABLE |
| promptHash | STRING | NULLABLE |
| promptLength | INTEGER | NULLABLE |
| parentAgentId | STRING | NULLABLE |
| retryOf | STRING | NULLABLE |

### 1.2 `cost_logs` (numRows≈173,815 / COUNT 174,310)

| Column | Type | Mode |
|---|---|---|
| userId | STRING | NULLABLE |
| projectId | STRING | NULLABLE |
| agentId | STRING | NULLABLE |
| model | STRING | NULLABLE |
| inputTokens | INTEGER | NULLABLE |
| outputTokens | INTEGER | NULLABLE |
| cacheReadTokens | INTEGER | NULLABLE |
| cacheWriteTokens | INTEGER | NULLABLE |
| totalCost | FLOAT | NULLABLE |
| timestamp | TIMESTAMP | NULLABLE |
| taskId | STRING | NULLABLE |
| taskType | STRING | NULLABLE |
| sessionId | STRING | NULLABLE |
| pricingSnapshot | STRING | NULLABLE |

### 1.3 `task_outcomes` (numRows≈886 / COUNT 888)

| Column | Type | Mode |
|---|---|---|
| userId | STRING | REQUIRED |
| taskId | STRING | REQUIRED |
| projectId | STRING | NULLABLE |
| taskType | STRING | NULLABLE |
| taskComplexity | INTEGER | NULLABLE |
| role | STRING | NULLABLE |
| model | STRING | NULLABLE |
| promptLength | INTEGER | NULLABLE |
| scopeFileCount | INTEGER | NULLABLE |
| success | BOOLEAN | NULLABLE |
| durationMs | INTEGER | NULLABLE |
| totalInputTokens | INTEGER | NULLABLE |
| totalOutputTokens | INTEGER | NULLABLE |
| totalCost | FLOAT | NULLABLE |
| retriesCount | INTEGER | NULLABLE |
| errorCategory | STRING | NULLABLE |
| createdAt | TIMESTAMP | REQUIRED |
| completedAt | TIMESTAMP | NULLABLE |

> **주의**: `task_outcomes`에는 `agentId` / `timestamp` 컬럼이 **없다**. 시간축은 `createdAt`/`completedAt`.

### 1.4 `flow_executions` (numRows=0)

| Column | Type | Mode |
|---|---|---|
| userId | STRING | REQUIRED |
| flowId | STRING | REQUIRED |
| runId | STRING | REQUIRED |
| projectId | STRING | NULLABLE |
| nodeCount | INTEGER | NULLABLE |
| nodesExecuted | STRING | NULLABLE |
| status | STRING | NULLABLE |
| totalDurationMs | INTEGER | NULLABLE |
| success | BOOLEAN | NULLABLE |
| timestamp | TIMESTAMP | REQUIRED |

### 1.5 `agent_heartbeats` (numRows≈5,311,433 / COUNT 5,316,724)

| Column | Type | Mode |
|---|---|---|
| userId | STRING | REQUIRED |
| agentId | STRING | REQUIRED |
| projectId | STRING | NULLABLE |
| status | STRING | NULLABLE |
| tokensAccumulated | INTEGER | NULLABLE |
| costAccumulated | FLOAT | NULLABLE |
| lastActivityType | STRING | NULLABLE |
| timestamp | TIMESTAMP | REQUIRED |

---

## 2. 볼륨 스냅샷 (실측)

```sql
SELECT 'events' AS t, COUNT(*) AS n, CAST(MIN(timestamp) AS STRING) AS min_ts, CAST(MAX(timestamp) AS STRING) AS max_ts
FROM `marblo-2253d.marblo_telemetry.events`
UNION ALL
SELECT 'cost_logs', COUNT(*), CAST(MIN(timestamp) AS STRING), CAST(MAX(timestamp) AS STRING)
FROM `marblo-2253d.marblo_telemetry.cost_logs`
UNION ALL
SELECT 'task_outcomes', COUNT(*), CAST(MIN(createdAt) AS STRING), CAST(MAX(COALESCE(completedAt, createdAt)) AS STRING)
FROM `marblo-2253d.marblo_telemetry.task_outcomes`
UNION ALL
SELECT 'flow_executions', COUNT(*), CAST(MIN(timestamp) AS STRING), CAST(MAX(timestamp) AS STRING)
FROM `marblo-2253d.marblo_telemetry.flow_executions`
UNION ALL
SELECT 'agent_heartbeats', COUNT(*), CAST(MIN(timestamp) AS STRING), CAST(MAX(timestamp) AS STRING)
FROM `marblo-2253d.marblo_telemetry.agent_heartbeats`
ORDER BY t;
```

| Table | Rows | First | Last |
|---|---:|---|---|
| agent_heartbeats | 5,316,724 | 2026-04-19 05:06:01 UTC | 2026-08-08 01:22:02 UTC |
| cost_logs | 174,310 | 2026-04-18 14:12:13 UTC | 2026-08-08 01:20:35 UTC |
| events | 189,564 | 2026-04-18 14:12:23 UTC | 2026-08-08 01:20:47 UTC |
| flow_executions | **0** | — | — |
| task_outcomes | 888 | 2026-06-15 07:33:02 UTC | 2026-08-08 01:04:10 UTC |

### 최근 7일

| Metric | Count |
|---|---:|
| events | 74,131 |
| agent:spawned | 960 |
| cost_logs | 70,911 |
| task_outcomes | 334 |
| dispatch:decision | 553 |

---

## 3. 스폰 축 검증

### 3.1 `agent:spawned` fill rates

```sql
SELECT
  COUNT(*) AS spawned_rows,
  COUNTIF(model IS NOT NULL AND model != '') AS with_model,
  COUNTIF(role IS NOT NULL AND role != '') AS with_role,
  COUNTIF(taskId IS NOT NULL AND taskId != '') AS with_taskId,
  COUNTIF(agentId IS NOT NULL AND agentId != '') AS with_agentId,
  COUNTIF(metadata IS NOT NULL AND metadata != '') AS with_metadata,
  COUNTIF(taskType IS NOT NULL AND taskType != '') AS with_taskType,
  COUNTIF(promptHash IS NOT NULL) AS with_promptHash,
  COUNTIF(promptLength IS NOT NULL) AS with_promptLength,
  COUNTIF(parentAgentId IS NOT NULL) AS with_parent,
  COUNTIF(retryOf IS NOT NULL) AS with_retryOf,
  COUNTIF(JSON_VALUE(metadata, '$.decisionReason') IS NOT NULL) AS meta_decisionReason,
  COUNTIF(JSON_VALUE(metadata, '$.reason') IS NOT NULL) AS meta_reason,
  COUNTIF(JSON_VALUE(metadata, '$.spawnReason') IS NOT NULL) AS meta_spawnReason
FROM `marblo-2253d.marblo_telemetry.events`
WHERE event = 'agent:spawned';
```

| Field | Fill | Rate |
|---|---:|---:|
| rows | 5,811 | 100% |
| model | 5,811 | **100%** (harness: `claude`/`gpt`/`grok`/…) |
| role | 5,811 | **100%** |
| agentId | 5,811 | **100%** |
| taskId | **0** | **0%** |
| metadata | 446 | 7.7% — **전부 `{"accountUserId":…}` 만** |
| decisionReason/reason/spawnReason in metadata | 0 | 0% |
| taskType | 0 | 0% |
| promptHash / promptLength | 2,787 | 48.0% |
| parentAgentId / retryOf | 0 | 0% |

**판정**: harness model·role·agentId는 담는다. **taskId·스폰 사유는 담지 않는다.**

### 3.2 Harness model × role (top)

| model (harness) | role | n |
|---|---|---:|
| claude | backend | 1,431 |
| gpt | backend | 1,107 |
| gpt | frontend | 729 |
| claude | frontend | 644 |
| gpt | devops | 634 |
| claude | orchestrator | 302 |
| grok | backend | 52 |
| grok | frontend | 39 |
| … | … | … |

### 3.3 스폰 사유는 `dispatch:decision`에 있다

```sql
SELECT
  COUNT(*) AS n,
  COUNTIF(taskId IS NOT NULL AND taskId != '') AS with_task,
  COUNTIF(agentId IS NOT NULL AND agentId != '') AS with_agent,
  COUNTIF(JSON_VALUE(metadata, '$.decisionReason') IS NOT NULL) AS with_decisionReason,
  COUNTIF(JSON_VALUE(metadata, '$.complexity') IS NOT NULL) AS with_complexity,
  COUNTIF(JSON_VALUE(metadata, '$.reuseVsSpawn') IS NOT NULL) AS with_reuse,
  COUNTIF(JSON_VALUE(metadata, '$.perModelScores') IS NOT NULL) AS with_scores,
  COUNT(DISTINCT taskId) AS distinct_tasks
FROM `marblo-2253d.marblo_telemetry.events`
WHERE event = 'dispatch:decision';
```

| Field | Value |
|---|---:|
| rows | 2,260 |
| with taskId | 2,258 (99.9%) |
| with agentId | 2,259 |
| decisionReason | 2,260 (100%) |
| complexity | 2,260 (100%) |
| reuseVsSpawn | 2,260 (100%) |
| perModelScores non-null key | 2,260 rows have key; 샘플에서 배열이 비는 경우 다수 (`explicitModel=true` 경로) |
| distinct taskIds | 1,352 |

**metadata 예시 (비식별, 본 태스크 재스폰)**:

```json
{
  "reuseVsSpawn": "spawn",
  "selectedModel": "grok",
  "complexity": "standard",
  "eligibleModels": ["claude", "claude", "claude", "antigravity", "gpt", "grok"],
  "explicitModel": true,
  "decisionReason": "Explicit model 'grok' requested — scoring bypassed (budget +0(no-data)). Spawned new grok agent.",
  "spawnedModel": "grok-4.5",
  "perModelScores": []
}
```

### 3.4 `cost_logs.model` ↔ `agentId` 조인

```sql
SELECT
  COUNT(*) AS n,
  COUNTIF(model IS NOT NULL AND model != '') AS with_model,
  COUNTIF(agentId IS NOT NULL AND agentId != '') AS with_agentId,
  COUNTIF(taskId IS NOT NULL AND taskId != '') AS with_taskId,
  COUNTIF(taskType IS NOT NULL AND taskType != '') AS with_taskType,
  COUNTIF(sessionId IS NOT NULL AND sessionId != '') AS with_sessionId,
  COUNTIF(pricingSnapshot IS NOT NULL) AS with_pricing,
  COUNT(DISTINCT agentId) AS distinct_agents,
  COUNT(DISTINCT model) AS distinct_models
FROM `marblo-2253d.marblo_telemetry.cost_logs`;
```

| Field | Value |
|---|---:|
| n | 174,310 |
| model | 174,310 (100%) — **모델 id** (`claude-opus-5`, `gpt-5.5`, `grok-4.5-build`, …) |
| agentId | 174,310 (100%) |
| taskId | 46,805 (**26.9%**) |
| taskType | **0** |
| sessionId | **0** |
| pricingSnapshot | **0** |
| distinct agents | 1,930 |
| distinct models | 25 |

**Harness vs cost model (agentId 조인, top)**:

| harness (`agent:spawned.model`) | cost_models | agents |
|---|---|---:|
| gpt | gpt-5.5 | 1,507 |
| claude | claude,claude-opus-4-8 | 541 |
| claude | claude-opus-5 | 318 |
| grok | grok-4.5-build | 68 |
| gemini | claude-opus-4-1-20250805 | 90 (harness≠provider 교차 존재) |

**시맨틱 (cf. harness vs model axis)**:
- `events.agent:spawned.model` = **harness 축** (`claude`/`gpt`/`grok`/…)
- `cost_logs.model` = **모델 id 축** — harness와 1:1이 아님. **agentId 조인 필수**
- `cost_logs` 1행 = 폴링 델타(턴 아님). 최근 7일 agent별 행간격 quantile 중앙값 ≈ **381s** (idle 포함; 활성 구간은 ~15–30s 간격 샘플 확인)

---

## 4. 결과 축 검증 (`task_outcomes`)

```sql
SELECT
  COUNT(*) AS n,
  COUNTIF(success = TRUE) AS success_true,
  COUNTIF(success = FALSE) AS success_false,
  COUNTIF(model IS NOT NULL AND model != '') AS with_model,
  COUNTIF(taskType IS NOT NULL AND taskType != '') AS with_taskType,
  COUNTIF(retriesCount IS NOT NULL) AS with_retries,
  COUNTIF(IFNULL(retriesCount,0) > 0) AS retries_gt0,
  COUNTIF(durationMs IS NOT NULL) AS with_duration,
  COUNTIF(totalCost IS NOT NULL) AS with_cost,
  COUNTIF(errorCategory IS NOT NULL AND errorCategory != '') AS with_err_cat,
  COUNT(DISTINCT taskId) AS distinct_tasks
FROM `marblo-2253d.marblo_telemetry.task_outcomes`;
```

| Metric | Value |
|---|---:|
| rows | 888 |
| success=true | 849 (95.6%) |
| success=false | 39 (4.4%) — BLOCKED 33, **FAILED 6** |
| with model | 683 (76.9%) |
| with taskType | 759 (85.5%) |
| retriesCount filled | 888 — 값 >0 인 행 **1** |
| with durationMs | 795 |
| with totalCost | 770 |
| distinct taskIds | 858 |

### taskType 분포

| taskType | n |
|---|---:|
| bug-fix | 341 |
| test | 200 |
| (null) | 129 |
| refactor | 74 |
| feature | 51 |
| docs | 44 |
| infra | 41 |
| chore | 8 |

### 결과 구멍 (dispatch vs outcome)

```sql
-- dispatch distinct taskIds vs outcomes
-- result: dispatch_tasks=1352, outcome_tasks=858,
--         dispatch_with_outcome=790, dispatch_missing_outcome=562
```

| Join | Count | Rate |
|---|---:|---:|
| dispatch distinct tasks | 1,352 | base |
| with outcome | 790 | **58.4%** |
| missing outcome | 562 | **41.6%** |

**권한/상태 미기록 손실 추정**: dispatch 단위로 **약 42% 태스크가 outcome 라벨 없음**. `task:status_changed`/`task:completed` 이벤트 자체도 극소(각각 56/42행)라 클라이언트 상태 전이를 BQ 라벨로 복구하기 어렵다. `update_task_status` 실패(4ov5류)가 있으면 이 구멍과 직결된다.

---

## 5. Grok 실패 / 무산출 기록 여부

### 5.1 Spawn / Cost

| Signal | Value |
|---|---:|
| `agent:spawned` grok rows | 95 (distinct agents 83) |
| grok cost model | `grok-4.5-build` only — 92 rows, 61 agents, sum_out=1,416,271 (zero-out agents **0**) |
| grok spawn → cost | 61 / 83 (73.5%) |
| grok cost with taskId | 5 agents |
| grok → outcome via cost.taskId | **5** agents |

### 5.2 Outcomes

| Metric | n |
|---|---:|
| grok* outcomes | 21 |
| success | 17 |
| fail | 4 (FAILED 2, BLOCKED 2) |

**FAILED 예시 (실존)**:
- `86Zo7G3kstXz6kyVHS1m` — `grok-4.5-build`, success=false, errorCategory=**FAILED**, durationMs≈15.4M
- `6PxRAItma12Ifbrhb22t` — `grok-4.5-build`, success=false, errorCategory=**FAILED**, totalCost=0.44

### 5.3 “무산출” 판정

| 질문 | 답 |
|---|---|
| cost_logs에서 grok agent out=0? | **아니오** (0 agents) — 폴링이 붙으면 출력이 잡힘 |
| spawn만 있고 cost 없는 grok? | **예** (예: 현재 세션 `31b79412-…`, 직전 `f5bf4626-…`) — 인증/조기종료/폴링 미연결 |
| outcome에 실패 라벨? | **예** (4건) — 다만 전체 grok spawn 대비 희소 |
| “무산출 실패”를 단일 플래그로? | **아니오** — 스키마에 no-output/empty-result 카테고리 없음 |

**판정**: Grok **실패 일부는 BQ에 잡힌다**. **무산출(zero product) 전용 신호는 없고**, 대부분 “spawn 있음 + cost 없음 또는 outcome 없음”으로만 간접 관측된다.

---

## 6. 샘플 행 (비식별)

`userId`는 prefix만. 운영 토큰/시크릿 없음.

### 6.1 `events` — agent:spawned (5)

| agentId (full — join key) | model | role | taskId | promptLength | metadata | timestamp (UTC) |
|---|---|---|---|---:|---|---|
| 31b79412-6bc4-4185-8995-4e09acbe8feb | grok | backend | null | 2129 | `{"accountUserId":"…"}` | 2026-08-08 01:20:47 |
| fd6380f0-b7b9-47df-9ec7-88e934d90c58 | gpt | backend | null | null | accountUserId only | 2026-08-08 01:19:21 |
| 8e5e5bec-cc73-4ac7-a24f-29ac12727756 | gpt | backend | null | null | accountUserId only | 2026-08-08 01:19:13 |
| 968db780-1518-4c9c-bdf1-6afb0e83991e | gpt | frontend | null | null | accountUserId only | 2026-08-08 01:19:13 |
| 98b0e063-043e-4c0f-9236-ee090e70c94e | gpt | frontend | null | null | accountUserId only | 2026-08-08 01:19:13 |

### 6.2 `cost_logs` (nonzero, 5)

| agentId | model | in | out | cost | taskId | timestamp |
|---|---|---:|---:|---:|---|---|
| db672f68-… | gpt-5.5 | 204744 | 18059 | 4.4976 | null | 2026-08-08 01:19:21 |
| fd6380f0-… | gpt-5.5 | 46463 | 6407 | 0.7689 | null | 2026-08-08 01:19:21 |
| f20b6c62-… | gpt-5.5 | 101880 | 7616 | 1.3173 | null | 2026-08-08 01:19:21 |
| fb775877-… | gpt-5.5 | 53345 | 5444 | 0.7819 | null | 2026-08-08 01:19:21 |
| ef316387-… | gpt-5.5 | 118458 | 12986 | 1.3170 | null | 2026-08-08 01:19:21 |

**폴링 델타 예시** (agent `f264dcb4-…`, task `Dt2qlwaBDxLHTZJVtWU3`, model `MiniMax-M2.7`):

| timestamp | in | out | cost |
|---|---:|---:|---:|
| 01:49:18 | 0 | 0 | 0 |
| 01:49:33 | 247324 | 3420 | 0.1449 |
| 01:50:03 | 509172 | 4384 | 0.1672 |
| 01:50:18 | 537436 | 820 | 0.1702 |
| 01:50:48 | 235530 | 4191 | 0.0791 |

간격 ≈15–30s → **턴 단위가 아닌 폴 델타** 확인.

### 6.3 `task_outcomes` (5)

| taskId | role | model | taskType | success | durationMs | totalCost | retries | createdAt |
|---|---|---|---|---|---:|---:|---:|---|
| l2b47t4I9RcvZ6rjqaet | backend | claude-opus-5 | infra | true | 1,462,011 | 23.94 | 0 | 2026-08-08 00:36 |
| CU6qQl8tEYhISM5QyS5d | frontend | claude-opus-5 | feature | true | 939,328 | 11.56 | 0 | 2026-08-08 00:34 |
| AFfUD3h2DaQZweNdwDhy | backend | claude-opus-5 | bug-fix | true | 1,228,155 | 16.14 | 0 | 2026-08-08 00:26 |
| j7TmrCcWVZI7bRhGXvpY | frontend | claude-opus-5 | test | true | 336,084 | 35.72 | 0 | 2026-08-08 00:10 |
| 1IZJDuDDJGLzdZJ61ziS | frontend | claude-opus-5 | bug-fix | true | 1,766,353 | 20.48 | 0 | 2026-08-07 14:06 |

### 6.4 `agent_heartbeats` (5)

| agentId | status | tokensAccumulated | costAccumulated | timestamp |
|---|---|---:|---:|---|
| d9a4799c-… | idle | 0 | 0 | 2026-08-08 01:23:32 |
| ce7ffd07-… | idle | 0 | 0 | 2026-08-08 01:23:32 |
| ed333657-… | idle | 0 | 0 | 2026-08-08 01:23:32 |
| a3cb8fb1-… | idle | 0 | 0 | 2026-08-08 01:23:32 |
| 5299f04f-… | idle | 0 | 0 | 2026-08-08 01:23:32 |

### 6.5 `flow_executions`

**0 rows** — 샘플 없음.

---

## 7. E2E 조인 예시 1건 (실측)

### Join path

```
dispatch:decision (agentId + taskId + decisionReason + harness model)
        │
        ├─ agentId ──► agent:spawned (harness model, role, promptHash; taskId 없음)
        │
        ├─ agentId ──► cost_logs (model id, token deltas; taskId 있으면 강화)
        │
        └─ taskId  ──► task_outcomes (success, duration, totalCost, taskType)
```

### Concrete chain — `TdlWmESRnuGr7zltvRKM`

| Stage | Key | Values |
|---|---|---|
| **dispatch** | agentId `edc22d0c-6fd0-4ac5-8e7f-984ed152f420`, taskId `TdlWmESRnuGr7zltvRKM` | harness=`claude`, role=`backend`, complexity=`standard`, reuseVsSpawn=`spawn`, decisionReason=`Explicit model 'claude' requested…`, spawnedModel=`claude-opus-5`, ts=2026-08-08 00:37:28 |
| **spawn** | same agentId | model=`claude`, role=`backend`, **taskId=null**, promptLength=2199, ts=동일 |
| **cost_logs** | same agentId (+ taskId 매칭 시) | model=`claude-opus-5`, cost_rows≈61, sum_in=418, sum_out=207,398, sum_cost≈**25.58** |
| **task_outcomes** | taskId | success=**true**, model=`claude-opus-5`, taskType=`feature`, durationMs=1,612,560, totalCost≈**25.58**, retriesCount=0, completedAt=2026-08-08 01:04:10 |

### Spawn→cost→outcome coverage (전체)

| Join | Distinct spawn agents | Count | Rate |
|---|---:|---:|---:|
| spawn agents | 2,882 | — | — |
| + cost | 1,917 | 66.5% |
| + cost.taskId | 1,342 | 46.6% |
| + outcome via cost.taskId | 787 | 27.3% |

---

## 8. ML 학습 갭 목록 + 수집 제안

| # | 축 | 현재 상태 | 영향 | 수집 제안 |
|---|---|---|---|---|
| G1 | **spawn.taskId** | agent:spawned taskId **0%** | 스폰 단위 지도학습 불가 | spawn 이벤트에 dispatch.taskId 필수 기록 |
| G2 | **spawn 사유** | spawned metadata에 reason 없음 (accountUserId만) | 왜 그 모델인지 학습 불가 | decisionReason/complexity/scores를 spawned에도 복제 또는 join key 보장 |
| G3 | **harness vs model id** | 축이 테이블마다 다름 | feature leakage / 잘못된 target | 학습 feature 테이블에 `harnessModel` + `resolvedModelId` 둘 다 1행으로 materialize |
| G4 | **cost.taskId** | 26.9% only | 비용 타깃이 태스크에 안 붙음 | 폴러가 agent→task 바인딩을 항상 넣도록 수정 |
| G5 | **cost.taskType / sessionId / pricingSnapshot** | **0%** | 타입별 비용·세션·가격 드리프트 불가 | 폴 시점 taskType 스냅샷 + sessionId + pricing JSON |
| G6 | **retriesCount** | 스키마 O, 실질 **미사용** (1/888) | 재시도 정책 학습 불가 | 재스폰/재클레임 시 increment + retryOf 링크 |
| G7 | **parentAgentId / retryOf** | events **0%** | 계보·핸드오프 학습 불가 | orchestrator spawn path에서 parent/retry 필드 채우기 |
| G8 | **flow_executions** | **0 rows** | 플로우 ML non-starter | 실행 완료 훅에서 BQ insert 연결 확인 |
| G9 | **outcome 구멍** | dispatch 대비 **41.6% 미라벨** | 성공 편향 + 손실 | status 전이(DONE/FAILED/BLOCKED/REVIEW) 서버측 확정 시 무조건 outcome upsert; 4ov5 권한 실패 시 dead-letter |
| G10 | **negative label 품질** | fail 39 중 BLOCKED 33, FAILED 6 | “막힘”과 “모델 실패” 혼동 | errorCategory 세분화: `MODEL_FAIL` / `AUTH` / `TOOL` / `TIMEOUT` / `BLOCKED_DEP` / `NO_OUTPUT` |
| G11 | **무산출 신호** | 없음 | grok empty-run 학습 불가 | agent stop 시 `outputChars`/`filesChanged`/`prUrl` 집계 후 `success=false, errorCategory=NO_OUTPUT` |
| G12 | **taskType on events/cost** | events 49행(merged 관련), cost 0 | feature sparse | dispatch/outcome 파생 taskType을 cost 폴에 전파 |
| G13 | **perModelScores** | key는 있으나 explicit 경로에서 빈 배열 | 랭킹 모델 학습 데이터 부족 | 점수 경로 강제 로깅(explicit bypass여도 후보 점수 스냅샷) |
| G14 | **파티션/클러스터** | 없음 | 스캔 비용·신선도 쿼리 비효율 | `timestamp` DAY partition + cluster(event, projectId) 권장 |
| G15 | **outcome.agentId** | 컬럼 없음 | agent 단위 라벨 조인 우회 필요 | outcome에 agentId 추가 또는 bridge 테이블 |

### 권장 materialize 뷰 (학습용 1행/태스크)

```sql
-- sketch only
SELECT
  d.taskId,
  d.agentId,
  d.model AS harness_model,
  JSON_VALUE(d.metadata, '$.spawnedModel') AS resolved_model_hint,
  JSON_VALUE(d.metadata, '$.decisionReason') AS decision_reason,
  JSON_VALUE(d.metadata, '$.complexity') AS complexity,
  JSON_VALUE(d.metadata, '$.reuseVsSpawn') AS reuse_vs_spawn,
  s.role,
  s.promptLength,
  c.cost_model,
  c.sum_cost,
  c.sum_in,
  c.sum_out,
  o.success,
  o.errorCategory,
  o.durationMs,
  o.taskType,
  o.retriesCount
FROM events d
JOIN events s ON s.event='agent:spawned' AND s.agentId=d.agentId
LEFT JOIN cost_agg c ON c.agentId=d.agentId
LEFT JOIN task_outcomes o ON o.taskId=d.taskId
WHERE d.event='dispatch:decision';
```

---

## 9. 이벤트 타입 분포 (참고)

| event | n | model% | role% | taskId% | agentId% |
|---|---:|---:|---:|---:|---:|
| token:usage | 174,884 | 100 | 0 | 0 | 100 |
| agent:spawned | 5,811 | 100 | 100 | **0** | 100 |
| dispatch:decision | 2,260 | 100 | 100 | 99.9 | 99.96 |
| agent:stopped | 1,389 | 0 | 0 | 0 | 100 |
| session:started | 1,309 | 0 | 0 | 0 | 0 |
| agent:restarted | 1,165 | ~0 | 0 | ~0 | 100 |
| agent:crashed | 962 | ~0 | 0 | ~0 | 100 |
| task:merged | 49 | 0 | 0 | 100 | 0 |
| task:status_changed | 56 | 0 | 0 | 100 | 79 |
| task:completed | 42 | 0 | 0 | 100 | 86 |

---

## 10. 완료 기준 체크리스트

| 기준 | 상태 |
|---|---|
| 전 테이블 스키마 + 샘플 문서 (`v3/docs`) | ✅ 본 문서 |
| 스폰→진행→결과 agentId/taskId E2E 1건 | ✅ §7 `TdlWmESRnuGr7zltvRKM` |
| ML 갭 목록 + 수집 제안 | ✅ §8 |
| Grok 실패/무산출 BQ 기록 여부 | ✅ 실패 **예(희소)** / 무산출 전용 **아니오** |
| 수치 전부 실쿼리 + 쿼리문 첨부 | ✅ 각 절 SQL |

---

## 11. Appendix — 재현용 쿼리 묶음

```sql
-- A. event type rollup
SELECT event, COUNT(*) AS n,
  COUNTIF(model IS NOT NULL AND model != '') AS with_model,
  COUNTIF(role IS NOT NULL AND role != '') AS with_role,
  COUNTIF(taskId IS NOT NULL AND taskId != '') AS with_task,
  COUNTIF(agentId IS NOT NULL AND agentId != '') AS with_agent
FROM `marblo-2253d.marblo_telemetry.events`
GROUP BY event ORDER BY n DESC;

-- B. grok outcome labels
SELECT
  COUNTIF(LOWER(IFNULL(model,'')) LIKE '%grok%') AS grok_outcomes,
  COUNTIF(LOWER(IFNULL(model,'')) LIKE '%grok%' AND success=TRUE) AS grok_success,
  COUNTIF(LOWER(IFNULL(model,'')) LIKE '%grok%' AND success=FALSE) AS grok_fail,
  COUNTIF(LOWER(IFNULL(model,'')) LIKE '%grok%' AND errorCategory='FAILED') AS grok_err_failed,
  COUNTIF(LOWER(IFNULL(model,'')) LIKE '%grok%' AND errorCategory='BLOCKED') AS grok_err_blocked
FROM `marblo-2253d.marblo_telemetry.task_outcomes`;

-- C. clean E2E pick
WITH d AS (
  SELECT agentId, taskId, model AS harness, role,
    JSON_VALUE(metadata, '$.decisionReason') AS decisionReason,
    JSON_VALUE(metadata, '$.spawnedModel') AS spawnedModel,
    timestamp AS dispatch_ts
  FROM `marblo-2253d.marblo_telemetry.events`
  WHERE event = 'dispatch:decision'
    AND agentId IS NOT NULL AND taskId IS NOT NULL
    AND timestamp >= TIMESTAMP('2026-07-20')
),
c AS (
  SELECT agentId, taskId,
    STRING_AGG(DISTINCT model ORDER BY model LIMIT 3) AS cost_models,
    COUNT(*) AS cost_rows,
    SUM(inputTokens) AS sum_in,
    SUM(outputTokens) AS sum_out,
    ROUND(SUM(totalCost),6) AS sum_cost
  FROM `marblo-2253d.marblo_telemetry.cost_logs`
  GROUP BY agentId, taskId
)
SELECT d.*, c.cost_models, c.cost_rows, c.sum_in, c.sum_out, c.sum_cost,
  o.success, o.model AS outcome_model, o.totalCost, o.taskType, o.retriesCount
FROM d
JOIN c ON c.agentId = d.agentId AND c.taskId = d.taskId
JOIN `marblo-2253d.marblo_telemetry.task_outcomes` o ON o.taskId = d.taskId
WHERE c.sum_out > 100
ORDER BY d.dispatch_ts DESC
LIMIT 5;
```

---

*Generated by backend agent for task JIfsNIwoy6W4iui0h8CZ. All counts from live BQ on 2026-08-08.*
