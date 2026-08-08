import { normalizeBillingCycle, planAmountKRW, type BillingCycle } from "./billing";

export type PortOnePaymentStatus =
  | "PAID"
  | "VIRTUAL_ACCOUNT_ISSUED"
  | "READY"
  | "PAY_PENDING"
  | "FAILED"
  | "CANCELLED"
  | "PARTIAL_CANCELLED";

export interface PortOnePaymentLike {
  id?: unknown;
  storeId?: unknown;
  status?: unknown;
  amount?: {
    total?: unknown;
  };
  currency?: unknown;
  billingKeyPayment?: {
    billingKey?: unknown;
  };
}

export interface ExpectedPortOnePayment {
  paymentId: string;
  storeId: string;
  amount: number;
  currency: "KRW";
}

export type PortOnePaymentValidation =
  | { ok: true; paymentId: string; amount: number; status: "PAID" }
  | { ok: false; reason: string };

/**
 * PortOne / KG이니시스 paymentId (oid) — 최대 40자.
 * userId 는 시그니처 호환용으로 유지하되 ID 에 포함하지 않는다
 * (Firebase uid 28자 삽입 시 40자 제한 초과).
 * purpose 는 1글자 코드(o|s) + nonce, ASCII 정규화 후 slice(0,40).
 */
export function portonePaymentId(
  userId: string,
  purpose: "one_time" | "subscription",
  nonce: string,
): string {
  void userId;
  const purposeCode = purpose === "subscription" ? "s" : "o";
  return `mb_${purposeCode}_${nonce}`
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .slice(0, 40);
}

export function portoneChargeDocId(paymentId: string): string {
  return `portone_${paymentId}`;
}

export function portoneExpectedAmount(
  planType: string,
  rawBilling: unknown,
): { amount: number; billingCycle: BillingCycle } | null {
  const billingCycle = normalizeBillingCycle(rawBilling);
  const amount = planAmountKRW(planType, billingCycle);
  if (!amount) return null;
  return { amount, billingCycle };
}

export function validatePortOnePaidPayment(
  payment: PortOnePaymentLike,
  expected: ExpectedPortOnePayment,
): PortOnePaymentValidation {
  if (payment.id !== expected.paymentId) {
    return { ok: false, reason: "payment_id_mismatch" };
  }
  if (payment.storeId !== expected.storeId) {
    return { ok: false, reason: "store_id_mismatch" };
  }
  if (payment.status !== "PAID") {
    return { ok: false, reason: "payment_not_paid" };
  }
  if (payment.currency !== expected.currency) {
    return { ok: false, reason: "currency_mismatch" };
  }
  if (payment.amount?.total !== expected.amount) {
    return { ok: false, reason: "amount_mismatch" };
  }
  return {
    ok: true,
    paymentId: expected.paymentId,
    amount: expected.amount,
    status: "PAID",
  };
}

export function extractPortOneBillingKey(payment: PortOnePaymentLike): string | null {
  const billingKey = payment.billingKeyPayment?.billingKey;
  if (typeof billingKey !== "string") return null;
  const trimmed = billingKey.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// ─── 간편결제(EASY_PAY) 빌링키 ────────────────────────────────────────
// 포트원 V2 규약(@portone/browser-sdk BillingKeyMethod / EasyPayProvider,
// @portone/server-sdk payment.billingKey.confirmBillingKey 실측):
//  - 빌링키 발급수단은 CARD | MOBILE | EASY_PAY | PAYPAL. 간편결제는 EASY_PAY
//    + easyPay.easyPayProvider 로 간편결제사를 직접 지정한다.
//  - 간편결제(토스페이 등) 채널이 "수동 승인" 으로 설정된 경우, 브라우저 SDK 는
//    billingKey 자리에 'NEEDS_CONFIRMATION' 을 주고 billingIssueToken 을 따로
//    넘긴다. 고객사 서버가 POST /billing-keys/confirm 으로 승인해야 실제
//    빌링키가 나온다 — 카드 경로에는 없는 단계다.

export type PortOneBillingKeyMethod = "CARD" | "EASY_PAY";

/** 브라우저 SDK 가 수동 승인 대기 시 billingKey 자리에 넣는 센티넬. */
export const PORTONE_BILLING_KEY_NEEDS_CONFIRMATION = "NEEDS_CONFIRMATION";

/**
 * 우리가 배선한 간편결제사(포트원 규약명). 토스페이만 우선 지원한다 —
 * 채널이 붙지 않은 provider 를 통과시키면 발급창에서 죽으므로 allowlist.
 */
export const SUPPORTED_EASY_PAY_PROVIDERS = ["TOSSPAY"] as const;
export type PortOneEasyPayProvider =
  (typeof SUPPORTED_EASY_PAY_PROVIDERS)[number];

/** 알 수 없는 값은 카드로 폴백 — 레거시 구독 문서(필드 없음)가 카드다. */
export function normalizePortOneBillingKeyMethod(
  raw: unknown,
): PortOneBillingKeyMethod {
  return typeof raw === "string" && raw.trim().toUpperCase() === "EASY_PAY"
    ? "EASY_PAY"
    : "CARD";
}

/** allowlist 밖이면 null (호출부가 미지원으로 거절). */
export function normalizeEasyPayProvider(
  raw: unknown,
): PortOneEasyPayProvider | null {
  if (typeof raw !== "string") return null;
  const upper = raw.trim().toUpperCase();
  return (SUPPORTED_EASY_PAY_PROVIDERS as readonly string[]).includes(upper)
    ? (upper as PortOneEasyPayProvider)
    : null;
}

/**
 * 빌링키 결제에 쓸 채널키. 간편결제 전용 채널이 설정돼 있으면 그것을,
 * 없으면 카드 빌링 채널로 폴백한다(KG이니시스 채널이 EasyPayProvider.TOSSPAY 를
 * 지원 — @portone/browser-sdk EasyPayProvider.TOSSPAY 주석 기준).
 *
 * ★빌링키는 발급된 채널에 묶인다. 갱신 청구가 다른 채널키를 보내면 PG 가
 * 거절하므로, 구독 문서에 저장한 발급수단으로 매 사이클 같은 채널을 고른다.
 */
export function resolvePortOneBillingChannelKey(params: {
  method: PortOneBillingKeyMethod;
  cardChannelKey: string;
  easyPayChannelKey?: string | null;
}): string {
  if (params.method === "EASY_PAY") {
    const easyPay = (params.easyPayChannelKey || "").trim();
    if (easyPay) return easyPay;
  }
  return params.cardChannelKey;
}

/**
 * 수동 승인 단계가 필요한가. billingKey 가 센티넬이거나 아예 비었는데
 * billingIssueToken 이 있으면 승인 API 를 태워야 한다.
 */
export function needsBillingKeyConfirmation(params: {
  billingKey?: string | null;
  billingIssueToken?: string | null;
}): boolean {
  const token = (params.billingIssueToken || "").trim();
  if (!token) return false;
  const key = (params.billingKey || "").trim();
  return key.length === 0 || key === PORTONE_BILLING_KEY_NEEDS_CONFIRMATION;
}

/** 승인 응답/입력에서 실제로 쓸 빌링키를 고른다(센티넬은 빌링키가 아니다). */
export function resolveIssuedBillingKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === PORTONE_BILLING_KEY_NEEDS_CONFIRMATION) {
    return null;
  }
  return trimmed;
}
