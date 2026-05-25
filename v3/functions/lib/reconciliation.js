"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyOrder = classifyOrder;
exports.fetchTossOrder = fetchTossOrder;
exports.fetchPaddleTransaction = fetchPaddleTransaction;
exports.reconcileTossPending = reconcileTossPending;
exports.reconcilePaddlePending = reconcilePaddlePending;
/**
 * Daily reconciliation — catches webhook drops.
 *
 * Strategy: don't enumerate the whole PG transaction list (rate-limited,
 * slow, complex). Instead use Firestore `pendingOrders` as the work
 * queue. Anything stuck > MIN_AGE_HOURS without a terminal state gets
 * a direct status query against the PG. Three outcomes per stuck order:
 *
 *   DONE on PG → apply the missing success path (recover).
 *   CANCELED / EXPIRED on PG → drop pending row, surface as lost sale.
 *   Still in flight → leave alone (user may still be on the redirect).
 *
 * Two PG flavors share this skeleton: Toss (Korean payments) and
 * Paddle (global). Both expose a per-order GET endpoint we can poll.
 *
 * P0-11 acceptance: 1-week simulation. The pure decision function
 * `classifyOrder()` is tested with mocked PG responses against a
 * synthetic week of stuck orders — see tests/reconciliation.test.mjs.
 */
const admin = __importStar(require("firebase-admin"));
const db = admin.firestore();
const MIN_AGE_HOURS = 1; // Give the user time to finish the redirect.
const MAX_AGE_HOURS = 24 * 7; // Don't keep banging old failed orders.
const TOSS_SECRET_KEY = process.env.TOSS_SECRET_KEY || "";
const PADDLE_API_KEY = process.env.PADDLE_API_KEY || "";
/**
 * Pure decision function — given a pending order and the PG's reported
 * status, what action should we take? Isolated so unit tests can run
 * without hitting Firestore or the PG.
 */
function classifyOrder(order, pg, nowMs = Date.now()) {
    const ageMs = nowMs - order.createdAt.getTime();
    const ageHours = ageMs / (3600 * 1000);
    if (ageHours < MIN_AGE_HOURS)
        return "leave";
    if (ageHours > MAX_AGE_HOURS)
        return "drop"; // ancient, treat as lost
    switch (pg.state) {
        case "DONE":
            return "recover";
        case "CANCELED":
        case "EXPIRED":
            return "drop";
        case "PENDING":
            return "leave";
        case "UNKNOWN":
        default:
            return "error";
    }
}
/**
 * Fetch a Toss payment's current status by orderId.
 * Toss API: GET /v1/payments/orders/{orderId}
 */
async function fetchTossOrder(orderId) {
    if (!TOSS_SECRET_KEY) {
        return { state: "UNKNOWN" };
    }
    try {
        const res = await fetch(`https://api.tosspayments.com/v1/payments/orders/${encodeURIComponent(orderId)}`, {
            headers: {
                Authorization: `Basic ${Buffer.from(TOSS_SECRET_KEY + ":").toString("base64")}`,
            },
        });
        if (res.status === 404)
            return { state: "EXPIRED" };
        if (!res.ok)
            return { state: "UNKNOWN" };
        const body = (await res.json());
        const status = String(body.status ?? "").toUpperCase();
        if (status === "DONE")
            return { state: "DONE", raw: body };
        if (status === "CANCELED" || status === "PARTIAL_CANCELED")
            return { state: "CANCELED", raw: body };
        if (status === "EXPIRED" || status === "ABORTED")
            return { state: "EXPIRED", raw: body };
        if (status === "READY" || status === "IN_PROGRESS")
            return { state: "PENDING", raw: body };
        return { state: "UNKNOWN", raw: body };
    }
    catch (err) {
        console.warn(`[Recon Toss] fetch error for ${orderId}:`, err);
        return { state: "UNKNOWN" };
    }
}
/**
 * Fetch a Paddle transaction's status by transactionId.
 * Paddle API: GET /transactions/{id}
 */
async function fetchPaddleTransaction(txId) {
    if (!PADDLE_API_KEY) {
        return { state: "UNKNOWN" };
    }
    try {
        const res = await fetch(`https://api.paddle.com/transactions/${encodeURIComponent(txId)}`, {
            headers: { Authorization: `Bearer ${PADDLE_API_KEY}` },
        });
        if (res.status === 404)
            return { state: "EXPIRED" };
        if (!res.ok)
            return { state: "UNKNOWN" };
        const body = (await res.json());
        const status = String(body?.data?.status ?? "").toLowerCase();
        if (status === "completed" || status === "paid")
            return { state: "DONE", raw: body.data };
        if (status === "canceled" || status === "void")
            return { state: "CANCELED", raw: body.data };
        if (status === "past_due" || status === "ready")
            return { state: "PENDING", raw: body.data };
        return { state: "UNKNOWN", raw: body.data };
    }
    catch (err) {
        console.warn(`[Recon Paddle] fetch error for ${txId}:`, err);
        return { state: "UNKNOWN" };
    }
}
/**
 * Scan `pendingOrders` from the last 24h, query Toss per order, apply
 * the correct outcome. Designed to be idempotent — re-running won't
 * double-charge or duplicate purchase rows because we filter on the
 * pending flag and delete on terminal outcomes.
 */
async function reconcileTossPending() {
    const result = {
        scanned: 0,
        recovered: 0,
        dropped: 0,
        leftPending: 0,
        errors: 0,
    };
    const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - MAX_AGE_HOURS * 3600 * 1000);
    const stuck = await db
        .collection("pendingOrders")
        .where("createdAt", ">", cutoff)
        .get();
    result.scanned = stuck.size;
    const now = Date.now();
    for (const doc of stuck.docs) {
        const order = doc.data();
        const createdAt = order.createdAt instanceof admin.firestore.Timestamp
            ? order.createdAt.toDate()
            : order.createdAt instanceof Date
                ? order.createdAt
                : new Date(order.createdAt);
        const pg = await fetchTossOrder(doc.id);
        const outcome = classifyOrder({ createdAt }, pg, now);
        switch (outcome) {
            case "recover":
                // Caller is expected to invoke the original confirm path. For
                // safety we tag the doc rather than auto-applying — confirm
                // logic involves writing to multiple collections and we want
                // a human or a separate function to handle the side-effects.
                await doc.ref.update({
                    reconcileFlag: "needs_recovery",
                    pgRaw: pg.raw ?? null,
                    reconciledAt: admin.firestore.FieldValue.serverTimestamp(),
                });
                result.recovered++;
                break;
            case "drop":
                await doc.ref.delete();
                result.dropped++;
                break;
            case "leave":
                result.leftPending++;
                break;
            case "error":
            default:
                result.errors++;
                break;
        }
    }
    return result;
}
/** Paddle counterpart — same shape, different PG. */
async function reconcilePaddlePending() {
    const result = {
        scanned: 0,
        recovered: 0,
        dropped: 0,
        leftPending: 0,
        errors: 0,
    };
    // Paddle orders are stored differently — they live under
    // pendingPaddleOrders or as part of subscriptions with status=pending.
    // Until the Paddle integration is more fleshed out, we scan
    // pendingOrders documents flagged with provider='paddle'.
    const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - MAX_AGE_HOURS * 3600 * 1000);
    const stuck = await db
        .collection("pendingOrders")
        .where("provider", "==", "paddle")
        .where("createdAt", ">", cutoff)
        .get();
    result.scanned = stuck.size;
    const now = Date.now();
    for (const doc of stuck.docs) {
        const order = doc.data();
        const createdAt = order.createdAt instanceof admin.firestore.Timestamp
            ? order.createdAt.toDate()
            : new Date(order.createdAt);
        const txId = order.paddleTransactionId ?? doc.id;
        const pg = await fetchPaddleTransaction(txId);
        const outcome = classifyOrder({ createdAt }, pg, now);
        switch (outcome) {
            case "recover":
                await doc.ref.update({
                    reconcileFlag: "needs_recovery",
                    pgRaw: pg.raw ?? null,
                    reconciledAt: admin.firestore.FieldValue.serverTimestamp(),
                });
                result.recovered++;
                break;
            case "drop":
                await doc.ref.delete();
                result.dropped++;
                break;
            case "leave":
                result.leftPending++;
                break;
            default:
                result.errors++;
                break;
        }
    }
    return result;
}
//# sourceMappingURL=reconciliation.js.map