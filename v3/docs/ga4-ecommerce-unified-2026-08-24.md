# GA4 이커머스를 통합 뷰에 붙인다 — 끊어진 사람축 다리를 우회하는 두 번째 채널→매출 경로

티켓 `VV733VRpsfGvijYuPWCl`. 화면 없음. **정의 문서 + 표 한 장 + 뷰 두 벌**이다.
선행: `install-unified-view-2026-08-24.md`(#1196, 통합 뷰 정의) ·
`ga4-region-bridge-2026-08-21.md`(#1111, 리전 브리지) ·
`install-attribution-ga-key-join-2026-08-24.md`(#1195, 조인 키 공간).

> 사장님 지시: "통합뷰 테이블에 이커머스 데이터도 잘 들어가는지 봐줘.
> 우리 장바구니 결제 등 GA4 이커머스 태깅 누락되었으면 그것도 붙이자."

읽는 순서: §1(태깅은 안 빠졌다) → §2(그럼 뭐가 값인가) → §3(왜 표를 새로 만드나)
→ §4(스키마) → §5(사유 사다리) → §6(IAM 판단) → §7(원장↔GA4 대조) → §8(실측 검증)
→ §9(읽는 법·함정) → §10(안 하는 것).

---

## 1. 태깅은 누락되지 않았다 — 실측으로 닫는다

`asia-northeast3` GA4 export, 최근 45일(2026-07-10 ~ 08-23):

| 이벤트             |  건수 | 방문자 |
| ------------------ | ----: | -----: |
| `view_item_list`   |    47 |     28 |
| `view_item`        |     7 |      4 |
| `begin_checkout`   |    18 |      6 |
| `add_payment_info` |     2 |      2 |
| `purchase`         | **1** |      1 |

`purchase` 1건은 페이로드가 다 차 있다 —
`ecommerce.purchase_revenue = 19000` · `purchase_revenue_in_usd = 13.356367` ·
`transaction_id` 실값 · `items` 1개(`item_id = pro`, `item_category = subscription`,
`price = 19000`).

### 1-1. ★`add_to_cart` / `view_cart` 가 없는 건 정상이다

마블로는 **장바구니가 없는 구독 상품**이다. 그 두 이벤트는 존재할 수 없다.
그래서 이 설계는 **컬럼도 사유도 만들지 않는다.** 만들어 두면 영원히 0 인 칸이
생기고, 다음 사람은 그걸 "태깅 누락" 으로 읽는다. 없는 단계를 표에 만들지 않는다.
(단위 테스트가 `cart` 문자열이 스키마·사유·뷰 SQL 어디에도 없음을 잠근다.)

### 1-2. ★`purchase` 1건은 오탐이 아니다 — 원장이 정확히 같은 말을 한다

`marblo_telemetry.analytics_purchase` 35행을 가르면(실측 2026-08-24):

| kind  | source           | account_class | 통화 |  건수 |     금액합 | 기간           |
| ----- | ---------------- | ------------- | ---- | ----: | ---------: | -------------- |
| grant | subscriptions    | external      | —    |    32 |       미상 | 06-24 ~ 08-19  |
| grant | subscriptions    | internal      | —    |     1 |       미상 | 03-25          |
| paid  | lecturePurchases | **internal**  | KRW  |     1 |    104,300 | **04-08**      |
| paid  | billingCharges   | **external**  | KRW  | **1** | **19,000** | **2026-08-07** |

**진짜 외부 결제는 1건, 19,000원, 2026-08-07.** GA4 가 잡은 `purchase` 1건도
같은 날 같은 금액이다. 양쪽이 정확히 맞는다.

> 티켓 본문은 내부 테스트 1건을 `toss` 로 적었는데 실측은 `lecturePurchases`
> 였다. 결론(내부 테스트 1건)은 같아서 설계에 영향이 없다.

### 1-3. ★새로 발견한 함정 두 개

**(a) `transaction_id` 는 `purchase` 를 뺀 전 이벤트에서 리터럴 `'(not set)'` 이다.**
`(direct)` 를 캠페인명으로 세는 것과 **정확히 같은 함정**이다. 이걸 거래 식별자로
세면 `begin_checkout` 18건이 주문 18건으로 둔갑한다. 이 설계는 원시
`transaction_id` 를 US 로 **아예 넘기지 않는다**(§6-2). 넘기는 것은 건수·금액·통화뿐.

**(b) GA4 `traffic_source` 는 전부 `(direct)` 가 아니다.**
`view_item_list` 행에 `github.com/referral` · `youtube.com/referral` ·
`l.threads.com/referral` · `threads/social` · `naver/organic` ·
`mrc-pay.admin.navercorp.com/referral` 이 실려 있다.

> #1196 §6-3 이 "붙는 GA4 행이 전부 `(direct)/(none)/(direct)`" 라고 적은 것은
> **틀린 관찰이 아니라 좁은 관찰**이다. 원장에 실린 `gaClientId` 가 5개뿐이라
> 그 5명만 봤다. GA4 전체 방문자 776명 축에서는 채널이 실제로 갈린다.
> **이 사실이 이 티켓의 값을 만든다** — gaKey 축으로 이커머스를 붙이면
> 채널→퍼널이 실제로 갈린다.

### 1-4. 곁가지 — `view_item`(4명) < `begin_checkout`(6명) 은 순서 역전이 아니다

전 구간 최초 관측일:

```
begin_checkout    2026-07-10 부터
view_item         2026-08-07 부터   ← 태깅이 여기서 배포됐다
view_item_list    2026-08-07 부터   ← 여기서 배포됐다
add_payment_info  2026-08-18 부터
purchase          2026-08-07
```

`begin_checkout` 6명을 사용자별로(원시 `user_pseudo_id` 대신 SHA256 앞 8자리):

| 사용자     | begin_checkout                      | view_item | 판정                                           |
| ---------- | ----------------------------------- | --------: | ---------------------------------------------- |
| `9f346e6f` | 2건 @07-10                          |         0 | 태깅 이전                                      |
| `0bc8278b` | 2건 @08-03                          |         0 | 태깅 이전                                      |
| `cfb52f55` | 2@08-06 + 2@08-07 (+purchase@08-07) |         0 | 배포 당일/직전                                 |
| `d60b6a3a` | 8건 전부 @08-06                     |         0 | 태깅 이전. 이후 방문(08-11/18/22)은 pricing 만 |
| `d4327db3` | 1@08-18                             |   1@08-18 | ✅ 정상                                        |
| `3f6a25b2` | 1@08-20                             |   1@08-20 | ✅ 정상                                        |

**태깅 배포(08-07) 이후 체크아웃한 사용자는 2명이고, 그 2명은 둘 다 `view_item`
이 있다.** `view_item` 없이 결제로 가는 경로는 없다. 코드로도 확인했다 —
`marblo-web/src/app/[locale]/checkout/page.tsx:426` 의 `view_item` `useEffect`
는 `isValid` 만 걸려 있고 `begin_checkout` 과 **같은 페이지**에서 발화한다.

★`view_item_list` 는 pricing 페이지, `view_item` 은 checkout 페이지다 —
두 축의 모수가 다른 것도 정상이다. **고칠 것 없다.**

---

## 2. 그럼 이 티켓의 값은 무엇인가 — **더 짧은 길**이다

#1196 이 만든 수익 축은 이렇게 간다:

```
analytics_purchase(사람 알갱이)
  → user_key
  → marblo_identity.analytics_user_install(링크표)
  → analytics_user_daily.install_key_hmac      ← ★이 다리가 전량 NULL 이다
  → install_key(설치)
```

`analytics_user_daily.install_key_hmac` non-null 행이 **0개**다(실측 2026-08-24,
#1196 §6-2 가 적어 둔 사실 그대로). 그래서 오늘 통합 뷰의 수익은 0 이 아니라
**미상**이다. 게다가 실제 외부 결제자는 링크표 4행 안에 **없다**(실측: 그 사람의
`user_key` 로 링크표를 조회하면 0행). 다리를 놓아도 그 한 건은 안 붙는다.

GA4 는 **같은 세션에 채널과 결제가 같이 실려 있다.** `gaKey` 하나로
채널 → 퍼널 → 결제가 이어진다. 끊어진 다리를 **안 거친다**:

```
install_attribution.gaKeyHmac  =  ga4_ecommerce_current.gaKey
        (설치)                            (채널 + 퍼널 + 결제)
```

**★단 GA4 를 매출의 정본으로 쓰지 않는다.** 광고차단·쿠키거부·ITP 로 샌다.
정본은 원장이다. GA4 는 **채널 귀속용 보조축**으로 넣고, 두 값이 갈리면 숫자를
고르지 말고 **둘 다 보이게** 한다(§7).

---

## 3. 왜 first-touch 브리지에 컬럼을 덧붙이지 않고 표를 새로 만드나

`ga4_first_touch` 는 **덮지 않는 표**다(`selectNewBridgeRows` 가 이미 있는
`gaKey` 를 버린다). 그게 first-touch 의 정의다 — 나중 값이 최초 유입을 덮으면
안 된다.

그런데 **퍼널 카운트는 누적**이라 매번 갱신돼야 한다. 같은 표에 넣으면 카운트가
첫 동기 시점에 **얼어붙고**, 그 사실은 에러 없이 조용히 틀린 숫자로만 나타난다.
이 프로젝트가 세 번 틀린 자리와 같은 종류다.

그래서 표를 나눈다: **유입은 안 덮고, 이커머스는 날짜를 알갱이에 넣어 누적한다.**

### 3-1. ★알갱이를 `(gaKey, eventDate)` 로 잡은 이유

1. **3일 조회창이 멱등해진다.** 이미 읽은 날을 다시 읽어도 같은 값이 나온다.
2. **반쪽짜리 하루가 표에 안 박힌다.** GA4 일별 export 는 완성된 하루만 표로
   만든다(D-1 이 D 오전 착지). `events_intraday_*` 는
   `_TABLE_SUFFIX BETWEEN '2026…' AND '2026…'` 에 **사전순으로 안 걸린다**
   (`'i' > '2'`). 우리가 읽는 날은 항상 완성본이다.
3. **결제가 언제 일어났는지가 공짜로 따라온다**(채널→결제 지연 측정).

### 3-2. ★읽기 뷰가 가장 최근 `syncedAt` 을 이기게 한다

GA4 는 지각 이벤트로 과거 일자 표를 다시 내보낼 수 있다. 쓰기에서 "이미 있는
날은 건너뛴다" 로 막으면 그 교정이 **영영** 반영되지 않는다. 그래서
**append 하고 읽기에서 같은 `(gaKey, eventDate)` 의 가장 최근 `syncedAt` 을
고른다.** 400일 백필이 과거를 실제로 고쳐 준다
(`ga4_first_touch_current` 가 더 이른 유입을 이기게 하는 것과 같은 수법).

★이것이 유입 브리지와 **의도적으로 다른** 규칙이다. 단위 테스트가
"이커머스에는 `selectNewBridgeRows` 를 쓰지 않는다" 를 잠근다.

---

## 4. 스키마

### 4-1. `marblo_telemetry.ga4_ecommerce_daily` (표)

알갱이 = `(gaKey, eventDate)`. 파티션 `eventDate`, 클러스터 `gaKey`.

| 컬럼                   | 타입        | 모드     | 비고                                                   |
| ---------------------- | ----------- | -------- | ------------------------------------------------------ |
| `gaKey`                | STRING      | REQUIRED | HMAC 가명. ★원시 `user_pseudo_id` 는 US 로 안 넘어온다 |
| `eventDate`            | DATE        | REQUIRED | GA4 `event_date`                                       |
| `viewItemListEvents`   | INT64       | NULLABLE |                                                        |
| `viewItemEvents`       | INT64       | NULLABLE |                                                        |
| `beginCheckoutEvents`  | INT64       | NULLABLE |                                                        |
| `addPaymentInfoEvents` | INT64       | NULLABLE |                                                        |
| `purchaseEvents`       | INT64       | NULLABLE |                                                        |
| `purchaseRevenue`      | **NUMERIC** | NULLABLE | 이벤트 통화 기준. 통화가 섞이면 NULL                   |
| `purchaseRevenueUsd`   | **NUMERIC** | NULLABLE | GA4 환산값. 통화가 섞여도 합산 가능(근사치)            |
| `purchaseCurrency`     | STRING      | NULLABLE | 통화가 정확히 1개일 때만                               |
| `currencyCount`        | INT64       | NULLABLE | 그날 결제의 distinct 통화 수. 0 = 결제 없음            |
| `syncedAt`             | TIMESTAMP   | REQUIRED | 읽기 뷰의 tie-break 축                                 |

★금액은 **NUMERIC** 이다. GA4 는 FLOAT64 로 주지만 돈을 float 로 두면 합계가
미세하게 어긋나고, `INT64 → NUMERIC` 은 BigQuery 가 제자리 변경을 허용하지
않는다(`analytics_purchase.amount` 와 같은 판단).

★덧붙이는 컬럼은 전부 NULLABLE 이어야 한다. REQUIRED 를 덧붙이면 BigQuery 가
거부하고, 거부당하면 적재가 통째로 막힌다.

### 4-2. `marblo_telemetry.ga4_ecommerce_current` (읽기 뷰)

`gaKey` 당 1행. 두 단계다:

1. `(gaKey, eventDate)` 당 가장 최근 `syncedAt` 한 행만 남긴다.
2. 그 위에서 `gaKey` 로 롤업 —
   카운트는 SUM, 금액은 SUM, 통화 수는
   `GREATEST(MAX(currencyCount), COUNT(DISTINCT purchaseCurrency))`.

★통화 수를 두 방향으로 세는 이유: **하루 안에서** 섞였을 수도(MAX),
**날짜를 건너뛰며** 섞였을 수도(COUNT DISTINCT) 있다. 둘 중 큰 쪽이 맞다.

★**결제가 0건이면 매출은 `0원`이다(NULL 아님).** NULL 인 자리는 통화가 섞여
**더할 수 없는** 경우 하나뿐이다. 이게 "0 과 미상을 가른다" 의 실물이다.

추가로 `firstEcommerceDate` / `lastEcommerceDate` / `firstPurchaseDate` 를 낸다.

### 4-3. 통합 뷰에 붙는 컬럼 (`v_install_unified`)

```
ga4ViewItemListEvents   ga4ViewItemEvents      ga4BeginCheckoutEvents
ga4AddPaymentInfoEvents ga4PurchaseEvents
ga4FirstEcommerceDate   ga4LastEcommerceDate   ga4FirstPurchaseDate
hasGa4EcommerceRow      ga4EcommerceMissingReason
ga4RevenueTotal         ga4RevenueCurrency     ga4RevenueUsdApprox
ga4RevenueCurrencyCount ga4RevenueMissingReason
```

결제 뷰(`v_install_unified_revenue`)에는 여기에 더해:

```
revenueLedger  ← ★revenueTotal 에서 이름이 바뀌었다 (§7-1)
revenueDivergenceReason
```

---

## 5. 사유 사다리 — #1196 의 배열을 **이어받는다**, 새로 적지 않는다

#1196 은 "사유 배열 하나가 정본이고 SQL CASE 도 TS 판정도 거기서 생성된다" 를
규약으로 뒀다. 이 티켓은 그 규약을 **강화한다.**

### 5-1. 다리 세 칸을 하나의 배열로 뽑아냈다

채널 축과 이커머스 축은 **같은 다리**로 붙는다(`gaKeyHmac = gaKey`).
그래서 앞 세 칸을 `GA4_JOIN_REASONS` 배열 하나로 뽑고, 두 사다리가 그걸 **편다**:

```ts
GA4_JOIN_REASONS = [no_ledger_row, no_ga_client_id, key_mismatch];
CHANNEL_REASONS = [...GA4_JOIN_REASONS, no_ga4_row, no_utm];
GA4_ECOMMERCE_REASONS = [...GA4_JOIN_REASONS, no_ga4_ecommerce_row];
GA4_REVENUE_REASONS = [...GA4_ECOMMERCE_REASONS, ga4_mixed_currency];
```

손으로 두 벌 적으면 반드시 갈리고, 갈리면 "채널은 `key_mismatch` 인데 이커머스는
`no_ledger_row`" 같은 **설명 불가능한 조합**이 표에 나온다. 단위 테스트가
`CHANNEL_REASONS[i] === GA4_ECOMMERCE_REASONS[i]`(같은 객체)를 잠근다.

### 5-2. ★`no_ga4_row` 와 `no_ga4_ecommerce_row` 를 반드시 가른다

| 사유                   | 뜻                                                    | 고칠 곳            |
| ---------------------- | ----------------------------------------------------- | ------------------ |
| `no_ga4_row`           | 유입 브리지에 그 방문자가 없다                        | GA4 브리지 백필    |
| `no_ga4_ecommerce_row` | 유입은 잡혔는데 이커머스 페이지를 **한 번도 안 봤다** | 고칠 것 없음(사실) |

합치면 무엇을 고쳐야 하는지 못 읽는다. §8 의 실측에서 이 두 값이 실제로
갈리는 것을 확인했다(`hasGa4Row = true` / `hasGa4EcommerceRow = false`).

### 5-3. ★사다리를 왜 둘로 나눴나 — 카운트와 금액

`ga4EcommerceMissingReason`(퍼널 카운트)과 `ga4RevenueMissingReason`(금액)이
**따로** 있다. 금액 사다리가 정확히 한 칸(`ga4_mixed_currency`) 길다.

통화가 섞이면 **금액만** 못 더한다. 퍼널 카운트는 멀쩡한데 그것까지 NULL 로
지우면 멀쩡한 사실을 통화 때문에 버리는 것이다. §8 실측에서 이 분리가 실제로
값을 살렸다 — 68개 설치가 `ga4_mixed_currency` 인데 `beginCheckout` 카운트는
68개 전부 살아 있다.

### 5-4. 사유별 `kind`

| kind        | 뜻                             | 어디에                        |
| ----------- | ------------------------------ | ----------------------------- |
| `unknown`   | 모른다                         | 조인·통화 사유 전부           |
| `true_zero` | 안다, 없었다                   | `no_utm` 만                   |
| `divergent` | **양쪽 다 아는데 서로 다르다** | ★새로 생긴 부류. §7 대조 전용 |

`divergent` 를 `unknown` 에 뭉치면 "못 봤다" 와 "봤는데 안 맞는다" 가 같은 칸에
들어가 **대조 자체가 무의미해진다.**

---

## 6. ★데이터셋 경계 — GA4 이커머스는 텔레메트리 뷰에 둔다 (판단과 근거)

#1196 은 결제 컬럼을 `marblo_identity` 쪽 뷰로 갈랐다. 이 티켓은 GA4 이커머스를
**`marblo_telemetry` 쪽에 둔다.** 다른 판단이므로 근거를 적는다.

### 6-1. #1196 이 든 근거는 "뷰가 링크표를 읽는다" 였다

원문(installUnified.ts 머리말):

> 결제 컬럼을 `marblo_telemetry` 뷰에 넣으면 텔레메트리 읽기 권한만 있는 사람이
> **뷰를 통해 링크표를 읽는다** — 이름만 다른 같은 방이 된다.

즉 경계의 근거는 **"매출은 민감하다"** 가 아니라
**"뷰가 `marblo_identity.analytics_user_install` 을 읽는다"** 는 기계적 사실이다.

### 6-2. GA4 이커머스는 그 표를 읽지 않는다 — 세 가지 확인

1. **조인 경로에 링크표가 없다.** `gaKeyHmac → gaKey` 한 번이 전부다.
   `marblo_identity` 의 어떤 표도 참조하지 않는다.
   (단위 테스트가 텔레메트리 뷰 SQL의 모든 표 참조를 훑어 `marblo_identity`
   가 하나도 없음을 잠근다 — 주석에 이름이 나오는 것과는 별개다.)
2. **조인키가 이미 그 뷰에 있다.** `gaKeyHmac` 은 #1196 이 이미
   `v_install_unified` 에 실어 뒀다. 새 식별자를 들이지 않는다.
3. **결제 원장 자체가 이미 텔레메트리에 산다.** `analytics_purchase` 는
   `marblo_telemetry` 데이터셋 표다. 즉 이 프로젝트에서 **매출 자체는 제한
   대상이 아니다** — 제한 대상은 설치↔사람 링크표다.

→ #1196 이 든 근거가 GA4 이커머스에는 **기계적으로 성립하지 않는다.** 애매하지
않다. 그래서 텔레메트리에 둔다.

### 6-3. 그래도 좁힌 것 두 가지

- **원시 `transaction_id` 를 US 로 안 넘긴다.** 그건 결제 원장 행을 직접
  가리키는 주문 식별자고, 이 표의 축(익명 gaKey)과 다른 공간이다. 넘기는 것은
  건수·금액·통화뿐이다. (단위 테스트가 스키마·쿼리·뷰 SQL 어디에도
  `transaction_id` 가 없음을 잠근다.)
- **원장↔GA4 대조 컬럼은 결제 뷰(identity)에만 둔다.** 대조는 원장 금액을
  읽어야 하고, 원장 금액은 링크표를 거쳐야 나온다. 그 계산은 링크표가 사는
  쪽에 남는다.

---

## 7. 원장 ↔ GA4 대조 — 숫자를 고르지 않는다

### 7-1. `revenueTotal` → `revenueLedger` 로 이름을 바꿨다

이 뷰에는 이제 **매출 축이 둘**(원장·GA4)이고, `Total` 은 그중 어느 쪽인지
말하지 않는다. **정본이 원장이라는 사실을 컬럼 이름이 직접 말하게 한다.**

> 안전한 개명이다 — `revenueTotal` 을 읽는 코드가 저장소에 하나도 없고
> (`v_install_unified_revenue` 는 아직 BQ 에 만들어지지도 않았다), 개명 전에
> grep 으로 확인했다.

### 7-2. `revenueDivergenceReason` 사다리

**별칭 규약**: `j` = 조인 결과. 위에서부터 첫 번째 해당.

| #   | 사유                | kind      | 뜻                                                                    |
| --- | ------------------- | --------- | --------------------------------------------------------------------- |
| 1   | `ledger_unknown`    | unknown   | 원장 쪽을 모른다 → 대조 불가. **정본이 먼저 답한다**                  |
| 2   | `ga4_unknown`       | unknown   | GA4 쪽을 모른다 → 대조 불가                                           |
| 3   | `currency_mismatch` | unknown   | 통화가 다르다. ★**환산하지 않는다**                                   |
| 4   | `ga4_missed`        | divergent | 원장에 있는데 GA4 가 못 봤다 — 광고차단·쿠키거부의 정상적 모습        |
| 5   | `ledger_missed`     | divergent | GA4 에 있는데 원장에 없다 — 적재 지연이거나 귀속이 다른 사람에게 갔다 |
| 6   | `amount_differs`    | divergent | 둘 다 아는데 금액이 다르다                                            |
| —   | **NULL**            | —         | **두 축이 같다.** 둘 다 0 이어도 같은 것이다                          |

★3번에서 환산하지 않는 이유: 환율을 여기서 고르면 **그 환율이 어디에도 안 적힌
채** 매출 숫자가 된다. 통화가 다르면 다르다고만 말한다.

★대조는 두 축의 금액을 **확정한 뒤에** 한다(`resolved` CTE). 그 한 층이 없으면
"미상 vs 0" 을 "값이 다르다" 로 잘못 읽는다.

### 7-3. ★팬아웃을 사유에 넣지 **않은** 이유 (판단을 남긴다)

한 사람이 기기 여러 대면 원장 금액이 여러 행에 반복되고(`personInstallCount`),
한 브라우저에 설치가 480건이면 GA4 금액이 480행에 반복된다(`gaKeyInstallCount`).
그래서 **SUM 은 틀린다.**

그런데 팬아웃은 *합산*을 깨는 것이지 *한 행의 비교*를 깨지 않는다 — 한 행에서
`revenueLedger` 는 그 사람의 총액, `ga4RevenueTotal` 은 그 브라우저의 총액으로
각각 잘 정의돼 있고, 반복돼도 값은 같다.

그리고 실측상 팬아웃을 사유에 넣으면 **거의 모든 행이 그 사유로 덮여** 이 컬럼이
상수가 된다 — 즉 아무것도 못 말하게 된다. 그래서 팬아웃은 사유가 아니라
**이미 있는 두 카운트 컬럼**으로 드러낸다. 합산 규칙은 §9-2 에 적었다.

---

## 8. 검증 — 실측 (2026-08-24)

### 8-1. 배포 전에 잠근 것 — 단위 테스트

```bash
cd v3/functions
npm run test:install-unified   # 57개 (기존 34 + 신규 23)
npm run test:ga4-bridge        # 57개 (기존 39 + 신규 18)
npx tsc --noEmit -p tsconfig.json
npm run check:person-axis-isolation
```

전부 통과. 잠그는 것:

- 다리 세 칸이 채널·이커머스에서 **같은 객체**다(배열이 갈릴 수 없다).
- 금액 사다리가 퍼널 사다리보다 **정확히 한 칸** 길다.
- 통화가 섞여도 퍼널 카운트는 **안 지워진다.**
- `currencyCount = 0`(결제 0건)에서 사유가 **NULL** 이다 — 0 은 사실이다.
- `'(not set)'` 은 통화가 아니다.
- 뷰 SQL·스키마·소스 쿼리 어디에도 `transaction_id` 가 없다.
- 텔레메트리 뷰가 참조하는 표에 `marblo_identity` 가 하나도 없다(§6).
- 대조 사유가 모든 입력 조합(2×2×3×3×3×3=324)에서 정확히 0개 또는 1개다.

### 8-2. 왜 뷰를 실제로 만들지 못하나 — 라이브 상태

| 확인                                    | 실측                                                            |
| --------------------------------------- | --------------------------------------------------------------- |
| `install_attribution` 스키마            | `gaKeyHmac`/`utmContent`/`utmTerm` **없음** (#1195 미배포)      |
| `v_install_unified` · `_revenue`        | **없음** (#1196 미프로비저닝)                                   |
| `ga4_first_touch`                       | 100행 · firstVisitDate 08-19~08-22 (3일창만, 400일 백필 미실행) |
| `analytics_user_daily.install_key_hmac` | non-null **0행**                                                |
| 링크표                                  | 4행 / 사람 3명. ★외부 결제자는 그 안에 **없다**                 |

그래서 #1196 §7-2-1 과 **같은 수법**으로 검증했다 — 생성된 SQL 을 한 글자도
고치지 않고, 없는 표만 타입이 맞는 셔틀(shim)로 갈아 끼워 **라이브 데이터로**
돌렸다.

### 8-3. GA4 소스 쿼리 — 생성된 SQL 그대로, 라이브 (`asia-northeast3`)

> ★`asia-northeast3` 쿼리는 **location 을 명시해야** 돈다. US 기본으로 쏘면
> `not found in location US` 가 뜨는데 **테이블이 없는 게 아니다.**

```
daily_rows visitors  vil  vi  bc  api  pur  revenue  revenue_usd  currencies  max_cur
        37       31   47   7  18    2    1  19000.0    13.356367         KRW        1
```

★§1 의 이벤트 인벤토리와 **전부 일치**한다(47/7/18/2/1). 금액·통화·USD 환산값도
`purchase` 1건 그대로다.

### 8-4. 롤업 뷰 로직 — 라이브

```
ga_keys  purchase  checkout  view_item  list  revenue_zero  revenue_null  revenue  first_purchase
     31         1         6          4    28            30             0    19000      2026-08-07
```

★`revenue_zero = 30`, `revenue_null = 0` — **이게 이 티켓의 핵심이 도는 증거다.**
30명은 매출을 **안다**(0원이다). 모르는 사람은 0명이다.
방문자 카운트(28/4/6/1)도 §1 과 정확히 같다. `first_purchase = 2026-08-07` 은
원장의 `paid/external` 날짜와 같다.

### 8-5. 통합 뷰 — 행수 보존 + 현재 상태 (US, 셔틀)

```
profiles  unified  distinct_installs        channelMissing  ga4EcommerceMissing  installs
     608      608                608          key_mismatch         key_mismatch       565
                                             no_ledger_row        no_ledger_row        43
```

★셋이 같다 — 이커머스 조인이 행을 **부풀리지도 삼키지도 않는다.**
그리고 두 축의 사유가 같은 다리를 공유하므로 같은 값이 나온다(§5-1 그대로).

### 8-6. 배포 후 '모양' 시뮬레이션 — 사다리 전 칸이 실제로 갈린다

원시→가명 대응을 빈도 순위로 임시 배정했다(#1196 §7-2-1(3) 과 같은 수법).
★**귀속 주장이 아니다** — 조인이 채워지는지, 사유가 갈리는지만 본다.

```
channelMissing  ga4EcommerceMissing   ga4RevenueMissing    hasGa4Row  hasEcomRow  installs  funnel_known  revenue_known
no_utm          NULL                  NULL                      true        true       496           496            496
no_utm          NULL                  ga4_mixed_currency        true        true        68            68              0
no_ledger_row   no_ledger_row         no_ledger_row            false       false        43             0              0
no_utm          no_ga4_ecommerce_row  no_ga4_ecommerce_row      true       false         1             0              0
                                                                                       ---
                                                                                       608  ← 행수 그대로
```

읽는 법:

- **2행**: `ga4_mixed_currency` — 금액만 미상(`revenue_known = 0`)이고 퍼널
  카운트는 68개 **전부 살아 있다**(`funnel_known = 68`). §5-3 의 두 사다리
  분리가 실제로 값을 살렸다.
- **4행**: `hasGa4Row = true` / `hasGa4EcommerceRow = false` — 유입은 잡혔는데
  이커머스를 한 번도 안 봤다. §5-2 의 구분이 실제로 갈린다.
- 다른 셔틀 배치에서 `revenue_zero = 17` / `revenue_null = 0` 도 확인했다 —
  0 과 미상이 표 안에서 갈린다.

### 8-7. 원장 ↔ GA4 대조 — 사다리 전 칸을 **SQL CASE 로도** 태웠다

결제 체인(`install_key_hmac` 다리 + 링크표)을 흉내 내고, 이커머스 금액을
조각내 심어 모든 분기를 태웠다. 단위 테스트는 TS 판정을 잠그지만, **SQL CASE 는
다른 구현**이라 따로 태워야 한다.

```
divergence              installs  ledger_pos  ledger_zero  ledger_null  ga4_pos  ga4_zero  ga4_null  ledger_cur  ga4_cur
ledger_missed                292           0          292            0      292         0         0        NULL  USD,KRW
(일치 — 사유 NULL)            235         235            0            0      235         0         0         KRW      KRW
ga4_unknown                   43          20           23            0        0         0        43         KRW     NULL
amount_differs                29          29            0            0       29         0         0         KRW      KRW
currency_mismatch              9           9            0            0        9         0         0         KRW      USD
```

앞선 배치에서 나머지 두 칸도 확인했다:

```
ledger_unknown               564           0            0          564      480        16        68        NULL      ...
ga4_missed                     1           1            0            0        0         1         0         KRW     NULL
```

★`ledger_unknown` 564행이 **이 티켓의 존재 이유를 한 줄로 보여 준다** —
원장 축은 미상인데 GA4 축은 480행이 살아 있다. 끊어진 다리를 안 거쳤다.

★`currency_mismatch` 9행에서 `ledger_cur = KRW`, `ga4_cur = USD` 다.
**환산하지 않고 다르다고만 말했다.**

### 8-8. ★검증이 말하지 **않는** 것

**진짜 외부 결제가 1건이다.** 이 검증은 "배선이 도는가" 까지다.
전환율·채널 성과·추세를 이 숫자로 말하지 마라. §8-6/8-7 의 큰 숫자는 전부
**셔틀이 만든 모양**이고, 실측 매출은 19,000원 **한 건**이다.

---

## 9. 읽는 법 — 함정 넷

### 9-1. `(not set)` / `(direct)` 는 값이 아니다

`transaction_id = '(not set)'` 을 주문으로 세지 마라(§1-3a). 이 설계는 애초에
그 컬럼을 안 들여온다.

### 9-2. ★SUM 하기 전에 두 카운트 컬럼을 봐라

| 축                          | 배수 컬럼            | 실측 최댓값 |
| --------------------------- | -------------------- | ----------- |
| 원장 수익(`revenueLedger`)  | `personInstallCount` | —           |
| GA4 수익(`ga4RevenueTotal`) | `gaKeyInstallCount`  | **539**     |

`SUM(ga4RevenueTotal)` 은 틀린다. 실측 시뮬레이션에서 **480개 설치**가
19,000원짜리 결제 **한 건**을 공유했다(= 브라우저 한 대). 접으려면:

```sql
-- ★GA4 매출은 gaKey 로 접는다. 설치 알갱이에서 SUM 하면 배수만큼 부푼다.
SELECT channelSource, channelMedium,
       SUM(rev) AS ga4_revenue, COUNT(*) AS browsers
FROM (
  SELECT gaKeyHmac, ANY_VALUE(channelSource) channelSource,
         ANY_VALUE(channelMedium) channelMedium, ANY_VALUE(ga4RevenueTotal) rev
  FROM `marblo-2253d.marblo_telemetry.v_install_unified`
  WHERE ga4RevenueMissingReason IS NULL AND gaKeyHmac IS NOT NULL
  GROUP BY gaKeyHmac
)
GROUP BY 1, 2 ORDER BY ga4_revenue DESC;
```

### 9-3. `ga4RevenueUsdApprox` 는 GA4 환율이다

통화가 섞여도 합산이 성립하는 유일한 칸이지만 **GA4 가 자기 환율로 환산한
근사치**다. 회계 숫자가 아니다. 컬럼 이름에 `Approx` 를 박아 뒀다.

### 9-4. 채널 축과 이커머스 축의 신선도는 **같다**

두 축이 같은 조회창(같은 `rangeDays`)으로 **한 번에** 돈다. 스케줄을 두 벌
두면 신선도가 갈리고, 갈린 채로 조인하면 아무도 그 사실을 모른다.
이커머스 집계가 실패해도 유입 적재는 되돌리지 않고, 실패 사실을 `notes` 로
드러낸다(`ecommerceScanned = null`).

---

## 10. 어떻게 만드나 · 안 하는 것

### 10-1. 순서 (셋 다 필요하다)

```bash
# 1) 배포 — ensureGa4EcommerceTable() 이 표를, ensureView() 가 뷰를 만든다
cd v3/functions && npm run deploy

# 2) 최초 1회 전 구간 백필 (이커머스도 같이 돈다)
#    콜러블 syncGa4Bridge 에 { days: 400 }

# 3) 통합 뷰 프로비저닝
npm run provision:install-unified                 # dry-run
npm run provision:install-unified -- --apply
npm run provision:install-unified -- --apply --replace-views   # 본문 교체
```

★`provision-install-unified` 는 `ga4_ecommerce_current` 가 없으면 **무엇을
돌려야 하는지 말하고 멈춘다.** BigQuery 의 `no such field` / `not found` 를
그대로 흘리면 다음 사람이 원인을 못 찾는다.

### 10-2. 안 하는 것

- **GA4 를 매출 정본으로 쓰지 않는다.** 보조축이다.
- **없는 이벤트를 만들지 않는다.** `add_to_cart` / `view_cart` 는 없는 게 정상이다.
- **원시 `transaction_id` / `user_pseudo_id` 를 US 로 넘기지 않는다.**
- **통화를 환산하지 않는다.** 다르면 다르다고 적는다.
- **두 축이 갈릴 때 숫자를 고르지 않는다.** 둘 다 보이게 하고 사유를 적는다.
- **`view_item` 태깅 순서 문제를 고치지 않는다.** 고칠 게 없다(§1-4).
- **`analytics_user_daily.install_key_hmac` 백필은 이 티켓 소관이 아니다.**
  이 티켓은 그 다리를 **우회하는 두 번째 경로**를 여는 것이지 다리를 놓는 게
  아니다. 다리가 놓이면 두 축이 대조되기 시작하고, 그때 `revenueDivergenceReason`
  이 비로소 일한다.
