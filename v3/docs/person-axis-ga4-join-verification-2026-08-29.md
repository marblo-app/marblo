# 사람키로 GA4 유입 × 텔레메트리가 로그 단위로 붙는가 — 실측 (2026-08-29)

티켓 `1b7xmwoKO8oeQZVXQfoZ`. 선행 `#1320`(각인 게이트 ON, 경계 2026-08-29
13:14:19Z) 직후의 **읽기 검증**이다. 코드는 한 줄도 고치지 않았고, GA4 로 아무것도
보내지 않았다. 모든 숫자는 `john.kim` ADC REST 로 `marblo-2253d` 를 직접 읽은
값이며, 쿼리 본문에 솔트·원시 id 는 없다(가명키는 `us_84a2…218` 식으로 마스킹).

사장님 질문 원문:

> "안 보내도 인스톨아이디를 키로 묶어서 양쪽이 이제 사람축으로 연결 분석은
> 되는거지?" / "사람축과 양측 통합 테이블이 연결키로 연결분석이 되는지 알려줘
> 로그단위로 쌓이고"

---

## 0. 한 줄 답

**로그 단위로 쌓이는 것은 된다(경계 이후 이벤트 행 100% 에 사람키가 붙고, 그
값은 링크표·구매표와 한 글자도 같다). 그러나 "GA4 유입 → 사람" 사슬은 지금
데이터로는 통과하는 사람이 0명이다 — 외부 사용자가 없어서가 아니라, 사슬 3단계
`analytics_identity` 가 2026-08-20 이후 갱신되지 않은 1회성 백필 표라서다.**

경계 이후 존재하는 사람은 **1명(내부 계정, 설치 2대)** 이고, 그 1명도 정식
사슬로는 GA4 에 닿지 않는다. 우회로(설치 원장 `gaKeyHmac`)로는 설치 2대 중 1대만
닿는다.

| 사장님 질문                                  | 답                                                                                                    |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 이벤트 행마다 사람키가 붙나                  | ★**붙는다.** 경계 이후 353/353 행(13:26Z 스냅샷) = 100%, NULL 0                                       |
| 세 곳의 키 값이 같은가                       | ★**같다.** `events.userKey` = `analytics_user_install.user_key` = `analytics_purchase.user_key` (1명) |
| 한 사람 두 설치가 하나로 묶이나              | ★**묶인다.** 그 1명이 실제로 설치 2대 → 이벤트에서도 링크표에서도 같은 `us_` 1개                      |
| GA4 유입(source/medium/campaign/country)까지 | ★**지금은 안 된다.** 정식 사슬 3단계에서 0. 원인 §3                                                   |
| 유입원별 사람 수·task 완료 집계              | 배선은 서지만 결과 **0행**(§5). 우회로로는 내부 1명 `(direct)/(none)/KR/dev`                          |

★**이 숫자를 좋게 읽지 마라.** 표본은 사람 1명이고 그 사람은 내부다. "사슬이
통과한다" 는 배선의 사실이지 분석 가능성의 사실이 아니다.

---

## 1. 전제 — 무엇을 어느 기간으로 세었나

- `events.userKey` 각인은 **forward-only** 다. 경계(`2026-08-29 13:14:19Z`, 각인
  첫 행) 이전 43만 행은 전부 NULL 이고 백필하지 않았다(`#1320`). 그래서 사람 축
  이벤트 분석은 **경계 이후만** 대상이다. 그 이전을 사람 수로 세면 거짓이다.
- `events` 는 파티션·클러스터가 없다. 그래도 `timestamp >= '2026-08-29'` 로
  잘라 20MB 안팎만 읽었다(`agent_heartbeats` 는 손대지 않았다).
- 숫자는 라이브라 쿼리마다 늘었다(178 → 194 → 229 → 353). 표 안의 값은 각 쿼리
  시각의 스냅샷이다. 비율·판정은 어느 스냅샷이든 같다.

### 1.1 키 공간 — 솔트 없이 SQL 로 붙는 이유

| 표.컬럼                                           | 형식           |  행 |  고유 | 형식 OK |
| ------------------------------------------------- | -------------- | --: | ----: | ------: |
| `events.userKey` (경계 이후)                      | `us_` + hex24  | 229 |     1 |     229 |
| `marblo_identity.analytics_user_install.user_key` | `us_` + hex24  |   5 |     4 |       5 |
| `analytics_user_install.install_key`              | `in_` + hex24  |   5 |     4 |       5 |
| `analytics_identity.install_key`                  | `in_` + hex24  | 593 |   593 |     593 |
| `analytics_identity.ga_key` (non-null)            | `ga_` + hex24  | 550 | **3** |     550 |
| `ga4_first_touch_current.gaKey`                   | `ga_` + hex24  | 863 |   863 |     863 |
| `install_attribution.gaKeyHmac` (non-null)        | `ga_` + hex24  |  16 | **1** |      16 |
| `install_attribution.installId`                   | 원시 UUID 36자 | 648 |   648 |     648 |
| `events.userId` (경계 이후)                       | 원시 UUID 36자 | 229 |     2 |     229 |
| `analytics_purchase.user_key`                     | `us_` + hex24  |  35 |    34 |      35 |

사슬의 모든 조인이 **가명 공간끼리**(`us_`/`in_`/`ga_`)다. HMAC 은 적재 시점에
Node 안에서 이미 끝났으므로 검증 쿼리에 솔트가 필요 없다. 유일한 원시 조인은
`events.userId = install_attribution.installId`(둘 다 설치 축, §4 우회로)뿐이다.

`assertAxisPurity()` 를 우회하지 않았다 — 계정 축(`cost_logs`·uid)과 설치 축을
직접 붙인 쿼리는 하나도 없다. 사람 축 진입점은 `events.userKey` 와
`analytics_user_install` 둘뿐이다.

---

## 2. 로그 단위 — 이벤트 행에 사람키가 붙는가

```sql
SELECT MIN(IF(userKey IS NOT NULL,timestamp,NULL)) first_stamped,
       COUNTIF(userKey IS NOT NULL) stamped, COUNT(*) total,
       COUNTIF(timestamp>=TIMESTAMP('2026-08-29 13:14:19')) total_after,
       COUNTIF(userKey IS NULL AND timestamp>=TIMESTAMP('2026-08-29 13:14:19')) null_after,
       COUNT(DISTINCT userKey) people,
       COUNTIF(userKey IS NOT NULL AND NOT REGEXP_CONTAINS(userKey,r'^us_[0-9a-f]{24}$')) bad_format
FROM `marblo-2253d.marblo_telemetry.events` WHERE timestamp>='2026-08-29'
```

| 구간                 |      행 |    각인 |   NULL | 비율                     |
| -------------------- | ------: | ------: | -----: | ------------------------ |
| 08-22 ~ 08-28 (일별) |  48,663 |       0 | 48,663 | 0% (설계대로, 경계 이전) |
| 08-29 경계 이전      |  11,695 |       0 | 11,695 | 0%                       |
| ★08-29 경계 이후     | **353** | **353** |  **0** | ★**100%**                |

- `first_stamped = 2026-08-29 13:14:19Z` — 오케 검산과 동일.
- `bad_format 0` — 전부 `us_` + hex24(27자).
- 경계 이후 고유 사람 **1**, 고유 설치(`userId`) **2**.
- 미인증 텔레메트리(`logAnonymousTelemetryBatch`)는 uid 가 없어 각인이 불가능한
  경로인데, 이 12분 창에는 그런 행이 없었다(NULL 0). 창이 길어지면 NULL 이 생기는
  것이 정상이고 그것은 결함이 아니다(설계 §2.5).

경계 이후 이벤트 종류: `token:usage` 225 · `onboarding:multi_agent_success` 2 ·
`agent:spawned` 1 · `routing:shadow` 1 · `onboarding:multi_agent_active` 1 ·
`dispatch:decision` 1. **`task:*` 는 0** — 최근 7일 전체에도 `task:*` 행이 없다.

---

## 3. ★사슬 5단계 — 어디서 몇 개가 떨어지는가

정식 사슬(티켓 지정):
`ga4_first_touch_current(gaKey)` → `analytics_identity(ga_key↔install_key)` →
`analytics_user_install(install_key↔user_key)` → `events(userKey)` →
`analytics_purchase(user_key)`.

```sql
WITH ft  AS (SELECT DISTINCT gaKey FROM `marblo-2253d.marblo_telemetry.ga4_first_touch_current`),
     ai  AS (SELECT DISTINCT install_key, ga_key FROM `marblo-2253d.marblo_telemetry.analytics_identity`),
     aui AS (SELECT DISTINCT user_key, install_key FROM `marblo-2253d.marblo_identity.analytics_user_install`),
     ev  AS (SELECT userKey, COUNT(*) rows_ FROM `marblo-2253d.marblo_telemetry.events`
             WHERE timestamp>=TIMESTAMP('2026-08-29 13:14:19') AND userKey IS NOT NULL GROUP BY 1),
     ap  AS (SELECT DISTINCT user_key FROM `marblo-2253d.marblo_telemetry.analytics_purchase`)
SELECT (SELECT COUNT(*) FROM ft) s1,
       (SELECT COUNT(DISTINCT ai.install_key) FROM ft JOIN ai ON ai.ga_key=ft.gaKey) s2,
       (SELECT COUNT(DISTINCT aui.user_key) FROM ft JOIN ai ON ai.ga_key=ft.gaKey
          JOIN aui ON aui.install_key=ai.install_key) s3,
       (SELECT COUNT(DISTINCT ev.userKey) FROM ft JOIN ai ON ai.ga_key=ft.gaKey
          JOIN aui ON aui.install_key=ai.install_key JOIN ev ON ev.userKey=aui.user_key) s4,
       (SELECT COUNT(DISTINCT aui.user_key) FROM ft JOIN ai ON ai.ga_key=ft.gaKey
          JOIN aui ON aui.install_key=ai.install_key JOIN ap ON ap.user_key=aui.user_key) s5
```

| 단계 | 조인                                   | 들어옴       | 남음                                 | 유실                                          |
| ---: | -------------------------------------- | ------------ | ------------------------------------ | --------------------------------------------- |
|    1 | `ga4_first_touch_current`              | 브라우저 863 | 863                                  | —                                             |
|    2 | `⋈ analytics_identity.ga_key`          | 863 브라우저 | 브라우저 **3** · 설치 **550**/593    | 브라우저 860 (99.7%) — 설치를 낸 적 없는 방문 |
|    3 | `⋈ analytics_user_install.install_key` | 설치 550     | ★**설치 0 · 사람 0** (링크표 4명 중) | ★**100%** — 여기서 끊긴다                     |
|    4 | `⋈ events.userKey` (경계 이후)         | 사람 0       | 0                                    | —                                             |
|    5 | `⋈ analytics_purchase.user_key`        | 사람 0       | 0                                    | —                                             |

같은 표를 **반대 방향**(이벤트에서 출발)으로 세면 끊기는 자리가 더 선명하다:

| 단계 | 출발: 경계 이후 각인된 사람                | 값                                                     |
| ---: | ------------------------------------------ | ------------------------------------------------------ |
|    4 | `events.userKey` 고유                      | **1** (행 229, 설치 2)                                 |
|  4→3 | 그중 `analytics_user_install` 에 있는 사람 | **1/1** ✓ (링크된 설치 2/2)                            |
|  3→2 | 그 설치 2대가 `analytics_identity` 에 있나 | 2/2 ✓ — 그런데 **`ga_key` 둘 다 NULL**                 |
|  2→1 | GA4 행                                     | **0**                                                  |
|  4→5 | `analytics_purchase` 에 있는 사람          | **1/1** ✓ (grant 1 · paid 1, `account_class=internal`) |

### 3.1 ★끊긴 자리의 원인 — `analytics_identity` 는 1회성 백필이고 멈춰 있다

링크표 4명의 설치 4대 중 3대는 `analytics_identity` 에 **있다**(1대는 아예 없음).
있는 3대 모두 `ga_key IS NULL`, `linked_at IS NULL`, `link_confidence='unmapped'`.

```sql
SELECT ga_key IS NULL ga_key_null, id_scheme, link_confidence, COUNT(*) n,
       MIN(linked_at), MAX(linked_at)
FROM `marblo-2253d.marblo_telemetry.analytics_identity` GROUP BY 1,2,3
```

| `ga_key` | scheme |   n | `linked_at` 범위           |
| -------- | ------ | --: | -------------------------- |
| 있음     | uuid36 | 550 | 2026-08-06 ~ **08-20**     |
| NULL     | uuid36 |  41 | (없음 — 원장 행 없는 설치) |
| NULL     | 기타   |   2 |                            |

원장(`install_attribution`)과 대조:

| 날짜(UTC)     | `analytics_identity.linked_at` | `install_attribution.linkedAt` |
| ------------- | -----------------------------: | -----------------------------: |
| ~08-20        |              550 (원장과 일치) |                            551 |
| 08-22 ~ 08-24 |                          **0** |                             82 |
| 08-28         |                          **0** |                             15 |
| ★08-29        |                          **0** |      1 ← 각인된 그 사람의 설치 |

- 쓰는 코드는 `functions/scripts/backfill-analytics-identity.ts` **하나**다.
  `scheduledSyncGa4Bridge`(`index.ts:18654`)는 `ga4_first_touch` 만 갱신하고
  `analytics_identity` 를 건드리지 않는다(`ga4_bridge_sync_log` 는 08-25 까지
  정상 incremental). 함수 소스에 `analytics_identity` 로의 INSERT/MERGE 는 없다.
- 즉 08-20 이후 원장에 들어온 98행은 `analytics_identity` 에 **한 번도 반영되지
  않았다.** 각인된 사람의 설치 1대는 08-29 12:19Z 에 원장 행(`app_first_run`,
  `buildChannel=dev`, `gaKeyHmac` 있음)을 만들었지만 identity 는 모른다.
- `#1315` 문서 §3 의 "`ga4_first_touch_current ⋈ analytics_identity` 550/593 =
  93%" 는 맞는 숫자이되 **08-20 시점의 스냅샷**이다. 앞으로 그 비율은 원장이 늘수록
  내려간다.

★**이것이 이 티켓이 찾은 "끊긴 곳"이다.** 키가 틀린 게 아니고(형식 전부 OK),
축 가드에 막힌 것도 아니다. 사슬의 2↔3 다리를 **채우는 작업이 예약돼 있지 않다.**
고치는 것은 별건이다 — 백필 스크립트 재실행(멱등, `[ddl] 기존 행 삭제(재실행
멱등)` 주석)이거나 원장→identity 를 GA4 sync 처럼 스케줄에 올리는 일이다. 다만
재실행해도 3단계 결과는 **1명(내부)** 이 상한이다(§4).

---

## 4. 우회로 실측 — 설치 원장 `gaKeyHmac` 으로는 닿는가

`#1195`(08-28) 이후 원장 행은 `gaKeyHmac`(= `ga4_first_touch.gaKey` 와 같은 가명
공간)을 든다. 정식 사슬 대신 `events.userId → install_attribution.installId →
gaKeyHmac → ga4_first_touch_current.gaKey` 로 가면:

```sql
WITH ev AS (SELECT userKey, userId, COUNT(*) rows_
            FROM `marblo-2253d.marblo_telemetry.events`
            WHERE timestamp>=TIMESTAMP('2026-08-29 13:14:19') AND userKey IS NOT NULL GROUP BY 1,2)
SELECT ft.source, ft.medium, ft.campaign, ft.country, ia.buildChannel,
       COUNT(DISTINCT ev.userKey) people, COUNT(DISTINCT ev.userId) installs, SUM(ev.rows_) stamped_rows
FROM ev
LEFT JOIN `marblo-2253d.marblo_telemetry.install_attribution` ia ON ia.installId=ev.userId
LEFT JOIN `marblo-2253d.marblo_telemetry.ga4_first_touch_current` ft ON ft.gaKey=ia.gaKeyHmac
GROUP BY 1,2,3,4,5
```

| source              | medium | campaign | country     | channel | 사람 | 설치 | 각인 행 |
| ------------------- | ------ | -------- | ----------- | ------- | ---: | ---: | ------: |
| (direct)            | (none) | (direct) | South Korea | dev     |    1 |    1 |     119 |
| NULL (원장 행 없음) |        | 1        | 1           | 234     |

- 같은 사람의 설치 2대 중 **1대만** 원장 행이 있고, 그 1대는 GA4 에 닿는다.
  다른 1대는 원장 행이 없다(`#1318` 의 "기존 설치 링크백" 앱 배포 전 설치로 추정 —
  추정이라 단정하지 않는다).
- 닿은 유입은 `(direct)/(none)`, `buildChannel=dev`, 원장 `referrerHost=www.google.com`.
  ★**내부 개발 설치**다. `install_attribution.gaKeyHmac` 고유값이 **1** 이고
  `analytics_identity.ga_key` 고유값이 **3** 이라는 것이 같은 사실의 다른 표현이다
  — GA4 에 닿는 브라우저는 여전히 우리 것뿐이다(`#1318`: 외부 0).
- 이 우회로도 축 규칙 안이다(설치 축 ⋈ 설치 축 ⋈ 브라우저 축, 사람키는 이벤트 행의
  각인). 그러나 정식 사슬을 대체할 수 없다 — 원장은 `gaClientId`(원시)가 주키고
  `gaKeyHmac` 은 08-28 이후 16행뿐이다.

---

## 5. ★사람키 3곳 값 대조 + 한 사람 두 설치

```sql
WITH ev  AS (SELECT DISTINCT userKey k FROM `…events` WHERE timestamp>='2026-08-29' AND userKey IS NOT NULL),
     aui AS (SELECT DISTINCT user_key k FROM `marblo-2253d.marblo_identity.analytics_user_install`),
     ap  AS (SELECT DISTINCT user_key k FROM `…analytics_purchase`)
SELECT CONCAT(SUBSTR(k,1,7),'…',SUBSTR(k,-3)) masked,
       k IN (SELECT k FROM ev) in_events, k IN (SELECT k FROM aui) in_link, k IN (SELECT k FROM ap) in_purchase
FROM (SELECT k FROM ev UNION DISTINCT SELECT k FROM aui UNION DISTINCT SELECT k FROM ap)
```

| 가명(마스킹)  | events 각인 | 링크표 |  구매표  |
| ------------- | :---------: | :----: | :------: |
| `us_84a2…218` |  ★**있음**  |  있음  |   있음   |
| `us_db17…513` |      —      |  있음  |   있음   |
| `us_b74e…4c1` |      —      |  있음  |   있음   |
| `us_9cd3…0d6` |      —      |  있음  |    —     |
| (30개)        |      —      |   —    | 구매표만 |

- ★**세 곳 값이 문자열 동치(`=`)로 일치한다** — 각인 값이 링크표·구매표와 한
  글자도 다르지 않다(`personAxisStamp.test.ts` 의 약속이 라이브에서도 선다).
- 링크표 4명 중 경계 이후 이벤트를 낸 사람은 1명뿐이라 나머지 3명은 "불일치"
  가 아니라 **"이 12분 창에 활동이 없음"** 이다.
- 구매표만 있는 30명 = 링크표가 없는 구매자. 이건 `#1315` 가 이미 센 링크
  커버리지 문제(4/10)이지 키 문제가 아니다.

**한 사람 두 설치** (샘플 있음):

| 근거                        | `us_84a2…218`                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `events` 경계 이후          | 설치(`userId`) **2** · 행 229 · 둘 다 같은 `userKey`                                                               |
| `analytics_user_install`    | `install_key` **2** (`in_8a36…7fa`, `in_ec83…0ed`), `last_seen_at` 13:14:56Z·13:15:01Z — 각인과 같은 배치에서 갱신 |
| `v_person_all_time`         | 설치 2 · 54일 · 356,430 이벤트 (소급 조회는 링크표로 이미 됨)                                                      |
| `analytics_purchase`        | grant(team, founder_grant) 1 · paid(lecture, toss) 1 · **`account_class=internal`**                                |
| `analytics_account_profile` | 행 없음(`is_admin` 판정 대상 아님)                                                                                 |

★두 설치가 하나의 사람으로 **실제로 묶인다.** 다만 그 사람은 내부 계정이고,
공용 기기(한 설치에 계정 2개)의 반대 케이스인 `in_5e22…bd4` 는 링크표에서
사람 2명(`us_b74e`, `us_db17`)이 붙어 있는데 이 창에 이벤트가 없어 각인이 행
단위로 갈라 주는지는 **미측정**이다.

---

## 6. GA4 유입 × 사람키 집계 — 샘플 쿼리와 결과

정식 사슬 버전(원하는 최종 형태):

```sql
WITH ev AS (
  SELECT userKey, COUNT(*) rows_, COUNTIF(event='task:completed') task_done
  FROM `marblo-2253d.marblo_telemetry.events`
  WHERE timestamp>=TIMESTAMP('2026-08-29 13:14:19') AND userKey IS NOT NULL GROUP BY 1),
person_ft AS (
  SELECT aui.user_key, ft.source, ft.medium, ft.campaign, ft.country
  FROM `marblo-2253d.marblo_identity.analytics_user_install` aui
  JOIN `marblo-2253d.marblo_telemetry.analytics_identity` ai ON ai.install_key=aui.install_key
  JOIN `marblo-2253d.marblo_telemetry.ga4_first_touch_current` ft ON ft.gaKey=ai.ga_key)
SELECT p.source, p.medium, p.campaign, p.country,
       COUNT(DISTINCT p.user_key) people_linked,
       COUNT(DISTINCT ev.userKey) people_with_events,
       SUM(ev.rows_) stamped_rows, SUM(ev.task_done) task_done
FROM person_ft p LEFT JOIN ev ON ev.userKey=p.user_key
GROUP BY 1,2,3,4 ORDER BY 5 DESC
```

**결과: 0행** (§3 의 3단계가 0 이므로 당연하다). 문법·축·키 형식은 전부 통과했고
`analytics_identity.ga_key` 가 채워지는 순간 이 쿼리는 그대로 산다.

참고로 사람 축을 떼고 **설치 축까지만** 세면 지금도 나온다:

| source   | medium | campaign | country     | 설치 | 브라우저 |
| -------- | ------ | -------- | ----------- | ---: | -------: |
| (direct) | (none) | (direct) | South Korea |  550 |        3 |

— 유입원 1종, 브라우저 3대. `#1318` 의 "외부 유입 0" 과 같은 그림이다. 사람 축이
붙어도 이 표에 사람 열이 하나 늘 뿐 유입원이 늘지 않는다.

`task_done` 은 `event='task:completed'`(`v3/src` 텔레메트리 발신명 실재)로 잡았고,
최근 7일 `events` 에 `task:*` 행이 0 이라 어느 경로로도 0 이다.

---

## 7. 판정 — 사장님께 드릴 문장

1. **"로그 단위로 쌓이나"** — 쌓인다. 2026-08-29 13:14:19Z 부터 인증 텔레메트리의
   이벤트 행마다 `us_` 사람키가 붙고, 지금까지 NULL 0 이다. 그 이전 43만 행은
   설계대로 NULL 이고 소급은 링크표 조회(`v_person_all_time`)로 한다.
2. **"양쪽이 사람 축으로 연결되나"** — 키는 맞고 배선은 선다. 하지만 **오늘
   기준 GA4 유입까지 닿는 사람은 0명**이다. 링크표에 4명, 각인된 사람 1명(내부)이
   있고, 그 사람의 설치가 `analytics_identity` 에서 `ga_key` 를 못 받았다.
3. **끊긴 곳은 하나** — `analytics_identity` 가 08-20 백필 이후 멈춰 있다. 원장에
   들어온 98행이 반영되지 않았고, 반영하는 스케줄이 없다. 이건 이 티켓 범위 밖의
   수리다(백필 재실행 또는 원장→identity 동기화를 GA4 sync 옆에 붙이기).
4. **고쳐도 지금 값은 내부 1명**이다. 사슬이 외부 사용자를 보여주려면
   (가) 링크 커버리지(4/10, `#1315`), (나) 외부 유입 자체(0, `#1318`) 가 먼저다.
   키 설계는 병목이 아니다 — 이 문장을 두 번째로 실측했다.

## 8. 이 문서가 하지 않은 것

- 코드 수정 없음. `analytics_identity` 재백필/동기화는 별 티켓 제안.
- GA4 발신 없음(`#1319` 보류 유지).
- `agent_heartbeats`(14.5M행) 미조회. `events` 전 기간 사람 수 미산출(경계 이전은 NULL 이라 의미 없음).
- 공용 기기 케이스의 행 단위 귀속(`in_5e22…bd4`)은 이벤트 부재로 미측정.
