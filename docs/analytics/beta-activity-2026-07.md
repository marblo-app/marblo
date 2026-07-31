# 베타 사용자 실활동 분석 — 존킴(ADMIN_UID) 제외, 2026-07-31

> ⚠️ **정정(2026-07-31, 티켓 `AzX7cg9QCVyzx4o7lP6H`)**: 아래 §3-4/§4 에서 `appVersion='3.0.0'` 을 "서명 릴리스 빌드를 쓴 사용자" 대리지표로 쓴 부분은 부정확하다. `3.0.0` 은 **실제 버전이 아니라 #470(2026-07-17) 이전의 서버 하드코딩 폴백**이며(그 기간 전 이벤트의 100%가 `3.0.0`, 07-18 부터 0건), 해당 22명의 실제 버전은 3.0.13~3.0.16 으로 추정되나 확정 불가다. 근거·재현 쿼리는 [version-activation.md §1-2](./version-activation.md) 참조. 이 문서의 나머지 수치(완료 1명·재사용 0건 등)는 영향받지 않는다.

티켓: `YChzTy8IfcRqQalbJWpt`. 질문: 존킴을 빼고 나면 실제 베타 사용자가 '완료'·'재사용' 같은 의미 있는 활동을 얼마나 했나?

**결론(먼저): 사실상 0에 가깝다.** 데이터 보관 기간(cost_logs 기준 2026-04-19 ~ 2026-07-31) 전체를 통틀어 비-admin 사용자가 **태스크를 완료한 사례는 단 1명·2건**뿐이고, 그 1건도 이번 주(2026-07-29~31)에 일어난 일이다. '에이전트 재사용' 신호는 비-admin 사용자에게서 **단 한 번도 관측되지 않았다(0건)**. 아래는 그 수치의 재현 가능한 근거다.

## 0. 접근 방법

- `gcloud`/`bq` CLI 는 이 Mac 의 활성 계정이 `temu-poc-developer@...`(temu SA) 라 `marblo-2253d` 프로젝트에 403 — 사용 안 함.
- 대신 **john.kim ADC(Application Default Credentials) REST**: `gcloud auth application-default print-access-token` 로 얻은 토큰으로 BigQuery REST(`POST https://bigquery.googleapis.com/bigquery/v2/projects/marblo-2253d/queries`)를 직접 호출. 참고: [[bq_telemetry_adc_rest_access]]
- 프로젝트 `marblo-2253d`, 데이터셋 `marblo_telemetry`. 대상 테이블: `cost_logs`, `task_outcomes`, `events`, `flow_executions`(0행, 측정불가), `agent_heartbeats`.

## 1. ADMIN_UID 확정 및 제외 방법

`v3/functions/src/index.ts` 의 `requireAdmin`/`getAdminExclusionUid` 는 `process.env.ADMIN_UID` 단일 값을 어드민 식별자로 쓴다(코드에 하드코딩된 값 없음). 배포된 Cloud Function `getAdminUsageSummary` 의 런타임 환경변수에서 조회했다(값은 이 문서에 원문으로 남기지 않음 — 존재/길이만 기록: 28자 Firebase uid, 접두 `RSAL`).

BQ 세 테이블은 **userId 의 의미가 다르다** (코드 주석 그대로):

| 테이블          | userId 의 정체                                                                              | admin 제외 방법                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `cost_logs`     | 실제 Firebase uid                                                                           | `userId != ADMIN_UID` 직접 매치                                                                                                 |
| `events`        | 대부분 익명 clientId, 단 일부는 실제 uid 도 섞임(admin 자기활동 12,822행이 uid 그대로 찍힘) | `resolveAdminClientIds`: admin uid 소유 `cost_logs.agentId` → `events.agentId` 역참조로 admin 이 쓴 clientId 집합을 유추해 제외 |
| `task_outcomes` | 100% 익명 clientId(36자), admin uid 원문은 0건                                              | 위와 동일한 clientId 집합으로 제외                                                                                              |

이 저장소의 `v3/functions/src/index.ts:5763-5849` (`resolveAdminClientIds`, `adminClientExclusion`, `adminUidExclusion`) 로직을 그대로 재현했다. 실측 결과 admin 소유로 역참조된 clientId 는 **10개**(admin uid 원문 1개 + 익명 clientId 9개, lookback 무제한).

```sql
-- admin 소유 agentId → events.userId(clientId) 역참조 (resolveAdminClientIds 재현)
SELECT DISTINCT e.userId AS clientId
FROM `marblo-2253d.marblo_telemetry.events` AS e
JOIN (
  SELECT DISTINCT agentId
  FROM `marblo-2253d.marblo_telemetry.cost_logs`
  WHERE userId = @adminUid AND agentId IS NOT NULL
) AS c ON e.agentId = c.agentId
WHERE e.userId IS NOT NULL
```

이하 모든 쿼리는 `events`/`task_outcomes` 에서 이 10개 clientId 를 `NOT IN`, `cost_logs` 에서는 `userId != @adminUid` 로 제외한다.

## 2. 지표 정의

- **완료(complete)** = `task_outcomes` 테이블에서 `success = true` 인 행 수. `task_outcomes` 는 태스크 1건 종료 시 1행 기록(성공/실패 불문), `success` 컬럼이 완료 판정의 유일한 근거 컬럼이다.
- **재사용(reuse)** = `events` 테이블에서 `event = 'dispatch:decision'` 이고 `JSON_EXTRACT_SCALAR(metadata, '$.reuseVsSpawn') = 'reuse'`(기존 에이전트를 그대로 재사용) 또는 `'restart'`(기존 에이전트를 재시작해 사용)인 행. 이 이벤트는 오케스트레이터의 스마트 디스패치(`v3/electron/telemetry.ts:309-334` `dispatchDecision`)가 매 배치 결정마다 남기는 스냅샷으로, `reuseVsSpawn` 필드가 `spawn`(신규 스폰) vs `reuse`/`restart`(기존 물리 에이전트 재사용)를 정확히 구분한다. MCP 툴 `reuse_agent` 호출 자체는 별도 이벤트명으로 적재되지 않으므로, 그 결과가 반영되는 `dispatch:decision.reuseVsSpawn` 를 대리 신호로 썼다.
- **스폰** = `events` 에서 `event = 'agent:spawned'` 행 수(물리 에이전트가 실제로 뜬 횟수).
- **활동일수** = `events` 에서 `COUNT(DISTINCT DATE(timestamp))`.
- 참고로 `events.agent:restarted`(하위 레벨 프로세스 재시작, 크래시 복구 등)는 위 `reuseVsSpawn='restart'` 와는 다른 이벤트다 — 의도적 재사용이 아니라 비정상 종료 후 재기동 신호일 수 있어 "재사용" 정의에서 제외했다. 참고용으로 표 아래에 별도 기재.

## 3. 존킴 제외 후 실측 결과

### 3-1. 완료 (task_outcomes.success = true)

| 지표                                      | 값                                                                                                                               |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 완료 태스크가 있는 비-admin 사용자 수     | **1명**                                                                                                                          |
| 그 사용자의 완료/전체 태스크              | 2 / 2 (성공률 100%)                                                                                                              |
| 발생 시각                                 | 2026-07-30 00:19 UTC ~ 2026-07-30 14:59 UTC (오늘~어제, 최근 48시간 내)                                                          |
| 태스크 내역                               | `infra/devops/claude-opus-5`(1,028초, $13.90), `feature/backend/claude-opus-5`(510초, $4.06) — 재시도(retriesCount) 0, 에러 없음 |
| 전체 `task_outcomes` 493행 중 비-admin 몫 | 2행 (0.4%) — 나머지 491행(99.6%)은 admin 제외 후에도 이 1명 외 아무도 없음                                                       |

이 사용자(hash `u_74b1eb7ca5`)는 `cost_logs`(uid 공간, 별도 hash `u_2024e2ef14`)에서도 같은 시간대(2026-07-30 00:21 ~ 2026-07-31 02:09, 94행, $47.13)에 활동이 겹친다 — 시간대만으로 강하게 동일인으로 추정되나, `events`/`task_outcomes` 는 익명 clientId, `cost_logs` 는 실제 uid 라 두 공간을 BQ 만으로 직접 조인할 조인키는 없다(§1 표 참조).

### 3-2. 재사용 (dispatch:decision.reuseVsSpawn)

| 지표                                                  | 값                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| `reuse` 또는 `restart` 를 택한 비-admin dispatch 결정 | **0건**                                                                        |
| 비-admin dispatch:decision 총 건수                    | 386건 (전부 `reuseVsSpawn = 'spawn'`)                                          |
| 전체(admin 포함) `reuse` 발생 건수                    | 2건 — 조회 결과 **둘 다 admin 소유 clientId**(§1 의 10개 제외 목록에 포함)였다 |
| 전체(admin 포함) `restart` 발생 건수                  | 0건                                                                            |

비-admin 386건 dispatch 결정 중 어느 것도 기존 에이전트를 재사용/재시작하지 않았다 — 전부 신규 스폰. "재사용" 렌즈로 보면 베타 사용자의 실질 신호는 **정확히 0**.

참고(별도 신호, "재사용" 정의에는 미포함): `agent:restarted`(비정상 재기동) 비-admin 421건 중 410건이 아래 §3-4 의 dev-loop 계정(`u_91986fd9ca`) 1명에 몰려 있다 — 크래시 반복이지 의도적 재사용이 아니다.

### 3-3. 스폰 (agent:spawned)

| user_hash    | spawn 수                         |
| ------------ | -------------------------------- |
| u_91986fd9ca | 770 (dev/크래시 루프, §3-4 참고) |
| u_30c4a49142 | 37                               |
| u_4c20db6df6 | 14                               |
| u_74b1eb7ca5 | 4 (완료 태스크 보유 사용자)      |
| u_4dcc6ec52c | 4                                |
| u_7725ca6791 | 3                                |

비-admin 스폰 총합 832건, 스폰을 1건이라도 한 사용자 6명.

### 3-4. 활동일수·전체 사용자 표 (events 기준, admin 제외 후 전원)

`events` 에 userId 가 찍힌 비-admin distinct 사용자는 **29명**(cost_logs 기준 비-admin 은 2명, 별도 id 공간). 그중 노이즈로 걸러야 할 계정 2개를 먼저 밝힌다:

- **`u_91986fd9ca`**: appVersion 전부 `null`(dev 빌드), 2일간 이벤트 2,005건·스폰 770·`agent:restarted` 410건, `agent_heartbeats` 39,900행이 2026-07-17~07-31까지 지속 — 완료 0, 재사용 0. 기존 메모([[admin_exclude_johnkim_external_zero_value_2026_07]])의 "770spawn crash-restart 루프" 계정과 일치. 사람이 쓰는 베타 사용자가 아니라 dev/크래시 루프 프로세스로 판단.
- **`u_86e299fb5e`**: appVersion = `github-actions` — CI 봇, 사람 사용자 아님.

이 둘을 제외하면 실질 "사람일 가능성이 있는" 비-admin distinct 사용자는 **27명**이나, 그중 25명은 활동일수 1일·이벤트 1~6건짜리 단발성 접촉(대부분 onboarding 단계에서 이탈 추정, [[beta_churn_activation_not_value_2026_07]] 과 정합)이고, 완료·재사용·유의미한 스폰이 있는 사용자는 위 §3-1~3-3 에 이미 다 나온 소수뿐이다.

전체 표(activeDays·totalEvents 내림차순):

| user_hash    | completed(success/total) | dispatch(reuse/restart/total) | spawn | activeDays | totalEvents | first ~ last (UTC)                  | appVersion(events)       |
| ------------ | ------------------------ | ----------------------------- | ----- | ---------- | ----------- | ----------------------------------- | ------------------------ |
| u_86e299fb5e | -                        | -                             | 0     | 4          | 49          | 2026-07-20 03:00 ~ 2026-07-23 00:05 | github-actions×49 (CI봇) |
| u_869f9df87d | -                        | -                             | 0     | 4          | 5           | 2026-07-14 10:32 ~ 2026-07-21 03:44 | 3.0.0×3, null×2          |
| u_74b1eb7ca5 | 2/2                      | 0/0/2                         | 4     | 3          | 139         | 2026-07-29 23:34 ~ 2026-07-31 02:09 | 3.0.19×139               |
| u_91986fd9ca | -                        | 0/0/360                       | 770   | 2          | 2005        | 2026-07-17 06:51 ~ 2026-07-18 12:22 | null×2005 (dev루프)      |
| u_e0c20a6b64 | -                        | -                             | 0     | 2          | 2           | 2026-07-14 22:29 ~ 2026-07-15 00:12 | 3.0.0×2                  |
| u_30c4a49142 | -                        | 0/0/18                        | 37    | 1          | 97          | 2026-07-16 00:53 ~ 2026-07-16 04:30 | 3.0.0×97                 |
| u_4c20db6df6 | -                        | 0/0/6                         | 14    | 1          | 36          | 2026-07-17 07:39 ~ 2026-07-17 07:42 | null×36                  |
| u_7725ca6791 | -                        | -                             | 3     | 1          | 16          | 2026-07-21 06:47 ~ 2026-07-21 09:11 | 3.0.18×16                |
| u_4dcc6ec52c | -                        | -                             | 4     | 1          | 11          | 2026-07-22 08:26 ~ 2026-07-22 08:29 | 3.0.18×11                |
| u_788e5aa532 | -                        | -                             | 0     | 1          | 6           | 2026-07-17 04:32 ~ 2026-07-17 05:05 | 3.0.0×6                  |
| u_a6fbc11ccc | -                        | -                             | 0     | 1          | 3           | 2026-07-14 08:58                    | 3.0.0×3                  |
| u_bc0fb4f8da | -                        | -                             | 0     | 1          | 3           | 2026-07-14 07:14                    | 3.0.0×3                  |
| u_f5416a5e6b | -                        | -                             | 0     | 1          | 2           | 2026-07-15 08:15 ~ 08:20            | 3.0.0×2                  |
| u_4cff165057 | -                        | -                             | 0     | 1          | 2           | 2026-07-14 07:27                    | 3.0.0×2                  |
| u_0a7b4e945f | -                        | -                             | 0     | 1          | 2           | 2026-07-19 08:58                    | null×2                   |
| u_542f8b5258 | -                        | -                             | 0     | 1          | 2           | 2026-07-15 23:31 ~ 23:32            | 3.0.0×2                  |
| u_7998348da5 | -                        | -                             | 0     | 1          | 1           | 2026-07-14 23:45                    | 3.0.0×1                  |
| u_27d56b5823 | -                        | -                             | 0     | 1          | 1           | 2026-07-15 12:25                    | 3.0.0×1                  |
| u_4ce2ddb64d | -                        | -                             | 0     | 1          | 1           | 2026-07-14 06:57                    | 3.0.0×1                  |
| u_91e538b8a2 | -                        | -                             | 0     | 1          | 1           | 2026-07-14 07:27                    | 3.0.0×1                  |
| u_f3f0db5759 | -                        | -                             | 0     | 1          | 1           | 2026-07-14 08:58                    | 3.0.0×1                  |
| u_96c3764fd1 | -                        | -                             | 0     | 1          | 1           | 2026-07-14 10:45                    | 3.0.0×1                  |
| u_4114d26be1 | -                        | -                             | 0     | 1          | 1           | 2026-07-14 09:02                    | 3.0.0×1                  |
| u_55bafdc771 | -                        | -                             | 0     | 1          | 1           | 2026-07-14 11:49                    | 3.0.0×1                  |
| u_1fadda6742 | -                        | -                             | 0     | 1          | 1           | 2026-07-14 10:09                    | 3.0.0×1                  |
| u_7934ece326 | -                        | -                             | 0     | 1          | 1           | 2026-07-14 14:09                    | 3.0.0×1                  |
| u_0e9adf3fd0 | -                        | -                             | 0     | 1          | 1           | 2026-07-14 09:02                    | 3.0.0×1                  |
| u_520dbfb9fd | -                        | -                             | 0     | 1          | 1           | 2026-07-14 09:02                    | 3.0.0×1                  |
| u_f4e76169ed | -                        | -                             | 0     | 1          | 1           | 2026-07-15 00:12                    | 3.0.0×1                  |

(`user_hash` = `sha256(실제 userId)` 앞 10자, `u_` 접두. 원문 uid/clientId 는 출력하지 않음.)

### 3-5. cost_logs (실제 uid 공간) — 참고

| user_hash    | 행수 | 총비용 | 기간                                                                      |
| ------------ | ---- | ------ | ------------------------------------------------------------------------- |
| u_2024e2ef14 | 94   | $47.13 | 2026-07-30 00:21 ~ 2026-07-31 02:09 (§3-1 완료 사용자와 시간대 일치 추정) |
| u_e0d54aa0de | 4    | $0.11  | 2026-07-21 09:10 (1건짜리 짧은 세션)                                      |

admin 을 제외한 `cost_logs` 전체는 이 2명, 98행뿐이다(admin 은 100,786행 중 100,692행, 99.9%+). [[bq_telemetry_adc_rest_access]] 의 기존 실측(존킴 100%)과 정합.

### 3-6. flow_executions / agent_heartbeats

- `flow_executions`: **0행** — 이번에도 미측정(기존 메모와 동일, PR#567 이후에도 적재 없음).
- `agent_heartbeats`: admin 제외 후 5명·43,876행. 대부분 §3-4 의 dev루프 계정(`u_91986fd9ca`, 39,900행, 15일간 지속)이 차지 — 폴링성 라이브니스 신호라 "활동"의 실질 근거로는 쓰지 않았다.

## 4. 파운더 vs 비파운더

**이번 분석에서는 구분하지 못했다** — 파운더 여부는 Firestore `founders` 컬렉션(실제 Firebase uid 키)에 있는데, 이 티켓 스코프는 "BQ marblo_telemetry 읽기전용"이고 `events`/`task_outcomes`.userId 는 §1 에서 확인했듯 익명 clientId 라 Firestore uid 와 직접 조인할 키가 없다(오직 `cost_logs`.userId 만 실제 uid). `cost_logs` 비-admin 2명에 대해서만 파운더 매칭이 가능하나 Firestore 조회는 스코프 밖이라 시도하지 않았다. 대신 `events.appVersion` 을 약한 대리지표로 썼다 — 서명 릴리스 빌드(`3.0.0`/`3.0.18`/`3.0.19`)를 쓴 사람은 최소 "실제 배포판을 설치한 사용자"이고(§3-4 표의 27명 중 25명), `null`/`github-actions` 는 dev/CI 노이즈로 분리했다. 파운더 코호트 매칭이 필요하면 후속 티켓으로 (a) Firestore founders 컬렉션 접근권 부여 또는 (b) cost_logs.userId 2명만 별도 조회를 제안한다.

## 5. 재현용 SQL 전체

```sql
-- (0) admin 소유 clientId 역참조 (§1)
SELECT DISTINCT e.userId AS clientId
FROM `marblo-2253d.marblo_telemetry.events` AS e
JOIN (
  SELECT DISTINCT agentId FROM `marblo-2253d.marblo_telemetry.cost_logs`
  WHERE userId = @adminUid AND agentId IS NOT NULL
) AS c ON e.agentId = c.agentId
WHERE e.userId IS NOT NULL;

-- (1) 완료 (§3-1) — @exclude = 위에서 얻은 clientId 배열
SELECT userId, COUNT(*) totalTasks, COUNTIF(success) completedTasks,
       MIN(createdAt) firstAt, MAX(completedAt) lastAt
FROM `marblo-2253d.marblo_telemetry.task_outcomes`
WHERE userId NOT IN UNNEST(@exclude)
GROUP BY userId ORDER BY completedTasks DESC;

-- (2) 재사용 (§3-2)
SELECT userId,
       COUNTIF(JSON_EXTRACT_SCALAR(metadata,'$.reuseVsSpawn')='reuse') reuseCount,
       COUNTIF(JSON_EXTRACT_SCALAR(metadata,'$.reuseVsSpawn')='restart') restartCount,
       COUNTIF(JSON_EXTRACT_SCALAR(metadata,'$.reuseVsSpawn')='spawn') spawnDecisionCount,
       COUNT(*) totalDecisions
FROM `marblo-2253d.marblo_telemetry.events`
WHERE event='dispatch:decision' AND userId NOT IN UNNEST(@exclude)
GROUP BY userId ORDER BY reuseCount DESC;

-- (3) 스폰 (§3-3)
SELECT userId, COUNT(*) spawnCount
FROM `marblo-2253d.marblo_telemetry.events`
WHERE event='agent:spawned' AND userId NOT IN UNNEST(@exclude)
GROUP BY userId ORDER BY spawnCount DESC;

-- (4) 활동일수/기간 (§3-4)
SELECT userId, COUNT(DISTINCT DATE(timestamp)) activeDays,
       MIN(timestamp) firstSeen, MAX(timestamp) lastSeen, COUNT(*) totalEvents
FROM `marblo-2253d.marblo_telemetry.events`
WHERE userId NOT IN UNNEST(@exclude) AND userId IS NOT NULL
GROUP BY userId ORDER BY activeDays DESC;

-- (5) appVersion 분해 (§3-4, 파운더 대리지표)
SELECT userId, appVersion, COUNT(*) n
FROM `marblo-2253d.marblo_telemetry.events`
WHERE userId NOT IN UNNEST(@exclude) AND userId IS NOT NULL
GROUP BY userId, appVersion;

-- (6) cost_logs 비-admin (§3-5)
SELECT userId, COUNT(*) rows_, SUM(totalCost) cost, MIN(timestamp) firstAt, MAX(timestamp) lastAt
FROM `marblo-2253d.marblo_telemetry.cost_logs`
WHERE userId != @adminUid OR userId IS NULL
GROUP BY userId ORDER BY rows_ DESC;

-- (7) agent:restarted 비-admin (§3-2 참고용)
SELECT userId, COUNT(*) n
FROM `marblo-2253d.marblo_telemetry.events`
WHERE event='agent:restarted' AND userId NOT IN UNNEST(@exclude)
GROUP BY userId ORDER BY n DESC;
```

(BQ REST 로 실행할 때는 `@exclude`/`@adminUid` 를 파라미터 바인딩 대신 리터럴 배열/문자열로 치환해 호출했다 — 값 자체는 신뢰 가능한 내부 쿼리 결과이므로 인젝션 우려 없음.)

## 6. 총계 요약

| 항목                                                    | 값                                          |
| ------------------------------------------------------- | ------------------------------------------- |
| BQ 보관기간 내 전체 distinct 사용자(events, admin 제외) | 29명                                        |
| 그중 dev루프/CI봇으로 식별되어 제외해야 할 계정         | 2명 (`u_91986fd9ca`, `u_86e299fb5e`)        |
| 태스크를 1건이라도 완료한 비-admin 사용자               | **1명** (2건, 100% 성공)                    |
| 에이전트를 재사용(reuse/restart)한 비-admin 사용자      | **0명** (0건 / 386건 dispatch 결정)         |
| 에이전트를 1회 이상 스폰한 비-admin 사용자              | 6명 (832 스폰, 그중 770 은 노이즈 계정 1명) |
| 활동일수 2일 이상인 비-admin 사용자                     | 4명 (그중 1명은 노이즈, 1명은 CI봇)         |
| cost_logs 상 실사용(과금 발생) 비-admin uid             | 2명, 합계 $47.24                            |

**정직한 결론**: 존킴을 빼면 '완료'·'재사용' 렌즈에서 베타의 실질 활동은 사실상 0에 가깝다. 유일한 예외는 이번 주(2026-07-29~31)에 나타난 사용자 1명(태스크 2건 완료, $47 사용)이며, 이 신호가 지속적 패턴인지 일회성인지는 관측 기간이 3일뿐이라 아직 판단할 수 없다. 재사용은 전체 기간을 통틀어 비-admin 에서 단 한 번도 관측되지 않았다.

## 관련 메모

- [[bq_telemetry_adc_rest_access]]
- [[bq_harness_vs_model_axis_and_costlogs_semantics]]
- [[admin_exclude_johnkim_external_zero_value_2026_07]]
- [[beta_churn_activation_not_value_2026_07]]
