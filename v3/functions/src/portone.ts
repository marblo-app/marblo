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

export function portonePaymentId(
  userId: string,
  purpose: "one_time" | "subscription",
  nonce: string,
): string {
  return `portone_${purpose}_${userId}_${nonce}`.replace(/[^A-Za-z0-9_-]/g, "_");
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
