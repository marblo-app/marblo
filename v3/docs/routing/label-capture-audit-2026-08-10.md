# 라우팅 라벨 캡처 audit — 가로축(특징) × 세로축(결과)

> 티켓 `6LH4Y1GC7xeWA94pW3Ar` (브레인 라우팅 P1). 조사 시점 2026-08-10, 코드 기준.
> 짝 문서: [`shadow-serving-stub.md`](./shadow-serving-stub.md).

## 0. 이 문서가 답하는 질문 — 그리고 답하지 않는 질문

**답한다**: "어떤 특징(tags/complexity/harness…) → 어떤 모델 칸을 골랐고 → 결과(성공/비용/
소요)가 어떻게 됐나" 가 **이미 어디에 어떤 모양으로 기록되고 있는가**, 그리고 그것을
학습셋으로 쓰려 할 때 **무엇이 비어 있는가**.

**답하지 않는다 (★비목표)**:

- 모델을 **학습시키지 않는다.** 이 단계에 fine-tune·가중치·평가 리포트는 없다.
- 라우팅을 **바꾸지 않는다.** 이 조사로 상수 하나 움직이지 않았다.
- 왜인가: 외부 실사용이 사실상 0(오너 전용 텔레메트리)이라 학습셋이 얇다. 얇은 데이터로
  정책을 학습시키면 배우는 것은 정책이 아니라 **한 사람의 지난 두 달**이다. 지금 자산이
  되는 것은 모델이 아니라 **소급 불가능한 라벨**이다 — 그래서 audit 이 먼저다.

## 1. 라우팅 결정은 어디서, 몇 층으로 나는가

```
dispatch_task (MCP/보드/오케)
   │
   ├─ 0층  후보 하네스 집합      enabledModels(프로젝트/프리셋)
   │        └ 가용성 필터        model-availability.filterAvailableHarnesses  (인증 깨진 하네스 제외)
   │        └ 쿼터 예비선        harness-quota.reserveQuotaGate
   │
   ├─ 1층  어느 하네스인가       dispatch-scoring.scoreModelsDetailed
   │        · 태그 보너스 / 비용효율 / budgetBias / graphBias(±20) / 라운드로빈·tie-band
   │
   ├─ 2층  그 하네스의 어느 칸   model-autoselect.selectAutoModel      ← ★#654-656 다양성 스택
   │        · fit(진입칸 거리) · cost(log2 배수 × 잔여쿼터 압력) · bench(SWE)
   │        · capability(벤치 결측 폴백) · kg(routing-graph ±20) · diversity(UCB1)
   │        · usage(주간 점유) · weeklyLimit(한도 근접)
   │        · 모드: single / top-score / tie-rotate / explore(ε-greedy)
   │
   └─ 스폰 → dispatch:decision 텔레메트리 1건 + tasks/{id}.dispatchMeta 1건
```

핵심: **액션은 두 층이고, 학습이 배워야 하는 것은 대개 2층**이다(1층은 "claude 냐 gpt 냐",
2층은 "그 안에서 opus5 냐 sonnet5 냐" — 비용이 실제로 갈리는 곳). 아래 조사는 그래서
"어느 소스가 2층 해상도(`model@effort`)를 보존하나" 를 계속 묻는다.

## 2. 소스 전수조사

### A. `electron/model-autoselect.ts` — 2층 결정기 (#654-656 다양성 스택)

| 항목        | 내용                                                                                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 저장?       | **저장하지 않는다.** 순수 함수다 — 입력을 받아 `AutoModelPlan` 을 돌려주고 끝난다.                                                                          |
| 산출        | `modelKey`(`model@effort`) · `mode` · `decidedBy` · `entryModelKey` · `movedFromEntry` · `coldStart` · 후보별 8성분 `scores[]` · 사람이 읽는 `reason` 한 줄 |
| 라벨화 경로 | 이 산출이 **곧 라벨**이 되는 곳은 두 군데뿐이다 → §B(`decisionComponents`)와 §C(`dispatchMeta`)                                                             |
| 탐색        | ε-greedy(`MARBLO_ROUTING_EXPLORE`, 기본 0.15) + UCB1 저표본 보너스(`MARBLO_ROUTING_DIVERSITY`, 기본 4) + tie-band 회전                                      |

**★학습 관점의 의미**: 여기에 이미 **탐색이 들어 있다**. 즉 로그는 순수한 on-policy 가
아니라 "가끔 일부러 다른 칸을 시도한" 행이 섞인 로그다. 이건 결함이 아니라 **자산**이다 —
off-policy 학습의 전제(다른 칸의 관측이 존재함)를 만들어 주는 유일한 장치다. 다만 그
사실을 라벨이 말해야 한다: `decisionComponents.mode = "explore" | "tie-rotate"` 가 그
역할을 하고 있고, 이건 이미 담긴다(§B). **`propensity`(그 행이 선택될 확률)는 담기지
않는다** — 갭 G3.

### B. `dispatch:decision` → BigQuery `marblo_telemetry.events`

- 발신: `bridge-server.emitDispatchDecision` (reuse / restart / spawn / budget-exhausted 4경로)
- 경로: main → 렌더러 `logTelemetry`(동의 게이트 + PII scrub) → `logTelemetryBatch` → BQ
- 서버 화이트리스트: `functions/src/telemetryMetadata.DISPATCH_DECISION_META_KEYS`
  → **여기 없는 키는 클라가 보내도 조용히 사라진다.**

담기는 것(1급 컬럼 / `metadata` JSON):

| 필드                                               | 위치     | 해상도 / 비고                                               |
| -------------------------------------------------- | -------- | ----------------------------------------------------------- |
| `taskId` `agentId` `role` `model`                  | 컬럼     | id 는 **HMAC 가명**(§5). `model` 은 하네스족                |
| `complexity`                                       | metadata | `simple/standard/complex` — 진짜 난도 축                    |
| `tags`                                             | metadata | 문자열 배열(스크럽 통과분)                                  |
| `eligibleModels`                                   | metadata | **하네스까지만**(1층 후보)                                  |
| `explicitModel` `reuseVsSpawn`                     | metadata | 자동선택이 돌았는지 / 스폰이었는지                          |
| `modelSelectionMode` `perModelScores` `agentScore` | metadata | 1층 분해(★비교축 전용 — 피처로 쓰지 말 것)                  |
| `plannedModelKey`                                  | metadata | ★**액션 축** `model@effort`                                 |
| `spawnedModel` `spawnedModelSource`                | metadata | ★**실현 축** + 그 근거(`argv`/`observed`)                   |
| `candidateKeys`                                    | metadata | ★비선택 후보까지 `model@effort`                             |
| `candidateCostIndex`                               | metadata | ★결정 시점 단가 스냅샷                                      |
| `decisionState`                                    | metadata | ★결정 시점 상태(예산 소진율·주간 점유·활성 수·후보 수)      |
| `decisionComponents`                               | metadata | ★2층 8성분 + `mode`/`decidedBy`/`entryModelKey`/`coldStart` |

**보존**: 스키마는 소급되지 않는다. ★ 표시 필드는 #890(티켓 AdJ1Gon2) 이후 행에만 있다.

### C. `get_routing_effectiveness` (MCP 툴)

| 항목    | 내용                                                                                             |
| ------- | ------------------------------------------------------------------------------------------------ |
| 소스    | ★**BigQuery 가 아니다.** Firestore `tasks/{id}` 문서다(`mcp-server/tools.loadEffectivenessRows`) |
| 읽는 것 | `dispatchMeta.{spawnedModelKey, model, complexity, taskType, role}` + `costTotal` + `status`     |
| 집계    | (`model@effort` × 난도 × taskType) → 성공률 · 평균비용 · 비용당성공. 터미널 티켓만               |
| 규율    | 비용 롤업 없는 티켓은 분모에서 빼고 **커버리지로 보고**(누락을 0 으로 만들지 않는다)             |

**★audit 결론**: 이 툴은 **오케가 지금 판단하려고 보는 뷰**이지 학습 파이프라인이 아니다.
모집단이 Firestore 의 현재 티켓(기본 500건 상한)이라 **시계열도 없고 삭제·수정에 취약**하다.
학습셋의 세로축은 이쪽이 아니라 BQ `task_outcomes` 여야 한다(§E). 다만 이 툴만 갖는 것이
하나 있다: `dispatchMeta.spawnedModelKey` 라는 **`model@effort` 해상도의 결과 축**이다 —
BQ `task_outcomes.model` 에는 effort 가 없다(갭 G1).

### D. Live routing graph (#567 계열, `electron/routing-graph.ts`)

| 항목 | 내용                                                                                           |
| ---- | ---------------------------------------------------------------------------------------------- |
| 저장 | ★**기기 로컬 JSON** (`~/.marblo/routing-graph.json` + 프로젝트별 오버레이). 클라우드 아님      |
| 모양 | `(context factor × modelKey) → {성공/실패 감쇠 카운터}`. factor = role/tag/complexity/taskType |
| 쓰기 | `graph-updater.applyOutcome` — 에이전트 라이프사이클 결과(12종 `OutcomeMode`)                  |
| 읽기 | `graphBiasForModel` → 1층·2층 점수의 `kg` 성분(±20, 신뢰도 축소 n/(n+6), stale 감쇠)           |
| 귀책 | host 실패(spawn/auth/tool_zero)는 빠르게 감쇠, `dependency_stuck` 은 **완전 제외**             |

**★audit 결론**: 이것이 현재 시스템에서 **유일하게 실제로 "학습"하는 부품**이다. 그리고
그 학습 상태는 **기기를 떠나지 않는다** — BigQuery 에 그래프 스냅샷이 없다. 결과:

- 클라우드 쪽에서 로컬 결정을 재현(오프라인 리플레이)하려 해도 `kg` 성분을 **복원할 수 없다**.
  `decisionComponents.kg` 라는 **결과값**은 담기지만, 그걸 만든 셀 카운터는 없다. → 갭 G2
- 기기를 갈아엎으면 학습이 0 으로 리셋된다(백업·마이그레이션 경로 없음). → 갭 G7

### E. BigQuery — `task_outcomes` / `events`(수명주기) / `cost_logs`

**`task_outcomes`** (`functions/index.logTaskOutcome`, 발신 `src/services/taskOutcomeReporter`)

| 컬럼                                                                           | 내용                                                                         |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `taskId` `projectId`                                                           | **HMAC 가명**                                                                |
| `model`                                                                        | `detectedModelId` → `spawnedModel` → 하네스족 순 폴백. ★**effort 없음/혼재** |
| `role` `taskType`                                                              | 결과 축의 특징 재현용                                                        |
| `taskComplexity`                                                               | ★**난도가 아니라 `task.priority`(정수)**. 진짜 난도는 events 조인            |
| `success` `errorCategory`                                                      | ★귀책 어휘 7종(MODEL_FAIL/NO_OUTPUT/TIMEOUT/TOOL/AUTH/BLOCKED_DEP/CANCELLED) |
| `durationMs` `totalCost` `totalInputTokens` `totalOutputTokens` `retriesCount` | 결과 수치(비용은 태스크 단위 롤업)                                           |
| `promptLength` `scopeFileCount`                                                | 태스크 규모(원문 아님 — 길이·개수만)                                         |

- 한 태스크가 여러 행을 낼 수 있다(BLOCKED → 나중에 DONE). **taskId 당 최신 행이 정본.**
- ★행이 나는 조건: 렌더러의 **tasks 구독이 상태 전이를 관측**했을 때. 앱이 안 떠 있는
  동안의 전이는 seeding 에 흡수돼 행이 없다 → 갭 G6.

**`events`(수명주기)**: `agent:spawned`(+`taskId`,`spawnedModel`) · `agent:stopped`
(+`errorCategory`,`outputChars`,`noOutput`) · `agent:restarted`(+`errorCategory`,`exitCode`) ·
`task:merged`(+`filesChanged`,`linesChanged`,`changeType`) — 최상위 수용 라벨은 `task:merged` 다.

**`cost_logs`**: 계정 uid 원장(본인 지출 되돌려주기 용). **원시 id 를 유지**한다.

## 3. 가로축(특징) — 지금 캡처되는 스키마

`dispatch:decision` 1행 = 결정 1건. 아래가 **오늘 학습에 쓸 수 있는 특징의 전부**다.

| 축       | 필드                                                                                            | 소스  | 결측 시                           |
| -------- | ----------------------------------------------------------------------------------------------- | ----- | --------------------------------- |
| 태스크   | `complexity`, `tags[]`, `role`, `taskType`(task_outcomes/dispatchMeta)                          | B/C/E | tags=[]                           |
| 규모     | `promptLength`(=description 길이), `scopeFileCount`                                             | E     | null                              |
| 후보집합 | `candidateKeys[]`(`model@effort`), `eligibleModels[]`(하네스), `decisionState.candidateSetSize` | B     | —                                 |
| 가격     | `candidateCostIndex{key→$/1M}` (**결정 시점 스냅샷**)                                           | B     | 미등록 모델은 키 자체가 없음      |
| 자원상태 | `decisionState.{budgetUsedPercent, weeklyTokenShare, activeAgentCount, roleAgentCount}`         | B     | null                              |
| 하네스   | `model`(족), `plannedModelKey` 접두부                                                           | B     | —                                 |
| 정책상태 | `decisionComponents.{entryModelKey, coldStart, mode, decidedBy}`                                | B     | 자동선택 미가동 시 블록 자체 없음 |
| 점수분해 | `decisionComponents.{fit,cost,bench,capability,kg,diversity,usage,weeklyLimit,total}`           | B     | 〃                                |

> ★`perModelScores`(1층 분해)와 `decisionComponents`(2층 분해)는 **피처가 아니라 비교축**이다.
> baseline 이 계산한 값을 피처로 먹이면 학습이 baseline 을 모방하는 것으로 수렴한다.

## 4. 세로축(결과) — 지금 캡처되는 스키마

| 축           | 필드                                                 | 소스                                 | 조인 키 |
| ------------ | ---------------------------------------------------- | ------------------------------------ | ------- |
| 성공/실패    | `success` + `errorCategory`(7종 귀책)                | `task_outcomes`                      | taskId  |
| 비용         | `totalCost`, `totalInputTokens`, `totalOutputTokens` | `task_outcomes`                      | taskId  |
| 소요         | `durationMs`(claimedAt → 종료)                       | `task_outcomes`                      | taskId  |
| 재작업       | `retriesCount`                                       | `task_outcomes`                      | taskId  |
| 무산출       | `metadata.noOutput`, `metadata.outputChars`          | `events` `agent:stopped`             | taskId  |
| 수용(최상위) | `task:merged` + `filesChanged`/`linesChanged`        | `events`                             | taskId  |
| 종료 실황    | `exitCode`, `errorCategory`                          | `events` `agent:restarted`/`stopped` | taskId  |

## 5. 조인 가능성 지도 — ★가명화가 끊은 다리

```
        events (익명)  ──taskId(가명 tk_*)──  task_outcomes (익명)      ✅ 이어진다
             │
             └──taskId(가명)──╳── cost_logs (계정 uid, 원시 id)         ❌ 끊겼다
```

`functions/src/analyticsPseudonym.ts`(티켓 U5OPOKf0D3I2TSRP8yUq)가 익명 세계의
`projectId/agentId/taskId/parentAgentId/retryOf/flowId` 를 **비밀 솔트 HMAC** 로 바꾼다.
같은 종류·같은 솔트면 같은 값이라 **익명 세계 내부 조인은 그대로 산다**. 반면 `cost_logs`
는 원시 id 를 유지하므로 두 세계 사이 조인은 성립하지 않는다 — 의도된 손실이다.

**학습 관점의 실무 결론**: 라우팅 라벨의 **비용 축은 `cost_logs` 가 아니라
`task_outcomes.totalCost`(태스크 롤업)로 잡는다.** 이건 이미 그렇게 돼 있다(§E). 다만
`ANALYTICS_ID_SALT` 가 바뀌면 그 시점 앞뒤 행이 조인되지 않는다 → 갭 G8.

## 6. 갭 — 학습을 시작하려면 부족한 것

| #       | 갭                              | 왜 문제인가                                                                                                                                                                                | 난이도     |
| ------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| **G1**  | 결과 축의 **모델 해상도 혼재**  | 액션은 `model@effort`(`plannedModelKey`)인데 `task_outcomes.model` 은 `detectedModelId`(effort 없음)/`spawnedModel`(effort 있음)/하네스족이 섞인다. effort 칸별 성과를 BQ 만으로 못 가른다 | 중         |
| **G2**  | **KG 상태가 BQ 에 없다**        | `kg` 성분의 **값**은 담기지만 그걸 만든 셀 카운터가 없다 → 오프라인 리플레이가 baseline 을 재현 못 한다                                                                                    | 중         |
| **G3**  | **propensity 미기록**           | ε-greedy·tie-rotate 가 도는데 "이 행이 뽑힐 확률" 이 없다. off-policy 보정(IPS/DR)이 불가                                                                                                  | 하         |
| **G4**  | **반사실(counterfactual) 없음** | 안 고른 칸의 결과는 영원히 모른다. 후보 전개(1 dispatch → N 행)는 가능하지만 라벨은 선택된 칸에만 있다                                                                                     | 상(구조적) |
| **G5**  | **taskComplexity ≠ 난도**       | `task_outcomes.taskComplexity` 는 `priority` 다. 진짜 난도는 events 조인 필수 → 조인 실패분은 난도 미상                                                                                    | 하         |
| **G6**  | **결과 행 유실**                | 결과 발신이 렌더러 tasks 구독에 묶여 있어 앱이 꺼진 동안의 전이는 행이 안 난다                                                                                                             | 중         |
| **G7**  | **KG 가 기기 로컬**             | 기기 교체 = 학습 리셋. 여러 기기의 관측이 합쳐지지 않는다                                                                                                                                  | 중         |
| **G8**  | **솔트 로테이션 = 조인 절단**   | `ANALYTICS_ID_SALT` 교체 시 앞뒤 행이 안 이어진다. 로테이션 기록이 없다                                                                                                                    | 하         |
| **G9**  | **표본 자체가 얇다**            | 외부 실사용 ≈ 0. ★이건 계측으로 못 고친다 — 이 에픽이 학습이 아니라 **배관** 단계인 이유                                                                                                   | —          |
| **G10** | **클라우드에 특징이 없다**      | 라우팅에 쓰이는 사실(레지스트리 단가·SWE·사다리·KG·사용량 롤업)이 전부 앱 안에 있다. 서버가 추천하려면 클라가 실어 보내야 한다                                                             | 중         |

## 7. 이 티켓이 실제로 놓은 것 / 안 놓은 것

**놓았다** — [`shadow-serving-stub.md`](./shadow-serving-stub.md):

- 클라우드 콜러블 `getRoutingRecommendation` (읽기 전용, 학습 없음)
- 로컬 결정 vs 클라우드 추천을 `events` 의 `routing:shadow` 이벤트로 기록
- 그 결과로 **G10 의 크기를 실측**할 수 있게 됐다: 불일치가 `localDecidedBy ∈ {kg, bench,
capability, diversity, usage, weeklyLimit}` 에 몰리면, 그게 곧 "클라우드로 먼저 올려야 할
  특징" 의 우선순위 목록이다.

**안 놓았다** (다음 티켓 후보, 위 갭 번호 그대로):

- G1 — `task_outcomes` 에 `spawnedModelKey`(effort 포함) 축 추가
- G2 — 결정 시점 KG 셀 스냅샷(선택 칸 + 후보 칸의 `n`/`bias`)을 `decisionComponents` 에
- G3 — `decisionComponents.propensity`(ε·밴드 크기에서 계산 가능한 값)
- G5 — `task_outcomes.taskComplexity` 를 난도 축으로 정정(또는 별도 컬럼)
- G6 — 결과 발신을 메인 프로세스 초크포인트로 이관

## 8. 쿼리

```sql
-- (1) 가로축 커버리지 — 오늘 학습에 쓸 수 있는 결정이 몇 건인가
SELECT
  DATE(SAFE_CAST(timestamp AS TIMESTAMP)) AS d,
  COUNT(*) AS decisions,
  COUNTIF(JSON_VALUE(metadata,'$.plannedModelKey') IS NOT NULL)      AS with_action,
  COUNTIF(JSON_QUERY(metadata,'$.candidateKeys')   IS NOT NULL)      AS with_candidates,
  COUNTIF(JSON_QUERY(metadata,'$.decisionState')   IS NOT NULL)      AS with_state,
  COUNTIF(JSON_QUERY(metadata,'$.decisionComponents') IS NOT NULL)   AS with_components
FROM `marblo-2253d.marblo_telemetry.events`
WHERE event = 'dispatch:decision'
GROUP BY d ORDER BY d DESC;
```

```sql
-- (2) 가로축 × 세로축 조인 — 학습 1행의 실제 모양(이게 되면 배관은 산 것이다)
WITH d AS (
  SELECT taskId,
         JSON_VALUE(metadata,'$.plannedModelKey')                        AS action_key,
         JSON_VALUE(metadata,'$.complexity')                             AS complexity,
         JSON_VALUE(metadata,'$.decisionComponents.mode')                AS mode,
         JSON_VALUE(metadata,'$.decisionComponents.decidedBy')           AS decided_by,
         SAFE_CAST(JSON_VALUE(metadata,'$.decisionState.budgetUsedPercent') AS FLOAT64) AS budget_used
  FROM `marblo-2253d.marblo_telemetry.events`
  WHERE event = 'dispatch:decision'
)
SELECT d.action_key, d.complexity, d.mode, d.decided_by,
       COUNT(*) n, COUNTIF(o.success) ok,
       AVG(o.totalCost) avg_cost, AVG(o.durationMs) avg_ms
FROM d JOIN `marblo-2253d.marblo_telemetry.task_outcomes` o USING (taskId)
GROUP BY 1,2,3,4 ORDER BY n DESC;
```

```sql
-- (3) G1 실측 — 결과 축의 모델 해상도가 얼마나 섞여 있나
SELECT
  CASE
    WHEN model IS NULL           THEN '(none)'
    WHEN model LIKE '%@%'        THEN 'model@effort'
    WHEN model IN ('claude','gpt','grok','gemini','antigravity','local','custom') THEN 'harness-family'
    ELSE 'model-id'
  END AS resolution,
  COUNT(*) n
FROM `marblo-2253d.marblo_telemetry.task_outcomes`
GROUP BY resolution ORDER BY n DESC;
```

```sql
-- (4) G3/탐색 — 탐색으로 산 비교데이터가 실제로 몇 건인가
SELECT JSON_VALUE(metadata,'$.decisionComponents.mode') AS mode, COUNT(*) n
FROM `marblo-2253d.marblo_telemetry.events`
WHERE event = 'dispatch:decision'
GROUP BY mode ORDER BY n DESC;
```

## 9. 프라이버시 — 이 조사에서 확인한 계약

- 익명 세계(`events`/`task_outcomes`/`agent_heartbeats`)에 **계정 식별자는 없다.** 조인키는
  솔트 HMAC 가명이고 솔트는 함수 런타임 env 에만 있다.
- 라우팅 라벨 필드는 전부 **숫자·불리언·enum·모델 id** 다. 프롬프트·경로·티켓 본문은 없다
  (`tests/unit/routing-label-scrub.test.ts` 가 새 필드 통과 + 원문 계열 탈락을 함께 지킨다).
- 동의 OFF ⇒ 외부 전송 0. 이 티켓이 추가한 shadow 경로도 **같은 게이트 뒤**에 있다
  (렌더러가 왕복을 수행한다 — [`shadow-serving-stub.md`](./shadow-serving-stub.md) §2).
