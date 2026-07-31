# 포트원(PortOne) 전환 타당성 — 실측 조사

- 티켓: `SRMqm9exHDzHjQY0qcZ9`
- 작성: 2026-07-31
- 범위: **조사·문서만. 코드 변경 0줄.**
- 웹 실측은 전부 gstack `/browse` 헤드리스 브라우저로 공식 문서를 직접 열어 확인했다. 문서에 없는 값은 **`확인필요`** 로 표기했고, 추측을 사실로 적지 않았다.

---

## 0. 결론 먼저

**권고: 조건부 GO — 단, "코드부터 갈아엎기"가 아니라 "포트원으로 병렬 접수를 먼저 걸고, 코드 전환은 계약 완료 뒤".**

전환을 지지하는 근거와 반대하는 근거가 정확히 갈린다:

|                                  | 내용                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ❌ **포트원이 못 해주는 것**     | **카드사 심사를 우회하지 못한다.** 포트원 문서가 직접 명시: "카드사 심사는 PG사에서 전 카드사로 심사를 요청… **보통 2주 정도 소요**". 토스 가이드의 10~14일과 같은 숫자다. 심사 주체가 카드사로 동일하기 때문. **지금 지연의 원인이 카드사 심사 단계라면, 포트원 전환은 시간을 줄이지 못하고 오히려 (신규 PG 계약 + 보증보험 + 코드 이전) 만큼 늘린다.** |
| ✅ **포트원이 실제로 해주는 것** | ① **한 번의 신청서로 여러 PG사에 동시 접수** — 한 곳이 막혀도 다른 곳이 열린다(단일 벤더 종속 해소). ② **코드 1벌로 국내 PG 9곳 + 간편결제 전부** 를 붙일 수 있다(§3.2 매트릭스가 실측 근거). ③ 월 순거래액 5,000만원 미만은 **포트원 이용료 무료**. ④ 웹훅에 **서명 검증이 있다**(현재 우리 Toss 웹훅은 서명이 없어 재조회로 때우는 중).                |
| ✅ **지금이 전환 최적기인 이유** | 카드사 심사가 아직 안 끝났다 = **운영환경 실결제가 구조적으로 불가능** = **이전해야 할 실 Toss 빌링키 구독자가 사실상 없다.** 마이그레이션의 가장 비싼 부분(무중단 구독자 이전)이 지금은 공짜다. 심사가 끝난 뒤에 옮기면 이 비용이 실제로 발생한다.                                                                                                      |

**따라서 갈림길은 기술이 아니라 "지금 토스 심사가 어느 단계에서 멈춰 있는가" 하나다.**

- 멈춘 지점이 **토스페이먼츠 입점·계약 심사**(가맹 자체가 안 나옴) → **GO.** 포트원으로 KG이니시스·NHN KCP 등에 병렬 접수하면 실제로 빨라진다.
- 멈춘 지점이 **카드사 심사**(계약은 됐고 카드사 응답 대기) → **NO(대기).** 포트원으로 갈아타면 카드사 심사를 처음부터 다시 받는다. 기다리는 게 빠르다.

→ **이 한 가지는 코드로 확인 불가**(사장님/계약담당자만 안다). 오케스트레이터에 확인 요청했다(§7 참조). 다만 답과 무관하게 **비용이 0에 가까운 병행 조치**가 있다: 포트원 관리자콘솔 가입 + 테스트 채널 발급은 계약 전에도 가능하므로(§3.1), 접수 전에 연동 PoC를 미리 끝내 둘 수 있다.

---

## 1. 현 Toss 연동 표면 지도 (실측)

결제 코드가 **3개 층 + 1개 죽은 층**으로 갈라져 있다. Toss 결속은 아래가 전부다.

### 1.1 (A) marblo-web — 웹 체크아웃 (Next.js, Vercel)

| 파일                                                    | Toss 결속 지점                                                                                                                                                                      |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `marblo-web/src/lib/toss.ts`                            | `TOSS_CLIENT_KEY = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY`, `loadTossPayments()` 래퍼 (6줄)                                                                                        |
| `marblo-web/src/app/[locale]/checkout/page.tsx`         | `@tosspayments/tosspayments-sdk` 동적 import 3곳. 구독 = `payment.requestBillingAuth()`(빌링 인증창), 강의 = `payment.requestPayment()`. SDK preload(111~122), 결제 핸들러(142~205) |
| `marblo-web/src/app/[locale]/checkout/success/page.tsx` | 리다이렉트 복귀 처리 — `confirmLecturePayment` / `issueBillingKey` 콜러블 호출(78~114)                                                                                              |
| `marblo-web/package.json`                               | `@tosspayments/tosspayments-sdk: ^2.6.0` (유일한 결제 의존성)                                                                                                                       |

★ 강의 체크아웃은 `checkout/page.tsx` 의 의도적 가드로 **진입 자체가 차단**돼 있다(`type === "lecture"` → 강의 상세로 `router.replace`). `docs/toss-review/README.md` 에 배경이 기록돼 있다.

### 1.2 (B) v3/functions — 서버(Cloud Functions). **전환 작업의 90%가 여기 있다**

`v3/functions/src/index.ts` 의 Toss 결속 콜러블/엔드포인트 (라인은 현재 HEAD 기준):

| 심볼                                           | 라인        | 역할                                                    | Toss API                                |
| ---------------------------------------------- | ----------- | ------------------------------------------------------- | --------------------------------------- |
| `createTossCheckout`                           | 750         | 주문 생성(orderId·amount 채번)                          | —                                       |
| `confirmTossPayment`                           | 792         | 결제 승인 + 구독 문서 기록                              | `POST /v1/payments/confirm`             |
| `fetchTossPaymentStatus`                       | 899         | 웹훅용 재조회 헬퍼                                      | `GET /v1/payments/{paymentKey}`         |
| `tossWebhook`                                  | 924         | 결제 상태 웹훅 수신(**서명 없음** → body 불신 + 재조회) | —                                       |
| `issueBillingKey`                              | 1169        | 빌링키 발급 + 첫 청구(원자적)                           | `POST /v1/billing/authorizations/issue` |
| `chargeBillingKey`                             | 1283        | 수동 정기청구                                           | `POST /v1/billing/{billingKey}`         |
| `cancelTossSubscription`                       | 1373        | 구독 해지                                               | —                                       |
| `createLectureOrder` / `confirmLecturePayment` | 1410 / 1458 | 강의 단건(현재 진입 차단)                               | `POST /v1/payments/confirm`             |
| `scheduledReconcileToss`                       | 5111        | 웹훅 유실 보정 크론                                     | `reconciliation.ts`                     |
| `scheduledChargeSubscriptions`                 | 5134        | 정기 갱신 크론(`paymentProvider == "toss"` 로 쿼리)     | `POST /v1/billing/{billingKey}`         |
| `triggerReconcile`                             | 5239        | 수동 보정 트리거                                        | —                                       |

순수 로직 모듈(전부 단위테스트 존재 — 전환 시 **재사용 가능**, PG 중립):

| 파일                                         | 내용                                                    | PG 결속도                                                                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v3/functions/src/billing.ts` (251줄)        | 플랜 가격·주기·멱등키·갱신 대상 선정·성공/실패 상태전이 | **낮음** — `selectDueForCharge()` 가 `paymentProvider !== "toss"` 를 보고, `SubscriptionSnapshot` 에 `tossBillingKey`/`tossCustomerKey` 필드명이 박혀 있는 정도 |
| `v3/functions/src/webhookVerify.ts` (119줄)  | Toss 웹훅 판정(재조회 기반) + Paddle HMAC 검증          | **높음** — `classifyTossPaymentResponse`, `subscriptionActionForTossStatus`, `resolveTossWebhookAction` 3함수가 Toss status 문자열에 직결                       |
| `v3/functions/src/reconciliation.ts` (295줄) | pendingOrders 기반 보정. Toss/Paddle 2종                | **중간** — 스켈레톤은 공용, PG별 조회 URL만 다름                                                                                                                |
| `v3/functions/src/entitlement.ts` (93줄)     | 권한 판정                                               | 낮음                                                                                                                                                            |

테스트: `v3/functions/tests/billing.test.mjs`, `webhookVerify.test.mjs`, `reconciliation.test.mjs`, `v3/tests/unit/subscription-cancel-billing.test.ts`.

Firestore 스키마 결속(`subscriptions/{userId}`): `paymentProvider: "toss"|"paddle"|"founder_grant"`, `tossBillingKey`, `tossCustomerKey`, `tossPaymentKey`. 타입 정본은 `v3/src/types/subscription.ts:10` (`PaymentProvider = "paddle" | "toss"`).

환경변수(값 미출력, 이름만): `TOSS_SECRET_KEY`, `TOSS_CLIENT_KEY`(+`_PROD`), `TOSS_WEBHOOK_SECRET`, `TOSS_API_URL`/`TOSS_API_BASE`, `NEXT_PUBLIC_TOSS_CLIENT_KEY`(웹), `VITE_TOSS_CLIENT_KEY`(앱).

### 1.3 (C) v3 앱(Electron 렌더러) — 구독 결제 UI

| 파일                                         | Toss 결속 지점                                                                                                                                                                                                                            |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v3/src/components/settings/BillingPage.tsx` | `window.TossPayments` 를 **CDN 스크립트로 직접 로드**(544~560 SDK 로더). 결제수단 4종 매핑 `card_kr/naverpay/kakaopay/tosspay` → `CARD/NAVERPAY/KAKAOPAY/TOSSPAY`(109~127, 189). `toss_success`/`toss_fail` 쿼리 리다이렉트 콜백(217~226) |
| `v3/src/services/billingService.ts`          | `createTossCheckout` / `confirmTossPayment` 콜러블 래퍼(158~183) + Paddle 경로                                                                                                                                                            |

**앱 단건결제는 없다.** `createLectureOrder`/`confirmLecturePayment` 호출부는 `marblo-web` 2곳뿐이고 `v3/src` 에는 없다(grep 실측).

### 1.4 (D) 죽은 표면 — `v3/backend` (FastAPI)

`v3/backend/api/payments.py` (656줄) + `services/payment_service.py` (364줄, `TossPaymentsService`) + `services/naverpay_service.py` + `schemas/payment.py` + 테스트 3종이 **완비된 채로 존재**하며 `main.py:46` 에서 라우터가 마운트돼 있다. 그런데 이걸 부르는 클라이언트가 없다 — `v3/src/services/paymentClient.ts`(372줄)를 import 하는 파일이 **0개**다(grep 실측: 주석 1줄만 언급).

> **판단:** 라이브 결제 경로가 아니다. Cloud Functions 가 실제 경로다. 전환 스코프에서 제외하되, **`확인필요`** — 이 FastAPI 백엔드가 어딘가에 배포돼 실제로 트래픽을 받는지는 이 워크트리에서 확인 못 했다(배포 여부는 인프라 쪽 정보). 만약 죽은 코드가 맞다면 전환과 별개로 **삭제 티켓**이 필요하다. Toss 시크릿을 읽는 코드가 사용처 없이 살아 있는 것 자체가 공격면이다.

---

## 2. 포트원 실측 — (a) 심사·온보딩 소요

출처:

- [전자결제 신청 (개발자센터 콘솔 가이드)](https://developers.portone.io/opi/ko/console/guide/reg)
- [이용절차 › 전자결제 신청 › 가입신청](https://help.portone.io/category/procedure/pg-application/start)
- [이용절차 › 전자결제 신청 › 계약 진행](https://help.portone.io/category/procedure/pg-application/contract)
- [이용절차 › 전자결제 신청 › 카드사 심사](https://help.portone.io/category/procedure/pg-application/screening)
- [나이스정보통신 상세 계약절차](https://help.portone.io/content/nice-contract) (PG별 상세 절차의 대표 예시)

### 2.1 단계별 실측 소요

| 단계                                              | 실측 소요 (공식 문서 원문 기준)                                      | 비고                                                      |
| ------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------- |
| 1. 포트원 가입 + 비즈니스 인증                    | 즉시 (사업자등록증 업로드)                                           | **사업자등록증 없으면 신청 불가**                         |
| 2. 전자결제 신청(가입신청서 제출)                 | 즉시                                                                 | 원하는 PG사·결제수단을 **장바구니처럼 복수 선택**         |
| 3. PG사 계약담당자 컨택                           | **약 3영업일 내** (콘솔 가이드) / **2~3영업일 내** (나이스 상세절차) | 이후는 PG사와 직접 진행                                   |
| 4. 입점심사 + 계약서·구비서류 + **보증보험 가입** | 명시 없음 → **확인필요**                                             | 아래 §2.2                                                 |
| 5. 개발 연동 (테스트 환경)                        | 우리 통제                                                            | **계약 전에도 테스트 채널로 선행 가능**                   |
| 6. **카드사 심사**                                | **"보통 2주 정도 소요"**                                             | "각 카드사별로 개별 진행하므로 소요 일시는 카드사별 차이" |

### 2.2 계약 단계의 실질 비용 (문서 원문)

- **보증보험 필수**: "결제대행사와 계약시에는 **반드시 보증보험 가입이 필요**하며, **여러 PG사를 이용하신다면 결제대행사별로 가입**해야". SGI서울보증보험, 계약기간 1년, 기준요율 **기본 0.953%**. 보증보험 금액 × 배수 = 월 정산한도.
  → 멀티 PG 는 공짜가 아니다. PG 하나 늘 때마다 보증보험이 하나 늘어난다.
- **구비서류(법인)**: PG사 계약서 2부, 사업자등록증 사본, 법인 명의 통장 사본, 대표자 신분증 사본, 법인인감증명서 원본, 법인등기부등본 원본, 실제소유자 확인서류(주주명부 등), 사용인감계, (필요시) 보증보험증권.
  → **토스 직접계약과 서류가 사실상 동일하다**(`docs/toss-review/2026-07-20-full-sweep.md` §1 이 요구한 것과 같은 목록). 서류 준비분은 재사용 가능.
- **가입비**: PG사별 상이. 토스페이먼츠·스마트로·나이스·KG이니시스·KSNET 등 **20만원**, KPN·NHN KCP·카카오페이·네이버페이·토스페이·페이코 등 **무료** (§5 표).

### 2.3 판정 — "포트원이 더 빠른가?"

**부분적으로만 그렇다. 카드사 심사는 동일하게 ~2주 걸린다.**

포트원 문서가 직접 말한다: "카드사 심사는 **PG사에서 전 카드사로 심사를 요청**합니다. 각 카드사별로 개별적으로 심사를 진행하기 때문에 소요 일시는 카드사별로 차이가 있을 수 있으나, **보통 2주 정도 소요**됩니다."

토스 가이드의 "10~14일"(`docs/toss-review/2026-07-20-full-sweep.md` §9)과 같은 값이다. **심사 주체가 카드사로 동일하므로 중개자를 바꿔도 심사가 짧아질 이유가 없다.**

포트원의 실제 속도 이점은 다른 데 있다:

1. **병렬성** — 한 신청서로 여러 PG에 동시 접수. 한 PG의 입점심사에서 막혀도 다른 PG가 살아난다. 토스 직접계약은 막히면 그걸로 끝이다.
2. **선행 개발** — 계약 전에 테스트 채널로 연동을 완성해 둘 수 있다(문서: "카드사 심사 전에는 **테스트 환경으로 미리 연동 개발작업을 진행할 수 있습니다**"). 계약이 끝나는 순간 심사에 바로 들어간다.
3. **재심사 회피** — 이미 포트원으로 계약한 뒤 PG를 추가하면 신청서 재작성이 없다("이미 신청하신 적이 있는 사업자의 경우 비즈니스 인증 과정이 생략").

> ★ **주의(문서 원문)**: "PG사를 통해 심사를 마치셨을지라도 **기존과 다른 서비스를 운영하시거나 결제방식이 달라진다면 카드사 재심사가 필요**합니다." → 심사 통과 후 결제방식을 바꾸면 재심사다. 토스 심사가 이미 통과 직전이라면 갈아타는 순간 이 조항에 걸린다.

---

## 3. 포트원 실측 — (b) **하나의 연동으로 메인 PG + 간편결제를 다 붙일 수 있는가** ★핵심 질문

출처: [결제대행사 선택하여 연동하기 — PG사별 지원되는 결제 수단 정보](https://developers.portone.io/opi/ko/integration/pg/v2/readme)

### 3.1 답: **예. 코드는 1벌, PG는 콘솔에서 채널로 교체한다.**

구조는 이렇다:

- 클라이언트는 항상 `@portone/browser-sdk` 의 `PortOne.requestPayment()` / `PortOne.requestIssueBillingKey()` 만 부른다.
- **어느 PG로 갈지는 `channelKey` 파라미터 하나로 결정**된다. 채널은 포트원 관리자콘솔에서 만든다.
- 서버는 항상 `https://api.portone.io/...` 만 부른다(`Authorization: PortOne {API_SECRET}`).

즉 **PG 교체 = 콘솔에서 채널 추가 + `channelKey` 상수 교체.** 코드 재작성이 아니다. 이게 토스 직접연동 대비 진짜 이득이다.

문서 원문: "포트원은 **다양한 PG의 결제창을 통일된 방법으로 호출**할 수 있도록 자바스크립트 SDK를 제공합니다."

### 3.2 국내 PG × 결제수단 매트릭스 (공식 문서 원문 발췌)

| PG사                                      | 정기결제(빌링키)                                      | 간편결제 허브형                                                           |
| ----------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------- |
| **토스페이먼츠**                          | 결제창/API                                            | 카카오페이·네이버페이·페이코·SSGPay·LPay·삼성페이·애플페이·**토스페이**   |
| **KG이니시스**                            | 결제창/API (카드 + **휴대폰**)                        | 카카오페이·네이버페이·토스페이·삼성페이·SSGpay·L.Pay·애플페이·페이코      |
| **NHN KCP**                               | 결제창/API                                            | 카카오페이·네이버페이·토스페이·삼성페이·SSGpay·L.Pay·애플페이·페이코      |
| **나이스정보통신**                        | **API만** (결제창 정기결제는 카카오페이/네이버페이만) | 카카오페이·네이버페이·페이코·SSGPay·LPay·삼성페이·애플페이·11Pay·토스페이 |
| **KSNET**                                 | **API만**                                             | 카카오페이·네이버페이·페이코·SSGPay·LPay                                  |
| **스마트로**                              | 결제창/API                                            | 카카오페이·네이버페이·페이코·LPay·핀페이                                  |
| **한국결제네트웍스(KPN)**                 | 결제창/API                                            | 카카오페이·네이버페이·토스페이·삼성페이·페이코                            |
| 웰컴페이먼츠 / 갤럭시아머니트리 / 다날 등 | 문서에 개별 기재                                      | —                                                                         |

간편결제 **직연동**(PG 경유 없이 직접 계약): 카카오페이 / 네이버페이 / 토스페이 — 각각 결제창 방식 지원.

해외: 페이팔(정기결제 지원), 엑심베이, 페이레터, 페이먼트월 등.

> ★ **간편결제는 두 갈래**라는 점이 중요하다. 포트원 헬프센터 원문: "PG 제휴 간편결제는 이용하실 '간편결제'가 아닌, **간편결제를 제공하는 결제대행사를 선택**해야 합니다." 즉 카카오페이를 PG 허브형으로 쓰면 PG 계약 안에 포함되고, 직연동으로 쓰면 카카오페이와 별도 계약이다. 수수료도 다르다(§5).

### 3.3 우리 현재 결제수단과의 대응

`BillingPage.tsx` 가 노출 중인 4종(`card_kr`, `naverpay`, `kakaopay`, `tosspay`)은 **KG이니시스 / NHN KCP / 토스페이먼츠 중 아무 곳이나 하나만 계약해도 전부 커버**된다(위 표의 허브형 열). 현재 Toss 직접연동으로 얻는 것과 동일하다. 즉 **결제수단 커버리지 손실은 없다.**

### 3.4 부가: 스마트 라우팅

OPI 기능으로 "ON/OFF 스위치 기능으로 개발자 없이 결제 트래픽 분산 / 장애 인지 후 10초 이내 대응"([포트원 요금 페이지](https://help.portone.io/category/pricing/portone)). PG 다중화가 되면 PG 장애 시 자동 우회가 가능해진다. 현재 Toss 단일 연동은 토스가 죽으면 결제가 통째로 죽는다.

---

## 4. 포트원 실측 — (c) 정기결제(빌링키)

출처: [빌링키 결제 연동하기 › 1. 빌링키 발급하기](https://developers.portone.io/opi/ko/integration/start/v2/billing/issue) · [2. 결제 요청하기](https://developers.portone.io/opi/ko/integration/start/v2/billing/payment) · [웹훅 연동하기](https://developers.portone.io/opi/ko/integration/webhook/readme-v2)

**지원한다.** 두 방식이 있고, 우리 현재 흐름과 대응이 명확하다.

### 4.1 빌링키 발급 — 결제창 방식 (우리 현 방식에 대응)

```js
const issueResponse = await PortOne.requestIssueBillingKey({
  storeId,
  channelKey,
  billingKeyMethod: "CARD",
});
// → 클라이언트가 billingKey 를 직접 받는다. 서버로 전달.
```

★ **현 Toss 흐름과 신뢰 모델이 다르다.** Toss 는 결제창이 **1회용 `authKey`** 를 주고 서버가 `POST /v1/billing/authorizations/issue` 로 교환해 빌링키를 얻는다(`index.ts:1188`) — 빌링키가 서버에서만 태어난다. 포트원 결제창 방식은 **클라이언트가 billingKey 자체를 받아 서버로 올린다.** 클라이언트가 올린 billingKey 를 그대로 신뢰하면 안 되고, 서버가 조회 API 또는 `BillingKey.Issued` 웹훅으로 검증해야 한다.
→ **`확인필요`**: 빌링키 단건조회 API의 정확한 경로/응답 스키마. 발급 API가 `POST https://api.portone.io/billing-keys` 인 것은 문서에서 확인했으나, 조회 엔드포인트는 이번 실측 범위에서 확인하지 못했다. [API 레퍼런스](https://developers.portone.io/api/rest-v2)에서 확정 필요.

### 4.2 빌링키 발급 — API 방식

서버가 카드번호·유효기간·생년월일·비밀번호 앞 2자리를 받아 `POST https://api.portone.io/billing-keys` 호출. 문서 원문: "이 과정에서 **카드 정보는 포트원 서버에 기록되지 않습니다**." 단점도 문서가 명시: "개인정보 이용약관을 명시해야 하며 **PG사 및 카드사 심사가 까다롭고** 개인정보 유출에 유의". → **우리는 쓰지 말 것.** 심사가 목적인데 심사를 어렵게 만든다.

### 4.3 정기 청구

```
POST https://api.portone.io/payments/{paymentId}/billing-key
Authorization: PortOne {API_SECRET}
body: { billingKey, orderName, customer, amount: { total }, currency: "KRW" }
```

`paymentId` 는 **고객사가 채번**하고 "같은 paymentId 에 대해 여러 번의 결제 시도가 가능하나 최종적으로 결제에 성공하는 것은 단 한 번만 가능(중복 결제 방지)". → **우리 `billingOrderId(userId, cycleAnchorMs)` 멱등키 설계(`billing.ts:123`)가 그대로 맞아떨어진다.** PG 측 멱등 보강도 동일하게 작동.

### 4.4 웹훅 — **여기가 순수 업그레이드다**

|             | 현재 Toss                                                                                 | 포트원 V2                                                                                                                                 |
| ----------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 서명        | **없음**(결제 웹훅). 그래서 `webhookVerify.ts` 가 body 를 불신하고 `paymentKey` 로 재조회 | **있음.** [Standard Webhooks](https://www.standardwebhooks.com/) 규격, 콘솔에서 웹훅 시크릿 발급, `@portone/server-sdk` 가 검증 함수 제공 |
| IP 필터     | 미제공                                                                                    | `52.78.5.241` (V2) 공개, 변경 시 사전 메일 통보                                                                                           |
| 이벤트 타입 | `PAYMENT_STATUS_CHANGED` 등                                                               | `Transaction.Paid/Cancelled/PartialCancelled/Failed/...`, **`BillingKey.Issued/Failed/Deleted/Updated`**                                  |
| 재시도      | —                                                                                         | 재시도해도 `timestamp` 동일 유지(멱등 처리 가능)                                                                                          |

빌링키 발급 이벤트가 웹훅으로 온다는 게 크다 — §4.1 의 "클라가 올린 billingKey 신뢰" 문제를 웹훅으로 정면 해결할 수 있다.

---

## 5. 포트원 실측 — (d) 수수료·정산

출처: [이용요금 › 결제대행사 수수료](https://help.portone.io/category/pricing/pg) · [이용요금 › 포트원 요금](https://help.portone.io/category/pricing/portone)

### 5.1 포트원 자체 이용료 (One Payment Infra)

| 플랜     | 기준                           | 요금                                                                                                    |
| -------- | ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| **Free** | 월 순거래액 **5,000만원 미만** | **무료** — 포트원의 모든 제품 / 결제 통합 API / **제한 없는 결제대행사 연동** / 제한 없는 본인인증 연동 |
| Growth 1 | 5천만원 이상 ~ 1억원 미만      | 월 10만원                                                                                               |
| Growth 2 | 1억원 이상 ~ 5억원 미만        | 월 30만원                                                                                               |
| Growth 3 | 5억원 이상                     | 월 50만원                                                                                               |
| Custom   | 엔터프라이즈                   | 별도                                                                                                    |

(출처 이미지: help.portone.io 요금제 표. 문서에 "포트원 서비스 요금은 내부 사정에 따라 변동 될 수 있습니다" 명시)

→ **마블로는 당분간 Free.** 월 5,000만원(= Pro ₩19,000 기준 약 2,600명)까지 포트원 이용료 0원. 전환의 재무 리스크가 없다.

### 5.2 PG사 수수료 (VAT 별도, 포트원 공시표 발췌)

| PG사                  | 가입비   | 신용카드 일반 | 영세  | 중소1 | 중소2 | 중소3 | **빌링/수기** | 해외  |
| --------------------- | -------- | ------------- | ----- | ----- | ----- | ----- | ------------- | ----- |
| 토스페이먼츠          | 20만원   | 3.20%         | 1.65% | 2.25% | 2.40% | 2.65% | **3.23%**     | 4.50% |
| KG이니시스            | 20만원   | 3.20%         | 1.90% | 2.50% | 2.65% | 2.90% | **3.20%**     | 4.00% |
| NHN KCP               | **무료** | 3.20%         | 1.72% | 2.32% | 2.47% | 2.72% | **3.20%**     | 4.50% |
| 나이스정보통신        | 20만원   | 3.20%         | 1.70% | 2.30% | 2.45% | 2.70% | **3.20%**     | 3.80% |
| 한국결제네트웍스(KPN) | **무료** | 2.90%         | 1.70% | 2.30% | 2.45% | 2.70% | **2.90%**     | —     |
| KSNET                 | 20만원   | 3.20%         | 1.70% | 2.30% | 2.45% | 2.70% | 3.20%         | 4.20% |
| 카카오페이            | 무료     | 3.20%         | 1.70% | 2.30% | 2.45% | 2.70% | 3.20%         | —     |
| 네이버페이(결제형)    | 무료     | 2.50%         | 0.90% | 1.45% | 1.60% | 1.85% | —             | —     |
| 토스페이              | 무료     | 3.20%         | 1.70% | 2.30% | 2.45% | 2.70% | 3.20%         | —     |

**해석**: 우리에게 적용될 칸은 **"빌링/수기"** (구독 = 빌링키). 토스페이먼츠 3.23% vs KG이니시스·NHN KCP·나이스 3.20% vs KPN 2.90%.
→ **수수료 차이는 무시할 수준(0.03~0.33%p)이고, 오히려 토스페이먼츠가 가장 비싸다.** 수수료는 전환 판단의 변수가 아니다. **`확인필요`**: 영세/중소 구간은 매출 규모에 따른 우대수수료이고 우리가 어느 구간인지는 카드사 판정 사항이다([영중소 수수료율 기준](https://help.portone.io/content/small-business-commission-fee) 참조).

### 5.3 정산

- 정산 주기·한도는 **보증보험 금액 × 배수**로 결정된다. 문서 예시 원문: 보증보험 500만원 → 일일정산(승인일+7일)이면 2배수 = 월 정산한도 1,000만원 / 월 1회 정산이면 5배수 = 2,500만원.
- 보증보험 기준요율 **0.953%** (PG사별 상이 가능), 계약기간 1년 갱신.
- **`확인필요`**: 우리에게 요구될 보증보험 금액은 PG사가 업종·예상 매출 보고 정한다. 신청서의 "월 거래액" 입력값에 좌우된다.

---

## 6. 마이그레이션 스코프

### 6.1 바뀌는 파일 (실측 기반 견적)

| 층     | 파일                                                                                                                   | 변경 성격                                                                                                              | 규모                            |
| ------ | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 웹     | `marblo-web/package.json`                                                                                              | `@tosspayments/tosspayments-sdk` → `@portone/browser-sdk`                                                              | 1줄                             |
| 웹     | `marblo-web/src/lib/toss.ts` → `portone.ts`                                                                            | 클라이언트 키 → `storeId` + `channelKey`                                                                               | 재작성(6줄)                     |
| 웹     | `checkout/page.tsx`                                                                                                    | `requestBillingAuth()` → `PortOne.requestIssueBillingKey()`, `requestPayment()` → `PortOne.requestPayment()`           | 핸들러 1개(≈60줄)               |
| 웹     | `checkout/success/page.tsx`                                                                                            | 복귀 쿼리 파라미터 변경(`paymentKey/orderId/amount` → `paymentId`)                                                     | ≈40줄                           |
| 앱     | `BillingPage.tsx`                                                                                                      | CDN `window.TossPayments` 로더 제거 → `@portone/browser-sdk` import. 결제수단 매핑 4종 재작성                          | ≈80줄                           |
| 앱     | `billingService.ts`                                                                                                    | 콜러블 이름/시그니처 변경                                                                                              | ≈30줄                           |
| 서버   | `functions/src/index.ts`                                                                                               | Toss 콜러블 8개 + 재조회 헬퍼 교체. `TOSS_API_BASE` → `api.portone.io`, Basic 인증 → `Authorization: PortOne {secret}` | **≈600줄, 최대 작업**           |
| 서버   | `functions/src/webhookVerify.ts`                                                                                       | Toss 3함수 폐기 → Standard Webhooks 서명 검증(`@portone/server-sdk`) + PortOne 이벤트 타입 매핑                        | 재작성(≈120줄)                  |
| 서버   | `functions/src/reconciliation.ts`                                                                                      | Toss 조회 URL/상태값 → PortOne `GET /payments/{paymentId}`                                                             | ≈80줄                           |
| 서버   | `functions/src/billing.ts`                                                                                             | 필드명·provider 판정만(`tossBillingKey` → provider 중립 필드)                                                          | **≈20줄, 로직은 그대로 재사용** |
| 타입   | `v3/src/types/subscription.ts`                                                                                         | `PaymentProvider` 에 `"portone"` 추가, 빌링키 필드 중립화                                                              | ≈10줄                           |
| 테스트 | `functions/tests/{billing,webhookVerify,reconciliation}.test.mjs`, `v3/tests/unit/subscription-cancel-billing.test.ts` | 벡터 교체                                                                                                              | ≈200줄                          |
| 시크릿 | `TOSS_*` → `PORTONE_API_SECRET`, `PORTONE_STORE_ID`, `PORTONE_CHANNEL_KEY`, `PORTONE_WEBHOOK_SECRET`                   | Functions env + Vercel env + 앱 빌드 env                                                                               | 값 미출력                       |
| 콘솔   | 웹훅 URL 등록(`tossWebhook` → 신규 `portoneWebhook`), 테스트/실연동 모드 각각                                          | —                                                                                                                      |

**총 견적: 실코드 ≈1,000줄, 테스트 ≈200줄. 순수 로직(`billing.ts`)과 크론 골격, 멱등 설계는 그대로 산다.** 돈 직결 로직 대부분이 이미 PG 중립적인 순수 함수로 분리돼 있는 게 여기서 크게 유리하다.

### 6.2 웹훅 흐름 변화

```
[현재] Toss → tossWebhook (서명 없음)
        → body.status 불신 → GET /v1/payments/{paymentKey} 재조회
        → subscriptionActionForTossStatus() → 구독 변경

[포트원] PortOne → portoneWebhook
        → Standard Webhooks 서명 검증(@portone/server-sdk, 웹훅 시크릿)
        → (+ IP 필터 52.78.5.241)
        → type 분기: Transaction.Paid / Cancelled / PartialCancelled / Failed
                     BillingKey.Issued / Failed / Deleted
        → 구독 변경
```

★ 재조회 패턴은 **유지하는 게 낫다.** 서명 검증이 생겨도 "알 수 없는 type 은 무시"(문서 권고)와 재조회는 병행 가능하고, `reconciliation.ts` 의 웹훅 유실 보정도 그대로 필요하다.

### 6.3 빌링키 흐름 변화

```
[현재] 웹/앱: toss.payment().requestBillingAuth() → 리다이렉트 → authKey+customerKey
       서버: issueBillingKey(authKey, customerKey)
             → POST /v1/billing/authorizations/issue → billingKey
             → 첫 청구 POST /v1/billing/{billingKey}
             → subscriptions/{uid} 에 tossBillingKey/tossCustomerKey 저장

[포트원] 웹/앱: PortOne.requestIssueBillingKey({storeId, channelKey, billingKeyMethod:"CARD"})
                → billingKey 를 클라이언트가 수령
         서버: issueBillingKey(billingKey)
               → ★검증(조회 API 또는 BillingKey.Issued 웹훅) ← 신규 필수 단계
               → 첫 청구 POST /payments/{paymentId}/billing-key
               → subscriptions/{uid} 에 provider="portone", billingKey 저장
```

**신규 보안 요건 1건**: 클라이언트가 올린 billingKey 를 검증 없이 저장하면 안 된다. 현 Toss 설계(`issueBillingKey` 가 첫 청구까지 원자적으로 처리, 실패 시 active 안 만듦 — GAP A 방지)는 **그대로 유지 가능하며, 오히려 검증 수단이 된다**: 그 billingKey 로 첫 청구가 성공했다는 것 자체가 유효성 증거다.

### 6.4 기존 Toss 구독자 무중단 이전

**핵심 사실: 빌링키는 PG 간 이전이 불가능하다.** 빌링키는 특정 PG(그리고 그 PG의 상점ID)에 묶인 토큰이다. 옮기려면 사용자가 카드를 **재등록**해야 한다. (문서에 이전 절차가 존재하지 않는다는 점이 근거. **`확인필요`** — 포트원에 "타 PG 빌링키 이관" 서비스가 있는지는 채널톡 문의로만 확정 가능.)

**그런데 지금은 이게 문제가 아니다.** 카드사 심사가 완료되지 않았으므로 운영환경 실결제가 불가능하고(포트원 문서: "카드사 심사가 완료되지 않았기 때문에 운영 환경의 경우 **결제가 실패되는 것이 당연**"), 따라서 **살아있는 Toss 빌링키 구독자가 구조적으로 존재할 수 없다.**

> **`확인필요`**: `subscriptions` 컬렉션에서 `tossBillingKey != null` 인 문서 수 실측. 이 워크트리에서 Firestore 를 조회하지 않았다(조사 티켓 범위 밖 + 프로덕션 데이터). 파운더 grant(`paymentProvider: "founder_grant"`)와 베타 Pro 는 결제 흔적이 없으므로 이전 대상이 아니다.

**만약 소수라도 존재한다면** 무중단 이전 설계(코드는 이미 이걸 지원할 뼈대가 있다 — `paymentProvider` 가 이미 discriminator다):

1. **dual-provider 기간을 둔다.** `selectDueForCharge()` 가 `paymentProvider` 로 분기하도록 확장(`"toss"` → Toss 청구 경로, `"portone"` → PortOne 경로). 두 경로가 같은 크론 안에서 공존.
2. 신규 가입자만 PortOne 으로 보낸다(체크아웃 진입점만 교체).
3. 기존 Toss 구독자는 **현재 주기가 끝날 때까지 Toss 로 계속 청구**한다. 서비스 중단 0.
4. 만료 30일 전부터 앱/메일로 "결제수단 재등록" 유도 → PortOne 빌링키 발급 → `paymentProvider` 플립.
5. 재등록 안 한 사용자는 만료 시점에 Toss 로 한 주기 더 청구하거나(계약이 살아있는 동안) 유예 후 free 강등. **정책 판단 필요 — 사장님.**
6. Toss 잔량이 0이 되면 Toss 경로·시크릿·의존성 제거.

> ★ 이 설계의 전제: **Toss 계약을 즉시 해지하지 않는다.** 심사가 통과됐다면 살려둔 채로 병행한다. 심사 중이라면 애초에 이전할 구독자가 없다.

---

## 7. 리스크

| #   | 리스크                                                                                                                                                                                                                                                    | 심각도        | 완화                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------- |
| R1  | **카드사 심사를 다시 2주 받는다.** 포트원은 이걸 우회 못 한다                                                                                                                                                                                             | **HIGH**      | 지연 원인이 카드사 단계면 전환하지 말 것(§0)                              |
| R2  | **"결제방식이 달라지면 카드사 재심사"** — 토스 심사가 거의 끝났는데 갈아타면 초기화                                                                                                                                                                       | **HIGH**      | 현재 심사 진행 단계 확인이 선행 조건                                      |
| R3  | PG사 **입점심사는 여전히 있다.** 포트원은 접수 창구일 뿐, 심사 주체는 PG사                                                                                                                                                                                | MED           | 여러 PG 병렬 접수로 분산 (이게 포트원의 본질적 이점)                      |
| R4  | **보증보험이 PG마다 별도.** 멀티 PG = 보증보험 중복 비용                                                                                                                                                                                                  | MED           | 실운영 PG는 1곳으로 시작, 다중화는 나중                                   |
| R5  | 클라이언트가 받은 billingKey 신뢰 문제(§4.1)                                                                                                                                                                                                              | MED           | 첫 청구 원자성 유지 + `BillingKey.Issued` 웹훅 대조                       |
| R6  | **Electron 렌더러에서 PortOne SDK 동작 미검증.** 현재 `BillingPage.tsx` 는 CDN + 리다이렉트 콜백으로 돌아간다. PortOne 도 리다이렉트 방식을 지원하지만(`redirectUrl` + `forceRedirect: true`) Electron `file://`/커스텀 스킴 환경에서의 복귀는 확인 안 됨 | MED           | **`확인필요`** — 테스트 채널로 PoC. 계약 전에 가능                        |
| R7  | 심사 기간 중 홈페이지 동결 요건이 다시 발동. 토스 가이드 §10 과 동일한 제약이 PG사별로 적용될 가능성                                                                                                                                                      | MED           | `docs/toss-review/2026-07-20-full-sweep.md` 의 F1/F3 결론을 그대로 재사용 |
| R8  | `v3/backend` FastAPI 의 Toss 코드가 사용처 없이 시크릿을 읽는다                                                                                                                                                                                           | LOW(보안 MED) | 전환과 별개로 삭제 티켓                                                   |
| R9  | 포트원도 결국 **PG 위의 레이어**다. PG 장애 + 포트원 장애 = 2중 장애면. 반대로 스마트 라우팅으로 PG 장애는 완화됨                                                                                                                                         | LOW           | 순증으로 봄                                                               |

---

## 8. 권고 플랜

### Phase 0 — 결정 게이트 (사장님/오케, 코드 0줄)

1. **현재 토스 심사가 멈춘 단계 확인.** 입점·계약 심사인가, 카드사 심사인가.
   - 토스 상점관리자 → 이용정보 → 결제·부가서비스에서 진행현황 조회 가능(`docs/toss-review/2026-07-20-full-sweep.md` §11).
2. 카드사 심사 단계면 → **대기**(전환 보류, 이 문서 보존).
3. 입점·계약 단계에서 막혔으면 → Phase 1.

### Phase 1 — 무비용 병행 (계약 전, 코드 0줄) ★답을 기다리는 동안 지금 할 수 있는 것

4. 포트원 관리자콘솔 가입 + 비즈니스 인증(사업자등록증). 토스 심사 서류를 그대로 재사용.
5. **테스트 채널 발급** → 계약 없이 연동 PoC 가능.
6. R6(Electron 렌더러 PortOne SDK 리다이렉트 복귀) PoC 로 해소.
7. PG 선정: 빌링 수수료·가입비·정기결제 결제창 지원을 함께 보면 **NHN KCP(가입비 무료, 빌링 3.20%, 결제창/API 정기결제 지원, 간편결제 8종)** 또는 **KG이니시스**가 후보. **최종 선정은 사장님 판단.**

### Phase 2 — 접수 (전환 확정 시)

8. 전자결제 신청 — PG **2곳 이상 동시 접수**(하나 막혀도 진행). 3영업일 내 컨택.
9. 계약·구비서류·보증보험.

### Phase 3 — 코드 전환 (후속 티켓 후보)

| 티켓 후보 | 내용                                                                                                                                                              | 규모 |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| P3-1      | `functions`: PortOne 콜러블 세트 신설(`createPortOneCheckout`/`issuePortOneBillingKey`/`chargePortOneBillingKey`/`portoneWebhook`) — **Toss 경로는 남긴 채 추가** | L    |
| P3-2      | `webhookVerify.ts`: Standard Webhooks 서명 검증 + 이벤트 매핑 + 단위테스트                                                                                        | M    |
| P3-3      | `billing.ts` / `subscription.ts`: `paymentProvider` 분기 일반화, 빌링키 필드 중립화                                                                               | S    |
| P3-4      | `marblo-web` 체크아웃 SDK 교체                                                                                                                                    | M    |
| P3-5      | `BillingPage.tsx` SDK 교체 + 결제수단 매핑                                                                                                                        | M    |
| P3-6      | `reconciliation.ts` PortOne 경로                                                                                                                                  | S    |
| P3-7      | 무중단 이전 러너(§6.4) — **잔존 Toss 구독자 수 확인 후 필요시에만**                                                                                               | S~M  |
| P3-8      | `v3/backend` 결제 죽은코드 제거(전환과 무관하게 별건)                                                                                                             | S    |

---

## 9. 확인필요 목록 (추측으로 채우지 않은 항목)

1. **현재 토스 심사가 멈춰 있는 정확한 단계** — 이 문서의 GO/NO 를 가르는 유일한 변수.
2. `subscriptions` 에서 `tossBillingKey != null` 인 실 구독자 수(프로덕션 Firestore).
3. 포트원 **빌링키 단건조회 API** 정확한 경로·응답 스키마(REST API 레퍼런스).
4. 포트원에 **타 PG 빌링키 이관** 서비스가 존재하는지(채널톡 문의 사항).
5. **Electron 렌더러에서 PortOne SDK 리다이렉트 복귀** 동작(테스트 채널 PoC로 해소 가능).
6. 우리에게 요구될 **보증보험 금액**(PG사가 업종·예상 매출 보고 산정).
7. 우리 사업자가 **영세/중소 우대수수료** 어느 구간인지(카드사 판정).
8. `v3/backend`(FastAPI) 가 실제로 배포·운영 중인지.

---

## 부록. 출처 링크

**포트원 개발자센터**

- [결제 연동 Doc(V2)](https://developers.portone.io/opi/ko/readme)
- [결제대행사 선택하여 연동하기 — PG×결제수단 매트릭스](https://developers.portone.io/opi/ko/integration/pg/v2/readme)
- [인증 결제 연동하기 — SDK 설치·결제 요청·서버 검증](https://developers.portone.io/opi/ko/integration/start/v2/checkout)
- [빌링키 발급하기](https://developers.portone.io/opi/ko/integration/start/v2/billing/issue)
- [빌링키 결제 요청하기](https://developers.portone.io/opi/ko/integration/start/v2/billing/payment)
- [웹훅 연동하기(V2)](https://developers.portone.io/opi/ko/integration/webhook/readme-v2)
- [전자결제 신청(콘솔 가이드)](https://developers.portone.io/opi/ko/console/guide/reg)
- [REST API v2 레퍼런스](https://developers.portone.io/api/rest-v2)

**포트원 헬프센터**

- [이용절차 개요](https://help.portone.io/category/procedure)
- [전자결제 가입신청](https://help.portone.io/category/procedure/pg-application/start)
- [계약 진행(입점심사·보증보험·구비서류)](https://help.portone.io/category/procedure/pg-application/contract)
- [카드사 심사(~2주)](https://help.portone.io/category/procedure/pg-application/screening)
- [나이스정보통신 상세 계약절차](https://help.portone.io/content/nice-contract)
- [결제대행사 수수료표](https://help.portone.io/category/pricing/pg)
- [포트원 요금(OPI Free/Growth)](https://help.portone.io/category/pricing/portone)
- [영중소 수수료율 기준](https://help.portone.io/content/small-business-commission-fee)

**사내 문서**

- `docs/toss-review/README.md` — 카드사 심사 제출용 결제경로 PPT 제작 기록
- `docs/toss-review/2026-07-20-full-sweep.md` — 토스 가이드 12개 섹션 전수 대조(§9 심사 10~14일, §10 심사 중 동결 요건)
