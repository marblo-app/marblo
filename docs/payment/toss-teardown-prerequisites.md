# 토스페이먼츠 PG 직결 정리 — 1단계 실행분 · 3단계 삭제 선행조건

작성: 2026-08-22 · 티켓 `eaFlha8f0baL9BigdWWM`

토스페이먼츠는 **PG 직결**(`api.tosspayments.com`)이고, 간편결제(토스페이)와는 별개다.
신규 결제는 포트원으로 일원화한다. 다만 **통째로 지우지 않는다** — 지우면 조용히
깨지는 것들이 있어서, "진입 경로만 닫고 읽기·판정은 남긴다"로 간다.

이 문서는 (1) 1단계에서 실제로 무엇을 닫았는지, (2) 왜 나머지를 남겼는지,
(3) **3단계(완전 삭제)를 하려면 그 전에 무엇이 필요한지**를 적는다.

---

## 0. 착수 전 실측 — 티켓 전제 두 개가 틀렸다

작업 전 가정과 실제가 달랐다. 3단계를 판단할 사람이 같은 함정을 밟지 않도록 먼저 적는다.

### ★① "포트원이 유일하게 살아 있는 결제 경로다" — 아니었다

작업 전 `marblo-web`의 체크아웃 기본값은 **toss**였다:

```ts
// marblo-web/src/app/[locale]/checkout/page.tsx (변경 전)
const paymentProvider: PaymentProvider =
  searchParams.get("provider") === "portone" ||
  process.env.NEXT_PUBLIC_PAYMENT_PROVIDER === "portone"
    ? "portone"
    : "toss"; // ← 기본값
```

그런데 `NEXT_PUBLIC_PAYMENT_PROVIDER`는 **레포 어느 환경 파일에도 설정된 적이 없다**
(`marblo-web/.env.production`에 실제로 든 키는 `NEXT_PUBLIC_FOUNDER_SURVEY_PROMPT_OPEN`
하나뿐). 즉 URL에 `?provider=portone`을 직접 붙이지 않는 한 **모든 신규 결제가 토스로
가고 있었다.** 포트원 구독이 active 1건뿐인 것과 정합한다.

→ **함의:** 이 작업은 "죽은 경로 치우기"가 아니라 **실질적인 포트원 전환 그 자체**다.
기본값을 뒤집는 순간 포트원이 처음으로 실트래픽 100%를 받는다. 그래서 포트원 회귀
테스트가 부가조건이 아니라 본체다.

### ★② "billingCharges에 provider='toss' 행이 몇 건인가" — 이 질문은 항상 0을 돌려준다

토스 청구 원장 write는 **`provider` 필드를 아예 쓰지 않는다**:

```ts
// index.ts — 토스 청구 claim 문서
tx.set(chargeRef, {
  userId, orderId, amount, planType, reason: params.reason,
  status: "pending", cycleAnchorMs, couponCode, createdAt, updatedAt,
  // ← provider 없음
});

// index.ts — 포트원 미러만 provider 를 쓴다
tx.set(chargeRef, { userId, provider: "portone", ... });
```

따라서 `where("provider","==","toss")`는 **토스 행이 몇 건이든 0을 반환한다.**
그 0을 "토스 원장이 없다"로 읽으면 정확히 거꾸로 간다.

**토스 행을 세는 올바른 방법:**

| 세려는 것      | 방법                                          |
| -------------- | --------------------------------------------- |
| 전체 원장      | `billingCharges` 전체 count                   |
| 포트원 행      | `provider == "portone"` count                 |
| **토스 행**    | **전체 − 포트원** (또는 `provider` 필드 부재) |
| 토스 실매출 행 | 위 차집합 중 `status == "succeeded"`          |

문서ID 패턴으로도 갈린다 — 토스 첫청구 `first_toss_*`, 토스 갱신 `{userId}_{cycleAnchorMs}`,
포트원 `portone_*` / `first_portone_*`.

> **미해결:** 실제 행 수는 이번에 못 셌다(gcloud 토큰 만료 + 재인증이 대화형이라 비대화형
> 세션에서 불가, firebase CLI 15.23.0에 쿼리 명령 없음). **3단계 착수 전 반드시 위 방식으로
> 실측할 것.** 프로젝트 `marblo-2253d`, 읽기 전용 aggregation으로 충분하다.

### ★③ 데스크톱 앱에는 포트원 결제 경로가 없다

`v3/src/`에서 portone은 **표시·해지·타입에만** 존재하고, 결제를 시작하는 코드가 없다.
데스크톱 국내 결제 수단 4종(`card_kr`/`naverpay`/`kakaopay`/`tosspay`)은 **전부
`provider: "toss"`** 다. 데스크톱에서 토스를 완전히 걷어내면 남는 결제수단은
**Paddle(해외/USD) 하나**이고, 국내 사용자는 데스크톱에서 원화 결제를 못 하게 된다.

---

## 1. 이번에 닫은 것 (1단계 실행분)

신규로 **돈이 움직이는** 경로만 닫았다. 되돌리는 스위치를 남겼다.

### 서버 (`v3/functions/src/`)

게이트: `isTossEntryEnabled(process.env.TOSS_ENTRY_ENABLED)` — **명시적으로 `"true"`일
때만 열린다.** 미설정·빈값·오타는 전부 차단(fail-closed).

| 대상                           | 무엇인가                                         | 조치                                        |
| ------------------------------ | ------------------------------------------------ | ------------------------------------------- |
| `createTossCheckout`           | 토스 체크아웃 주문 생성                          | 차단                                        |
| `confirmTossPayment`           | 토스 결제 confirm                                | 차단                                        |
| `issueBillingKey`              | **토스 빌링키 발급 — 신규 정기결제의 실제 입구** | 차단                                        |
| `chargeBillingKey`             | 토스 빌링키 수동 청구                            | 차단                                        |
| `confirmLecturePayment`        | 강의 단건 토스 confirm                           | 차단                                        |
| `retryFirstCharge`             | 첫청구 재시도                                    | **토스 분기만** 차단 (포트원 재시도는 유지) |
| `scheduledChargeSubscriptions` | 토스 전용 갱신 크론 (04:30 KST)                  | 조기 return                                 |

**크론 정지 안전 근거:** 이 크론은 `paymentProvider == "toss"`만 스캔하고, 포트원 갱신은
**별도 크론** `scheduledChargePortOneSubscriptions`(05:00 KST)가 처리한다. 함수 자체는
남겼다 — 배포에서 지우면 되살릴 때 스케줄 재생성이 필요하고 실행 로그도 끊긴다.

### 클라이언트

- `marblo-web/src/lib/paymentProvider.ts` (신규): `resolveCheckoutProvider()` —
  **기본값 portone.** `?provider=toss` 같은 URL 파라미터로는 토스로 못 돌아간다
  (진입을 닫는 게 목적인데 URL만 알면 열리면 닫은 게 아니다). 되돌리려면 운영자가
  `NEXT_PUBLIC_PAYMENT_PROVIDER="toss"`를 명시해야 하고, 그 경우에도 **서버 게이트가
  따로 열려 있어야** 실제 결제가 된다(이중 안전장치).
- `v3/src/services/billingService.ts`: 토스 콜러블 호출 전 선차단 +
  `filterAvailablePaymentMethods()` export. 결제창을 띄운 뒤 실패시키는 대신
  누르기 전에 끊는다.

---

## 2. 일부러 남긴 것 — 지우면 조용히 깨진다

| 남긴 것                                                                                        | 지우면 무슨 일이 나나                                                                                                                                  |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`hasPaymentEvidence()`의 toss 필드 검사** (`billing.ts` + `index.ts` 로컬 동명 헬퍼 **2벌**) | "결제한 흔적이 있나" 판정이 바뀐다. 해지·실효한 前토스 결제자가 오판되어 **파운더 그랜트가 잘못 나간다.** `index.ts` 주석이 직접 경고하는 그 케이스다. |
| `billingCharges` 원장 읽기                                                                     | **과거 매출이 안 보인다.** 어드민 분석·`analytics_purchase`·`first_paid_at` 산출이 전부 이 원장을 읽는다.                                              |
| `selectDueForCharge`의 toss 분기 (순수 함수)                                                   | 롤백 시 로직을 복원해야 하고, 과거 동작 재현 테스트도 못 쓰게 된다. 차단은 크론 호출부에서 한다.                                                       |
| `scheduledReconcileToss` + `reconcileTossPending()`                                            | 웹훅이 유실된 **과거** 결제가 영구 미반영으로 남는다.                                                                                                  |
| `tossWebhook`                                                                                  | 기존 결제의 상태 변화(취소·환불)를 못 받는다.                                                                                                          |
| `cancelTossSubscription` / `cancelSubscription`                                                | **레거시 토스 구독자가 해지를 못 하게 된다.**                                                                                                          |
| `TOSS_SECRET_KEY` (env)                                                                        | 원장 조회·정산 재조회가 죽는다. ★**지우지 말 것.**                                                                                                     |
| 어드민 분석의 토스 과거 표시                                                                   | 과거 매출 구간이 화면에서 사라진다.                                                                                                                    |

---

## 3. 완전 삭제(3단계)의 선행조건

아래가 **전부** 충족되기 전에는 삭제하지 않는다.

### 3.1 데이터 — 무엇을 잃는지 먼저 알아야 한다

- [ ] **토스 원장 행 수 실측** (§0-② 방식. `provider=="toss"`로 세지 말 것)
- [ ] 그중 `status=="succeeded"` 행 수 = 실매출 행 수
- [ ] 토스 매출의 **회계·세무 보존 기간** 확정. 전자상거래법상 대금결제 기록은 **5년**
      보존이 통상 기준 — 이 기간 내 데이터는 원장에서 지우지 않는다.
      (삭제 대상은 "코드"이지 "데이터"가 아님을 분리해서 판단할 것)
- [ ] 원장을 코드에서 떼려면 **대체 조회 경로**(BigQuery 미러 등)가 먼저 있어야 한다.
      현재 `analytics_purchase` 파이프라인이 Firestore 원장을 읽는다.

### 3.2 파운더 그랜트 판정 대체

- [ ] `hasPaymentEvidence()`가 토스 필드 없이도 前결제자를 올바르게 판정하는 대체 수단
      (예: `paymentHistory` 플래그 백필, 또는 원장 기반 판정으로 전환)
- [ ] ★**동명 함수가 2벌 있다** — `billing.ts:298`(순수, 테스트됨)과 `index.ts` 로컬 헬퍼.
      두 벌의 판정 범위가 다르다(로컬 쪽은 `tossCustomerKey`·`paymentProvider`까지 본다).
      **둘 다** 손봐야 하고, 한쪽만 고치면 반대쪽이 과교정된다(이미 그런 이력이 있다).
- [ ] 백필 후 **파운더 선정 결과가 변하지 않음**을 실데이터로 검증

### 3.3 잔존 구독 — 사람이 잠기지 않는지

- [ ] `paymentProvider=="toss"` 구독 중 `status in (active, past_due)` = **0** 재확인
      (2026-08-22 시점 0건. 삭제 시점에 다시 확인할 것)
- [ ] `pending_first_charge` 상태의 토스 구독 잔존분 처리
- [ ] 남은 토스 구독자가 있다면 **포트원으로 이관하거나 해지 안내**가 먼저

### 3.4 심사·계약

- [ ] ★**토스 가맹점(간편결제) 심사와의 분리 확인.** 심사 대상은 토스페이(간편결제)이고
      이 PG 직결과 별개지만, **PG 직결 해지가 심사에 영향을 주지 않는지** 토스 측 확인 필요.
      (3회 반려 후 재접수 준비 중 — 심사 진행 중 계약 상태를 바꾸는 것은 위험)
- [ ] 토스페이먼츠 **가맹 계약 해지 절차**와 정산 잔액 확인
- [ ] 해지 후에도 **과거 거래 조회 API 접근이 유지되는지** 확인 (안 되면 그 전에 원장 스냅샷 확보)

### 3.5 코드·환경

- [ ] `TOSS_SECRET_KEY` 등 env 정리는 **맨 마지막.** 원장 조회가 끝난 뒤에.
- [ ] `@tosspayments/tosspayments-sdk` 의존성 제거 (`marblo-web`)
- [ ] 삭제 대상 파일: `marblo-web/src/lib/toss.ts`, `webhookVerify.ts`의 토스 분기,
      `reconciliation.ts`의 토스 분기, `index.ts`의 토스 콜러블·크론·웹훅
- [ ] 데스크톱: §0-③ 때문에 **포트원 결제 경로를 먼저 만들어야** 토스 4종을 걷어낼 수 있다

### 3.6 검증

- [ ] 포트원 **실결제 1건 완주** (라이브 검증 티켓 `0y1TmJpOqEozP0xCllrN` — 아직 한 번도
      완주된 적 없음). ★이게 안 되면 3단계는 시작하지 않는다.
- [ ] 삭제 후 어드민 매출 화면의 과거 구간이 그대로인지 스냅샷 대조

---

## 4. 롤백

| 되돌릴 것          | 방법                                                |
| ------------------ | --------------------------------------------------- |
| 서버 토스 진입     | `TOSS_ENTRY_ENABLED="true"` (재배포 불필요, env만)  |
| 토스 갱신 크론     | 위와 동일 스위치                                    |
| 웹 체크아웃 기본값 | `NEXT_PUBLIC_PAYMENT_PROVIDER="toss"`               |
| 데스크톱           | `billingService.ts`의 `TOSS_ENTRY_DISABLED = false` |

★웹 체크아웃을 토스로 되돌리려면 **클라이언트와 서버를 모두** 열어야 한다. 한쪽만 열면
결제창은 뜨는데 서버에서 거절된다 — 의도된 설계다(실수로 반쯤 열리는 것 방지).
