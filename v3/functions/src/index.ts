import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { BigQuery } from "@google-cloud/bigquery";
import {
  enforce as enforceRateLimit,
  extractIp,
  COUPON_RULES_UID,
  COUPON_RULES_IP,
} from "./rateLimit";
import { reconcileTossPending, reconcilePaddlePending } from "./reconciliation";
import { redactSecrets } from "./redact";
import {
  verifyPaddleSignature,
  classifyTossPaymentResponse,
  resolveTossWebhookAction,
  type TossPaymentQueryResult,
} from "./webhookVerify";
import {
  PLAN_PRICES_KRW,
  applyCouponDiscount,
  nextPeriodEnd,
  billingChargeDocId,
  billingOrderId,
  selectDueForCharge,
  applyChargeSuccess,
  applyChargeFailure,
  type SubscriptionSnapshot,
} from "./billing";

admin.initializeApp();
const db = admin.firestore();
const BQ_LOCATION = "US";
const bigquery = new BigQuery({ location: BQ_LOCATION });

const BQ_DATASET = "marblo_telemetry";
const BQ_EVENTS_TABLE = "events";
const BQ_COST_TABLE = "cost_logs";

// ─── Config ──────────────────────────────────────────────────────
const PADDLE_API_KEY = process.env.PADDLE_API_KEY!;
const PADDLE_WEBHOOK_SECRET = process.env.PADDLE_WEBHOOK_SECRET!;
const PADDLE_API_BASE = "https://api.paddle.com";

const TOSS_SECRET_KEY = process.env.TOSS_SECRET_KEY!;
const TOSS_API_BASE = "https://api.tosspayments.com/v1";

// ─── SendGrid (파운더 접근 안내 이메일) ──────────────────────────────
// 전부 선택값 — 미설정 시 발송만 스킵하고 배포·선정은 정상 동작한다.
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const FOUNDER_FROM_EMAIL =
  process.env.FOUNDER_FROM_EMAIL || "founders@marblo.app";
const FOUNDER_FROM_NAME = process.env.FOUNDER_FROM_NAME || "Marblo";
const DISCORD_INVITE_URL = process.env.DISCORD_INVITE_URL || ""; // 설정 시에만 초대 링크 노출
const SITE_BASE = "https://marblo.app";
const FOUNDER_COURSE_COUPON = "FOUNDER50"; // 강의 50% 할인 쿠폰 코드

// PLAN_PRICES_KRW 는 ./billing 로 이관(단일소스). import 참조.

// Map Paddle Price IDs to plan types (set in Firebase environment config)
const PADDLE_PRICE_TO_PLAN: Record<string, string> = {
  [process.env.PADDLE_PRO_PRICE_ID || ""]: "pro",
  [process.env.PADDLE_TEAM_PRICE_ID || ""]: "team",
};

// ═══════════════════════════════════════════════════════════════════
// Paddle Integration (해외 결제)
// ═══════════════════════════════════════════════════════════════════

// ─── Cancel Paddle Subscription ──────────────────────────────────
export const cancelPaddleSubscription = functions.https.onCall(
  async (_data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "로그인이 필요합니다.",
      );
    }

    const userId = context.auth.uid;
    const subSnap = await db.collection("subscriptions").doc(userId).get();

    if (!subSnap.exists || !subSnap.data()?.paddleSubscriptionId) {
      throw new functions.https.HttpsError(
        "not-found",
        "구독 정보를 찾을 수 없습니다.",
      );
    }

    const paddleSubId = subSnap.data()!.paddleSubscriptionId;

    const response = await fetch(
      `${PADDLE_API_BASE}/subscriptions/${paddleSubId}/cancel`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PADDLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ effective_from: "next_billing_period" }),
      },
    );

    if (!response.ok) {
      const error = await response.json();
      console.error("Paddle cancel failed:", error);
      throw new functions.https.HttpsError(
        "internal",
        "구독 취소에 실패했습니다.",
      );
    }

    return { success: true };
  },
);

// ─── Webhook signature verification (H1) ─────────────────────────
//
// 위조된 웹훅으로 구독 상태를 조작하는 것을 막는다. 검증 로직은
// webhookVerify.ts 로 추출해 단위 테스트(tests/webhookVerify.test.mjs)로
// 커버한다 — 시크릿은 아래 호출부에서 env 상수로 주입한다.

// ─── Paddle Webhook ──────────────────────────────────────────────
export const paddleWebhook = functions.https.onRequest(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  // H1: 서명 검증. 기존 코드는 헤더 '존재'만 확인해(`!signature && SECRET`)
  // 아무 값이나 넣으면 통과했다 — 서명 값 자체를 HMAC 으로 검증한다.
  const signature = (req.headers["paddle-signature"] as string) || "";
  if (!verifyPaddleSignature(signature, req.rawBody, PADDLE_WEBHOOK_SECRET)) {
    res.status(401).send("Invalid webhook signature");
    return;
  }

  const { event_type, data } = req.body;

  switch (event_type) {
    // Subscription activated (first payment successful)
    case "subscription.activated":
    case "subscription.created": {
      const customData = data.custom_data || {};
      const userId = customData.userId;
      if (!userId) break;

      // Determine plan type from price ID
      const priceId = data.items?.[0]?.price?.id || "";
      const planType = PADDLE_PRICE_TO_PLAN[priceId] || "pro";

      const currentPeriodStart = data.current_billing_period?.starts_at
        ? new Date(data.current_billing_period.starts_at)
        : new Date();
      const currentPeriodEnd = data.current_billing_period?.ends_at
        ? new Date(data.current_billing_period.ends_at)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await db
        .collection("subscriptions")
        .doc(userId)
        .set({
          userId,
          planType,
          status: "active",
          paymentProvider: "paddle",
          paddleCustomerId: data.customer_id || null,
          paddleSubscriptionId: data.id,
          currentPeriodStart:
            admin.firestore.Timestamp.fromDate(currentPeriodStart),
          currentPeriodEnd:
            admin.firestore.Timestamp.fromDate(currentPeriodEnd),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      break;
    }

    // Subscription updated (plan change, renewal)
    case "subscription.updated": {
      const subscriptionId = data.id;

      const snap = await db
        .collection("subscriptions")
        .where("paddleSubscriptionId", "==", subscriptionId)
        .limit(1)
        .get();

      if (!snap.empty) {
        const docRef = snap.docs[0].ref;
        const update: Record<string, unknown> = {
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        if (data.status === "active") update.status = "active";
        if (data.status === "past_due") update.status = "past_due";

        if (data.current_billing_period) {
          if (data.current_billing_period.starts_at) {
            update.currentPeriodStart = admin.firestore.Timestamp.fromDate(
              new Date(data.current_billing_period.starts_at),
            );
          }
          if (data.current_billing_period.ends_at) {
            update.currentPeriodEnd = admin.firestore.Timestamp.fromDate(
              new Date(data.current_billing_period.ends_at),
            );
          }
        }

        // Check if plan changed
        const priceId = data.items?.[0]?.price?.id || "";
        const newPlan = PADDLE_PRICE_TO_PLAN[priceId];
        if (newPlan) update.planType = newPlan;

        await docRef.update(update);
      }
      break;
    }

    // Subscription canceled
    case "subscription.canceled": {
      const subscriptionId = data.id;

      const snap = await db
        .collection("subscriptions")
        .where("paddleSubscriptionId", "==", subscriptionId)
        .limit(1)
        .get();

      if (!snap.empty) {
        await snap.docs[0].ref.update({
          status: "canceled",
          planType: "free",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      break;
    }

    // Payment failed
    case "transaction.payment_failed": {
      const subscriptionId = data.subscription_id;
      if (!subscriptionId) break;

      const snap = await db
        .collection("subscriptions")
        .where("paddleSubscriptionId", "==", subscriptionId)
        .limit(1)
        .get();

      if (!snap.empty) {
        await snap.docs[0].ref.update({
          status: "past_due",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      break;
    }

    default:
      console.log(`Unhandled Paddle event: ${event_type}`);
  }

  res.json({ received: true });
});

// ═══════════════════════════════════════════════════════════════════
// TossPayments Integration (국내 결제)
// ═══════════════════════════════════════════════════════════════════

// ─── Create Toss Checkout ────────────────────────────────────────
export const createTossCheckout = functions.https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "로그인이 필요합니다.",
      );
    }

    const { planType } = data as { planType: string };
    const amount = PLAN_PRICES_KRW[planType];
    if (!amount) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "유효하지 않은 플랜입니다.",
      );
    }

    const userId = context.auth.uid;
    const orderId = `marblo_${planType}_${userId}_${Date.now()}`;

    await db.collection("pendingOrders").doc(orderId).set({
      userId,
      planType,
      amount,
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { orderId, amount, planType };
  },
);

// ─── Confirm Toss Payment ────────────────────────────────────────
export const confirmTossPayment = functions.https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "로그인이 필요합니다.",
      );
    }

    const { orderId, paymentKey, amount } = data as {
      orderId: string;
      paymentKey: string;
      amount: number;
    };

    const orderSnap = await db.collection("pendingOrders").doc(orderId).get();
    if (!orderSnap.exists) {
      throw new functions.https.HttpsError(
        "not-found",
        "주문을 찾을 수 없습니다.",
      );
    }

    const order = orderSnap.data()!;
    // IDOR 가드: 본인 주문만 확인할 수 있다. orderId 는 클라이언트가 넘기고
    // 형식이 열거 가능(`marblo_<plan>_<uid>_<ts>`)하므로, 소유권 확인이 없으면
    // 인증된 사용자가 남의 orderId 로 구독을 활성화/덮어쓸 수 있다(그 doc 의
    // userId 로 subscriptions 가 기록됨). 실 익스플로잇은 유효 paymentKey 가
    // 게이트하지만, 방어심층으로 호출자 uid 와 주문 소유자를 대조한다.
    if (order.userId !== context.auth.uid) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "본인의 주문만 확인할 수 있습니다.",
      );
    }
    if (order.amount !== amount) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "결제 금액이 일치하지 않습니다.",
      );
    }

    const authHeader = Buffer.from(`${TOSS_SECRET_KEY}:`).toString("base64");

    const response = await fetch(`${TOSS_API_BASE}/payments/confirm`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${authHeader}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ paymentKey, orderId, amount }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error("TossPayments confirm failed:", error);
      throw new functions.https.HttpsError(
        "internal",
        error.message || "결제 승인에 실패했습니다.",
      );
    }

    const payment = await response.json();
    const userId = order.userId;
    const planType = order.planType;

    const now = new Date();
    const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    await db
      .collection("subscriptions")
      .doc(userId)
      .set({
        userId,
        planType,
        status: "active",
        paymentProvider: "toss",
        tossPaymentKey: paymentKey,
        tossCustomerKey: payment.customerKey || null,
        tossBillingKey: payment.card?.billingKey || null,
        currentPeriodStart: admin.firestore.Timestamp.fromDate(now),
        currentPeriodEnd: admin.firestore.Timestamp.fromDate(periodEnd),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    await db.collection("pendingOrders").doc(orderId).update({
      status: "confirmed",
      confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { success: true };
  },
);

// ─── TossPayments Webhook ────────────────────────────────────────
// H1(재수정): Toss 결제 웹훅(PAYMENT_STATUS_CHANGED)은 서명 헤더가 없다 — HMAC
// 서명은 정산/셀러 웹훅(payout.changed) 전용(`tosspayments-webhook-signature`).
// 따라서 서명으로는 검증할 수 없고, body 의 status 를 신뢰하면 위조 요청으로
// 임의 구독을 canceled/past_due 로 바꿀 수 있다. 위조 방지의 정석은 body 를
// 믿지 않고 paymentKey 로 Payment 조회 API 를 재호출해 Toss 가 알려주는 실제
// status 로만 구독을 바꾸는 것. 위조·유령 paymentKey 는 재조회에서 실제 상태
// 불일치 또는 404(미존재)로 무해화된다.
//
// PAYMENT_STATUS_CHANGED 검증용 재조회. GET /v1/payments/{paymentKey} 를
// Basic 인증으로 호출한다. 성공(2xx+status) → { status }, 실패/미존재(404)/
// 미설정/네트워크오류 → null 을 돌려 호출부가 "구독 변경 안 함"으로 안전
// 처리하게 한다. body 의 status 는 절대 참조하지 않는다.
async function fetchTossPaymentStatus(
  paymentKey: string,
): Promise<TossPaymentQueryResult> {
  if (!TOSS_SECRET_KEY) return null;
  try {
    const res = await fetch(
      `${TOSS_API_BASE}/payments/${encodeURIComponent(paymentKey)}`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(TOSS_SECRET_KEY + ":").toString(
            "base64",
          )}`,
        },
      },
    );
    const body = res.ok
      ? ((await res.json().catch(() => null)) as unknown)
      : null;
    return classifyTossPaymentResponse(res.ok, body);
  } catch (err) {
    console.warn("[tossWebhook] payment re-query error:", err);
    return null;
  }
}

export const tossWebhook = functions.https.onRequest(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const { eventType, data: eventData } = req.body ?? {};

  switch (eventType) {
    case "PAYMENT_STATUS_CHANGED": {
      // body.status 는 신뢰하지 않는다 — paymentKey 로 재조회한 실제 status 만 사용.
      const paymentKey =
        typeof eventData?.paymentKey === "string" ? eventData.paymentKey : "";
      if (!paymentKey) {
        // 재조회 식별자가 없으면 검증 불가 → 안전 무시.
        console.warn(
          "[tossWebhook] PAYMENT_STATUS_CHANGED without paymentKey; ignoring",
        );
        break;
      }

      const query = await fetchTossPaymentStatus(paymentKey);
      const action = resolveTossWebhookAction(query);
      if (!query) {
        // 재조회 실패/미존재(위조 포함) → 구독 변경 없이 무시(+로그).
        console.warn(
          "[tossWebhook] payment re-query failed or not found; no subscription change",
        );
        break;
      }
      if (action.type === "none") break;

      // 재조회로 확인된 실제 상태가 해지/부분취소일 때만 구독을 조회·변경.
      // 멱등: 동일 상태 재수신은 같은 값 write → 무해(scheduledReconcileToss·
      // 갱신 크론과 컬렉션이 달라 충돌 없음).
      const snap = await db
        .collection("subscriptions")
        .where("tossPaymentKey", "==", paymentKey)
        .limit(1)
        .get();
      if (snap.empty) break;
      const docRef = snap.docs[0].ref;
      if (action.type === "cancel") {
        await docRef.update({
          status: "canceled",
          planType: "free",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } else if (action.type === "past_due") {
        await docRef.update({
          status: "past_due",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      break;
    }

    default:
      console.log(`Unhandled Toss event: ${eventType}`);
  }

  res.json({ received: true });
});

// ============================================
// 정기결제 (Billing Key) Functions
// ============================================

// ─── 정기결제 청구 헬퍼(멱등) ────────────────────────────────────────
// Toss 빌링 청구 1회. billingCharges/{userId}_{cycleAnchorMs} claim 문서 +
// 결정적 orderId 로 "같은 사이클 중복청구"를 이중으로 막는다. 첫 청구·수동
// 청구·갱신 크론이 전부 이 헬퍼를 공유한다. amount<=0(쿠폰 전액할인/무료)은
// 실 PG 호출 없이 comped 처리.
const STALE_PENDING_MS = 15 * 60 * 1000; // 크래시 잔재 pending 재청구 허용 임계

type ChargeResult =
  | { status: "charged"; paymentKey: string }
  | { status: "comped" }
  | { status: "skipped" }
  | { status: "failed"; error: string };

// Firestore Timestamp/Date/number/string 을 ms 로 정규화(비교용).
function tsToMillis(x: unknown): number | null {
  if (x instanceof admin.firestore.Timestamp) return x.toMillis();
  if (x instanceof Date) return x.getTime();
  if (typeof x === "number") return x;
  if (typeof x === "string") {
    const t = new Date(x).getTime();
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

async function chargeSubscriptionIdempotent(params: {
  userId: string;
  billingKey: string;
  customerKey: string;
  amount: number;
  planType: string;
  cycleAnchorMs: number;
  reason: "first" | "renewal" | "manual";
}): Promise<ChargeResult> {
  const { userId, billingKey, customerKey, amount, planType, cycleAnchorMs } =
    params;
  const docId = billingChargeDocId(userId, cycleAnchorMs);
  const orderId = billingOrderId(userId, cycleAnchorMs);
  const chargeRef = db.collection("billingCharges").doc(docId);

  // 1) 트랜잭션으로 청구권 claim — 이미 성공/진행중이면 재청구하지 않는다.
  const proceed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(chargeRef);
    if (snap.exists) {
      const data = snap.data() || {};
      const st = data.status as string | undefined;
      if (st === "succeeded" || st === "comped") return false;
      if (st === "pending") {
        // 진행 중이면 중복 방지 위해 대기. 단, 오래된 pending 은 크래시 잔재로
        // 보고 재시도 허용(결정적 orderId 덕에 실 성공분은 PG 가 재청구 거절).
        const updatedMs = tsToMillis(data.updatedAt);
        if (updatedMs != null && Date.now() - updatedMs < STALE_PENDING_MS) {
          return false;
        }
      }
      // status === "failed" 또는 stale pending → 재청구 허용.
    }
    tx.set(
      chargeRef,
      {
        userId,
        orderId,
        amount,
        planType,
        reason: params.reason,
        status: "pending",
        cycleAnchorMs,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return true;
  });

  if (!proceed) return { status: "skipped" };

  // 2) 금액 0 이하 → 실 결제 없이 comped(쿠폰 전액할인/무료 플랜).
  if (amount <= 0) {
    await chargeRef.update({
      status: "comped",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { status: "comped" };
  }

  // 3) 실제 Toss 빌링 청구.
  try {
    const response = await fetch(
      `https://api.tosspayments.com/v1/billing/${billingKey}`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(TOSS_SECRET_KEY + ":").toString(
            "base64",
          )}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customerKey,
          amount,
          orderId,
          orderName: `Marblo ${planType} 구독`,
        }),
      },
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const msg = String(error?.message || `HTTP ${response.status}`).slice(
        0,
        500,
      );
      await chargeRef.update({
        status: "failed",
        error: msg,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { status: "failed", error: msg };
    }

    const responseData = await response.json();
    await chargeRef.update({
      status: "succeeded",
      paymentKey: responseData.paymentKey || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { status: "charged", paymentKey: responseData.paymentKey };
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).slice(
      0,
      500,
    );
    await chargeRef.update({
      status: "failed",
      error: msg,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { status: "failed", error: msg };
  }
}

// 첫 청구용 쿠폰 검증·할인 계산. 유효하지 않으면 정가로 폴백(throw 하지 않음 —
// 쿠폰 문제로 결제 자체가 깨지면 안 됨). 반환된 appliedCoupon 은 청구 성공
// 후에만 소진 기록한다.
async function resolveFirstChargeAmount(
  userId: string,
  baseAmount: number,
  couponCode: unknown,
): Promise<{
  finalAmount: number;
  appliedCoupon: { code: string } | null;
}> {
  if (!couponCode || typeof couponCode !== "string") {
    return { finalAmount: baseAmount, appliedCoupon: null };
  }
  const couponDoc = await db.collection("coupons").doc(couponCode).get();
  if (!couponDoc.exists)
    return { finalAmount: baseAmount, appliedCoupon: null };
  const c = couponDoc.data()!;
  const notExpired = !c.expiresAt || c.expiresAt.toDate() >= new Date();
  const underMax = !(c.usedCount >= c.maxUses);
  const already = await db
    .collection("couponRedemptions")
    .where("couponCode", "==", couponCode)
    .where("userId", "==", userId)
    .limit(1)
    .get();
  if (!notExpired || !underMax || !already.empty) {
    return { finalAmount: baseAmount, appliedCoupon: null };
  }
  const { finalAmount } = applyCouponDiscount(baseAmount, c);
  return { finalAmount, appliedCoupon: { code: couponCode } };
}

// 빌링키 발급 + 첫 결제 청구(원자적). 청구 실패 시 구독을 active 로 만들지
// 않는다 — GAP A(₩0 무료 활성) 방지의 핵심.
export const issueBillingKey = functions.https.onCall(async (data, context) => {
  const { authKey, customerKey, plan, coupon } = data;
  const userId = context.auth?.uid;
  if (!userId)
    throw new functions.https.HttpsError("unauthenticated", "Login required");

  const planType = plan || "pro";
  const baseAmount = PLAN_PRICES_KRW[planType];
  if (!baseAmount) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      `Plan '${planType}' is not chargeable`,
    );
  }

  // 1) 빌링키 발급.
  const response = await fetch(
    "https://api.tosspayments.com/v1/billing/authorizations/issue",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(TOSS_SECRET_KEY + ":").toString(
          "base64",
        )}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ authKey, customerKey }),
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new functions.https.HttpsError(
      "internal",
      error.message || "Failed to issue billing key",
    );
  }

  const responseData = await response.json();
  const billingKey = responseData.billingKey;

  // 2) 쿠폰 할인(첫 청구에만 적용).
  const { finalAmount, appliedCoupon } = await resolveFirstChargeAmount(
    userId,
    baseAmount,
    coupon,
  );

  // 3) 첫 결제 청구(멱등). 실패 시 구독 active 처리 없이 throw(원자적).
  const cycleAnchorMs = Date.now();
  const charge = await chargeSubscriptionIdempotent({
    userId,
    billingKey,
    customerKey,
    amount: finalAmount,
    planType,
    cycleAnchorMs,
    reason: "first",
  });
  if (charge.status === "failed") {
    throw new functions.https.HttpsError(
      "internal",
      `첫 결제에 실패했습니다: ${charge.error}`,
    );
  }

  // 4) 청구 성공/comped → 구독 active 저장 + 쿠폰 소진 기록.
  const now = new Date(cycleAnchorMs);
  const periodEnd = nextPeriodEnd(now);
  await db
    .collection("subscriptions")
    .doc(userId)
    .set(
      {
        userId,
        planType,
        status: "active",
        paymentProvider: "toss",
        tossBillingKey: billingKey,
        tossCustomerKey: customerKey,
        tossPaymentKey: charge.status === "charged" ? charge.paymentKey : null,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        billingFailedCount: 0,
        nextRetryAt: null,
        couponCode: appliedCoupon?.code || null,
        createdAt: now,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

  if (appliedCoupon) {
    await db
      .collection("coupons")
      .doc(appliedCoupon.code)
      .update({ usedCount: admin.firestore.FieldValue.increment(1) });
    await db.collection("couponRedemptions").add({
      couponCode: appliedCoupon.code,
      userId,
      redeemedAt: new Date(),
      context: "subscription_first_charge",
    });
  }

  return { success: true, billingKey, charged: charge.status };
});

// 빌링키로 정기결제 실행(수동 트리거). 갱신 크론과 동일한 멱등 헬퍼를 공유해
// 같은 사이클 중복청구를 막는다.
export const chargeBillingKey = functions.https.onCall(
  async (_data, context) => {
    // C1: 인증 필수 + 결제 파라미터는 전부 서버에서 유도한다.
    // 기존엔 인증 없이 userId/amount/billingKey 를 클라이언트 data 에서
    // 받아, 임의 사용자의 빌링키로 임의 금액을 청구할 수 있었다(무인증+IDOR).
    const userId = context.auth?.uid;
    if (!userId)
      throw new functions.https.HttpsError("unauthenticated", "Login required");

    // 호출자 본인의 구독 문서에서 billingKey/customerKey/plan 을 읽는다 —
    // 클라이언트 입력은 신뢰하지 않는다.
    const subRef = db.collection("subscriptions").doc(userId);
    const subSnap = await subRef.get();
    const sub = subSnap.data();
    if (!subSnap.exists || !sub?.tossBillingKey || !sub?.tossCustomerKey) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "No billing key registered for this account",
      );
    }

    const planType: string = sub.planType || "pro";
    const amount = PLAN_PRICES_KRW[planType];
    if (!amount) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        `Plan '${planType}' is not chargeable`,
      );
    }

    // 사이클 앵커 = 현재 만료 경계(없으면 now). 같은 주기 재호출은 멱등하게 skip.
    const cycleAnchorMs = tsToMillis(sub.currentPeriodEnd) ?? Date.now();
    const charge = await chargeSubscriptionIdempotent({
      userId,
      billingKey: sub.tossBillingKey as string,
      customerKey: sub.tossCustomerKey as string,
      amount,
      planType,
      cycleAnchorMs,
      reason: "manual",
    });

    if (charge.status === "failed") {
      throw new functions.https.HttpsError(
        "internal",
        charge.error || "Failed to charge billing key",
      );
    }

    // 성공/comped/skipped → 구독 기간 연장(멱등 재적용 안전).
    const success = applyChargeSuccess(Date.now());
    await subRef.update({
      status: success.status,
      currentPeriodStart: success.currentPeriodStart,
      currentPeriodEnd: success.currentPeriodEnd,
      billingFailedCount: 0,
      nextRetryAt: null,
      ...(charge.status === "charged"
        ? { tossPaymentKey: charge.paymentKey }
        : {}),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      paymentKey: charge.status === "charged" ? charge.paymentKey : null,
      charged: charge.status,
    };
  },
);

// 토스 정기결제 취소
export const cancelTossSubscription = functions.https.onCall(
  async (_data, context) => {
    const userId = context.auth?.uid;
    if (!userId)
      throw new functions.https.HttpsError("unauthenticated", "Login required");

    await db.collection("subscriptions").doc(userId).update({
      status: "canceled",
      canceledAt: new Date(),
    });

    return { success: true };
  },
);

// ============================================
// 강의 (Lecture) Functions
// ============================================

// 강의 주문 생성
export const createLectureOrder = functions.https.onCall(
  async (data, context) => {
    const { lectureSlug } = data;
    const userId = context.auth?.uid;
    if (!userId)
      throw new functions.https.HttpsError("unauthenticated", "Login required");

    // Check if already purchased
    const existingPurchase = await db
      .collection("lecturePurchases")
      .where("userId", "==", userId)
      .where("lectureSlug", "==", lectureSlug)
      .get();

    if (!existingPurchase.empty) {
      throw new functions.https.HttpsError(
        "already-exists",
        "Already purchased this lecture",
      );
    }

    // Get lecture info
    const lectureDoc = await db.collection("lectures").doc(lectureSlug).get();
    if (!lectureDoc.exists) {
      throw new functions.https.HttpsError("not-found", "Lecture not found");
    }
    const lecture = lectureDoc.data()!;
    const amount = lecture.price;

    const orderId = `LECTURE-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const orderName = lecture.title_ko || lecture.title || lectureSlug;

    await db.collection("pendingOrders").doc(orderId).set({
      userId,
      type: "lecture",
      lectureSlug,
      amount,
      orderName,
      createdAt: new Date(),
    });

    return { orderId, amount, orderName };
  },
);

// 강의 단건결제 확인
export const confirmLecturePayment = functions.https.onCall(
  async (data, context) => {
    const { paymentKey, orderId, amount } = data;
    const userId = context.auth?.uid;
    if (!userId)
      throw new functions.https.HttpsError("unauthenticated", "Login required");

    // 주문 소유권/금액/멱등을 PG confirm 전에 검증한다(confirmTossPayment 와 동일
    // 방어). orderId 는 클라이언트가 넘기고 열거 가능하므로, 소유권 확인이 없으면
    // 인증된 사용자가 남의 주문을 확정해 강의를 자기 계정에 붙일 수 있다. 또한
    // confirm 전에 검증해야 실패 시 불필요한 결제승인을 하지 않는다.
    const orderDoc = await db.collection("pendingOrders").doc(orderId).get();
    if (!orderDoc.exists) {
      throw new functions.https.HttpsError("not-found", "Order not found");
    }
    const order = orderDoc.data()!;
    if (order.userId !== userId) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "본인의 주문만 확인할 수 있습니다.",
      );
    }
    if (typeof amount === "number" && order.amount !== amount) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "결제 금액이 일치하지 않습니다.",
      );
    }

    // 멱등: 이미 이 강의를 구매했으면 재확정하지 않는다(중복 구매행/쿠폰 방지).
    const existingPurchase = await db
      .collection("lecturePurchases")
      .where("userId", "==", userId)
      .where("lectureSlug", "==", order.lectureSlug)
      .limit(1)
      .get();
    if (!existingPurchase.empty) {
      throw new functions.https.HttpsError(
        "already-exists",
        "Already purchased this lecture",
      );
    }

    // Confirm with TossPayments (금액은 서버가 보관한 주문 금액을 신뢰).
    const response = await fetch(
      "https://api.tosspayments.com/v1/payments/confirm",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(TOSS_SECRET_KEY + ":").toString(
            "base64",
          )}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ paymentKey, orderId, amount: order.amount }),
      },
    );

    if (!response.ok) {
      const error = await response.json();
      throw new functions.https.HttpsError(
        "internal",
        error.message || "Payment confirmation failed",
      );
    }

    // Create lecture purchase
    await db.collection("lecturePurchases").add({
      userId,
      lectureSlug: order.lectureSlug,
      purchasedAt: new Date(),
      orderId,
      amount: order.amount,
    });

    // Delete pending order
    await db.collection("pendingOrders").doc(orderId).delete();

    // Auto-issue lecture coupon
    await issueLectureCouponInternal(userId);

    return { success: true };
  },
);

// ============================================
// 쿠폰 (Coupon) Functions
// ============================================

// 쿠폰 검증
export const validateCoupon = functions.https.onCall(async (data, context) => {
  const { code, userId } = data;
  if (!code)
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Coupon code required",
    );

  // Rate limit: stops brute-force code guessing. Per-uid (5/min, 30/5min)
  // AND per-IP (20/min, 100/10min). Both must pass.
  const ip = extractIp(context.rawRequest);
  const uidKey = userId ? `coupon:uid:${userId}` : `coupon:anon:${ip}`;
  const ipKey = `coupon:ip:${ip}`;
  const uidCheck = await enforceRateLimit(uidKey, COUPON_RULES_UID);
  if (!uidCheck.allowed) {
    throw new functions.https.HttpsError(
      "resource-exhausted",
      `Too many attempts. Try again in ${uidCheck.retryAfter}s.`,
    );
  }
  const ipCheck = await enforceRateLimit(ipKey, COUPON_RULES_IP);
  if (!ipCheck.allowed) {
    throw new functions.https.HttpsError(
      "resource-exhausted",
      `Too many attempts from this network. Try again in ${ipCheck.retryAfter}s.`,
    );
  }

  const couponDoc = await db.collection("coupons").doc(code).get();
  if (!couponDoc.exists) {
    return { valid: false, reason: "Coupon not found" };
  }

  const coupon = couponDoc.data()!;

  // Check expiry
  if (coupon.expiresAt && coupon.expiresAt.toDate() < new Date()) {
    return { valid: false, reason: "Coupon expired" };
  }

  // Check max uses
  if (coupon.usedCount >= coupon.maxUses) {
    return { valid: false, reason: "Coupon usage limit reached" };
  }

  // Check if user already used this coupon
  if (userId) {
    const redemption = await db
      .collection("couponRedemptions")
      .where("couponCode", "==", code)
      .where("userId", "==", userId)
      .get();
    if (!redemption.empty) {
      return { valid: false, reason: "Coupon already used" };
    }
  }

  return {
    valid: true,
    type: coupon.type,
    discountPercent: coupon.discountPercent,
    freeDays: coupon.freeDays,
    targetPlan: coupon.targetPlan,
  };
});

// 쿠폰 적용
export const applyCoupon = functions.https.onCall(async (data, context) => {
  const { code, userId, baseAmount } = data;
  if (!userId)
    throw new functions.https.HttpsError("unauthenticated", "Login required");

  // Rate limit: applyCoupon is the higher-cost endpoint (writes to coupons
  // counter + redemption record). Same per-uid + per-IP limits as validate
  // — an attacker bypassing validate by going straight to apply still hits
  // the same shared keys.
  const ip = extractIp(context.rawRequest);
  const uidCheck = await enforceRateLimit(
    `coupon:uid:${userId}`,
    COUPON_RULES_UID,
  );
  if (!uidCheck.allowed) {
    throw new functions.https.HttpsError(
      "resource-exhausted",
      `Too many attempts. Try again in ${uidCheck.retryAfter}s.`,
    );
  }
  const ipCheck = await enforceRateLimit(`coupon:ip:${ip}`, COUPON_RULES_IP);
  if (!ipCheck.allowed) {
    throw new functions.https.HttpsError(
      "resource-exhausted",
      `Too many attempts from this network. Try again in ${ipCheck.retryAfter}s.`,
    );
  }

  // Validate first
  const couponDoc = await db.collection("coupons").doc(code).get();
  if (!couponDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Invalid coupon");
  }
  const coupon = couponDoc.data()!;

  let finalAmount = baseAmount;
  let discountAmount = 0;

  switch (coupon.type) {
    case "discount":
      discountAmount = Math.round(
        (baseAmount * (coupon.discountPercent || 0)) / 100,
      );
      finalAmount = baseAmount - discountAmount;
      break;
    case "free_trial":
      finalAmount = 0;
      discountAmount = baseAmount;
      break;
    case "plan_upgrade":
      finalAmount = 0;
      discountAmount = baseAmount;
      break;
  }

  // Increment usage
  await db
    .collection("coupons")
    .doc(code)
    .update({
      usedCount: admin.firestore.FieldValue.increment(1),
    });

  // Record redemption
  await db.collection("couponRedemptions").add({
    couponCode: code,
    userId,
    redeemedAt: new Date(),
  });

  return { finalAmount, discountAmount, couponType: coupon.type };
});

// 쿠폰 일괄 생성 (관리자용)
export const createCouponBatch = functions.https.onCall(
  async (data, context) => {
    requireAdmin(context);

    const { coupons } = data;
    if (!Array.isArray(coupons) || coupons.length === 0) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Coupons array required",
      );
    }

    const batch = db.batch();
    for (const coupon of coupons) {
      const ref = db.collection("coupons").doc(coupon.code);
      batch.set(ref, {
        code: coupon.code,
        type: coupon.type,
        discountPercent: coupon.discountPercent || null,
        freeDays: coupon.freeDays || null,
        targetPlan: coupon.targetPlan || null,
        maxUses: coupon.maxUses,
        usedCount: 0,
        expiresAt: new Date(coupon.expiresAt),
        createdAt: new Date(),
      });
    }

    await batch.commit();
    return { created: coupons.length };
  },
);

// 강의 구매 → 앱 쿠폰 자동 발급 (내부 함수)
async function issueLectureCouponInternal(userId: string) {
  const couponCode = "LECTURE2026";

  // Check if already redeemed
  const existing = await db
    .collection("couponRedemptions")
    .where("couponCode", "==", couponCode)
    .where("userId", "==", userId)
    .get();

  if (!existing.empty) return;

  // Record the coupon grant
  await db.collection("couponRedemptions").add({
    couponCode,
    userId,
    redeemedAt: new Date(),
    autoIssued: true,
  });
}

// 강의 구매 → 앱 쿠폰 자동 발급 (callable)
export const issueLectureCoupon = functions.https.onCall(
  async (_data, context) => {
    const userId = context.auth?.uid;
    if (!userId)
      throw new functions.https.HttpsError("unauthenticated", "Login required");

    await issueLectureCouponInternal(userId);
    return { couponCode: "LECTURE2026" };
  },
);

// ═══════════════════════════════════════════════════════════════════
// Founder Beta (파운더 100인 무료 베타) — V2 설문/루브릭 → Pro 무료 부여
// ═══════════════════════════════════════════════════════════════════
//
// 흐름:
//   1) 어드민이 betatester50_waitlist 검토 후 markFounderSelected({email}) 로 선정.
//      founders/{normalizedEmail} 생성, betaExpiresAt = 선정/활성화 + 1개월.
//   2) 파운더가 같은 (이메일 인증된) 계정으로 로그인 → /beta-survey
//      7문항 제출 → submitFounderFeedback(): 선정 여부 + 중복 제출 검증 후
//      founder_feedback 저장. 제출만으로 보상은 확정하지 않는다.
//   3) 운영자가 루브릭 채점(reviewFounderFeedback) → 기준 통과 시 Pro 총 3개월.
//   4) 운영자가 상위 응답자에게 인터뷰 요청(requestFounderInterview) 후 완료 처리
//      (markFounderInterviewed) → Pro 총 6개월로 연장.
//
// 어드민 식별: triggerReconcile 과 동일하게 ADMIN_UID env 단일 체크.

const FOUNDER_BETA_MONTHS = 1;
const FOUNDER_PRO_MONTHS = 3;
const FOUNDER_INTERVIEW_TOTAL_PRO_MONTHS = 6;
const FOUNDER_PRO_RUBRIC_MIN_TOTAL = 10;
const FOUNDER_INTERVIEW_MIN_TOTAL = 14;
const FOUNDER_FIELD_MAX = 5000;
const FOUNDER_FEEDBACK_COLLECTION = "founder_feedback";
const FOUNDERS_COLLECTION = "founders";

interface FounderSurveyAnswers {
  q1: string;
  q2: string;
  q3: string;
  q4: string;
  q5: string;
  q6: string;
  q7: string;
}

interface FounderRubricScore {
  total: number;
  specificity: number;
  usageEvidence: number;
  insightQuality: number;
  actionability: number;
  icpFit: number;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function addMonths(base: Date, months: number): Date {
  const d = new Date(base);
  d.setMonth(d.getMonth() + months);
  return d;
}

function requireAdmin(context: functions.https.CallableContext): void {
  const adminUid = process.env.ADMIN_UID;
  if (!adminUid || context.auth?.uid !== adminUid) {
    throw new functions.https.HttpsError("permission-denied", "Admin only");
  }
}

// 구독 doc 를 Pro/active 로 upsert 한다. 기간(currentPeriodEnd)은 기존 값과
// targetEnd 중 더 나중을 유지 — 멱등: 이미 더 긴 기간이 있으면 절대 줄이지 않는다.
// 베타 선정(1개월)·예외승인(3개월)·인터뷰(6개월) 부여가 전부 이 경로로 수렴한다.
// paymentProvider="founder_grant" 로 표기해 갱신 크론(scheduledChargeSubscriptions,
// paymentProvider=="toss" 만 대상)에서 제외되고, 만료는 scheduledExpireBetaGrants
// 가 처리한다(1회성 부여, 자동 갱신 없음).
async function upsertProSubscription(
  userId: string,
  targetEnd: Date,
  reason: string,
  grantStartedAt: Date,
): Promise<Date> {
  const now = new Date();
  const subRef = db.collection("subscriptions").doc(userId);
  const snap = await subRef.get();
  const data = snap.data();
  const existingEnd =
    data?.currentPeriodEnd && typeof data.currentPeriodEnd.toDate === "function"
      ? data.currentPeriodEnd.toDate()
      : null;
  const periodEnd =
    existingEnd && existingEnd > targetEnd ? existingEnd : targetEnd;

  const payload: Record<string, unknown> = {
    userId,
    planType: "pro",
    status: "active",
    paymentProvider: "founder_grant",
    founderGrant: true,
    founderGrantReason: reason,
    founderGrantStartedAt: admin.firestore.Timestamp.fromDate(grantStartedAt),
    currentPeriodEnd: admin.firestore.Timestamp.fromDate(periodEnd),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (!snap.exists) {
    payload.currentPeriodStart = admin.firestore.Timestamp.fromDate(now);
    payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
  }
  await subRef.set(payload, { merge: true });
  return periodEnd;
}

async function grantFounderProTotalInternal(
  userId: string,
  totalMonths: number,
  reason: string,
  grantStartedAt: Date,
): Promise<Date> {
  return upsertProSubscription(
    userId,
    addMonths(grantStartedAt, totalMonths),
    reason,
    grantStartedAt,
  );
}

// 이메일로 Firebase Auth 계정의 uid 를 찾는다. 미가입/조회 실패는 null(비-throw) —
// 선정(이메일 기준)은 가입 이전에도 일어나므로 uid 부재가 정상 흐름이다.
async function lookupUidByEmail(email: string): Promise<string | null> {
  try {
    const user = await admin.auth().getUserByEmail(email);
    return user.uid;
  } catch {
    return null;
  }
}

// ─── 파운더 접근 안내 이메일 (SendGrid) ──────────────────────────────
//
// 선정된 파운더에게 ①선정 축하 ②베타 다운로드 ③피드백(필수·3일) ④강의 50%
// 쿠폰(FOUNDER50) ⑤디스코드(env 있을 때만) 를 ko/en/ja 로 발송한다.
// 반드시 non-throwing — API 키 미설정/발송 실패 시 console.warn 후 false 반환.
// (이메일 실패로 선정 자체가 깨지면 안 된다.)

type FounderLocale = "ko" | "en" | "ja";

function normalizeFounderLocale(locale: string): FounderLocale {
  if (locale === "en" || locale === "ja") return locale;
  return "ko"; // 알 수 없는 값은 한국어 기본
}

interface FounderEmailContent {
  subject: string;
  html: string;
  text: string;
}

function buildFounderAccessEmail(locale: FounderLocale): FounderEmailContent {
  const downloadUrl = `${SITE_BASE}/${locale}/download`;
  const feedbackUrl = `${SITE_BASE}/${locale}/beta-survey`;
  const coupon = FOUNDER_COURSE_COUPON;
  const hasDiscord = !!DISCORD_INVITE_URL;

  if (locale === "en") {
    const discordHtml = hasDiscord
      ? `<p><a href="${DISCORD_INVITE_URL}" style="color:#4f46e5;font-weight:600">Join the Founders Discord →</a></p>`
      : `<p style="color:#666">A separate Discord invite will follow shortly.</p>`;
    const discordText = hasDiscord
      ? `Join the Founders Discord: ${DISCORD_INVITE_URL}`
      : `A separate Discord invite will follow shortly.`;
    return {
      subject: "🎉 You're a Marblo Founder — Access Details Inside",
      html: founderHtmlShell(`
        <h1 style="font-size:22px;margin:0 0 16px">🎉 Welcome, Founder!</h1>
        <p>You've been selected as one of our founding members. Founders shape Marblo from day one — thank you for joining us.</p>
        <h2 style="font-size:17px;margin:24px 0 8px">1. Get the beta</h2>
        <p>Download Marblo here: <a href="${downloadUrl}" style="color:#4f46e5">${downloadUrl}</a></p>
        <h2 style="font-size:17px;margin:24px 0 8px">2. Survey after your 1-month beta</h2>
        <p>Please submit the beta survey here: <a href="${feedbackUrl}" style="color:#4f46e5">${feedbackUrl}</a><br/>
        Thoughtful survey responses that pass rubric review earn <strong>3 months of Pro free</strong>. A small set of top responses may be invited to a video interview; completing it extends Pro to <strong>6 months total</strong>.</p>
        <h2 style="font-size:17px;margin:24px 0 8px">3. 50% off the course</h2>
        <p>Use coupon code <strong style="font-family:monospace;background:#f1f1f1;padding:2px 6px;border-radius:4px">${coupon}</strong> at checkout for <strong>50% off</strong> the Marblo course — double the 25% early-bird discount.</p>
        <h2 style="font-size:17px;margin:24px 0 8px">4. Community</h2>
        ${discordHtml}
      `),
      text: [
        "Welcome, Founder!",
        "",
        "You've been selected as one of our founding members.",
        "",
        `1. Get the beta: ${downloadUrl}`,
        "",
        `2. Beta survey: ${feedbackUrl}`,
        "   Thoughtful responses that pass rubric review earn 3 months of Pro free.",
        "   Top responses may be invited to a video interview; completion extends Pro to 6 months total.",
        "",
        `3. 50% off the course — coupon code: ${coupon} (double the 25% early-bird discount).`,
        "",
        `4. ${discordText}`,
      ].join("\n"),
    };
  }

  if (locale === "ja") {
    const discordHtml = hasDiscord
      ? `<p><a href="${DISCORD_INVITE_URL}" style="color:#4f46e5;font-weight:600">ファウンダー Discord に参加する →</a></p>`
      : `<p style="color:#666">Discord の招待は追ってご案内します。</p>`;
    const discordText = hasDiscord
      ? `ファウンダー Discord: ${DISCORD_INVITE_URL}`
      : `Discord の招待は追ってご案内します。`;
    return {
      subject: "🎉 Marblo ファウンダーに選ばれました — アクセス案内",
      html: founderHtmlShell(`
        <h1 style="font-size:22px;margin:0 0 16px">🎉 ファウンダー選定おめでとうございます！</h1>
        <p>あなたは Marblo のファウンダーに選ばれました。ファウンダーは初日から Marblo を形づくる存在です。ご参加ありがとうございます。</p>
        <h2 style="font-size:17px;margin:24px 0 8px">1. ベータ版を入手</h2>
        <p>こちらからダウンロード: <a href="${downloadUrl}" style="color:#4f46e5">${downloadUrl}</a></p>
        <h2 style="font-size:17px;margin:24px 0 8px">2. 1ヶ月ベータ後のアンケート</h2>
        <p>ベータアンケートはこちら: <a href="${feedbackUrl}" style="color:#4f46e5">${feedbackUrl}</a><br/>
        ルーブリック審査を通過した丁寧な回答には <strong>Pro 3ヶ月無料</strong> を付与します。上位回答者の一部にはビデオインタビューを依頼し、完了すると Pro を <strong>合計6ヶ月</strong> に延長します。</p>
        <h2 style="font-size:17px;margin:24px 0 8px">3. 講座 50% 割引</h2>
        <p>チェックアウトでクーポンコード <strong style="font-family:monospace;background:#f1f1f1;padding:2px 6px;border-radius:4px">${coupon}</strong> を入力すると講座が <strong>50% OFF</strong> — アーリーバード 25% の2倍です。</p>
        <h2 style="font-size:17px;margin:24px 0 8px">4. コミュニティ</h2>
        ${discordHtml}
      `),
      text: [
        "ファウンダー選定おめでとうございます！",
        "",
        "あなたは Marblo のファウンダーに選ばれました。",
        "",
        `1. ベータ版を入手: ${downloadUrl}`,
        "",
        `2. ベータアンケート: ${feedbackUrl}`,
        "   ルーブリック審査を通過した丁寧な回答には Pro 3ヶ月無料を付与します。",
        "   上位回答者の一部にはビデオインタビューを依頼し、完了すると Pro を合計6ヶ月に延長します。",
        "",
        `3. 講座 50% 割引 — クーポンコード: ${coupon}（アーリーバード 25% の2倍）。`,
        "",
        `4. ${discordText}`,
      ].join("\n"),
    };
  }

  // 기본: 한국어
  const discordHtml = hasDiscord
    ? `<p><a href="${DISCORD_INVITE_URL}" style="color:#4f46e5;font-weight:600">파운더 디스코드 참여하기 →</a></p>`
    : `<p style="color:#666">디스코드 초대는 곧 별도로 안내드리겠습니다.</p>`;
  const discordText = hasDiscord
    ? `파운더 디스코드: ${DISCORD_INVITE_URL}`
    : `디스코드 초대는 곧 별도로 안내드리겠습니다.`;
  return {
    subject: "🎉 마블로 파운더로 선정되셨습니다 — 접근 안내",
    html: founderHtmlShell(`
      <h1 style="font-size:22px;margin:0 0 16px">🎉 파운더로 선정되셨습니다!</h1>
      <p>마블로의 파운더로 선정되신 것을 축하드립니다. 파운더는 첫날부터 마블로를 함께 만들어가는 분들입니다. 함께해 주셔서 감사합니다.</p>
      <h2 style="font-size:17px;margin:24px 0 8px">1. 베타 접근</h2>
      <p>여기에서 마블로를 다운로드하세요: <a href="${downloadUrl}" style="color:#4f46e5">${downloadUrl}</a></p>
      <h2 style="font-size:17px;margin:24px 0 8px">2. 1개월 베타 후 설문</h2>
      <p>베타 설문은 여기에서 제출해 주세요: <a href="${feedbackUrl}" style="color:#4f46e5">${feedbackUrl}</a><br/>
      루브릭 검토를 통과한 성실 응답에는 <strong>Pro 3개월</strong>을 무료로 드립니다. 상위 응답자 일부에게는 화상 인터뷰를 별도로 요청하며, 완료 시 Pro를 <strong>총 6개월</strong>로 연장합니다.</p>
      <h2 style="font-size:17px;margin:24px 0 8px">3. 강의 50% 할인 쿠폰</h2>
      <p>체크아웃에서 쿠폰 코드 <strong style="font-family:monospace;background:#f1f1f1;padding:2px 6px;border-radius:4px">${coupon}</strong> 를 입력하시면 강의가 <strong>50% 할인</strong>됩니다 — 얼리버드 25%의 2배 혜택입니다.</p>
      <h2 style="font-size:17px;margin:24px 0 8px">4. 커뮤니티</h2>
      ${discordHtml}
    `),
    text: [
      "파운더로 선정되셨습니다!",
      "",
      "마블로의 파운더로 선정되신 것을 축하드립니다.",
      "",
      `1. 베타 접근(다운로드): ${downloadUrl}`,
      "",
      `2. 베타 설문: ${feedbackUrl}`,
      "   루브릭 검토를 통과한 성실 응답에는 Pro 3개월을 무료로 드립니다.",
      "   상위 응답자 일부에게는 화상 인터뷰를 별도로 요청하며, 완료 시 Pro를 총 6개월로 연장합니다.",
      "",
      `3. 강의 50% 할인 — 쿠폰 코드: ${coupon} (얼리버드 25%의 2배).`,
      "",
      `4. ${discordText}`,
    ].join("\n"),
  };
}

// 공통 HTML 래퍼 (간단·인라인 스타일).
function founderHtmlShell(inner: string): string {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f6f6f6">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;background:#ffffff">
    ${inner}
    <hr style="border:none;border-top:1px solid #eee;margin:32px 0 16px"/>
    <p style="font-size:12px;color:#999;margin:0">Marblo · support@marblo.app</p>
  </div></body></html>`;
}

/**
 * 파운더 접근 안내 이메일 발송. 반드시 non-throwing.
 * - RESEND_API_KEY 미설정 시 console.warn 후 false 반환(스킵).
 * - 발송 성공 시 true, 그 외 false.
 */
async function sendFounderAccessEmail(
  email: string,
  locale: string,
): Promise<boolean> {
  try {
    if (!RESEND_API_KEY) {
      console.warn("[founder-email] RESEND_API_KEY 미설정 — 발송 스킵:", email);
      return false;
    }
    const content = buildFounderAccessEmail(normalizeFounderLocale(locale));
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${FOUNDER_FROM_NAME} <${FOUNDER_FROM_EMAIL}>`,
        to: [email],
        subject: content.subject,
        html: content.html,
        text: content.text,
      }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.warn(`[founder-email] resend HTTP ${resp.status}: ${body}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[founder-email] 발송 실패:", email, err);
    return false;
  }
}

// waitlist 에서 해당 이메일의 locale 을 조회(없으면 'ko').
async function lookupFounderLocale(email: string): Promise<string> {
  try {
    const snap = await db
      .collection("betatester50_waitlist")
      .where("email", "==", email)
      .limit(1)
      .get();
    if (!snap.empty) {
      const loc = snap.docs[0].data()?.locale;
      if (typeof loc === "string" && loc) return loc;
    }
  } catch (err) {
    console.warn("[founder-email] locale 조회 실패:", email, err);
  }
  return "ko";
}

// 파운더 선정 핵심 로직 (내부) — waitlist 이메일을 founders 로 승격.
// accessGrantedAt 이 1개월 베타 시작 기준. resetWindow=true 면 베타 기간 재시작.
// markFounderSelected onCall 과 Telegram 승인 웹훅 양쪽에서 재사용한다.
async function markFounderSelectedInternal(
  rawEmail: string,
  resetWindow = false,
): Promise<{
  ok: true;
  email: string;
  emailSent: boolean;
  betaExpiresAt: string;
  // 승인=Pro 부여. uid 를 즉시 찾아 구독을 만들었으면 true(subscriptionUid 세팅),
  // 아직 미가입이면 false — 가입 시 grantBetaProOnSignup 이 뒤늦게 부여한다.
  subscriptionGranted: boolean;
  subscriptionUid: string | null;
}> {
  const email = normalizeEmail(rawEmail);
  const ref = db.collection(FOUNDERS_COLLECTION).doc(email);
  const snap = await ref.get();
  const betaStartedAt = new Date();
  let betaExpiresAt = addMonths(betaStartedAt, FOUNDER_BETA_MONTHS);

  const update: Record<string, unknown> = {
    email,
    status: "selected",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (!snap.exists) {
    update.selectedAt = admin.firestore.FieldValue.serverTimestamp();
  }
  if (!snap.exists || !snap.data()?.accessGrantedAt || resetWindow) {
    update.accessGrantedAt = admin.firestore.FieldValue.serverTimestamp();
    update.betaExpiresAt = admin.firestore.Timestamp.fromDate(betaExpiresAt);
  } else {
    const existingBetaExpiresAt = snap.data()?.betaExpiresAt;
    if (
      existingBetaExpiresAt &&
      typeof existingBetaExpiresAt.toDate === "function"
    ) {
      betaExpiresAt = existingBetaExpiresAt.toDate();
    }
  }
  await ref.set(update, { merge: true });

  // 선정 직후 접근 안내 이메일 자동 발송. 이메일 실패가 선정을 깨면 안 되므로
  // sendFounderAccessEmail 은 non-throwing 이고 결과만 기록한다.
  const locale = await lookupFounderLocale(email);
  const emailSent = await sendFounderAccessEmail(email, locale);
  await ref.set(
    {
      accessEmailSent: emailSent,
      accessEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  // 승인 = Pro 부여. 베타 유저가 즉시 Pro 기능을 쓰려면 subscriptions/{uid}
  // (planType=pro, active) doc 이 있어야 한다(앱 subscriptionStore 게이팅). 이메일로
  // 계정을 찾아 구독을 materialize 한다. 아직 미가입(선정→다운로드 예정)이면 uid 가
  // 없으므로 founders/{email}.betaExpiresAt 를 SoT 로 남기고, 가입하는 순간
  // grantBetaProOnSignup(auth onCreate) 이 뒤늦게 부여한다. 멱등: upsertProSubscription
  // 이 기존 기간을 줄이지 않으므로 중복 승인/재선정도 이중부여가 아니다.
  let subscriptionUid: string | null = null;
  const uid = await lookupUidByEmail(email);
  if (uid) {
    await upsertProSubscription(
      uid,
      betaExpiresAt,
      "beta_selected",
      betaStartedAt,
    );
    subscriptionUid = uid;
    await ref.set(
      {
        proSubscriptionUid: uid,
        proSubscriptionEnd: admin.firestore.Timestamp.fromDate(betaExpiresAt),
        proSubscriptionGrantedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  return {
    ok: true,
    email,
    emailSent,
    betaExpiresAt: betaExpiresAt.toISOString(),
    subscriptionGranted: subscriptionUid !== null,
    subscriptionUid,
  };
}

// 파운더 선정 (관리자용) — waitlist 이메일을 founders 로 승격.
export const markFounderSelected = functions.https.onCall(
  async (data, context) => {
    requireAdmin(context);
    const email =
      typeof data?.email === "string" ? normalizeEmail(data.email) : "";
    if (!email) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "email required",
      );
    }
    const resetWindow = data?.resetWindow === true;
    return markFounderSelectedInternal(email, resetWindow);
  },
);

// 파운더 접근 안내 이메일 재발송 (관리자용) — /admin 에서 수동 재발송용.
export const resendFounderAccessEmail = functions.https.onCall(
  async (data, context) => {
    requireAdmin(context);
    const email =
      typeof data?.email === "string" ? normalizeEmail(data.email) : "";
    if (!email) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "email required",
      );
    }
    const locale = await lookupFounderLocale(email);
    const emailSent = await sendFounderAccessEmail(email, locale);
    await db.collection(FOUNDERS_COLLECTION).doc(email).set(
      {
        accessEmailSent: emailSent,
        accessEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { ok: true, emailSent };
  },
);

// ─── 신청 접수 확인 이메일 (Resend) ──────────────────────────────────
//
// /founders 신청 시 클라가 betatester50_waitlist 에 직접 doc 을 쓴다.
// 신청자는 그 즉시 아무 메일도 못 받고, 접근 안내는 어드민이 '선정'할 때만
// 발송된다. 그 공백을 메우기 위해 doc 생성 시 "접수됐습니다, 선정 시
// 안내드릴게요" 확인 메일을 자동 발송한다.
// 메일 본문/발송/스킵 정책은 위 파운더 접근 안내 이메일과 동일하게 재사용한다.

function buildApplyConfirmEmail(locale: FounderLocale): FounderEmailContent {
  if (locale === "en") {
    return {
      subject: "🙌 Your Marblo Founder beta application is in",
      html: founderHtmlShell(`
        <h1 style="font-size:22px;margin:0 0 16px">🙌 We got your application!</h1>
        <p>Thanks for applying to the Marblo Founder beta. Your application has been received — there's nothing more you need to do right now.</p>
        <p>We review applications on a rolling basis. <strong>If you're selected, we'll email you</strong> the download and onboarding details at this address, so keep an eye on your inbox.</p>
        <p style="color:#666">Excited to build Marblo with founders like you. See you on the inside soon.</p>
      `),
      text: [
        "We got your application!",
        "",
        "Thanks for applying to the Marblo Founder beta. Your application has been received — nothing more to do right now.",
        "",
        "We review applications on a rolling basis. If you're selected, we'll email you the download and onboarding details at this address.",
        "",
        "Excited to build Marblo with founders like you.",
      ].join("\n"),
    };
  }

  if (locale === "ja") {
    return {
      subject: "🙌 Marblo ファウンダーベータのお申し込みを受け付けました",
      html: founderHtmlShell(`
        <h1 style="font-size:22px;margin:0 0 16px">🙌 お申し込みを受け付けました！</h1>
        <p>Marblo ファウンダーベータにお申し込みいただきありがとうございます。お申し込みは受理されました。いまの時点で追加の操作は必要ありません。</p>
        <p>お申し込みは順次審査しております。<strong>選ばれた場合は、このアドレス宛にメールで</strong>ダウンロードとオンボーディングのご案内をお送りしますので、受信トレイをご確認ください。</p>
        <p style="color:#666">あなたのようなファウンダーと一緒に Marblo をつくれることを楽しみにしています。</p>
      `),
      text: [
        "お申し込みを受け付けました！",
        "",
        "Marblo ファウンダーベータにお申し込みいただきありがとうございます。お申し込みは受理されました。いまの時点で追加の操作は必要ありません。",
        "",
        "お申し込みは順次審査しております。選ばれた場合は、このアドレス宛にダウンロードとオンボーディングのご案内をメールでお送りします。",
        "",
        "あなたのようなファウンダーと一緒に Marblo をつくれることを楽しみにしています。",
      ].join("\n"),
    };
  }

  // 기본: 한국어
  return {
    subject: "🙌 마블로 파운더 베타 신청이 접수됐어요",
    html: founderHtmlShell(`
      <h1 style="font-size:22px;margin:0 0 16px">🙌 신청이 접수됐어요!</h1>
      <p>마블로 파운더 베타에 신청해 주셔서 감사합니다. 신청이 정상적으로 접수되었으며, 지금은 따로 하실 일이 없습니다.</p>
      <p>신청은 순차적으로 검토하고 있어요. <strong>선정되시면 이 주소로 이메일을 보내</strong> 다운로드와 시작 안내를 드릴 테니, 받은편지함을 확인해 주세요.</p>
      <p style="color:#666">여러분 같은 파운더와 함께 마블로를 만들어갈 수 있어 기대돼요. 곧 안에서 뵙겠습니다.</p>
    `),
    text: [
      "신청이 접수됐어요!",
      "",
      "마블로 파운더 베타에 신청해 주셔서 감사합니다. 신청이 정상적으로 접수되었으며, 지금은 따로 하실 일이 없습니다.",
      "",
      "신청은 순차적으로 검토하고 있어요. 선정되시면 이 주소로 이메일을 보내 다운로드와 시작 안내를 드립니다.",
      "",
      "여러분 같은 파운더와 함께 마블로를 만들어갈 수 있어 기대돼요. 곧 안에서 뵙겠습니다.",
    ].join("\n"),
  };
}

/**
 * 신청 접수 확인 이메일 발송. 반드시 non-throwing (sendFounderAccessEmail 과 동일 정책).
 * - RESEND_API_KEY 미설정 시 console.warn 후 false 반환(스킵).
 * - 발송 성공 시 true, 그 외 false.
 */
async function sendApplyConfirmEmail(
  email: string,
  locale: string,
): Promise<boolean> {
  try {
    if (!RESEND_API_KEY) {
      console.warn(
        "[apply-confirm-email] RESEND_API_KEY 미설정 — 발송 스킵:",
        email,
      );
      return false;
    }
    const content = buildApplyConfirmEmail(normalizeFounderLocale(locale));
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${FOUNDER_FROM_NAME} <${FOUNDER_FROM_EMAIL}>`,
        to: [email],
        subject: content.subject,
        html: content.html,
        text: content.text,
      }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.warn(`[apply-confirm-email] resend HTTP ${resp.status}: ${body}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[apply-confirm-email] 발송 실패:", email, err);
    return false;
  }
}

// 신청 접수 확인 이메일 트리거 — waitlist doc 생성 시 1회 발송.
// betatester50_waitlist 는 클라가 직접 쓰므로 콜러블이 아닌 onCreate 가 정석.
// 트리거 재시도 폭주를 막기 위해 절대 throw 하지 않는다(에러는 삼키고 종료).
export const sendApplyConfirmOnWaitlist = functions.firestore
  .document("betatester50_waitlist/{docId}")
  .onCreate(async (snap) => {
    try {
      const data = snap.data() || {};
      const rawEmail = typeof data.email === "string" ? data.email : "";
      const email = normalizeEmail(rawEmail);
      if (!email) {
        console.warn("[apply-confirm-email] email 없음 — 발송 스킵:", snap.id);
        return;
      }
      const locale = typeof data.locale === "string" ? data.locale : "ko";
      const emailSent = await sendApplyConfirmEmail(email, locale);
      // 발송 흔적 기록(추적용). non-throwing — 기록 실패가 트리거를 깨면 안 된다.
      await snap.ref
        .set(
          {
            confirmEmailSent: emailSent,
            confirmEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
        .catch((err) =>
          console.warn(
            "[apply-confirm-email] 발송 흔적 기록 실패:",
            snap.id,
            err,
          ),
        );
    } catch (err) {
      // 트리거 재시도 폭주 방지 — 모든 에러를 삼킨다.
      console.warn("[apply-confirm-email] 트리거 처리 실패:", snap.id, err);
    }
  });

// ═══════════════════════════════════════════════════════════════════
// Project-count plan enforcement (서버측 방어)
// ═══════════════════════════════════════════════════════════════════
// 클라이언트 게이팅(projectStore.createProject / FileTree)을 직접 Firestore
// write 로 우회하는 것을 서버에서 되돌린다. Free 플랜 소유자가 한도(1개)를 넘겨
// 프로젝트를 만들면 초과분(가장 최근 것)을 삭제한다. 유료 플랜은 무제한이라
// 손대지 않는다. 트리거 재시도 폭주 방지를 위해 절대 throw 하지 않는다.
//
// 값은 src/lib/planLimits.ts(PLAN_LIMITS.maxProjects)와 정합을 맞춘다.
// (functions 는 렌더러 src 를 import 하지 않으므로 여기서 상수를 재선언한다 —
//  drift 시 두 곳을 함께 갱신할 것.)
const PROJECT_LIMIT_BY_PLAN: Record<string, number> = {
  free: 1,
  // pro / team / team_plus / enterprise = 무제한 (미정의 → 아래에서 skip)
};

function millisOf(v: unknown): number {
  // Firestore Timestamp | Date | number 를 모두 ms 로. 값 없으면 0(=가장 오래된
  // 것으로 취급 → 정당한 첫 프로젝트를 우선 보존).
  if (!v) return 0;
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  const ts = v as { toMillis?: () => number; seconds?: number };
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.seconds === "number") return ts.seconds * 1000;
  return 0;
}

export const enforceProjectLimit = functions.firestore
  .document("projects/{projectId}")
  .onCreate(async (snap) => {
    try {
      const data = snap.data() || {};
      const ownerId = typeof data.ownerId === "string" ? data.ownerId : "";
      if (!ownerId) return;

      // 소유자 플랜 조회. subscriptions/{uid} 가 status=active 일 때만 유료로 인정
      // (렌더러 getPlan() 과 동일 규칙).
      const subSnap = await db.collection("subscriptions").doc(ownerId).get();
      const sub = subSnap.exists ? subSnap.data() || {} : {};
      const plan =
        sub.status === "active" && typeof sub.planType === "string"
          ? (sub.planType as string)
          : "free";

      const limit = PROJECT_LIMIT_BY_PLAN[plan];
      if (limit === undefined) return; // 무제한 플랜 → 방어 불필요

      // 이 소유자의 모든 프로젝트를 createdAt 오름차순으로 정렬해, 앞의 `limit`
      // 개만 유효로 본다. 방금 생성된 이 문서가 초과분이면 삭제한다. (오래된 것을
      // 보존하므로 동시 생성/우회 시도에도 정당한 프로젝트가 살아남는다.)
      const owned = await db
        .collection("projects")
        .where("ownerId", "==", ownerId)
        .get();
      if (owned.size <= limit) return; // 한도 이내

      const sorted = owned.docs.slice().sort((a, b) => {
        const am = millisOf(a.get("createdAt"));
        const bm = millisOf(b.get("createdAt"));
        if (am !== bm) return am - bm;
        // createdAt 동률이면 문서 id 로 안정 정렬.
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });
      const allowedIds = new Set(sorted.slice(0, limit).map((d) => d.id));
      if (allowedIds.has(snap.id)) return; // 이 문서는 유효 범위 내

      await snap.ref.delete();
      console.warn(
        `[enforceProjectLimit] ${plan} 한도(${limit}) 초과 프로젝트 삭제: ` +
          `owner=${ownerId} project=${snap.id} (owned=${owned.size})`,
      );
    } catch (err) {
      // 트리거 재시도 폭주 방지 — 모든 에러를 삼킨다.
      console.warn("[enforceProjectLimit] 처리 실패:", snap.id, err);
    }
  });

function parseFounderSurveyAnswers(raw: unknown): FounderSurveyAnswers {
  if (!raw || typeof raw !== "object") {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "설문 답변이 필요합니다.",
    );
  }
  const answers = raw as Record<string, unknown>;
  const str = (v: unknown): string =>
    typeof v === "string" ? v.trim().slice(0, FOUNDER_FIELD_MAX) : "";
  const parsed: FounderSurveyAnswers = {
    q1: str(answers.q1),
    q2: str(answers.q2),
    q3: str(answers.q3),
    q4: str(answers.q4),
    q5: str(answers.q5),
    q6: str(answers.q6),
    q7: str(answers.q7),
  };
  const missing = Object.entries(parsed)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      `필수 7문항을 모두 입력해 주세요. 누락: ${missing.join(", ")}`,
    );
  }
  return parsed;
}

function parseFounderRubricScore(raw: unknown): FounderRubricScore {
  if (!raw || typeof raw !== "object") {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "rubricScore is required",
    );
  }
  const input = raw as Record<string, unknown>;
  const dimension = (key: keyof Omit<FounderRubricScore, "total">): number => {
    const value = input[key];
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 0 ||
      value > 3
    ) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        `${key} must be an integer from 0 to 3`,
      );
    }
    return value;
  };
  const specificity = dimension("specificity");
  const usageEvidence = dimension("usageEvidence");
  const insightQuality = dimension("insightQuality");
  const actionability = dimension("actionability");
  const icpFit = dimension("icpFit");
  const total =
    specificity * 2 +
    usageEvidence * 2 +
    insightQuality +
    actionability +
    icpFit;

  const suppliedTotal = input.total;
  if (
    suppliedTotal !== undefined &&
    (!Number.isInteger(suppliedTotal) || suppliedTotal !== total)
  ) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      `rubricScore.total must equal ${total}`,
    );
  }

  return {
    total,
    specificity,
    usageEvidence,
    insightQuality,
    actionability,
    icpFit,
  };
}

async function getFounderFeedbackBySelector(
  selector: unknown,
): Promise<admin.firestore.DocumentSnapshot | null> {
  if (!selector || typeof selector !== "object") return null;
  const data = selector as Record<string, unknown>;
  if (typeof data.feedbackId === "string" && data.feedbackId.trim()) {
    const snap = await db
      .collection(FOUNDER_FEEDBACK_COLLECTION)
      .doc(data.feedbackId.trim())
      .get();
    return snap.exists ? snap : null;
  }
  const email =
    typeof data.email === "string" ? normalizeEmail(data.email) : "";
  if (!email) return null;
  const snap = await db
    .collection(FOUNDER_FEEDBACK_COLLECTION)
    .where("email", "==", email)
    .get();
  if (snap.empty) return null;
  const toMillis = (x: unknown): number =>
    x && typeof (x as { toMillis?: unknown }).toMillis === "function"
      ? (x as { toMillis: () => number }).toMillis()
      : 0;
  return snap.docs.reduce((a, b) =>
    toMillis(b.data().createdAt) > toMillis(a.data().createdAt) ? b : a,
  );
}

// 구조화 설문 제출 (파운더 본인) — 검증 후 7문항 저장. 보상은 운영자 채점 후 확정.
export const submitFounderFeedback = functions.https.onCall(
  async (data, context) => {
    const uid = context.auth?.uid;
    const token = context.auth?.token;
    if (!uid || !token?.email) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "로그인이 필요합니다.",
      );
    }
    // 무료 Pro 부여 경계 — 이메일 소유권 위조 방지를 위해 인증된 이메일만 허용.
    if (token.email_verified !== true) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "이메일 인증이 완료된 계정만 제출할 수 있습니다.",
      );
    }
    const email = normalizeEmail(token.email);
    const answers = parseFounderSurveyAnswers(data?.answers);
    const fRef = db.collection(FOUNDERS_COLLECTION).doc(email);
    let betaExpiresAt: admin.firestore.Timestamp | null = null;

    // 트랜잭션으로 선정·윈도우·중복제출 검증 + 제출 마킹을 원자적으로 처리
    // (중복 클릭에 의한 중복 설문 방지).
    await db.runTransaction(async (tx) => {
      const s = await tx.get(fRef);
      if (!s.exists || s.data()?.status === "rejected") {
        throw new functions.https.HttpsError(
          "permission-denied",
          "선정된 파운더가 아닙니다. 선정 안내 이메일의 계정으로 로그인했는지 확인해 주세요.",
        );
      }
      const fd = s.data()!;
      if (fd.feedbackSubmittedAt) {
        throw new functions.https.HttpsError(
          "already-exists",
          "이미 설문을 제출하셨습니다.",
        );
      }
      const granted =
        fd.accessGrantedAt && typeof fd.accessGrantedAt.toDate === "function"
          ? fd.accessGrantedAt.toDate()
          : null;
      if (!granted) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "접근 권한이 아직 부여되지 않았습니다.",
        );
      }
      betaExpiresAt =
        fd.betaExpiresAt && typeof fd.betaExpiresAt.toDate === "function"
          ? fd.betaExpiresAt
          : admin.firestore.Timestamp.fromDate(
              addMonths(granted, FOUNDER_BETA_MONTHS),
            );
      tx.set(
        fRef,
        {
          userId: uid,
          status: "feedback_submitted",
          feedbackSubmittedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });

    const fbRef = await db.collection(FOUNDER_FEEDBACK_COLLECTION).add({
      email,
      userId: uid,
      locale: normalizeFounderLocale(
        typeof data?.locale === "string" ? data.locale : "ko",
      ),
      answers,
      rubricScore: null,
      reviewedBy: null,
      reviewedAt: null,
      proGrantedMonths: 0,
      interviewRequested: false,
      interviewRequestedAt: null,
      interviewCompleted: false,
      interviewCompletedAt: null,
      betaExpiresAt,
      proExpiresAt: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await fRef.set(
      {
        feedbackId: fbRef.id,
        betaExpiresAt,
        proGrantedMonths: 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return {
      ok: true,
      feedbackId: fbRef.id,
      status: "pending_review",
      betaExpiresAt: betaExpiresAt
        ? (betaExpiresAt as admin.firestore.Timestamp).toDate().toISOString()
        : null,
    };
  },
);

// 내 파운더 선정 상태(본인 조회) — founders 컬렉션은 클라 직접 read 차단이라
// /download 소프트 게이트가 "이 사용자가 선정됐는지"를 확인할 경로가 필요하다.
// 인증된 본인 이메일로 founders/{normalizedEmail} 만 조회한다(타인 조회 불가).
export const getMyFounderAccess = functions.https.onCall(
  async (_data, context) => {
    const uid = context.auth?.uid;
    const token = context.auth?.token;
    if (!uid || !token?.email) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "로그인이 필요합니다.",
      );
    }
    const email = normalizeEmail(token.email);
    const snap = await db.collection(FOUNDERS_COLLECTION).doc(email).get();
    const fd = snap.exists ? snap.data() : null;
    // 선정 = accessGrantedAt 존재 + rejected 아님 (submitFounderFeedback 과 동일 기준).
    const accessGrantedAt =
      fd && fd.status !== "rejected" ? tsToIso(fd.accessGrantedAt) : null;
    const betaExpiresAt =
      fd && fd.status !== "rejected" ? tsToIso(fd.betaExpiresAt) : null;
    return { hasAccess: !!accessGrantedAt, accessGrantedAt, betaExpiresAt };
  },
);

// 루브릭 채점 및 Pro 3개월 지급 확정 (관리자용).
export const reviewFounderFeedback = functions.https.onCall(
  async (data, context) => {
    requireAdmin(context);
    const feedbackSnap = await getFounderFeedbackBySelector(data);
    if (!feedbackSnap?.exists) {
      throw new functions.https.HttpsError("not-found", "feedback not found");
    }
    const feedback = feedbackSnap.data() as Record<string, unknown>;
    const userId = typeof feedback.userId === "string" ? feedback.userId : "";
    const email =
      typeof feedback.email === "string" ? normalizeEmail(feedback.email) : "";
    if (!userId || !email) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "feedback is missing userId or email",
      );
    }

    const rubricScore = parseFounderRubricScore(data?.rubricScore);
    const grantPro =
      rubricScore.total >= FOUNDER_PRO_RUBRIC_MIN_TOTAL ||
      data?.overrideGrantPro === true;
    const existingGranted =
      typeof feedback.proGrantedMonths === "number"
        ? feedback.proGrantedMonths
        : 0;
    const grantStartedAt =
      feedback.createdAt &&
      typeof (feedback.createdAt as { toDate?: unknown }).toDate === "function"
        ? (feedback.createdAt as { toDate: () => Date }).toDate()
        : new Date();

    let proExpiresAt: Date | null = null;
    if (grantPro && existingGranted < FOUNDER_PRO_MONTHS) {
      proExpiresAt = await grantFounderProTotalInternal(
        userId,
        FOUNDER_PRO_MONTHS,
        "founder_survey_rubric",
        grantStartedAt,
      );
    } else {
      proExpiresAt =
        feedback.proExpiresAt &&
        typeof (feedback.proExpiresAt as { toDate?: unknown }).toDate ===
          "function"
          ? (feedback.proExpiresAt as { toDate: () => Date }).toDate()
          : null;
    }

    const update: Record<string, unknown> = {
      rubricScore,
      reviewedBy: context.auth?.uid ?? null,
      reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (grantPro) {
      update.proGrantedMonths = Math.max(existingGranted, FOUNDER_PRO_MONTHS);
      update.proExpiresAt = proExpiresAt
        ? admin.firestore.Timestamp.fromDate(proExpiresAt)
        : null;
    }
    await feedbackSnap.ref.set(update, { merge: true });

    await db
      .collection(FOUNDERS_COLLECTION)
      .doc(email)
      .set(
        {
          status: grantPro ? "pro_granted" : "survey_reviewed",
          rubricScore,
          feedbackId: feedbackSnap.id,
          proGrantedMonths: grantPro
            ? Math.max(existingGranted, FOUNDER_PRO_MONTHS)
            : existingGranted,
          proExpiresAt: proExpiresAt
            ? admin.firestore.Timestamp.fromDate(proExpiresAt)
            : null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

    return {
      ok: true,
      feedbackId: feedbackSnap.id,
      grantPro,
      proMonths: grantPro
        ? Math.max(existingGranted, FOUNDER_PRO_MONTHS)
        : existingGranted,
      proExpiresAt: proExpiresAt?.toISOString() ?? null,
    };
  },
);

// 루브릭 상위 응답자 조회 (관리자용). 복합 인덱스 부담을 줄이기 위해 점수 필터는
// 메모리에서 적용하되, 운영용 표본 한도만 둔다.
export const listTopFounderFeedback = functions.https.onCall(
  async (data, context) => {
    requireAdmin(context);
    const limit =
      typeof data?.limit === "number" && Number.isInteger(data.limit)
        ? Math.min(Math.max(data.limit, 1), 100)
        : 10;
    const minScore =
      typeof data?.minScore === "number"
        ? data.minScore
        : FOUNDER_INTERVIEW_MIN_TOTAL;
    const snap = await db
      .collection(FOUNDER_FEEDBACK_COLLECTION)
      .limit(1000)
      .get();
    const items = snap.docs
      .map((doc) => {
        const v = doc.data() as Record<string, unknown>;
        const score = v.rubricScore as Record<string, unknown> | undefined;
        return {
          id: doc.id,
          userId: typeof v.userId === "string" ? v.userId : "",
          email: typeof v.email === "string" ? v.email : "",
          locale: typeof v.locale === "string" ? v.locale : null,
          rubricScore: score ?? null,
          total:
            score && typeof score.total === "number"
              ? score.total
              : Number.NEGATIVE_INFINITY,
          usageEvidence:
            score && typeof score.usageEvidence === "number"
              ? score.usageEvidence
              : 0,
          actionability:
            score && typeof score.actionability === "number"
              ? score.actionability
              : 0,
          icpFit: score && typeof score.icpFit === "number" ? score.icpFit : 0,
          interviewRequested: v.interviewRequested === true,
          interviewCompleted: v.interviewCompleted === true,
          createdAt: tsToIso(v.createdAt),
          reviewedAt: tsToIso(v.reviewedAt),
        };
      })
      .filter((item) => item.total >= minScore)
      .sort((a, b) => {
        if (b.total !== a.total) return b.total - a.total;
        if (b.icpFit !== a.icpFit) return b.icpFit - a.icpFit;
        if (b.usageEvidence !== a.usageEvidence) {
          return b.usageEvidence - a.usageEvidence;
        }
        return b.actionability - a.actionability;
      })
      .slice(0, limit);
    return { items };
  },
);

// 인터뷰 요청 마킹 (관리자용). 점수만으로 자동 선정하지 않고 운영자 명시 호출만 허용.
export const requestFounderInterview = functions.https.onCall(
  async (data, context) => {
    requireAdmin(context);
    const feedbackSnap = await getFounderFeedbackBySelector(data);
    if (!feedbackSnap?.exists) {
      throw new functions.https.HttpsError("not-found", "feedback not found");
    }
    const feedback = feedbackSnap.data() as Record<string, unknown>;
    const email =
      typeof feedback.email === "string" ? normalizeEmail(feedback.email) : "";
    if (!email) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "feedback is missing email",
      );
    }
    await feedbackSnap.ref.set(
      {
        interviewRequested: true,
        interviewRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await db.collection(FOUNDERS_COLLECTION).doc(email).set(
      {
        status: "interview_requested",
        interviewRequested: true,
        interviewRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { ok: true, feedbackId: feedbackSnap.id };
  },
);

// 인터뷰 완료 마킹 (관리자용) — 요청받은 사용자의 Pro를 총 6개월로 연장.
// 피드백 제출로 계정이 연결(userId)된 파운더만 대상.
export const markFounderInterviewed = functions.https.onCall(
  async (data, context) => {
    requireAdmin(context);
    const feedbackSnap = await getFounderFeedbackBySelector(data);
    if (!feedbackSnap?.exists) {
      throw new functions.https.HttpsError("not-found", "feedback not found");
    }
    const feedback = feedbackSnap.data() as Record<string, unknown>;
    const email =
      typeof feedback.email === "string" ? normalizeEmail(feedback.email) : "";
    if (!email) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "feedback is missing email",
      );
    }
    const fRef = db.collection(FOUNDERS_COLLECTION).doc(email);
    const fSnap = await fRef.get();
    if (!fSnap.exists) {
      throw new functions.https.HttpsError("not-found", "founder not found");
    }
    const f = fSnap.data()!;
    const uid =
      typeof feedback.userId === "string"
        ? feedback.userId
        : typeof f.userId === "string"
          ? f.userId
          : "";
    if (!uid) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "설문 제출 전이라 계정이 연결되지 않았습니다. 설문 제출 후 진행하세요.",
      );
    }
    if (feedback.interviewCompleted === true || f.interviewCompleted === true) {
      throw new functions.https.HttpsError(
        "already-exists",
        "이미 인터뷰 보상이 적용되었습니다.",
      );
    }
    if (feedback.interviewRequested !== true && f.interviewRequested !== true) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "인터뷰 요청 대상자만 완료 처리할 수 있습니다.",
      );
    }
    const grantStartedAt =
      feedback.createdAt &&
      typeof (feedback.createdAt as { toDate?: unknown }).toDate === "function"
        ? (feedback.createdAt as { toDate: () => Date }).toDate()
        : new Date();
    const periodEnd = await grantFounderProTotalInternal(
      uid,
      FOUNDER_INTERVIEW_TOTAL_PRO_MONTHS,
      "founder_interview",
      grantStartedAt,
    );
    await feedbackSnap.ref.set(
      {
        interviewCompleted: true,
        interviewCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
        proGrantedMonths: FOUNDER_INTERVIEW_TOTAL_PRO_MONTHS,
        proExpiresAt: admin.firestore.Timestamp.fromDate(periodEnd),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await fRef.set(
      {
        status: "interviewed",
        interviewCompleted: true,
        interviewCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
        interviewedAt: admin.firestore.FieldValue.serverTimestamp(),
        proGrantedMonths: FOUNDER_INTERVIEW_TOTAL_PRO_MONTHS,
        proExpiresAt: admin.firestore.Timestamp.fromDate(periodEnd),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return {
      ok: true,
      proMonths: FOUNDER_INTERVIEW_TOTAL_PRO_MONTHS,
      currentPeriodEnd: periodEnd.toISOString(),
    };
  },
);

// Timestamp → ISO 문자열(없거나 형식이 아니면 null). 어드민 read 함수 공용.
function tsToIso(v: unknown): string | null {
  if (v && typeof (v as { toDate?: unknown }).toDate === "function") {
    try {
      return (v as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

// 좌석 카운터(공개) — 홈 BetaTester50 섹션이 클라 getCountFromServer 대신 호출.
// admin SDK aggregate count 로 이메일 노출 없이 신청 수만 반환.
export const getWaitlistCount = functions.https.onCall(async () => {
  const snap = await db.collection("betatester50_waitlist").count().get();
  return { count: snap.data().count };
});

// 신청 목록(어드민) — betatester50_waitlist 직접 클라 조회 차단 대체.
export const getFounderWaitlist = functions.https.onCall(
  async (_data, context) => {
    requireAdmin(context);
    const snap = await db
      .collection("betatester50_waitlist")
      .orderBy("createdAt", "desc")
      .limit(1000)
      .get();
    const items = snap.docs.map((d) => {
      const v = d.data() as Record<string, unknown>;
      return {
        id: d.id,
        email: typeof v.email === "string" ? v.email : "",
        locale: typeof v.locale === "string" ? v.locale : null,
        source: typeof v.source === "string" ? v.source : null,
        createdAt: tsToIso(v.createdAt),
      };
    });
    return { items };
  },
);

// 파운더 현황(어드민) — founders 컬렉션 전체 요약. 상태·시각·Pro개월 등.
export const listFounders = functions.https.onCall(async (_data, context) => {
  requireAdmin(context);
  const snap = await db.collection(FOUNDERS_COLLECTION).limit(1000).get();
  const items = snap.docs.map((d) => {
    const v = d.data() as Record<string, unknown>;
    const feedbackId = typeof v.feedbackId === "string" ? v.feedbackId : null;
    const score = v.rubricScore as Record<string, unknown> | undefined;
    return {
      email: typeof v.email === "string" ? v.email : d.id,
      status: typeof v.status === "string" ? v.status : null,
      accessGrantedAt: tsToIso(v.accessGrantedAt),
      betaExpiresAt: tsToIso(v.betaExpiresAt),
      feedbackSubmittedAt: tsToIso(v.feedbackSubmittedAt),
      rubricScore: score ?? null,
      interviewRequested: v.interviewRequested === true,
      interviewRequestedAt: tsToIso(v.interviewRequestedAt),
      interviewCompleted: v.interviewCompleted === true,
      interviewCompletedAt: tsToIso(v.interviewCompletedAt),
      proExpiresAt: tsToIso(v.proExpiresAt),
      proGrantedMonths:
        typeof v.proGrantedMonths === "number" ? v.proGrantedMonths : 0,
      feedbackId,
      hasFeedback: !!feedbackId,
    };
  });
  return { items };
});

// 이메일별 7문항 설문 열람(어드민) — founder_feedback 최신 1건.
export const getFounderFeedbackByEmail = functions.https.onCall(
  async (data, context) => {
    requireAdmin(context);
    const email =
      typeof data?.email === "string" ? normalizeEmail(data.email) : "";
    if (!email) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "email required",
      );
    }
    // orderBy 제거 — (email + createdAt) 복합 인덱스 없이 동작하도록 클라이언트 정렬.
    // 선례: src/services/chatService.ts subscribeToMessages. createdAt 은 Firestore
    // Timestamp 이거나 undefined 일 수 있어 toMillis 가드로 안전 비교 후 최신 1건 선택.
    const snap = await db
      .collection(FOUNDER_FEEDBACK_COLLECTION)
      .where("email", "==", email)
      .get();
    if (snap.empty) {
      return { feedback: null };
    }
    const toMillis = (x: unknown): number =>
      x && typeof (x as { toMillis?: unknown }).toMillis === "function"
        ? (x as { toMillis: () => number }).toMillis()
        : 0;
    const latest = snap.docs.reduce((a, b) =>
      toMillis(b.data().createdAt) > toMillis(a.data().createdAt) ? b : a,
    );
    const v = latest.data() as Record<string, unknown>;
    const a = (v.answers as Record<string, unknown>) || {};
    const str = (x: unknown): string => (typeof x === "string" ? x : "");
    return {
      feedback: {
        id: latest.id,
        userId: typeof v.userId === "string" ? v.userId : null,
        email: typeof v.email === "string" ? v.email : null,
        locale: typeof v.locale === "string" ? v.locale : null,
        answers: {
          q1: str(a.q1),
          q2: str(a.q2),
          q3: str(a.q3),
          q4: str(a.q4),
          q5: str(a.q5),
          q6: str(a.q6),
          q7: str(a.q7),
        },
        rubricScore: v.rubricScore ?? null,
        reviewedBy: typeof v.reviewedBy === "string" ? v.reviewedBy : null,
        reviewedAt: tsToIso(v.reviewedAt),
        proGrantedMonths:
          typeof v.proGrantedMonths === "number" ? v.proGrantedMonths : 0,
        betaExpiresAt: tsToIso(v.betaExpiresAt),
        proExpiresAt: tsToIso(v.proExpiresAt),
        interviewRequested: v.interviewRequested === true,
        interviewRequestedAt: tsToIso(v.interviewRequestedAt),
        interviewCompleted: v.interviewCompleted === true,
        interviewCompletedAt: tsToIso(v.interviewCompletedAt),
        createdAt: tsToIso(v.createdAt),
      },
    };
  },
);

// ─── In-app Bug Reports (사용자 버그 신고) ─────────────────────
// 데스크톱 앱 'Report a bug' → submitBugReport(): 로그인 사용자가 자유 서술 +
// 자동수집 컨텍스트(앱버전/플랫폼/라우트/에이전트 스냅샷)를 제출한다. founder
// feedback 과 달리 1인 1회 제한이 없고(여러 건 허용) 가벼운 rate-guard 만 둔다.
// 서버에서 uid/email/createdAt 을 각인하고 bugReports/ 에 기록.
const BUG_REPORT_DESC_MAX = 5000;
const BUG_REPORT_CTX_FIELD_MAX = 10000;
const BUG_REPORT_MIN_INTERVAL_MS = 5000; // 연타 방지
const BUG_REPORT_DAILY_MAX = 30; // 유저당 하루 상한
const BUG_REPORT_STATUSES = ["new", "triaged", "resolved"] as const;

export const submitBugReport = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "로그인이 필요합니다.",
    );
  }
  // 이메일은 서버가 토큰에서 각인(클라 입력 불신). 인증 이메일 없으면 null.
  const email =
    typeof context.auth?.token?.email === "string"
      ? normalizeEmail(context.auth.token.email)
      : null;

  const description =
    typeof data?.description === "string"
      ? data.description.trim().slice(0, BUG_REPORT_DESC_MAX)
      : "";
  if (!description) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "버그 설명을 입력해 주세요.",
    );
  }

  const str = (v: unknown, max: number): string =>
    typeof v === "string" ? v.trim().slice(0, max) : "";
  const appVersion = str(data?.appVersion, 100);
  const platform = str(data?.platform, 100);

  const ctxIn = (
    data?.context && typeof data.context === "object" ? data.context : {}
  ) as Record<string, unknown>;
  // recentLogs / agentSnapshot 은 자동수집 로그라 토큰·API 키가 섞일 수 있다.
  // 저장 직전 시크릿 패턴을 레닥션한다(베스트-에포트). route 는 앱 내부 경로라 제외.
  const reportContext = {
    recentLogs: redactSecrets(str(ctxIn.recentLogs, BUG_REPORT_CTX_FIELD_MAX)),
    route: str(ctxIn.route, 500),
    agentSnapshot: redactSecrets(
      str(ctxIn.agentSnapshot, BUG_REPORT_CTX_FIELD_MAX),
    ),
  };

  // 가벼운 rate-guard — 연타/스팸 방지. 전용 throttle 문서를 트랜잭션으로 갱신해
  // (uid+createdAt 복합 인덱스 없이) 최근 제출 간격과 일일 카운트를 강제한다.
  const throttleRef = db.collection("bugReportThrottle").doc(uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(throttleRef);
    const now = Date.now();
    const d = snap.exists ? snap.data()! : {};
    const lastAt = typeof d.lastAtMs === "number" ? d.lastAtMs : 0;
    if (now - lastAt < BUG_REPORT_MIN_INTERVAL_MS) {
      throw new functions.https.HttpsError(
        "resource-exhausted",
        "잠시 후 다시 시도해 주세요.",
      );
    }
    const dayStart = typeof d.dayStartMs === "number" ? d.dayStartMs : 0;
    const dayRolledOver = now - dayStart > 24 * 60 * 60 * 1000;
    const dayCount = dayRolledOver
      ? 0
      : typeof d.dayCount === "number"
        ? d.dayCount
        : 0;
    if (dayCount >= BUG_REPORT_DAILY_MAX) {
      throw new functions.https.HttpsError(
        "resource-exhausted",
        "하루 제출 한도를 초과했습니다. 내일 다시 시도해 주세요.",
      );
    }
    tx.set(
      throttleRef,
      {
        lastAtMs: now,
        dayStartMs: dayRolledOver ? now : dayStart || now,
        dayCount: dayCount + 1,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });

  const reportRef = await db.collection("bugReports").add({
    uid,
    email,
    description,
    appVersion: appVersion || null,
    platform: platform || null,
    context: reportContext,
    status: "new",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { ok: true, id: reportRef.id };
});

// 어드민 트리아지 — bugReports 최신순 조회. status 필터는 어드민 UI 에서 적용
// (status+createdAt 복합 인덱스 회피를 위해 서버는 항상 최신순 전량 반환).
export const listBugReports = functions.https.onCall(async (_data, context) => {
  requireAdmin(context);
  const snap = await db
    .collection("bugReports")
    .orderBy("createdAt", "desc")
    .limit(200)
    .get();
  const s = (x: unknown): string => (typeof x === "string" ? x : "");
  const items = snap.docs.map((doc) => {
    const v = doc.data() as Record<string, unknown>;
    const c = (v.context as Record<string, unknown>) || {};
    return {
      id: doc.id,
      uid: s(v.uid),
      email: typeof v.email === "string" ? v.email : null,
      description: s(v.description),
      appVersion: typeof v.appVersion === "string" ? v.appVersion : null,
      platform: typeof v.platform === "string" ? v.platform : null,
      context: {
        recentLogs: s(c.recentLogs),
        route: s(c.route),
        agentSnapshot: s(c.agentSnapshot),
      },
      status: typeof v.status === "string" ? v.status : "new",
      createdAt: tsToIso(v.createdAt),
    };
  });
  return { items };
});

// 어드민 트리아지 — 신고 status 변경(new → triaged → resolved). 클라 직접
// update 는 규칙으로 차단되어 있으므로 이 콜러블(Admin SDK)만 status 를 바꾼다.
export const updateBugReportStatus = functions.https.onCall(
  async (data, context) => {
    requireAdmin(context);
    const id = typeof data?.id === "string" ? data.id.trim() : "";
    const status = typeof data?.status === "string" ? data.status : "";
    if (!id) {
      throw new functions.https.HttpsError("invalid-argument", "id required");
    }
    if (!(BUG_REPORT_STATUSES as readonly string[]).includes(status)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "유효하지 않은 상태값입니다.",
      );
    }
    const ref = db.collection("bugReports").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new functions.https.HttpsError(
        "not-found",
        "신고를 찾을 수 없습니다.",
      );
    }
    await ref.set(
      {
        status,
        triagedBy: context.auth?.uid ?? null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { ok: true };
  },
);

// ─── Telemetry → BigQuery ─────────────────────────────────────

interface TelemetryRow {
  event: string;
  /** Anonymous per-install id (see telemetryService.getClientId). Stored in
   *  place of the Firebase uid so the events table stays 비식별(익명). */
  clientId?: string;
  appVersion: string;
  projectId?: string;
  agentId?: string;
  taskId?: string;
  flowId?: string;
  model?: string;
  role?: string;
  status?: string;
  fromStatus?: string;
  toStatus?: string;
  durationMs?: number;
  tokensInput?: number;
  tokensOutput?: number;
  cost?: number;
  success?: boolean;
  exitCode?: number;
  nodeType?: string;
  nodeCount?: number;
  metadata?: string;
  timestamp: string;
  // ML-ready columns
  taskType?: string;
  taskComplexity?: number;
  filesChanged?: number;
  linesChanged?: number;
  errorCategory?: string;
  errorMessage?: string;
  promptHash?: string;
  promptLength?: number;
  parentAgentId?: string;
  retryOf?: string;
  // ── dispatch:decision event fields (DISPATCH-DECISION-TELEMETRY) ──
  // The model-dispatch decision snapshot ("어떤 모델을 어떤 태스크에 왜 배치했나").
  // These arrive top-level on the dispatch:decision event; we fold them into the
  // existing `metadata` STRING column as JSON rather than add dedicated BigQuery
  // columns — see the mapping note below for why.
  reuseVsSpawn?: string;
  selectedModel?: string;
  complexity?: string;
  tags?: string[];
  eligibleModels?: string[];
  explicitModel?: boolean;
  decisionReason?: string;
  modelSelectionMode?: string;
  perModelScores?: unknown;
  agentScore?: number;
}

// dispatch:decision fields that get folded into the `metadata` JSON column.
// `model`/`agentId`/`taskId`/`role` are NOT here — they map to first-class
// columns already (selectedModel is also sent as `model` for GROUP BY model).
const DISPATCH_DECISION_META_KEYS = [
  "reuseVsSpawn",
  "selectedModel",
  "complexity",
  "tags",
  "eligibleModels",
  "explicitModel",
  "decisionReason",
  "modelSelectionMode",
  "perModelScores",
  "agentScore",
] as const;

/**
 * Build the `metadata` STRING column value for an event.
 *
 * For dispatch:decision we merge the decision-specific fields (perModelScores,
 * reuseVsSpawn, selection mode, …) into the metadata JSON. Design choice: a
 * single JSON STRING column instead of flattened per-field BigQuery columns.
 *   - Backward compatible: no ALTER TABLE on a streaming-insert table (adding
 *     columns there risks insert failures until the schema change propagates,
 *     and would break replay of existing rows). Deploy = `firebase deploy`
 *     for the function only; no BigQuery migration required.
 *   - Query-friendly: analysts use JSON_VALUE(metadata,'$.reuseVsSpawn'),
 *     JSON_VALUE(metadata,'$.selectedModel'), JSON_QUERY(metadata,
 *     '$.perModelScores') to slice/join against cost_logs.taskId + outcomes.
 */
function buildMetadata(e: TelemetryRow): string | null {
  const base =
    e.metadata != null
      ? typeof e.metadata === "string"
        ? safeParseObject(e.metadata)
        : (e.metadata as Record<string, unknown>)
      : {};

  if (e.event === "dispatch:decision") {
    const decision: Record<string, unknown> = { ...base };
    const row = e as unknown as Record<string, unknown>;
    for (const key of DISPATCH_DECISION_META_KEYS) {
      const v = row[key];
      if (v !== undefined) decision[key] = v;
    }
    return Object.keys(decision).length > 0 ? JSON.stringify(decision) : null;
  }

  if (e.metadata == null) return null;
  return typeof e.metadata === "string"
    ? e.metadata
    : JSON.stringify(e.metadata);
}

/** Parse a JSON object string, returning {} on anything non-object/invalid. */
function safeParseObject(s: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(s);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export const logTelemetryBatch = functions.https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Login required");
    }

    const events: TelemetryRow[] = data.events;
    if (!Array.isArray(events) || events.length === 0) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "events array required",
      );
    }

    if (events.length > 100) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Max 100 events per batch",
      );
    }

    // Auth is required for anti-abuse, but we deliberately DO NOT persist the
    // uid. The events table is 비식별(익명): the `userId` column now holds the
    // client-supplied anonymous install id, never the Firebase account uid.
    const now = new Date().toISOString();

    const rows = events.map((e) => ({
      event: e.event,
      userId: e.clientId || "anon",
      appVersion: e.appVersion || "3.0.0",
      projectId: e.projectId || null,
      agentId: e.agentId || null,
      taskId: e.taskId || null,
      flowId: e.flowId || null,
      model: e.model || null,
      role: e.role || null,
      status: e.status || null,
      fromStatus: e.fromStatus || null,
      toStatus: e.toStatus || null,
      durationMs: e.durationMs ?? null,
      tokensInput: e.tokensInput ?? null,
      tokensOutput: e.tokensOutput ?? null,
      cost: e.cost ?? null,
      success: e.success ?? null,
      exitCode: e.exitCode ?? null,
      nodeType: e.nodeType || null,
      nodeCount: e.nodeCount ?? null,
      metadata: buildMetadata(e),
      // ML-ready columns
      taskType: e.taskType || null,
      taskComplexity: e.taskComplexity ?? null,
      filesChanged: e.filesChanged ?? null,
      linesChanged: e.linesChanged ?? null,
      errorCategory: e.errorCategory || null,
      errorMessage: e.errorMessage
        ? String(e.errorMessage).slice(0, 500)
        : null,
      promptHash: e.promptHash || null,
      promptLength: e.promptLength ?? null,
      parentAgentId: e.parentAgentId || null,
      retryOf: e.retryOf || null,
      timestamp: now,
    }));

    await bigquery.dataset(BQ_DATASET).table(BQ_EVENTS_TABLE).insert(rows);

    return { inserted: rows.length };
  },
);

interface CostRow {
  projectId: string;
  agentId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalCost: number;
  // ML-ready columns
  taskId?: string;
  taskType?: string;
  sessionId?: string;
  pricingSnapshot?: string;
}

interface CostSummaryByDayRow {
  date: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  cost: number;
}

interface CostSummaryWeeklyByModelRow {
  model: string;
  totalTokens: number;
  cost: number;
}

interface CostSummaryAggregateRow {
  date?: string;
  model?: string;
  inputTokens?: number | string;
  outputTokens?: number | string;
  cacheReadTokens?: number | string;
  cacheWriteTokens?: number | string;
  totalTokens?: number | string;
  cost?: number | string;
}

const toNumber = (value: number | string | undefined): number =>
  Number(value ?? 0);

export const logCostBatch = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Login required");
  }

  const entries: CostRow[] = data.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "entries array required",
    );
  }

  const userId = context.auth.uid;
  const now = new Date().toISOString();

  const rows = entries.map((e) => ({
    userId,
    projectId: e.projectId || null,
    agentId: e.agentId || null,
    model: e.model || null,
    inputTokens: e.inputTokens ?? 0,
    outputTokens: e.outputTokens ?? 0,
    cacheReadTokens: e.cacheReadTokens ?? 0,
    cacheWriteTokens: e.cacheWriteTokens ?? 0,
    totalCost: e.totalCost ?? 0,
    // ML-ready columns
    taskId: e.taskId || null,
    taskType: e.taskType || null,
    sessionId: e.sessionId || null,
    pricingSnapshot: e.pricingSnapshot || null,
    timestamp: now,
  }));

  await bigquery.dataset(BQ_DATASET).table(BQ_COST_TABLE).insert(rows);

  return { inserted: rows.length };
});

// Query cost logs from BigQuery for dashboard display
export const getCostLogs = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Login required");
  }

  const projectId: string = data.projectId;
  if (!projectId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "projectId required",
    );
  }

  const userId = context.auth.uid;
  const limit: number = data.limit || 200;

  const query = `
    SELECT agentId, model, inputTokens, outputTokens,
           cacheReadTokens, cacheWriteTokens, totalCost, timestamp
    FROM \`marblo-2253d.${BQ_DATASET}.${BQ_COST_TABLE}\`
    WHERE userId = @userId AND projectId = @projectId
    ORDER BY timestamp DESC
    LIMIT @limit
  `;

  const [rows] = await bigquery.query({
    query,
    params: { userId, projectId, limit },
    location: BQ_LOCATION,
  });

  return { logs: rows };
});

// Query aggregated cost summary from BigQuery for dashboard charts
export const getCostSummary = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Login required");
  }

  const projectId: string = data.projectId;
  if (!projectId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "projectId required",
    );
  }

  const requestedDays = Number(data.days ?? 30);
  if (!Number.isInteger(requestedDays) || requestedDays <= 0) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "days must be a positive integer",
    );
  }

  const userId = context.auth.uid;
  const weeklyDays = 7;

  const byDayQuery = `
    SELECT
      FORMAT_DATE('%F', DATE(timestamp)) AS date,
      COALESCE(model, '') AS model,
      SUM(COALESCE(inputTokens, 0)) AS inputTokens,
      SUM(COALESCE(outputTokens, 0)) AS outputTokens,
      SUM(COALESCE(cacheReadTokens, 0)) AS cacheReadTokens,
      SUM(COALESCE(cacheWriteTokens, 0)) AS cacheWriteTokens,
      SUM(
        COALESCE(inputTokens, 0) +
        COALESCE(outputTokens, 0) +
        COALESCE(cacheReadTokens, 0) +
        COALESCE(cacheWriteTokens, 0)
      ) AS totalTokens,
      SUM(COALESCE(totalCost, 0)) AS cost
    FROM \`marblo-2253d.${BQ_DATASET}.${BQ_COST_TABLE}\`
    WHERE userId = @userId
      AND projectId = @projectId
      AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)
    GROUP BY date, model
    ORDER BY date ASC, model ASC
  `;

  const weeklyByModelQuery = `
    SELECT
      COALESCE(model, '') AS model,
      SUM(
        COALESCE(inputTokens, 0) +
        COALESCE(outputTokens, 0) +
        COALESCE(cacheReadTokens, 0) +
        COALESCE(cacheWriteTokens, 0)
      ) AS totalTokens,
      SUM(COALESCE(totalCost, 0)) AS cost
    FROM \`marblo-2253d.${BQ_DATASET}.${BQ_COST_TABLE}\`
    WHERE userId = @userId
      AND projectId = @projectId
      AND timestamp >= TIMESTAMP_SUB(
        CURRENT_TIMESTAMP(),
        INTERVAL @weeklyDays DAY
      )
    GROUP BY model
    ORDER BY model ASC
  `;

  const [[byDayRows], [weeklyByModelRows]] = await Promise.all([
    bigquery.query({
      query: byDayQuery,
      params: { userId, projectId, days: requestedDays },
      location: BQ_LOCATION,
    }),
    bigquery.query({
      query: weeklyByModelQuery,
      params: { userId, projectId, weeklyDays },
      location: BQ_LOCATION,
    }),
  ]);

  const byDay: CostSummaryByDayRow[] = (
    byDayRows as CostSummaryAggregateRow[]
  ).map((row) => ({
    date: row.date ?? "",
    model: row.model ?? "",
    inputTokens: toNumber(row.inputTokens),
    outputTokens: toNumber(row.outputTokens),
    cacheReadTokens: toNumber(row.cacheReadTokens),
    cacheWriteTokens: toNumber(row.cacheWriteTokens),
    totalTokens: toNumber(row.totalTokens),
    cost: toNumber(row.cost),
  }));

  const weeklyByModel: CostSummaryWeeklyByModelRow[] = (
    weeklyByModelRows as CostSummaryAggregateRow[]
  ).map((row) => ({
    model: row.model ?? "",
    totalTokens: toNumber(row.totalTokens),
    cost: toNumber(row.cost),
  }));

  const weeklyTotalTokens = weeklyByModel.reduce(
    (total, row) => total + row.totalTokens,
    0,
  );
  const weeklyCost = weeklyByModel.reduce((total, row) => total + row.cost, 0);

  return {
    byDay,
    weeklyByModel,
    weeklyTotalTokens,
    weeklyCost,
    rangeDays: requestedDays,
  };
});

// ─── Task Outcomes → BigQuery ────────────────────────────────

const BQ_TASK_OUTCOMES_TABLE = "task_outcomes";

export const logTaskOutcome = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Login required");
  }

  const d = data.outcome;
  if (!d || !d.taskId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "outcome with taskId required",
    );
  }

  // 비식별: store the anonymous client id, not the account uid (anti-abuse
  // auth above is enough — the row itself stays de-identified).
  const now = new Date().toISOString();

  const row = {
    userId: d.clientId || "anon",
    taskId: d.taskId,
    projectId: d.projectId || null,
    taskType: d.taskType || null,
    taskComplexity: d.taskComplexity ?? null,
    role: d.role || null,
    model: d.model || null,
    promptLength: d.promptLength ?? null,
    scopeFileCount: d.scopeFileCount ?? null,
    success: d.success ?? null,
    durationMs: d.durationMs ?? null,
    totalInputTokens: d.totalInputTokens ?? null,
    totalOutputTokens: d.totalOutputTokens ?? null,
    totalCost: d.totalCost ?? null,
    retriesCount: d.retriesCount ?? 0,
    errorCategory: d.errorCategory || null,
    createdAt: d.createdAt || now,
    completedAt: d.completedAt || now,
  };

  await bigquery
    .dataset(BQ_DATASET)
    .table(BQ_TASK_OUTCOMES_TABLE)
    .insert([row]);

  return { inserted: 1 };
});

// ─── Agent Heartbeats → BigQuery ─────────────────────────────

const BQ_HEARTBEATS_TABLE = "agent_heartbeats";

export const logHeartbeat = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Login required");
  }

  const beats = data.beats;
  if (!Array.isArray(beats) || beats.length === 0) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "beats array required",
    );
  }

  if (beats.length > 50) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Max 50 beats per batch",
    );
  }

  // 비식별: heartbeats carry the anonymous client id, not the account uid.
  const now = new Date().toISOString();

  const rows = beats.map((b: Record<string, unknown>) => ({
    userId: (b.clientId as string) || "anon",
    agentId: b.agentId || "",
    projectId: b.projectId || null,
    status: b.status || null,
    tokensAccumulated: (b.tokensAccumulated as number) ?? null,
    costAccumulated: (b.costAccumulated as number) ?? null,
    lastActivityType: b.lastActivityType || null,
    timestamp: (b.timestamp as string) || now,
  }));

  await bigquery.dataset(BQ_DATASET).table(BQ_HEARTBEATS_TABLE).insert(rows);

  return { inserted: rows.length };
});

// ─── Flow Executions → BigQuery ──────────────────────────────

const BQ_FLOW_EXECUTIONS_TABLE = "flow_executions";

export const logFlowExecution = functions.https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Login required");
    }

    const d = data.execution;
    if (!d || !d.flowId || !d.runId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "execution with flowId and runId required",
      );
    }

    const userId = context.auth.uid;
    const now = new Date().toISOString();

    const row = {
      userId,
      flowId: d.flowId,
      runId: d.runId,
      projectId: d.projectId || null,
      nodeCount: d.nodeCount ?? null,
      nodesExecuted: d.nodesExecuted
        ? typeof d.nodesExecuted === "string"
          ? d.nodesExecuted
          : JSON.stringify(d.nodesExecuted)
        : null,
      status: d.status || null,
      totalDurationMs: d.totalDurationMs ?? null,
      success: d.success ?? null,
      timestamp: now,
    };

    await bigquery
      .dataset(BQ_DATASET)
      .table(BQ_FLOW_EXECUTIONS_TABLE)
      .insert([row]);

    return { inserted: 1 };
  },
);

// ============================================
// Scheduled Reconciliation (P0-11)
// ============================================
// Daily cron at 04:00 KST (low-traffic window). Picks up payments that
// succeeded on the PG side but never made it into Firestore due to a
// dropped webhook. See reconciliation.ts for the decision tree.

export const scheduledReconcileToss = functions.pubsub
  .schedule("0 4 * * *")
  .timeZone("Asia/Seoul")
  .onRun(async () => {
    const result = await reconcileTossPending();
    console.log("[Recon Toss]", JSON.stringify(result));
    return null;
  });

export const scheduledReconcilePaddle = functions.pubsub
  .schedule("15 4 * * *")
  .timeZone("Asia/Seoul")
  .onRun(async () => {
    const result = await reconcilePaddlePending();
    console.log("[Recon Paddle]", JSON.stringify(result));
    return null;
  });

// ─── 정기결제 갱신 크론(GAP A) ────────────────────────────────────────
// 매일 04:30 KST. active/past_due 토스 구독 중 만료 도래분을 chargeBillingKey
// 헬퍼로 청구한다. 성공 → 기간 연장(멱등), 실패 → past_due/재시도 백오프,
// 누적 실패 MAX 도달 → 해지(free 강등). 복합 인덱스 회피를 위해 paymentProvider
// 단일 동등 쿼리 + 코드 필터(reconcilePaddlePending 선례).
export const scheduledChargeSubscriptions = functions.pubsub
  .schedule("30 4 * * *")
  .timeZone("Asia/Seoul")
  .onRun(async () => {
    const nowMs = Date.now();
    const result = {
      scanned: 0,
      due: 0,
      charged: 0,
      comped: 0,
      extended: 0,
      failed: 0,
      suspended: 0,
      skipped: 0,
    };
    const snap = await db
      .collection("subscriptions")
      .where("paymentProvider", "==", "toss")
      .get();
    result.scanned = snap.size;

    for (const doc of snap.docs) {
      const sub = doc.data();
      const currentPeriodEndMs = tsToMillis(sub.currentPeriodEnd);
      const snapshot: SubscriptionSnapshot = {
        paymentProvider: sub.paymentProvider,
        status: sub.status,
        planType: sub.planType,
        tossBillingKey: sub.tossBillingKey,
        tossCustomerKey: sub.tossCustomerKey,
        founderGrant: sub.founderGrant === true,
        currentPeriodEndMs,
        billingFailedCount: sub.billingFailedCount || 0,
        nextRetryAtMs: tsToMillis(sub.nextRetryAt),
      };
      if (!selectDueForCharge(snapshot, nowMs)) continue;
      result.due++;

      const planType = sub.planType || "pro";
      const amount = PLAN_PRICES_KRW[planType];
      if (!amount) {
        result.skipped++;
        continue;
      }

      // 사이클 앵커 = 만료 경계(currentPeriodEndMs 는 selectDueForCharge 통과로
      // 반드시 number). 같은 사이클 중복청구를 멱등 문서가 막는다.
      const cycleAnchorMs = currentPeriodEndMs as number;
      const charge = await chargeSubscriptionIdempotent({
        userId: doc.id,
        billingKey: sub.tossBillingKey as string,
        customerKey: sub.tossCustomerKey as string,
        amount,
        planType,
        cycleAnchorMs,
        reason: "renewal",
      });

      if (charge.status === "failed") {
        const f = applyChargeFailure(snapshot, nowMs);
        await doc.ref.update({
          status: f.status,
          billingFailedCount: f.billingFailedCount,
          nextRetryAt:
            f.nextRetryAtMs != null
              ? admin.firestore.Timestamp.fromMillis(f.nextRetryAtMs)
              : null,
          ...(f.planType ? { planType: f.planType } : {}),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        if (f.status === "canceled") result.suspended++;
        else result.failed++;
        continue;
      }

      // charged/comped/skipped(이미 succeeded) → 기간 연장. skipped 도 연장해야
      // "청구 성공했으나 직전 실행이 기간갱신 전 죽은" 구독의 무한 재선정을 막는다.
      const s = applyChargeSuccess(nowMs);
      await doc.ref.update({
        status: s.status,
        currentPeriodStart: s.currentPeriodStart,
        currentPeriodEnd: s.currentPeriodEnd,
        billingFailedCount: 0,
        nextRetryAt: null,
        ...(charge.status === "charged"
          ? { tossPaymentKey: charge.paymentKey }
          : {}),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      result.extended++;
      if (charge.status === "charged") result.charged++;
      else if (charge.status === "comped") result.comped++;
      else result.skipped++;
    }

    console.log("[Billing Cron]", JSON.stringify(result));
    return null;
  });

// Manual trigger for ad-hoc runs (operator only — guarded by ADMIN_UID).
export const triggerReconcile = functions.https.onCall(
  async (data, context) => {
    const adminUid = process.env.ADMIN_UID;
    if (!adminUid || context.auth?.uid !== adminUid) {
      throw new functions.https.HttpsError("permission-denied", "Admin only");
    }
    const provider = (data?.provider as string) || "toss";
    if (provider === "paddle") return reconcilePaddlePending();
    return reconcileTossPending();
  },
);

// ═══════════════════════════════════════════════════════════════════
// ─── Founder Beta Telegram 승인 ─────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════
//
// 파운더 베타 신청/설문 제출을 관리자 텔레그램으로 알리고, 인라인 버튼으로
// 승인/스킵/예외 Pro 부여를 처리한다. 기존 선정·부여 로직(markFounderSelectedInternal,
// grantFounderProTotalInternal)을 그대로 재사용 — 알림+버튼 레이어만 얹는다.
//
// 안전 정책(기존 RESEND 패턴과 동일):
//  - env(TELEGRAM_BETA_*) 미설정 시 알림/웹훅은 조용히 스킵 → 기존 흐름 무영향.
//  - 텔레그램 API 호출은 전부 non-throwing(에러 삼킴) — 트리거 재시도 폭주 방지.
//  - 웹훅은 시크릿 헤더 검증 + 관리자 chat/from 확인 + 멱등 처리 후 항상 200 반환.

const TELEGRAM_BETA_BOT_TOKEN = process.env.TELEGRAM_BETA_BOT_TOKEN || "";
const TELEGRAM_BETA_ADMIN_CHAT_ID =
  process.env.TELEGRAM_BETA_ADMIN_CHAT_ID || "";
const TELEGRAM_BETA_WEBHOOK_SECRET =
  process.env.TELEGRAM_BETA_WEBHOOK_SECRET || "";

type TgInlineButton =
  | { text: string; callback_data: string }
  | { text: string; url: string };
type TgInlineKeyboard = TgInlineButton[][];

interface TgCallbackQuery {
  id: string;
  from?: { id?: number | string };
  message?: { message_id?: number; chat?: { id?: number | string } };
  data?: string;
}

// 텔레그램 Bot API 호출(공통) — 토큰 없으면 스킵, 절대 throw 하지 않음.
async function tgCall(
  method: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!TELEGRAM_BETA_BOT_TOKEN) return;
  try {
    const resp = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BETA_BOT_TOKEN}/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.warn(`[tg] ${method} 실패:`, resp.status, body.slice(0, 200));
    }
  } catch (err) {
    console.warn(`[tg] ${method} 예외:`, err);
  }
}

// 관리자 chatId 로 메시지 발송(옵션 인라인 키보드). chatId 미설정 시 스킵.
// 사용자 입력을 그대로 담으므로 parse_mode 없이 평문 전송(포맷 400/인젝션 회피).
async function tgSend(
  text: string,
  inlineKeyboard?: TgInlineKeyboard,
): Promise<void> {
  if (!TELEGRAM_BETA_ADMIN_CHAT_ID) return;
  const payload: Record<string, unknown> = {
    chat_id: TELEGRAM_BETA_ADMIN_CHAT_ID,
    text,
    disable_web_page_preview: true,
  };
  if (inlineKeyboard) {
    payload.reply_markup = { inline_keyboard: inlineKeyboard };
  }
  await tgCall("sendMessage", payload);
}

// 콜백 쿼리 로딩 상태 해제(+토스트 텍스트).
async function tgAnswerCallbackQuery(id: string, text: string): Promise<void> {
  await tgCall("answerCallbackQuery", { callback_query_id: id, text });
}

// 원 메시지 본문 교체 — 처리 결과(무엇을/언제)를 남긴다.
async function tgEditMessageText(
  chatId: string | number,
  messageId: number,
  text: string,
): Promise<void> {
  await tgCall("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    disable_web_page_preview: true,
  });
}

// 사용자 텍스트를 max 자로 발췌(트림 + 말줄임).
function tgSummarize(v: unknown, max = 200): string {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// ─── 트리거 1: 신규 신청 → 관리자 알림([선정][스킵]) ─────────────────
export const notifyAdminOnWaitlistApply = functions.firestore
  .document("betatester50_waitlist/{docId}")
  .onCreate(async (snap) => {
    try {
      if (!TELEGRAM_BETA_BOT_TOKEN || !TELEGRAM_BETA_ADMIN_CHAT_ID) return;
      const data = snap.data() || {};
      const email = typeof data.email === "string" ? data.email : "";
      const name = typeof data.name === "string" ? data.name : "";
      const reason = tgSummarize(data.reason, 200);
      const lines = [
        "🆕 파운더 베타 신청",
        name ? `이름: ${name}` : "",
        `이메일: ${email || "(없음)"}`,
        reason ? `사유: ${reason}` : "",
      ].filter(Boolean);
      await tgSend(lines.join("\n"), [
        [
          { text: "✅ 선정(1개월)", callback_data: `sel:${snap.id}` },
          { text: "⏭️ 스킵", callback_data: `skip:${snap.id}` },
        ],
      ]);
    } catch (err) {
      // 트리거 재시도 폭주 방지 — 알림 실패는 삼킨다.
      console.warn("[tg-waitlist] 알림 실패:", snap.id, err);
    }
  });

// ─── 트리거 2: 설문 제출 → 관리자 알림([예외 Pro3개월][/admin 정밀채점]) ──
export const notifyAdminOnFounderFeedback = functions.firestore
  .document("founder_feedback/{docId}")
  .onCreate(async (snap) => {
    try {
      if (!TELEGRAM_BETA_BOT_TOKEN || !TELEGRAM_BETA_ADMIN_CHAT_ID) return;
      const data = snap.data() || {};
      const email = typeof data.email === "string" ? data.email : "";
      const answers =
        data.answers && typeof data.answers === "object"
          ? (data.answers as Record<string, unknown>)
          : {};
      const q6 = tgSummarize(answers.q6, 80);
      const q1 = tgSummarize(answers.q1, 160);
      const lines = [
        "📝 파운더 설문 제출",
        `이메일: ${email || "(없음)"}`,
        q6 ? `q6: ${q6}` : "",
        q1 ? `q1: ${q1}` : "",
      ].filter(Boolean);
      await tgSend(lines.join("\n"), [
        [{ text: "⭐ 예외승인 Pro3개월", callback_data: `pro:${snap.id}` }],
        [{ text: "📝 /admin 정밀채점", url: `${SITE_BASE}/ko/admin` }],
      ]);
    } catch (err) {
      console.warn("[tg-feedback] 알림 실패:", snap.id, err);
    }
  });

// ─── 웹훅 핸들러: 선정(sel) ─────────────────────────────────────────
async function handleTgSelect(
  cqId: string,
  chatId: string,
  messageId: number,
  docId: string,
): Promise<void> {
  const snap = await db.collection("betatester50_waitlist").doc(docId).get();
  if (!snap.exists) {
    await tgAnswerCallbackQuery(cqId, "신청서를 찾을 수 없음");
    return;
  }
  const data = snap.data() || {};
  const email =
    typeof data.email === "string" ? normalizeEmail(data.email) : "";
  if (!email) {
    await tgAnswerCallbackQuery(cqId, "이메일 없음");
    return;
  }
  // 멱등: 이미 선정된 파운더면 재실행하지 않는다.
  const fSnap = await db.collection(FOUNDERS_COLLECTION).doc(email).get();
  if (fSnap.exists && fSnap.data()?.status === "selected") {
    await tgAnswerCallbackQuery(cqId, "이미 선정됨");
    if (messageId) {
      await tgEditMessageText(chatId, messageId, `✅ 이미 선정됨 — ${email}`);
    }
    return;
  }
  const result = await markFounderSelectedInternal(email);
  await tgAnswerCallbackQuery(cqId, "선정 완료");
  if (messageId) {
    const proNote = result.subscriptionGranted
      ? "Pro 즉시부여"
      : "Pro 가입시 자동부여";
    await tgEditMessageText(
      chatId,
      messageId,
      `✅ 선정 (1개월, ${proNote}, 접근이메일 ${
        result.emailSent ? "발송" : "발송 스킵"
      }) — ${email}\n처리: ${new Date().toISOString()}`,
    );
  }
}

// ─── 웹훅 핸들러: 스킵(skip) ────────────────────────────────────────
async function handleTgSkip(
  cqId: string,
  chatId: string,
  messageId: number,
  docId: string,
): Promise<void> {
  const ref = db.collection("betatester50_waitlist").doc(docId);
  const snap = await ref.get();
  if (!snap.exists) {
    await tgAnswerCallbackQuery(cqId, "신청서를 찾을 수 없음");
    return;
  }
  if (snap.data()?.skipped === true) {
    await tgAnswerCallbackQuery(cqId, "이미 스킵됨");
    return;
  }
  await ref.set(
    {
      skipped: true,
      skippedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await tgAnswerCallbackQuery(cqId, "스킵 처리됨");
  if (messageId) {
    await tgEditMessageText(
      chatId,
      messageId,
      `⏭️ 스킵됨 — 처리: ${new Date().toISOString()}`,
    );
  }
}

// ─── 웹훅 핸들러: 예외 Pro 3개월 부여(pro) ──────────────────────────
async function handleTgProGrant(
  cqId: string,
  chatId: string,
  messageId: number,
  docId: string,
): Promise<void> {
  const ref = db.collection(FOUNDER_FEEDBACK_COLLECTION).doc(docId);
  const snap = await ref.get();
  if (!snap.exists) {
    await tgAnswerCallbackQuery(cqId, "피드백을 찾을 수 없음");
    return;
  }
  const data = snap.data() || {};
  const userId = typeof data.userId === "string" ? data.userId : "";
  const email =
    typeof data.email === "string" ? normalizeEmail(data.email) : "";
  if (!userId || !email) {
    await tgAnswerCallbackQuery(cqId, "userId/email 누락");
    return;
  }
  // 멱등: 이미 Pro 부여된 피드백은 재부여하지 않는다.
  const existingGranted =
    typeof data.proGrantedMonths === "number" ? data.proGrantedMonths : 0;
  if (existingGranted > 0) {
    await tgAnswerCallbackQuery(cqId, "이미 부여됨");
    if (messageId) {
      await tgEditMessageText(
        chatId,
        messageId,
        `⭐ 이미 Pro 부여됨 (${existingGranted}개월) — ${email}`,
      );
    }
    return;
  }
  const proExpiresAt = await grantFounderProTotalInternal(
    userId,
    FOUNDER_PRO_MONTHS,
    "telegram_override",
    new Date(),
  );
  await ref.set(
    {
      proGrantedMonths: FOUNDER_PRO_MONTHS,
      proExpiresAt: admin.firestore.Timestamp.fromDate(proExpiresAt),
      reviewedBy: "telegram",
      reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await db
    .collection(FOUNDERS_COLLECTION)
    .doc(email)
    .set(
      {
        proGrantedMonths: FOUNDER_PRO_MONTHS,
        proExpiresAt: admin.firestore.Timestamp.fromDate(proExpiresAt),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  await tgAnswerCallbackQuery(cqId, "Pro 3개월 부여 완료");
  if (messageId) {
    await tgEditMessageText(
      chatId,
      messageId,
      `⭐ Pro 3개월 부여 (예외승인) — ${email}\n처리: ${new Date().toISOString()}`,
    );
  }
}

// ─── 웹훅: 텔레그램 인라인 버튼 콜백 처리 ───────────────────────────
// setWebhook 시 secret_token 을 등록하고, 텔레그램이 매 요청 헤더로 돌려준다.
export const betaTelegramWebhook = functions.https.onRequest(
  async (req, res) => {
    // env 미설정이면 웹훅 자체가 동작 불가 — 503 으로 명시.
    if (
      !TELEGRAM_BETA_BOT_TOKEN ||
      !TELEGRAM_BETA_WEBHOOK_SECRET ||
      !TELEGRAM_BETA_ADMIN_CHAT_ID
    ) {
      res.status(503).send("telegram webhook not configured");
      return;
    }
    // 시크릿 헤더 검증 — 불일치면 즉시 401.
    const secret = req.headers["x-telegram-bot-api-secret-token"];
    if (secret !== TELEGRAM_BETA_WEBHOOK_SECRET) {
      res.status(401).send("unauthorized");
      return;
    }

    try {
      const body = (req.body || {}) as { callback_query?: TgCallbackQuery };
      const cq = body.callback_query;
      // 콜백 쿼리 외 업데이트(메시지 등)는 무시하고 200.
      if (!cq || typeof cq.id !== "string") {
        res.status(200).send("ok");
        return;
      }

      const fromId = cq.from?.id != null ? String(cq.from.id) : "";
      const chatId =
        cq.message?.chat?.id != null ? String(cq.message.chat.id) : "";
      const messageId =
        typeof cq.message?.message_id === "number" ? cq.message.message_id : 0;

      // 관리자(chat/from) 아니면 무영향 처리.
      if (
        fromId !== TELEGRAM_BETA_ADMIN_CHAT_ID &&
        chatId !== TELEGRAM_BETA_ADMIN_CHAT_ID
      ) {
        await tgAnswerCallbackQuery(cq.id, "권한 없음");
        res.status(200).send("ok");
        return;
      }

      const raw = typeof cq.data === "string" ? cq.data : "";
      const sep = raw.indexOf(":");
      const action = sep >= 0 ? raw.slice(0, sep) : raw;
      const id = sep >= 0 ? raw.slice(sep + 1) : "";
      if (!id) {
        await tgAnswerCallbackQuery(cq.id, "잘못된 요청");
        res.status(200).send("ok");
        return;
      }

      if (action === "sel") {
        await handleTgSelect(cq.id, chatId, messageId, id);
      } else if (action === "skip") {
        await handleTgSkip(cq.id, chatId, messageId, id);
      } else if (action === "pro") {
        await handleTgProGrant(cq.id, chatId, messageId, id);
      } else {
        await tgAnswerCallbackQuery(cq.id, "알 수 없는 작업");
      }
    } catch (err) {
      console.error("[betaTelegramWebhook] 처리 실패:", err);
    }
    // 텔레그램 재전송 폭주 방지 — 어떤 경우에도 200.
    res.status(200).send("ok");
  },
);

// ─── 트리거: 신규 가입 → 선정된 베타 파운더면 Pro 구독 materialize ─────
//
// 선정(markFounderSelected/텔레그램 [선정])은 이메일 기준이라, 유저가 아직
// 미가입이면 uid 가 없어 subscriptions/{uid} 를 만들 수 없다. 선정 후 접근 이메일을
// 받고 유저가 가입하는 것이 일반적 순서이므로, 가입하는 순간 이 트리거가
// founders/{email} 을 조회해 베타/예외 부여 창(window)만큼 Pro 를 부여한다.
// (선정 시점에 이미 계정이 있으면 markFounderSelectedInternal 이 즉시 부여하고,
//  이 트리거는 그 케이스에서 발화하지 않는다 — 둘이 시점만 다른 동일 부여.)
// non-throwing: 부여 실패가 가입 자체를 깨면 안 된다.
export const grantBetaProOnSignup = functions.auth
  .user()
  .onCreate(async (user) => {
    try {
      if (!user.email) return;
      const email = normalizeEmail(user.email);
      const snap = await db.collection(FOUNDERS_COLLECTION).doc(email).get();
      if (!snap.exists) return;
      const fd = snap.data() || {};
      // 선정 기준 = getMyFounderAccess 와 동일(rejected 아님 + accessGrantedAt 존재).
      if (fd.status === "rejected" || !fd.accessGrantedAt) return;

      const now = new Date();
      const betaEnd =
        fd.betaExpiresAt && typeof fd.betaExpiresAt.toDate === "function"
          ? fd.betaExpiresAt.toDate()
          : null;
      const proEnd =
        fd.proExpiresAt && typeof fd.proExpiresAt.toDate === "function"
          ? fd.proExpiresAt.toDate()
          : null;
      // 부여 창 = 베타(1개월)·예외(3/6개월) 종료일 중 더 나중. 둘 다 과거면 스킵.
      const windowEnd =
        proEnd && (!betaEnd || proEnd > betaEnd) ? proEnd : betaEnd;
      if (!windowEnd || windowEnd <= now) return;

      await upsertProSubscription(user.uid, windowEnd, "beta_signup", now);
      await snap.ref.set(
        {
          proSubscriptionUid: user.uid,
          proSubscriptionEnd: admin.firestore.Timestamp.fromDate(windowEnd),
          proSubscriptionGrantedAt:
            admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    } catch (err) {
      console.warn("[grantBetaProOnSignup] 부여 실패:", user.uid, err);
    }
  });

// ─── 스케줄: 만료된 베타/파운더 부여(founder_grant) → free 강등 ────────
//
// 베타 Pro 는 1회성(자동 갱신 없음, scheduledChargeSubscriptions 는 toss 만 대상).
// currentPeriodEnd 경과 후 아무도 status 를 내리지 않으면 영구 Pro 가 되므로, 이
// 스윕이 만료된 founder_grant 구독의 status 를 canceled 로 내린다. 앱 getPlan 은
// status!=='active' → free 이고 실시간 리스너로 즉시 반영되므로 별도 앱 변경 불필요.
// 복합 인덱스 회피: paymentProvider 단일 동등 쿼리 + 코드 필터(기존 크론 선례).
export const scheduledExpireBetaGrants = functions.pubsub
  .schedule("15 4 * * *")
  .timeZone("Asia/Seoul")
  .onRun(async () => {
    const nowMs = Date.now();
    const snap = await db
      .collection("subscriptions")
      .where("paymentProvider", "==", "founder_grant")
      .get();
    let expired = 0;
    for (const doc of snap.docs) {
      const sub = doc.data();
      if (sub.status !== "active") continue;
      const endMs = tsToMillis(sub.currentPeriodEnd);
      if (endMs == null || endMs > nowMs) continue;
      await doc.ref.set(
        {
          status: "canceled",
          canceledAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      expired++;
    }
    console.log(
      `[expireBetaGrants] scanned=${snap.size} expired→canceled=${expired}`,
    );
    return null;
  });
