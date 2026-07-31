# 버전별 활성화 분석 — 3.0.19('시작하기' 온보딩)이 이전 버전보다 나은가, 2026-07-31

티켓: `AzX7cg9QCVyzx4o7lP6H`. 선행 문서: [beta-activity-2026-07.md](./beta-activity-2026-07.md) (`YChzTy8IfcRqQalbJWpt`, #689) — admin 제외 로직·BQ 접근법·'완료'/'재사용' 정의를 그대로 재사용했다.

## 결론(먼저)

**답할 수 없다 — 표본부족.** 3.0.19 를 쓴 비-admin 사용자는 **1명**뿐이다(3.0.18 은 2명). 그 1명은 온보딩 퍼널을 100% 통과하고 태스크 2건을 완료했지만, 1/1 이라는 수치의 95% 신뢰구간은 `[2.5%, 100%]` 로 3.0.18(0/2, `[0%, 84.2%]`)과 **완전히 겹친다**. Fisher exact p = 0.33. 즉 "3.0.19 가 낫다"도 "같다"도 데이터로는 말할 수 없다. 이 문서의 진짜 산출물은 §5 의 **재현가능 추적 SQL** 이며, 3.0.19 신규 사용자가 최소 **3~5명** 쌓이면 그 쿼리 그대로 재실행해 판정 가능하다(§4-3 소요 표본).

작업 중 두 가지를 새로 확정했다:

1. ★ **`appVersion='3.0.0'` 은 실제 버전이 아니라 서버 폴백**이다(§1-2). 선행 문서가 이를 "서명 릴리스 사용자" 대리지표로 쓴 부분은 부정확하며, 여기서 정정한다.
2. ★ **before/after 경계는 3.0.18 | 3.0.19 로 확정**된다(§1-1). '시작하기'(StartHereTab) 온보딩은 3.0.19 가 최초 탑재 릴리스다.

## 0. 접근 방법

선행 문서와 동일 — 이 Mac 의 `gcloud`/`bq` 활성 계정은 temu SA 라 `marblo-2253d` 에 403. **john.kim ADC REST**(`gcloud auth application-default print-access-token` → BigQuery `jobs.query` REST)로 조회했다. 코드·데이터 무변경, 읽기전용. 참고: [[bq_telemetry_adc_rest_access]]

admin 제외도 동일 — `v3/functions/src/index.ts:5763-5849` 의 `resolveAdminClientIds` 를 재현해 admin 소유 clientId **10개**를 얻었고, 선행 문서의 10개와 일치했다. `ADMIN_UID` 값은 배포된 `getAdminUsageSummary` 런타임 env 에서 읽었으며 원문은 여기에도 남기지 않는다(28자 Firebase uid, 접두 `RSAL`).

사용자 식별자는 전부 `u_` + `sha256(userId)` 앞 10자로만 표기한다(PII 미기재).

## 1. before/after 경계 확정

### 1-1. '시작하기'(StartHereTab)는 3.0.19 부터 기본 노출

| 커밋       | 날짜(KST)  | 내용                                                       | 3.0.19 bump 의 조상? |
| ---------- | ---------- | ---------------------------------------------------------- | -------------------- |
| `3957464d` | 2026-07-24 | 온보딩을 팝업 → '시작하기' 탭으로 승격 (StartHereTab 신설) | ✅ YES               |
| `48e7ff62` | 2026-07-26 | 3분할 워크스페이스 셸을 **기본 ON** 으로 전환              | ✅ YES               |
| `a476386b` | 2026-07-29 | `v3/package.json` 3.0.17 → **3.0.19** bump (릴리스)        | —                    |

`git merge-base --is-ancestor` 로 둘 다 3.0.19 bump 의 조상임을 확인했다. 기본 노출 여부도 코드로 확인:

- `v3/src/stores/workspaceModeStore.ts:21-29` `readInitial()` — localStorage 가 명시적 `"0"`(의도적 opt-out)일 때만 OFF, 그 외 전부 ON → **셸 기본 ON**.
- `v3/src/lib/onboardingProgress.ts:247` `shouldLandOnStartHere()` — 온보딩 미완료 + 미해제이면 콜드스타트 시 `startHere` 탭에 착지(`v3/src/lib/splitWorkspaceLayout.ts:272`).
- `v3/src/components/workspace/WorkTabs.tsx:54` — `startHere` 탭은 플래그 게이트 없이 탭 레지스트리에 상시 등록.

→ **3.0.19 = '시작하기' 온보딩 최초 탑재·기본 노출 릴리스. 3.0.18 및 그 이전 = 미탑재(레거시 모달 CliSetupGate 경로).** 경계는 `3.0.18 | 3.0.19` 로 깨끗하다.

(참고: `v3/package.json` 은 3.0.17 → 3.0.19 로 직행했고 저장소에 `"version": "3.0.18"` 이 커밋된 적은 없다. 3.0.18 은 릴리스 빌드로만 존재하며 2026-07-21 03:38Z 배포됐다 — `docs/onboarding-telemetry-live-verify-3018-2026-07-21.md`.)

### 1-2. ★ `appVersion='3.0.0'` 은 버전이 아니라 pre-#470 서버 폴백 (선행 문서 정정)

`events.appVersion` 은 **2026-07-17 의 #470(`63ea576c`, "production real-user telemetry ON + fix appVersion payload")** 이전에는 클라이언트가 아예 보내지 않았고, 서버가 `"3.0.0"` 을 하드코딩 폴백으로 넣었다. 지금 코드는 그 폴백을 제거하고 `null` 로 남긴다:

```ts
// v3/functions/src/index.ts:4674-4678
// Record the client-supplied version verbatim, or null when absent. The
// old "3.0.0" fallback masked every event as a single stale version and
// made per-release analysis impossible; null honestly means "unknown".
appVersion: e.appVersion || null,
```

BQ 실측이 이를 그대로 확증한다(admin 포함 전수, 일자별 appVersion 분포):

| 날짜(UTC)  | `3.0.0` | `null` | 그 외          |
| ---------- | ------- | ------ | -------------- |
| 2026-07-13 | 1,071   | 0      | 0              |
| 2026-07-14 | 1,495   | 0      | 0              |
| 2026-07-15 | 553     | 0      | 0              |
| 2026-07-16 | 749     | 0      | 0              |
| 2026-07-17 | 1,663   | 3,422  | 1,979 (3.0.16) |
| 2026-07-18 | **0**   | 1,895  | 2,639          |
| 2026-07-19 | **0**   | 2      | 2,467          |

07-16 까지 **100%가 `3.0.0`**, 07-18 부터 **0건**. 그런데 실제 배포된 앱은 그 기간 3.0.15/3.0.16 이었다(`v3/package.json` 이력: 3.0.15·3.0.16 둘 다 2026-07-14 bump). 따라서:

> **`appVersion='3.0.0'` 인 22명은 "3.0.0 사용자"가 아니라 "버전 미상(pre-#470, 실제로는 3.0.13~3.0.16 추정)" 코호트다.**

선행 문서 §4 가 이 값을 "서명 릴리스 빌드를 쓴 사용자" 대리지표로 삼은 것은 **결론(파운더 구분 불가)은 유효하나 근거는 부정확**하다. 아래 표에서는 이 코호트를 `pre470-unknown` 으로 라벨링한다. `null` 은 dev 빌드(`__APP_VERSION__` 미정의), `github-actions` 는 서버가 직접 넣는 CI 봇 행(`v3/functions/src/index.ts:449`)이다.

## 2. 지표 정의

선행 문서 §2 와 동일하게 유지(비교 가능성 보존):

- **완료** = `task_outcomes.success = true` 행 수.
- **재사용** = `events.event='dispatch:decision'` 이고 `JSON_EXTRACT_SCALAR(metadata,'$.reuseVsSpawn') IN ('reuse','restart')`.
- **스폰** = `events.event='agent:spawned'`.
- **활동일수** = `COUNT(DISTINCT DATE(timestamp))`.

이번에 추가한 것:

- **버전 귀속**: `task_outcomes` 에는 **`appVersion` 컬럼이 없다**(스키마 실측 확인). 그래서 `events` 에서 사용자별 대표 버전(이벤트 최다 버전, 동률이면 최근)을 구해 `userId` 로 조인한다. 실측상 비-admin 사용자 29명 중 **버전이 둘 이상인 사용자는 1명뿐**(`u_869f9df87d`: `null`+`3.0.0`, 완료·스폰 0)이라 귀속 모호성은 사실상 없다.
- **온보딩 퍼널 단계**: `app:first_run` → `auth:login_success` → `onboarding:folder_connected` → `onboarding:orchestrator_opened` → `agent:spawned`(첫 스폰) → `task_outcomes.success`(첫 완료). ★ 이 중 `app:first_run`/`auth:*`/`onboarding:*` 은 **#542 계측이라 3.0.17 빌드부터만 존재**한다 — pre470 코호트에는 아예 없다. 버전 교차 비교가 가능한 유일한 "앱 열었다" 신호는 `session:started`(전 버전 존재)이며, 실측상 비-admin 전원이 최소 1건 갖고 있어 "이벤트 1건 이상 = 앱 열림"과 동치다.

## 3. 버전별 지표 스냅샷 (2026-07-31 기준, admin 제외)

### 3-1. 종합

| 버전                  | 사용자 | 스폰한 사용자 | 완료한 사용자 | 재사용한 사용자 | 활동 2일+ | 스폰 | 완료  | 재사용/디스패치결정 | 총이벤트 | 기간          |
| --------------------- | ------ | ------------- | ------------- | --------------- | --------- | ---- | ----- | ------------------- | -------- | ------------- |
| **3.0.19** (시작하기) | **1**  | 1             | **1**         | 0               | 1         | 4    | **2** | 0 / 2               | 139      | 07-29 ~ 07-31 |
| **3.0.18**            | **2**  | 2             | 0             | 0               | 0         | 7    | 0     | 0 / 0               | 27       | 07-21 ~ 07-22 |
| `pre470-unknown`      | 22     | 1             | 0             | 0               | 2         | 37   | 0     | 0 / 18              | 135      | 07-14 ~ 07-21 |
| `dev-null` (dev빌드)  | 3      | 2             | 0             | 0               | 1         | 784  | 0     | 0 / 366             | 2,043    | 07-17 ~ 07-19 |
| `ci-bot`              | 1      | 0             | 0             | 0               | 1         | 0    | 0     | 0 / 0               | 49       | 07-20 ~ 07-23 |

실사용자 판단 대상은 **서명 릴리스 3줄(3.0.19 / 3.0.18 / pre470-unknown, 합계 25명)** 뿐이다. `dev-null` 은 선행 문서 §3-4 의 dev/크래시 루프 계정(784 스폰·완료 0)이 대부분이고, `ci-bot` 은 서버가 넣는 `task:merged` 행이다 — 둘 다 사람 사용자가 아니라 분리했다.

**재사용은 전 버전 통틀어 0건**(비-admin 386 dispatch 결정 전부 `spawn`) — 선행 문서 결과와 동일하며, 버전 축으로 쪼개도 달라지지 않았다.

### 3-2. 온보딩 퍼널 (버전별)

분모 = 앱을 열고 이벤트를 1건이라도 보낸 사용자.

| 버전             | 앱 열림 | session:started | 오케 오픈 | 첫 스폰 도달 | 첫 완료 도달 | 열림→첫스폰 | 열림→첫완료 | 첫스폰까지 중앙값 |
| ---------------- | ------- | --------------- | --------- | ------------ | ------------ | ----------- | ----------- | ----------------- |
| **3.0.19**       | 1       | 1               | 1         | 1            | **1**        | **100%**    | **100%**    | 46분              |
| **3.0.18**       | 2       | 2               | 2         | 2            | 0            | **100%**    | **0%**      | 1분               |
| `pre470-unknown` | 22      | 22              | (미계측)  | 1            | 0            | **4.5%**    | **0%**      | 174분             |

- `오케 오픈`(`onboarding:orchestrator_opened`)은 3.0.17+ 계측이라 pre470 코호트에는 존재 자체가 없다 — "0%"가 아니라 **미계측**이다.
- 관측창 길이가 버전마다 다른 문제(3.0.19 는 3일, 3.0.18 은 10일 노출)를 없애기 위해 **사용자별 첫 이벤트 후 72시간 창**으로 다시 계산했으나 **수치가 동일**했다 — 세 코호트 모두 모든 활동이 첫 접촉 후 72시간 안에 끝났다. 즉 위 비교는 노출기간 편향이 없다.

### 3-3. 릴리스 버전 사용자 개별 궤적

| user_hash    | 버전   | 총이벤트 | 스폰 | 온보딩이벤트 | 활동일 | 기간(UTC)                 |
| ------------ | ------ | -------- | ---- | ------------ | ------ | ------------------------- |
| u_74b1eb7ca5 | 3.0.19 | 139      | 4    | **28**       | 3      | 07-29 23:34 ~ 07-31 02:09 |
| u_7725ca6791 | 3.0.18 | 16       | 3    | 3            | 1      | 07-21 06:47 ~ 07-21 09:11 |
| u_4dcc6ec52c | 3.0.18 | 11       | 4    | 2            | 1      | 07-22 08:26 ~ 07-22 08:29 |

**3.0.19 사용자(u_74b1eb7ca5) 실제 궤적** — 첫 실행부터 첫 스폰까지 46분, 3일간 잔존:

```
07-29 23:34  app:first_run {platform: Win32}
07-29 23:34  auth:login_success {method: google}
07-29 23:34  onboarding:marketing_consent_shown {surface: auth_screen}
07-29 23:35  onboarding:cli_setup_step {step: auth, phase: success}     ← ★3.0.19 에만 존재
07-29 23:38  onboarding:folder_connected {mode: new, hasGitRemote: false}
07-29 23:38  onboarding:orchestrator_opened {resumed: false}
07-30 00:20  agent:spawned                                              ← 첫 스폰 (+46분)
07-30 00:25  onboarding:cli_setup_step {step: firstTicket, phase: success} ← ★첫 티켓 완주
07-30 00:19 / 14:59  task_outcomes success ×2 (infra/devops, feature/backend)
… 07-30 하루 동안 session:started ×6, orchestrator_opened(resumed:true) ×9 로 재방문
```

**3.0.18 사용자 2명 궤적** — 둘 다 첫 스폰은 빨랐으나(1분·7분) 완료 없이 이탈:

- `u_7725ca6791`: 07-21 06:47 first_run → 06:54 첫 스폰 → 09:11 마지막 `token:usage`. 2시간 24분, 1일, 완료 0.
- `u_4dcc6ec52c`: 07-22 08:26 first_run → 08:27 첫 스폰(연속 4회) → 08:29 종료. **3분**, 완료 0.

### 3-4. 부수 관측: `onboarding:folder_connected` 사각지대는 해소됨

`docs/onboarding-telemetry-live-verify-3018-2026-07-21.md` 가 🔴 **"진짜 사각지대 — 전 기간 0건"** 으로 남겨둔 `onboarding:folder_connected` 는 **지금 정상 발화한다**: 비-admin 기준 3.0.18 에서 2건, 3.0.19 에서 4건(전부 `{"mode":"new"}` = 신규 폴더 연결 경로). 당시의 가설 (b) "emit 미배선"은 기각되고 (a) "코드 경로가 안 밟혔던 것"이 맞았다. 해당 문서의 권고 1번은 종결 가능하다.

`onboarding:cli_setup_step` 은 **3.0.19 에서만 9건** 발화한다(3.0.18·이전 0건) — CliSetupGate 단계 계측이 '시작하기' 탭 경로와 함께 처음 실사용자에게 도달했다는 뜻이다.

## 4. 판정 — 3.0.19 가 나은가?

### 4-1. 통계적으로는 판정 불가

| 비교                              | 수치        | Fisher exact (two-sided) | 판정              |
| --------------------------------- | ----------- | ------------------------ | ----------------- |
| 완료율: 3.0.19 vs 3.0.18          | 1/1 vs 0/2  | **p = 0.33**             | ❌ 유의하지 않음  |
| 완료율: 3.0.19 vs 릴리스이전 전체 | 1/1 vs 0/24 | p = 0.040                | ⚠️ 아래 주석 참조 |
| 스폰도달: 릴리스코호트 vs pre470  | 3/3 vs 1/22 | **p = 0.002**            | ✅ 유의 — 단 교란 |

95% 신뢰구간(Clopper-Pearson)으로 보면 무의미함이 더 분명하다:

| 코호트           | 완료율   | 95% CI             |
| ---------------- | -------- | ------------------ |
| 3.0.19           | 1/1 100% | **[2.5%, 100.0%]** |
| 3.0.18           | 0/2 0%   | **[0.0%, 84.2%]**  |
| `pre470-unknown` | 0/22 0%  | [0.0%, 15.4%]      |

3.0.19 와 3.0.18 의 구간은 `[2.5%, 84.2%]` 구간에서 완전히 겹친다 — **"3.0.19 가 낫다"는 주장을 지지도 반박도 못 한다.**

⚠️ `1/1 vs 0/24` 의 p = 0.040 은 **믿을 수 없다**. n=1 에서 Fisher 는 "성공 1건이 24개 실패군이 아닌 1개짜리 군에 떨어질 확률 = 1/25"을 기계적으로 계산할 뿐이며, 3.0.19 의 실제 완료율 구간은 여전히 `[2.5%, 100%]` 다. 게다가 pre470 코호트 22명은 2026-07-14 파운더 메일 발송으로 하루에 몰려 들어온 **1회성 대량 유입**이고([[founder_survey_offer_send_25_2026_07_18]], [[beta_churn_activation_not_value_2026_07]]), 3.0.19 사용자는 자발적 최근 설치자다 — **획득 경로가 달라 온보딩 변경의 인과 효과로 해석할 수 없다.**

### 4-2. 유일하게 유의한 신호도 '시작하기' 때문은 아니다

`스폰도달 3/3 vs 1/22`(p = 0.002)는 실재하는 차이지만, 이는 **3.0.18+3.0.19(계측 이후 릴리스 코호트) vs pre470(파운더 대량 유입 코호트)** 의 대비다. 3.0.18 은 '시작하기'가 없는 버전이므로 이 신호는 온보딩 탭이 아니라 **코호트 획득 경로 차이**(자발적 설치 vs 메일 일괄 초대)를 반영한다고 보는 게 정직하다.

### 4-3. 판정에 필요한 표본

3.0.19 신규 사용자 전원이 완료한다는 낙관 가정 하에, 릴리스이전(0/24) 대비 p < 0.05 를 얻는 데 필요한 최소 표본:

| 3.0.19 완료/사용자 | Fisher p             |
| ------------------ | -------------------- |
| 1/1                | 0.040 (❌ CI 무의미) |
| 2/2                | 0.0031               |
| **3/3**            | **0.0003**           |
| 4/4                | <0.0001              |

현실적으로 완료율이 100% 가 아닐 것을 감안하면 **3.0.19 신규 사용자 5~10명**이 쌓였을 때 §5 쿼리를 재실행하는 게 적절하다. 현재 유입 속도(3.0.19 릴리스 후 2일간 1명)로는 **1~2주** 소요 예상.

### 4-4. 정직한 요약

- 관측된 사실: 3.0.19 의 유일한 사용자는 온보딩 전 단계를 46분 만에 통과했고, 3일간 재방문했고, 태스크 2건을 완료했고, `$47` 을 썼다. 3.0.18 의 2명은 첫 스폰까지는 더 빨랐지만(1분·7분) 완료 0, 잔존 0(1명은 3분 만에 이탈).
- 이 대비는 **'시작하기' 온보딩이 효과가 있다는 가설과 일관되지만, 표본 1 vs 2 로는 우연과 구분되지 않는다.**
- 억지로 "3.0.19 가 활성화를 개선했다"고 말하지 않는다. **추적 필요** 상태다.

## 5. ★ 재현가능 추적 SQL (반복 쿼리)

BQ REST(`POST https://bigquery.googleapis.com/bigquery/v2/projects/marblo-2253d/queries`)로 그대로 실행. `@ADMIN_UID` 만 배포된 `getAdminUsageSummary` 의 런타임 env 값으로 치환하면 된다(문서에 원문 미기재). 데이터가 쌓인 뒤 아무 때나 재실행하면 §3 표가 갱신된다.

세 쿼리 모두 아래 공통 CTE 를 사용한다 — admin 제외 + 버전 라벨 정규화(§1-2)를 한 곳에 묶었다.

```sql
-- ── 공통 CTE (T1/T2/T3 앞에 그대로 붙인다) ────────────────────────────────
WITH admin_clients AS (
  -- resolveAdminClientIds 재현: admin uid 소유 agentId → events.userId 역참조
  SELECT DISTINCT e.userId AS clientId
  FROM `marblo-2253d.marblo_telemetry.events` AS e
  JOIN (
    SELECT DISTINCT agentId FROM `marblo-2253d.marblo_telemetry.cost_logs`
    WHERE userId = @ADMIN_UID AND agentId IS NOT NULL
  ) AS c ON e.agentId = c.agentId
  WHERE e.userId IS NOT NULL
),
ev AS (
  SELECT *, CASE
      WHEN appVersion = 'github-actions' THEN 'zz-ci-bot'      -- 서버가 넣는 CI 봇 행
      WHEN appVersion IS NULL            THEN 'zy-dev-null'    -- dev 빌드(__APP_VERSION__ 미정의)
      -- ★ pre-#470(2026-07-17) 서버 폴백. 실제 버전 아님 — §1-2 참조
      WHEN appVersion = '3.0.0'
       AND timestamp < TIMESTAMP '2026-07-17 06:40:00+00' THEN 'zx-pre470-unknown'
      ELSE appVersion END AS ver
  FROM `marblo-2253d.marblo_telemetry.events`
  WHERE userId IS NOT NULL AND userId NOT IN (SELECT clientId FROM admin_clients)
),
user_ver AS (
  -- task_outcomes 에 appVersion 이 없으므로 사용자별 대표 버전을 events 에서 도출
  SELECT userId, ver, firstSeen FROM (
    SELECT userId, ver,
           MIN(MIN(timestamp)) OVER (PARTITION BY userId) AS firstSeen,
           ROW_NUMBER() OVER (
             PARTITION BY userId ORDER BY COUNT(*) DESC, MAX(timestamp) DESC) AS rn
    FROM ev GROUP BY userId, ver
  ) WHERE rn = 1
)
```

### T1 — 버전별 종합 스냅샷 (§3-1 재생성)

```sql
-- 공통 CTE 뒤에 이어붙임
, per_user AS (
  SELECT uv.ver, e.userId,
    COUNTIF(e.event='agent:spawned')      AS spawns,
    COUNTIF(e.event='dispatch:decision')  AS decisions,
    COUNTIF(e.event='dispatch:decision'
      AND JSON_EXTRACT_SCALAR(e.metadata,'$.reuseVsSpawn') IN ('reuse','restart')) AS reuses,
    COUNT(DISTINCT DATE(e.timestamp))     AS activeDays,
    COUNT(*)                              AS totalEvents,
    MIN(e.timestamp) AS firstSeen, MAX(e.timestamp) AS lastSeen
  FROM ev AS e JOIN user_ver AS uv USING (userId)
  GROUP BY uv.ver, e.userId
),
outcomes AS (
  SELECT uv.ver, t.userId, COUNT(*) AS tasks, COUNTIF(t.success) AS done
  FROM `marblo-2253d.marblo_telemetry.task_outcomes` AS t
  JOIN user_ver AS uv USING (userId)
  WHERE t.userId NOT IN (SELECT clientId FROM admin_clients)
  GROUP BY uv.ver, t.userId
)
SELECT p.ver,
  COUNT(DISTINCT p.userId)      AS users,
  COUNTIF(p.spawns > 0)         AS usersSpawned,
  COUNTIF(IFNULL(o.done,0) > 0) AS usersCompleted,
  COUNTIF(p.reuses > 0)         AS usersReused,
  COUNTIF(p.activeDays >= 2)    AS usersD2plus,
  SUM(p.spawns) AS spawns, SUM(IFNULL(o.done,0)) AS completions,
  SUM(IFNULL(o.tasks,0)) AS taskOutcomes,
  SUM(p.reuses) AS reuses, SUM(p.decisions) AS decisions,
  SUM(p.totalEvents) AS totalEvents,
  FORMAT_TIMESTAMP('%F', MIN(p.firstSeen)) AS firstSeen,
  FORMAT_TIMESTAMP('%F', MAX(p.lastSeen))  AS lastSeen
FROM per_user AS p
LEFT JOIN outcomes AS o ON o.userId = p.userId AND o.ver = p.ver
GROUP BY p.ver ORDER BY p.ver DESC;
```

### T2 — 버전별 온보딩 퍼널 (§3-2 재생성)

`window_hours` 를 바꾸면 노출기간 편향 없이 동일 창으로 비교할 수 있다. `NULL` 로 두려면 `WHERE` 절의 창 조건을 빼면 전 기간이 된다.

```sql
-- 공통 CTE 뒤에 이어붙임 (전 기간 버전; 72시간 창 비교는 아래 주석 참조)
, steps AS (
  SELECT uv.ver, e.userId,
    MIN(e.timestamp)                                                     AS t_open,
    MIN(IF(e.event='session:started',                e.timestamp, NULL)) AS t_session,
    MIN(IF(e.event='auth:login_success',             e.timestamp, NULL)) AS t_login,
    MIN(IF(e.event='onboarding:folder_connected',    e.timestamp, NULL)) AS t_folder,
    MIN(IF(e.event='onboarding:orchestrator_opened', e.timestamp, NULL)) AS t_orch,
    MIN(IF(e.event='agent:spawned',                  e.timestamp, NULL)) AS t_spawn
  FROM ev AS e JOIN user_ver AS uv USING (userId)
  -- 동일 노출창 비교를 원하면 다음 줄의 주석을 해제 (기본 72시간):
  -- WHERE e.timestamp < TIMESTAMP_ADD(uv.firstSeen, INTERVAL 72 HOUR)
  GROUP BY uv.ver, e.userId
),
done AS (
  SELECT uv.ver, t.userId, MIN(t.completedAt) AS t_done
  FROM `marblo-2253d.marblo_telemetry.task_outcomes` AS t
  JOIN user_ver AS uv USING (userId)
  WHERE t.success AND t.userId NOT IN (SELECT clientId FROM admin_clients)
  GROUP BY uv.ver, t.userId
)
SELECT s.ver,
  COUNT(*)                          AS n_opened,
  COUNTIF(s.t_session IS NOT NULL)  AS n_session,
  COUNTIF(s.t_login   IS NOT NULL)  AS n_login,
  COUNTIF(s.t_folder  IS NOT NULL)  AS n_folderConnected,
  COUNTIF(s.t_orch    IS NOT NULL)  AS n_orchOpened,
  COUNTIF(s.t_spawn   IS NOT NULL)  AS n_firstSpawn,
  COUNTIF(d.t_done    IS NOT NULL)  AS n_firstDone,
  ROUND(100*COUNTIF(s.t_spawn IS NOT NULL)/COUNT(*),1) AS pct_open_to_spawn,
  ROUND(100*COUNTIF(d.t_done  IS NOT NULL)/COUNT(*),1) AS pct_open_to_done,
  ROUND(APPROX_QUANTILES(
    TIMESTAMP_DIFF(s.t_spawn, s.t_open, MINUTE), 2)[OFFSET(1)],1) AS med_min_to_spawn
FROM steps AS s LEFT JOIN done AS d ON d.userId = s.userId AND d.ver = s.ver
GROUP BY s.ver ORDER BY s.ver DESC;
```

> ★ 해석 주의: `n_login`/`n_folderConnected`/`n_orchOpened` 는 **#542 계측(3.0.17 빌드 이후)에만 존재**한다. `zx-pre470-unknown` 행에서 이 값이 0 인 것은 "이탈"이 아니라 **미계측**이다. 버전 간 비교는 `n_opened`/`n_firstSpawn`/`n_firstDone` 축에서만 유효하다.

### T3 — 신규 사용자 코호트 일별 추이 (3.0.19 누적 추적용)

새 3.0.19 사용자가 들어올 때마다 한 줄씩 늘어난다. 이 표의 3.0.19 `newUsers` 합계가 **5 이상**이 되면 §4-1 의 검정을 다시 돌릴 만하다.

```sql
WITH admin_clients AS (
  SELECT DISTINCT e.userId AS clientId
  FROM `marblo-2253d.marblo_telemetry.events` AS e
  JOIN (SELECT DISTINCT agentId FROM `marblo-2253d.marblo_telemetry.cost_logs`
        WHERE userId = @ADMIN_UID AND agentId IS NOT NULL) AS c ON e.agentId = c.agentId
  WHERE e.userId IS NOT NULL
),
ev AS (
  SELECT * FROM `marblo-2253d.marblo_telemetry.events`
  WHERE userId IS NOT NULL AND userId NOT IN (SELECT clientId FROM admin_clients)
    -- 서명 릴리스만: pre-#470 폴백('3.0.0')·dev(null)·CI봇 제외
    AND appVersion IS NOT NULL AND appVersion NOT IN ('3.0.0','github-actions')
),
first_day AS (SELECT userId, appVersion, MIN(DATE(timestamp)) AS d0 FROM ev GROUP BY 1,2)
SELECT f.appVersion, f.d0 AS cohortDate,
  COUNT(DISTINCT f.userId)       AS newUsers,
  COUNTIF(s.spawns > 0)          AS spawned,
  COUNTIF(IFNULL(o.done,0) > 0)  AS completed
FROM first_day AS f
LEFT JOIN (SELECT userId, COUNTIF(event='agent:spawned') AS spawns FROM ev GROUP BY 1) AS s
  USING (userId)
LEFT JOIN (SELECT userId, COUNTIF(success) AS done
           FROM `marblo-2253d.marblo_telemetry.task_outcomes`
           WHERE userId NOT IN (SELECT clientId FROM admin_clients) GROUP BY 1) AS o
  USING (userId)
GROUP BY f.appVersion, f.d0 ORDER BY f.d0 DESC, f.appVersion DESC;
```

현재 출력(2026-07-31):

| appVersion | cohortDate | newUsers | spawned | completed |
| ---------- | ---------- | -------- | ------- | --------- |
| 3.0.19     | 2026-07-29 | 1        | 1       | **1**     |
| 3.0.18     | 2026-07-22 | 1        | 1       | 0         |
| 3.0.18     | 2026-07-21 | 1        | 1       | 0         |

### T4 — 특정 사용자 온보딩 궤적 추적 (§3-3 재생성)

새 3.0.19 사용자가 어디서 막히는지 개별 확인용. `'3.0.19'` 만 바꾸면 다른 버전에도 쓴다. (단독 실행 가능 — `admin_clients` CTE 를 자체 포함한다.)

```sql
WITH admin_clients AS (
  SELECT DISTINCT e.userId AS clientId
  FROM `marblo-2253d.marblo_telemetry.events` AS e
  JOIN (SELECT DISTINCT agentId FROM `marblo-2253d.marblo_telemetry.cost_logs`
        WHERE userId = @ADMIN_UID AND agentId IS NOT NULL) AS c ON e.agentId = c.agentId
  WHERE e.userId IS NOT NULL
)
SELECT CONCAT('u_', SUBSTR(TO_HEX(SHA256(userId)),1,10)) AS user_hash,
       FORMAT_TIMESTAMP('%F %R', timestamp) AS t, event,
       SUBSTR(IFNULL(metadata,''),1,120) AS meta
FROM `marblo-2253d.marblo_telemetry.events`
WHERE userId NOT IN (SELECT clientId FROM admin_clients)
  AND appVersion = '3.0.19'
  AND (event LIKE 'onboarding:%'
       OR event IN ('app:first_run','auth:login_attempt','auth:login_success',
                    'auth:login_failed','session:started','agent:spawned','agent:crashed'))
ORDER BY userId, timestamp;
```

## 6. 재측정 체크리스트

1. `getAdminUsageSummary` 런타임 env 에서 `ADMIN_UID` 획득(원문 기록 금지) → `@ADMIN_UID` 치환.
2. **T3** 실행 — 3.0.19 `newUsers` 누계 확인. 5 미만이면 여기서 중단(표본부족, 재측정 무의미).
3. 5 이상이면 **T1 + T2** 실행 → §3 표 갱신.
4. §4-1 검정 재실행: 3.0.19 완료율 vs 3.0.18 완료율로 Fisher exact + Clopper-Pearson CI. **CI 가 겹치면 여전히 "판정 불가"로 기록할 것** — 방향성만 보고 결론 내지 말 것.
5. 새 릴리스(3.0.20+)가 나오면 T1/T2/T3 는 코드 변경 없이 자동으로 새 행을 만든다. 단 **`appVersion` 라벨 정규화(§1-2)의 `'3.0.0'` 예외는 영구 유지**해야 한다 — 과거 데이터가 남아 있는 한 이 폴백은 사라지지 않는다.

## 7. 알려진 한계

- **표본 1 vs 2.** 이 문서의 모든 버전 간 비교는 통계적 검정력이 없다. §4 참조.
- **인과 아님.** 3.0.19 사용자와 이전 코호트는 획득 경로가 다르다(자발적 설치 vs 2026-07-14 파운더 메일 일괄 발송). 온보딩 변경만 분리한 A/B 가 아니다.
- **`task_outcomes` 에 `appVersion` 없음.** 버전 귀속은 `events` 유래 대표 버전 조인이다. 현재는 다중 버전 사용자가 1명뿐이라 안전하지만, 사용자가 늘고 앱 업데이트가 잦아지면 오귀속이 생길 수 있다 — 그때는 `task_outcomes.completedAt` 기준 as-of 조인으로 강화해야 한다. (근본 해결은 `task_outcomes` 에 `appVersion` 컬럼 추가 — 별도 티켓 후보.)
- **pre-#470 코호트는 실제 버전을 알 수 없다.** '3.0.0' 라벨이 3.0.13~3.0.16 을 뭉뚱그린다. 그 안에서 세부 버전 비교는 불가능하다.
- **파운더 vs 비파운더 구분 불가.** 선행 문서 §4 와 동일 — `events`/`task_outcomes`.userId 는 익명 clientId 라 Firestore `founders`(실제 uid 키)와 조인할 키가 없다.
- **`flow_executions` 0행** — 여전히 미측정.

## 관련 메모

- [[bq_telemetry_adc_rest_access]]
- [[admin_exclude_johnkim_external_zero_value_2026_07]]
- [[beta_churn_activation_not_value_2026_07]]
- [[cleanroom_first_run_e2e_and_onboarding_surface]]
- [[telemetry_production_on_2026_07_17_and_appversion_fix]]
