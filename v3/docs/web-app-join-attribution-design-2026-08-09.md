# 웹↔앱 조인 · 유입채널/국가 귀속 설계 (2026-08-09)

> 티켓 `UzvcqHMdX5RYtOs048SB` · 범위 = **web-app 경계**(marblo.app ↔ 데스크탑 앱).
> 앱 내부 계측 갭(멀티에이전트·10분 성공 등)은 `pWSnJeQN` 담당이므로 여기서 다루지 않는다 — §10 경계 참조.
> **코드 변경 없음.** 변경 지점은 "어느 파일의 무엇을" 수준으로만 지목한다. GA4/BQ 콘솔 스텝은 실행 가능한 수준으로 구체화한다.

---

## 0. 결론 먼저

**사장님 질문**: "웹 방문→다운로드와 앱 설치→활성화를 이메일/uid로 한 사람으로 묶을 수 있나? 유입채널·국가별로도 보고 싶다."

**답**: 묶을 수 있다. 단 **티켓이 가정한 순서와 병목이 실측과 다르다.**

조사 전 가정했던 계획은 "GA4 user_id 심고 → BQ export 붙이고 → uid 로 조인"이었다. 실측해 보니:

| 가정                                        | 실측                                                             |
| ------------------------------------------- | ---------------------------------------------------------------- |
| GA4 BQ export 를 붙여야 한다                | **이미 붙어 있다** (2026-07-08부터 31일치 적재 중)               |
| uid 로 조인하면 된다                        | **쿼리 자체가 안 돈다** — 두 데이터셋이 서로 다른 BigQuery 리전  |
| 커버리지 한계 = "웹 미로그인 익명 다운로더" | 한계가 그보다 크다 — **다운로드 경로에 식별 모먼트가 아예 없다** |

그래서 권고는 3단이다:

1. **Phase 0 — 리전 블로커 해소** (§2). 이걸 안 하면 옵션 A 는 코드를 다 심어도 조인 쿼리가 에러난다. 이게 진짜 1순위다.
2. **Phase 1 — 옵션 A′ (권장, 최저비용)** (§5). 웨이트리스트/웹가입 문서에 유입맥락(utm·referrer·국가)을 **서버측에서 스탬프**하고 `email → uid` 로 조인. GA4 user_id 도, 크로스리전 조인도 없이 "이 채널로 들어온 사람이 앱에서 활성화됐나"를 답한다.
3. **Phase 2 — 옵션 A (GA4 user_id = Firebase uid)** (§4). 전구간(페이지뷰 단위) 여정이 필요해질 때. Phase 1 로 답이 나오는 질문에는 과투자다.
4. **옵션 B (다운로드 attribution 토큰)** — **지금은 하지 말 것** (§6). 우리 배포 토폴로지(GitHub 릴리스 직링크 + 서명/공증 바이너리)에서 유독 비싸고, Phase 1 이 같은 질문의 80%를 훨씬 싸게 답한다.

---

## 1. 현재 지형 — 실측 (측정창 2026-07-08 ~ 2026-08-07, 31일)

조사 방법: `john.kim` ADC 로 BigQuery REST 직조회 + 코드 리딩. 아래 수치는 추정이 아니라 쿼리 결과다.

### 1-1. 웹 (marblo.app)

| 항목                    | 실측                                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| GA4 속성                | **543991508** (BQ 데이터셋 `analytics_543991508` 에서 역산)                                                          |
| BQ export               | **가동 중.** `events_YYYYMMDD` 31개(20260708~20260807), `pseudonymous_users_YYYYMMDD` 31개                           |
| export 리전             | **`asia-northeast3`** (서울)                                                                                         |
| export 모드             | **일별(daily)만.** `events_intraday_*` 테이블 없음 → 스트리밍 export OFF                                             |
| `users_YYYYMMDD` 테이블 | **없음** — user_id 가 한 건도 없다는 뜻과 정합                                                                       |
| `user_id` 채움률        | **0 / 4,904 이벤트 = 0.0%**                                                                                          |
| 태깅                    | `marblo-web/src/lib/gtag.ts` (이벤트 카탈로그 단일소스) + `src/components/GoogleAnalytics.tsx` (로더 + SPA pageview) |

이벤트별 볼륨:

| event                            | 건수  | user_id 있는 건 | distinct user_pseudo_id |
| -------------------------------- | ----- | --------------- | ----------------------- |
| page_view                        | 2,577 | 0               | 554                     |
| session_start                    | 822   | 0               | 556                     |
| first_visit                      | 557   | 0               | 550                     |
| user_engagement                  | 458   | 0               | 256                     |
| scroll                           | 396   | 0               | 240                     |
| form_start                       | 365   | 0               | 112                     |
| **generate_lead** (웨이트리스트) | 56    | 0               | 53                      |
| **download** (설치파일 클릭)     | 39    | 0               | 26                      |
| begin_checkout                   | 16    | 0               | 4                       |
| view_item_list                   | 12    | 0               | 8                       |
| **purchase**                     | 1     | 0               | 1                       |

국가 (distinct user_pseudo_id):

| 국가                     | 방문자 | download 건 |
| ------------------------ | ------ | ----------- |
| South Korea              | 424    | **39**      |
| United States            | 54     | 0           |
| Iran                     | 43     | 0           |
| Netherlands              | 21     | 0           |
| Russia                   | 10     | 0           |
| Germany                  | 9      | 0           |
| (기타 CN/LU/GB/AU/HU 등) | ~30    | 0           |

→ 해외 트래픽 130명(23%)이 있는데 **다운로드 전환은 0**. 이건 이미 그 자체로 액션 아이템이다(영어 랜딩/다운로드 동선 점검). 조인 없이 GA4 단독으로 나오는 값이라는 점이 중요하다 — §7 참조.

유입채널 (`first_visit` 기준, distinct user_pseudo_id):

| source              | medium   | 유저 |
| ------------------- | -------- | ---- |
| (direct)            | (none)   | 356  |
| youtube.com         | referral | 104  |
| l.threads.com       | referral | 57   |
| m.facebook.com      | referral | 6    |
| bing                | organic  | 4    |
| facebook.com        | referral | 4    |
| google              | organic  | 4    |
| linkedin.com        | referral | 3    |
| github.com          | referral | 3    |
| t.co / naver / 기타 | referral | ~8   |

→ direct 64%. UTM 이 거의 안 붙어 있다는 신호(§7-3).

### 1-2. 앱 (데스크탑 v3)

| 항목      | 실측                                                                                                        |
| --------- | ----------------------------------------------------------------------------------------------------------- |
| 싱크      | `marblo-2253d.marblo_telemetry.events`                                                                      |
| 리전      | **`US`**                                                                                                    |
| 적재 경로 | `logTelemetryBatch` callable (`v3/functions/src/index.ts`) — **로그인 필수**(anti-abuse)                    |
| 행 키     | `events.userId` = **익명 설치 ID**(`clientId`, localStorage UUID). 계정 uid 아님                            |
| 계정 키   | `metadata.accountUserId` = Firebase uid. **서버가 `context.auth.uid` 로 주입** (`buildMetadata`)            |
| 클라 방어 | `anonymize()` 가 metadata 에서 `uid/userId/email/senderId` 를 **선삭제** → 계정 식별자는 서버 주입분이 유일 |

★**join key 는 최근에야 생겼다.** `accountUserId` 주입은 PR #806 (커밋 `ba3fc0f2`, 2026-08-06) 부터다:

| 주차        | 총 행   | accountUserId 있는 행 |
| ----------- | ------- | --------------------- |
| ~2026-07-26 | 130,833 | **0**                 |
| 2026-08-02  | 69,038  | 30,920                |
| 2026-08-09  | 13,934  | 13,934                |

전체 distinct `accountUserId` = **1** (오너 본인). 외부 실사용 ≈ 0 인 현 단계와 정합이며, 조인 설계의 정합성 문제는 아니다 — 다만 **"조인이 되는지" 검증을 실데이터로 할 수 없다**는 뜻이므로 §9 에 합성 검증 절차를 둔다.

앱측 퍼널 이벤트 (같은 창):

| event              | 건수 | distinct 설치(clientId) |
| ------------------ | ---- | ----------------------- |
| session:started    | 595  | 39                      |
| **app:first_run**  | 15   | 10                      |
| auth:login_attempt | 7    | 6                       |
| auth:login_success | 6    | 6                       |

★`app:first_run` 행은 전부 `accountUserId` NULL 이다. 버그가 아니라 타이밍이다 — 마지막 first_run 이 2026-08-04 라 PR #806 배포(08-06) 이전이다. 다만 아래 구조적 한계는 남는다:

> `flushTelemetry` 는 `auth.currentUser` 가 있을 때만 전송한다. 그래서 `app:first_run` / `login_attempt` / `login_failed` 는 큐에 쌓였다가 **"다음 성공적 로그인"에 함께 flush** 된다. 즉 **끝내 로그인에 성공하지 못한 사용자의 설치는 BQ 에 아예 존재하지 않는다.** (`telemetryService.ts` 주석에 이미 명시된 알려진 한계)

이건 조인 커버리지에 직접 영향을 준다 — §4-5 에서 수치로 반영한다.

### 1-3. 다운로드 경로

`marblo-web/src/app/[locale]/download/page.tsx`:

- 버튼은 **GitHub 릴리스 직링크** — `https://github.com/melocream/marblo-releases/releases/download/v3.0.22/...`
- 클릭 시 `trackAppDownload({os, arch, appVersion})` → GA4 `download` 이벤트
- **로그인 요구 없음.** 다운로드 페이지는 익명으로 완결된다
- 바이트는 GitHub 이 서빙한다 → **우리 서버가 다운로드 요청을 보지 못한다**

이 세 줄이 옵션 B 의 비용을 결정한다(§6).

### 1-4. 웹 식별 모먼트 (조인 가능성의 실제 상한)

| 모먼트                                         | uid 존재?                      | email 존재?           | 볼륨(31일)                     |
| ---------------------------------------------- | ------------------------------ | --------------------- | ------------------------------ |
| 웨이트리스트 폼 (`BetaTester50SignupForm.tsx`) | **아니오** (무로그인 `addDoc`) | 예 (`waitlist.email`) | 56                             |
| 웹 로그인/가입                                 | 예 (Firebase Auth)             | 예                    | **계측 안 됨**                 |
| 체크아웃/결제                                  | 예 (`onAuthStateChanged`)      | 예                    | 16 begin_checkout / 1 purchase |
| 다운로드 클릭                                  | 아니오                         | 아니오                | 39 (26명)                      |

★그리고 `trackLogin` / `trackSignUp` 은 **`gtag.ts` 에 정의만 되어 있고 호출부가 0곳**이다. 웹 로그인이라는 사건이 GA4 에 존재하지 않는다.

**→ 핵심 진단: 병목은 조인 메커니즘이 아니라 식별 모먼트의 부재다.** uid 를 GA4 에 심는 배관을 완벽히 깔아도, 다운로드하는 26명이 그 시점에 웹 로그인 상태가 아니면 조인되는 사람은 0명이다.

---

## 2. ★Phase 0 — 리전 블로커 (이걸 먼저)

### 2-1. 문제

```
analytics_543991508   → location: asia-northeast3   (GA4 export)
marblo_telemetry      → location: US                (앱 텔레메트리)
```

BigQuery 는 **리전이 다른 데이터셋을 한 쿼리에서 조인할 수 없다.** 실제로 시도한 결과:

```sql
SELECT COUNT(*) FROM `marblo-2253d.analytics_543991508.events_*` g
JOIN `marblo-2253d.marblo_telemetry.events` t
  ON g.user_id = JSON_VALUE(t.metadata, '$.accountUserId')
```

```
ERROR: Not found: Dataset marblo-2253d:marblo_telemetry was not found in location asia-northeast3
```

GA4 export 의 리전은 **BQ 링크 생성 시 확정되고 이후 변경 불가**다. 즉 "나중에 고치지" 가 안 되는 종류의 결정이며, 옵션 A 를 계획대로 심어도 마지막 쿼리에서 막힌다.

### 2-2. 해법 비교

| 안                                    | 내용                                                                                                                                                    | 비용                                          | 리스크                                                                           | 평가               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------- | ------------------ |
| **R1. 작은 쪽을 복사 (권장)**         | 앱측에서 **계정당 1행짜리 슬림 요약 테이블**을 US 에 만들고, 그 데이터셋만 `asia-northeast3` 로 일 1회 크로스리전 복사. 조인은 서울에서 GA4 원본과 수행 | 낮음. 복사 대상이 수천 행 규모                | 낮음                                                                             | ★채택              |
| R2. GA4 export 전체를 US 로 미러      | `analytics_543991508` 를 통째로 US 데이터셋에 복사                                                                                                      | 중~높음. GA4 원본은 트래픽에 비례해 계속 커짐 | 중                                                                               | 트래픽 커지면 손해 |
| R3. GA4 BQ 링크 재생성 (US 로)        | 링크 삭제 후 US 대상으로 재생성                                                                                                                         | 낮음                                          | **높음** — 기존 31일치 이력 단절, 데이터셋명 충돌(`analytics_<propertyId>` 고정) | 비권장             |
| R4. `marblo_telemetry` 를 서울로 이전 | functions insert 경로 + admin 쿼리 10+곳 + `marblo_training` 동반 이전                                                                                  | 높음                                          | 높음                                                                             | 과잉               |

**R1 을 택하는 이유**: 조인의 양쪽 중 *작은 쪽*이 앱 데이터다. GA4 는 마케팅이 성공할수록 커지고, 계정 요약은 계정 수만큼만 커진다. 그리고 부수 효과로 **개인식별자(uid)가 한국 리전에 머문다** — PIPA 관점에서 반대 방향보다 낫다(§8-4).

### 2-3. R1 실행 스텝

1. **US 에 슬림 요약 테이블 생성** — 데이터셋 `marblo_join_us` (location: US), 테이블 `account_activation`
   - 스키마(계정당 1행): `accountUserId STRING`, `firstSeenAt TIMESTAMP`, `firstRunAt TIMESTAMP`, `firstLoginAt TIMESTAMP`, `firstProjectAt TIMESTAMP`, `firstAgentSpawnAt TIMESTAMP`, `activeDays INT64`, `lastSeenAt TIMESTAMP`, `appVersionLatest STRING`, `platformLatest STRING`
   - ★uid 외의 개인정보는 넣지 않는다. 이메일·이름 금지.
2. **채우는 스케줄 쿼리** — BigQuery Scheduled Query, 일 1회 (04:00 KST 권장), `WRITE_TRUNCATE`
   - 소스: `marblo_telemetry.events`, `WHERE JSON_VALUE(metadata,'$.accountUserId') IS NOT NULL`
   - 그룹: `accountUserId`
3. **크로스리전 복사** — BigQuery Data Transfer Service → **Dataset Copy**
   - Source: `marblo-2253d:marblo_join_us` (US)
   - Destination: `marblo-2253d:marblo_join_kr` (asia-northeast3)
   - 스케줄: 일 1회, 위 스케줄 쿼리보다 **뒤에** (예: 05:00 KST)
   - Overwrite destination table: ON
   - 필요 API: `bigquerydatatransfer.googleapis.com` 활성화
4. **조인은 서울에서** — `marblo_join_kr.account_activation` ⋈ `analytics_543991508.events_*`

**검증**: 3 완료 후 서울 리전에서 `SELECT COUNT(*) FROM marblo-2253d.marblo_join_kr.account_activation` 가 US 원본과 같은 행수를 반환하면 성공.

**신선도 한계(명시)**: 이 파이프라인은 D+1 이다. GA4 일별 export 자체가 D+1 이므로 조인 결과는 **최대 D+2** 지연. 실시간 대시보드용이 아니라 주간 채널 성과 판정용이다. 실시간이 필요하면 GA4 스트리밍 export(`events_intraday_*`)를 켜야 하는데, 지금 볼륨(하루 ~160 이벤트)에선 불필요.

---

## 3. 조인 키 정리 — 무엇이 무엇과 붙는가

| 키                          | 웹에 있나            | 앱에 있나                                      | 조인 가능?                        |
| --------------------------- | -------------------- | ---------------------------------------------- | --------------------------------- |
| `user_pseudo_id` (GA4 쿠키) | 예                   | **아니오**                                     | ✗ 영원히 불가                     |
| `clientId` (앱 설치 UUID)   | 아니오               | 예 (`events.userId`)                           | ✗ 웹에 존재하지 않음              |
| **Firebase `uid`**          | 로그인 시            | 예 (`metadata.accountUserId`)                  | **✓ 옵션 A**                      |
| **email**                   | 웨이트리스트/가입 시 | 아니오(BQ 엔 없음) — Firestore `users` 에 있음 | **✓ 옵션 A′** (email→uid 로 우회) |
| 다운로드 토큰               | 발급하면             | 보고하면                                       | △ 옵션 B (미구현)                 |

★`clientId ≠ user_pseudo_id` 는 우연이 아니라 설계다. 둘 다 익명 키지만 서로 다른 네임스페이스이며, 이걸 억지로 붙이려는 시도(예: 시간창 매칭)는 **하지 말 것** — 오탐이 구조적이고 검증 불가능하다. 익명끼리는 **집계 대사(reconcile)만** 한다(§7-1).

---

## 4. 옵션 A — GA4 `user_id` = Firebase uid

### 4-1. 무엇이 가능해지나

GA4 가 `user_id` 를 알면 BQ export 의 `user_id` 컬럼이 채워지고, `users_YYYYMMDD` 테이블이 생성된다. 그러면:

- 한 사람의 **페이지뷰 단위 여정**(어떤 글 → 어떤 CTA → 다운로드)과 앱 활성화가 연결된다
- GA4 콘솔 자체에서 **교차기기(cross-device)** 리포팅이 된다(보고 ID = blended)
- 다운로드 이전의 세션들까지 소급 귀속된다 (GA4 는 user*id 설정 시점 이후만 연결하지만, 같은 `user_pseudo_id` 를 통해 그 브라우저의 이전 세션은 `pseudonymous_users*\*` 로 이어붙일 수 있음)

### 4-2. 웹 변경 지점 (설계만 — 코드는 별도 티켓)

| 파일                                 | 변경                                                                                                                        | 주의                                                                                                                                                                               |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/GoogleAnalytics.tsx` | `onAuthStateChanged` 구독 추가. 로그인 상태면 `gtag('config', ID, { user_id: uid })`, 로그아웃 시 `user_id: null` 로 재설정 | ★`config` 는 **로그인 확정 후에** 다시 쏴야 한다. 초기 마운트 시엔 auth 가 아직 미확정이라 첫 `config` 에 uid 가 없다 — 이건 정상이며, 이후 `config` 가 세션에 user_id 를 부착한다 |
| `src/lib/gtag.ts`                    | `setUserId(uid \| null)` 헬퍼 추가 (단일 진입점)                                                                            | 기존 no-op 가드(`if (!GA_MEASUREMENT_ID) return`) 규약 유지                                                                                                                        |
| 로그인/가입 성공 지점                | **미호출 상태인 `trackLogin` / `trackSignUp` 실제 배선**                                                                    | 지금 정의만 있고 호출부 0곳. 이게 없으면 "웹 로그인"이 GA4 에 사건으로 존재하지 않음                                                                                               |
| `src/app/[locale]/download/page.tsx` | 다운로드 클릭 시 로그인 세션이 있으면 그 시점에 user_id 가 이미 붙어 있도록 보장                                            | 로그인 강제는 하지 말 것 — 전환율을 깎는다(§4-5)                                                                                                                                   |

★**PII 금지 규약 유지**: `gtag.ts` 헤더 주석대로 이벤트 파라미터에 email/이름/전화 금지. `user_id` 는 이벤트 파라미터가 아니라 GA4 의 전용 필드이고 Firebase uid 는 무의미 문자열(pseudonymous identifier)이라 Google 정책상 허용된다. **email 을 user_id 로 쓰면 정책 위반이다 — 반드시 uid.**

### 4-3. GA4 콘솔 스텝

1. **관리(Admin) → 데이터 표시 → 보고 ID (Reporting identity)** → **"블렌딩됨(Blended)"** 선택
   - 기본값은 기기 기반일 수 있음. 블렌딩됨이어야 user_id 가 리포트에 반영된다
2. **관리 → 데이터 표시 → 사용자 속성(User properties)** — 별도 등록 불필요
   - `user_id` 는 커스텀 속성이 아니라 GA4 예약 필드다. 코드에서 `config` 에 넣으면 자동 수집
3. **관리 → 데이터 스트림 → (Marblo Web) → 향상된 측정** — 현행 유지
4. **관리 → 제품 링크 → BigQuery 링크 → (기존 링크 편집)**
   - **"사용자 데이터 export 포함(Include user data export)"** 체크 확인 → `users_YYYYMMDD` 생성 조건
   - 이벤트 필터: 제외 이벤트 없음 확인
   - 빈도: 일별(Daily) 유지. **스트리밍은 켜지 말 것** — 현 볼륨에서 비용만 는다
5. **DebugView 로 검증** — 로그인 후 `user_id` 가 붙은 이벤트가 보이는지
6. **BQ 검증** (D+1): `users_20260XXX` 테이블이 생성됐는지 + `user_id` 채움률

### 4-4. 조인 쿼리 (Phase 0 완료 후, 서울 리전에서 실행)

```sql
-- 유입채널·국가 → 앱 활성화 귀속 (식별 코호트 한정)
WITH web AS (
  SELECT
    user_id                                    AS uid,
    MIN(event_timestamp)                       AS first_seen_us,
    ANY_VALUE(geo.country)                     AS web_country,
    ANY_VALUE(traffic_source.source)           AS src,
    ANY_VALUE(traffic_source.medium)           AS medium,
    ANY_VALUE(traffic_source.name)             AS campaign,
    COUNTIF(event_name = 'download')           AS download_clicks
  FROM `marblo-2253d.analytics_543991508.events_*`
  WHERE user_id IS NOT NULL
  GROUP BY uid
)
SELECT
  w.src, w.medium, w.campaign, w.web_country,
  COUNT(*)                                     AS identified_visitors,
  COUNTIF(w.download_clicks > 0)               AS downloaded,
  COUNTIF(a.firstRunAt   IS NOT NULL)          AS installed,
  COUNTIF(a.firstLoginAt IS NOT NULL)          AS logged_in,
  COUNTIF(a.activeDays  >= 3)                  AS activated_3d
FROM web w
LEFT JOIN `marblo-2253d.marblo_join_kr.account_activation` a
  ON a.accountUserId = w.uid
GROUP BY 1,2,3,4
ORDER BY identified_visitors DESC
```

`LEFT JOIN` 인 게 중요하다 — 조인 실패는 **"활성화 안 함"이 아니라 "모름"**이다. 이 둘을 섞으면 채널 성과를 체계적으로 과소평가한다.

### 4-5. ★기대 커버리지 — 정직하게

조인되는 모집단 = **(웹에서 로그인한 적 있음) ∩ (앱에서 로그인 성공함)**.

현 실측으로 곱해 보면:

| 단계              | 31일 실측       | 비고                                                                      |
| ----------------- | --------------- | ------------------------------------------------------------------------- |
| 웹 방문자         | 554             | GA4 distinct user_pseudo_id                                               |
| 그중 웹 로그인    | **~0 (미계측)** | 다운로드 페이지·웨이트리스트 모두 무로그인. 로그인 사건 자체가 계측 안 됨 |
| download 클릭     | 26명            |                                                                           |
| 앱 first_run 도달 | 10 설치         | 클릭 대비 38%                                                             |
| 앱 login_success  | 6 설치          | 설치 대비 60%                                                             |
| BQ 식별 계정      | **1**           | 오너 본인                                                                 |

**옵션 A 만 심었을 때의 기대 조인율 ≈ 0%.** 이유는 배관이 아니라 동선이다 — 다운로드하는 사람이 그 시점에 웹 로그인 상태일 이유가 없다.

옵션 A 가 의미를 갖는 전제조건:

1. 웹에 **로그인해야 할 이유**가 생긴다 (구독 관리, 베타 승인 확인, 강의 수강 등) — 이건 제품 결정이지 계측 결정이 아니다
2. 또는 다운로드 전에 식별 모먼트를 끼운다 (다운로드 게이팅) — **권장하지 않는다**. 26명 표본에서 게이팅은 전환을 확실히 깎고, 측정하려는 대상을 측정 행위가 파괴한다
3. 앱 로그인 성공률이 유지된다 — 현재 설치 10 → 로그인 6 (60%). **로그인 실패자는 BQ 에 존재조차 안 한다**(§1-2 flush 한계)

즉 **옵션 A 는 "지금 답을 주는 도구"가 아니라 "웹 로그인이 제품상 의미를 갖게 됐을 때를 위한 배관"**이다. 배관 자체는 싸므로(웹 파일 3~4곳) Phase 2 로 깔아두되, **이걸로 이번 분기 채널 판단을 하겠다는 계획은 세우면 안 된다.**

---

## 5. ★옵션 A′ — 유입맥락 스탬프 + email→uid 조인 (권장, Phase 1)

옵션 A 의 커버리지가 0 인 이유는 "GA4 세션과 uid 를 묶어야 한다"고 전제했기 때문이다. 그런데 사장님 질문("어느 채널로 들어온 사람이 실제로 앱을 쓰나")은 **GA4 세션 없이도** 답할 수 있다.

### 5-1. 아이디어

우리에겐 이미 **email 을 남기는 식별 모먼트가 31일에 56건**(웨이트리스트) 있다. 그 순간에 **유입맥락을 함께 저장**하면, 나중에 `email → Firebase uid → accountUserId` 로 앱 활성화와 붙는다. GA4 도, 크로스리전 조인도 필요 없다.

```
웹 방문 (utm/referrer/국가)
   ↓  브라우저가 이미 알고 있음
웨이트리스트 제출  ──▶ Firestore waitlist/{id}
   { email, locale, source,            ← 현재
     utmSource, utmMedium, utmCampaign, ← 추가
     referrer, landingPath,             ← 추가
     country }                          ← 추가 (서버측 IP geo)
   ↓  email
Firebase Auth users/{uid}.email
   ↓  uid
marblo_telemetry.events.metadata.accountUserId
   ↓
활성화 (first_run / login / project / spawn / activeDays)
```

### 5-2. 왜 이게 더 나은가

|                      | 옵션 A                          | 옵션 A′                                                    |
| -------------------- | ------------------------------- | ---------------------------------------------------------- |
| 크로스리전 조인 필요 | 예 (Phase 0 필수)               | **아니오** — Firestore↔BQ, 둘 다 US 경유 가능              |
| 웹 로그인 필요       | 예                              | **아니오**                                                 |
| 현 실측 커버리지     | ~0%                             | **웨이트리스트 56명 전원**이 후보                          |
| 얻는 것              | 페이지뷰 단위 전체 여정         | 채널·국가 → 활성화 귀속 (질문의 핵심)                      |
| 못 얻는 것           | —                               | 다운로드만 하고 웨이트리스트 안 쓴 사람, 세션 내 행동 경로 |
| 구현 규모            | 웹 4곳 + 콘솔 + 리전 파이프라인 | **웹 1~2곳 + 룰 1곳**                                      |

### 5-3. 변경 지점 (설계)

| 위치                                                         | 변경                                                                                                                                                                                                |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/BetaTester50SignupForm.tsx` (및 웹가입 경로) | `addDoc` payload 에 `utmSource/utmMedium/utmCampaign/referrer/landingPath` 추가. 값은 첫 랜딩 시 `sessionStorage`/쿠키에 캡처한 것을 사용 (제출 페이지의 URL 이 아니라 **최초 랜딩**의 것이어야 함) |
| 신규 얇은 캡처 유틸                                          | 최초 랜딩에서 `document.referrer` + `searchParams` 의 utm\_\* 를 1회 저장. 이미 값이 있으면 덮어쓰지 않음(first-touch)                                                                              |
| Firestore 룰                                                 | ★**`waitlist` create 룰의 `hasOnly` 목록에 신규 필드 추가 필수**                                                                                                                                    |
| 국가                                                         | 클라 IP geo 는 신뢰 불가 → **서버(Functions onCreate 훅)에서 요청 IP 또는 CDN geo 헤더로 스탬프**하는 편이 낫다. 클라가 보낸 국가는 위조 가능                                                       |

> ★⚠️ **재발 방지 경고**: 과거에 파운더/베타 공개신청이 **전면 실패**한 적이 있다. 원인은 폼이 `marketingConsent` 3필드를 추가했는데 Firestore 룰의 `hasOnly` 를 안 맞춰서 전건 `permission-denied` 가 난 것이었다. 증상은 사용자에게 "잠시 후 다시 시도" 로만 보인다. **이 티켓의 후속 구현은 폼 필드 추가와 룰 갱신을 같은 PR 에 묶고, 룰 테스트가 폼의 실제 payload 를 검증해야 한다.**

### 5-4. 조인 쿼리 (개념)

```sql
-- waitlist(Firestore→BQ 내보내기 또는 Functions 집계) ⋈ 앱 활성화
SELECT
  w.utmSource, w.utmMedium, w.utmCampaign, w.country,
  COUNT(*)                            AS leads,
  COUNTIF(u.uid IS NOT NULL)          AS became_account,
  COUNTIF(a.firstRunAt IS NOT NULL)   AS installed,
  COUNTIF(a.activeDays >= 3)          AS activated_3d
FROM waitlist w
LEFT JOIN users u              ON LOWER(u.email) = LOWER(w.email)
LEFT JOIN account_activation a ON a.accountUserId = u.uid
GROUP BY 1,2,3,4
```

email 정규화 주의: 소문자화 + 공백 트림. Gmail 의 `.`/`+alias` 정규화는 **하지 말 것**(다른 사람을 합칠 위험 > 얻는 이득).

### 5-5. A′ 의 한계 (정직히)

- 웨이트리스트를 안 쓴 다운로더는 여전히 미귀속. 31일 기준 다운로드 26명 vs 리드 53명 — **겹치는 정도를 아직 모른다**
- first-touch 만 잡는다. 멀티터치 기여 분석은 불가(현 규모에선 불필요)
- 웨이트리스트 이메일 ≠ 앱 로그인 이메일인 경우 조인 실패 (Google 로그인은 보통 같지만 보장 없음)
- 소급 불가 — 기존 56건에는 utm 이 없다. **오늘 심어야 다음 달에 답이 나온다**

---

## 6. 옵션 B — 다운로드 attribution 토큰 (지금은 비권장)

### 6-1. 아이디어

웹이 다운로드 시 `{utm, 채널, 국가, ts}` 를 담은 단명 토큰을 발급 → 설치프로그램/앱이 `first_run` 에 그 토큰을 보고 → **웹 로그인 없이도** 채널/국가 귀속.

### 6-2. 우리 토폴로지에서 왜 비싼가

`download/page.tsx` 가 **GitHub 릴리스 직링크**이고 바이너리는 **서명·공증**되어 있다. 그래서 표준 구현 3가지가 다 막힌다:

| 구현 형태                                                                                                          | 우리 상황에서의 비용                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **(a) 바이너리에 토큰 임베드** (파일명/리소스에 스탬프)                                                            | ★**불가에 가깝다.** 사용자별 파일을 만들면 macOS 서명·공증(notarization)을 사용자마다 다시 해야 한다. 릴리스 자산명도 updater 피드에 박혀 있다. 배포 토폴로지를 통째로 갈아야 함 |
| **(b) 다운로드 프록시 도입** (우리 서버 경유 → 토큰 발급 → GitHub 리다이렉트)                                      | GitHub 직링크를 우리 엔드포인트로 교체. 토큰은 여전히 바이너리 밖에 있어서 **앱이 어떻게 받느냐**가 미해결로 남음                                                                |
| **(c) 클립보드/딥링크 핸드오프** (다운로드 시 토큰을 클립보드나 `marblo://` 딥링크로 전달, 앱이 first_run 에 읽음) | 구현 가능하나 **유실률이 높고 조용히 실패**한다. 클립보드 읽기는 OS 권한/프라이버시 이슈. 사용자가 다운로드→설치 사이에 클립보드를 쓰면 끝                                       |

### 6-3. 가치 대비 판정

- 얻는 것: 익명 다운로더까지 **채널·국가** 귀속 (유저 단위 신원은 여전히 못 얻음 — 토큰은 채널 라벨이지 사람이 아니다)
- 현 규모: 다운로드 26명/월. 여기에 (b)+(c) 를 붙이는 비용은 **A′ 전체보다 크다**
- A′ 가 같은 질문(채널→활성화)의 상당 부분을 **소급 위험 없이** 답한다

**판정: 지금은 하지 않는다.** 재검토 트리거를 명시한다:

> 옵션 B 재검토 조건 — (1) 월 다운로드 300건 초과, **또는** (2) 유료 광고 집행 시작(채널별 CAC 계산이 돈에 직결될 때), **또는** (3) A′ 커버리지가 다운로드의 30% 미만으로 측정될 때.
> 재검토 시엔 (c) 가 아니라 **(b) 다운로드 프록시 + 앱 first_run 의 "어디서 오셨나요" 1문항**(자기보고) 조합이 비용 대비 현실적이다. 자기보고는 부정확하지만 **정직하게 부정확**하고, 클립보드처럼 조용히 틀리지 않는다.

---

## 7. 유입채널·국가별 분석 — 무엇이 언제 가능한가

### 7-1. 항상 가능 (조인 불필요, 지금 당장)

**웹측 (GA4 단독)** — 이미 데이터가 있다:

- 채널별 방문 → generate_lead → download 전환율
- 국가별 방문 → download 전환율 (§1-1 표가 그 예시. **해외 130명 / 다운로드 0** 이 이미 나와 있다)
- 캠페인별 성과 (utm 이 붙어 있는 한)

**앱측 (marblo_telemetry 단독)**:

- 설치 → 로그인 → 프로젝트 연결 → 활성화 (단, §1-2 flush 한계로 "로그인 성공한 사람" 편향)

**두 개를 나란히 놓는 집계 대사(reconcile)**:

```
GA4 download 26명 (31일)  vs  앱 first_run 10 설치 (31일)  →  ~38%
```

★이건 **같은 사람을 잇는 게 아니라 규모를 대조**하는 것이다. 개인 단위 주장을 하면 안 된다(`clientId ≠ user_pseudo_id`). 그래도 "다운로드 대비 설치 완주율" 같은 큰 구멍은 이걸로 잡힌다 — 실제로 62% 가 클릭 후 실행에 도달하지 않았다는 신호가 이미 나온다.

### 7-2. 조인해야 가능

- 채널/국가별 **활성화율**(3일 사용, 프로젝트 연결, 에이전트 스폰) → A′ 또는 A 필요
- 채널별 **LTV/전환** → A′ 필요
- 개인 여정 리플레이 → A 필요

### 7-3. UTM 위생 (선행 과제)

first_visit 의 64%가 `(direct)/(none)` 이다. youtube 104명 / threads 57명은 referral 로 잡히긴 하지만, **어느 영상·어느 게시물인지는 모른다.** 채널 분석의 절반은 조인 설계가 아니라 **링크에 utm 을 붙이는 운영 습관**이다.

권장 컨벤션 (조인 없이도 즉시 효과):

```
https://marblo.app/?utm_source=youtube&utm_medium=video&utm_campaign=<영상슬러그>
https://marblo.app/?utm_source=threads&utm_medium=social&utm_campaign=<게시물날짜>
```

`(direct)` 356명 중 상당수는 실제로는 "utm 없는 링크"일 것이다. 이걸 안 고치면 어떤 조인 설계를 해도 상류가 흐리다.

### 7-4. 앱측 국가 — 보완재이지 대체재가 아니다

앱은 현재 국가/로케일을 **아무것도 수집하지 않는다** (`navigator.language`, `Intl.DateTimeFormat().resolvedOptions().timeZone`, `app.getLocale()` 사용처 0곳).

추가한다면:

| 방법                             | 정확도 | 비고                                                                        |
| -------------------------------- | ------ | --------------------------------------------------------------------------- |
| OS 로케일 (`ko-KR`)              | 중     | 재외 한국인이 KR 로 잡힘. 언어 설정일 뿐 위치가 아님                        |
| 타임존 (`Asia/Seoul`)            | 중상   | 로케일보다 위치에 가까움. VPN/여행에 취약                                   |
| 서버측 IP geo (callable 요청 IP) | 상     | 가장 정확하나 **IP 는 개인정보** — 국가 코드만 파생하고 IP 원문은 저장 금지 |

**권고**: 타임존 파생 국가(예: `Asia/Seoul → KR`)를 `app:first_run` metadata 에 추가하는 정도가 비용 대비 적절. **단 "국가별 분석의 정답은 GA4 geo"** 이고, 앱측 값은 조인이 안 되는 익명 설치의 대략적 분포 파악용 보완재로만 쓴다. 두 값이 다를 때 GA4 를 신뢰한다.

---

## 8. 프라이버시 (PIPA)

### 8-1. ★현재 갭: GA4 가 동의 없이 로드된다

`layout.tsx:248` 에서 `<GoogleAnalytics />` 는 `<Suspense>` 로 감싸져 **무조건** 마운트된다. `PrivacyConsentGate` 는 같은 레이아웃의 별개 컴포넌트이며 GA4 로딩을 게이팅하지 않는다.

`privacyConsent.ts` 에는 이미 `overseasTransfer`(PIPA 제28조의8 국외이전 별도 동의) 플래그가 있고 가입·결제 맥락에서 수집된다. 그런데 **GA4 는 그 동의와 무관하게 로드되어 Google(국외)로 데이터를 보낸다.**

지금은 PII 를 안 보내므로 위험이 낮지만, **옵션 A 로 `user_id = uid` 를 심는 순간 성격이 바뀐다** — 식별자를 국외로 보내는 행위가 된다.

**권고 (옵션 A 의 전제조건으로 못 박을 것)**:

- **`user_id` 전송은 `overseasTransfer` 동의가 확인된 세션에서만.** 동의 없으면 익명 GA4 는 계속 돌되 user_id 는 붙이지 않는다
- GA4 **Consent Mode v2** 도입 검토 (`ad_storage`/`analytics_storage` 기본 denied → 동의 시 granted). 광고 집행 시작하면 사실상 필수
- 개인정보처리방침에 GA4 명시 (`GA4-SETUP-USER-STEPS.md` ⑥ 이 이미 지적. **미완료로 보임 — 확인 필요**)

### 8-2. uid 는 식별자다 — 비식별 원칙과의 관계

`marblo_telemetry.events` 는 "비식별·상시 수집"을 원칙으로 설계됐다. 클라이언트 `anonymize()` 가 uid/email 을 선삭제하고, 행 키는 익명 `clientId` 다.

그런데 **서버가 `metadata.accountUserId` 로 uid 를 이미 넣고 있다**(PR #806, 어드민 dedup 목적). 즉 **원칙은 이미 반쯤 깨져 있고, 문서화되지 않았다.**

**권고**:

- `events` 테이블을 "완전 비식별"이라고 표현하는 서술을 **정정**한다 (`telemetryService.ts` 주석은 이미 정확 — "de-identified row key + 서버측 accountUserId"). 사용자 대면 문구(처리방침/설정 화면)가 실태와 맞는지 재검토
- `accountUserId` 접근을 **BigQuery IAM 으로 분리** — `marblo_training` 을 별도 데이터셋으로 나눈 것과 같은 논리. 최소한 어드민 롤로 제한
- **보존기간을 명시**: GA4 는 14개월(설정 권장), 앱 events 는 현재 무기한. uid 가 붙은 이상 보존정책이 필요하다

### 8-3. email 조인 (옵션 A′) 의 동의 근거

- 웨이트리스트는 `collectionUse` + `overseasTransfer` 동의를 이미 받는다 (`REQUIRED_FLAGS`)
- email→uid 조인은 **내부 분석 목적**이며 제3자 제공이 아니다 → 기존 동의 범위 내로 판단
- 단 **utm/referrer 추가 저장**은 수집 항목 추가다. 처리방침의 수집항목 목록에 반영 여부 확인 필요
- ★조인 결과물(`account_activation`)에 **email 을 넣지 않는다** — uid 만. email 은 Firestore 에 두고 조인 시점에만 매핑

### 8-4. 리전 이전 (Phase 0) 의 개인정보 관점

R1(US → asia-northeast3 복사)은 uid 를 **한국으로 가져오는** 방향이다. R2/R4 의 반대 방향보다 낫다. 다만 복사 대상 테이블에 uid 가 들어가므로:

- `account_activation` 스키마에 **uid 외 개인정보 금지** (§2-3 스키마 그대로)
- Data Transfer Service 의 서비스 계정 권한을 해당 데이터셋으로 한정

---

## 9. 검증 — 실데이터가 없으므로 합성으로

★현재 distinct `accountUserId` = 1 (오너)이고 웹 로그인 계측이 0 이라, **"조인이 실제로 되는지"를 프로덕션 데이터로 확인할 수 없다.** 배관을 깔고 "됐겠지" 하면 몇 주 뒤에 빈 테이블을 보게 된다. 그래서 각 Phase 마다 **오너 본인 계정으로 엔드투엔드 1건**을 통과시켜 확인한다.

### Phase 0 검증

```sql
-- 서울 리전에서 실행. 행수가 US 원본과 같아야 한다.
SELECT COUNT(*) FROM `marblo-2253d.marblo_join_kr.account_activation`;
```

### Phase 1 (A′) 검증

1. 시크릿 창에서 `https://marblo.app/?utm_source=test&utm_medium=verify&utm_campaign=join-poc` 접속
2. 웨이트리스트에 오너 이메일 제출
3. Firestore `waitlist` 문서에 `utmSource=test` 가 있는지 확인 — **없으면 룰 `hasOnly` 드리프트 의심** (§5-3 경고)
4. 조인 쿼리에서 그 이메일이 `became_account=1` 로 나오는지

### Phase 2 (A) 검증

1. 웹 로그인 → GA4 **DebugView** 에서 이벤트에 `user_id` 부착 확인
2. D+1: `users_20260XXX` 테이블 생성 확인
   ```sql
   SELECT COUNT(*) c, COUNTIF(user_id IS NOT NULL) with_uid
   FROM `marblo-2253d.analytics_543991508.events_*`
   WHERE _TABLE_SUFFIX = FORMAT_DATE('%Y%m%d', CURRENT_DATE('Asia/Seoul') - 1);
   ```
   `with_uid > 0` 이면 성공. **오늘 기준 이 값은 0 이다** — 이게 회귀 기준선이다.

### 상시 모니터링 (권장)

```sql
-- GA4 export 신선도. 오늘-1 이 없으면 export 가 멈춘 것
SELECT MAX(_TABLE_SUFFIX) latest FROM `marblo-2253d.analytics_543991508.events_*`;
```

★**지금 이 값은 `20260807` 이고 오늘은 `20260809` 다.** 일별 export 는 통상 D+1 이므로 `20260808` 이 있어야 한다. **export 지연인지 링크 이상인지 확인이 필요하다** — 이 문서 범위 밖이지만 후속 확인 항목으로 남긴다.

---

## 10. `pWSnJeQN` 과의 경계

| 이 문서 (`UzvcqHMdX5RYtOs048SB`)        | `pWSnJeQN` (앱 KPI)                           |
| --------------------------------------- | --------------------------------------------- |
| web-app **경계** — 조인 키, 리전, 귀속  | 앱 **내부** 계측 갭 (멀티에이전트, 10분 성공) |
| GA4 / BQ export / 크로스리전 파이프라인 | `marblo_telemetry` 이벤트 스키마 확장         |
| 채널·국가 귀속                          | 활성화 정의 자체                              |

**접점 1개**: 이 문서의 `account_activation` 슬림 테이블(§2-3)이 소비하는 "활성화" 정의는 `pWSnJeQN` 이 확정한다. 여기선 컬럼 자리(`firstProjectAt`/`firstAgentSpawnAt`/`activeDays`)만 잡아두고 **정의는 그 티켓을 따른다.**

**접점 2개**: §1-2 의 flush 한계(로그인 실패자의 설치가 BQ 에 없음)는 앱측 계측 문제다. 이 문서는 커버리지 계산에 반영만 하고 해결은 `pWSnJeQN` 쪽에 맡긴다.

---

## 11. 실행 체크리스트

**Phase 0 — 리전 (선행, 이거 없으면 A 무의미)**

- [ ] `bigquerydatatransfer.googleapis.com` 활성화
- [ ] US 데이터셋 `marblo_join_us` + 테이블 `account_activation` 생성
- [ ] 일 1회 Scheduled Query (04:00 KST, WRITE_TRUNCATE)
- [ ] Dataset Copy transfer: `marblo_join_us`(US) → `marblo_join_kr`(asia-northeast3), 05:00 KST
- [ ] 서울 리전에서 행수 일치 검증

**Phase 1 — 옵션 A′ (권장, 최우선 가치)**

- [ ] first-touch utm/referrer 캡처 유틸 (최초 랜딩 1회, 덮어쓰기 금지)
- [ ] 웨이트리스트/웹가입 payload 에 utm·referrer·landingPath 추가
- [ ] ★**Firestore 룰 `hasOnly` 동시 갱신 + 실 payload 룰 테스트** (전면 실패 재발 방지)
- [ ] 서버측(Functions 훅) 국가 스탬프 — 국가 코드만, IP 원문 저장 금지
- [ ] email→uid→activation 조인 쿼리 저장
- [ ] 처리방침 수집항목에 utm/referrer 반영 확인
- [ ] 오너 계정으로 엔드투엔드 1건 통과 (§9)

**Phase 1.5 — UTM 위생 (운영, 코드 아님)**

- [ ] 유튜브·스레드 링크에 utm 컨벤션 적용 (§7-3)
- [ ] 해외 130명 / 다운로드 0 원인 점검 (영어 랜딩·다운로드 동선)

**Phase 2 — 옵션 A (배관, 급하지 않음)**

- [ ] GA4 보고 ID = 블렌딩됨
- [ ] BQ 링크에 "사용자 데이터 export 포함" 확인
- [ ] `gtag.ts` 에 `setUserId` 헬퍼 + `GoogleAnalytics.tsx` 에 auth 구독
- [ ] **미배선된 `trackLogin`/`trackSignUp` 실제 호출부 연결**
- [ ] ★`overseasTransfer` 동의 게이트로 user_id 전송 제한
- [ ] Consent Mode v2 검토
- [ ] DebugView + `users_*` 테이블 생성 검증

**옵션 B — 하지 않음.** 재검토 트리거는 §6-3.

**후속 확인 (범위 밖이지만 발견됨)**

- [ ] GA4 export 최신 테이블이 `20260807` — `20260808` 누락 원인 확인
- [ ] 개인정보처리방침에 GA4 명시 여부 (`GA4-SETUP-USER-STEPS.md` ⑥ 미완료 추정)
- [ ] `events` 테이블 "비식별" 서술 vs `accountUserId` 실태 정합 (§8-2)

---

## 부록 A. 이 문서의 수치를 재현하는 쿼리

```sql
-- A1. GA4 이벤트별 볼륨 + user_id 채움률  (asia-northeast3)
SELECT event_name, COUNT(*) c,
       COUNTIF(user_id IS NOT NULL) with_uid,
       COUNT(DISTINCT user_pseudo_id) users
FROM `marblo-2253d.analytics_543991508.events_*`
GROUP BY 1 ORDER BY c DESC;

-- A2. 국가별 방문/다운로드  (asia-northeast3)
SELECT geo.country, COUNT(DISTINCT user_pseudo_id) users,
       COUNTIF(event_name='download') dl
FROM `marblo-2253d.analytics_543991508.events_*`
GROUP BY 1 ORDER BY users DESC;

-- A3. 유입채널  (asia-northeast3)
SELECT traffic_source.source src, traffic_source.medium med,
       COUNT(DISTINCT user_pseudo_id) users
FROM `marblo-2253d.analytics_543991508.events_*`
WHERE event_name='first_visit'
GROUP BY 1,2 ORDER BY users DESC;

-- A4. 앱 퍼널  (US)
SELECT event, COUNT(*) c,
       COUNT(DISTINCT JSON_VALUE(metadata,'$.accountUserId')) accts,
       COUNT(DISTINCT userId) installs
FROM `marblo-2253d.marblo_telemetry.events`
WHERE timestamp >= '2026-07-08'
  AND event IN ('app:first_run','auth:login_success','auth:login_attempt','session:started')
GROUP BY 1 ORDER BY c DESC;

-- A5. accountUserId 주입 롤아웃 확인  (US)
SELECT DATE_TRUNC(DATE(timestamp), WEEK) wk, COUNT(*) rows_,
       COUNTIF(JSON_VALUE(metadata,'$.accountUserId') IS NOT NULL) with_acct
FROM `marblo-2253d.marblo_telemetry.events`
WHERE timestamp >= '2026-06-01'
GROUP BY 1 ORDER BY 1;
```

> 실행: `john.kim` ADC 로 BigQuery REST. `gcloud auth application-default print-access-token` → `POST /bigquery/v2/projects/marblo-2253d/queries`.
> ★A1~A3 과 A4~A5 는 **리전이 달라 한 쿼리로 합칠 수 없다** — 그게 이 문서의 §2 다.
