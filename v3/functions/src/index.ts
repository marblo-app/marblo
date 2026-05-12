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

admin.initializeApp();
const db = admin.firestore();
const bigquery = new BigQuery();

const BQ_DATASET = "marblo_telemetry";
const BQ_EVENTS_TABLE = "events";
const BQ_COST_TABLE = "cost_logs";

// ─── Config ──────────────────────────────────────────────────────
const PADDLE_API_KEY = process.env.PADDLE_API_KEY!;
const PADDLE_WEBHOOK_SECRET = process.env.PADDLE_WEBHOOK_SECRET!;
const PADDLE_API_BASE = "https://api.paddle.com";

const TOSS_SECRET_KEY = process.env.TOSS_SECRET_KEY!;
const TOSS_API_BASE = "https://api.tosspayments.com/v1";

const PLAN_PRICES_KRW: Record<string, number> = {
  pro: 19000,
  team: 39000,
};

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
        "로그인이 필요합니다."
      );
    }

    const userId = context.auth.uid;
    const subSnap = await db.collection("subscriptions").doc(userId).get();

    if (!subSnap.exists || !subSnap.data()?.paddleSubscriptionId) {
      throw new functions.https.HttpsError(
        "not-found",
        "구독 정보를 찾을 수 없습니다."
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
      }
    );

    if (!response.ok) {
      const error = await response.json();
      console.error("Paddle cancel failed:", error);
      throw new functions.https.HttpsError(
        "internal",
        "구독 취소에 실패했습니다."
      );
    }

    return { success: true };
  }
);

// ─── Paddle Webhook ──────────────────────────────────────────────
export const paddleWebhook = functions.https.onRequest(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  // Verify webhook signature
  const signature = req.headers["paddle-signature"] as string;
  if (!signature && PADDLE_WEBHOOK_SECRET) {
    res.status(401).send("Missing signature");
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
        const update: Record<string, any> = {
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        if (data.status === "active") update.status = "active";
        if (data.status === "past_due") update.status = "past_due";

        if (data.current_billing_period) {
          if (data.current_billing_period.starts_at) {
            update.currentPeriodStart = admin.firestore.Timestamp.fromDate(
              new Date(data.current_billing_period.starts_at)
            );
          }
          if (data.current_billing_period.ends_at) {
            update.currentPeriodEnd = admin.firestore.Timestamp.fromDate(
              new Date(data.current_billing_period.ends_at)
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
        "로그인이 필요합니다."
      );
    }

    const { planType } = data as { planType: string };
    const amount = PLAN_PRICES_KRW[planType];
    if (!amount) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "유효하지 않은 플랜입니다."
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
  }
);

// ─── Confirm Toss Payment ────────────────────────────────────────
export const confirmTossPayment = functions.https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "로그인이 필요합니다."
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
        "주문을 찾을 수 없습니다."
      );
    }

    const order = orderSnap.data()!;
    if (order.amount !== amount) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "결제 금액이 일치하지 않습니다."
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
        error.message || "결제 승인에 실패했습니다."
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
  }
);

// ─── TossPayments Webhook ────────────────────────────────────────
export const tossWebhook = functions.https.onRequest(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const { eventType, data: eventData } = req.body;

  switch (eventType) {
    case "PAYMENT_STATUS_CHANGED": {
      const { paymentKey, status } = eventData;

      const snap = await db
        .collection("subscriptions")
        .where("tossPaymentKey", "==", paymentKey)
        .limit(1)
        .get();

      if (!snap.empty) {
        const docRef = snap.docs[0].ref;
        if (status === "CANCELED" || status === "EXPIRED") {
          await docRef.update({
            status: "canceled",
            planType: "free",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        } else if (status === "PARTIAL_CANCELED") {
          await docRef.update({
            status: "past_due",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
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

// 빌링키 발급
export const issueBillingKey = functions.https.onCall(async (data, context) => {
  const { authKey, customerKey, plan } = data;
  const userId = context.auth?.uid;
  if (!userId)
    throw new functions.https.HttpsError("unauthenticated", "Login required");

  const response = await fetch(
    "https://api.tosspayments.com/v1/billing/authorizations/issue",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(TOSS_SECRET_KEY + ":").toString(
          "base64"
        )}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ authKey, customerKey }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new functions.https.HttpsError(
      "internal",
      error.message || "Failed to issue billing key"
    );
  }

  const responseData = await response.json();
  const billingKey = responseData.billingKey;

  // Save subscription to Firestore
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  await db
    .collection("subscriptions")
    .doc(userId)
    .set(
      {
        userId,
        planType: plan || "pro",
        status: "active",
        paymentProvider: "toss",
        tossBillingKey: billingKey,
        tossCustomerKey: customerKey,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        createdAt: now,
      },
      { merge: true }
    );

  return { success: true, billingKey };
});

// 빌링키로 정기결제 실행
export const chargeBillingKey = functions.https.onCall(
  async (data, _context) => {
    const { userId, billingKey, amount, orderId, orderName, customerKey } =
      data;

    const response = await fetch(
      `https://api.tosspayments.com/v1/billing/${billingKey}`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(TOSS_SECRET_KEY + ":").toString(
            "base64"
          )}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customerKey,
          amount,
          orderId,
          orderName,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new functions.https.HttpsError(
        "internal",
        error.message || "Failed to charge billing key"
      );
    }

    const responseData = await response.json();

    // Update subscription period
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    await db.collection("subscriptions").doc(userId).update({
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      status: "active",
    });

    return { success: true, paymentKey: responseData.paymentKey };
  }
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
  }
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
        "Already purchased this lecture"
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
  }
);

// 강의 단건결제 확인
export const confirmLecturePayment = functions.https.onCall(
  async (data, context) => {
    const { paymentKey, orderId, amount } = data;
    const userId = context.auth?.uid;
    if (!userId)
      throw new functions.https.HttpsError("unauthenticated", "Login required");

    // Confirm with TossPayments
    const response = await fetch(
      "https://api.tosspayments.com/v1/payments/confirm",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(TOSS_SECRET_KEY + ":").toString(
            "base64"
          )}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ paymentKey, orderId, amount }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new functions.https.HttpsError(
        "internal",
        error.message || "Payment confirmation failed"
      );
    }

    // Get pending order
    const orderDoc = await db.collection("pendingOrders").doc(orderId).get();
    if (!orderDoc.exists) {
      throw new functions.https.HttpsError("not-found", "Order not found");
    }
    const order = orderDoc.data()!;

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
  }
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
      "Coupon code required"
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
      `Too many attempts. Try again in ${uidCheck.retryAfter}s.`
    );
  }
  const ipCheck = await enforceRateLimit(ipKey, COUPON_RULES_IP);
  if (!ipCheck.allowed) {
    throw new functions.https.HttpsError(
      "resource-exhausted",
      `Too many attempts from this network. Try again in ${ipCheck.retryAfter}s.`
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
    COUPON_RULES_UID
  );
  if (!uidCheck.allowed) {
    throw new functions.https.HttpsError(
      "resource-exhausted",
      `Too many attempts. Try again in ${uidCheck.retryAfter}s.`
    );
  }
  const ipCheck = await enforceRateLimit(`coupon:ip:${ip}`, COUPON_RULES_IP);
  if (!ipCheck.allowed) {
    throw new functions.https.HttpsError(
      "resource-exhausted",
      `Too many attempts from this network. Try again in ${ipCheck.retryAfter}s.`
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
        (baseAmount * (coupon.discountPercent || 0)) / 100
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
    const userId = context.auth?.uid;
    // Simple admin check - you can enhance this with custom claims
    if (!userId)
      throw new functions.https.HttpsError("unauthenticated", "Login required");

    const { coupons } = data;
    if (!Array.isArray(coupons) || coupons.length === 0) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Coupons array required"
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
  }
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
  }
);

// ─── Telemetry → BigQuery ─────────────────────────────────────

interface TelemetryRow {
  event: string;
  userId: string;
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
        "events array required"
      );
    }

    if (events.length > 100) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Max 100 events per batch"
      );
    }

    const userId = context.auth.uid;
    const now = new Date().toISOString();

    const rows = events.map((e) => ({
      event: e.event,
      userId,
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
      metadata: e.metadata
        ? typeof e.metadata === "string"
          ? e.metadata
          : JSON.stringify(e.metadata)
        : null,
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
  }
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

export const logCostBatch = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Login required");
  }

  const entries: CostRow[] = data.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "entries array required"
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
      "projectId required"
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
  });

  return { logs: rows };
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
      "outcome with taskId required"
    );
  }

  const userId = context.auth.uid;
  const now = new Date().toISOString();

  const row = {
    userId,
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
      "beats array required"
    );
  }

  if (beats.length > 50) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Max 50 beats per batch"
    );
  }

  const userId = context.auth.uid;
  const now = new Date().toISOString();

  const rows = beats.map((b: Record<string, unknown>) => ({
    userId,
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
        "execution with flowId and runId required"
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
  }
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
  }
);
