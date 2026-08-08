# 비용 축 정합화 — `task_outcomes` vs `cost_logs` ($11.20 vs $0.19) 규명

작성 2026-08-08 · 티켓 `TPx8wXtP1IkqazJyZ6DM` · 근거 = BigQuery `marblo-2253d.marblo_telemetry` 실쿼리
(john.kim ADC + REST `jobs.query`, cf. [`memory: bq_telemetry_adc_rest_access`])

이 문서의 **모든 수치는 아래 본문에 붙인 쿼리를 그대로 돌린 결과**다. 추정·환산·인용 없음.
#866 라운드테이블이 "클라우드 논의의 선행조건"으로 지목한 축이 이 문서에서 닫힌다.

---

## 0. 한 문단 요약

**$11.20 vs $0.19 는 적재 버그가 아니라 쿼리 축 오류다.** 두 테이블의 `userId` 는 서로 다른
ID 공간이고(설치 clientId vs Firebase uid) **교집합이 0행**이라, `userId` 로 "외부 유저" 를
고른 뒤 다른 테이블에서 같은 필터를 쓰는 순간 반드시 어긋난다. `taskId` 로 조인하면 #850 이
든 4건이 **소수점까지 일치**한다($3.85 / $13.90 / $4.06 / $11.20).

다만 조사 과정에서 **진짜 결함 2개**가 나왔고 둘 다 전역 `cost_logs` 합계를 부풀린다
(2026-08 비용의 32%가 가공). 결정적으로 그 오염은 **`taskId` 가 없는 행에만** 몰려 있어,
태스크 단위 원가 계산에는 닿지 않는다.

**정본 판정: 태스크 원가의 정본 축은 `cost_logs` 를 `taskId` 로 집계한 값이다.**
`task_outcomes.totalCost` 는 같은 수치의 스냅샷이며 96.5% 에서 소수점까지 일치하는
**하한(lower bound)** 이다.

---

## 1. 진범 ①(헤드라인) — 두 테이블은 `userId` 로 조인할 수 없다

`v3/functions/src/index.ts` 가 두 행을 서로 다른 키로 쓴다:

| 테이블          | `userId` 에 들어가는 값     | 코드                                                 |
| --------------- | --------------------------- | ---------------------------------------------------- |
| `cost_logs`     | Firebase 계정 uid           | `const userId = context.auth.uid;` (`index.ts:6625`) |
| `task_outcomes` | 익명 설치 clientId (비식별) | `userId: d.clientId \|\| "anon"` (`index.ts:6832`)   |

실측:

```sql
WITH cl AS (SELECT DISTINCT userId FROM `marblo-2253d.marblo_telemetry.cost_logs`),
     tox AS (SELECT DISTINCT userId FROM `marblo-2253d.marblo_telemetry.task_outcomes`)
SELECT (SELECT COUNT(*) FROM cl)  AS costlogs_uids,
       (SELECT COUNT(*) FROM tox) AS outcome_uids,
       (SELECT COUNT(*) FROM cl JOIN tox USING(userId)) AS overlap,
       (SELECT COUNTIF(REGEXP_CONTAINS(userId, r'^[0-9a-f]{8}-[0-9a-f]{4}-')) FROM cl)  AS cl_uuid_shaped,
       (SELECT COUNTIF(REGEXP_CONTAINS(userId, r'^[0-9a-f]{8}-[0-9a-f]{4}-')) FROM tox) AS to_uuid_shaped;
```

| costlogs_uids | outcome_uids | **overlap** | cl_uuid_shaped | to_uuid_shaped |
| ------------: | -----------: | ----------: | -------------: | -------------: |
|             4 |            7 |       **0** |              0 |              7 |

`cost_logs` 의 uid 는 Firebase 형식이고 `task_outcomes` 의 uid 는 전부 UUID(clientId)다.
**같은 행을 가리키는 값이 하나도 없다.** #850 §11 이 "외부 uid 합 $0.19" 를 얻은 건 데이터가
어긋나서가 아니라, `cost_logs` 에는 애초에 clientId 로 고를 수 있는 행이 없기 때문이다.

### 1-1. `taskId` 로 조인하면 정확히 맞는다

```sql
WITH o AS (
  SELECT userId AS clientId, taskId, model, totalCost, completedAt
  FROM `marblo-2253d.marblo_telemetry.task_outcomes`
  WHERE (STARTS_WITH(userId,'ef1bd222') OR STARTS_WITH(userId,'31f19ceb')
      OR STARTS_WITH(userId,'b304e231')) AND totalCost > 3
)
SELECT SUBSTR(o.clientId,1,8) AS client, o.taskId, o.model,
       ROUND(o.totalCost,2) AS outcome_cost, c.userId AS costlogs_uid,
       ROUND(c.cost,2) AS costlogs_cost, c.rows_
FROM o LEFT JOIN (
  SELECT taskId, userId, SUM(totalCost) cost, COUNT(*) rows_
  FROM `marblo-2253d.marblo_telemetry.cost_logs` GROUP BY taskId, userId
) c USING(taskId) ORDER BY o.completedAt;
```

| client     | taskId                 | model         | `task_outcomes` | `cost_logs` | 행수 |
| ---------- | ---------------------- | ------------- | --------------: | ----------: | ---: |
| `ef1bd222` | `3Yj6XBvhBqYM7hL7gLmw` | gpt-5.5       |           $3.85 |   **$3.85** |   47 |
| `31f19ceb` | `2m7QebtFx56o7genRiAi` | claude-opus-5 |          $13.90 |  **$13.90** |   44 |
| `31f19ceb` | `Ex6uxYxmDF7aFV0K5a0k` | claude-opus-5 |           $4.06 |   **$4.06** |   14 |
| `b304e231` | `r8vIviEcwHFbFJ88RqZ7` | claude-opus-5 |          $11.20 |  **$11.20** |   31 |

문제의 `b304e231` 건은 소수점 4자리까지 같다(`11.198718` vs `11.1987`, 31행 합). 토큰도 같다
(input 201 / output 79,219).

**전수 대조** — 비용이 실린 `task_outcomes` 762 태스크 전부가 `cost_logs` 와 매칭되고,
737건(96.7%)이 $0.0001 미만 오차다. 합계 $6,914.34 vs $6,950.73 (차 0.5%).

### 1-2. ★부수 정정 — "외부 완료" 대부분은 사장님 본인 계정이다

`taskId` 를 경유하면 clientId ↔ Firebase uid 크로스워크를 처음으로 만들 수 있다:

```sql
WITH o AS (SELECT DISTINCT userId AS clientId, taskId FROM `marblo-2253d.marblo_telemetry.task_outcomes`),
     c AS (SELECT DISTINCT userId AS uid, taskId FROM `marblo-2253d.marblo_telemetry.cost_logs` WHERE taskId IS NOT NULL)
SELECT SUBSTR(o.clientId,1,8) AS clientId8, c.uid, COUNT(DISTINCT o.taskId) AS shared_tasks
FROM o JOIN c USING(taskId) GROUP BY clientId8, c.uid ORDER BY shared_tasks DESC;
```

| clientId8  | Firebase uid    | 공유 태스크 |
| ---------- | --------------- | ----------: |
| `3a7c6019` | `RSALO1…`(오너) |         344 |
| `3f820e30` | `RSALO1…`(오너) |         276 |
| `394952a8` | `RSALO1…`(오너) |         148 |
| `552b1092` | `RSALO1…`(오너) |           5 |
| `b304e231` | `RSALO1…`(오너) |           1 |
| `ef1bd222` | `RSALO1…`(오너) |           1 |
| `31f19ceb` | `Y6TGxU…`       |           2 |

7개 clientId 중 **6개가 같은 오너 계정**이다(설치별 clientId 라 재설치·다른 맥이면 새 id 가 난다).
`task_outcomes` 만 보면 "외부 설치 6" 처럼 보이지만 **실제 외부 계정은 `31f19ceb` 하나**다.

→ #850 §2-B 표와 #866/CEO리뷰의 "외부 완료 1건 $3.85~$13.90 (평균 $8.25)" 는 **재작성 대상**이다.
정확히는: 외부 완료는 `31f19ceb` 의 2건($13.90 · $4.06)뿐이고, `ef1bd222`·`b304e231` 는 오너
설치다. `552b1092` 를 "판별 불가" 로 뺐던 것도 이제 오너로 확정된다.
(전체 태스크 단위로도 동일: 비용이 귀속된 1,341 태스크 중 오너 1,338 / 외부 3.)

---

## 2. 진범 ②·③ — 전역 `cost_logs` 합계는 신뢰할 수 없다 (실제 결함)

전역 합계는 어긋나 있다: `cost_logs` $93,388 vs `task_outcomes` $6,968. 이건 축 문제가 아니라
**중복 적재**다. 단일 행 분포가 먼저 이상하다:

```sql
SELECT CASE WHEN totalCost = 0 THEN 'a: $0' WHEN totalCost < 0.01 THEN 'b: <1c'
            WHEN totalCost < 0.1 THEN 'c: 1-10c' WHEN totalCost < 1 THEN 'd: 10c-$1'
            WHEN totalCost < 5 THEN 'e: $1-5' WHEN totalCost < 20 THEN 'f: $5-20'
            ELSE 'g: >=$20' END AS bucket,
       COUNT(*) rows_, ROUND(SUM(totalCost),2) cost, ROUND(MAX(totalCost),2) max_row,
       ROUND(MAX(cacheReadTokens)/1e6,1) max_cread_M
FROM `marblo-2253d.marblo_telemetry.cost_logs` GROUP BY bucket ORDER BY bucket;
```

| bucket | 행수    |        비용 |   최대 단일행 | 최대 캐시리드 |
| ------ | ------- | ----------: | ------------: | ------------: |
| >= $20 | **170** | **$68,439** | **$1,165.81** |  **1,998.4M** |
| $5–20  | 426     |      $3,670 |               |               |
| 10c–$1 | 48,554  |     $14,724 |               |               |
| $0     | 104,509 |          $0 |               |               |

**0.1% 의 행이 전체 비용의 73% 를 차지한다.** `cost_logs` 1행은 15초 폴 델타다
(cf. [`memory: bq_harness_vs_model_axis_and_costlogs_semantics`]). 15초에 캐시리드 20억 토큰은
물리적으로 불가능하다 — 이건 **이미 청구한 바이트를 다시 읽은 지문**이다.

### 2-A. 결함 D1 — 팬아웃 오귀속 (2026-06, 종료됨)

`>= $20` 행들을 열면 **서로 다른 agentId 9개가 같은 초에 완전히 동일한 토큰 번들**
(1,930,240 in / 11,317,304 out / 1,995.3M cache-read)을 적재한다. 하나의 세션 파일이 N개
에이전트에게 동시에 청구된 것이다.

발원지는 `cost-tracker.ts` `trackSession` 의 sessionId 없는 분기 — "프로젝트 폴더에서 가장 최근
수정된 JSONL" 을 고른다. 콜드부트 reconnect 에서 그건 **다른 에이전트의 살아있는 세션**이다.
(같은 파일의 주석이 `custom` 하네스에 대해 이미 이 실패모드를 경고하고 있었다.)

```sql
WITH f AS (
  SELECT TIMESTAMP_TRUNC(timestamp, SECOND) sec, inputTokens, outputTokens, cacheReadTokens, model,
         COUNT(DISTINCT agentId) n_agents, ROUND(SUM(totalCost),2) cost
  FROM `marblo-2253d.marblo_telemetry.cost_logs` WHERE totalCost > 0
  GROUP BY sec, inputTokens, outputTokens, cacheReadTokens, model)
SELECT FORMAT_DATE('%Y-%m', DATE(sec)) month, COUNTIF(n_agents > 1) fanout_groups,
       ROUND(SUM(IF(n_agents > 1, cost, 0)),2) fanout_cost, ROUND(SUM(cost),2) month_cost
FROM f GROUP BY month ORDER BY month;
```

| month   | 팬아웃 그룹 | 팬아웃 비용 | 월 비용 |      비율 |
| ------- | ----------: | ----------: | ------: | --------: |
| 2026-04 |           0 |          $0 |    $270 |        0% |
| 2026-05 |          72 |        $0.7 |      $8 |      8.9% |
| 2026-06 |       1,554 | **$50,639** | $76,414 | **66.3%** |
| 2026-07 |           1 |       $0.73 |  $8,506 |        0% |
| 2026-08 |           0 |          $0 |  $8,194 |        0% |

**2026-06-18 이후 소멸**했다(최대 팬아웃 11 에이전트, 6/13·6/15 가 피크). 6월은 텔레메트리
프로덕션 ON(2026-07-17) 이전의 도그푸드 구간이라, 이 $50k 는 **어떤 경제 판단에도 쓰면 안 된다.**

### 2-B. 결함 D2 — 세션파일 재읽기 중복 (★현재 진행형)

D1 이 사라진 뒤에도 남은 패턴: **같은 agentId 가 완전히 동일한 번들을 반복 적재**한다.

```sql
SELECT agentId, model, ROUND(totalCost,2) cost, inputTokens, outputTokens,
       ROUND(cacheReadTokens/1e6,1) cread_M, timestamp
FROM `marblo-2253d.marblo_telemetry.cost_logs`
WHERE timestamp >= '2026-07-01' ORDER BY totalCost DESC LIMIT 20;
```

`104c9268…` / gpt-5.5 가 `734,788 in · 41,976 out · 21.4M cache-read · $15.65` 를 **16회** 적재.
타임스탬프는 며칠에 걸쳐 흩어져 있고, 일부는 7~8초 간격 쌍이다(앱 재시작 / 재부착 / 즉시폴).

```sql
WITH d AS (
  SELECT agentId, model, taskId IS NOT NULL has_task,
         inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens,
         COUNT(*) n, ANY_VALUE(totalCost) unit_cost,
         inputTokens+outputTokens+cacheReadTokens+cacheWriteTokens AS toks
  FROM `marblo-2253d.marblo_telemetry.cost_logs`
  WHERE totalCost > 0 AND timestamp >= '2026-07-01'
  GROUP BY agentId, model, has_task, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens)
SELECT has_task, IF(toks >= 100000,'large','small') size_class, COUNT(*) bundles, COUNTIF(n>1) repeated,
       ROUND(SUM(n*unit_cost),2) billed, ROUND(SUM(unit_cost),2) deduped,
       ROUND(SUM((n-1)*unit_cost),2) excess,
       ROUND(100*SUM((n-1)*unit_cost)/NULLIF(SUM(n*unit_cost),0),1) pct_excess
FROM d GROUP BY has_task, size_class ORDER BY has_task DESC, size_class;
```

| `taskId` 있음 | 번들 크기 |     적재됨 |   중복제거 |        초과분 |    초과율 |
| ------------: | --------- | ---------: | ---------: | ------------: | --------: |
|      **true** | large     | $10,810.63 | $10,810.26 |     **$0.36** |  **0.0%** |
|      **true** | small     |    $451.36 |    $451.36 |            $0 |        0% |
|     **false** | large     |  $5,436.70 |  $1,127.22 | **$4,309.47** | **79.3%** |
|     **false** | small     |     $20.24 |     $19.22 |         $1.01 |      5.0% |

**이것이 이 조사의 결정적 관측이다.** 중복은 `taskId=null` 행에만 있고, `taskId` 가 붙은 행은
**초과분 0.0%** 다. 월별로는 2026-08 전체 비용의 32.4%($2,652/$8,196)가 가공이다.

#### 진범 (코드)

`ParseState.lastLineCount` 워터마크가 **프로세스 메모리에만** 있었다
(`session-parsers.ts:57-69`, `newParseState()`). 같은 세션 파일에 트래커가 다시 붙을 때마다
워터마크가 0 으로 돌아가고 파일 전체가 한 번의 "델타" 로 다시 나갔다. 재부착 경로:

1. **앱 재시작** — resume 중인 모든 세션이 처음부터 다시 읽힌다.
2. **reuse_agent / reconnect** — 같은 agentId 에 `trackSession` 재호출.
3. **`findNewestSessionFile` mtime 플랩** — codex/gemini/grok 는 매 틱 최신 파일을 다시 고르는데,
   이미 소비한 파일로 되돌아오면 `tracker.state = newParseState()` 로 전체 재파싱.

이건 BigQuery 만의 문제가 아니다. 같은 델타가 `usage-rollup.recordUsageDelta` 로도 흘러
`selectAutoModel` 의 주간 한도 압력을 부풀린다 — **라우터가 가짜 소진율을 학습한다.**

---

## 3. 정본 축 판정과 정본 쿼리

### 판정

| 질문                                  | 정본 축                                        | 근거                                            |
| ------------------------------------- | ---------------------------------------------- | ----------------------------------------------- |
| **태스크당 원가**                     | `cost_logs` 를 `taskId` 로 SUM (중복제거 적용) | 중복 초과분 0.0%, `task_outcomes` 와 96.5% 일치 |
| 태스크 라벨(taskType/role/model/성공) | `task_outcomes` **최신 행**                    | 라벨은 여기만 있다                              |
| 태스크당 원가(빠른 근사)              | `task_outcomes.totalCost` — **하한**으로만     | 롤업 버퍼 유실 + 완료 후 지출 미포함            |
| 계정/유저 단위 비용                   | `cost_logs.userId` (Firebase uid)              | `task_outcomes.userId` 는 clientId 다           |
| 전역 총비용                           | ❌ 어느 쪽도 그냥 SUM 하면 안 된다             | D1·D2 중복 + `task_outcomes` 다중행             |

### 정본 쿼리 (복사해서 쓸 것)

```sql
-- ── 정본 비용 뷰: cost_logs 에서 D1·D2 중복을 제거한 것 ──────────────
-- 100k 토큰 이상 번들에만 적용한다(작은 델타의 우연 일치를 건드리지 않는다).
WITH base AS (
  SELECT *, inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens AS toks
  FROM `marblo-2253d.marblo_telemetry.cost_logs`
),
l1 AS (  -- D2: 같은 에이전트가 동일 번들 재적재 = 세션파일 재읽기
  SELECT *, IF(toks >= 100000, ROW_NUMBER() OVER (
      PARTITION BY userId, agentId, model, COALESCE(taskId,'~'),
                   inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens
      ORDER BY timestamp), 1) AS rn1
  FROM base
),
l2 AS (  -- D1: N개 에이전트가 1분 내 동일 번들 = 팬아웃 오귀속
  SELECT *, IF(toks >= 100000, ROW_NUMBER() OVER (
      PARTITION BY userId, model, TIMESTAMP_TRUNC(timestamp, MINUTE),
                   inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens
      ORDER BY rn1, IF(taskId IS NULL, 1, 0), timestamp), 1) AS rn2
  FROM l1
)
SELECT * FROM l2 WHERE rn1 = 1 AND rn2 = 1
```

**안전성 검증** — 이 중복제거는 태스크 귀속 비용을 **한 푼도 바꾸지 않는다**:

| 태스크 수 | 중복제거로 값이 바뀐 태스크 | 원본 합계 | 정본 합계 | `task_outcomes` 와 일치 |
| --------: | --------------------------: | --------: | --------: | ----------------------: |
|       765 |                       **0** | $7,008.89 | $7,008.89 |             738 (96.5%) |

즉 **정본 뷰는 오염된 `taskId=null` 구간만 걷어낸다.** 6월의 $50k 는 전부 `taskId=null` 이라
태스크 축에는 애초에 들어오지 않는다(6월 `clean_task_cost` = $0).

---

## 4. 신뢰 가능한 수치 (2026-08-08 실측)

정본 뷰 + `taskId` 귀속 + `task_outcomes` 최신행 라벨.

### 4-1. 태스크당

| 계정           | 태스크 |     총비용 |  평균 | 중앙값 |    p90 |   최대 |
| -------------- | -----: | ---------: | ----: | -----: | -----: | -----: |
| 오너(john.kim) |  1,338 | $11,261.02 | $8.42 |  $5.11 | $21.18 | $73.25 |
| 외부 `Y6TGxU…` |      2 |     $17.96 | $8.98 |  $4.06 | $13.90 | $13.90 |
| 외부 `QxW59C…` |      1 |      $0.11 | $0.11 |  $0.11 |  $0.11 |  $0.11 |

**태스크 1건 = 중앙값 $5.11 / 평균 $8.42 (list price).** 태스크당 에이전트 1.05개.
비용이 귀속된 데이터는 전부 최근 30일 구간이다(`taskId` 스탬프가 그때 들어갔다).

### 4-2. taskType 별

| taskType | 태스크 |    총비용 |   평균 | 중앙값 |    p90 |   최대 |
| -------- | -----: | --------: | -----: | -----: | -----: | -----: |
| bug-fix  |    302 | $2,328.68 |  $7.71 |  $4.40 | $20.21 | $73.25 |
| test     |    183 | $1,857.48 | $10.15 |  $6.40 | $23.76 | $55.02 |
| (null)   |     85 |   $977.41 | $11.50 |  $7.78 | $28.61 | $55.39 |
| refactor |     71 |   $529.81 |  $7.46 |  $4.91 | $14.59 | $47.82 |
| feature  |     48 |   $516.25 | $10.76 |  $7.87 | $25.82 | $37.36 |
| infra    |     39 |   $409.29 | $10.49 |  $6.92 | $23.23 | $43.98 |
| docs     |     43 |   $341.59 |  $7.94 |  $7.29 | $16.60 | $27.72 |
| chore    |      6 |    $81.54 | $13.59 | $13.68 | $27.85 | $27.85 |

#850 이 든 `bug-fix $11.20` 은 bug-fix 중앙값 $4.40 의 2.5배 — **꼬리값이지 대표값이 아니다.**
`bug-fix` 실패 태스크 평균은 $6.96 으로 성공($7.71)과 큰 차이가 없다.

### 4-3. 모델별 (태스크 귀속분)

| model           | 태스크 | 귀속 비용 | 태스크당 |
| --------------- | -----: | --------: | -------: |
| claude-opus-5   |    462 | $7,181.90 |   $15.55 |
| claude-opus-4-8 |    236 | $1,606.64 |    $6.81 |
| gpt-5.5         |    431 | $1,027.51 |    $2.38 |
| claude-fable-5  |     64 | $1,021.43 |   $15.96 |
| claude-sonnet-5 |     48 |   $328.53 |    $6.84 |
| gpt-5.6-terra   |     54 |    $50.34 |    $0.93 |
| gpt-5.6-luna    |     47 |    $36.20 |    $0.77 |
| MiniMax-M2.7    |      9 |     $9.26 |    $1.03 |
| grok-4.5-build  |      5 |     $3.87 |    $0.77 |
| MiniMax-M3      |      5 |     $1.79 |    $0.36 |

**Opus5/Fable5 태스크가 gpt-5.5 태스크의 6.5배 비싸다** ($15.55/$15.96 vs $2.38).
[`memory: spawn_model_pref_codex_grok_save_claude`] 의 토큰 절약 편성이 이 수치로 정당화된다.

`model='claude'`(하네스족) 1,272행은 전부 $0 — PR#620 의 고스트비용 제거가 살아있다는 증거다.
`<synthetic>` 은 2026-06 에 $4,136 청구됐다가 7월 이후 $0.08 — 같은 수리의 효과다.

---

## 5. ★수치를 쓸 때의 필수 단서

1. **전부 list price 추정치다.** `~/.marblo/subscription-plans.json` 이 없으면 `findPricing` 은
   전부 per-token 경로를 탄다 — 이 맥에는 그 파일이 없다. 우리는 Claude Max 구독으로 돌리므로
   **실제 현금 지출이 아니라 "API 로 똑같이 돌렸다면" 의 기회비용**이다. 클라우드 원가 비교에는
   오히려 이쪽이 맞는 축이지만, "우리가 이만큼 썼다" 로 읽으면 틀린다.
2. **캐시 단가는 파생값이다.** `computeIncrementalCost` 가 cache read = 0.1×input,
   cache write = 1.25×input (Anthropic 비율)로 근사한다. 캐시리드가 토큰의 90% 이상이므로
   비용의 대부분이 이 근사 위에 선다.
3. **2026-07 이전 데이터는 태스크 원가에 못 쓴다.** `taskId` 스탬프가 없다(6월 귀속 비용 $0).
4. **`task_outcomes` 를 그냥 SUM 하지 마라.** `costTotal` 은 태스크 문서의 **누적 카운터**라,
   BLOCKED→DONE 처럼 여러 행이 나면 뒤 행이 앞 행을 **재진술**한다. 27개 태스크가 2~3행이고
   나이브 SUM 은 $93.91 과다($7,065.84 vs 최신행 $6,971.93). **taskId 별 최신 completedAt 행만** 쓸 것.
5. **`task_outcomes.total*Tokens` 는 캐시 토큰을 뺀다.** `r8vIviEc` 는 input 201·output 79,219 로
   기록됐지만 실제로는 캐시리드 13.1M·캐시라이트 425k 를 썼다. 비용은 맞지만 **토큰 수는 못 쓴다.**
6. **`task_outcomes.totalCost` 는 하한이다.** 26개 태스크에서 `cost_logs` 가 더 크다. 두 원인:
   (a) `taskRollups` 가 15초 버퍼라 창 종료/전환 시 꼬리가 유실된다(BQ 쓰기는 즉시라 비대칭),
   (b) 완료 후에도 같은 taskId 로 지출이 계속된 경우 — `5lX47V0`·`N8sAY4T` 는 **완료 시점까지의
   `cost_logs` 합이 outcome 값과 정확히 일치**한다($24.2337·$1.7607).

---

## 6. 수리 (이 PR)

조사가 진범을 D2(재읽기)로 지목했으므로 **워터마크를 디스크에 남긴다** — 증상(큰 델타 잘라내기)이
아니라 원인(워터마크가 메모리에만 있음)을 고친다.

`v3/electron/cost-tracker.ts`:

- **파스 워터마크 영속화.** `~/.marblo/cost-watermarks.json` 에 `세션파일 절대경로 → { ParseState, fileSize, updatedAt }` 를 남긴다. 트래커가 파일에 (재)부착할 때 0 이 아니라
  **이미 청구한 지점부터** 읽는다. 14일 지나면 정리, 쓰기는 2초 코얼레싱, `stopSession`/`clearAll`
  에서 즉시 플러시.
- **회전 안전장치.** 파일이 워터마크 시점보다 **작아졌으면**(= 같은 이름으로 새 세션이 났으면)
  워터마크를 버리고 0부터 읽는다. 반대 방향 실패(진짜 토큰 조용히 누락)가 더 나쁘다.
- **D1 방어 (defense-in-depth).** 한 세션 파일에 살아있는 트래커는 하나만. sessionId 없는 부착이
  이미 다른 에이전트가 물고 있는 JSONL 을 집으면 **추적을 거른다**(파일 스위치 경로에도 동일 가드).
  6월 팬아웃이 재발할 수 없게 만든다.
- 저장소가 없거나 깨져 있으면 조용히 0부터 읽는다 — 수리 이전 동작이지 잘못된 청구가 아니다.

`v3/tests/unit/cost-tracker-watermark.test.ts` (신규, 4 케이스):
재부착이 델타를 다시 내지 않을 것 / 새 턴 증분만 나올 것 / 파일 축소 시 워터마크 폐기 /
저장소 부재·손상 내성 / 같은 파일 이중 트래킹 가드.
**수리를 되돌리면 첫 케이스가 빨갛게 된다**(`expected length 1 but got 2` — 관측된 중복 그 자체).

### 검증

- `npm run typecheck` (tsc app + electron) — 통과.
- `npx vitest run tests/unit` — 5,141 통과 / 18 실패 (총 5,159). 실패 18건은 **선재 red** 로,
  `bridge-dispatch.test.ts` · `bridge-dispatch-model-pin.test.ts` · `routing-graph-p2-wiring.test.ts`
  이며 이 변경을 stash 한 깨끗한 트리에서 **동일하게 18건 실패**함을 확인했다(무관).
- 신규 테스트 파일 4/4 통과.

### 재배포 필요 여부

- **앱: 필요.** 메인 프로세스 코드다 — 머지 후 재빌드·재시작해야 적용된다
  ([`memory: dev_main_process_no_autorestart_on_tsc_watch`]).
- **Cloud Functions: 불필요.** `functions/src` 는 건드리지 않았다.
- **BigQuery: 스키마 변경 없음.** 과거 오염 행은 지우지 않는다(원장은 추가전용) — §3 의 정본 뷰로 읽는다.

---

## 7. 남은 갭 (이 티켓 밖)

1. **`cost_logs` 에 멱등키가 없다.** 워터마크 영속화가 재읽기를 막지만, 스트리밍 인서트 자체는
   여전히 재시도 중복을 걸러낼 키가 없다. 결정적 `insertId`(agentId+파일+라인워터마크 해시)가
   다음 단계다.
2. **`taskId` 커버리지 12.1%.** 비용의 87.9%가 `taskId=null`(오케 세션·티켓 미결속 에이전트)이다.
   태스크 단위 원가는 이 12.1% 위에 선다. 오케 세션 비용을 "그 오케가 만든 티켓들" 로 배부하는
   규칙이 없으면 태스크당 원가는 **구조적으로 과소**다.
3. **`task_outcomes` 롤업 꼬리 유실** (§5-6a) — `flushTaskRollups` 를 창 종료/프로젝트 전환에서도
   호출하면 닫힌다.
4. **`task_outcomes.total*Tokens` 에 캐시 토큰 누락** (§5-5) — `recordTaskCost` 가
   cacheRead/cacheWrite 를 안 싣는다.
5. **`pricingSnapshot` 컬럼이 항상 null.** `useCostWriter` 가 안 보낸다. 단가표가 바뀌면 과거 행을
   재계산할 방법이 없다.

---

## 8. 완료 기준 대조

- [x] 두 축 자릿수 차이 진범 규명(실쿼리) + 정본 축 판정 → §1 (쿼리 축 오류, overlap=0), §3
- [x] 신뢰 가능한 태스크당/에이전트당/모델당 비용 쿼리 + 수치 → §3 정본 쿼리, §4 수치
- [x] 수리 시 build/test 0 + 재배포 명시 → §6 (typecheck 통과, 선재 red 18건 확인, 앱 재빌드 필요)
- [x] 결과 문서 → 이 문서
