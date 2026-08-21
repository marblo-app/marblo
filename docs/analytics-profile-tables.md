# 파생 분석 테이블 — `analytics_user_daily` / `analytics_install_profile` / `analytics_account_profile`

> 생성: 2026-08-21 · 티켓 `EJrLwysiDIMNTm9fhNwt`
> 코드: `v3/functions/src/analyticsProfiles.ts`(순수 계산) · `v3/functions/src/index.ts`(쿼리·스케줄)
> 테스트: `npm --prefix v3/functions run test:analytics-profiles`

---

## 0. 한 문장

`events` / `agent_heartbeats` / `task_outcomes` / `install_attribution` / `cost_logs` 를 읽어
**사람 × 날짜** 한 장과 **사람당 1행** 두 장을 매일 다시 만든다. 원본은 건드리지 않는다.

---

## 1. ★프로필이 두 개인 이유 — 합치지 마라

첫 설계는 `analytics_user_profile` **한 장**이었다. 한 행에 `user_key`(계정)와 `install_key`(설치)를
나란히 두는 "통합 테이블". **그 설계는 폐기됐다.** 취향이 아니라 **이미 배포한 약속** 때문이다.

`v3/src/components/legal/privacyContent.tsx:95` (한국어 · "사용량·비용 기록" 문단)

> 위 비식별 지표와는 별도 테이블이고, **두 기록이 공유하는 조인 키는 없습니다**(위 기록의 내부 식별자는 가명입니다).

`v3/src/components/legal/privacyContent.tsx:210` (English · 같은 문단)

> It lives in a separate table from the de-identified metrics above, and **the two share no join key** (the internal ids on those rows are pseudonyms).

`user_key` 와 `install_key` 를 한 행에 담는 순간 **그 행 자체가 조인 키**가 된다.
`analyticsPseudonym.ts` 로 `events ↔ cost_logs` 다리를 끊어 놓고 파생 테이블에서 다시 놓는 꼴이다.

### 그래서 축을 물리적으로 가른다

| 테이블                      | 축     | 키                    | 소스                                                    |
| --------------------------- | ------ | --------------------- | ------------------------------------------------------- |
| `analytics_user_daily`      | 익명축 | `install_key` × `day` | `events`, `agent_heartbeats`, `task_outcomes`           |
| `analytics_install_profile` | 익명축 | `install_key`         | 위 daily + `install_attribution`                        |
| `analytics_account_profile` | 계정축 | `user_key`            | `cost_logs`, Firestore `subscriptions`/`billingCharges` |

### 금지 / 허용

- ❌ `install_profile` 에 `user_key`·`uid`·이메일·계정 라벨 추가
- ❌ `account_profile` 에 `install_key`·`ga_key`·설치 라벨 추가
- ❌ 두 테이블을 잇는 매핑 테이블·뷰
- ✅ **계정축 안에서의 조인**: `analytics_account_profile` ↔ `cost_logs` ↔ `analytics_purchase`
  방침이 그 기록만은 계정에 붙는다고 명시한다 — _"이 기록만은 성격상 익명일 수 없습니다"_
  (`privacyContent.tsx:95`).

주석은 안 읽힐 수 있으므로 **기계가 대신 읽는다**: `assertAxisPurity(table, schema)` 가
반대 축 컬럼(중첩 `RECORD` 안까지)을 찾으면 던지고, 이 검사는

1. `analyticsProfiles.test.ts` 가 매 테스트마다,
2. `ensureAnalyticsProfileTable()` 이 **BQ 에 테이블을 만들기 전에**

돌린다. 2번이 중요한 이유: BigQuery 는 한 번 만든 컬럼을 지울 수 없다. 생성 전에 막는 것 말고는
되돌릴 방법이 없다.

---

## 2. ★활동(`active`) 정의 — 하트비트 존재로 세지 마라

```
active = 그날 status="working" 하트비트 ≥1건  또는  이벤트 ≥1건
```

**하트비트가 떠 있기만 한 날은 활동이 아니다.** 실측에서 어떤 설치가 14일 중 13일 "활동" 으로
잡혔는데, 하트비트 35,170건 중 `working` 0건 · 이벤트 0건이었다. 사람이 아니라 떠 있는
프로세스였다.

```
present_only = 하트비트 ≥1건 이면서 working 0 이고 이벤트 0
```

`active` 와 **배타적**이다. 좀비를 여기로 격리하지 않으면 코호트 분모가 부풀고, 그러면
리텐션이 실제보다 좋게 나온다.

| 그날 신호                        | `active` | `present_only` |
| -------------------------------- | -------- | -------------- |
| working ≥1                       | ✅       | ❌             |
| 이벤트 ≥1                        | ✅       | ❌             |
| 하트비트만 (working 0, 이벤트 0) | ❌       | ✅             |
| 아무 신호 없음                   | ❌       | ❌             |

프로필 레벨에서는 활동일이 0인데 하트비트만 온 설치를 `zombie = true` 로 표시한다.
다만 **코호트 제외는 이 플래그가 하지 않는다** — 활동 정의 자체가 한다(`first_active_day` 가
`null` 이라 모든 지평이 `pending`). 플래그를 지워도 숫자는 부풀지 않는다.

---

## 3. ★D1/D3/D7/D14/D30 정의 — 고르지 않고 **둘 다** 저장한다

업계에 두 정의가 다 쓰인다. 안 적으면 다음 사람이 다르게 읽고, 같은 화면이 다른 숫자로 보인다.
표본이 작을수록 두 값이 크게 벌어져서 **어느 쪽을 인용하느냐가 결론을 뒤집는다.**

**기준일 `day 0` = 그 설치의 첫 활동일**(`first_active_day`). 가입일도, 첫 하트비트일도 아니다 —
위 2절의 활동 정의를 충족한 첫 날이다.

| 컬럼         | 정의                                                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------------------------- |
| `d7_exact`   | **exact**(bracket/classic): `day 0` 로부터 **정확히 +7일 당일**에 활동. `day 0` 자체는 분자에 안 넣는다.         |
| `d7_window`  | **window**(rolling/range): `day 0` **다음날(+1)부터 +7일까지 창 안에서 하루라도** 활동. 양끝 포함, `day 0` 제외. |
| `d7_pending` | 오늘이 아직 `day 0 + 7` 에 **도달하지 않아 판정 불가**. 분자에도 분모에도 안 들어간다.                           |

`pending` 이 별도 컬럼인 이유: 분모에 넣으면 **어제 들어온 신규가 자동으로 D7 이탈로 찍힌다.**
`pending = true` 면 `d7_exact` / `d7_window` 는 `false` 가 아니라 **`null`** 이다.

### 예시 — 왜 정의를 밝혀야 하는가

첫 활동 08-01, 08-04 에 한 번 더 왔고 08-08(=+7일)에는 안 온 설치:

- `d7_exact = false` (7일째 당일엔 안 왔다)
- `d7_window = true` (+1~+7 사이에 왔다)

**같은 설치, 같은 데이터, 정반대 결론.** 그래서 화면은 어느 쪽을 인용하는지 반드시 같이 적어야 한다.

---

## 4. ★N 을 항상 들고 다녀라 — 분자·분모를 저장한다

유의미 사용 표본이 지금 **2개**다. `50%` 라고만 띄우면 2명짜리 표본에 확신이 생긴다.

- **프로필 행**은 설치 단위 `boolean` 을 저장한다(`d7_exact` 등).
- 분자·분모는 `summarizeInstallRetention(profiles)` 이 **한 곳에서** 센다.
  화면이 각자 SQL 로 분모를 세면 정의가 갈라지기 때문이다.
  결과는 `{numerator, denominator, rate, display:"1/2 (50.0%)"}`(`RetentionCountedRate`).
- **분모 0 은 `0%` 가 아니라 `null` / `"0/0 (—)"`.** "아무도 안 돌아왔다" 와 "판단할 표본이
  없다" 는 다른 말이다.
- 같은 원칙이 다른 비율에도 적용된다:
  - `success_rate` ← `tasks_completed` / `tasks_attempted` (+ `success_display`)
  - `cache_hit_rate` ← `cache_hit_numerator` / `cache_hit_denominator` (+ `cache_hit_display`)
  - `model_mix[].share` ← 전체 호출 0이면 `null`

어드민 콜러블 `getAdminInstallRetentionSummary` 가 이 요약을 그대로 내려준다.

### 모수를 잃지 않는다 — 안 쓴 사람도 행을 만든다

`install_profile` 은 **활동 행에서만** 만들지 않는다. `install_attribution` 에만 있고 활동
신호가 아예 없는 설치도 행을 만든다. 안 그러면 *"다운로드는 했는데 한 번도 안 쓴 사람"* 이
통째로 사라지고, 그건 정확히 활성화 퍼널에서 봐야 할 모수다.

2026-08-21 실측(읽기 전용 SELECT, 14일 창):

```
observed=558  neverActive=552 (zombie=2  neverRan=550)  cohort=6
```

활동 행에서만 만들었으면 `observed` 가 **8** 이 됐을 것이다 — 퍼널 분모가 70배 작아진다.

`neverActive` 를 둘로 가르는 이유는 **원인이 다르기 때문**이다:

| 값 | 뜻 |
| --- | --- |
| `installsZombie` | 하트비트는 왔는데 `working`·이벤트 0 — 떠 있던 **프로세스** |
| `installsNeverRan` | 어트리뷰션만 있고 신호가 아예 없음 — 안 온 **사람** |

`installsZombie + installsNeverRan + installsCohort === installsObserved` 가 항상 성립한다
(테스트로 고정). 어느 쪽에도 안 들어간 설치가 생기면 인원이 새는 것이다.

같은 원칙이 계정축에도 적용된다 — **결제만 있고 사용 기록이 없는 계정도 행을 만든다.**
조용히 빼면 유료 인원이 줄어 보이는데, 그 계정이 정확히 봐야 할 계정이다.

---

## 5. ★`id_scheme` — 2026-06-13 식별자 교체 경계

그 전 설치 id 는 Firebase uid(28자), 이후는 UUID(36자)다. **두 스킴을 이어붙이면 같은 사람이
이탈한 것처럼 보인다** — 실측에서 실제로 그랬다.

| 값             | 의미           |
| -------------- | -------------- |
| `legacy_uid28` | 교체 이전 스킴 |
| `uuid36`       | 교체 이후 스킴 |
| `unknown`      | 판정 불가      |

이어붙이지 않는다. 근거 없이 동일인이라 단정하는 쪽이 더 위험하다.

**선행 의존 주의**: `analytics_identity`(티켓 `dTpcKWwRw5DvEMKxpCZi`)가 `install_key` 를 HMAC
가명으로 바꾸면 가명 길이는 원시 길이와 무관해진다. 그래서 소스 쿼리는 **길이를 실어 보내지
않는다** — 그때 `LENGTH(userId)` 를 보내고 있으면 _틀린 스킴을 자신 있게_ 적게 된다.
가명화 이후 이 컬럼은 `unknown` 이 되고, 그게 정직한 값이다. 스킴을 되살리려면
`analytics_identity` 가 스킴을 컬럼으로 줘야 한다.

---

## 6. ★컬럼별 축 감사 — 어느 값이 어느 축에서 나오나

익명축 테이블에 계정축 값을 넣으면 안 된다. 다음은 실제 소스 확인 결과다.

| 값                                         | 실제 소스                                    | 축       | 어디에 있나                   |
| ------------------------------------------ | -------------------------------------------- | -------- | ----------------------------- |
| 이벤트 수 · 토큰 in/out                    | `events.userId`(=clientId)                   | 익명     | daily · install_profile       |
| working / presence 하트비트                | `agent_heartbeats.userId`(=clientId)         | 익명     | daily                         |
| 완료 · 실패 수                             | `task_outcomes.userId`(=clientId)            | 익명     | daily · install_profile       |
| `ga_key` · `ft_*`                          | `install_attribution.installId`              | 익명     | install_profile               |
| **비용(달러)**                             | `cost_logs.totalCost`                        | **계정** | ❗account_profile 만          |
| **`cacheReadTokens` / `cacheWriteTokens`** | `cost_logs` **에만 존재**                    | **계정** | ❗account_profile 만          |
| **`is_admin`**                             | `ADMIN_UID` env                              | **계정** | ❗account_profile 만          |
| `plan` · `first_paid_at`                   | Firestore `subscriptions` / `billingCharges` | 계정     | account_profile               |
| `mrr_usd` · `ltv_usd`                      | `analytics_purchase`(구매 티켓 소관)         | 계정     | account_profile (현재 `null`) |

### 원래 스펙에서 옮긴 것 (되돌리지 마라)

1. **캐시 지표가 `install_profile` 이 아니라 `account_profile` 에 있다.**
   `cacheReadTokens` / `cacheWriteTokens` 는 `index.ts` 전체에서 **`cost_logs` 에만** 존재한다.
   익명 테이블(`events` / `task_outcomes` / `agent_heartbeats`)에는 캐시 컬럼 자체가 없다.
   `install_profile` 에 `cache_hit_rate` 를 두려면 `cost_logs` 를 설치 축으로 끌어와야 하고,
   **그게 정확히 금지된 다리**다.
2. **`analytics_user_daily` 에 `cost_usd` 가 없다.** 토큰 수는 익명축에서 나오므로 남지만,
   달러 금액은 계정축 개념이다. daily 에 두면 누군가 반드시 계정축 합계와 대사(reconcile)하게
   되고, 그 대사 자체가 두 축을 잇는 소프트 조인이 된다.
3. **`models` 는 `STRUCT<model, calls>` 까지다.** `cost` 로 넓히지 마라 — 2번과 같은 이유.

### 그래서 포기한 것 (숨기지 않는다)

- **익명축은 운영자 자기제외가 구조적으로 불가능하다.** `is_admin` 이 계정축에만 있기 때문이다.
  방침이 이미 고지한 대가와 같다 — _"운영자 본인 활동 제외는 포기했습니다"_.
  익명축 숫자는 그만큼 운영자 도그푸드 쪽으로 **낙관 편향**될 수 있다.
- **`first_visit_at`(웹 첫 방문)은 아직 `null` 이다.** GA4 export 는 리전이 달라
  (`asia-northeast3` vs `US`) 한 쿼리에서 조인되지 않는다 — `getAdminCountryFunnel` 이 부딪힌
  같은 리전 블로커다. `null` 은 "방문이 없었다" 가 아니라 **"이 파이프라인이 모른다"** 다.
- **`mrr_usd` / `ltv_usd` 는 `null` 이다.** 구매 티켓(`analytics_purchase`)이 그 두 값의 주인이다.
  여기서 추정치를 넣으면 나중에 서로 다른 MRR 이 둘 생긴다.

---

## 7. 스케줄과 멱등

| 항목        | 값                                                                                 |
| ----------- | ---------------------------------------------------------------------------------- |
| 스케줄      | `scheduledBuildAnalyticsProfiles` — 매일 **05:30 KST** (다른 BQ 잡 04:00~05:00 뒤) |
| 수동 트리거 | `buildAnalyticsProfileTables({ windowDays? })` — 어드민 전용, 몇 번 눌러도 안전    |
| 창          | 기본 90일 (`ANALYTICS_PROFILE_WINDOW_DAYS`)                                        |
| 적재 방식   | load job **`WRITE_TRUNCATE`** — 테이블 통째 교체                                   |

**왜 스트리밍 insert + DELETE 가 아닌가**: marketing 미러에서 이미 데인 자리다. 직전 ~90분 내
스트리밍 버퍼가 있으면 `DELETE` 가 실패하고, 그때 insert 를 강행하면 중복 행이 쌓인다.
load job 은 버퍼와 무관하고 원자적이다.

**행이 0개면 교체하지 않고 건너뛴다.** 소스 쿼리가 0행을 돌려주는 건 십중팔구 장애
(권한·리전·컬럼명)지 "정말 아무도 안 썼다" 가 아니다. 그때 테이블을 비우면 어제까지 있던 분석이
통째로 사라진다 — 조용한 소실보다 오래된 데이터가 낫고, 건너뛴 사실은 결과의 `skipped` 에 남는다.

**소스 하나가 죽어도 나머지는 만든다.** 다만 조용히 비우지 않고 실패한 소스를 `notes` 에 남긴다 —
화면이 "그날 아무도 안 썼다" 로 오독하지 않게.

**계산은 순수 함수다.** `analyticsProfiles.ts` 는 BQ 도 Firestore 도 시계도 건드리지 않는다.
`today` 는 반드시 주입받는다 — 리텐션 판정이 시계에 흔들리면 검증이 불가능하다.

---

## 8. 스키마

컬럼 설명(`description`)에 정의를 박아 뒀다. 코드를 열지 않고 **BQ 콘솔에서 바로** `active` 가
무엇이고 `d7_exact` 가 어느 정의인지 읽을 수 있다.

### `analytics_user_daily` (익명축 · `day` DAY 파티션)

`install_key` `day` `active` `present_only` `working_beats` `presence_beats` `event_count`
`tokens_input` `tokens_output` `tokens_total` `app_version` `tasks_completed` `tasks_failed`
`models`(REPEATED `<model, calls>`) `roles` `task_types`
`error_categories`(REPEATED `<category, count>`) `id_scheme` `built_at`

### `analytics_install_profile` (익명축 · 설치당 1행)

- 키/스킴: `install_key` `id_scheme`
- first touch: `ga_key` `ft_utm_source` `ft_utm_medium` `ft_utm_campaign` `ft_referrer_host`
  `ft_landing_path` `ft_link_source` `ft_platform` `ft_build_channel`
- 이정표: `first_visit_at` `first_run_at` `first_spawn_at` `first_completed_at`
  `first_active_day` `last_active_day`
- 활동: `observed_days` `active_days` `present_only_days` `max_streak` `current_streak`
  `days_since_last_active` `zombie`
  (`observed_days = 0` 이면 어트리뷰션만 있고 활동 신호가 없는 설치다.)
- 리텐션: `{d1,d3,d7,d14,d30}_{exact,window,pending}`
- 사용량: `tokens_input` `tokens_output` `tokens_total` `model_mix`(`<model, calls, share>`)
- 완료: `tasks_completed` `tasks_failed` `tasks_attempted` `success_rate` `success_display`
  `top_errors`
- 기타: `app_version` `built_at`

### `analytics_account_profile` (계정축 · 계정당 1행)

`user_key` `is_admin` `total_cost_usd` `input_tokens` `output_tokens` `cache_read_tokens`
`cache_write_tokens` `total_tokens` `cache_hit_numerator` `cache_hit_denominator`
`cache_hit_rate` `cache_hit_display` `model_mix` `first_cost_at` `last_cost_at` `cost_days`
`first_paid_at` `plan` `mrr_usd` `ltv_usd` `built_at`

---

## 9. 선행 의존

| 티켓                   | 무엇                                                               | 이 PR 의 상태                                                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dTpcKWwRw5DvEMKxpCZi` | `analytics_identity` + `analyticsPseudonym.ts` 의 `kind="install"` | **기다리지 않고** 위 정의로 스키마를 확정했다. `install_key` 는 오늘 `events.userId`(원시 설치 ID)이고, 가명화되면 그 값이 가명으로 바뀔 뿐 이 파이프라인의 계산은 그대로다. `id_scheme` 만 `unknown` 이 된다(5절). |
| 구매 티켓              | `analytics_purchase`                                               | `mrr_usd` / `ltv_usd` 를 `null` 로 두고 자리를 비워 뒀다.                                                                                                                                                           |

머지 순서는 오케스트레이터가 잡는다.
