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
import * as admin from "firebase-admin";

// Lazy — admin.firestore() must NOT run at module load. index.ts imports this
// module before calling admin.initializeApp(), and CJS runs imports first, so a
// top-level admin.firestore() throws app/no-app and fails firebase-functions v5
// source discovery for the whole codebase. Resolve on first use instead.
let _db: admin.firestore.Firestore | null = null;
const db = (): admin.firestore.Firestore => (_db ??= admin.firestore());

const MIN_AGE_HOURS = 1; // Give the user time to finish the redirect.
const MAX_AGE_HOURS = 24 * 7; // Don't keep banging old failed orders.

const TOSS_SECRET_KEY = process.env.TOSS_SECRET_KEY || "";
const PADDLE_API_KEY = process.env.PADDLE_API_KEY || "";

export type Outcome = "recover" | "drop" | "leave" | "error";

export interface PendingOrder {
  id: string;
  userId: string;
  type: "subscription" | "lecture";
  amount: number;
  createdAt: Date;
  /** Slug or plan key */
  lectureSlug?: string;
  plan?: string;
  billing?: "monthly" | "annual";
}

export interface PgStatus {
  /** Normalized terminal state, or "PENDING" if not yet settled. */
  state: "DONE" | "CANCELED" | "EXPIRED" | "PENDING" | "UNKNOWN";
  /** Raw payload for downstream apply logic. */
  raw?: Record<string, unknown>;
}

/**
 * Pure decision function — given a pending order and the PG's reported
 * status, what action should we take? Isolated so unit tests can run
 * without hitting Firestore or the PG.
 */
export function classifyOrder(
  order: { createdAt: Date },
  pg: PgStatus,
  nowMs: number = Date.now()
): Outcome {
  const ageMs = nowMs - order.createdAt.getTime();
  const ageHours = ageMs / (3600 * 1000);
  if (ageHours < MIN_AGE_HOURS) return "leave";
  if (ageHours > MAX_AGE_HOURS) return "drop"; // ancient, treat as lost
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
export async function fetchTossOrder(orderId: string): Promise<PgStatus> {
  if (!TOSS_SECRET_KEY) {
    return { state: "UNKNOWN" };
  }
  try {
    const res = await fetch(
      `https://api.tosspayments.com/v1/payments/orders/${encodeURIComponent(
        orderId
      )}`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(TOSS_SECRET_KEY + ":").toString(
            "base64"
          )}`,
        },
      }
    );
    if (res.status === 404) return { state: "EXPIRED" };
    if (!res.ok) return { state: "UNKNOWN" };
    const body = (await res.json()) as Record<string, unknown>;
    const status = String(body.status ?? "").toUpperCase();
    if (status === "DONE") return { state: "DONE", raw: body };
    if (status === "CANCELED" || status === "PARTIAL_CANCELED")
      return { state: "CANCELED", raw: body };
    if (status === "EXPIRED" || status === "ABORTED")
      return { state: "EXPIRED", raw: body };
    if (status === "READY" || status === "IN_PROGRESS")
      return { state: "PENDING", raw: body };
    return { state: "UNKNOWN", raw: body };
  } catch (err) {
    console.warn(`[Recon Toss] fetch error for ${orderId}:`, err);
    return { state: "UNKNOWN" };
  }
}

/**
 * Fetch a Paddle transaction's status by transactionId.
 * Paddle API: GET /transactions/{id}
 */
export async function fetchPaddleTransaction(txId: string): Promise<PgStatus> {
  if (!PADDLE_API_KEY) {
    return { state: "UNKNOWN" };
  }
  try {
    const res = await fetch(
      `https://api.paddle.com/transactions/${encodeURIComponent(txId)}`,
      {
        headers: { Authorization: `Bearer ${PADDLE_API_KEY}` },
      }
    );
    if (res.status === 404) return { state: "EXPIRED" };
    if (!res.ok) return { state: "UNKNOWN" };
    const body = (await res.json()) as { data?: Record<string, unknown> };
    const status = String(body?.data?.status ?? "").toLowerCase();
    if (status === "completed" || status === "paid")
      return { state: "DONE", raw: body.data };
    if (status === "canceled" || status === "void")
      return { state: "CANCELED", raw: body.data };
    if (status === "past_due" || status === "ready")
      return { state: "PENDING", raw: body.data };
    return { state: "UNKNOWN", raw: body.data };
  } catch (err) {
    console.warn(`[Recon Paddle] fetch error for ${txId}:`, err);
    return { state: "UNKNOWN" };
  }
}

export interface ReconcileResult {
  scanned: number;
  recovered: number;
  dropped: number;
  leftPending: number;
  errors: number;
}

/**
 * Scan `pendingOrders` from the last 24h, query Toss per order, apply
 * the correct outcome. Designed to be idempotent — re-running won't
 * double-charge or duplicate purchase rows because we filter on the
 * pending flag and delete on terminal outcomes.
 */
export async function reconcileTossPending(): Promise<ReconcileResult> {
  const result: ReconcileResult = {
    scanned: 0,
    recovered: 0,
    dropped: 0,
    leftPending: 0,
    errors: 0,
  };
  const cutoff = admin.firestore.Timestamp.fromMillis(
    Date.now() - MAX_AGE_HOURS * 3600 * 1000
  );
  const stuck = await db()
    .collection("pendingOrders")
    .where("createdAt", ">", cutoff)
    .get();
  result.scanned = stuck.size;
  const now = Date.now();
  for (const doc of stuck.docs) {
    const order = doc.data();
    const createdAt =
      order.createdAt instanceof admin.firestore.Timestamp
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
export async function reconcilePaddlePending(): Promise<ReconcileResult> {
  const result: ReconcileResult = {
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
  // (provider ==) + (createdAt >) 는 서로 다른 필드라 복합 인덱스를 요구한다 —
  // firestore.indexes.json 에 없으면 런타임 FAILED_PRECONDITION 으로 죽는다.
  // Paddle pending 물량은 소량(국내=Toss 우선)이라, provider 단일 동등 쿼리(자동
  // 단일필드 인덱스)만 날리고 createdAt 컷오프는 코드에서 필터한다. 선례:
  // getFounderFeedbackByEmail(#211)·chatService. createdAt 은 Timestamp/Date/숫자/
  // 문자열 어느 형태든 올 수 있어 toMillis 가드로 안전 비교한다.
  const cutoffMs = Date.now() - MAX_AGE_HOURS * 3600 * 1000;
  const toMillis = (x: unknown): number =>
    x instanceof admin.firestore.Timestamp
      ? x.toMillis()
      : x instanceof Date
      ? x.getTime()
      : typeof x === "number"
      ? x
      : typeof x === "string"
      ? new Date(x).getTime()
      : 0;
  const snap = await db()
    .collection("pendingOrders")
    .where("provider", "==", "paddle")
    .get();
  const stuckDocs = snap.docs.filter(
    (doc) => toMillis(doc.data().createdAt) > cutoffMs
  );
  result.scanned = stuckDocs.length;
  const now = Date.now();
  for (const doc of stuckDocs) {
    const order = doc.data();
    const createdAt =
      order.createdAt instanceof admin.firestore.Timestamp
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
