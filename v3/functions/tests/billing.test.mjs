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
  ANNUAL_MONTH_MULTIPLIER,
  normalizeBillingCycle,
  planAmountKRW,
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
    `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`,
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-07-10T00:00:00Z");

// ── 멱등키 ────────────────────────────────────────────────────────────
// 같은 (uid, 사이클앵커) → 같은 문서 ID(중복청구 방지의 핵심).
eq(billingChargeDocId("u1", 12345), "u1_12345", "docId deterministic");
assert(
  billingChargeDocId("u1", 111) !== billingChargeDocId("u1", 222),
  "다른 사이클 앵커는 다른 docId",
);
assert(
  billingChargeDocId("u1", 111) !== billingChargeDocId("u2", 111),
  "다른 유저는 다른 docId",
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
    "free_trial → 0원",
  );
  eq(
    applyCouponDiscount(base, { type: "plan_upgrade" }).finalAmount,
    0,
    "plan_upgrade → 0원",
  );
  eq(
    applyCouponDiscount(base, { type: "bogus" }).finalAmount,
    base,
    "미지원 타입 → 정가",
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
  "아직 만료 전 → 비대상",
);
assert(
  !selectDueForCharge({ ...baseSub, founderGrant: true }, T0),
  "파운더 grant → 절대 비대상",
);
assert(
  !selectDueForCharge({ ...baseSub, paymentProvider: "paddle" }, T0),
  "paddle 등 비지원 PG → 비대상",
);
assert(
  !selectDueForCharge({ ...baseSub, tossBillingKey: null }, T0),
  "빌링키 없음 → 비대상",
);
// PortOne 갱신 크론 대상: paymentProvider + portoneBillingKey 만으로 due 판정.
const basePortOne = {
  paymentProvider: "portone",
  status: "active",
  planType: "pro",
  portoneBillingKey: "bk_portone_1",
  currentPeriodEndMs: T0 - DAY_MS,
};
assert(selectDueForCharge(basePortOne, T0), "포트원 만료 도래 active → 청구 대상");
assert(
  !selectDueForCharge({ ...basePortOne, portoneBillingKey: null }, T0),
  "포트원 빌링키 없음 → 비대상",
);
assert(
  !selectDueForCharge({ ...basePortOne, currentPeriodEndMs: T0 + DAY_MS }, T0),
  "포트원 아직 만료 전 → 비대상",
);
assert(
  !selectDueForCharge({ ...baseSub, status: "canceled" }, T0),
  "canceled → 비대상",
);
assert(
  selectDueForCharge({ ...baseSub, status: "past_due" }, T0),
  "past_due + 도래 + 재시도시각 없음 → 대상",
);
assert(
  !selectDueForCharge(
    { ...baseSub, status: "past_due", nextRetryAtMs: T0 + DAY_MS },
    T0,
  ),
  "past_due + 재시도 백오프 중 → 비대상",
);
assert(
  selectDueForCharge(
    { ...baseSub, status: "past_due", nextRetryAtMs: T0 - 1 },
    T0,
  ),
  "past_due + 재시도 시각 지남 → 대상",
);

// ── 결제 증거 판정 ────────────────────────────────────────────────────
assert(
  hasPaymentEvidence({ tossBillingKey: "bk_1" }),
  "Toss billingKey → 결제 증거 있음",
);
assert(
  hasPaymentEvidence({ paddleSubscriptionId: "sub_1" }),
  "Paddle subscriptionId → 결제 증거 있음",
);
assert(
  !hasPaymentEvidence({ tossBillingKey: "", paddleSubscriptionId: null }),
  "빈 결제 식별자 → 결제 증거 없음",
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

// ── 결제 주기: 금액 ───────────────────────────────────────────────────
// ★이 블록이 못박는 것: "표시가 == 실청구액". 원버그는 연간을 고르면
// ₩190,000 을 표시하고 ₩19,000 을 청구한 것이었다.
{
  eq(normalizeBillingCycle("annual"), "annual", "annual → annual");
  eq(normalizeBillingCycle("yearly"), "annual", "yearly(타입 표기) → annual");
  eq(normalizeBillingCycle("monthly"), "monthly", "monthly → monthly");
  eq(normalizeBillingCycle(undefined), "monthly", "미지정(레거시) → monthly");
  eq(normalizeBillingCycle(null), "monthly", "null → monthly");
  eq(
    normalizeBillingCycle("ANNUAL"),
    "monthly",
    "예상 밖 값 → 월간 폴백(안전)",
  );
  eq(normalizeBillingCycle("garbage"), "monthly", "쓰레기 값 → 월간 폴백");

  eq(planAmountKRW("pro", "monthly"), 19000, "pro 월간 = 19,000");
  eq(planAmountKRW("pro", "annual"), 190000, "pro 연간 = 190,000 (월×10)");
  eq(planAmountKRW("team", "monthly"), 29000, "team 월간 = 29,000");
  eq(planAmountKRW("team", "annual"), 290000, "team 연간 = 290,000");
  eq(
    planAmountKRW("team_plus", "annual"),
    2900000,
    "team_plus 연간 = 2,900,000",
  );
  eq(planAmountKRW("free", "annual"), undefined, "무료 플랜은 청구 불가");
  eq(
    planAmountKRW("nope", "monthly"),
    undefined,
    "알 수 없는 플랜은 청구 불가",
  );

  // 연간은 2개월 무료 — 월정가 12개월치보다 정확히 2개월 싸야 한다.
  eq(
    planAmountKRW("pro", "annual"),
    planAmountKRW("pro", "monthly") * ANNUAL_MONTH_MULTIPLIER,
    "연간 = 월정가 × 10",
  );
  assert(
    planAmountKRW("pro", "annual") < planAmountKRW("pro", "monthly") * 12,
    "연간이 월간 12개월치보다 싸다(2개월 무료)",
  );

  // ★표시가 == 실청구액. marblo-web 이 화면에 쓰는 공식(월 × 10)을 여기서
  // 독립적으로 재현해, 한쪽만 바뀌면 red 가 되게 한다.
  for (const plan of ["pro", "team", "team_plus"]) {
    const displayedAnnual = PLAN_PRICES_KRW[plan] * 10; // marblo-web 공식
    eq(
      planAmountKRW(plan, "annual"),
      displayedAnnual,
      `${plan}: 화면 표시 연간가와 서버 청구액 일치`,
    );
  }
}

// ── 결제 주기: 기간 ───────────────────────────────────────────────────
{
  const jan1 = new Date(Date.parse("2026-01-01T00:00:00Z"));
  const m = nextPeriodEnd(jan1, "monthly");
  eq(m.getUTCMonth(), 1, "월간: 1/1 → 2월");
  const y = nextPeriodEnd(jan1, "annual");
  eq(y.getUTCFullYear(), 2027, "연간: 2026/1/1 → 2027년");
  eq(y.getUTCMonth(), 0, "연간: 같은 달(1월)");
  eq(y.getUTCDate(), 1, "연간: 같은 날(1일)");

  // 기본값(인자 생략)은 월간 — 기존 호출부 무회귀.
  eq(
    nextPeriodEnd(jan1).getTime(),
    nextPeriodEnd(jan1, "monthly").getTime(),
    "cycle 생략 = 월간(레거시 호환)",
  );

  // ★서비스 제공기간 1년 초과 금지(토스 가이드). 연간 기간은 어떤 시작일에도
  // 366일을 넘지 않아야 한다 — 윤년을 포함한 1년이 366일이다.
  const DAY = 24 * 60 * 60 * 1000;
  for (const start of [
    "2026-01-01T00:00:00Z", // 평년 시작
    "2027-03-01T00:00:00Z", // 윤년(2028/2) 을 품는 구간
    "2028-02-29T00:00:00Z", // 윤일 결제
    "2026-01-31T00:00:00Z", // 월말
    "2026-12-31T00:00:00Z", // 연말
  ]) {
    const s = new Date(Date.parse(start));
    const days = (nextPeriodEnd(s, "annual").getTime() - s.getTime()) / DAY;
    assert(days <= 366, `연간 제공기간 ≤366일 (start=${start}, got ${days}일)`);
    assert(days >= 365, `연간 제공기간 ≥365일 (start=${start}, got ${days}일)`);
  }

  // 윤일(2/29) 결제 → 평년에는 3/1. 2/28 로 당기면 하루를 뺏는 것이라 안 된다.
  const leap = nextPeriodEnd(
    new Date(Date.parse("2028-02-29T00:00:00Z")),
    "annual",
  );
  eq(leap.getUTCFullYear(), 2029, "윤일 연간: 2029년");
  eq(leap.getUTCMonth(), 2, "윤일 연간: 평년엔 3월로 밀림");
  eq(leap.getUTCDate(), 1, "윤일 연간: 3/1");

  // 월말(1/31) 월간 결제 → 2월엔 31일이 없어 3월로 넘어간다(기존 동작).
  const eom = nextPeriodEnd(
    new Date(Date.parse("2026-01-31T00:00:00Z")),
    "monthly",
  );
  eq(eom.getUTCMonth(), 2, "1/31 월간 → 3월(2월에 31일 없음)");
  assert(
    eom.getTime() > Date.parse("2026-02-28T00:00:00Z"),
    "1/31 월간: 항상 앞으로 간다(사용자 불리 없음)",
  );
}

// ── 결제 주기: 갱신 시 주기 유지 ──────────────────────────────────────
// ★연간 구독자가 갱신 한 번에 월간으로 바뀌면 다음 해엔 ₩19,000 만 받고
// 1년을 주게 된다. 주기는 갱신을 건너도 반드시 살아남아야 한다.
{
  const a = applyChargeSuccess(T0, "annual");
  eq(a.billingCycle, "annual", "연간 갱신 → 주기 유지(annual)");
  eq(a.status, "active", "연간 갱신 → active");
  eq(a.currentPeriodStart.getTime(), T0, "연간 갱신 → 시작 now");
  eq(
    a.currentPeriodEnd.getTime(),
    nextPeriodEnd(new Date(T0), "annual").getTime(),
    "연간 갱신 → 종료 +12개월",
  );

  const m = applyChargeSuccess(T0, "monthly");
  eq(m.billingCycle, "monthly", "월간 갱신 → 주기 유지(monthly)");
  eq(
    m.currentPeriodEnd.getTime(),
    nextPeriodEnd(new Date(T0), "monthly").getTime(),
    "월간 갱신 → 종료 +1개월",
  );

  // 기본값 생략 = 월간(레거시 문서 무회귀).
  eq(applyChargeSuccess(T0).billingCycle, "monthly", "cycle 생략 → 월간");

  // 연간 주기를 3회 갱신해도 계속 연간 — 주기가 닳지 않는다.
  let cycle = "annual";
  let t = T0;
  for (let i = 1; i <= 3; i++) {
    const s = applyChargeSuccess(t, cycle);
    eq(s.billingCycle, "annual", `${i}회차 갱신 후에도 연간 유지`);
    eq(
      planAmountKRW("pro", s.billingCycle),
      190000,
      `${i}회차 갱신 청구액 = 연간가`,
    );
    cycle = s.billingCycle;
    t = s.currentPeriodEnd.getTime();
  }
}

// ── 결제 주기: 쿠폰은 연간가에 적용된다 ───────────────────────────────
// checkout 페이지가 화면에서 baseAmount(=연간가)에 할인을 먹이므로, 서버도
// 연간가 기준이어야 표시와 청구가 같다. "월정가에 할인 후 ×12" 가 아니다.
{
  const annual = planAmountKRW("pro", "annual"); // 190,000
  const c20 = applyCouponDiscount(annual, {
    type: "discount",
    discountPercent: 20,
  });
  eq(c20.discountAmount, 38000, "연간가 20% 할인 = 38,000");
  eq(c20.finalAmount, 152000, "연간 20% 쿠폰 후 청구액 = 152,000");

  // 월정가에 먼저 할인하고 12를 곱하는 잘못된 계산과 다름을 명시적으로 못박는다.
  const wrong =
    applyCouponDiscount(PLAN_PRICES_KRW.pro, {
      type: "discount",
      discountPercent: 20,
    }).finalAmount * 12;
  assert(c20.finalAmount !== wrong, "연간 쿠폰은 '월정가 할인 × 12' 가 아니다");

  // 첫 결제 면제형 쿠폰은 연간에도 전액 면제(첫 청구 한정).
  const trial = applyCouponDiscount(annual, { type: "free_trial" });
  eq(trial.finalAmount, 0, "free_trial 은 연간 첫 청구도 0원");
  eq(trial.discountAmount, annual, "free_trial 할인액 = 연간 정가");
}

// ── 결제 주기: 대상 선정은 주기에 좌우되지 않는다 ─────────────────────
// 만료 경계가 이미 주기를 반영하므로, selectDueForCharge 가 주기를 다시 보면
// 이중 반영이 된다. 연간/월간이 같은 경계에서 같은 판정을 내는지 확인.
{
  const mk = (cycle, endMs) => ({
    ...baseSub,
    billingCycle: cycle,
    currentPeriodEndMs: endMs,
  });
  eq(
    selectDueForCharge(mk("annual", T0 - DAY_MS), T0),
    selectDueForCharge(mk("monthly", T0 - DAY_MS), T0),
    "만료 후: 주기와 무관하게 동일 판정(청구 대상)",
  );
  assert(selectDueForCharge(mk("annual", T0 - DAY_MS), T0), "연간 만료 → 청구");
  assert(
    !selectDueForCharge(mk("annual", T0 + 300 * DAY_MS), T0),
    "연간 기간 중(300일 남음) → 청구 안 함",
  );
  assert(
    !selectDueForCharge(
      { ...mk("annual", T0 - DAY_MS), founderGrant: true },
      T0,
    ),
    "연간이어도 파운더 grant 는 청구 안 함",
  );
}

console.log(`\nbilling.test: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
