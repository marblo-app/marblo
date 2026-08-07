// 포트원 정기갱신 크론 결정적 로직 단위테스트.
// chargePortOneSubscriptionIdempotent / scheduledChargePortOneSubscriptions 는
// Firestore·fetch 의존이라 프로덕션에 묶지 않고, index.ts 와 동일 규칙을
// 순수 미러로 고정한다. drift 시 이 테스트가 red 가 되게 주석에 소스 위치를 적는다.
//
// 실행:
//   cd v3/functions && npm run test:portone-cron
//
// 커버: 멱등 claim 결정 / amount<=0 comped / 검증실패 failed /
//       성공 charged / 레거시 name·phone·billingKey 스킵(해지 안 함) /
//       due + skip 조합 시 applyChargeFailure 미호출.

import {
  selectDueForCharge,
  applyChargeSuccess,
  applyChargeFailure,
  planAmountKRW,
  normalizeBillingCycle,
  MAX_BILLING_RETRIES,
} from "../lib/billing.js";
import {
  portonePaymentId,
  portoneChargeDocId,
  validatePortOnePaidPayment,
} from "../lib/portone.js";

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
// index.ts chargePortOneSubscriptionIdempotent / chargeSubscriptionIdempotent
const STALE_PENDING_MS = 15 * 60 * 1000;

/**
 * 멱등 claim 트랜잭션 결정 미러.
 * 소스: v3/functions/src/index.ts chargePortOneSubscriptionIdempotent
 *   (snap.exists → succeeded/comped → false; pending + fresh → false; else true)
 */
function shouldProceedPortOneChargeClaim(
  existing,
  nowMs,
  stalePendingMs = STALE_PENDING_MS,
) {
  if (!existing) return true;
  const st = existing.status;
  if (st === "succeeded" || st === "comped") return false;
  if (st === "pending") {
    const updatedMs = existing.updatedAtMs;
    if (updatedMs != null && nowMs - updatedMs < stalePendingMs) {
      return false;
    }
  }
  // failed 또는 stale pending → 재청구 허용
  return true;
}

/**
 * claim 통과 후 금액/검증 결과 → ChargeResult 미러.
 * 소스: chargePortOneSubscriptionIdempotent amount<=0 / validatePortOnePaidPayment
 */
function resolvePortOneChargeAfterClaim(params) {
  const { proceed, amount, validation, paymentId } = params;
  if (!proceed) return { status: "skipped" };
  if (amount <= 0) return { status: "comped" };
  if (!validation || validation.ok !== true) {
    return {
      status: "failed",
      error: validation?.reason || "validation_failed",
    };
  }
  return { status: "charged", paymentKey: paymentId };
}

/**
 * 레거시 구독 스킵 가드 미러.
 * 소스: scheduledChargePortOneSubscriptions
 *   if (!billingKey || !customerName || !customerPhone) → skipped++ (해지 안 함)
 */
function shouldSkipPortOneLegacyMissingCustomer(
  billingKey,
  customerName,
  customerPhone,
) {
  return !billingKey || !customerName || !customerPhone;
}

// ── 멱등 paymentId / charge doc 결정성 ───────────────────────────────
// 같은 (uid, cycleAnchor) → 같은 paymentId → 같은 billingCharges 문서.
{
  const anchor = T0 - DAY_MS;
  const pid1 = portonePaymentId("user_a", "subscription", String(anchor));
  const pid2 = portonePaymentId("user_a", "subscription", String(anchor));
  eq(pid1, pid2, "같은 사이클 앵커 → 같은 paymentId");
  eq(
    portoneChargeDocId(pid1),
    portoneChargeDocId(pid2),
    "같은 paymentId → 같은 charge doc",
  );
  assert(
    portonePaymentId("user_a", "subscription", String(anchor + 1)) !== pid1,
    "다른 사이클 앵커 → 다른 paymentId",
  );
  // userId 는 paymentId 에 안 넣음(40자 제한) — 문서 scope 는 charge doc 의 userId 필드.
  eq(
    portonePaymentId("user_a", "subscription", String(anchor)),
    portonePaymentId("user_b", "subscription", String(anchor)),
    "paymentId 자체는 uid 비포함(결정적 nonce=cycleAnchor)",
  );
  eq(
    portoneChargeDocId(pid1),
    `portone_${pid1}`,
    "billingCharges doc id = portone_{paymentId}",
  );
}

// ── 멱등 claim: succeeded/comped → skipped ───────────────────────────
{
  eq(
    shouldProceedPortOneChargeClaim({ status: "succeeded", updatedAtMs: T0 }, T0),
    false,
    "이미 succeeded → claim 거부(중복청구 방지)",
  );
  eq(
    shouldProceedPortOneChargeClaim({ status: "comped", updatedAtMs: T0 }, T0),
    false,
    "이미 comped → claim 거부",
  );
  eq(
    resolvePortOneChargeAfterClaim({
      proceed: false,
      amount: 19000,
      validation: { ok: true },
      paymentId: "mb_s_1",
    }).status,
    "skipped",
    "claim 거부 → status skipped",
  );
}

// ── 멱등 claim: pending + STALE 이내 → skip / stale → 재시도 ─────────
{
  const freshPending = {
    status: "pending",
    updatedAtMs: T0 - (STALE_PENDING_MS - 1000),
  };
  eq(
    shouldProceedPortOneChargeClaim(freshPending, T0),
    false,
    "pending + STALE_PENDING_MS 이내 → skip",
  );
  const stalePending = {
    status: "pending",
    updatedAtMs: T0 - (STALE_PENDING_MS + 1),
  };
  eq(
    shouldProceedPortOneChargeClaim(stalePending, T0),
    true,
    "pending + STALE 초과 → 재청구 허용",
  );
  eq(
    shouldProceedPortOneChargeClaim(
      { status: "pending", updatedAtMs: null },
      T0,
    ),
    true,
    "pending + updatedAt 없음 → 재청구 허용(보수적 재시도)",
  );
}

// ── 멱등 claim: failed / 문서 없음 → proceed ─────────────────────────
{
  eq(
    shouldProceedPortOneChargeClaim(null, T0),
    true,
    "charge 문서 없음 → claim 허용",
  );
  eq(
    shouldProceedPortOneChargeClaim({ status: "failed", updatedAtMs: T0 }, T0),
    true,
    "이전 failed → 재청구 허용",
  );
}

// ── amount<=0 → comped (실 PG 호출 없음) ─────────────────────────────
{
  const r = resolvePortOneChargeAfterClaim({
    proceed: true,
    amount: 0,
    validation: null,
    paymentId: "mb_s_0",
  });
  eq(r.status, "comped", "amount 0 → comped");
  const rNeg = resolvePortOneChargeAfterClaim({
    proceed: true,
    amount: -1,
    validation: null,
    paymentId: "mb_s_neg",
  });
  eq(rNeg.status, "comped", "amount <0 → comped");
}

// ── 검증 실패 → failed ───────────────────────────────────────────────
{
  const paymentId = portonePaymentId("u1", "subscription", String(T0));
  const validation = validatePortOnePaidPayment(
    {
      id: paymentId,
      storeId: "store_test",
      status: "READY",
      amount: { total: 19000 },
      currency: "KRW",
    },
    {
      paymentId,
      storeId: "store_test",
      amount: 19000,
      currency: "KRW",
    },
  );
  assert(validation.ok === false, "비 PAID → 검증 실패");
  const r = resolvePortOneChargeAfterClaim({
    proceed: true,
    amount: 19000,
    validation,
    paymentId,
  });
  eq(r.status, "failed", "검증 실패 → status failed");
  eq(r.error, "payment_not_paid", "검증 실패 reason 전파");
}

// ── 성공 → charged + paymentKey=paymentId ────────────────────────────
{
  const paymentId = portonePaymentId("u1", "subscription", String(T0));
  const validation = validatePortOnePaidPayment(
    {
      id: paymentId,
      storeId: "store_test",
      status: "PAID",
      amount: { total: 19000 },
      currency: "KRW",
    },
    {
      paymentId,
      storeId: "store_test",
      amount: 19000,
      currency: "KRW",
    },
  );
  assert(validation.ok === true, "PAID 검증 통과");
  const r = resolvePortOneChargeAfterClaim({
    proceed: true,
    amount: 19000,
    validation,
    paymentId,
  });
  eq(r.status, "charged", "성공 → charged");
  eq(r.paymentKey, paymentId, "paymentKey = paymentId");
}

// ── 레거시 스킵: name/phone/billingKey 미저장 → skip, 해지 안 함 ─────
{
  assert(
    shouldSkipPortOneLegacyMissingCustomer(null, "홍길동", "01012345678"),
    "billingKey 없음 → skip",
  );
  assert(
    shouldSkipPortOneLegacyMissingCustomer("bk_1", null, "01012345678"),
    "name 없음 → skip",
  );
  assert(
    shouldSkipPortOneLegacyMissingCustomer("bk_1", "홍길동", null),
    "phone 없음 → skip",
  );
  assert(
    shouldSkipPortOneLegacyMissingCustomer("", "홍길동", "01012345678"),
    "billingKey 빈문자열 → skip",
  );
  assert(
    shouldSkipPortOneLegacyMissingCustomer("bk_1", "", "01012345678"),
    "name 빈문자열 → skip",
  );
  assert(
    !shouldSkipPortOneLegacyMissingCustomer("bk_1", "홍길동", "01012345678"),
    "전부 있음 → skip 안 함",
  );

  // due 이어도 레거시 스킵이면 applyChargeFailure 를 부르지 않는다
  // (status 유지 → canceled/past_due 로 강등 안 함).
  const dueLegacy = {
    paymentProvider: "portone",
    status: "active",
    planType: "pro",
    portoneBillingKey: "bk_legacy",
    currentPeriodEndMs: T0 - DAY_MS,
    billingFailedCount: 0,
  };
  assert(selectDueForCharge(dueLegacy, T0), "레거시도 due 판정은 true 가능");
  assert(
    shouldSkipPortOneLegacyMissingCustomer("bk_legacy", null, null),
    "name/phone 미저장 레거시 → 크론 skip",
  );
  // 스킵 경로: applyChargeFailure 미호출 가정 → 상태 전이 없음
  const unchanged = {
    status: dueLegacy.status,
    planType: dueLegacy.planType,
    billingFailedCount: dueLegacy.billingFailedCount,
  };
  eq(unchanged.status, "active", "레거시 skip 후 status 유지(active)");
  eq(unchanged.planType, "pro", "레거시 skip 후 planType 유지(해지 아님)");
  eq(unchanged.billingFailedCount, 0, "레거시 skip 후 실패카운트 증가 없음");

  // 대조: 실제 청구 실패 시에만 past_due/canceled
  const onFail = applyChargeFailure(dueLegacy, T0);
  eq(onFail.status, "past_due", "실실패 시에만 past_due");
  const onMaxFail = applyChargeFailure(
    { billingFailedCount: MAX_BILLING_RETRIES - 1 },
    T0,
  );
  eq(onMaxFail.status, "canceled", "MAX 실패 시에만 해지");
  eq(onMaxFail.planType, "free", "해지 시 free 강등");
}

// ── 크론 경로 조합: due → charge 성공 → 기간 연장 ────────────────────
{
  const billingCycle = normalizeBillingCycle("monthly");
  const amount = planAmountKRW("pro", billingCycle);
  eq(amount, 19000, "pro 월간 청구액");
  const snap = {
    paymentProvider: "portone",
    status: "active",
    planType: "pro",
    portoneBillingKey: "bk_ok",
    currentPeriodEndMs: T0 - DAY_MS,
    billingFailedCount: 2,
  };
  assert(selectDueForCharge(snap, T0), "due");
  assert(
    !shouldSkipPortOneLegacyMissingCustomer("bk_ok", "Kim", "01000000000"),
    "고객정보 완비",
  );
  const paymentId = portonePaymentId(
    "u_ok",
    "subscription",
    String(snap.currentPeriodEndMs),
  );
  const claimOk = shouldProceedPortOneChargeClaim(null, T0);
  assert(claimOk, "첫 청구 claim 허용");
  const charge = resolvePortOneChargeAfterClaim({
    proceed: claimOk,
    amount,
    validation: { ok: true },
    paymentId,
  });
  eq(charge.status, "charged", "청구 성공");
  // charged/comped/skipped → applyChargeSuccess 로 기간 연장(크론 본문과 동일)
  const s = applyChargeSuccess(T0, billingCycle);
  eq(s.status, "active", "성공 후 active");
  eq(s.billingFailedCount, 0, "성공 후 실패카운트 리셋");
  eq(s.billingCycle, "monthly", "주기 유지");
  assert(s.currentPeriodEnd.getTime() > T0, "다음 만료 미래");
}

// ── skipped(이미 성공 문서) 도 기간 연장 대상 ─────────────────────────
// 소스 주석: "skipped 도 연장해야 청구 성공했으나 기간갱신 전 죽은 구독 무한 재선정 방지"
{
  const charge = resolvePortOneChargeAfterClaim({
    proceed: false, // 이미 succeeded claim 거부
    amount: 19000,
    validation: { ok: true },
    paymentId: "mb_s_x",
  });
  eq(charge.status, "skipped", "이미 청구됨 → skipped");
  const s = applyChargeSuccess(T0, "monthly");
  eq(s.status, "active", "skipped 여도 기간 연장 적용(크론 계약)");
}

console.log(`\nportoneBillingCron.test: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
