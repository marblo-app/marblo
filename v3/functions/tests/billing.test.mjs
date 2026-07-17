// 정기결제 순수 로직 단위테스트 — 컴파일된 모듈을 import 해 구현과 drift 없게 한다.
// (webhookVerify.test.mjs 와 동일 방침) 빌드 후 실행:
//   cd v3/functions && npm run build && node tests/billing.test.mjs
//
// 커버: 멱등키 생성 / 쿠폰 할인 / 갱신 대상 선정 / 성공·실패 상태전이.
// 돈 직결이라 "중복청구 방지(멱등)"·"실패→유예→해지" 를 최우선으로 검증.

import {
  PLAN_PRICES_KRW,
  MAX_BILLING_RETRIES,
  RETRY_INTERVAL_DAYS,
  applyCouponDiscount,
  nextPeriodEnd,
  billingChargeDocId,
  billingOrderId,
  selectDueForCharge,
  applyChargeSuccess,
  applyChargeFailure,
  hasPaymentEvidence,
} from "../lib/billing.js";

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error("  ✗ FAIL:", msg);
  }
}
function eq(a, b, msg) {
  assert(
    a === b,
    `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-07-10T00:00:00Z");

// ── 멱등키 ────────────────────────────────────────────────────────────
// 같은 (uid, 사이클앵커) → 같은 문서 ID(중복청구 방지의 핵심).
eq(billingChargeDocId("u1", 12345), "u1_12345", "docId deterministic");
assert(
  billingChargeDocId("u1", 111) !== billingChargeDocId("u1", 222),
  "다른 사이클 앵커는 다른 docId"
);
assert(
  billingChargeDocId("u1", 111) !== billingChargeDocId("u2", 111),
  "다른 유저는 다른 docId"
);
eq(billingOrderId("u1", 999), "sub_u1_999", "orderId deterministic");

// ── 쿠폰 할인 ─────────────────────────────────────────────────────────
{
  const base = PLAN_PRICES_KRW.pro; // 19000
  eq(applyCouponDiscount(base, null).finalAmount, base, "쿠폰 없음 → 정가");
  const d = applyCouponDiscount(base, {
    type: "discount",
    discountPercent: 30,
  });
  eq(d.discountAmount, 5700, "30% 할인액");
  eq(d.finalAmount, 13300, "30% 할인 후 금액");
  eq(
    applyCouponDiscount(base, { type: "free_trial" }).finalAmount,
    0,
    "free_trial → 0원"
  );
  eq(
    applyCouponDiscount(base, { type: "plan_upgrade" }).finalAmount,
    0,
    "plan_upgrade → 0원"
  );
  eq(
    applyCouponDiscount(base, { type: "bogus" }).finalAmount,
    base,
    "미지원 타입 → 정가"
  );
  // 100% 초과/음수 방지
  const over = applyCouponDiscount(base, {
    type: "discount",
    discountPercent: 150,
  });
  eq(over.finalAmount, 0, "150% 할인도 음수 안 됨(0 클램프)");
}

// ── 기간 계산 ─────────────────────────────────────────────────────────
{
  const end = nextPeriodEnd(new Date(Date.parse("2026-01-31T00:00:00Z")));
  assert(end.getTime() > Date.parse("2026-02-01T00:00:00Z"), "1개월 후로 전진");
}

// ── 갱신 대상 선정 ────────────────────────────────────────────────────
const baseSub = {
  paymentProvider: "toss",
  status: "active",
  planType: "pro",
  tossBillingKey: "bk_1",
  tossCustomerKey: "ck_1",
  currentPeriodEndMs: T0 - DAY_MS, // 하루 전 만료 → 도래
};
assert(selectDueForCharge(baseSub, T0), "만료 도래 active → 청구 대상");
assert(
  !selectDueForCharge({ ...baseSub, currentPeriodEndMs: T0 + DAY_MS }, T0),
  "아직 만료 전 → 비대상"
);
assert(
  !selectDueForCharge({ ...baseSub, founderGrant: true }, T0),
  "파운더 grant → 절대 비대상"
);
assert(
  !selectDueForCharge({ ...baseSub, paymentProvider: "paddle" }, T0),
  "비-토스 → 비대상"
);
assert(
  !selectDueForCharge({ ...baseSub, tossBillingKey: null }, T0),
  "빌링키 없음 → 비대상"
);
assert(
  !selectDueForCharge({ ...baseSub, status: "canceled" }, T0),
  "canceled → 비대상"
);
assert(
  selectDueForCharge({ ...baseSub, status: "past_due" }, T0),
  "past_due + 도래 + 재시도시각 없음 → 대상"
);
assert(
  !selectDueForCharge(
    { ...baseSub, status: "past_due", nextRetryAtMs: T0 + DAY_MS },
    T0
  ),
  "past_due + 재시도 백오프 중 → 비대상"
);
assert(
  selectDueForCharge(
    { ...baseSub, status: "past_due", nextRetryAtMs: T0 - 1 },
    T0
  ),
  "past_due + 재시도 시각 지남 → 대상"
);

// ── 결제 증거 판정 ────────────────────────────────────────────────────
assert(
  hasPaymentEvidence({ tossBillingKey: "bk_1" }),
  "Toss billingKey → 결제 증거 있음"
);
assert(
  hasPaymentEvidence({ paddleSubscriptionId: "sub_1" }),
  "Paddle subscriptionId → 결제 증거 있음"
);
assert(
  !hasPaymentEvidence({ tossBillingKey: "", paddleSubscriptionId: null }),
  "빈 결제 식별자 → 결제 증거 없음"
);

// ── 성공 상태전이 ─────────────────────────────────────────────────────
{
  const s = applyChargeSuccess(T0);
  eq(s.status, "active", "성공 → active");
  eq(s.billingFailedCount, 0, "성공 → 실패카운트 리셋");
  eq(s.nextRetryAtMs, null, "성공 → 재시도 해제");
  eq(s.currentPeriodStart.getTime(), T0, "성공 → 주기 시작 now");
  assert(s.currentPeriodEnd.getTime() > T0, "성공 → 주기 종료 미래");
}

// ── 실패 상태전이(유예 → 해지) ────────────────────────────────────────
{
  const f1 = applyChargeFailure({ billingFailedCount: 0 }, T0);
  eq(f1.status, "past_due", "1회 실패 → past_due");
  eq(f1.billingFailedCount, 1, "1회 실패 카운트");
  eq(f1.nextRetryAtMs, T0 + RETRY_INTERVAL_DAYS * DAY_MS, "재시도 예약");

  const f2 = applyChargeFailure({ billingFailedCount: 1 }, T0);
  eq(f2.status, "past_due", "2회 실패 → past_due");
  eq(f2.billingFailedCount, 2, "2회 실패 카운트");

  const f3 = applyChargeFailure({ billingFailedCount: 2 }, T0);
  eq(f3.status, "canceled", `${MAX_BILLING_RETRIES}회 실패 → 해지`);
  eq(f3.planType, "free", "해지 시 free 강등");
  eq(f3.nextRetryAtMs, null, "해지 시 재시도 없음");
}

console.log(`\nbilling.test: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
