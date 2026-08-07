# 결제 흐름 실패 시나리오 전수점검 (findings only)

- **Date:** 2026-08-07  
- **Task:** `4UqQHLzAHZbY9Qr7lnoY`  
- **Scope (read-only):**  
  - `marblo-web/src/app/[locale]/checkout/page.tsx`  
  - `marblo-web/src/app/[locale]/checkout/success/page.tsx`  
  - `marblo-web/src/app/[locale]/checkout/fail/page.tsx`  
  - `marblo-web/src/components/CouponInput.tsx`  
  - `marblo-web/src/app/[locale]/my/subscription/page.tsx`  
  - `v3/functions/src/index.ts` (PortOne/Toss complete·issue·charge·cron·cancel)  
  - `v3/functions/src/billing.ts`, `v3/functions/src/portone.ts`, `v3/functions/src/entitlement.ts`  
  - `v3/src/components/settings/BillingPage.tsx`  
- **Constraint:** 코드 변경 없음. 갭은 후속 픽스 티켓으로 분리.

## 흐름 요약

| 경로 | 클라 | 서버 확정 | 멱등 키 |
|------|------|-----------|---------|
| PortOne 구독 | `requestIssueBillingKey` → `completePortOneBillingKey` → success 리다이렉트 | 서버 `planAmountKRW` + 빌링키 즉시청구 | `billingCharges/portone_{paymentId}` (`paymentId` ← `Date.now()` 앵커) |
| PortOne 단건(강의) | 현재 checkout에서 lecture 진입 차단 | `createPortOnePaymentIntent` / `completePortOnePayment` 존재 | 동일 패턴 |
| Toss 구독 | `requestBillingAuth` → success URL → `issueBillingKey` | 빌링키 발급 + `chargeSubscriptionIdempotent` | `billingCharges/{userId}_{cycleAnchorMs}` |
| Toss 강의 | 동일 차단 | `createLectureOrder` / `confirmLecturePayment` | 주문·구매 문서 |
| 갱신 크론 | — | Toss `scheduledChargeSubscriptions` 04:30 KST / PortOne `scheduledChargePortOneSubscriptions` 05:00 KST | 사이클 앵커 = `currentPeriodEnd` |

서버 금액 권위는 구독 경로에서 대체로 확보됨. **첫 청구 멱등 앵커가 `Date.now()`** 라서 동시/재시도 시 이중청구 위험이 남음.

---

## Findings 표

| # | 시나리오 | 현재 처리 | 갭 | 심각도 | 권장 수정 |
|---|----------|-----------|-----|--------|-----------|
| 1 | 이중 클릭 / 중복 제출 | 클라 `loading` + 버튼 `disabled` (`checkout/page.tsx:663-667`, `setLoading(true)` 256). 서버: 갱신 크론·수동청구는 `billingCharges` claim + stale pending 15분 (`index.ts:1314-1388`, `1455-1520`). | **첫 청구**(`completePortOneBillingKey` 1654, `issueBillingKey` 1840) 앵커가 `Date.now()` → 동시 두 호출 = **서로 다른 paymentId/orderId** → claim이 서로를 막지 못함. loading은 탭 단위라 네트워크 지연 중 재진입 불가 방어 약함. | **높음** | 첫 청구 앵커를 결정적으로: 예) `first_{userId}_{plan}_{billingCycle}` 또는 `subscriptions/{uid}` 트랜잭션 선claim. 성공 후 재호출은 `idempotent: true` + no re-charge. 클라: submit 직후 전역 lock / sessionStorage 결제 진행 플래그. |
| 2 | 미지원 카드(국민·카카오뱅크 테스트 등) | PG 에러 메시지만 catch → `setError(message)` (`checkout/page.tsx:416-419`). 사전 차단·안내 UI 없음. | 사용자는 결제창까지 들어간 뒤 암호적 PG 문구만 봄. 테스트모드 카드 화이트리스트 문서/인앱 안내 부재. | 중간 | checkout에 “테스트 카드 안내”/라이브 시 미지원사 링크. `response.code` 매핑 테이블로 한글 친화 메시지. |
| 3 | SDK 로드 실패·네트워크 | preload catch → `t("sdkLoadError")` (`191-208`). 버튼 `!sdkReady` 비활성. PortOne script `onerror` reject (`166-187`). | 로드 실패 후 **재시도 버튼 없음**(새로고침 의존). Firebase callable 네트워크 실패 시 원문/Firebase 코드가 그대로 노출될 수 있음. | 중간 | “다시 불러오기” CTA. callable 에러 코드별 사용자 문구 매핑(`functions/unavailable` → 네트워크 재시도). |
| 4 | 결제창 취소/닫음 | PortOne: `response.code` 있으면 throw (`343`, `363`) → 같은 페이지 에러. Toss: `failUrl` → `checkout/fail` (`fail/page.tsx`). | PortOne 취소는 fail 페이지가 아니라 checkout 잔류(경로 불일치). PG 원문 `message` 그대로. | 낮음 | 취소 코드(`USER_CANCEL` 등)면 soft 톤(“결제를 취소했습니다”) + 재시도. Toss/PortOne 취소 UX 통일. |
| 5 | 이미 활성 구독 재결제 | checkout/서버 **active 구독 사전 검사 없음**. `completePortOneBillingKey` / `issueBillingKey` 모두 `subscriptions/{uid}.set(..., {merge:true})` 로 덮어씀 (`1735-1757`, `1860-1882`). | 활성 유저 재결제 시 **이중 청구 + 기간/키 덮어쓰기**. 강의는 `already purchased` 방어 있음(`2036-2047`) — 구독은 대칭 방어 부재. | **높음** | complete/issue 진입 시 `status in (active, past_due)` && 기간 유효면 `failed-precondition: already_subscribed` + 클라 checkout에서 my/subscription 리다이렉트. 업그레이드/플랜변경은 별 플로우. |
| 6 | 쿠폰 무효·만료 | 서버 `resolveFirstChargeAmount` 무효 시 **정가 폴백, throw 없음** (`1583-1614`) — 결제 자체 보호는 올바름. 클라는 `validateCoupon` 성공 시에만 할인 표시 (`CouponInput.tsx`). | 적용 시점과 결제 시점 사이 만료/한도 초과 시 **화면에 할인 총액, 서버는 정가 청구**. success URL `amount=` 는 클라 `finalAmount` (`377`) → 완료 화면에 **실제 청구와 다른 금액** 표시. 사용자에게 “정가 폴백” 고지 없음. | **높음** (신뢰/CS) | complete 응답에 `chargedAmount`/`couponApplied` 반환 → success가 서버 금액 표시. 폴백 시 결제 전 확인 모달 또는 `coupon_expired` soft-fail 후 재확인. |
| 7 | 세션/ID 토큰 만료 중 결제 | callable 전부 `context.auth` 필수. 미인증 → `unauthenticated`. success `catch` → 일반 에러 (`success/page.tsx:200-205`). | 빌링키 발급 **성공 직후** 토큰 만료로 complete 실패 시: PortOne은 키가 발급됐으나 구독 미생성(시나리오 8과 결합). 재로그인 유도 UI 없음. | 중간 | callable 전 `user.getIdToken(true)`. 401 시 login `redirect` 복귀. 부분성공 시 “이미 카드 등록됨 — 청구 재시도” 경로(시나리오 8). |
| 8 | ★빌링키 발급 성공 · 서버 청구 실패 | Toss: 키 발급(`1807-1830`) 후 청구 실패 시 구독 active 안 함 throw (`1850-1855`) — GAP A(₩0 활성) 방지 의도 명시. PortOne: 키는 클라 SDK, 청구 실패 시 charge `failed` + throw (`1710-1730`), 구독 미저장. | PG 측에 **고아 빌링키** 남음. 재시도 = 전체 카드 등록 다시. 사용자 문구는 “첫 결제 실패” 수준, **돈 나갔는지/키만 있는지** 구분 없음. 운영 회수(키 폐기) 자동화 없음. | **높음** | 청구 실패 시 `subscriptions/{uid}`에 `status:pending_first_charge` + `billingKey` 저장( entitlement는 free). `retryFirstCharge` callable(멱등). UX: “카드는 등록됐으나 청구 실패 — 재시도”. 고아 키 정리 잡. |
| 9 | 부분 실패 후 재시도 멱등 | 갱신: 동일 `cycleAnchorMs=currentPeriodEnd` + succeeded/comped skip + failed 재시도 허용 (`1356-1368`). 크론 skipped도 기간 연장 (`6053-6055`) — 좋은 패턴. | **첫 청구** 재시도마다 새 앵커 → 이전 청구가 PG 성공·클라 타임아웃이면 **이중청구**. PortOne first path는 `chargePortOneSubscriptionIdempotent`와 달리 인라인 청구(`1688-1701`)라 stale-pending 재진입 정책이 약함(succeeded만 short-circuit `1666`). | **높음** | 첫 청구도 헬퍼 공통화 + 유저당 단일 first-charge doc. PG 조회 후 이미 PAID면 succeeded로 수렴. |
| 10 | amount 조작 방어 | 구독: 서버 `planAmountKRW` / `portoneExpectedAmount` (`1641-1647`, `1797-1804`). 단건: `pendingPortOneOrders.amount` 권위 (`1124-1159`). 강의 Toss: 주문 금액 vs 클라 amount 검증 (`2099-2104`). 클라 amount는 주로 GA4/표시. | success/GA4 `amount` 쿼리 조작 가능(매출 이벤트 오염, 실청구 무관). PortOne 구독 success는 **재검증 callable 없음** (`success/page.tsx:186-197`) — 표시/GA4만. | 중간 (보안: 낮~중 / 데이터: 중) | GA4 value는 complete 응답의 서버 금액. success 페이지 옵션: `getSubscription` 확인 후 성공 UI. |
| 11 | ★결제 성공 · 리다이렉트 실패/새로고침 | PortOne 구독: complete **후** `router.push` (`365-378`). success는 재확정 없이 GA4+성공 UI. Toss: success 마운트에서 `issueBillingKey` — 새로고침 시 재호출. | PortOne: complete 성공 후 탭 종료 시 구독은 있으나 완료 페이지 못 봄 → 재결제 시도 → **#5+#1 이중청구**. Toss success 재호출은 새 `Date.now()` 앵커면 위험, 동일 authKey 재사용 실패 가능(암호 에러). 처리 중 안내 문구는 있음(`219-222`). | **높음** | complete 멱등 강화(#1#5)가 근본. success가 `subscriptions` 스냅샷 구독 확인. “이미 구독 중” empty state. 이메일 영수증. |
| 12 | 동시 결제(두 탭/기기) | 클라 로딩 게이트 무력. 서버 유저 단위 직렬화 없음. | #1+#5와 동일 이중청구·덮어쓰기. | **높음** | `subscriptions/{uid}` 트랜잭션: `checkoutLock` / active 가드. Firestore 단일 writer. |
| 13 | 환불·구독취소 | **해지:** `cancelTossSubscription` — status `canceled`, 환불 없음, 기간말 접근은 entitlement (`1992-2021`, `entitlement.ts`). 웹 `my/subscription`은 paddle 외 **전부 cancelTossSubscription** 호출(`96-100`) — PortOne도 동일 함수로 동작(이름 혼동). **데스크톱** `BillingPage`: Toss/PortOne은 `alert(cancelViaSupport)` (`246-248`), Paddle만 포털/취소. **중도 환불 API 없음**(정책 페이지 `legal/refund`만). 청구 3회 실패 시 free 강등 (`applyChargeFailure` MAX=3). | 인앱 취소 UX 불일치(웹 vs 데스크톱). PortOne 전용 cancel 이름/문서 부재. 셀프 환불·부분환불 자동화 없음(의도적일 수 있음). past_due 사용자 cancel UX 불명확. | 중간 | 웹/앱 모두 `cancelSubscription` 단일 callable(provider 분기). 데스크톱 support alert 제거 또는 실제 cancel 연결. 환불은 운영 툴 + 웹훅 경로 문서화. |
| 14 | email/name/phone 누락 | PortOne 클라: phone 10–11 필수 (`120-124`, `251-255`, `576-613`). name = displayName 폴백 `"Marblo User"` (`295`). email 없으면 `console.warn`만 (`297-300`), 요청은 진행. 서버: `customerEmail` optional (`998`), name/phone complete에 전달. 크론: name/phone 없으면 **스킵(해지 방지)** (`6141-6148`). | email 없는 소셜 계정 → KG 청구 실패 가능(별도 티켓 `AMjq7Q5OkllL5pR7TiHU`). displayName 없는 유저 기본 이름. 첫 결제 성공 후 name/phone 미저장 레거시는 갱신 영구 스킵 → **무과금 이용** 가능. | **높음** (email/갱신 스킵) / 중간 (name) | 결제 전 email 강제 수집·저장(진행 중 티켓과 병합). 크론 스킵 알림/메트릭 + past_due 전환 정책 검토(현재는 스킵만). |
| 15 | 3rd-party 동의 미체크 | 체크박스 필수 + 버튼 disabled (`616-637`, `663-667`). 미체크 시 `consentRequired` (`247-249`). | 우회 어려움(정상). 키보드/접근성 외 실질 갭 적음. | 낮음 | 유지. 동의 시각·버전을 구독 문서에 감사 로그로 남기면 심사 대응 강화. |

---

## 추가 발견 (목록 외)

| ID | 발견 | 심각도 | 권장 |
|----|------|--------|------|
| A | **success 페이지 PortOne 구독 분기**는 auth/구독 검증 없이 쿼리만 있으면 성공 UI + GA4 (`success/page.tsx:186-198`). | 중간 | 로그인 필수 + `subscriptions/{uid}` active 확인 후에만 성공 UI. |
| B | **completePortOnePayment(단건)** 성공 시 `subscriptions`를 active로 set (`1178-1194`) — 강의/단건이 구독 문서를 오염시킬 수 있음(현재 lecture checkout 차단으로 완화). | 중간 | 단건은 `lecturePurchases`/`oneTimeEntitlements`만. 구독 문서 금지. |
| C | **쿠폰 타입** `free_trial`/`plan_upgrade` → finalAmount 0 comped (`billing.ts:82-84`). 클라 `CouponInput`은 `discountPercent`만 UI 반영 (`handleCouponApply` 216-219) — 전액 무료 쿠폰 시 화면 총액이 정가일 수 있음. | 중간 | 쿠폰 타입별 클라 표시 동기화. |
| D | Firebase `HttpsError` 메시지가 한국어/영어 혼재, 일부 기술 코드(`payment_not_paid`) 노출 가능. | 낮음 | 공개 코드 맵 + 로케일 메시지. |
| E | 라이브 전환 체크리스트 티켓(`XnAlc1Wvx9YLZwhEfRX4`)과 교차: 본 감사의 **높음** 항목은 라이브 키 컷오버 **전** 픽스 권장. | — | 오케 후속 티켓 시 mission 라벨로 묶기. |

---

## 심각도 높음 요약 (우선 픽스 큐)

1. **활성 구독 재결제 미차단** (#5) + **완료 후 재시도** (#11) → 이중 과금  
2. **첫 청구 멱등 앵커 = `Date.now()`** (#1, #9, #12) → 동시성 이중 청구  
3. **빌링키 성공·청구 실패 복구 경로 없음** (#8)  
4. **쿠폰 폴백 시 표시 금액 ≠ 실청구** (#6)  
5. **email 누락 / 크론 name·phone 스킵으로 갱신 누락** (#14)

---

## 잘 된 점 (유지)

- 갱신 크론 멱등 + failed 백오프 + MAX 실패 해지 (`billing.ts` + cron).  
- 서버 금액 권위 (`planAmountKRW` / pending order).  
- 첫 결제 실패 시 구독 active 금지 (₩0 활성 GAP A 방지 주석과 일치).  
- 해지 ≠ 즉시 몰수 (entitlement + `cancelTossSubscription`).  
- 동의·(PortOne) phone 게이트, SDK preload 실패 시 결제 버튼 비활성.  
- Toss 웹훅 status 위조 방지(재조회로만 반영, `index.ts:1207+` 주석).

---

## 권장 후속 티켓 쪼개기 (오케용)

| 티켓 초안 | 심각도 | 범위 |
|-----------|--------|------|
| `billing-guard-active-resubscribe` | P0 | complete/issue/active 가드 + checkout 리다이렉트 |
| `billing-first-charge-idempotency` | P0 | 결정적 first-charge doc + 헬퍼 통일 |
| `billing-orphan-key-retry` | P0 | pending_first_charge + retryFirstCharge |
| `checkout-coupon-amount-truth` | P1 | 서버 chargedAmount 표시/폴백 UX |
| `checkout-email-phone-gate` | P1 | (기존 `AMjq7Q5`와 병합) |
| `cancel-ux-unify-web-desktop` | P2 | PortOne 포함 단일 cancel + 데스크톱 연결 |
| `success-page-verify-subscription` | P2 | success 실구독 확인 |

---

## 검증 메모 (감사 방법)

- 정적 코드 경로 추적 위주. 라이브 PG 호출·실카드 테스트는 본 태스크 범위 외 (`0y1TmJpOqEozP0xCllrN` 등 별도).  
- 라인 번호는 워크트리 `4UqQHLzAHZbY9Qr7lnoY` / `main@5d6d9dc3` 근처 스냅샷 기준.  
- 코드 변경·배포 없음.
