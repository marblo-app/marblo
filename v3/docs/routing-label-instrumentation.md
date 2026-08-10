# 라우팅 라벨 계측 — 스키마 · 쿼리 (티켓 AdJ1Gon2)

> 설계 근거는 [`routing-slm-dataset-design-2026-08-09.md`](./routing-slm-dataset-design-2026-08-09.md) §7(F-1~F-7)과
> [`bq-ml-training-data-audit-2026-08-08.md`](./bq-ml-training-data-audit-2026-08-08.md) §8(G1·G10·G11·G13)이다.
> 이 문서는 **무엇이 실제로 코드에 들어갔고 어떻게 조회하는가**만 적는다.

## 0. 왜 지금인가

스키마는 **소급되지 않는다.** 오늘 안 담은 필드는 오늘 이전 dispatch 에 영원히 없다.
그래서 학습을 시작하지 않더라도(§7-B — 담는 것과 훈련은 별개다) 필드는 지금 열어 둔다.
비용은 $0 이다: 전부 기존 텔레메트리 경로를 타고, `metadata` 는 JSON STRING 컬럼이라
**BigQuery 마이그레이션이 없다**.

## 1. 무엇이 병목이었나 (실측 2026-08-09)

| 축                  | 실측                               | 이 변경 전 결과                                        |
| ------------------- | ---------------------------------- | ------------------------------------------------------ |
| **액션 해상도**     | `spawnedModel` 이 dispatch 의 7.6% | 2층(어느 칸)을 학습할 데이터가 유효 **7행**            |
| **후보집합 해상도** | `eligibleModels` = 프로바이더까지  | 후보 전개(1 dispatch → N 훈련행) 불가                  |
| **실패 귀책**       | `errorCategory` = 상태 문자열      | 음성 39건 중 33건이 BLOCKED — 학습하면 **정반대 정책** |
| **무산출**          | 신호 자체가 없음                   | "붙었다 아무것도 안 냄" 과 "모델이 틀림" 이 같은 라벨  |
| **결정 시점 상태**  | BQ 에 0%                           | 오프라인 리플레이가 baseline 을 **재현조차 못 함**     |

## 2. `events` — `dispatch:decision` 에 추가된 키 (전부 `metadata` JSON)

| 키                   | 타입               | 무엇                                                                                                                                                                   | 근거      |
| -------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `plannedModelKey`    | string             | **라우터가 고른 칸**(`model@effort`) — 액션 축                                                                                                                         | F-1       |
| `spawnedModel`       | string?            | **실제로 뜬 칸** — 실현 축(요청과 갈릴 수 있다)                                                                                                                        | F-1       |
| `spawnedModelSource` | `argv`\|`observed` | 위 값의 근거. 없으면 필드 자체가 없다                                                                                                                                  | F-1       |
| `candidateKeys`      | string[]           | **비선택 후보까지** 같은 해상도로                                                                                                                                      | F-1       |
| `candidateCostIndex` | {키→number}        | 결정 시점 blended $/1M **스냅샷**                                                                                                                                      | F-4       |
| `decisionState`      | object             | `budgetUsedPercent` `weeklyTokenShare` `activeAgentCount` `roleAgentCount` `candidateSetSize`                                                                          | F-2       |
| `decisionComponents` | object             | 선택 칸의 9성분(`fit` `workload` `cost` `bench` `capability` `kg` `diversity` `usage` `weeklyLimit`) + `mode`/`decidedBy`/`entryModelKey`/`movedFromEntry`/`coldStart` | F-3 · G13 |

**액션 축이 두 필드인 이유**: `plannedModelKey`(고른 칸)와 `spawnedModel`(뜬 칸)은
버전가드 폴백·런타임 강등에서 실제로 갈린다. 한 필드로 뭉개면 라벨이 오염된다.
모델을 핀하지 않는 하네스는 `spawnedModel` 이 비고 `plannedModelKey` 만 남는다 —
**CLI 기본값을 지어내지 않는다**는 규율은 그대로다.

## 3. `events` — 스폰·종료 이벤트

| 이벤트            | 추가                                                                | 근거      |
| ----------------- | ------------------------------------------------------------------- | --------- |
| `agent:spawned`   | `taskId`(1급 컬럼, 종전 **0%**), `metadata.spawnedModel`            | F-9 · G1  |
| `agent:stopped`   | `taskId` `model` `errorCategory`, `metadata.{outputChars,noOutput}` | F-7 · G11 |
| `agent:restarted` | `errorCategory`(재시도 **사유**) `exitCode`                         | F-5 신호  |

`outputChars` 는 PTY **문자 수**다 — 내용은 세지도 담지도 않는다(`promptLength` 와 같은 계약).
`noOutput` 은 `NO_OUTPUT_CHARS`(2,000자) 이하 여부이고 **후보 신호**일 뿐이다:
CLI 는 붙기만 해도 배너로 수백 바이트를 그리므로 이 값 하나로 무산출을 단정하지 않는다.

## 4. `task_outcomes.errorCategory` — 어휘 교체 (F-6 · G10)

컬럼도 타입도 그대로다(STRING, nullable). **값의 의미**가 바뀐다.

| 값            | 뜻                  | 학습 음성? |
| ------------- | ------------------- | :--------: |
| `MODEL_FAIL`  | 추론 오류·거부·루프 |     ✅     |
| `NO_OUTPUT`   | 붙었지만 산출 없음  |     ✅     |
| `TIMEOUT`     | 응답 없음·정체      |     ✅     |
| `TOOL`        | MCP/CLI/스폰 실패   |     ✅     |
| `AUTH`        | 인증·크레덴셜       |     ❌     |
| `BLOCKED_DEP` | 의존성·외부 대기    |     ❌     |
| `CANCELLED`   | 사용자 취소         |     ❌     |

판정은 `classifyErrorCategory()`(순수함수) 한 곳에서 한다. 사유 문자열을 읽지만
**나가는 값은 enum 하나**다 — `classifyTaskType` 과 같은 계약(§2-E).

> ★**시기를 섞어 세지 말 것.** 이 변경 이전 행은 옛 어휘(`"FAILED"`/`"BLOCKED"`)를 담고 있다.

## 5. 쿼리

```sql
-- (1) 액션 해상도 커버리지 — 이 계측의 성패 지표. 7.6% → ?
SELECT
  DATE(TIMESTAMP(timestamp)) AS d,
  COUNT(*) AS decisions,
  COUNTIF(JSON_VALUE(metadata,'$.plannedModelKey') IS NOT NULL) AS with_action,
  COUNTIF(JSON_VALUE(metadata,'$.spawnedModel')    IS NOT NULL) AS with_realized,
  COUNTIF(JSON_QUERY(metadata,'$.candidateKeys')   IS NOT NULL) AS with_candidates
FROM `marblo-2253d.marblo_telemetry.events`
WHERE event = 'dispatch:decision'
GROUP BY d ORDER BY d DESC;
```

```sql
-- (2) 실패 귀책 분해 — BLOCKED 덩어리가 실제로 갈렸는가
SELECT errorCategory, COUNT(*) n, COUNTIF(success) ok
FROM `marblo-2253d.marblo_telemetry.task_outcomes`
WHERE success = FALSE
GROUP BY errorCategory ORDER BY n DESC;
```

```sql
-- (3) 후보 전개 — 1 dispatch → N 훈련행(§3-E)의 뼈대
SELECT taskId, JSON_VALUE(metadata,'$.plannedModelKey') AS chosen, k AS candidate,
       CAST(JSON_VALUE(metadata, CONCAT('$.candidateCostIndex."', k, '"')) AS FLOAT64) AS cost_index
FROM `marblo-2253d.marblo_telemetry.events`,
     UNNEST(JSON_VALUE_ARRAY(metadata,'$.candidateKeys')) AS k
WHERE event = 'dispatch:decision';
```

```sql
-- (4) 무산출 실행 — 어느 하네스가 빈손으로 끝나는가(G11)
SELECT model,
       COUNTIF(JSON_VALUE(metadata,'$.noOutput') = 'true') AS empty_runs,
       COUNT(*) AS stops
FROM `marblo-2253d.marblo_telemetry.events`
WHERE event = 'agent:stopped'
GROUP BY model ORDER BY empty_runs DESC;
```

## 6. 프라이버시

- 새 필드는 **숫자·불리언·enum·모델 id 뿐**이다. 프롬프트·티켓 본문·경로는 없다.
- §7-A 가 계약상 요구한 `scrub.ts` **동반 검토**는 실행 가능한 형태로 남겼다 —
  `tests/unit/routing-label-scrub.test.ts` 가 (a) 새 필드가 손상 없이 통과하고
  (b) 원문 계열 키는 여전히 떨어지는 것을 함께 검증한다.
- 게이트는 종전 그대로다: 동의 OFF ⇒ 외부 전송 0.

## 7. 한계 — 이 티켓이 **하지 않은** 것

- **학습을 시작하지 않는다.** F-1~F-7 은 계측이다(§7-B). 훈련은 §6 게이트 뒤다.
- **소급 backfill 없음.** 오늘 이전 행에는 이 필드가 없다. 그래서 급했던 것이다.
- **F-5(재시도 실값)·F-8(outcome 무조건 upsert)·F-10(탐색 케이스 집계)은 범위 밖**이다.
  F-5 는 *사유*만 실었고 `retriesCount` increment/`retryOf` 링크는 남아 있다.
- `agent:stopped` 의 `noOutput` 은 **PTY 바이트 기준**이라 하네스별 배너 크기에
  민감하다. 실측이 쌓이면 임계(`NO_OUTPUT_CHARS`)를 하네스별로 재보정해야 한다.
- **배포해야 쌓인다.** 앱(main/renderer) + `logTelemetryBatch` 함수 양쪽이 나가야
  BigQuery 까지 도달한다(#888 과 같은 패턴).
