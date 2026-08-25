# 통합 뷰 `v_install_unified` — 설치 1행에 채널·활성화·리텐션·결제를 붙인다

티켓 `L8RvsReu6Vch5eNYYCJR`. 화면 없음. **정의 문서 + 뷰 두 벌**이다.
선행: `install-attribution-ga-key-join-2026-08-24.md`(PR #1195, 조인 키 공간).

> 사장님 지시: "ga4랑 텔레메트리 결합 통합 빅쿼리 테이블 만들어달라고 했는데
> 누락된 것 같다. 계획 짜서 제대로 진행해줘. **스키마랑 계획대로 정의해서**."

이 문서가 그 "정의" 다. 읽는 순서는 §1(무엇이 없었나) → §2(알갱이) →
§3(스키마) → §4(NULL 규약) → §5(조인 경로) → §6(지금 무엇이 채워지고 무엇이
안 채워지나) → §7(검증) → §8(안 하는 것).

---

## 1. 무엇이 없었나 — 그리고 #906 은 "깨진" 게 아니다

`marblo_telemetry` 에 개체가 14개 있는데 **결합 층이 하나도 없었다.**
`ga4_first_touch_current` 는 `ga4_first_touch` 위의 단일 뷰지 결합이 아니다.
그래서 "어느 캠페인이 결제로 이어졌나" 를 물으면 사람이 매번 6개 표를 손으로
조인해야 했고, 조인 키가 갈려 있어서 그 손조인이 **0행을 돌려줬다.**

### 1-1. 경위 — 조인은 깨진 게 아니라 애초에 SQL 에 없었다

티켓은 "#906 완료기준에 '조인 쿼리 실행' 이 있었는데 지금 0건이다. 나중에
깨졌는지 확인하라" 고 했다. 확인했고, **답은 '깨진 적 없다'** 다.

| 시점 | PR | 무슨 일 | 조인 상태 |
| --- | --- | --- | --- |
| 2026-08-10 | #906 | `countryFunnel.ts` — GA4(서울)와 원장(US)을 **콜러블 메모리 안**에서 합친다. 양쪽 다 **원시** 식별자(`user_pseudo_id` ↔ `gaClientId`). | ✅ 돈다 (오늘도) |
| 2026-08-10 | #915 | `analyticsPseudonym.ts` — 가명화 도입 | 영향 없음 |
| 2026-08-21 | #1075 | `analytics_identity.ga_key` = **가명** | — |
| 2026-08-21 | #1111 | `ga4_first_touch` — GA4 를 **SQL 로 읽을 수 있는 표**로 US 에 처음 놓는다. 실리는 키는 **가명 `gaKey` 뿐**(원시는 US 로 넘기지 않는다) | ⚠️ 여기서부터 "당연해 보이는" SQL 조인이 0행 |
| 2026-08-24 | #1195 | 원장에 `gaKeyHmac` 추가 — 같은 공간의 조인키 | ✅ SQL 조인 가능(배포 후) |

즉 #906 이 만든 조인은 **SQL 조인이 아니라 메모리 조인**이었다. 그래서 그
완료기준은 정직하게 통과했고, 지금도 통과한다. 실측으로 증명했다 —
서울 리전 GA4 export 에 원장의 원시 `gaClientId` 5개 중 **4개가 실재**한다:

```
907527541.1783036649   → GA4 있음 (direct/(none)/(direct), 1405 events, 첫날 2026-07-08)
449855837.1783486079   → GA4 있음 (direct/(none)/(direct),  215 events, 2026-07-08)
1235417648.1783036732  → GA4 있음 (direct/(none)/(direct),  199 events, 2026-07-08)
1650975648.1787411940  → GA4 있음 (direct/(none)/(direct),   13 events, 2026-08-23)
1548514790.1787533819  → GA4 없음
```

**깨진 것은 #1111 이 SQL 표면을 만들면서 키 공간이 갈렸다는 사실이 아무 데도
기록되지 않은 것**이다. 에러가 안 나므로 표만 보면 "유입이 없네" 로 읽힌다.
그래서 이 뷰는 조인 실패를 **사유 컬럼으로 표면화**한다(§4).

### 1-2. ★"88%" 는 브라우저 3대 중 2대다 — 큰 숫자를 큰 표본으로 읽지 마라

PR #1195 는 배포 전 증명으로 `analytics_identity.ga_key ↔ ga4_first_touch.gaKey`
조인이 **550행 중 483행(88%)** 붙는 것을 보였다. 그 숫자는 맞다. 그런데:

```
analytics_identity 의 distinct ga_key = 3개
  ga_fe1c08…  477행  브리지에 있음   (direct)/(none)/(direct)
  ga_6a841f…   67행  브리지에 없음   ← no_ga4_row
  ga_3103a9…    6행  브리지에 있음   (direct)/(none)/(direct)
```

**483 = 477 + 6, 즉 브라우저 3대 중 2대다.** 행 단위로는 88% 지만 표본은 n=3 이다.
같은 함정이 원장에도 있다 — `install_attribution` 631행의 distinct `gaClientId` 가
**5개**뿐이다(539 / 69 / 16 / 6 / 1). 설치 480건이 **한 브라우저**에서 나온다.

그래서 이 뷰는 `gaKeyInstallCount` 컬럼을 둔다 — 그 값이 480 이면 그 행들을
480명으로 읽으면 안 된다는 사실이 **표 안에** 보인다. 주석이 아니라 컬럼이다.

---

## 2. 알갱이(grain) — **설치 1행**. 근거를 적는다

`analytics_install_profile.install_key` 당 정확히 1행. 현재 **608행**.

**왜 설치인가:**

1. **시간 순서가 접힌다.** 채널은 설치 *전에* 정해지고(웹 방문 → 다운로드),
   활성화·리텐션·결제는 그 *뒤에* 온다. 한 설치에 대해 앞뒤가 한 줄로 접힌다.
2. **사람 단위로 잡으면 진실이 하나로 안 떨어진다.** 1인 다기기면 기기마다
   채널이 다르고, "이 사람의 채널" 이 정의되지 않는다. 억지로 정하면(최초 설치
   우선 등) 그 규칙이 표에 안 보이고 다음 사람이 다르게 읽는다.
3. **분모가 이미 설치다.** 광고 성과의 분모는 설치(다운로드 완주)지 계정이
   아니다. 계정은 설치 뒤의 전환 단계일 뿐이다.
4. **결제만 사람 단위인데, 그건 접을 수 있다.** 설치 → 사람 → 결제로 내려가면
   결제를 설치에 귀속할 수 있다. 반대 방향(사람 → 설치)은 다기기에서 갈린다.

**반대 근거(기록해 둔다):** 재설치·다기기에서 **한 사람이 여러 행**이 된다.
그래서 설치 수를 사람 수로 읽으면 부풀려진다. 위 실측이 그 극단이다 — 480 설치가
브라우저 1대다. 이 위험은 `gaKeyInstallCount`(같은 브라우저 설치 수)와
`personLinkCount`(같은 설치에 붙은 사람 수)로 **표에 드러낸다.** 알갱이를 바꾸는
대신 위험을 컬럼으로 노출하는 쪽을 골랐다.

---

## 3. 스키마

### 3-1. `marblo_telemetry.v_install_unified` — 608행, 결제 없음

컬럼은 **camelCase**. 원천 컬럼명이 snake_case 여도 뷰에서 접는다.

| 컬럼 | 타입 | 원천 | 뜻 |
| --- | --- | --- | --- |
| **식별** ||||
| `installKey` | STRING | `analytics_install_profile.install_key` | 앱이 만든 익명 설치 UUID. ★uid·이메일 아님 |
| `idScheme` | STRING | 〃 `.id_scheme` | `uuid36` / `legacy_uid28` / `unknown` |
| `gaKeyHmac` | STRING | `install_attribution.gaKeyHmac` | 채널 조인키(가명, `ga_`+24). ★원시로 조인 금지 |
| `gaKeyInstallCount` | INT64 | 원장 집계 | 이 `gaKey` 를 공유하는 설치 수. **1이 아니면 재설치·개발루프를 의심하라** |
| `firstRunAt` | TIMESTAMP | 프로필 `.first_run_at` | 앱 최초 실행 |
| `linkedAt` | TIMESTAMP | 원장 `.linkedAt` | 웹→앱 링크백 시각 |
| `linkSource` | STRING | 원장 `.linkSource` | `app_first_run` |
| **채널 (GA4 first-touch)** ||||
| `channelSource` | STRING | `ga4_first_touch_current.source` | 매체 |
| `channelMedium` | STRING | 〃 `.medium` | |
| `channelCampaign` | STRING | 〃 `.campaign` | 캠페인명 |
| `channelContent` | STRING | 〃 `.content` | **소재(크리에이티브) 축** |
| `channelTerm` | STRING | 〃 `.term` | 검색 키워드 축 |
| `channelCountry` | STRING | 〃 `.country` | ★국가의 정본은 GA4 다(클라 값 안 받음) |
| `channelRegion` | STRING | 〃 `.region` | |
| `channelDevice` | STRING | 〃 `.deviceCategory` | |
| `channelLandingPage` | STRING | 〃 `.landingPage` | ★§6-3 주의 |
| `channelFirstVisitDate` | DATE | 〃 `.firstVisitDate` | ★§6-3 주의 — 진짜 최초방문이 아닐 수 있다 |
| `channelAttributionSource` | STRING | 〃 `.attributionSource` | `traffic_source` / `collected_traffic_source` / `(none)` |
| `hasGa4Row` | BOOL | 파생 | **GA4 행이 붙었나.** 조인 실패와 자연유입을 가르는 한 칸 |
| `channelMissingReason` | STRING | 파생 | **캠페인 축이 빈 이유.** NULL 이면 캠페인이 실재한다(§4) |
| **앱 원장 UTM (GA4 와 다른 축 — 섞지 않는다)** ||||
| `ledgerUtmSource` | STRING | 원장 `.utmSource` | 링크백 URL 이 직접 들고 온 값 |
| `ledgerUtmMedium` | STRING | 원장 `.utmMedium` | |
| `ledgerUtmCampaign` | STRING | 원장 `.utmCampaign` | |
| `ledgerUtmContent` | STRING | 원장 `.utmContent` | #1195 에서 신설 |
| `ledgerUtmTerm` | STRING | 원장 `.utmTerm` | #1195 에서 신설 |
| `ledgerReferrerHost` | STRING | 원장 `.referrerHost` | |
| `ledgerLandingPath` | STRING | 원장 `.landingPath` | |
| **활성화** ||||
| `firstSpawnAt` | TIMESTAMP | 프로필 `.first_spawn_at` | 첫 에이전트 스폰 |
| `firstCompletedAt` | TIMESTAMP | 프로필 `.first_completed_at` | 첫 완주 |
| `daysToFirstSpawn` | INT64 | 파생 | `firstRunAt`→`firstSpawnAt` 경과일 |
| `daysToFirstCompleted` | INT64 | 파생 | |
| `hasSpawned` | BOOL | 파생 | ★NOT NULL. 안 한 것(false)과 모르는 것을 가른다 |
| `activationMissingReason` | STRING | 파생 | `no_first_run` — 기준점이 없어 경과일을 못 센다 |
| **리텐션** ||||
| `firstActiveDay` | DATE | 프로필 `.first_active_day` | |
| `lastActiveDate` | DATE | 프로필 `.last_active_day` | |
| `observedDays` | INT64 | 프로필 `.observed_days` | 관측된 날 수 |
| `activeDaysTotal` | INT64 | 프로필 `.active_days` | |
| `activeDays7` | INT64 | `analytics_user_daily` 집계 | 첫 활동일 기준 D0~D6 중 활동일 수 |
| `activeDays14` | INT64 | 〃 | D0~D13 |
| `activeDays30` | INT64 | 〃 | D0~D29 |
| `retentionElapsedDays` | INT64 | 파생 | 첫 활동일로부터 오늘까지. **창이 아직 안 닫혔는지 판단용** |
| `retentionMissingReason` | STRING | 파생 | `no_daily_rows` — 일별 행이 하나도 없다 |
| **메타** ||||
| `appVersion` | STRING | 프로필 `.app_version` | |
| `platform` | STRING | 원장 `.platform` | |
| `buildChannel` | STRING | 원장 `.buildChannel` | `dev` / `prod` / NULL(표식 이전 앱) |
| `ftBuildChannel` | STRING | 프로필 `.ft_build_channel` | |
| `isDevInstall` | BOOL | 파생 | 둘 중 하나라도 `dev`. ★**기본 필터로 숨기지 않는다** |
| `builtAt` | TIMESTAMP | 프로필 `.built_at` | 프로필이 계산된 시각 |

### 3-2. `marblo_identity.v_install_unified_revenue` — 위 전부 + 결제

★**왜 데이터셋이 다른가.** 결제는 사람 축이고, 설치↔사람을 잇는 자리는 설계상
`marblo_identity.analytics_user_install` **하나뿐**이다(person-axis 설계 §4.2-5).
그 표는 `marblo_telemetry` 와 **IAM 이 다른** 데이터셋에 일부러 격리돼 있다.
결제 컬럼을 `marblo_telemetry` 뷰에 넣으면 텔레메트리 읽기 권한만 있는 사람이
뷰를 통해 링크표를 읽게 된다 — 이름만 다른 같은 방이 된다. 그래서 **결제가 붙은
완전체는 링크표가 사는 데이터셋에 둔다.** 텔레메트리 쪽 뷰는 결제 없는 축약본이다.

| 컬럼 | 타입 | 뜻 |
| --- | --- | --- |
| (§3-1 의 모든 컬럼) | | |
| `personKey` | STRING | 사람 축 가명키(`us_`+24). ★uid 아님 |
| `personLinkCount` | INT64 | 이 설치에 연결된 사람 수. **2 이상이면 공용 기기 — 값을 만들지 않고 센다** |
| `personInstallCount` | INT64 | 이 사람이 가진 설치 수. **2 이상이면 이 행의 금액이 같은 사람의 다른 행에도 그대로 있다** |
| `firstPurchaseAt` | TIMESTAMP | 첫 결제·부여 시각 |
| `purchaseCount` | INT64 | 결제 원장 행 수 |
| `paidCount` | INT64 | `kind='paid'` |
| `grantCount` | INT64 | `kind='grant'` (매출 아님) |
| `revenueTotal` | NUMERIC | `amountKnown` 인 결제 금액 합 |
| `revenueCurrency` | STRING | 통화. 섞이면 NULL + 사유 |
| `revenueAmountUnknownCount` | INT64 | 금액을 모르는 결제 건수. **0 으로 접지 않는다** |
| `accountClass` | STRING | `internal` / `external` / NULL. ★선행 티켓 `cDvehpHhz1sn0ZHNpNq5` 규약 재사용 |
| `isInternal` | BOOL | `accountClass='internal'`. **판정 불가(NULL)를 external 로 승격하지 않는다** |
| `revenueMissingReason` | STRING | 결제 축이 빈 이유(§4-2) |
| `personAxisEffectiveFrom` | DATE | 사람 축 소급 상한. 게이트가 닫혀 있으면 NULL |

---

## 4. ★NULL 규약 — 0 과 미적재를 가른다

이 프로젝트가 오늘 '빈 값' 을 '없는 것' 으로 읽어 세 번 틀렸다. 그래서 이 뷰의
가장 중요한 규약은 스키마가 아니라 이것이다:

> **채널을 모르는 설치는 `'(unknown)'` 이 아니다. 값은 NULL 이고, 왜 NULL 인지가
> 사유 컬럼에 적힌다.**

### 4-1. `channelMissingReason` — 사다리, 위에서부터 첫 번째 해당

| 값 | 뜻 | 이건 "모른다" 인가 "없다" 인가 |
| --- | --- | --- |
| `no_ledger_row` | `install_attribution` 에 이 설치가 없다(앱이 링크백을 못 보냈다) | **모른다** |
| `no_ga_client_id` | 원장 행은 있는데 `gaClientId` 가 없다(쿠키 차단·광고 차단) | **모른다** |
| `key_mismatch` | 원시 `gaClientId` 는 있는데 `gaKeyHmac` 이 NULL | **모른다** |
| `no_ga4_row` | `gaKeyHmac` 은 있는데 브리지에 그 `gaKey` 가 없다 | **모른다** |
| `no_utm` | GA4 행은 붙었는데 캠페인 축이 비었다(자연·직접 유입) | **없다 (진짜 0)** |
| `NULL` | 캠페인이 실재한다 | — |

★`key_mismatch` 는 **#1195 배포 전 행의 정상값**이다. 그 행들은 `gaKeyHmac` 이
영구히 NULL 이고(소급 재작성 없음), 그게 `no_ga4_row` 로 찍히면 거짓말이 된다 —
브리지에 없어서가 아니라 **키를 안 들고 있어서** 못 붙은 것이기 때문이다.
이 둘이 갈려 있는 것이 설계가 맞다는 증거다.

★`no_utm` 과 나머지의 경계가 `hasGa4Row` 다. `hasGa4Row = true, reason = 'no_utm'`
이면 "우리는 이 설치의 유입을 안다. 자연유입이었다" 는 뜻이고,
`hasGa4Row = false` 면 "모른다" 는 뜻이다. **이 둘을 절대 합치지 마라.**

캠페인 센티널 처리: GA4 는 캠페인이 없을 때 `(direct)` · `(referral)` ·
`(organic)` · `(not set)` · `(none)` 같은 **자기 센티널**을 넣는다. 뷰는 그 값을
`channelCampaign` 에 **그대로 남기되**(원문을 지어내지 않는다) `no_utm` 으로
분류한다 — `(direct)` 는 캠페인 이름이 아니다.

### 4-2. `revenueMissingReason` — 사다리

| 값 | 뜻 |
| --- | --- |
| `person_axis_closed` | `PERSON_AXIS_EFFECTIVE_FROM` 미설정 — 사람 축이 닫혀 있다 |
| `no_install_key_hmac` | `analytics_user_daily.install_key_hmac` 이 NULL — 설치↔사람 다리가 없다 |
| `no_person_link` | 링크표에 이 설치가 없다(아직 로그인 전) |
| `shared_device` | 한 설치에 사람 2명 이상 — 값을 만들지 않고 **센다**(`personLinkCount`) |
| `mixed_currency` | 통화가 섞였다 — 합계를 만들지 않는다 |
| `NULL` | **결제 축을 안다.** `revenueTotal` 은 실수이고 **0 일 수 있다**(=결제 없음) |

★마지막 줄이 요점이다. "결제 0원" 과 "결제를 모름" 은 다른 사실이고, 이 뷰에서
전자는 `revenueTotal = 0, reason = NULL`, 후자는 `revenueTotal = NULL, reason ≠ NULL` 이다.

### 4-2-1. ★`SUM(revenueTotal)` 은 틀린다 — 설치 알갱이의 대가

한 사람이 기기 두 대에 설치하면 **그 사람의 결제가 두 행에 그대로 반복된다.**
설치 알갱이를 고른 이상 피할 수 없는 성질이라(§2 의 반대 근거) 숨기지 않고
`personInstallCount` 로 **센다.** 실측 시뮬레이션에서 그대로 재현됐다:

```
personKey                    personInstallCount  revenueTotal
us_84a24bf2…                                  2       104300   ← 같은 결제가
us_84a24bf2…                                  2       104300   ← 두 행에 있다
us_db1740ad…                                  1            0   ← 결제 없음(진짜 0)
```

**매출 합계는 사람 단위로 접어서 낸다:**

```sql
SELECT SUM(revenueTotal) AS revenue
FROM (
  SELECT personKey, ANY_VALUE(revenueTotal) AS revenueTotal
  FROM `marblo-2253d.marblo_identity.v_install_unified_revenue`
  WHERE revenueMissingReason IS NULL AND personKey IS NOT NULL
  GROUP BY personKey
);
```

설치·활성화·리텐션은 설치 알갱이 그대로 세면 되고, **금액만** 이 규칙을 탄다.

### 4-3. 그 밖

- `retentionMissingReason = 'no_daily_rows'` → `activeDays7/14/30` 은 NULL 이지 0 이 아니다.
- `retentionElapsedDays` 가 7 미만이면 `activeDays7` 은 **아직 안 닫힌 창**이다.
  뷰는 부분값을 그대로 주고 창이 닫혔는지 판단할 재료(`retentionElapsedDays`)를 준다.
  숫자를 숨기지도, 다 찬 것처럼 보이게도 하지 않는다.
- `hasSpawned = false` 는 **진짜 0** 이다(설치했는데 안 썼다). `activationMissingReason
  = 'no_first_run'` 은 **모른다** 다(기준 시각이 없어 경과일을 못 센다).

---

## 5. 조인 경로 — 한 줄도 추측하지 않는다

```
analytics_install_profile          608행, install_key = 원시 UUID   ← ★알갱이의 정본
  │  p.install_key = a.installId                                     (원시 = 원시)
  ▼
install_attribution                632행, installId 유일             565건 매칭(실측)
  │  a.gaKeyHmac = g.gaKey         ★가명 = 가명. 원시로 조인하면 영원히 0행
  ▼
ga4_first_touch_current            gaKey 당 1행(가장 이른 유입)
  → 채널 축(source/medium/campaign/content/term/country/device)

[결제 축 — marblo_identity 뷰에서만]
analytics_install_profile
  │  p.install_key = d.install_key                                   (원시 = 원시)
  ▼
analytics_user_daily.install_key_hmac        ★설치 원시→가명의 유일한 다리(#1171)
  │  = l.install_key
  ▼
marblo_identity.analytics_user_install       링크표(설치↔사람). ★잇는 자리는 여기 하나
  │  l.user_key = pu.user_key
  ▼
analytics_purchase                 → firstPurchaseAt / revenueTotal / accountClass
```

**금지 경로 (전부 조용히 0행이 된다):**

- ❌ `install_attribution.gaClientId = ga4_first_touch_current.gaKey` — 원시 vs 가명
- ❌ `analytics_install_profile.ga_key = ga4_first_touch_current.gaKey` — 프로필의
  `ga_key` 도 **원시**다(길이 20~21, 실측). 이름이 `ga_key` 라서 가명처럼 보이지만 아니다
- ❌ `analytics_install_profile.install_key = analytics_identity.install_key` —
  원시 vs 가명(`in_`+24)
- ❌ `gaKeyHmac` 으로 설치↔사람을 잇기 — 한 브라우저에 설치 480건이라 480×477 로
  부풀고, 한 사람의 결제가 480개 설치에 복제된다

**행수 보존:** 위 조인은 전부 1:1 이거나(유일키) 사전 집계된 1행이다. `install_attribution.installId`
632개 전부 유일, `ga4_first_touch_current.gaKey` 100개 전부 유일(실측). 일별·결제·
링크는 `install_key`/`user_key` 로 **미리 GROUP BY** 한 뒤 붙인다. 그래서 결과는
정확히 608행이고, 설치가 늘지도 사라지지도 않는다. 단위 테스트가 이 성질을 잠근다.

---

## 6. 지금 무엇이 채워지고, 무엇이 안 채워지나 (2026-08-24 실측)

이 절이 "만들었는데 조용히 비었다" 를 막는 자리다.

### 6-1. 채널 축 — 지금은 전량 `key_mismatch`, 배포 후에도 조건부

| 단계 | 실측 | 사유 |
| --- | ---: | --- |
| 설치(프로필) | 608 | 분모 |
| 원장 행 매칭 | 565 | 나머지 43 → `no_ledger_row` |
| 원장에 원시 `gaClientId` | 565 | |
| 원장에 `gaKeyHmac` | **0** | ★컬럼이 아직 BQ 에 없다 → 전량 `key_mismatch` |
| 브리지에 붙을 gaKey | (예상 ~481) | `ga_fe1c08…` 477 + `ga_3103a9…` 6 에 대응 |
| 캠페인이 실재 | **0** | 붙는 GA4 행이 전부 `(direct)` → `no_utm` |

**세 가지가 순서대로 풀려야 캠페인 축이 채워진다:**

1. **#1195 배포.** `install_attribution` 에 `gaKeyHmac`/`utmContent`/`utmTerm` 이
   아직 **BigQuery 에 없다.** 스키마는 `ensureAttributionTable()` 이 배포 후 첫
   쓰기에서 덧붙인다(NULLABLE 추가만). ★**그전에는 뷰를 만들 수조차 없다** —
   없는 컬럼을 참조하면 `CREATE VIEW` 가 실패한다.
2. **소급 백필.** 배포 후 들어오는 설치만 `gaKeyHmac` 을 갖는다. 과거 565건은
   `scripts/backfill-install-attribution-ga-key.ts`(선행 문서 §6 의 계획)가 돌아야
   `key_mismatch` 를 벗는다. 안 돌리면 과거 구간은 영구히 `key_mismatch` 다 —
   그건 버그가 아니라 **정직한 표시**다.
3. **GA4 브리지 전 구간 백필.** ★이게 가장 큰 구멍이다. `ga4_first_touch` 는
   **100행**뿐인데 GA4 export 방문자는 **776명**(2026-07-08~08-23)이다.
   `GA4_SYNC_DEFAULT_DAYS = 3` 인 스케줄만 돌고 전 구간 백필이 **한 번도 안 돌았다.**
   그래서 3일 창 밖의 방문자는 브리지에 없고 → `no_ga4_row` 가 된다.
   (실측: `ga_6a841f…` 67행이 정확히 그 케이스다.) 별개 티켓 `Tscd3JzHec3ahGI6Jgl6` 소관.

### 6-2. 결제 축 — 지금은 **구조적으로** 전량 `no_install_key_hmac`

`analytics_user_daily.install_key_hmac` 이 **전량 NULL** 이다(#1171 이 컬럼만 만들고
백필이 안 돌았다). 그게 설치(원시)↔사람(가명)을 잇는 **유일한 다리**라 결제 축은
지금 0이 아니라 **미상**이다. 링크표도 4행(사람 3명)뿐이다.

★이건 이 티켓에서 고칠 것이 아니다. 뷰는 그 사실을 `no_install_key_hmac` 으로
**말한다.** 다리가 놓이면 뷰는 그대로 두고 값만 채워진다.

> ★후속(`VV733VRpsfGvijYuPWCl`): 그 다리를 **우회하는 두 번째 경로**가 붙었다.
> GA4 는 같은 세션에 채널과 결제가 같이 실려 있어 `gaKey` 하나로 채널→결제가
> 이어진다. 원장이 여전히 정본이고 GA4 는 보조축이며, 두 값이 갈리면
> `revenueDivergenceReason` 이 **둘 다 보이게** 한다.
> 정의: `ga4-ecommerce-unified-2026-08-24.md`.
> ★그 문서에서 `revenueTotal` 이 **`revenueLedger`** 로 개명됐다(매출 축이 둘이
> 됐으므로 이름이 어느 쪽인지 말해야 한다).

### 6-3. ★붙은 GA4 행도 그대로 믿으면 안 되는 부분

- `channelFirstVisitDate` 가 **진짜 최초 방문이 아니다.** 브리지는 동기화 창(3일)
  안에서 `MIN(event_date)` 를 적는다. 실측: `ga_fe1c08…` 의 브리지 값은 2026-08-19
  인데 GA4 export 상 그 방문자의 실제 첫 이벤트는 **2026-07-08** 이다.
  전 구간 백필(6-1의 3)이 돌면 교정된다.
- `channelLandingPage` 가 `marblo.app/ko/link` 다 — 그건 **앱이 스스로 여는 링크백
  페이지**지 사용자가 처음 도착한 랜딩이 아니다. 랜딩 축을 광고 성과로 읽지 마라.
- 붙는 행이 전부 `(direct)/(none)/(direct)` 다. 유료 광고 전이라 정상이다.
  `no_utm` 으로 분류되고 캠페인은 NULL 이다 — **`(direct)` 를 캠페인명으로 세지 않는다.**

  > ★2026-08-24 보정(`VV733VRpsfGvijYuPWCl`): 이 관찰은 **틀린 게 아니라 좁다.**
  > 원장에 실린 `gaClientId` 가 5개뿐이라 그 5명만 본 결과다. GA4 export 전체
  > 방문자 축에서는 채널이 실제로 갈린다 — `github.com/referral` ·
  > `youtube.com/referral` · `l.threads.com/referral` · `threads/social` ·
  > `naver/organic` 이 실측된다. 자세한 것은
  > `ga4-ecommerce-unified-2026-08-24.md` §1-3(b).

---

## 7. 검증 — 배포 전에 할 수 있는 것과 없는 것

### 7-1. 배포 전(지금) — 단위 테스트로 잠근다

`v3/functions/src/installUnified.test.ts` (`npm run test:install-unified`).
SQL 빌더는 순수 함수라 BQ 없이 검증한다:

- 사유 사다리가 **모든 입력 조합에서 정확히 하나**를 고른다(순서 포함).
- `no_utm` 과 조인 실패가 **다른 값**이고, `hasGa4Row` 로 갈린다.
- 생성된 SQL 에 `uid` / `email` / 원시 솔트 / `'(unknown)'` 이 **없다**.
- 조인이 전부 사전 집계돼 있어 **행수가 안 부푼다**(집계 서브쿼리 구조 검사).
- 게이트가 닫히면 결제 컬럼이 NULL + `person_axis_closed` 다.

### 7-2. 배포 후 — 뷰를 실제로 만들고 나서 (순서대로)

```sql
-- (a) 행수 보존: 정확히 608(= analytics_install_profile 행수)이어야 한다
SELECT
  (SELECT COUNT(*) FROM `marblo-2253d.marblo_telemetry.analytics_install_profile`) AS profiles,
  (SELECT COUNT(*) FROM `marblo-2253d.marblo_telemetry.v_install_unified`)          AS unified,
  (SELECT COUNT(DISTINCT installKey) FROM `marblo-2253d.marblo_telemetry.v_install_unified`) AS distinct_installs;
-- ★셋이 같아야 한다. 다르면 조인 하나가 부풀었거나 삼켰다.
```

```sql
-- (b) 사유 분포: 0 과 미적재가 섞이지 않았는지
SELECT
  channelMissingReason,
  hasGa4Row,
  COUNT(*)                              AS installs,
  COUNTIF(channelCampaign IS NOT NULL)  AS with_campaign,
  COUNTIF(isDevInstall)                 AS dev_installs
FROM `marblo-2253d.marblo_telemetry.v_install_unified`
GROUP BY 1, 2 ORDER BY installs DESC;
-- ★기대(배포 직후·백필 전): key_mismatch 565 / no_ledger_row 43. 그게 정상이다.
-- ★백필 후 기대: no_utm 이 다수, no_ga4_row 가 브리지 창 밖 분량.
-- ★channelMissingReason IS NULL 인 행은 channelCampaign 이 반드시 NOT NULL 이어야 한다.
```

```sql
-- (c) 표본이 몇 대인지 — 큰 숫자를 큰 표본으로 읽지 않기 위해
SELECT gaKeyInstallCount, COUNT(*) AS installs
FROM `marblo-2253d.marblo_telemetry.v_install_unified`
GROUP BY 1 ORDER BY 1 DESC;
-- ★2026-08-24 기준 기대: 480 근처의 버킷 하나가 대부분을 차지한다(브라우저 1대).
```

```sql
-- (d) 내부·테스트가 숨겨지지 않았는지 (숨기지 않는 게 규약이다)
SELECT isDevInstall, isInternal, accountClass, COUNT(*) AS installs, SUM(revenueTotal) AS revenue
FROM `marblo-2253d.marblo_identity.v_install_unified_revenue`
GROUP BY 1, 2, 3 ORDER BY installs DESC;
-- ★행이 사라지지 않고 플래그로만 갈려야 한다.
```

```sql
-- (e) 사장님이 실제로 물으실 질문 — 캠페인별 설치→활성화→결제
SELECT
  channelSource, channelMedium, channelCampaign, channelContent,
  COUNT(*)                                  AS installs,
  COUNTIF(hasSpawned)                       AS activated,
  COUNTIF(firstPurchaseAt IS NOT NULL)      AS purchasers,
  SUM(IFNULL(revenueTotal, 0))              AS revenue_known
FROM `marblo-2253d.marblo_identity.v_install_unified_revenue`
WHERE channelMissingReason IS NULL          -- ★캠페인이 실재하는 행만
  AND NOT isDevInstall
GROUP BY 1, 2, 3, 4
ORDER BY installs DESC;
-- ★2026-08-24 현재 이 쿼리는 0행이다. 그건 버그가 아니라 §6-1 그대로다 —
--   유료 광고를 켠 적이 없다. 광고를 켜면 여기부터 채워진다.
```

### 7-2-1. ★배포 전에 이미 증명한 것 — 실측 (2026-08-24)

`gaKeyHmac` 컬럼이 BQ 에 없으므로 뷰를 **만들 수는** 없다. 대신 생성된 SQL 을
그대로 쿼리로 돌리되 `install_attribution` 자리에 없는 컬럼을 NULL 로 채운
셔틀(shim)을 끼워 **라이브 데이터로** 검증했다.

**(1) 행수 보존 — 조인이 부풀지도 삼키지도 않는다**

```
profiles  unified  distinct_installs
     608      608                608     ← 셋이 같다
```

**(2) 사유 분포 (배포 전 현재 상태)**

```
channelMissingReason  hasGa4Row  installs  with_campaign  dev_installs
key_mismatch          false           565              0           14
no_ledger_row         false            43              0            0
```

★565 가 `key_mismatch` 로 찍히는 것이 **설계가 맞다는 증거**다. 이 행들은
#1195 배포 전에 들어와 `gaKeyHmac` 을 영영 안 들고 있다. 이걸 `no_ga4_row` 로
찍었다면 "브리지를 고쳐라" 로 잘못 읽혔을 것이다.

**(3) 배포 후 '모양' 시뮬레이션** — 원시→가명 대응을 빈도 순위로 임시 배정해
조인이 실제로 채워지는지만 봤다(★귀속 주장이 아니다):

```
channelMissingReason  hasGa4Row  installs  with_source  sample_campaign  gaKeyInstallCount
no_utm                true            481          481  (direct)                       539
no_ga4_row            false            68            0  NULL                            69
no_ledger_row         false            43            0  NULL                          NULL
key_mismatch          false            16            0  NULL                          NULL
                                       ---
                                       608           ← 행수 그대로
```

읽는 법: 481행은 **유입을 안다**(자연유입이었다 — `(direct)` 원문은 남기고 사유는
`no_utm`). 68행은 **모른다**(브리지 창 밖). `gaKeyInstallCount = 539` 가 "이
481행은 브라우저 한 대다" 를 표 안에서 말한다.

**(4) 결제 축 — 지금 상태 그대로 돌렸다**

```
revenueMissingReason  n    with_person  revenue_known
no_install_key_hmac   608            0              0     ← §6-2 그대로. 0 이 아니라 미상이다.
```

게이트를 닫고 돌리면 608행 전부 `person_axis_closed` 이고 설치·채널·리텐션은
그대로 남는다(설치가 사라지지 않는다).

**(5) 결제 체인 시뮬레이션** — `install_key_hmac` 다리와 공용 기기를 흉내 내서
사슬 전체가 도는지 봤다:

```
revenueMissingReason  n    with_person  revenue_known  revenue_zero  personLinkCount
no_install_key_hmac   604            0              0             0                0
NULL                    3            3              3             1                1
shared_device           1            0              0             0                2
```

★`revenue_zero = 1` 이 이 티켓의 핵심이 도는 증거다 — 그 설치는 사람이 붙었고
결제가 없다. **`revenueTotal = 0, reason = NULL`**(안다, 0원)이지
`revenueTotal = NULL`(모른다)이 아니다. 그리고 `shared_device` 행은 값을 고르지
않고 `personLinkCount = 2` 로 **세기만** 했다.

### 7-3. 배포 전에 증명할 수 없는 것 — 정직하게 적는다

`gaKeyHmac` 이 BQ 에 없으므로 "채널이 실제로 채워진다" 는 **오늘 증명할 수 없다.**
증명할 수 있는 것은 **키 공간이 맞다**는 사실뿐이고, 그건 #1195 가 같은 수법으로
이미 했다(`analytics_identity.ga_key ↔ ga4_first_touch.gaKey` = 483/550). 같은
`deriveGaKey()` 한 벌이 두 컬럼을 다 만들므로 `gaKeyHmac` 도 같은 공간이다.
**단, §1-2 대로 그 88% 는 브라우저 2대다** — 커버리지의 근거로 쓰되 표본으로 쓰지 마라.

---

## 7-4. 어떻게 만드나

```bash
cd v3/functions
npm run test:install-unified                      # 규약 단위 테스트 (34개)
npm run provision:install-unified                 # dry-run — DDL 만 찍는다
npm run provision:install-unified -- --apply      # 실제 생성
npm run provision:install-unified -- --apply --replace-views   # 본문 교체
```

★`provision-install-unified` 는 뷰를 만들기 전에 **원본의 컬럼까지** 확인하고,
`install_attribution.gaKeyHmac` 이 없으면 "무엇이 배포돼야 하는지" 를 말하고
멈춘다. BigQuery 의 `no such field` 에러를 그대로 흘리면 다음 사람이 원인을 못
찾는다. 데이터셋은 만들지 않는다 — `marblo_identity` 를 여기서 만들면 기본 ACL
로 만들어져 링크표 격리가 조용히 풀린다.

## 8. 왜 뷰인가 · 안 하는 것

**뷰로 짓는다. 구체화 테이블·스케줄러로 가지 않는다.**
모수가 608행이라 비용이 문제가 아니다. 문제는 **정의가 아직 움직인다**는 것이다.
구체화하면 매번 재적재해야 하고, 재적재를 빠뜨린 구간이 낡은 값으로 남는데 그
사실이 표에 안 보인다 — 이 티켓이 막으려는 실패 그 자체다. 느려지면 그때 구체화한다
(608행이 6만 행이 되어도 이 조인은 초 단위다).

**이 변경이 하지 않는 것:**

- 원본 테이블을 만들거나 고치지 않는다. **뷰 두 벌만 만든다.**
- `ANALYTICS_ID_SALT` 를 건드리지 않는다. 솔트는 SQL 에 **한 번도 등장하지 않는다**
  (BQ 는 쿼리 본문을 job 히스토리에 수개월 보관한다).
- PII 를 넣지 않는다 — `uid`·이메일·IP 컬럼이 없다. 식별자는 앱이 만든 익명 설치
  UUID 와 가명키(`ga_`/`us_`)뿐이다.
- 내부·테스트를 **기본 필터로 숨기지 않는다.** `isDevInstall`·`isInternal`·
  `accountClass` 는 컬럼이고, 거르는 판단은 읽는 쪽이 한다. 지금 외부 실사용자가
  4명이라 한 건만 섞여도 표가 바뀐다 — 그러니 더더욱 **보이게** 둔다.
- 새 내부계정 판정 규약을 만들지 않는다. `analyticsPurchase.ts` 의 `account_class`
  (선행 티켓 `cDvehpHhz1sn0ZHNpNq5`)를 그대로 읽는다.
- 소급 백필을 하지 않는다(§6-1 의 2·3은 각각 별도 실행 단계다).

---

## 9. 다음 단계 — 이 뷰가 채워지려면 무엇이 순서대로 돌아야 하나

이 PR 은 **정의와 뷰**까지다. 아래는 각각 별개의 실행 단계이고, 하나라도 빠지면
뷰는 에러 없이 사유 컬럼만 채운 채로 남는다(그게 설계다 — 조용히 비지는 않는다).

| # | 무엇 | 없으면 뷰가 말하는 것 | 소관 |
| --- | --- | --- | --- |
| 1 | **#1195 배포** — `ensureAttributionTable()` 이 `gaKeyHmac`/`utmContent`/`utmTerm` 을 덧붙인다 | `key_mismatch` 565 (뷰 생성 자체가 불가) | 배포 |
| 2 | **원장 소급 백필** — `scripts/backfill-install-attribution-ga-key.ts`(선행 문서 §6) | 과거 565건이 계속 `key_mismatch` | 별도 티켓 |
| 3 | **GA4 브리지 전 구간 백필** — 지금 100행 / GA4 방문자 776명 | `no_ga4_row`, 그리고 `channelFirstVisitDate` 가 틀린 값 | `Tscd3JzHec3ahGI6Jgl6` |
| 4 | **`analytics_user_daily.install_key_hmac` 백필**(#1171) | 결제 축 전량 `no_install_key_hmac` | 별도 티켓 |
| 5 | **`PERSON_AXIS_EFFECTIVE_FROM` 배포 env 확인** | 결제 축 전량 `person_axis_closed` | 배포 |
| 6 | **광고 URL 에 `utm_content`/`utm_term` 을 소재별로 다르게** (선행 문서 §4) | `no_utm` — 소재 축이 영영 미상 | 마케팅 |

★1~5 는 전부 "이미 있는 것을 돌리는" 일이고 새 설계가 필요 없다. **6 만은
되돌릴 수 없다** — 광고를 켠 뒤에 수집을 시작하면 그 전 구간은 복구되지 않는다.

### 어드민 화면을 이 PR 에서 잇지 않는 이유

티켓 scope 에 `marblo-web/.../AnalyticsPanel.tsx` 가 있지만 **건드리지 않았다.**
뷰는 §7-4 를 돌려야 존재하고, 그 전제는 1번(배포)이다. 존재하지 않는 뷰를 화면에
붙이면 배포 순서에 따라 어드민이 깨지고, 깨진 화면은 "유입이 없다" 로 읽힌다 —
이 티켓이 막으려는 실패 그 자체다. 화면 연결은 뷰가 실제로 선 뒤에 별도로 한다.
