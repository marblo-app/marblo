---
title: 텔레메트리 데이터 모델 지도 — 어느 표에 무엇이 있고 무엇으로 잇는가
tags: [domain/foundations, topic/identity, topic/bigquery, topic/observability, topic/attribution, method/query-audit]
status: verified
date: 2026-08-30
links: [[telemetry-identity-axes]], [[glossary]], [[do-not-retry]], [[counting-unit-first]], [[empty-query-first]], [[functions-deploy-env-and-bq-views]], [[post-spawn-telemetry-gap]], [[verify-result-row]]
---

# 텔레메트리 데이터 모델 지도 — 어느 표에 무엇이 있고 무엇으로 잇는가

> **한 줄 판정**: ★채택 — `marblo-2253d` 의 두 데이터셋(`marblo_telemetry` 18장 · `marblo_identity` 5장)은 **세 축**(브라우저 `ga_key` / 설치 `install_key` / 사람 `user_key`)을 **링크표 두 장**(`analytics_identity` · `analytics_user_install`)으로만 잇는다. 2026-08-30 09:18Z 실측으로 그 사슬은 **864 → 647 → 2 → 1 → 1** — 끝까지 관통하는 사람이 1명 있다(끊겨 있던 08-29 이전과 다르다). 사람 축은 **`2026-08-29 13:14:19Z` 부터만** 있다.

축 개념(왜 `userId` 가 표마다 다른 사람인지)은 [[telemetry-identity-axes]] 에 있다. 여기는 **표와 키의 지도**다. 다시 쓰지 않는다.

## 무엇을 물었나

사장님 지시: _"각 테이블별 스키마 구조랑 어떤 데이터들을 보는지 설명하고 핵심키도 설명해줘 연결고리."_ 표를 처음 보는 사람이 이 노트 하나로 (1) 행 하나가 무엇인지 (2) 핵심키 (3) 무엇과 어떤 키로 잇는지 (4) **답할 수 있는 질문과 없는 질문**을 알아야 한다.

## 무엇을 했나

2026-08-30 09:18Z, `john.kim` ADC 로 `marblo-2253d` 를 **읽기 전용** 조회했다 — `INFORMATION_SCHEMA.COLUMNS`(스키마 정본) · `__TABLES__`(행수·크기, 무료) · 표별 집계. `agent_heartbeats` 는 풀스캔하지 않았다(1.78 GB). 스키마 컬럼 목록은 코드 상수가 아니라 **라이브 BQ** 에서 읽었다. 선행 문서 7건과 갈리는 수치는 실측을 썼다(위키 규약: 수치가 갈리면 코드·실측이 옳다). 이 노트에 원시 uid·솔트·실제 가명키 값은 없다 — **형식만** 적는다.

## 결과 (수치)

### 0. 키 형식 — 조인하기 전에 이것부터

| 키                                                        | 형식                       | 축       | 어디서 만드나                                                                                                            |
| --------------------------------------------------------- | -------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `install_key` / `events.userId`                           | 36자 UUID(`uuid36`)        | 설치     | 앱 설치 시 생성. `analytics_user_daily.install_key_hmac` 은 **HMAC 판**(`in_`+24hex=27자) — 링크표는 이 HMAC 판과 잇는다 |
| `ga_key` / `gaKey`                                        | `ga_`+24hex=27자           | 브라우저 | `HMAC(salt, "ga:"+client_id)`. `install_attribution.gaClientId` 는 **원시** GA4 client_id, `gaKeyHmac` 이 같은 HMAC 판   |
| `user_key` / `events.userKey`                             | `us_`+24hex=27자           | 사람     | `HMAC(salt, "user:"+uid)`. Node 안에서만 계산, SQL 에 솔트 없음                                                          |
| `cost_logs.userId` / `analytics_account_profile.user_key` | **28자 원시 Firebase uid** | 계정     | `us_` 와 **다른 키 공간**. 아래 함정 #1                                                                                  |

★`us_` 와 28자 uid 는 SQL 만으로 서로 변환할 수 없다(솔트가 BQ 밖에 있다). 이게 설계다.

### 1. `marblo_telemetry` — 표 18장 (실측 2026-08-30 09:18Z)

| 표                             | grain(행 1 = )                           | 핵심키                                                  | 잇는 곳 · 키                                                                                                                |                                                                      행수 | 답할 수 있다                                                | ★답할 수 없다                                                                                                                                                                                              |
| ------------------------------ | ---------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------: | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `events`                       | 앱 이벤트 1건                            | (`userId`, `timestamp`) — PK 없음                       | `analytics_user_install.user_key` ← `userKey`(**08-29 13:14Z 이후만**) · `task_outcomes.taskId` · `cost_logs.taskId`        |                                                         442,135 (68.8 MB) | 설치별 이벤트 흐름, 스폰·완료·에러, **경계 이후** 사람별 행 | 경계 이전 사람 수(`userKey` 전부 NULL) · 비용(`cost` 컬럼은 추정치, 원장 아님) · 미인증 설치(로그인 전 텔레메트리는 폐기됨)                                                                                |
| `agent_heartbeats`             | 에이전트 15초 하트비트 1건               | (`userId`, `agentId`, `timestamp`)                      | `events.userId`(설치)                                                                                                       |                                                  14,756,453 (**1.78 GB**) | 활동일·present_only 판정(파생표가 씀)                       | 사람(각인 안 함, 영구) · ★풀스캔 금지                                                                                                                                                                      |
| `task_outcomes`                | 완료·실패한 task 1건                     | `taskId`                                                | `cost_logs.taskId`(**유일한 다리**, 830 task 겹침) · `events.taskId`                                                        |                                                            1,774 · 설치 7 | task 성공률·소요·토큰                                       | `cost_logs` 와 `userId` 조인(0행, 함정 #3) · 사람                                                                                                                                                          |
| `flow_executions`              | 플로우 실행 1건                          | `runId`                                                 | —                                                                                                                           |                                            **0** (2026-04-19 이후 무변경) | 없음                                                        | 전부 — 코드에 상수만 있고 적재 안 됨                                                                                                                                                                       |
| `cost_logs`                    | 15초 폴 **델타** 1건                     | 없음(멱등키 없음)                                       | `task_outcomes.taskId` · `analytics_account_profile.user_key` = `userId`(원시 uid)                                          |                                              416,701 · uid 5 · task 2,184 | task 별 비용(`GROUP BY taskId`)                             | ★전역 `SUM(totalCost)`(함정 #2) · 설치·사람과 조인                                                                                                                                                         |
| `install_attribution`          | 링크백 1건(같은 설치 재발화 가능)        | `installId` + `linkedAt`                                | `analytics_identity.install_key` ← `installId` · `ga4_first_touch.gaKey` ← `gaKeyHmac`(16행뿐)                              |                                           648 · 설치 648 · **브라우저 5** | UTM·landing·플랫폼 원장                                     | 유입 수로 읽기(551행이 `buildChannel` NULL 재설치 루프, 브라우저 3개)                                                                                                                                      |
| `analytics_identity`           | 설치 1행 (**GA4↔설치 링크표**)           | `install_key`                                           | `ga4_first_touch_current.gaKey` ← `ga_key` · `analytics_install_profile.install_key` · `analytics_user_install.install_key` |           690 · `ga_key` 647 / NULL 43 · 최신 `linked_at` 08-29 12:19:37Z | 설치가 어느 브라우저에서 왔나                               | ★채널(`ft_source` 채워진 행 **1**) — 채널은 `ga4_first_touch_current` 가 정본 · 사람(사람 링크는 다른 표, 함정 #4) · `link_confidence=joined` 2행은 "어트리뷰션↔텔레메트리 쌍" 뜻([[do-not-retry]] DNR-05) |
| `analytics_install_profile`    | 설치 1행(집계)                           | `install_key`                                           | `analytics_identity.install_key` · `analytics_user_daily.install_key`                                                       | 690 · `install_class` reinstall_loop 551 · dev_tagged 96 · **unknown 43** | 활성화·D1~D30·토큰·성공률                                   | 사람 · 비용 · ★실사용 후보는 unknown 43 뿐(스폰 16 · 완료 6 · 2일+ 14)                                                                                                                                     |
| `analytics_user_daily`         | 설치 × 일 1행                            | (`install_key`, `day`) 파티션 `day`                     | `v_person_*` ← `install_key_hmac`(원시 `install_key` 아님)                                                                  |                                          243 · 설치 44 · 2026-06-01~08-29 | 일별 활동·working beats·토큰                                | 사람(직접은 불가, 뷰로만) · 비용                                                                                                                                                                           |
| `analytics_account_profile`    | **비용 프로필** 1행 (계정 목록이 아니다) | `user_key` = **28자 원시 uid**                          | `cost_logs.userId` · `analytics_purchase` 는 `us_` 라 **직접 불가**                                                         |                          35 · `is_admin` false 34 / true 1 · 비용>0 **5** | uid 별 비용·토큰·모델 믹스·캐시율                           | ★사람 수 분모(함정 #1) · 설치·이벤트와 조인(축 가드가 막음)                                                                                                                                                |
| `analytics_purchase`           | 결제·부여 이벤트 1건                     | `row_id` 파티션 `event_at` 클러스터 (`kind`,`user_key`) | `analytics_user_install.user_key` · `v_install_unified_revenue`                                                             |                   36 · grant 34 · paid 2(portone 1 · toss 1) · internal 2 | 사람별 결제·플랜                                            | 설치·채널과 직접 조인(링크표 경유)                                                                                                                                                                         |
| `analytics_purchase_staging`   | 위 표의 적재 스테이징                    | `row_id`                                                | `analytics_purchase`                                                                                                        |                                                                        36 | 적재 검증                                                   | 읽기용으로 쓰지 말 것                                                                                                                                                                                      |
| `ga4_first_touch`              | 방문자(브라우저) × 동기화 1행            | `gaKey` 파티션 `firstVisitDate`                         | `analytics_identity.ga_key`                                                                                                 |                                   864 · 키 864 · 마지막 sync 08-30 06:00Z | 첫 방문 source/medium/campaign/country/device               | 설치·사람(링크표 경유)                                                                                                                                                                                     |
| `ga4_first_touch_current` (뷰) | 브라우저 1행(최신 sync)                  | `gaKey`                                                 | 위와 같음 — **조인은 이 뷰로**                                                                                              |                                                          864 · source 864 | 채널 정본                                                   | —                                                                                                                                                                                                          |
| `ga4_ecommerce_daily`          | 브라우저 × 일 1행                        | (`gaKey`,`eventDate`)                                   | `analytics_identity.ga_key`                                                                                                 |                                                  58 · 키 37 · 07-10~08-28 | 웹 결제 퍼널(view→checkout→purchase)                        | 앱 결제(그건 `analytics_purchase`)                                                                                                                                                                         |
| `ga4_ecommerce_current` (뷰)   | 브라우저 1행(누적)                       | `gaKey`                                                 | `v_install_unified`                                                                                                         |                                            0 (뷰, `__TABLES__` 는 0 표시) | 브라우저별 퍼널 누적                                        | —                                                                                                                                                                                                          |
| `ga4_bridge_sync_log`          | 브리지 실행 1건                          | `syncedAt`                                              | —                                                                                                                           |                         6 · 최근 08-30 06:00Z ok · 백필 1(400일) + 증분 5 | ★GA4 브리지가 도는가                                        | `analytics_identity` 가 도는가(다른 로그, §6)                                                                                                                                                              |
| `v_install_unified` (뷰)       | 설치 1행                                 | `installKey`                                            | 위 설치축 표 전부를 접음                                                                                                    |                                             690 · `hasGa4Row` 16 · dev 96 | 설치 한 장으로 채널·활성화·리텐션·외부성                    | ★결제·사람(IAM 경계 밖 → `marblo_identity`)                                                                                                                                                                |

### 2. `marblo_identity` — 표 1장 + 뷰 4장

| 표/뷰                              | grain                                                                                                   | 핵심키                               | 잇는 곳 · 키                                                                                                                  |                                                                                                        행수 | 답할 수 있다                                                | ★답할 수 없다                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------: | ----------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `analytics_user_install`           | (사람, 설치) 쌍 1행 (**사람↔설치 링크표**, `user_key` 와 `install_key` 가 한 행에 있는 **유일한** 자리) | `row_id`; (`user_key`,`install_key`) | `events.userKey` · `analytics_purchase.user_key` · `analytics_identity.install_key` · `analytics_user_daily.install_key_hmac` | **5** · 사람 4 · 설치 4 · 전부 `telemetry_auth`/`uuid36` · `policy_version` 08-21/08-29 · 최초 08-21 11:42Z | 어떤 설치가 어떤 사람인가 · 공용 기기(설치 1에 사람 2)      | 링크 없는 설치의 주인(과거 소급 생성 안 함) · 미인증 설치                    |
| `v_person_all_time`                | 사람 × 설치 × 일                                                                                        | (`user_key`,`install_key`,`day`)     | `analytics_user_daily ⋈ analytics_user_install`                                                                               |                                                                          92 · 사람 2 · 설치 3 · 06-13~08-29 | 링크 **이전**까지 소급한 사람별 일별 활동(캠페인 귀속 전용) | 화면 라벨 없이 쓰기 · 공용 기기(뷰가 **제외**하고 센다)                      |
| `v_person_since_link`              | 위와 같음                                                                                               | 같음                                 | 같음 + `day >= first_linked_at`                                                                                               |                                                                                        19 · 사람 2 · 08-21~ | 기본 사람 축 일별                                           | 링크 이전                                                                    |
| `v_install_unified_revenue`        | 설치 1행 + 사람·결제 컬럼                                                                               | `installKey`, `personKey`            | `v_install_unified ⋈ analytics_user_install ⋈ analytics_purchase`                                                             | 690 · `personKey` 3행(사람 2) · 사유 `no_install_key_hmac` 646 · `no_person_link` 40 · `shared_device` 1 · 없음 3(08-30 재생성 후) | 설치별 채널→결제 | 함정 #6 — 08-30 열린 게이트로 re-provision 됨. `SUM(revenueLedger)` 는 설치 수만큼 중복 |
| `v_install_unified_revenue_person` | 사람 1행                                                                                                | `personKey`                          | 위 뷰를 `personKey` 로 접음                                                                                                   | 2(08-30 재생성 후) · 결제 `paidCount` 0 — 원장 paid 2행이 전부 `pg_env=NULL` 이라 `unknownPgEnvPaymentCount` 로만 셈 | 사람별 결제(공식 경로) | 함정 #6 — 0 은 사유 컬럼(`unknownPgEnvPaymentCount`, `shared_device`)이 설명한다 |

두 뷰(`v_person_*`)는 `effective_from=2026-04-01`, `disabled_reason` NULL = 게이트 **열림**. 결제 뷰 두 장은 닫힌 채다. 같은 게이트를 읽는데 provision 시점이 달랐다.

### 3. 연결고리 그림 — 세 축과 끊길 수 있는 지점

```
 브라우저 축 (ga_key)            설치 축 (install_key / userId)                사람 축 (user_key)
 ────────────────────            ─────────────────────────────                 ──────────────────
 ga4_first_touch_current   ①    analytics_identity        ②   analytics_user_install   ③   events.userKey
 (gaKey, 864)  ──gaKey=ga_key──▶ (install_key, 690;       ──install_key──▶ (user_key↔install_key,   ──user_key=userKey──▶ (각인 행 1,821,
                                  ga_key 647 / NULL 43)          5행·사람4·설치4)                  사람 2, 08-29 13:14Z~)
 ga4_ecommerce_daily ─gaKey─┘          │ install_key                     │ install_key(HMAC)             │
                                        ▼                                 ▼                              │
                                 analytics_install_profile ◀──── analytics_user_daily(install_key_hmac)  │
                                 v_install_unified (설치 1행)      └─▶ v_person_all_time / _since_link ◀┘(사람×일)
                                        │
                                        ▼ (marblo_identity)
                                 v_install_unified_revenue ──personKey──▶ analytics_purchase(user_key)  ★지금 personKey 0
                                        └─▶ v_install_unified_revenue_person (0행)

 계정 축 (28자 원시 uid) — 위 셋과 SQL 로 이어지지 않는다:
   cost_logs(userId) ──taskId──▶ task_outcomes(taskId; userId 는 설치 36자) ──taskId──▶ events
   cost_logs(userId) ──userId=user_key──▶ analytics_account_profile     ✕ analytics_purchase(us_)  ✕ analytics_user_install(us_)

 원장: install_attribution(installId, 원시 gaClientId) ──installId──▶ analytics_identity ──HMAC(gaClientId)──▶ ga_key
```

★끊길 수 있는 지점(왼쪽부터):

| 지점                                | 무엇이 끊기나                                                                                                             | 지금 상태 (08-30)                                                          | 어떻게 아나                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------- |
| ① `ga_key` NULL                     | 원장(`install_attribution`)에 행이 없는 설치 42 + 원장은 있는데 `gaClientId` 빈 설치 1                                    | 43 NULL. 만들 수 없음(원장에 없는 걸 만들면 왜곡)                          | `analytics_identity` `COUNTIF(ga_key IS NULL)` |
| ①' `analytics_identity` 자체가 멈춤 | 08-20~08-29 **9일 0행**이었다 — 스케줄이 애초에 없었다                                                                    | 08-30 캐치업으로 690행. 스케줄 코드 머지됨, **실행 로그 표 아직 없음**(§6) | §6                                             |
| ② 링크 커버리지                     | `analytics_user_install` 은 인증된 텔레메트리 배치의 MERGE 로만 생긴다(forward-only, 08-21~). 최근 30일 활동 설치 10 중 4 | 사람 4 / 설치 4. ①과 겹치는 설치 **2**                                     | 사슬 2단계 = `identity(ga_key) ⋈ user_install` |
| ③ 각인 경계                         | `events.userKey` 는 08-29 13:14:19Z 이후 행에만                                                                           | 이후 1,821행 100% 각인, 최근 6h 224/224                                    | `MIN(timestamp) WHERE userKey IS NOT NULL`     |
| ④ 미인증                            | `logAnonymousTelemetryBatch` 는 uid 가 없다 — 어느 설계로도 사람 커버리지 100% 불가                                       | 구조적                                                                     | —                                              |
| ⑤ 결제 뷰 게이트                    | `v_install_unified_revenue` 가 닫힌 게이트로 provision 됨                                                                 | `personKey` 0                                                              | `revenueMissingReason` 값                      |

사슬 실측(2026-08-30 09:18Z): **GA4 방문자 864 → `ga_key` 있는 설치 647 → 그중 사람 링크된 설치 2·사람 2 → 각인된 사람 1 → GA4 유입까지 관통하는 사람 1.** 08-29 `#1321` 시점엔 3단계가 0 이었다. "연결이 되는가" 의 답은 **된다, 1명** 이다 — 그리고 그 1명은 내부 계정이다(`analytics_purchase.account_class=internal`).

### 4. ★신뢰 경계 — 사람 축은 `2026-08-29 13:14:19Z` 부터다

- `events.userKey` 가 처음 찍힌 행이 `2026-08-29 13:14:19Z`. **그 이전 440,314행은 전부 NULL** 이고, 백필하지 않는다 — `#1320` 이 근거 셋으로 판정했다(forward-only 설계·링크표 소급이 이미 조회로 됨·삭제요청 짝 규율).
- 경계 이전 구간에서 사람을 세고 싶으면 `events` 가 아니라 **`v_person_all_time`**(링크표 소급, 라벨 필수)로 간다. 그 뷰도 링크된 사람 2명뿐이다.
- ★**이걸 모르고 전 기간을 `COUNT(DISTINCT userKey)` 로 세면 그 수는 "사람 수"가 아니라 "경계 이후 1.5일 동안 로그인한 사람 수"다.** 화면·보고에 사람 수를 쓸 때 경계를 데이터에서 읽어라 — `buildEventStampBoundarySql()` 이 `first_stamped_at`·`stamped_rows`·`total_rows` 를 준다. env 선언값(`EVENTS_PERSON_STAMP_FROM`)을 그리지 마라, 배포가 밀리면 화면이 거짓말한다.
- 같은 이유로 `v_person_*` 의 하한은 `effective_from=2026-04-01`(방침 고지 기준)이고, 각인 경계(08-29)와 **다른 날짜**다. 둘은 다른 질문의 상한이다.

### 5. 축 가드 — `assertAxisPurity()` 가 무엇을 왜 막나

`v3/functions/src/analyticsProfiles.ts` `assertAxisPurity(table, fields)`. 표가 넷 중 어느 축인지 보고, **반대 축의 컬럼 이름**이 스키마에 있으면 던진다. 등록 안 된 표도 던진다.

| 축         | 등록된 표                                                                   | 금지 컬럼(대표)                                                              |
| ---------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 익명(설치) | `analytics_user_daily` · `analytics_install_profile` · `analytics_identity` | `user_key`/`userkey` · `uid` · `email` · `cost_usd` · `mrr_usd` · `is_admin` |
| 계정       | `analytics_account_profile` · 팀 사용량 뷰 2                                | `install_key`/`installkey` · `ga_key`/`gakey` · `client_id`                  |
| 링크       | `analytics_user_install` **하나**                                           | `uid` · `ga_key` · `email` · `name` · `person_key`                           |
| 이벤트     | `events` · `task_outcomes` · `agent_heartbeats`                             | 익명 목록 − `user_key`(각인 허용) + `person_key`                             |

왜: 처리방침이 "비식별 1차 지표 ↔ 계정 비용 기록 사이에 공유 조인 키가 없다" 고 고지한다. 두 축을 한 표에서 잇는 컬럼이 생기면 표가 "가명 매핑" 이 아니라 **명부**가 된다. 그래서 `user_key` 와 `install_key` 가 한 행에 있는 자리는 링크표 하나로 고정하고, 링크표를 지우면 사람 축이 통째로 사라지게 한다(되돌릴 수 있음).

★막히면 우회하지 마라 — 막힌 사실이 설계 입력이다. 한계도 알아 둬라: 가드는 **이름만** 본다. `events.userId` 에 계정 uid 가 들어가도 못 잡는다(값은 36자 설치 UUID 라 정상이지만, 이름이 틀린 컬럼이다 — 개명 `installClientId` 는 별건). camelCase 철자(`userKey`) 구멍은 `#1315` 가 메웠다.

### 6. ★"이 표가 멈추면 어떻게 아는가"

`analytics_identity` 가 08-20~08-29 9일간 0행이었는데 아무도 몰랐다. 원인은 스케줄이 애초에 없었던 것(`#1324` §1). 지금:

| 표                                                                                 | 갱신 주기                                                  | 도는지 아는 법                                                                                                                                                        | 08-30 09:18Z 실측                                                                                                                                                                               |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ga4_first_touch` / `ga4_ecommerce_daily`                                          | 일 1회 15:00 KST `scheduledSyncGa4Bridge`                  | `ga4_bridge_sync_log` 마지막 행 `ok`·`syncedAt`                                                                                                                       | 08-30 06:00Z ok, inserted 1                                                                                                                                                                     |
| `analytics_identity`                                                               | 일 1회 15:40 KST `scheduledSyncAnalyticsIdentity`(`#1324`) | `analytics_identity_sync_log` 마지막 행, 또는 어드민 callable `getAnalyticsIdentitySyncStatus`(`rowCount`/`gaKeyPresent`/`unmappedCount`/`maxLinkedAt` + 마지막 로그) | 4개 함수(`scheduledSyncAnalyticsIdentity`·`syncAnalyticsIdentity`·`getAnalyticsIdentitySyncStatus`·`getAdminPersonAxisCohort`)는 **08-30 09:11Z 배포 완료**(오케 `functions:list` 확인). 첫 실행은 08-30 09:47Z Cloud Scheduler 강제 실행(`inserted=0 upgraded=0 candidates=690`, `ok=true`)으로 `analytics_identity_sync_log` 가 생겼고, 다음 자동 실행은 08-31 06:40Z. 690행은 08-30 03:30Z ADC 수동 캐치업 결과 |
| `analytics_install_profile` · `analytics_user_daily` · `analytics_account_profile` | `scheduledBuildAnalyticsProfiles`                          | `built_at` 최댓값                                                                                                                                                     | 08-29 20:30Z                                                                                                                                                                                    |
| `analytics_user_install` · `events.userKey`                                        | 인증 텔레메트리 배치마다(실시간)                           | `MAX(last_seen_at)` / 최근 6h 각인률                                                                                                                                  | 08-30 09:07Z / 224/224                                                                                                                                                                          |
| `analytics_purchase`                                                               | `scheduledLoadAnalyticsPurchase`                           | `MAX(ingested_at)`                                                                                                                                                    | 08-29                                                                                                                                                                                           |
| `cost_logs` · `events` · `agent_heartbeats`                                        | 앱이 스트리밍 insert                                       | `MAX(timestamp)`                                                                                                                                                      | 09:16Z / 09:16Z / 09:08Z                                                                                                                                                                        |

규칙: **"마지막 행 시각" 과 "마지막 실행 로그" 는 다른 신호다.** 행이 안 늘어난 게 "유입이 없어서" 인지 "동기화가 죽어서" 인지는 실행 로그(0건 실행도 한 줄)가 있어야 가른다. `analytics_identity` 는 그 로그가 없어서 9일을 몰랐다.

### 7. ★함정 모음 — 실제로 사람을 속인 것만

| #   | 함정                                                    | 무엇이 틀렸나                                                                                                                                                                                                                                                   | 바른 읽기                                                                                                                |
| --- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | **`analytics_account_profile` 35행을 사람 분모로**      | 오케가 "34 − 4 = 30명이 링크 없음" 을 사장님께 보고했다. 35행 `user_key` 는 전부 **28자 원시 uid**(`cost_logs` 유래)이고 링크표 4명은 `us_` 27자다 — **키 공간이 달라 뺄셈이 성립하지 않는다.** 게다가 35 중 비용>0 은 5, 그마저 "앱을 켠 사용자" 분모가 아니다 | 이 표는 **비용 프로필**이다. 사람 수는 `analytics_user_install`, 링크 커버리지 분모는 "최근 활동 설치" 다                |
| 2   | **`cost_logs` 전역 SUM**                                | 15초 폴 델타이고 멱등키가 없다. 세션파일 재읽기 중복(D2)은 워터마크로 수리됐지만 스트리밍 insert 자체는 여전히 중복 가능(실측 416,701행 중 복합키 기준 고유 403,728) · `taskId` NULL 행 존재                                                                    | **`GROUP BY taskId`** 가 유일하게 정합한 축                                                                              |
| 3   | **`task_outcomes ⋈ cost_logs ON userId`**               | 앞은 설치 36자, 뒤는 uid 28자 — 조인 **0행**(실측). 컴파일은 된다                                                                                                                                                                                               | `taskId` 만 다리(830 task 겹침)                                                                                          |
| 4   | **링크가 두 종류인데 하나로 뭉침**                      | 오케가 "링크 4" 를 GA4↔설치와 사람↔설치 구분 없이 답했다. GA4↔설치는 `analytics_identity`(647), 사람↔설치는 `analytics_user_install`(4) — 다른 표·다른 키·다른 생성 경로                                                                                        | 어느 링크인지 먼저 말하고 수를 말한다                                                                                    |
| 5   | **`events` 는 파티션·클러스터가 없다**                  | `__TABLES__` 외 어떤 조회도 68.8 MB 풀스캔. `agent_heartbeats` 는 1.78 GB 풀스캔                                                                                                                                                                                | 실측 전 dry-run. 하트비트는 파생표(`analytics_user_daily`)로 답하라                                                      |
| 6   | **`v_install_unified_revenue_person` 0행 = 결제 없음?** | 아니다. 08-29 12:19Z `provision-install-unified --apply --replace-views` 가 `PERSON_AXIS_EFFECTIVE_FROM` **없는 셸**에서 돌아(스크립트는 `process.env` 만 읽고 `.env.<project>` 를 로드하지 않는다) `person_axis_closed` 본문이 DDL 로 굳었다. **08-30 열린 게이트로 재생성 완료** — 두 데이터셋 뷰 7개 중 닫힌 건 이것 하나였다. 이후 닫힌 채 `--apply` 는 `assessProvisionGate` 가 막는다(`--allow-closed-gate` 로만 승인) | 사유 컬럼을 먼저 읽어라([[verify-result-row]]). 재발 시 열린 게이트로 re-provision([[functions-deploy-env-and-bq-views]]) |
| 7   | **`analytics_identity.ft_*` 컬럼으로 채널 읽기**        | 컬럼은 있고 값은 1행뿐. "절반이 이미 있다" 는 컬럼 기준으론 맞고 데이터 기준으론 틀렸다                                                                                                                                                                         | 채널은 `ga4_first_touch_current`                                                                                         |
| 8   | **`install_attribution` 648행을 유입으로**              | 브라우저는 **5개**, 551행이 dev 브라우저의 재설치 루프                                                                                                                                                                                                          | `v_install_unified.externality` / `install_class` 로 가른 뒤 센다                                                        |
| 9   | **`link_confidence='joined'` 를 사람 링크로**           | 그건 "어트리뷰션 행과 텔레메트리 행이 **둘 다** 있다" 는 쌍 판정이다(2행). 사람과 무관                                                                                                                                                                          | [[do-not-retry]] DNR-05                                                                                                  |

### 8. 표본·재현 단위

- 재현 단위 = 표(행 수·키 형식) 및 사슬 단계(사람 수). 유의성은 사람 수 그대로다 — **1명·2명·4명**을 퍼센트로 접지 않는다([[counting-unit-first]]).
- 측정 시각 **2026-08-30 09:18Z**. 실시간 표(`events`·`cost_logs`·`agent_heartbeats`·`analytics_user_install`)는 그 뒤로 늘었다. 파생표는 다음 `built_at` 에 바뀐다.

## 왜

표가 21장인데 축은 넷이고 링크표는 둘뿐이라, **표 이름이 아니라 키 형식**을 보면 조인 가능 여부가 즉시 결정된다(27자 `us_`/`in_`/`ga_` 끼리, 36자 UUID 끼리, 28자 uid 끼리). 사람을 속인 아홉 건은 전부 이 규칙 하나를 건너뛴 결과다.

## 한계 / 정직성

- 뷰의 `__TABLES__` 행수는 0 으로 나온다. 뷰 행수는 직접 `COUNT(*)` 한 값이다.
- `agent_heartbeats` 는 메타데이터만 읽었다. 축 분포(36자/28자)는 [[telemetry-identity-axes]] 의 08-25 실측이다.
- `cost_logs` 중복 수치(복합키 고유 403,728)는 "중복이 있다" 의 하한 근거이지 정확한 중복량이 아니다 — 같은 초에 같은 모델로 두 델타가 정당하게 있을 수 있다.
- 티켓 본문 수치와 갈린 것: `analytics_account_profile` 34 → **35**, `dev_tagged` 95 → **96**, `unknown` 44 → **43**(스폰 17→16, 완료 7→6). `built_at` 08-29 20:30Z 재집계 결과다. 이 노트는 실측을 쓴다.
- `analytics_identity_sync_log` 부재의 원인(미배포 vs 배포됐으나 오늘 첫 실행 전)은 오케에 질문으로 남겼다(`#qmtfllt8ndbhs`). 노트는 관측 사실만 적는다.
- **수치가 갈리면 코드와 라이브 BQ 가 옳다.** 이 노트는 2026-08-30 스냅샷이다.

## 실제 영향

**무변경.** 코드·설정·BQ 를 고치지 않았다(읽기 전용). 고칠 것으로 드러난 것 둘 — (a) `v_install_unified_revenue` 를 열린 게이트로 re-provision, (b) `scheduledSyncAnalyticsIdentity` 실제 배포 확인 — 은 완료보고에 올렸고 별건이다.

## Evidence

- [v3/functions/src/analyticsProfiles.ts](../../../v3/functions/src/analyticsProfiles.ts) — 축 목록·금지 컬럼·`assertAxisPurity`
- [v3/functions/src/personAxis.ts](../../../v3/functions/src/personAxis.ts) — 링크표·`v_person_*` DDL·게이트
- [v3/functions/src/installUnified.ts](../../../v3/functions/src/installUnified.ts) — `v_install_unified` · 결제 뷰 두 장
- [v3/functions/src/ga4Bridge.ts](../../../v3/functions/src/ga4Bridge.ts) — `ga4_*` 표와 `analytics_identity` 조인 규약
- [v3/functions/src/analyticsIdentitySync.ts](../../../v3/functions/src/analyticsIdentitySync.ts) — 동기화·`analytics_identity_sync_log`
- [v3/docs/person-axis-event-stamp-2026-08-29.md](../../../v3/docs/person-axis-event-stamp-2026-08-29.md) · [v3/docs/person-axis-ga4-join-verification-2026-08-29.md](../../../v3/docs/person-axis-ga4-join-verification-2026-08-29.md) · [v3/docs/person-install-link-coverage-investigation-2026-08-29.md](../../../v3/docs/person-install-link-coverage-investigation-2026-08-29.md) · [v3/docs/ga4-person-key-uid2-decision-2026-08-29.md](../../../v3/docs/ga4-person-key-uid2-decision-2026-08-29.md) · [v3/docs/install-ledger-events-join-2026-08-29.md](../../../v3/docs/install-ledger-events-join-2026-08-29.md) · [v3/docs/admin-analytics-person-axis-wiring-2026-08-30.md](../../../v3/docs/admin-analytics-person-axis-wiring-2026-08-30.md) · [v3/docs/analytics-identity-sync-schedule-2026-08-30.md](../../../v3/docs/analytics-identity-sync-schedule-2026-08-30.md)
- [v3/docs/COST-AXIS-RECONCILIATION-2026-08-08.md](../../../v3/docs/COST-AXIS-RECONCILIATION-2026-08-08.md) — `cost_logs` 중복·전역 SUM 금지

## Backlinks

- [[telemetry-identity-axes]] — 축 개론. 이 노트는 그 위의 표·키 지도
- [[glossary]] — `userId`≠`userId`, 설치≠사람
- [[do-not-retry]] — DNR-04(소급 가명화 금지) · DNR-05(`joined` 오독)
- [[counting-unit-first]] · [[empty-query-first]] · [[verify-result-row]] · [[functions-deploy-env-and-bq-views]] · [[post-spawn-telemetry-gap]]
