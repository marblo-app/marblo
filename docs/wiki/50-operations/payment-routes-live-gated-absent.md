---
title: 결제 정본 — 살아있는 경로 / 게이트로 잠긴 경로 / 아예 없는 경로
tags: [domain/operations, topic/payments, topic/pricing, method/source-link, status/living]
status: active
date: 2026-08-31
links: [[payment-live-key-pg-env-bundle]], [[paddle-support-check-before-pg-screening]], [[human-only-ops-backlog]], [[verify-without-gui]]
---

# 결제 정본 — 살아있는 경로 / 게이트로 잠긴 경로 / 아예 없는 경로

> **한 줄 판정**: ★**"삭제됐다"와 "게이트로 잠겼다"는 다른 칸이다.** 2026-08-31 실측 기준 신규 결제가 실제로 가는 곳은 **포트원 한 곳**(KG이니시스 카드 단건·정기 + 카카오페이 간편결제, 채널키 4개 전부 설정됨)이고, 카카오페이 정기결제는 **월간만**(연간은 서버 2지점 + 화면 2지점에서 거절). 토스페이먼츠 직결은 **삭제가 아니라 잠김** — `TOSS_ENTRY_ENABLED` 가 배포 env 에 **없어서** 코드 기본값인 차단이 걸린 것이고, 토스 코드·웹 SDK import·`TOSS_SECRET_KEY` 는 전부 남아 있다(env **한 줄**로 열린다). 토스페이(간편결제)와 Paddle 은 코드 완비 + **키 미투입**. 앱 인앱 결제만 **실제로 없다**(호출 코드 0건).

## 왜 이 노트가 있나

결제 배선이 **토스 직결 → 포트원 이니시스 기본 → 카카오페이 추가**로 세 번 바뀌었다. 2026-08-31 사장님 질문 _"토스페이먼츠 배선은 다 없앤 거잖아?"_ 에 대한 답이 **아니오(잠갔다)** 였다. 이 구별이 뭉개지면 심사 회신이 거짓이 된다 — 심사기관에 "제거했습니다"라고 답했는데 실제로는 env 한 줄로 열리는 상태면 그게 문제다.

## 무엇을 했나

배포 env 파일에서 **키 이름과 존재 여부만** 읽고(값 미출력), 서버·웹·앱 결제 코드를 읽어 각 경로의 판정을 코드 심볼로 되짚었다. **결제 코드는 한 줄도 고치지 않았고, 결제 API 를 호출하지 않았고, 심사 계정으로 로그인하지 않았다**(그 계정은 별도 티켓 `i1cmV7Tf` 가 쓰는 중이라 동시 진입이 그쪽 실측을 오염시킨다). 검증은 순수 로직 테스트 4종만 돌렸다.

## 결과

### 1. ★경로 3분할 — 이 표가 이 노트의 전부다

판정 3값의 뜻을 먼저 못박는다. **섞으면 안 되는 것이 정확히 이 세 개다.**

| 판정 | 뜻 | 심사 회신에 쓸 수 있는 말 |
| --- | --- | --- |
| ✅ **살아있음** | 지금 신규 결제가 이 경로로 간다 | "연동돼 있습니다" |
| 🔒 **잠김** | 코드가 그대로 있고, **명시된 스위치 하나**(env 한 줄 또는 키 투입)로 열린다 | "신규 접수를 차단했습니다" — ★**"제거했습니다" 는 거짓** |
| ⛔ **아예 없음** | 트리에 코드가 없다. 되살리려면 코드를 다시 써야 한다 | "제공하지 않습니다" |

| 경로 | 판정 | 무엇이 그렇게 만드나 (★잠김이면 스위치 이름) | 근거 파일 · 심볼 |
| --- | :---: | --- | --- |
| 포트원 · KG이니시스 **카드 정기(빌링키)** | ✅ 살아있음 | `PORTONE_INICIS_BILLING_CHANNEL_KEY` 설정됨 · 웹 국내 기본 provider 가 `portone` | `index.ts` `completePortOneBillingKey` · `paymentProvider.ts` `resolveCheckoutProvider` |
| 포트원 · KG이니시스 **카드 단건** | ✅ 살아있음 | `PORTONE_INICIS_ONETIME_CHANNEL_KEY` 설정됨 | `index.ts` `createPortOnePaymentIntent` · `completePortOnePayment` |
| 포트원 · **카카오페이 정기** | ✅ 살아있음 (**월간만**) | `PORTONE_KAKAOPAY_BILLING_CHANNEL_KEY` 설정됨. 연간은 §2 가 거절 | `portone.ts` `portoneBillingCycleViolation` · `index.ts:2966` |
| 포트원 · **카카오페이 단건** | ✅ 살아있음 | `PORTONE_KAKAOPAY_ONETIME_CHANNEL_KEY` 설정됨 | `index.ts` `PORTONE_EASY_PAY_CHANNEL_KEYS.onetime` |
| 포트원 · **토스페이(간편결제)** | 🔒 잠김 | ★**채널키 미투입** — `PORTONE_TOSSPAY_BILLING_CHANNEL_KEY` · `PORTONE_TOSSPAY_ONETIME_CHANNEL_KEY` · 폴백 `PORTONE_EASYPAY_BILLING_CHANNEL_KEY` 셋 다 env 에 없다. 코드는 완비 — **키만 넣으면 코드 변경 없이 붙는다** | `portone.ts` `SUPPORTED_EASY_PAY_PROVIDERS`(`TOSSPAY` 포함) · `enabledPortOneEasyPayProviders` |
| **토스페이먼츠 PG 직결**(웹 체크아웃) | 🔒 잠김 | ★**env 게이트** `TOSS_ENTRY_ENABLED` — 배포 env 에 **키 자체가 없고**, 코드가 `"true"` 일 때만 여는 fail-closed. **코드·웹 SDK import·`TOSS_SECRET_KEY` 는 전부 남아 있다** | `billing.ts` `isTossEntryEnabled` · `index.ts` `assertTossEntryEnabled`(진입 7지점) · `checkout/page.tsx` `loadTossPayments` import 18건 |
| 토스 **갱신 크론**(04:30 KST) | 🔒 잠김 | 같은 `TOSS_ENTRY_ENABLED` 로 스킵. **함수는 배포된 채로 남긴다**(지우면 되살릴 때 스케줄 재생성이 필요하고 실행 로그가 끊긴다) | `index.ts` `scheduledChargeSubscriptions:9163` |
| 앱 클라이언트 토스 경로 | 🔒 잠김 | ★**소스 상수** `TOSS_ENTRY_DISABLED`(env 아님 — 바꾸려면 앱 재배포) | `v3/src/services/billingService.ts:188` |
| **강의 단건결제** | 🔒 잠김 | ★**소스 상수** `LECTURES_COMING_SOON = true` + 체크아웃이 `type === "lecture"` 를 상세로 되돌리고 `null` 반환 | `marblo-web/src/data/lectures.ts:96` · `checkout/page.tsx:1072` |
| **Paddle**(해외 · 비 KRW 로케일) | 🔒 잠김 | ★**서버 키 미투입** — `PADDLE_API_KEY` · `PADDLE_WEBHOOK_SECRET` 이 배포 env 에 **없다**. 라우팅·가격 ID 매트릭스 코드는 완비 | `index.ts:1015` · `createPaddleCheckout:1414` · `paymentProvider.ts`(비 KRW → paddle) |
| **데스크톱 앱 인앱 결제(토스 SDK)** | ⛔ 아예 없음 | 호출 코드 **0건**. 앱은 결제하지 않고 웹 체크아웃으로 **보낸다**. 남은 토스 문자열은 CSP 허용 도메인·과거 결제자 라벨·인앱 브라우저 정책뿐 | `docs/payment/desktop-domestic-checkout-handoff.md` · `v3/src/lib/checkoutLink.ts` `buildWebCheckoutUrl` |
| **환불 금액 자동화** | ⛔ 아예 없음 | 환불은 PG 콘솔에서 사람이 한다. 우리 쪽엔 금액도 시각도 안 남아 원장은 `amount_known=false` 로 적재 | `analyticsPurchase.ts` 상단 주석 |

★**지금 신규 결제는 어느 경로로 흐르는가 (심사 회신에 그대로 쓸 한 문장)**
> 마블로의 신규 국내 결제는 전부 **포트원(PortOne)** 을 통해 이루어지며, 결제수단은 **KG이니시스 신용카드(단건·정기)** 와 **카카오페이 간편결제**이고 **카카오페이 정기결제는 월 단위만** 발급·청구됩니다. 해외 결제는 Paddle 로 분기하도록 배선돼 있으며, 토스페이먼츠 직접 연동은 **신규 결제 접수를 차단**한 상태입니다.

★같은 문장에서 **쓰면 안 되는 말**: "토스페이먼츠 연동을 제거했습니다" · "Paddle 로 결제를 받고 있습니다" · "토스페이(간편결제)를 지원합니다". 셋 다 지금 상태와 다르다.

### 2. 결제수단별 허용 주기 — ★임의 정책이 아니라 심사 약속의 이행

| 결제수단 | 월간 | 연간 | 강제 지점 |
| --- | :---: | :---: | --- |
| 포트원 · KG이니시스 카드 (`CARD`) | ✅ | ✅ | 제한 없음 — `portoneBillingCycleViolation` 이 `method !== "EASY_PAY"` 면 즉시 `null` |
| 포트원 · **카카오페이** (`EASY_PAY`/`KAKAOPAY`) | ✅ | ❌ | **서버 2 + 화면 2**(아래) |
| 포트원 · 토스페이 (`EASY_PAY`/`TOSSPAY`) | ✅ | ✅ | 월간 제한 목록 밖. 단 지금은 채널키가 없어 실제로 못 쓴다(§1) |
| Paddle | ✅ | ✅ | 플랜 × 주기 × USD/JPY 가격 ID 매트릭스 |

연간 금액은 **월 × 10**(`ANNUAL_MONTH_MULTIPLIER`, 2개월 무료). 와이어 정본 낱말은 `annual` 이고 `yearly` 도 받아 정규화한다.

★**왜 카카오만 월간인가 — 우리가 고른 정책이 아니다.** 카카오페이 심사 규정이 정기결제를 "1개월 이하 주기"로 제한하고, 2026-08-31 회신 초안이 _"카카오페이 정기결제는 귀사 기준에 맞춰 1개월 이하 주기만 제공하는 방향으로 조치하겠습니다"_ 라고 약속했다. **PR #1346 이 그 약속의 코드측 이행이다.** 그래서 이 목록은 env 스위치가 아니라 **소스 상수**다(§3 마지막 행) — 심사에 약속한 것을 운영자가 env 한 줄로 열 수 있으면 약속이 아니다.

방어선 4지점(`PR #1346`):

| 층 | 지점 | 하는 일 |
| --- | --- | --- |
| 서버 ① | `index.ts:2966` `completePortOneBillingKey` | 카카오+연간을 **빌링키 confirm 전에** 잘라 발급 자체를 막는다 |
| 서버 ② | `index.ts:3587` `retryFirstCharge` | 첫청구 재시도에서도 같은 조합 거절 |
| 화면 ① | `checkout/page.tsx:306~` | 연간 체크아웃에서 카카오 옵션을 **아예 안 그린다** + 이유 안내 + 월간 전환 원클릭 |
| 화면 ② | `checkout/page.tsx:814~` | 결제 **실행 시점**에 같은 필터를 다시 태운다 |

정본은 서버 응답 `getPortOneCheckoutConfig.monthlyOnlyEasyPayProviders`(`index.ts:2067`), 화면 상수 `FALLBACK_MONTHLY_ONLY_EASY_PAY_PROVIDERS` 는 config 프리페치 실패·구버전 함수 응답용 **fail-closed 폴백**이다.

### 3. 게이트 스위치 목록 — 한 줄로 열리고 닫히는 것들

★**키 이름·기본값·효과만 적는다. 값은 이 노트 어디에도 없다.**

| 스위치 | 어디 | 지금 상태 | 열면 | 닫혀 있어도 통과하는 것 |
| --- | --- | --- | --- | --- |
| `TOSS_ENTRY_ENABLED` | functions 배포 env | **키 없음** = 차단(`"true"` 만 여는 fail-closed) | 토스 빌링키 발급·첫청구·confirm·해지 외 신규 청구·토스 갱신 크론 | 과거 원장 읽기 · 결제흔적 판정(`hasPaymentEvidence`) · 해지 · 웹훅 상태동기 · 미반영 정산 |
| `TOSS_ENTRY_DISABLED` | `billingService.ts` **소스 상수** | `true` | 앱 클라 토스 경로 | — |
| `NEXT_PUBLIC_PAYMENT_PROVIDER` | 웹 빌드 env | 미설정 | `toss`/`portone`/`paddle` 강제 | 미설정이면 로케일 통화 분기(KRW → portone, 그 외 → paddle). ★`?provider=toss` URL 로는 안 열린다 |
| `PORTONE_INICIS_BILLING_CHANNEL_KEY` · `PORTONE_INICIS_ONETIME_CHANNEL_KEY` | functions 배포 env | **둘 다 설정됨** | 이니시스 카드 정기·단건 | 없으면 `assertPortOneCheckoutConfig` 가 `failed-precondition` |
| `PORTONE_KAKAOPAY_BILLING_CHANNEL_KEY` · `PORTONE_KAKAOPAY_ONETIME_CHANNEL_KEY` | functions 배포 env | **둘 다 설정됨** | 카카오페이 옵션 노출·발급 | 없으면 `enabledPortOneEasyPayProviders` 목록에서 빠진다 |
| `PORTONE_TOSSPAY_BILLING_CHANNEL_KEY` · `PORTONE_TOSSPAY_ONETIME_CHANNEL_KEY` · 폴백 `PORTONE_EASYPAY_BILLING_CHANNEL_KEY` | functions 배포 env | **셋 다 없음** | 토스페이 간편결제가 **코드 변경 없이** 붙는다 | — |
| `PADDLE_API_KEY` · `PADDLE_WEBHOOK_SECRET` | functions 배포 env | **둘 다 없음** | Paddle 체크아웃 생성·웹훅 검증 | — |
| `PORTONE_PG_ENV` → 폴백 `PAYMENT_PG_ENV` | functions 배포 env | `PORTONE_PG_ENV` 설정됨(현재 라벨 `test`) | 원장·화면의 test/live 라벨 | ★**라벨일 뿐 실제 채널 모드가 아니다** — 키 묶음과 같이 바꾼다([[payment-live-key-pg-env-bundle]]) |
| `PORTONE_MONTHLY_ONLY_EASY_PAY_PROVIDERS` | `portone.ts` **소스 상수** | `["KAKAOPAY"]` | 코드 수정 + 배포로만 바뀐다 | ★심사 약속이라 **일부러** env 로 열지 않는다 |
| `LECTURES_COMING_SOON` | `lectures.ts` **소스 상수** | `true` | 강의 목록 라벨(체크아웃 차단은 별도 가드) | — |

### 4. 심사·계약 이력 — 각 단계에서 무엇이 바뀌었나

★아래는 **저장소에서 검증 가능한 코드 배선 순서**다(커밋 날짜). PG 입점·카드사 심사의 **접수 순서**는 포트원 콘솔·PG 메일에만 있어 이 노트가 확인하지 못했다(한계 절).

| 시점 | 무엇 | 무엇이 바뀌었나 |
| --- | --- | --- |
| 2026-07-20 | **토스페이먼츠 직결** 심사 서류·캡처 11장 제출 | 이때 국내 신규 결제는 전부 토스로 갔다. ★캡처는 `test_ck_` 키 결제창 — 그게 심사 단계의 정상 |
| 2026-07-31 | 포트원 전환 타당성 조사 (#687) | **"포트원으로 갈아타도 카드사 심사(~2주)는 안 짧아진다"** 확인. 대신 지금이 전환 최적기 — 카드사 심사 전이라 이전할 실 빌링키 구독자가 구조적으로 0 |
| 2026-08-06 | 포트원 V2 **test 연동** (#813) + oid 40자 수리 (#820) + `customer.name`/`phoneNumber` 수리 (#823) | 이니시스 채널 2개(단건·정기)로 국내 경로가 하나 더 생겼다. 토스는 **그대로 살아 있었다** |
| 2026-08-07 | 검증을 canonical GET 으로 (#825) | 즉시청구 POST 요약본으로 검증하던 것을 `GET /payments/{id}` 로 |
| 2026-08-08 | 포트원 **간편결제(EASY_PAY)** 빌링키 배선 (#862) | 수동 승인 채널(`NEEDS_CONFIRMATION` + `billingIssueToken`) 경로 추가 |
| 2026-08-22 | **토스 진입 차단** (#1129) + 앱 인앱 SDK 제거 (#1131) | ★국내 기본 provider 가 `toss` → `portone` 으로 **뒤집혔다**. 토스는 지운 게 아니라 이중 게이트로 닫혔다. 앱은 결제를 웹으로 넘긴다 |
| 2026-08-26 | **카카오페이 채널 배선** (#1230) | purpose(billing/onetime) × provider 채널키 맵. 이후 배포 env 에 카카오 채널키 4개가 들어갔다 |
| 2026-08-31 | 카카오페이 회신 판단 (#1341) → **월간 제한 구현** (#1346) | 카카오만 월간, 이니시스·Paddle 연간 유지. 회신 약속과 코드가 짝이 됐다 |

### 5. ★과거에 우리를 문 함정 — 증상 → 진범

이 절이 이 노트에서 가장 값이 크다. **증상만 보고 엉뚱한 데를 파면 하루가 간다.**

| # | 증상 | ★진범 | 지금은 |
| --- | --- | --- | --- |
| 1 | 포트원 결제창이 뜨자마자 죽는다 | **`paymentId`(oid) 가 40자 초과.** ID 에 Firebase uid(28자)를 넣으면 KG이니시스 40자 제한을 넘는다 | `portonePaymentId` 가 uid 를 빼고 `mb_{o\|s}_{nonce}` 를 `slice(0,40)` (#820) |
| 2 | 빌링키는 났는데 **첫 청구가 PortOne 500** | **`customer.name` / `phoneNumber` 를 안 보냈다.** 이니시스 빌링 청구는 `customer.email` 도 REQUIRED | 체크아웃 → `completePortOneBillingKey` → `payPortOneBillingKey` 로 전달 (#823). 이메일 없는 계정은 체크아웃에서 입력받는다 |
| 3 | 결제는 성공했는데 서버 검증이 **`payment_id_mismatch`** | **즉시청구 POST 응답 요약본(`body.payment`)에는 top-level `id`/`storeId`/`status`/`amount`/`currency` 가 없다.** 그 요약본으로 검증하면 항상 어긋난다 | 검증은 **canonical `GET /payments/{id}`** 만 (#825, `validatePortOnePaidPayment`) |
| 4 | "원장이 불변(`update` 금지)인데 재시도하면 중복 아닌가" | **가짜 긴장이다.** 이중과금을 막는 건 불변성이 아니라 **결정적 키**다 — `first_{provider}_{uid}_{plan}_{cycle}[_gN]` · `portone_{paymentId}` · `{uid}_{cycleAnchorMs}` 로 같은 재시도가 같은 문서를 claim 하고, BQ 는 같은 `row_id` 로 MERGE 한다 | ★키에 `Date.now()` 를 넣는 순간 **진짜** 이중청구가 된다(동시 호출 = 다른 키). `billing.ts` 주석이 그걸 못박는다 |
| 5 | "심사 캡처에 **테스트 키** 결제창이 찍혔다, 라이브 키로 다시 찍어야 하나" | **아니다.** 라이브 키는 심사를 통과해야 발급되므로 심사 자체를 라이브 키로 받는 것은 애초에 불가능하다 | test 키 상태 제출이 **정상 절차**. 재캡처·대기 불필요 |
| 6 | 결제 흐름을 끝까지 못 돌린다 | **국내는 공용 테스트 카드번호가 없다.** 테스트 채널에서도 일부 카드사(국민·카카오뱅크 등)는 미지원 | **완주 검증엔 실제 카드가 필요하고 그건 사람 일**이다([[human-only-ops-backlog]]). 에이전트가 대신 완주할 방법은 없다 |
| 7 | 코드를 고쳤는데 결제 동작이 그대로다 | **결제 로직은 Cloud Functions 에 있어 배포해야 반영된다.** 커밋 제목에 "(functions 재배포 필요)" 가 반복해 붙는 이유 | 응답 스키마가 늘어난 변경(`monthlyOnlyEasyPayProviders`)은 재배포 전엔 클라가 못 본다 — 그래서 화면에 **fail-closed 폴백 상수**를 둔다 |
| 8 | `billingCharges` 를 `where("provider","==","toss")` 로 조회했더니 **0건** → "토스 원장이 없다" | **토스 원장 행에는 `provider` 필드가 아예 없다.** 포트원 미러만 `provider` 를 쓴다 | 0 을 "없다" 로 읽으면 안 된다([[verify-without-gui]] 의 조회 규율과 같은 함정) |
| 9 | 앱에서 결제하면 결과가 앱으로 안 돌아온다 | **`window.location.origin` 이 Electron 에선 `file://` 또는 `127.0.0.1:5173`.** PG 가 거기로 리다이렉트해도 앱에 도달하지 않는다. ★결제사를 바꿔도 같은 함정이다 | 앱은 결제하지 않고 **웹 체크아웃으로 보낸다**. 완료 판정은 앱의 추측이 아니라 **서버가 쓴 구독 문서**(`onSnapshot`) |
| 10 | 데스크톱에서 넘긴 `provider=portone` 이 웹에서 사라진다 | **로그인 리다이렉트가 쿼리를 통째로 안 실었다** — `plan` 만 보존하고 `provider`·`billing` 을 떨어뜨렸다 | 수리됨 — `subscriptionQuery = searchParams.toString()` 전체 보존(`checkout/page.tsx:384`) |

### 6. 심사용 테스트 계정

★계정 값(아이디·비밀번호)은 **위키로 옮기지 않는다.** 문서 위치만 남긴다 — [docs/toss-review/pg-review-account.md](../../toss-review/pg-review-account.md). 그 문서에 심사 통과 후 계정 비활성화·비밀번호 변경이 후속 할 일로 적혀 있다. 2026-08-31 현재 별도 티켓 `i1cmV7Tf` 가 그 계정으로 실측 중이므로 **다른 작업이 같은 계정에 동시에 들어가지 않는다**.

## 한계 / 정직성

- **env 는 키 이름·존재 여부만 읽었다.** 값을 열지 않았으므로 채널키가 test MID 인지 live MID 인지는 이 노트가 **판정하지 못한다**. `PORTONE_PG_ENV` 는 그걸 말해 주지 않는다 — 그건 **라벨**이고, 라벨과 키가 갈리는 것 자체가 운영 사고다([[payment-live-key-pg-env-bundle]]).
- **배포 env 파일 = 배포된 함수**가 아니다. 파일의 현재 내용이 마지막 배포에 반영됐는지는 확인하지 않았다(함정 #7 과 같은 축).
- **웹(marblo-web) 빌드 env 는 저장소 밖 호스팅 설정**이라 확인하지 못했다. 저장소의 `marblo-web/.env.production` 에는 결제 관련 키가 없다 — 그래서 Paddle 판정의 근거는 **서버 키 2개 부재**이지 웹 클라 토큰이 아니다.
- **PG 입점·카드사 심사의 접수 순서와 현재 진행 단계**는 포트원 콘솔·PG 메일에만 있고 저장소에 없다. §4 는 **코드 배선 순서**이지 심사 접수 순서가 아니다.
- **카카오 월간 제한은 발급 2지점에 있고 갱신 크론에는 없다.** `scheduledChargePortOneSubscriptions`(05:00 KST)는 `portoneBillingCycleViolation` 을 부르지 않는다 — 신규 발급이 막혀 카카오+연간 구독 문서가 **생길 수 없다**는 전제 위에 서 있다. PR #1346 이전에 만들어진 카카오+연간 문서가 있다면 그건 갱신된다. 관측된 활성 포트원 구독은 **카드 월간 1건**뿐이고 그마저 운영자 테스트 결제라 실위험은 지금 0 이지만, **전제가 깨지면 이 문장이 먼저 거짓이 된다**.
- **실결제 표본이 없다.** 원장 `analytics_purchase` 36행 중 유료 실결제는 `toss/paid` 1 + `portone/paid` 1 = **2행**뿐이고 나머지 34행은 founder grant 다. 그 2행으로는 어떤 전환·매출 주장도 못 한다.
- **수치·판정이 갈리면 원본이 옳다** — `v3/functions/src/billing.ts` · `portone.ts` 와 `docs/payment/kakaopay-review-2026-08-31.md` 가 원본이다. 이 노트는 원본을 한 글자도 고치지 않았다.

## 실제 영향

**무변경.** 결제 코드·env·설정·운영 변경 0. 이 노트와 위키 인덱스류(폴더 README · LINK-MAP · 이웃 노트 Backlinks)만 추가·갱신했다. 결제 API 호출 0, 심사 계정 로그인 0.

검증(순수 로직만, PG 미호출): `npm run test:portone-easypay` 53 passed · `test:portone` 16 passed · `test:toss-shutdown` 35 passed · `test:billing` 150 passed.

## Evidence

- [docs/payment/kakaopay-review-2026-08-31.md](../../payment/kakaopay-review-2026-08-31.md) — 경로별 "연간 발행 가능한 코드 vs 실제 운영 근거" 표 · 회신 초안 · 원장 36행 집계
- [docs/payment/portone-eval.md](../../payment/portone-eval.md) — 카드사 심사 ~2주는 우회 불가 · 전환 최적기 논거 · 리스크 R1/R2
- [docs/payment/apply-guide.md](../../payment/apply-guide.md) — 신청 절차·PG 후보 비교·보증보험
- [docs/payment/portone-v2-phase1-checklist.md](../../payment/portone-v2-phase1-checklist.md) — 채널키 이름(값 없음) · 멱등키 설계 · 서버 검증 항목
- [docs/payment/desktop-domestic-checkout-handoff.md](../../payment/desktop-domestic-checkout-handoff.md) — Electron origin 함정 · 앱은 결제하지 않는다
- [docs/toss-review/README.md](../../toss-review/README.md) — 심사 캡처 11장 · 테스트 키 제출이 정상이라는 근거
- [docs/toss-review/pg-review-account.md](../../toss-review/pg-review-account.md) — 심사 계정 문서(★값은 위키로 옮기지 않는다)
- 코드 앵커: [v3/functions/src/portone.ts](../../../v3/functions/src/portone.ts) `portonePaymentId:46` · `SUPPORTED_EASY_PAY_PROVIDERS:127` · `PORTONE_MONTHLY_ONLY_EASY_PAY_PROVIDERS:216` · `portoneBillingCycleViolation:226` — [v3/functions/src/billing.ts](../../../v3/functions/src/billing.ts) `planAmountKRW:42` · `firstChargeLedgerId:185` · `isTossEntryEnabled:334` — [v3/functions/src/index.ts](../../../v3/functions/src/index.ts) `assertTossEntryEnabled:1027` · `PORTONE_EASY_PAY_CHANNEL_KEYS:1045` · `getPortOneCheckoutConfig:2067` · `completePortOneBillingKey:2966` · `retryFirstCharge:3587` · `scheduledChargeSubscriptions:9163` · `scheduledChargePortOneSubscriptions:9283` — [marblo-web/src/lib/paymentProvider.ts](../../../marblo-web/src/lib/paymentProvider.ts) `resolveCheckoutProvider` — [marblo-web/src/app/[locale]/checkout/page.tsx](../../../marblo-web/src/app/%5Blocale%5D/checkout/page.tsx) `FALLBACK_MONTHLY_ONLY_EASY_PAY_PROVIDERS:145` · 주기 필터 `:306` `:814` — [v3/src/services/billingService.ts](../../../v3/src/services/billingService.ts) `TOSS_ENTRY_DISABLED:188`
- PR: #813 · #820 · #823 · #825 · #862 · #1129 · #1131 · #1230 · #1341 · **#1346**(카카오 월간 제한)

## Backlinks

- [[payment-live-key-pg-env-bundle]] — 라이브 전환 때 같이 바꾸는 키 묶음. 이 노트는 그 키들이 **지금 어떤 상태인지**의 정본
- [[paddle-support-check-before-pg-screening]] — 새 결제수단·새 나라를 열기 전 순서
- [[human-only-ops-backlog]] — 실카드 완주 검증·포트원 승인처럼 사람만 할 수 있는 일
- [[verify-without-gui]] — 창 없이 검증하는 법. 이 노트의 테스트 4종이 그 경로
