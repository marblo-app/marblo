/**
 * 정기결제(Toss 빌링키) 순수 로직.
 *
 * webhookVerify.ts / reconciliation.ts 와 동일한 방침: Firestore·fetch 등
 * 부작용을 전혀 갖지 않는 순수 함수만 모아, 돈 직결 로직(멱등키 생성·쿠폰
 * 할인·갱신 대상 선정·성공/실패 상태전이)을 실 PG 호출 없이 단위테스트한다.
 * index.ts 의 청구 헬퍼/크론은 이 함수들을 조합해서 쓴다.
 */

// ─── 플랜 가격(단일소스) ──────────────────────────────────────────────
// index.ts 가 여기서 import 한다 — 가격이 두 곳에 흩어지지 않게 단일화.
// ★여기 있는 건 **월정가**다. 연간 청구액은 planAmountKRW() 로만 구한다 —
// PLAN_PRICES_KRW[plan] 을 그대로 청구하면 연간 구독자에게 한 달치를 받는다
// (이 파일이 고친 원버그가 정확히 그것이었다).
export const PLAN_PRICES_KRW: Record<string, number> = {
  pro: 19000,
  team: 29000,
  team_plus: 290000, // per-team floor (5 seats incl.)
};

// ─── 결제 주기 ────────────────────────────────────────────────────────
// 와이어 정본은 "annual" 이다 — PricingSection 이 `&billing=annual` 로 링크하고
// checkout 페이지가 successUrl 에 그대로 실어 보낸다. src/types/payment.ts 의
// BillingCycle 은 "yearly" 를 쓰므로 둘 다 받아 정규화한다(미지정=monthly).
export type BillingCycle = "monthly" | "annual";

// 연간 = 월 × 10 (2개월 무료). marblo-web PricingSection.tsx / checkout
// page.tsx / src/types/payment.ts PAYMENT_PLANS 의 동일 공식과 일치해야 한다.
export const ANNUAL_MONTH_MULTIPLIER = 10;

export function normalizeBillingCycle(raw: unknown): BillingCycle {
  return raw === "annual" || raw === "yearly" ? "annual" : "monthly";
}

/**
 * 이 (플랜, 주기) 조합의 실청구액. 알 수 없는 플랜이면 undefined.
 *
 * ★표시가와 실청구액의 단일 진실. 체크아웃 화면·issueBillingKey·수동청구·
 * 갱신 크론이 전부 이 함수만 쓴다 — 한 곳이라도 PLAN_PRICES_KRW 를 직접
 * 읽으면 표시/청구 불일치가 다시 생긴다.
 */
export function planAmountKRW(
  planType: string,
  cycle: BillingCycle,
): number | undefined {
  const monthly = PLAN_PRICES_KRW[planType];
  if (!monthly) return undefined;
  return cycle === "annual" ? monthly * ANNUAL_MONTH_MULTIPLIER : monthly;
}

// ─── 재시도/유예 정책 상수 ────────────────────────────────────────────
// 청구 실패 시 past_due 로 두고 RETRY_INTERVAL_DAYS 간격으로 재시도하되,
// 누적 실패가 MAX_BILLING_RETRIES 에 도달하면 구독을 해지(free 강등)한다.
export const MAX_BILLING_RETRIES = 3;
export const RETRY_INTERVAL_DAYS = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

// ─── 쿠폰 할인 계산 ───────────────────────────────────────────────────
// applyCoupon(index.ts) 의 switch 와 동일 규칙을 순수화. 첫 청구 금액에만
// 적용된다(정기 갱신은 정가). discount 타입은 percent, free_trial/plan_upgrade
// 는 첫 결제 면제(finalAmount 0).
export interface CouponLike {
  type?: string;
  discountPercent?: number;
}

export function applyCouponDiscount(
  baseAmount: number,
  coupon: CouponLike | null | undefined,
): { finalAmount: number; discountAmount: number } {
  if (!coupon) return { finalAmount: baseAmount, discountAmount: 0 };
  switch (coupon.type) {
    case "discount": {
      const discountAmount = Math.round(
        (baseAmount * (coupon.discountPercent || 0)) / 100,
      );
      return {
        finalAmount: Math.max(0, baseAmount - discountAmount),
        discountAmount,
      };
    }
    case "free_trial":
    case "plan_upgrade":
      return { finalAmount: 0, discountAmount: baseAmount };
    default:
      return { finalAmount: baseAmount, discountAmount: 0 };
  }
}

// ─── 첫 청구 영수증(표시용 정본) ──────────────────────────────────────
// ★화면이 말한 금액과 카드사가 긁은 금액이 달라지던 버그의 수리점.
// resolveFirstChargeAmount 는 쿠폰이 만료/소진/중복이면 throw 하지 않고 정가로
// 폴백한다(쿠폰 문제로 결제가 깨지면 안 되니까 — 이 보호로직은 유지한다).
// 그런데 화면은 할인 총액을, 완료 페이지는 클라이언트가 계산한 금액을 그리고
// 있었다. 그래서 "₩0 무료" 를 보고 결제한 사용자에게 정가가 청구될 수 있었다.
//
// 이 함수가 "서버가 실제로 얼마를, 어떤 쿠폰으로 청구했나" 의 단일 진실이다.
// 응답과 구독 문서 양쪽에 같은 값을 싣고, 완료 페이지는 클라 금액이 아니라
// 이 값을 표시한다. couponRejected 가 true 면 "쿠폰 미적용, 정가 청구" 고지를
// 띄운다 — 사용자가 쿠폰을 넣었는데 서버가 못 쓴 경우다.
export interface FirstChargeReceipt {
  /** 실제 청구된 정수 KRW. comped(면제)면 0. */
  chargedAmount: number;
  /** 서버가 실제 적용한 쿠폰 코드. 미적용이면 false. */
  couponApplied: string | false;
  /** 사용자가 쿠폰을 넣었으나 서버가 정가로 폴백했는가. */
  couponRejected: boolean;
}

export function firstChargeReceipt(input: {
  /** 청구 결과. comped = 금액 0(무료 쿠폰 등)이라 PG 청구를 건너뛴 상태. */
  status: "charged" | "comped";
  /** 청구 시도 금액(쿠폰 적용 후). */
  amount: number;
  /** 서버가 실제 적용한 쿠폰 코드(없으면 null). */
  appliedCouponCode?: string | null;
  /** 사용자가 요청한 쿠폰 코드(없으면 null). */
  requestedCouponCode?: string | null;
}): FirstChargeReceipt {
  const applied =
    typeof input.appliedCouponCode === "string" &&
    input.appliedCouponCode.length > 0
      ? input.appliedCouponCode
      : null;
  const requested =
    typeof input.requestedCouponCode === "string" &&
    input.requestedCouponCode.trim().length > 0
      ? input.requestedCouponCode.trim()
      : null;
  const chargedAmount =
    input.status === "comped" || !Number.isFinite(input.amount)
      ? 0
      : Math.max(0, Math.round(input.amount));
  return {
    chargedAmount,
    couponApplied: applied ?? false,
    couponRejected: requested !== null && applied === null,
  };
}

// ─── 기간 계산 ────────────────────────────────────────────────────────
// 한 결제 주기 = 월간 1개월 / 연간 12개월. setMonth 로 월경계를 넘긴다.
//
// ★서비스 제공기간 상한: 토스 가이드는 제공기간이 1년을 초과하면 결제 서비스
// 이용이 불가라고 명시한다. 연간을 12개월(=365/366일)로 두는 이유가 그것이다 —
// "13개월" 이나 "365일+α" 로 파는 상품을 만들면 안 된다.
//
// ★윤년/월말 주의: setMonth 는 존재하지 않는 날짜를 다음 달로 넘긴다.
// 1/31 + 1개월 = 3/2 또는 3/3(2월 길이에 따라). 이건 기존 월간 동작 그대로이며
// 사용자에게 불리하지 않다(항상 앞으로 간다). 연간은 setMonth(+12) 를 쓰므로
// 2/29 + 12개월 = 3/1 이 된다 — 윤일 결제자가 하루 손해보지 않도록 평년의
// 2/29 는 3/1 로 밀리는 게 맞다(2/28 로 당기면 하루를 뺏는 것).
export function nextPeriodEnd(
  from: Date,
  cycle: BillingCycle = "monthly",
): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + (cycle === "annual" ? 12 : 1));
  return d;
}

// ─── 멱등키(청구 문서 ID) ─────────────────────────────────────────────
// 같은 사이클을 두 번 청구하지 않도록, (userId, 사이클 기준시각) 을 결정적으로
// 문서 ID 화한다. 갱신은 직전 currentPeriodEnd 를 앵커로 쓴다 — 크론이 중복
// 실행돼도 같은 사이클이면 같은 ID → claim 이 막는다.
// ★첫 청구는 Date.now() 를 쓰면 안 된다(동시 호출=다른 키=이중청구). 아래
// firstCharge* 헬퍼를 쓴다.
export function billingChargeDocId(
  userId: string,
  cycleAnchorMs: number,
): string {
  return `${userId}_${cycleAnchorMs}`;
}

// Toss 에 넘길 결정적 orderId — PG 측 멱등을 한 겹 더 보강.
export function billingOrderId(userId: string, cycleAnchorMs: number): string {
  return `sub_${userId}_${cycleAnchorMs}`;
}

// ─── 첫 청구 결정적 멱등 키 ───────────────────────────────────────────
// provider+user+plan+cycle(+generation). generation 은 이전 첫청구가
// succeeded 인데 구독이 해지된 뒤 재구독할 때만 올린다(동시 재시도는 gen 공유).
export type FirstChargeProvider = "toss" | "portone";

export function firstChargeLedgerId(
  provider: FirstChargeProvider,
  userId: string,
  planType: string,
  cycle: BillingCycle,
  generation = 0,
): string {
  const safePlan = String(planType || "pro").replace(/[^A-Za-z0-9_-]/g, "_");
  const base = `first_${provider}_${userId}_${safePlan}_${cycle}`;
  return generation > 0 ? `${base}_g${generation}` : base;
}

/** Toss orderId (≤64자 관례). 결정적 — 같은 gen 재시도 = 같은 orderId. */
export function firstChargeOrderId(
  userId: string,
  planType: string,
  cycle: BillingCycle,
  generation = 0,
): string {
  const safePlan = String(planType || "pro").replace(/[^A-Za-z0-9_-]/g, "_");
  const base = `sub_first_${userId}_${safePlan}_${cycle}`;
  const id = generation > 0 ? `${base}_g${generation}` : base;
  return id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
}

/**
 * PortOne paymentId 용 짧은 nonce (portonePaymentId 가 mb_s_ 접두 후 40자 캡).
 * 예: f_pro_m / f_team_plus_a_g1
 */
export function firstChargePortoneNonce(
  planType: string,
  cycle: BillingCycle,
  generation = 0,
): string {
  const p = String(planType || "pro")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 12);
  const c = cycle === "annual" ? "a" : "m";
  const base = `f_${p}_${c}`;
  return generation > 0 ? `${base}_g${generation}` : base;
}

/**
 * 기존 gen 0..N-1 의 charge status 배열을 보고 재사용할 gen 을 고른다.
 * succeeded/comped → 다음 gen (재구독). missing/failed/pending → 그 gen 재사용.
 */
export function resolveFirstChargeGeneration(
  existingStatuses: ReadonlyArray<
    "succeeded" | "comped" | "pending" | "failed" | "missing"
  >,
): number {
  for (let i = 0; i < existingStatuses.length; i++) {
    const s = existingStatuses[i];
    if (s === "succeeded" || s === "comped") continue;
    return i;
  }
  return existingStatuses.length;
}

/**
 * 활성 구독 재결제 가드. status ∈ (active, past_due) 이고 기간이 유효하면
 * 새 첫청구를 막는다(이중과금·키 덮어쓰기 방지).
 * - active: periodEnd 없음(레거시) → 차단, periodEnd > now → 차단
 * - past_due: 항상 차단(재시도/지원 경로, 재구매 아님)
 * - pending_first_charge / canceled / 없음 → 차단 안 함
 */
export function isAlreadySubscribed(
  sub:
    | {
        status?: string | null;
        currentPeriodEndMs?: number | null;
      }
    | null
    | undefined,
  nowMs: number,
): boolean {
  if (!sub) return false;
  const st = sub.status;
  if (st === "past_due") return true;
  if (st !== "active") return false;
  const end = sub.currentPeriodEndMs;
  if (typeof end !== "number" || !Number.isFinite(end)) return true;
  return end > nowMs;
}

// ─── 갱신 대상 선정(순수) ─────────────────────────────────────────────
// 크론이 구독 스냅샷을 이 함수에 통과시켜 "지금 청구해야 하는가"를 결정한다.
// Firestore Timestamp 는 호출부에서 ms 로 정규화해 넘긴다.
export interface SubscriptionSnapshot {
  paymentProvider?: string;
  status?: string;
  planType?: string;
  /** 구독 문서에 저장된 결제 주기. 레거시 문서(필드 부재)는 월간으로 읽는다. */
  billingCycle?: string;
  tossBillingKey?: string | null;
  tossCustomerKey?: string | null;
  /** PortOne V2 빌링키 — paymentProvider==="portone" 갱신 청구에 사용. */
  portoneBillingKey?: string | null;
  founderGrant?: boolean;
  currentPeriodEndMs?: number | null;
  billingFailedCount?: number;
  nextRetryAtMs?: number | null;
}

export interface PaymentEvidenceSnapshot {
  tossBillingKey?: unknown;
  paddleSubscriptionId?: unknown;
}

function hasNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function hasPaymentEvidence(
  sub: PaymentEvidenceSnapshot | null | undefined,
): boolean {
  if (!sub) return false;
  return (
    hasNonEmptyString(sub.tossBillingKey) ||
    hasNonEmptyString(sub.paddleSubscriptionId)
  );
}

// ★주기(billingCycle)는 "언제 청구할지"에 관여하지 않는다 — 만료 경계
// currentPeriodEnd 가 이미 주기를 반영해 계산돼 있기 때문이다(연간이면 12개월
// 뒤에 찍힌다). 주기가 관여하는 곳은 "얼마를 청구할지"(planAmountKRW)와
// "다음 경계를 언제로 둘지"(applyChargeSuccess)뿐이다. 여기서 주기를 다시
// 보면 이중 반영이 된다.
export function selectDueForCharge(
  sub: SubscriptionSnapshot,
  nowMs: number,
): boolean {
  // 무료 파운더 grant·지원 외 PG 구독은 절대 청구하지 않는다.
  if (sub.founderGrant === true) return false;
  if (sub.paymentProvider === "toss") {
    if (!sub.tossBillingKey || !sub.tossCustomerKey) return false;
  } else if (sub.paymentProvider === "portone") {
    if (!sub.portoneBillingKey) return false;
  } else {
    return false;
  }
  // active(정상 갱신) 또는 past_due(재시도)만 대상.
  if (sub.status !== "active" && sub.status !== "past_due") return false;
  if (typeof sub.currentPeriodEndMs !== "number") return false;
  // 아직 만료 전이면 청구하지 않는다.
  if (sub.currentPeriodEndMs > nowMs) return false;
  // past_due 재시도 백오프: 다음 재시도 시각 전이면 대기.
  if (
    sub.status === "past_due" &&
    typeof sub.nextRetryAtMs === "number" &&
    sub.nextRetryAtMs > nowMs
  ) {
    return false;
  }
  return true;
}

// ─── 청구 성공 후 상태(순수) ──────────────────────────────────────────
// now 앵커로 다음 주기를 부여한다(월간 now+1개월 / 연간 now+12개월). 크론
// 다운으로 여러 주기 밀렸을 때 과거로 소급해 여러 번 청구되는 catch-up 폭주를
// 피하려고 now 기준으로 둔다.
//
// ★주기 유지: billingCycle 을 그대로 되돌려 호출부가 문서에 다시 쓴다. 연간
// 구독자가 갱신 한 번에 월간으로 바뀌면 다음 해에 ₩19,000 만 받고 1년을 주게
// 된다 — 주기는 청구액과 기간 양쪽을 동시에 결정하므로 반드시 함께 흘러야 한다.
export interface ChargeSuccessState {
  status: "active";
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  billingCycle: BillingCycle;
  billingFailedCount: 0;
  nextRetryAtMs: null;
}

export function applyChargeSuccess(
  nowMs: number,
  cycle: BillingCycle = "monthly",
): ChargeSuccessState {
  const start = new Date(nowMs);
  return {
    status: "active",
    currentPeriodStart: start,
    currentPeriodEnd: nextPeriodEnd(start, cycle),
    billingCycle: cycle,
    billingFailedCount: 0,
    nextRetryAtMs: null,
  };
}

// ─── 청구 실패 후 상태(순수) ──────────────────────────────────────────
// 누적 실패 < MAX → past_due + 다음 재시도 예약. 도달 시 → 해지(free 강등).
export interface ChargeFailureState {
  status: "past_due" | "canceled";
  planType?: "free";
  billingFailedCount: number;
  nextRetryAtMs: number | null;
}

export function applyChargeFailure(
  sub: SubscriptionSnapshot,
  nowMs: number,
): ChargeFailureState {
  const count = (sub.billingFailedCount || 0) + 1;
  if (count >= MAX_BILLING_RETRIES) {
    return {
      status: "canceled",
      planType: "free",
      billingFailedCount: count,
      nextRetryAtMs: null,
    };
  }
  return {
    status: "past_due",
    billingFailedCount: count,
    nextRetryAtMs: nowMs + RETRY_INTERVAL_DAYS * DAY_MS,
  };
}
