import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as crypto from "crypto";
import { BigQuery } from "@google-cloud/bigquery";
import {
  enforce as enforceRateLimit,
  extractIp,
  COUPON_RULES_UID,
  COUPON_RULES_IP,
} from "./rateLimit";
import { reconcileTossPending, reconcilePaddlePending } from "./reconciliation";
import sgMail from "@sendgrid/mail";

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
const TOSS_WEBHOOK_SECRET = process.env.TOSS_WEBHOOK_SECRET || "";

// ─── SendGrid (파운더 접근 안내 이메일) ──────────────────────────────
// 전부 선택값 — 미설정 시 발송만 스킵하고 배포·선정은 정상 동작한다.
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || "";
const FOUNDER_FROM_EMAIL =
  process.env.FOUNDER_FROM_EMAIL || "support@marblo.app";
const FOUNDER_FROM_NAME = process.env.FOUNDER_FROM_NAME || "Marblo";
const DISCORD_INVITE_URL = process.env.DISCORD_INVITE_URL || ""; // 설정 시에만 초대 링크 노출
const SITE_BASE = "https://marblo.app";
const FOUNDER_COURSE_COUPON = "FOUNDER50"; // 강의 50% 할인 쿠폰 코드

const PLAN_PRICES_KRW: Record<string, number> = {
  pro: 19000,
  team: 29000,
  team_plus: 290000, // per-team floor (5 seats incl.)
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

// ─── Webhook signature verification (H1) ─────────────────────────
//
// 위조된 웹훅으로 구독 상태를 조작하는 것을 막는다. 서명은 반드시 원본
// 바이트(req.rawBody)에 대해 계산해야 한다 — JSON.parse 후 재직렬화하면
// 키 순서/공백이 달라져 HMAC 이 깨진다. 비교는 timing-safe 하게 한다.

/** 길이까지 포함해 timing-safe 한 hex 문자열 비교. */
function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Toss 웹훅 서명 검증. 백엔드(payment_service.verify_webhook)와 동일 스킴:
 * HMAC-SHA256(secret, `${timestamp}.${rawBody}`) hex, 헤더
 * x-toss-webhook-signature / x-toss-webhook-timestamp.
 */
function verifyTossWebhook(
  signature: string,
  timestamp: string,
  rawBody: Buffer | undefined
): boolean {
  if (!TOSS_WEBHOOK_SECRET || !signature || !timestamp || !rawBody)
    return false;
  const message = `${timestamp}.${rawBody.toString("utf8")}`;
  const expected = crypto
    .createHmac("sha256", TOSS_WEBHOOK_SECRET)
    .update(message)
    .digest("hex");
  return timingSafeEqualHex(signature, expected);
}

/**
 * Paddle Billing 웹훅 서명 검증. 헤더 형식: `ts=<unix>;h1=<hmac-hex>`.
 * HMAC-SHA256(secret, `${ts}:${rawBody}`) 를 h1 과 비교 (Paddle 공식 스킴).
 */
function verifyPaddleSignature(
  signatureHeader: string,
  rawBody: Buffer | undefined
): boolean {
  if (!PADDLE_WEBHOOK_SECRET || !signatureHeader || !rawBody) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(";").map((kv) => {
      const idx = kv.indexOf("=");
      return [kv.slice(0, idx).trim(), kv.slice(idx + 1).trim()];
    })
  );
  const ts = parts["ts"];
  const h1 = parts["h1"];
  if (!ts || !h1) return false;
  const expected = crypto
    .createHmac("sha256", PADDLE_WEBHOOK_SECRET)
    .update(`${ts}:${rawBody.toString("utf8")}`)
    .digest("hex");
  return timingSafeEqualHex(h1, expected);
}

// ─── Paddle Webhook ──────────────────────────────────────────────
export const paddleWebhook = functions.https.onRequest(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  // H1: 서명 검증. 기존 코드는 헤더 '존재'만 확인해(`!signature && SECRET`)
  // 아무 값이나 넣으면 통과했다 — 서명 값 자체를 HMAC 으로 검증한다.
  const signature = (req.headers["paddle-signature"] as string) || "";
  if (!verifyPaddleSignature(signature, req.rawBody)) {
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
    // IDOR 가드: 본인 주문만 확인할 수 있다. orderId 는 클라이언트가 넘기고
    // 형식이 열거 가능(`marblo_<plan>_<uid>_<ts>`)하므로, 소유권 확인이 없으면
    // 인증된 사용자가 남의 orderId 로 구독을 활성화/덮어쓸 수 있다(그 doc 의
    // userId 로 subscriptions 가 기록됨). 실 익스플로잇은 유효 paymentKey 가
    // 게이트하지만, 방어심층으로 호출자 uid 와 주문 소유자를 대조한다.
    if (order.userId !== context.auth.uid) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "본인의 주문만 확인할 수 있습니다."
      );
    }
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

  // H1: 서명 검증. 기존엔 검증이 전무해 위조 PAYMENT_STATUS_CHANGED 로
  // 임의 구독을 canceled/past_due 로 바꿀 수 있었다.
  const tossSignature =
    (req.headers["x-toss-webhook-signature"] as string) || "";
  const tossTimestamp =
    (req.headers["x-toss-webhook-timestamp"] as string) || "";
  if (!verifyTossWebhook(tossSignature, tossTimestamp, req.rawBody)) {
    res.status(401).send("Invalid webhook signature");
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
        "No billing key registered for this account"
      );
    }

    const planType: string = sub.planType || "pro";
    const amount = PLAN_PRICES_KRW[planType];
    if (!amount) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        `Plan '${planType}' is not chargeable`
      );
    }

    const billingKey = sub.tossBillingKey as string;
    const customerKey = sub.tossCustomerKey as string;
    // orderId 도 서버 생성 — 클라이언트가 통제하지 못하게 한다.
    const orderId = `sub_${userId}_${Date.now()}`;
    const orderName = `Marblo ${planType} 구독`;

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
    requireAdmin(context);

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

// ═══════════════════════════════════════════════════════════════════
// Founder Beta (파운더 100인 무료 베타) — 피드백 → Pro 무료 부여
// ═══════════════════════════════════════════════════════════════════
//
// 흐름 (이메일 발송은 수동 MVP — 어드민이 접근 안내·폼 링크를 직접 전달):
//   1) 어드민이 betatester50_waitlist 검토 후 markFounderSelected({email}) 로 선정.
//      founders/{normalizedEmail} 생성, accessGrantedAt = 선정 시각(3일 클럭 시작).
//   2) 파운더가 같은 (이메일 인증된) 계정으로 로그인 → /foundation50/feedback
//      6문항 제출 → submitFounderFeedback(): 선정 여부 + accessGrantedAt+3일 이내
//      검증 → founder_feedback 저장 + Pro 3개월 직접 부여(결제 우회).
//   3) 인터뷰 완료 시 어드민 markFounderInterviewed({email}) → Pro +3개월(총 6).
//
// 어드민 식별: triggerReconcile 과 동일하게 ADMIN_UID env 단일 체크.

const FOUNDER_FEEDBACK_WINDOW_DAYS = 3;
const FOUNDER_PRO_MONTHS = 3;
const FOUNDER_INTERVIEW_BONUS_MONTHS = 3; // 3 → 6 누적
const FOUNDER_FIELD_MAX = 5000;

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

// Pro 구독을 결제 없이 직접 부여/연장 (내부 함수).
// 이미 미래까지 유효한 구독이 있으면 그 끝에서 이어 붙여 기간을 축소하지 않는다.
// paymentProvider="founder_grant" 로 결제 기반 구독과 구분.
async function grantFounderProInternal(
  userId: string,
  months: number,
  reason: string
): Promise<Date> {
  const now = new Date();
  const subRef = db.collection("subscriptions").doc(userId);
  const snap = await subRef.get();
  const data = snap.data();
  const existingEnd =
    data?.currentPeriodEnd && typeof data.currentPeriodEnd.toDate === "function"
      ? data.currentPeriodEnd.toDate()
      : null;
  const base = existingEnd && existingEnd > now ? existingEnd : now;
  const periodEnd = addMonths(base, months);

  const payload: Record<string, unknown> = {
    userId,
    planType: "pro",
    status: "active",
    paymentProvider: "founder_grant",
    founderGrant: true,
    founderGrantReason: reason,
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
  const feedbackUrl = `${SITE_BASE}/${locale}/founders/feedback`;
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
        <h2 style="font-size:17px;margin:24px 0 8px">2. Feedback (required, within 3 days)</h2>
        <p>Please submit your feedback within <strong>3 days</strong>: <a href="${feedbackUrl}" style="color:#4f46e5">${feedbackUrl}</a><br/>
        Submitting earns you <strong>3 months of Pro free</strong> (6 months if you also do a short interview).</p>
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
        `2. Feedback (required, within 3 days): ${feedbackUrl}`,
        "   Submitting earns 3 months of Pro free (6 months with an interview).",
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
        <h2 style="font-size:17px;margin:24px 0 8px">2. フィードバック（必須・3日以内）</h2>
        <p><strong>3日以内</strong>にご提出ください: <a href="${feedbackUrl}" style="color:#4f46e5">${feedbackUrl}</a><br/>
        提出すると <strong>Pro 3ヶ月無料</strong>（インタビューに応じると6ヶ月）。</p>
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
        `2. フィードバック（必須・3日以内）: ${feedbackUrl}`,
        "   提出すると Pro 3ヶ月無料（インタビューで6ヶ月）。",
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
      <h2 style="font-size:17px;margin:24px 0 8px">2. 피드백 (필수, 3일 이내)</h2>
      <p><strong>3일 이내</strong>에 피드백을 제출해 주세요: <a href="${feedbackUrl}" style="color:#4f46e5">${feedbackUrl}</a><br/>
      제출하시면 <strong>Pro 3개월</strong>을 무료로 드립니다 (인터뷰까지 참여 시 6개월).</p>
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
      `2. 피드백 (필수, 3일 이내): ${feedbackUrl}`,
      "   제출 시 Pro 3개월 무료 (인터뷰까지 참여 시 6개월).",
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
 * - SENDGRID_API_KEY 미설정 시 console.warn 후 false 반환(스킵).
 * - 발송 성공 시 true, 그 외 false.
 */
async function sendFounderAccessEmail(
  email: string,
  locale: string
): Promise<boolean> {
  try {
    if (!SENDGRID_API_KEY) {
      console.warn(
        "[founder-email] SENDGRID_API_KEY 미설정 — 발송 스킵:",
        email
      );
      return false;
    }
    sgMail.setApiKey(SENDGRID_API_KEY);
    const content = buildFounderAccessEmail(normalizeFounderLocale(locale));
    await sgMail.send({
      to: email,
      from: { email: FOUNDER_FROM_EMAIL, name: FOUNDER_FROM_NAME },
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
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

// 파운더 선정 (관리자용) — waitlist 이메일을 founders 로 승격.
// accessGrantedAt 이 3일 피드백 윈도우의 기준. resetWindow=true 면 윈도우 재시작.
export const markFounderSelected = functions.https.onCall(
  async (data, context) => {
    requireAdmin(context);
    const email =
      typeof data?.email === "string" ? normalizeEmail(data.email) : "";
    if (!email) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "email required"
      );
    }

    const ref = db.collection("founders").doc(email);
    const snap = await ref.get();

    const update: Record<string, unknown> = {
      email,
      status: "selected",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (!snap.exists) {
      update.selectedAt = admin.firestore.FieldValue.serverTimestamp();
    }
    if (
      !snap.exists ||
      !snap.data()?.accessGrantedAt ||
      data?.resetWindow === true
    ) {
      update.accessGrantedAt = admin.firestore.FieldValue.serverTimestamp();
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
      { merge: true }
    );

    return { ok: true, email, emailSent };
  }
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
        "email required"
      );
    }
    const locale = await lookupFounderLocale(email);
    const emailSent = await sendFounderAccessEmail(email, locale);
    await db.collection("founders").doc(email).set(
      {
        accessEmailSent: emailSent,
        accessEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return { ok: true, emailSent };
  }
);

// 구조화 피드백 제출 (파운더 본인) — 검증 후 저장 + Pro 3개월 직접 부여.
export const submitFounderFeedback = functions.https.onCall(
  async (data, context) => {
    const uid = context.auth?.uid;
    const token = context.auth?.token;
    if (!uid || !token?.email) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "로그인이 필요합니다."
      );
    }
    // 무료 Pro 부여 경계 — 이메일 소유권 위조 방지를 위해 인증된 이메일만 허용.
    if (token.email_verified !== true) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "이메일 인증이 완료된 계정만 제출할 수 있습니다."
      );
    }
    const email = normalizeEmail(token.email);

    const answers = data?.answers;
    if (!answers || typeof answers !== "object") {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "피드백 내용이 필요합니다."
      );
    }
    const str = (v: unknown): string =>
      typeof v === "string" ? v.trim().slice(0, FOUNDER_FIELD_MAX) : "";
    const q1 = str(answers.q1); // 무엇을 하려 했나
    const q2 = str(answers.q2); // 좋았던 점
    const q3 = str(answers.q3); // 내 문제를 해결한 점 (선택)
    const q4 = str(answers.q4); // 막히거나 아쉬운 점
    const q5 = str(answers.q5); // 있었으면 하는 것
    const reason = str(answers.reason); // 점수 이유
    const rating = Number(answers.rating);
    if (!q1 || !q2 || !q4 || !q5 || !reason) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "필수 문항(①②④⑤⑥)을 모두 입력해 주세요."
      );
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 10) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "점수는 1~10 사이여야 합니다."
      );
    }

    const fRef = db.collection("founders").doc(email);

    // 트랜잭션으로 선정·윈도우·중복제출 검증 + 제출 마킹을 원자적으로 처리
    // (중복 클릭에 의한 이중 부여 방지).
    await db.runTransaction(async (tx) => {
      const s = await tx.get(fRef);
      if (!s.exists || s.data()?.status === "rejected") {
        throw new functions.https.HttpsError(
          "permission-denied",
          "선정된 파운더가 아닙니다. 선정 안내 이메일의 계정으로 로그인했는지 확인해 주세요."
        );
      }
      const fd = s.data()!;
      if (fd.feedbackSubmittedAt) {
        throw new functions.https.HttpsError(
          "already-exists",
          "이미 피드백을 제출하셨습니다."
        );
      }
      const granted =
        fd.accessGrantedAt && typeof fd.accessGrantedAt.toDate === "function"
          ? fd.accessGrantedAt.toDate()
          : null;
      if (!granted) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "접근 권한이 아직 부여되지 않았습니다."
        );
      }
      const deadline = new Date(
        granted.getTime() + FOUNDER_FEEDBACK_WINDOW_DAYS * 24 * 60 * 60 * 1000
      );
      if (new Date() > deadline) {
        throw new functions.https.HttpsError(
          "deadline-exceeded",
          "피드백 제출 기한(접근 후 3일)이 지났습니다."
        );
      }
      tx.set(
        fRef,
        {
          userId: uid,
          status: "feedback_submitted",
          feedbackSubmittedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    // 피드백 저장 + Pro 3개월 부여
    const fbRef = await db.collection("founder_feedback").add({
      email,
      userId: uid,
      locale: typeof data?.locale === "string" ? data.locale : null,
      answers: { q1, q2, q3, q4, q5, reason },
      rating,
      consentQuote: answers.consentQuote === true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const periodEnd = await grantFounderProInternal(
      uid,
      FOUNDER_PRO_MONTHS,
      "founder_feedback"
    );

    await fRef.set(
      {
        feedbackId: fbRef.id,
        proGrantedMonths: FOUNDER_PRO_MONTHS,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return {
      ok: true,
      proMonths: FOUNDER_PRO_MONTHS,
      currentPeriodEnd: periodEnd.toISOString(),
    };
  }
);

// 인터뷰 완료 마킹 (관리자용) — Pro +3개월 연장 (총 6). 피드백 제출로 계정이
// 연결(userId)된 파운더만 대상.
export const markFounderInterviewed = functions.https.onCall(
  async (data, context) => {
    requireAdmin(context);
    const email =
      typeof data?.email === "string" ? normalizeEmail(data.email) : "";
    if (!email) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "email required"
      );
    }
    const fRef = db.collection("founders").doc(email);
    const fSnap = await fRef.get();
    if (!fSnap.exists) {
      throw new functions.https.HttpsError("not-found", "founder not found");
    }
    const f = fSnap.data()!;
    const uid = f.userId;
    if (!uid) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "피드백 제출 전이라 계정이 연결되지 않았습니다. 피드백 제출 후 진행하세요."
      );
    }
    if (f.interviewedAt) {
      throw new functions.https.HttpsError(
        "already-exists",
        "이미 인터뷰 보너스가 적용되었습니다."
      );
    }
    const periodEnd = await grantFounderProInternal(
      uid,
      FOUNDER_INTERVIEW_BONUS_MONTHS,
      "founder_interview"
    );
    await fRef.set(
      {
        status: "interviewed",
        interviewedAt: admin.firestore.FieldValue.serverTimestamp(),
        proGrantedMonths:
          (typeof f.proGrantedMonths === "number" ? f.proGrantedMonths : 0) +
          FOUNDER_INTERVIEW_BONUS_MONTHS,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return {
      ok: true,
      bonusMonths: FOUNDER_INTERVIEW_BONUS_MONTHS,
      currentPeriodEnd: periodEnd.toISOString(),
    };
  }
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
  }
);

// 파운더 현황(어드민) — founders 컬렉션 전체 요약. 상태·시각·Pro개월 등.
export const listFounders = functions.https.onCall(async (_data, context) => {
  requireAdmin(context);
  const snap = await db.collection("founders").limit(1000).get();
  const items = snap.docs.map((d) => {
    const v = d.data() as Record<string, unknown>;
    const feedbackId = typeof v.feedbackId === "string" ? v.feedbackId : null;
    return {
      email: typeof v.email === "string" ? v.email : d.id,
      status: typeof v.status === "string" ? v.status : null,
      accessGrantedAt: tsToIso(v.accessGrantedAt),
      feedbackSubmittedAt: tsToIso(v.feedbackSubmittedAt),
      interviewedAt: tsToIso(v.interviewedAt),
      proGrantedMonths:
        typeof v.proGrantedMonths === "number" ? v.proGrantedMonths : 0,
      feedbackId,
      hasFeedback: !!feedbackId,
    };
  });
  return { items };
});

// 이메일별 6문항 피드백 열람(어드민) — founder_feedback 최신 1건.
export const getFounderFeedbackByEmail = functions.https.onCall(
  async (data, context) => {
    requireAdmin(context);
    const email =
      typeof data?.email === "string" ? normalizeEmail(data.email) : "";
    if (!email) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "email required"
      );
    }
    const snap = await db
      .collection("founder_feedback")
      .where("email", "==", email)
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();
    if (snap.empty) {
      return { feedback: null };
    }
    const v = snap.docs[0].data() as Record<string, unknown>;
    const a = (v.answers as Record<string, unknown>) || {};
    const str = (x: unknown): string => (typeof x === "string" ? x : "");
    return {
      feedback: {
        answers: {
          q1: str(a.q1),
          q2: str(a.q2),
          q3: str(a.q3),
          q4: str(a.q4),
          q5: str(a.q5),
          reason: str(a.reason),
        },
        rating: typeof v.rating === "number" ? v.rating : null,
        consentQuote: v.consentQuote === true,
        createdAt: tsToIso(v.createdAt),
      },
    };
  }
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

// Query aggregated cost summary from BigQuery for dashboard charts
export const getCostSummary = functions.https.onCall(async (data, context) => {
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

  const requestedDays = Number(data.days ?? 30);
  if (!Number.isInteger(requestedDays) || requestedDays <= 0) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "days must be a positive integer"
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
    }),
    bigquery.query({
      query: weeklyByModelQuery,
      params: { userId, projectId, weeklyDays },
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
    0
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
      "outcome with taskId required"
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
      "beats array required"
    );
  }

  if (beats.length > 50) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Max 50 beats per batch"
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
