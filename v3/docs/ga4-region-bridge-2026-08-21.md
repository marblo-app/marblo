# GA4 리전 브리지 — 얇은 브리지로 asia-northeast3 를 US 에 잇는다 (2026-08-21)

티켓 `Th9VRMvm2HkyWSjwF12X`. 선행: `docs/beta-churn-root-cause-analysis-2026-07-21.md` §4,
`v3/docs/ga4-country-funnel-attribution-2026-08-10.md` §2, `v3/docs/attribution-bridge-break-2026-08-21.md`.

## 0. 한 줄 결론

**GA4 를 US 로 복사하지 않는다. GA4 쪽에서 먼저 방문자당 1행으로 접고, 그 한 줄만
가명 조인키(`ga_key`)와 함께 US 로 옮긴다.** 그러면 US 안에서 한 쿼리로
`ga4_first_touch_current ⋈ analytics_identity ⋈ events` 가 성립한다.

## 1. 제약 — 권한이 아니라 BigQuery 다

```
analytics_543991508 (GA4 export)  →  asia-northeast3
marblo_telemetry     (앱 텔레메트리) →  US
```

BigQuery 는 **한 쿼리에서 리전이 다른 데이터셋을 참조하지 못한다.** 권한을 아무리
열어도 안 되고 페더레이티드 쿼리로도 우회되지 않는다. 사용자 실측으로 확인된 사실이며,
이 문서는 그걸 전제로 쓴다.

지금까지의 우회는 콜러블이 두 리전에 각각 쿼리를 던지고 결과를 **애플리케이션
메모리에서** 합치는 것이었다(`countryFunnel.ts` / `getAdminCountryFunnel`). 오늘
돌아가지만 세 가지가 걸린다: 조회할 때마다 GA4 를 다시 스캔하고, 방문자 수 상한이
있고, **SQL 쪽에서는 아무도 이 조인을 쓸 수 없다**(코호트·리텐션·BQML 전부 막힌다).

## 2. 채택안 — 얇은 브리지

```
[asia-northeast3]                         [US]
 events_YYYYMMDD                           marblo_telemetry
   │  ① 방문자당 1행으로 집계(GA4 쪽에서)      ├─ ga4_first_touch        (브리지 테이블, append-only)
   │     GROUP BY user_pseudo_id             ├─ ga4_first_touch_current(뷰: ga_key 당 가장 이른 1행)
   ▼                                         │
 방문자 N행 ──② 함수 런타임에서 HMAC 가명화──▶ ├─ analytics_identity     (★기존 표: install_key ↔ ga_key)
   (raw user_pseudo_id 는 여기서 끝)          └─ events                 (앱 텔레메트리)

  ★US 에 새로 생기는 것은 위 두 개(표 1 + 뷰 1)뿐이다. analytics_identity 와
    install_attribution 은 사람 축 작업이 이미 만든 것으로, 브리지는 읽기만 한다.
```

### 왜 전체 복사가 아닌가

|                   | GA4 데이터셋 복사(Dataset Copy) | **얇은 브리지(채택)**             |
| ----------------- | ------------------------------- | --------------------------------- |
| US 로 넘어가는 것 | GA4 **원문 이벤트 전량**        | 방문자당 **1행**, 11개 필드       |
| 조인키            | 원시 `user_pseudo_id`           | **HMAC 가명 `ga_key`**            |
| 비용              | 이벤트 수에 비례                | 방문자 수에 비례 — 자릿수 감소    |
| 개인정보 표면     | GA4 원문이 리전을 넘는다        | 원문도, 원시 식별자도 안 넘어간다 |
| 사장님 콘솔 액션  | API 활성화·전송 설정 필요       | **불필요**(함수 스케줄)           |

비용만의 문제가 아니다. **원시 GA4 식별자가 US 로 넘어가지 않는 것**이 이 설계의
본체다. 넘어가는 조인키는 `deriveGaKey()` 의 HMAC 가명이고, 솔트(`ANALYTICS_ID_SALT`)는
BigQuery 에 없고 함수 런타임 env 에만 있다 — 웨어하우스만 보는 쪽에서는 브리지 행을
GA4 쪽으로 되짚을 수 없다. 기존 `analyticsPseudonym.ts` 의 규약을 그대로 따르며 새
시크릿을 만들지 않는다.

★**솔트가 없으면 아무것도 적재하지 않는다.** 원시 client_id 로 폴백해 적재하는 건
이 설계의 전제를 조용히 깨는 길이라, `failed-precondition` 으로 시끄럽게 실패한다.

## 3. ★귀속 소스를 왜 `traffic_source` 로 골랐나

GA4 export 에는 유입 정보가 **세 군데** 있고 **서로 다른 값을 준다.** 근거를 안 적으면
다음 사람이 반드시 다르게 읽으므로 여기 남긴다.

| 후보                                  | 스코프   | 귀속 방식                    | content/term      | 판정      |
| ------------------------------------- | -------- | ---------------------------- | ----------------- | --------- |
| `traffic_source.{source,medium,name}` | **유저** | **최초획득(first-touch)**    | **없음**(3필드뿐) | ★**채택** |
| `collected_traffic_source.manual_*`   | 이벤트   | 그 이벤트에 실려 온 원문 utm | **있음**          | 보조 채택 |
| `session_traffic_source_last_click.*` | 세션     | **last-click**               | 있음              | **기각**  |

- **`traffic_source` 채택 이유**: 그 유저를 처음 데려온 소스이고, 이후 세션이
  무엇이든 값이 바뀌지 않는다. 우리가 재려는 축(“이 유입이 설치·활성화로
  이어졌나”)의 정의와 **글자 그대로 같다.**
- **`session_traffic_source_last_click` 기각 이유**: 이름 그대로 마지막 클릭 귀속이고
  세션마다 값이 달라진다. 이걸 쓰면 **재방문이 최초 유입을 덮는다** — 광고로 데려온
  사람이 나중에 직접 방문하면 그 설치가 `(direct)` 로 잡힌다. 광고 성과가 구조적으로
  과소평가된다.
- **`collected_traffic_source` 를 보조로 쓰는 이유**: `traffic_source` 에는
  `content`/`term` 필드가 **아예 없다.** 그 둘을 실으려면 여기 말고 자리가 없다.

### 실제 적용 규칙 (`toBridgeRow`)

1. `source`/`medium`/`campaign` — `traffic_source` 가 정본. 유저의 **가장 이른
   이벤트**의 non-null 값을 쓴다.
2. `content`/`term` — 언제나 `collected_traffic_source` 의 유저 최초 non-null 값.
3. `traffic_source` 3필드가 **통째로 비어 있을 때만** `collected_traffic_source` 로
   1을 메운다(속성 수집 시작 이전에 획득된 유저 등).
4. **필드별로 섞지 않는다.** `source` 는 first-touch 인데 `medium` 은 collected 인
   행이 생기면 채널 표가 조용히 틀린다. 축 단위로 통째로 고른다.
5. 어느 축에서 왔는지를 **행마다** `attributionSource` 컬럼에 남긴다
   (`traffic_source` / `collected_traffic_source` / `(none)`).

> 알아 둘 불일치: 3의 폴백이 걸린 행은 `campaign`(collected) 과 `content`/`term`
> (collected) 이 같은 태깅에서 오지만, 1이 살아 있는 행은 `campaign`(first-touch) 과
> `content`/`term`(collected) 이 **다른 방문에서 왔을 수 있다.** 광고를 켜서
> content/term 이 실제로 채워지기 시작하면 `attributionSource` 로 갈라서 확인해야
> 한다. 지금은 둘 다 비어 있어 관측되지 않는다.

## 4. 실어 나르는 필드

| 컬럼                             | 출처                             | 비고                             |
| -------------------------------- | -------------------------------- | -------------------------------- |
| `gaKey`                          | `user_pseudo_id` → HMAC          | **원시값은 US 로 안 간다**       |
| `country` / `region`             | `geo.country` / `geo.region`     | 최초 이벤트 시점 값              |
| `source` / `medium` / `campaign` | §3 규칙                          |                                  |
| `content` / `term`               | `collected_traffic_source`       | **지금 거의 전부 null**          |
| `firstVisitDate`                 | `MIN(event_date)`                | 파티션 축                        |
| `deviceCategory`                 | `device.category`                |                                  |
| `landingPage`                    | `page_location`                  | **쿼리스트링 제거** host+path 만 |
| `downloads`                      | `COUNTIF(event_name='download')` | 티켓 목록 밖 1개 추가 — 아래     |
| `attributionSource`              | §3-5                             | 티켓 목록 밖 1개 추가 — 아래     |
| `syncedAt`                       | 적재 시각                        |                                  |

- **`landingPage` 에서 쿼리를 버리는 이유**: utm\_\* 는 이미 별도 컬럼으로 실린다.
  반면 랜딩 URL 쿼리에는 메일 캠페인 수신자 토큰처럼 개인을 가리킬 수 있는 값이 섞여
  들어온다. 그걸 US 로 옮기면 “필요한 필드만 옮긴다” 는 전제가 깨진다.
- **티켓 목록 밖에서 2개를 더 실었다**: `downloads`(이게 있어야 방문→다운로드 칸을
  브리지만으로 계산할 수 있다) 와 `attributionSource`(§3 의 판단 근거를 데이터에
  남긴다). 둘 다 방문자당 1행 안의 집계값이라 개인정보 표면을 넓히지 않는다.

### ★`campaign` / `content` / `term` 을 지금 비었다고 빼지 않았다

유료 광고 전이라 이 셋은 거의 전부 null 이다. 그래도 컬럼은 **지금** 만들어 둔다.
광고를 켜는 순간 채워져야 하는데 그때 스키마를 고치면, **고치기 전에 들어온 트래픽은
영영 빈칸으로 남는다.** BigQuery 는 과거 파티션에 값을 소급 생성해 주지 않는다.
`ga4Bridge.test.ts` 에 이 셋이 스키마에 남아 있는지 검사하는 테스트를 박아 뒀다 —
“비어 있으니 정리하자” 는 다음 사람의 손을 테스트가 막는다.

### ★축 오염이 왜 불가능한가 (브리지가 만드는 유일한 위험 지점)

브리지는 **GA4 쪽 익명 신원(`ga_key`)과 우리 쪽 축이 만나는 지점**을 새로 만든다.
여기가 이 설계에서 유일하게 위험한 자리라, 무엇이 왜 불가능한지 못박아 둔다.

**1) 브리지 표에는 계정축 식별자가 아예 없다.** §4 표가 전부다 — `uid`, 이메일,
`userId`, `customerId` 중 **어느 것도 컬럼으로 존재하지 않는다.** 조인하고 싶어도
붙일 컬럼이 없다. 이건 규약이 아니라 스키마(`GA4_BRIDGE_SCHEMA`)로 강제된다.

**2) `ga_key` 는 원시값이 아니라 별도 가명 공간이다.** `deriveGaKey()` 는
`analyticsPseudonym.ts` 의 `"ga"` 공간을 쓴다. 같은 솔트를 쓰지만 공간 태그가
`kind:raw` 로 해시 입력에 들어가므로, **같은 원시 문자열이어도 `agent`/`task`/
`project`/`flow` 공간과 값이 절대 겹치지 않는다**(테스트로 고정:
`★ga_key 는 다른 가명 공간(agent/task)과 값이 겹치지 않는다`). 즉 `ga_key` 로
익명 이벤트 세계의 어떤 조인키와도 우연히 매칭될 수 없다.

**3) 솔트는 웨어하우스에 없다.** `ANALYTICS_ID_SALT` 는 함수 런타임 env 에만 있다.
BigQuery 만 들여다보는 쪽은 `ga_key` → `user_pseudo_id` 를 되짚을 수 없고, GA4 원본
데이터셋과도 조인할 수 없다(원시 `user_pseudo_id` 가 US 에 없으므로).

**4) 솔트가 없으면 폴백하지 않고 적재를 거부한다.** `syncGa4BridgeInternal` 은
솔트 부재 시 `failed-precondition` 으로 **던진다**. "솔트가 없으니 일단 원시값으로"
가 프라이버시 약속을 조용히 깨는 유일한 경로인데, 그 경로를 아예 막았다
(테스트: `★ga_key: 솔트가 없으면 원시값으로 폴백하지 않고 null 이다`).

**5) 원문 이벤트가 리전을 넘지 않는다.** US 로 가는 건 방문자당 1행 집계뿐이다
(실측 713행). GA4 원문 이벤트도, 원시 GA4 식별자도 `asia-northeast3` 를 떠나지 않는다.

**6) 랜딩 URL 의 쿼리스트링을 버린다.** 개인을 가리킬 수 있는 토큰이 섞여 들어오는
유일한 필드였다(§4).

**연결되는 지점은 정확히 하나다**: `install_attribution` 이 **자기 행 안에서**
`gaClientId` 옆에 `gaKey` 를 갖는다. 그 표는 원래부터 익명 웹→앱 링크백 표이고
계정 uid 를 담지 않는다. 즉 브리지는 **익명축 ↔ 익명축**만 잇는다. 계정축
(`cost_logs` 등)과는 어느 컬럼으로도 닿지 않는다.

> ★이 설계는 `analyticsProfiles.ts` / `personAxis.ts` 의 축 규율 **안에서** 이뤄졌다.
> 브리지는 `FORBIDDEN_ON_ANONYMOUS_AXIS` 의 어떤 컬럼도 싣지 않는다(§4 표에
> `user_key`/`uid`/`email`/`cost_usd` 계열이 하나도 없다). 계정축 표
> (`analytics_account_profile`/`cost_logs`/`analytics_purchase`)에는 읽기도 쓰기도
> 하지 않는다. 링크축(`analytics_user_install`)도 건드리지 않으므로
> **`PERSON_AXIS_EFFECTIVE_FROM` 게이트와 무관하다** — 게이트가 닫혀 있어도 브리지는
> 정상 동작하고, 열려도 브리지가 넓어지지 않는다. 브리지가 잇는 것은
> 익명축(`ga_key`) ↔ 익명축(`install_key`) 하나뿐이다.

## 5. 조인 — 이게 되는 게 이 티켓의 목적이다

US 안에서, 한 리전, 한 쿼리:

```sql
SELECT
  g.country, g.source, g.medium, g.campaign,
  COUNT(DISTINCT i.install_key)                      AS installs,
  COUNT(DISTINCT IF(e.modelConnected = 1, i.install_key, NULL)) AS connected
FROM `marblo-2253d.marblo_telemetry.ga4_first_touch_current` g
LEFT JOIN `marblo-2253d.marblo_telemetry.analytics_identity` i
       ON i.ga_key = g.gaKey
LEFT JOIN (
  SELECT userId AS installId,
         MAX(IF(event = 'onboarding:model_connected', 1, 0)) AS modelConnected
  FROM `marblo-2253d.marblo_telemetry.events`
  GROUP BY installId
) e ON e.install_key = i.install_key
GROUP BY 1, 2, 3, 4
```

- 위 예시의 모델연결 판정은 **줄인 것**이다. 실제 분모는 하위호환 신호까지 접는
  `modelConnectedPredicateSql()`(`adminAnalytics.ts`) 을 써야 어드민 화면과 수치가
  맞는다 — 여기서는 조인 형태를 보이는 게 목적이라 앵커 이벤트 하나만 썼다.
- ★`analytics_identity` 는 **이 티켓이 만드는 게 아니다.** 사람 축 작업에서 이미
  착지한 익명축 신원표다(`install_key` ↔ `ga_key` ↔ `ft_*`). 그쪽 백필
  (`scripts/backfill-analytics-identity.ts`)이 `install_attribution.gaClientId` 에서
  `pseudonymizeAnalyticsId("ga", ...)` 로 `ga_key` 를 파생하는데, 이 파일의
  `deriveGaKey()` 와 **같은 kind·같은 솔트·같은 스킴**이라 값이 그대로 맞는다.
  실측으로 확인했다(§10.2-(4)). 그래서 브리지는 **표 한 장만 얹고** 조인은 기존
  신원표에 붙인다 — 신원표를 두 벌 만들면 익명축 조인이 에러 없이 갈라진다.
- `ga4_first_touch_current` 는 브리지 위의 뷰로 **`ga_key` 당 가장 이른 유입 1행**만
  남긴다. streaming buffer 창에서 재실행이 겹쳐 같은 키가 두 번 들어가도, 백필을
  나중에 돌려 더 이른 유입을 발견해도, 읽기에서 first-touch 가 강제된다.
- ★`events.userId` 는 익명 설치 UUID 이고 `analytics_identity.install_key` 는 그것의
  HMAC 가명이다. 위 예시처럼 익명축끼리 붙이려면 events 쪽도 같은 가명으로 접어야
  한다(`install` kind). 원시 UUID 와 가명을 직접 `=` 로 비교하면 **에러 없이 0행**이
  된다 — 조용한 실패다.

## 6. 무엇을 만들었나

| 파일                                     | 내용                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| `v3/functions/src/ga4Bridge.ts`          | 순수 로직 — 집계 SQL 조립, 정규화, first-touch 중복제거, 뷰 SQL, 스키마                     |
| `v3/functions/src/ga4Bridge.test.ts`     | 29 tests                                                                                    |
| `v3/functions/src/analyticsPseudonym.ts` | `deriveGaKey()` 추가. **`ga` kind 자체는 이미 main 에 있다**(사람 축 작업) — 새로 만들지 않았다 |
| `v3/functions/src/index.ts`              | `scheduledSyncGa4Bridge`(매일 05:30 KST), `syncGa4Bridge`(어드민 수동/백필), 표·뷰 보장 |

★**만들지 않은 것**(초안에는 있었다): `install_attribution` 의 `gaKey` 컬럼,
`attachGaKey()`, 그리고 별도 신원 뷰. 셋 다 사람 축 작업이 이미 해결해 둔 것을
두 번째로 만드는 일이었다. 브리지가 US 에 더하는 것은 **표 1장 + 뷰 1장**뿐이다.

- 기존 `getAdminCountryFunnel` 의 **메모리 조인은 그대로 뒀다.** 브리지 첫 적재 전이나
  실패 시에도 화면이 죽으면 안 되고, 둘을 한 번에 바꾸면 회귀 원인을 못 가른다.
  브리지 적재가 안정되면 별건으로 승급한다.
- 스키마 변경은 전부 **NULLABLE 추가**뿐이다. 기존 컬럼의 삭제·타입변경·데이터 수정
  없음. **GA4 원본 데이터셋은 읽기만 한다(SELECT).**

### 운영 절차 — 배포 직후 1회

```
syncGa4Bridge({ days: 400 })    # 어드민 콜러블. 반드시 1회.
```

스케줄은 조회창이 3일이라, 백필을 안 돌리면 **창 밖에 첫 방문이 있던 사람의
first-touch 가 창 안 값으로 잘못 잡힌다.** (나중에 돌려도 §5 의 뷰가 자가 치유한다.)

## 7. ★이 브리지를 고쳐도 미로그인 사용자는 여전히 안 보인다

명시해 둔다. 브리지는 **웹 유입 ↔ 앱 설치**를 잇는다. 그런데 앱 텔레메트리는
`flushTelemetry` / `flushHeartbeats` 첫 줄이 `if (!auth.currentUser) return` 이라
**로그인한 실행만** 기록한다. 큐도 인메모리라 로그인 없이 종료하면 영구 유실이다.

그래서:

- 07-21 실측의 **최대 이탈 구간(앱 실행 → 첫 스폰 −73%)** 상당수가 이 사각지대일 수
  있다. 브리지가 완벽해져도 그 구간은 안 보인다.
- 즉 **광고비를 태워도 “설치까지” 는 재고, “설치 후 첫 성공까지” 의 앞단은 못 잰다.**

이건 이 티켓의 범위가 아니다. 복구안(`R1` 미인증 익명 이벤트 경로, `R2` 큐 디스크
내림)은 `attribution-bridge-break-2026-08-21.md` §4 에 있고, **처리방침 문구 정정이
선결이라 승인 대기 중**이다(같은 문서 §5). 계측을 위해 방침을 넘지 않는다.

## 8. ★UTM 명명 규약 — 제안 (사장님 확인 필요)

코드가 아니라 **운영 규약**이다. 지금 정하지 않으면 캠페인마다 제각각 들어와
`GROUP BY campaign` 이 의미를 잃는다. **광고를 켜기 전에** 확정해야 한다.

### 공통 규칙

1. **전부 소문자.** GA4 는 `Google` 과 `google` 을 **다른 값으로 센다.** 표가 반으로
   쪼개진다. (GA4 콘솔에 소문자 강제 옵션이 있지만 BigQuery export 에는 원문이
   남으므로, 규약으로 막는 게 확실하다.)
2. **구분자는 하이픈(`-`) 하나.** 공백·언더스코어·대문자 금지. 공백은 URL 인코딩되어
   `%20` 으로 들어온다.
3. **한글·이모지 금지.** 인코딩 형태로 저장돼 눈으로 못 읽는다.
4. 값은 **정해진 목록에서만** 고른다. 새 값이 필요하면 이 문서에 먼저 추가한다.

### 필드별 규약

| 필드           | 규칙                                     | 허용값 예                                                                                                         |
| -------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `utm_source`   | **플랫폼 이름**. 광고를 산 곳.           | `google`, `naver`, `meta`, `instagram`, `youtube`, `x`, `linkedin`, `reddit`, `producthunt`, `newsletter`, `blog` |
| `utm_medium`   | **비용/전달 방식**. 채널 성격.           | `cpc`(검색광고), `display`, `social-paid`, `social-organic`, `email`, `referral`, `affiliate`                     |
| `utm_campaign` | `{yyyymm}-{목적}-{제품축}`               | `202609-launch-multiagent`, `202610-retarget-pricing`                                                             |
| `utm_content`  | **크리에이티브 변형** — A/B 를 가르는 축 | `hero-a`, `hero-b`, `video-15s`, `banner-728`                                                                     |
| `utm_term`     | **검색 키워드**(검색광고 전용)           | `ai-agent`, `claude-code-gui`                                                                                     |

**`utm_medium` 이 제일 중요하다.** 유료/무료를 가르는 축이 여기라, 여기가 흔들리면
“광고비 대비 효과” 자체를 못 낸다. `cpc` 와 `ppc` 와 `paid` 를 섞어 쓰면 세 채널이
된다 — **`cpc` 하나로 고정**한다.

### 하지 말 것

- **자사 사이트 내부 링크에 utm 을 달지 마라.** GA4 가 세션을 새로 끊어 유입을 자기
  자신에게 귀속시킨다. 내부 링크 추적은 별도 이벤트로 한다.
- `utm_source=marblo` 처럼 **우리 이름을 source 에 넣지 마라.** source 는 “어디서
  왔는가” 다.
- 같은 캠페인을 링크마다 다르게 쓰지 마라(`202609-launch` / `launch-202609` /
  `2026-09-launch` 는 서로 다른 캠페인 3개다).

### 확인 요청 (사장님 판단)

1. 위 `utm_source` / `utm_medium` 허용값 목록을 이대로 확정할지.
2. `utm_campaign` 의 `{yyyymm}-{목적}-{제품축}` 형식을 쓸지.
3. 링크를 만드는 자리를 한 곳으로 모을지(스프레드시트 또는 링크 빌더). 사람이
   손으로 타이핑하는 한 오타는 반드시 들어온다.

## 9. ★트래픽이 들어온 뒤에는 되돌아가서 못 고치는 것

아래는 **그 시점 이후 데이터에만** 반영된다. 이미 들어온 트래픽은 영영 빈칸이거나
틀린 값으로 남는다. 그래서 **광고를 켜기 전에** 처리해야 한다.

| #   | 항목                                              | 늦으면 어떻게 되나                                                                                |
| --- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1   | **BQ 컬럼 추가** (`campaign`/`content`/`term` 등) | 추가 이전 파티션은 영영 null. → 이 티켓에서 미리 만들어 뒀다                                      |
| 2   | **UTM 명명 규약** (§8)                            | 규약 전 캠페인은 표기가 제각각. 사후 정규화는 추측이라 신뢰 못 함                                 |
| 3   | **GA4 `download` 이벤트 계측**                    | 안 쏘던 기간의 다운로드 수는 복원 불가                                                            |
| 4   | **`buildChannel` 표식**                           | 표식 이전 550행은 `dev`/`prod` 구분 불가(`gaClientId` 반복도 추정만)                              |
| 5   | **링크백 도달**(앱→`marblo.app/link`)             | 그 설치는 영원히 GA4 와 안 이어진다. 나중에 앱을 고쳐도 **이미 설치한 사람은 최초 실행이 지났다** |
| 6   | **미로그인 계측**(§7)                             | 로그인 전 이탈자는 이벤트 자체가 생성되지 않는다. 사후 복원 경로 없음                             |
| 7   | **GA4 데이터 보존 기간**                          | GA4 속성 설정의 보존 기간이 지나면 원본이 삭제된다. BQ export 는 export 를 켠 날부터만 존재한다   |
| 8   | **동의 게이트 이전 이벤트**                       | 동의 전 큐잉분은 전송되지 않는다(설계상 정상). 소급 전송하지 않는다                               |

특히 **5번**이 이번 구조의 가장 아픈 자리다. 어트리뷰션 링크백은 **신규 설치의 첫
실행 1회**에만 열리므로, 광고를 켜기 전에 링크백이 실제로 도달하는지 확인하지 않으면
그 캠페인의 유입은 통째로 `(unknown)` 이 된다.

## 10. 검증

### 10.1 로컬 (CI 는 죽어 있어 전부 로컬 실행)

| 항목                    | 명령                                | 결과           |
| ----------------------- | ----------------------------------- | -------------- |
| 브리지 순수 로직        | `npm run test:ga4-bridge`           | **29/29 pass** |
| ★축 순수성(`assertAxisPurity`) | `npm run test:analytics-profiles` | **48/48 pass** |
| ★사람 축 게이트         | `npm run test:person-axis`          | **49/49 pass** |
| 가명화                  | `npm run test:analytics-pseudonym`  | **19/19 pass** |
| 결제 축(회귀)           | `npm run test:analytics-purchase`   | **59/59 pass** |
| 링크백 파싱(회귀)       | `npm run test:install-attribution`  | **13/13 pass** |
| 메모리 조인(회귀)       | `npm run test:country-funnel`       | **10/10 pass** |
| 어드민 분석(회귀)       | `npm run test:admin-analytics`      | **97/97 pass** |
| 타입                    | `npx tsc --noEmit -p v3/functions`  | **0 errors**   |

### 10.2 ★실 BigQuery 실측 (2026-08-21)

초안은 "자격증명이 없어 실 BQ 에 못 돌려 봤다"고 적었다. 이번엔 돌렸다.
**GA4 데이터셋에는 SELECT 와 dry-run 만 했고, 어떤 표도 만들거나 바꾸지 않았다.**

**(1) 리전 제약이 실재한다** — 이 티켓의 전제:

```
marblo-2253d:analytics_543991508  location = asia-northeast3
marblo-2253d:marblo_telemetry     location = US
```

**(2) 집계 쿼리가 실제 GA4 export 에서 돈다.** SQL 을 손으로 다시 쓰지 않고
컴파일된 `buildGa4FirstTouchQuery()` 가 뱉은 **그대로** `days=400` 으로 실행:

| 지표                               |    값 |
| ---------------------------------- | ----: |
| `visitors` (= 브리지가 나를 행 수) | **713** |
| `traffic_source` 보유              | **713 (100%)** |
| `collected_traffic_source` 보유    |   249 |
| `content` 보유                     |     1 |
| `term` 보유                        |    11 |
| `downloads` 합                     |    43 |

→ 브리지 1회분이 US 로 옮기는 건 **713행**이다. GA4 원문 이벤트가 아니라 이 713행뿐.
→ 채택한 first-touch 축(`traffic_source`)이 **전 행에 존재한다** — §3 의 선택이 실측으로 뒷받침된다.
→ ★`campaign`/`content`/`term` 이 거의 비었다는 전제도 확인됐다(content 1, term 11).
  이게 §4 에서 **컬럼을 지금 만들어 두는** 이유다. 비었다고 빼면 광고를 켠 시점 이전이 영구 공백이 된다.

**(3) 뷰·조인 SQL 이 전부 컴파일된다** (`--dry_run`):

| 대상                                                        | 결과 |
| ----------------------------------------------------------- | ---- |
| `ga4_first_touch_current` 뷰                                | validated |
| **§5 목표 조인** — 브리지 ⋈ **라이브** `analytics_identity` | **validated** |

즉 **"GA4 와 우리 텔레메트리를 같은 쿼리에서 본다"** 는 목표가 실제 표에 대고 성립함이 확인됐다.

**(4) ★조인키가 실제로 맞는다** — 이게 제일 중요한 확인이다.

`analytics_identity.ga_key` 는 사람 축 백필이 만들고, 브리지의 `gaKey` 는 이 티켓이
만든다. 둘이 갈리면 조인은 **에러 없이 0행**이 된다(조용한 실패). 실측:

```
라이브 analytics_identity: 593행 / non-null ga_key 550행
  그중 ^ga_[0-9a-f]{24}$ 를 만족하는 행 = 550 (100%)
  → 우리 deriveGaKey() 출력 형식과 동일
```

같은 `kind:raw` HMAC 스킴·같은 솔트·같은 24자 절단이므로 값이 그대로 맞는다.

**(5) ★실제 매칭 가능 건수 — 여기서 불편한 사실이 나온다**

| 항목                                              | 값 |
| ------------------------------------------------- | --: |
| GA4 방문자(400일)                                 | **713** |
| `install_attribution` 의 **distinct** `gaClientId` | **3** |
| `analytics_identity` 의 **distinct** `ga_key`     | **3** |
| 그 3개가 GA4 에도 존재하는가                       | **3 / 3 (100%)** |

→ **브리지는 동작한다.** 링크백된 것은 100% GA4 에서 찾아진다.
→ 그러나 **링크백 자체가 3건뿐이다.** `analytics_identity` 의 593행은 같은 3개
  client_id 의 반복이다. 즉 **713명 중 3명(0.4%)만 웹↔앱이 이어져 있다.**
→ ★그러므로 병목은 리전 브리지가 아니라 **링크백 커버리지**다. 이 티켓을 완벽히
  끝내도 조인 결과는 당분간 3명이다. 브리지는 "GA4 를 SQL 로 볼 수 있게" 만들 뿐,
  없는 링크백을 만들어내지 못한다. 그 구멍은 §7(미로그인 계측)과 별건이다.
  **이 숫자를 숨기지 말고 화면에도 같이 띄워야 한다** — 안 그러면 다음 사람이
  "조인이 3행이네, 브리지가 고장났나" 로 읽는다.

### 10.3 ★실측이 잡아낸 결함 3건 (초안 그대로 배포했으면 터졌다)

**결함 1 — 신원표를 두 번째로 만들고 있었다.**
초안은 `install_attribution` 위에 신원 뷰를 새로 만들었고, 이름을 `analytics_identity`
로 잡았다. 그런데 그 이름은 **이미 라이브 표**로 존재했다(593행, 최신 2026-08-20).
처음엔 "남의 파이프라인 표"로 판단했으나, 원인은 **이 브랜치가 main 보다 31 커밋
뒤처져 있던 것**이었다. 그 표는 남이 아니라 **우리 사람 축 작업의 산출물**이다.
초안의 `ensureView()` 는 `exists()` 만 보고 `setMetadata({view})` 로 가므로,
**살아있는 우리 표를 뷰로 덮으려 든다.**

조치: 신원 뷰를 **폐기**하고 기존 `analytics_identity` 에 조인한다(§5). 덤으로
`install_attribution.gaKey` 컬럼과 `attachGaKey()` 도 지웠다 — 사람 축 백필이 이미
같은 값을 파생하고 있어 두 벌이 될 뻔했다. **브리지가 더 얇아졌다.**
그리고 `ensureView()` 가 기존 객체 타입이 `VIEW` 가 아니면 덮지 않고 던지도록 했다 —
이름은 언제든 또 겹칠 수 있으므로 규율을 주석이 아니라 코드로 세운다.

**결함 2 — 뷰 생성 순서 (배포 첫날 조용히 실패).**
초안의 신원 뷰는 `install_attribution.gaKey`/`buildChannel` 을 참조했는데 그 컬럼을
붙이는 건 링크백 경로였다. 배포 직후 스케줄이 먼저 돌면 컬럼이 없다. 라이브 표에
dry-run 해서 실제로 확인했다: `Error in query string: Unrecognized name: gaKey`.
`scheduledSyncGa4Bridge` 는 에러를 삼키므로 **매일 조용히 실패**했을 것이다.
결함 1 의 조치(신원 뷰 폐기)로 이 참조 자체가 사라져 근본 해소됐다.

**결함 3 — 테스트 파일이 바이너리였다.**
`ga4Bridge.test.ts` 에 리터럴 NUL 바이트가 박혀 있어 git 이 파일 전체를 바이너리로
취급했다 — PR 에서 **diff 가 안 보인다**(리뷰 불가). 유니코드 이스케이프로 바꿨다.
런타임 의미는 동일하고 diff 가 355줄 텍스트로 돌아왔다.

### 10.4 배포 후에 확인해야 남는 것

로컬에서 증명할 수 없는 건 실제 **적재**뿐이다(배포가 있어야 한다).

1. `syncGa4Bridge({days:400})` 1회 백필 → `ga4_first_touch` 행 수가 **713 근처**인가
   (10.2-(2) 가 예측값이다. 크게 다르면 그 차이를 설명해야 한다).
2. §5 조인 → **3행 근처가 정상이다**(10.2-(5)). 0 이면 조인키가 갈린 것이니
   `ANALYTICS_ID_SALT` 가 백필 때와 같은 값인지부터 본다.
