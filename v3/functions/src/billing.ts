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
export const PLAN_PRICES_KRW: Record<string, number> = {
  pro: 19000,
  team: 29000,
  team_plus: 290000, // per-team floor (5 seats incl.)
};

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
  coupon: CouponLike | null | undefined
): { finalAmount: number; discountAmount: number } {
  if (!coupon) return { finalAmount: baseAmount, discountAmount: 0 };
  switch (coupon.type) {
    case "discount": {
      const discountAmount = Math.round(
        (baseAmount * (coupon.discountPercent || 0)) / 100
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

// ─── 기간 계산 ────────────────────────────────────────────────────────
// 한 결제 주기 = 1개월. setMonth 로 월경계를 넘긴다(기존 issueBillingKey 와 동일).
export function nextPeriodEnd(from: Date): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + 1);
  return d;
}

// ─── 멱등키(청구 문서 ID) ─────────────────────────────────────────────
// 같은 사이클을 두 번 청구하지 않도록, (userId, 사이클 기준시각) 을 결정적으로
// 문서 ID 화한다. 첫 청구는 발급시각, 갱신은 직전 currentPeriodEnd 를 앵커로
// 쓴다 — 크론이 중복 실행돼도 같은 사이클이면 같은 ID → claim 이 막는다.
export function billingChargeDocId(
  userId: string,
  cycleAnchorMs: number
): string {
  return `${userId}_${cycleAnchorMs}`;
}

// Toss 에 넘길 결정적 orderId — PG 측 멱등을 한 겹 더 보강.
export function billingOrderId(userId: string, cycleAnchorMs: number): string {
  return `sub_${userId}_${cycleAnchorMs}`;
}

// ─── 갱신 대상 선정(순수) ─────────────────────────────────────────────
// 크론이 구독 스냅샷을 이 함수에 통과시켜 "지금 청구해야 하는가"를 결정한다.
// Firestore Timestamp 는 호출부에서 ms 로 정규화해 넘긴다.
export interface SubscriptionSnapshot {
  paymentProvider?: string;
  status?: string;
  planType?: string;
  tossBillingKey?: string | null;
  tossCustomerKey?: string | null;
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
  sub: PaymentEvidenceSnapshot | null | undefined
): boolean {
  if (!sub) return false;
  return (
    hasNonEmptyString(sub.tossBillingKey) ||
    hasNonEmptyString(sub.paddleSubscriptionId)
  );
}

export function selectDueForCharge(
  sub: SubscriptionSnapshot,
  nowMs: number
): boolean {
  // 무료 파운더 grant·비-토스 구독은 절대 청구하지 않는다.
  if (sub.founderGrant === true) return false;
  if (sub.paymentProvider !== "toss") return false;
  if (!sub.tossBillingKey || !sub.tossCustomerKey) return false;
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
// now 앵커로 다음 주기를 부여한다(now+1개월). 크론 다운으로 여러 주기 밀렸을
// 때 과거로 소급해 여러 번 청구되는 catch-up 폭주를 피하려고 now 기준으로 둔다.
export interface ChargeSuccessState {
  status: "active";
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  billingFailedCount: 0;
  nextRetryAtMs: null;
}

export function applyChargeSuccess(nowMs: number): ChargeSuccessState {
  const start = new Date(nowMs);
  return {
    status: "active",
    currentPeriodStart: start,
    currentPeriodEnd: nextPeriodEnd(start),
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
  nowMs: number
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
