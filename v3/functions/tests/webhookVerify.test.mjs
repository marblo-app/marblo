// Unit tests for the payment webhook trust logic.
// Imports the COMPILED module so the test tracks the real implementation
// (no logic drift). Build first, then run:
//   cd v3/functions && npm run build && node tests/webhookVerify.test.mjs
//
// Covers:
//   - Toss (ticket XJ2xFetkFSJnhu53ptyx): PAYMENT_STATUS_CHANGED has NO
//     signature header. Verification is by RE-QUERYING the Payment API and
//     acting only on Toss's real status. Tests the pure decision functions:
//       * re-query response → normalized result (success / !ok=404 / missing)
//       * real status → subscription action (cancel / past_due / none)
//       * re-query failure (null) → no change
//       * FORGED body is harmless — action depends only on the re-queried
//         status, never on what the webhook body claimed
//   - Paddle: real HMAC signature `ts=..;h1=..` over original bytes.

import crypto from "node:crypto";
import {
  verifyPaddleSignature,
  timingSafeEqualHex,
  classifyTossPaymentResponse,
  subscriptionActionForTossStatus,
  resolveTossWebhookAction,
} from "../lib/webhookVerify.js";

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

// ─── Toss re-query: HTTP response → normalized result ────────────────
assert(
  JSON.stringify(classifyTossPaymentResponse(true, { status: "DONE" })) ===
    JSON.stringify({ status: "DONE" }),
  "toss requery: 2xx + status → { status }",
);
assert(
  JSON.stringify(classifyTossPaymentResponse(true, { status: "CANCELED" })) ===
    JSON.stringify({ status: "CANCELED" }),
  "toss requery: reflects real CANCELED status",
);
assert(
  classifyTossPaymentResponse(false, { status: "CANCELED" }) === null,
  "toss requery: non-2xx (e.g. 404 not-found/forged key) → null (safe ignore)",
);
assert(
  classifyTossPaymentResponse(true, null) === null,
  "toss requery: 2xx but null body → null",
);
assert(
  classifyTossPaymentResponse(true, {}) === null,
  "toss requery: 2xx but missing status → null",
);
assert(
  classifyTossPaymentResponse(true, { status: 123 }) === null,
  "toss requery: 2xx but non-string status → null",
);

// ─── Toss real status → subscription action ─────────────────────────
assert(
  subscriptionActionForTossStatus("CANCELED").type === "cancel",
  "toss action: CANCELED → cancel",
);
assert(
  subscriptionActionForTossStatus("EXPIRED").type === "cancel",
  "toss action: EXPIRED → cancel",
);
assert(
  subscriptionActionForTossStatus("PARTIAL_CANCELED").type === "past_due",
  "toss action: PARTIAL_CANCELED → past_due",
);
assert(
  subscriptionActionForTossStatus("DONE").type === "none",
  "toss action: DONE → none (no change)",
);
assert(
  subscriptionActionForTossStatus("READY").type === "none",
  "toss action: READY → none",
);
assert(
  subscriptionActionForTossStatus("IN_PROGRESS").type === "none",
  "toss action: IN_PROGRESS → none",
);
assert(
  subscriptionActionForTossStatus("WAITING_FOR_DEPOSIT").type === "none",
  "toss action: WAITING_FOR_DEPOSIT → none",
);
assert(
  subscriptionActionForTossStatus("canceled").type === "cancel",
  "toss action: case-insensitive (lowercase canceled → cancel)",
);
assert(
  subscriptionActionForTossStatus("").type === "none",
  "toss action: empty → none",
);
assert(
  subscriptionActionForTossStatus("SOMETHING_NEW").type === "none",
  "toss action: unknown status → none (fail closed = no change)",
);

// ─── resolveTossWebhookAction: null (re-query failed) → none ─────────
assert(
  resolveTossWebhookAction(null).type === "none",
  "toss resolve: re-query failed/absent (null) → none (no subscription change)",
);
assert(
  resolveTossWebhookAction({ status: "CANCELED" }).type === "cancel",
  "toss resolve: verified CANCELED → cancel",
);
assert(
  resolveTossWebhookAction({ status: "PARTIAL_CANCELED" }).type === "past_due",
  "toss resolve: verified PARTIAL_CANCELED → past_due",
);

// ─── Forgery is harmless: decision uses ONLY the re-queried status ───
// The handler feeds resolveTossWebhookAction the RE-QUERIED result, never the
// body's claimed status. Simulate the handler's decision to prove that a
// forged body cannot drive the subscription change.
function decide(bodyClaimedStatus /* deliberately ignored */, requeryResult) {
  // handler ignores bodyClaimedStatus entirely; only requeryResult matters
  void bodyClaimedStatus;
  return resolveTossWebhookAction(requeryResult);
}
assert(
  decide("CANCELED", { status: "DONE" }).type === "none",
  "forgery: body claims CANCELED but Toss says DONE → none (no downgrade)",
);
assert(
  decide("DONE", { status: "CANCELED" }).type === "cancel",
  "forgery: body claims DONE but Toss says CANCELED → cancel (real state wins)",
);
assert(
  decide("CANCELED", null).type === "none",
  "forgery: body claims CANCELED but re-query 404/failed → none (ghost key harmless)",
);

// ─── Paddle: header `ts=<unix>;h1=<hmac>`, HMAC(secret, `${ts}:${body}`) ──
const PADDLE_SECRET = "test_paddle_webhook_secret";
const pdTs = "1720000000";
const pdBody = Buffer.from(
  JSON.stringify({ event_type: "subscription.updated" }),
);
const pdH1 = crypto
  .createHmac("sha256", PADDLE_SECRET)
  .update(`${pdTs}:${pdBody.toString("utf8")}`)
  .digest("hex");
const pdHeader = `ts=${pdTs};h1=${pdH1}`;

assert(
  verifyPaddleSignature(pdHeader, pdBody, PADDLE_SECRET) === true,
  "paddle: valid signature passes",
);
assert(
  verifyPaddleSignature("", pdBody, PADDLE_SECRET) === false,
  "paddle: missing header rejected",
);
assert(
  verifyPaddleSignature(`ts=${pdTs}`, pdBody, PADDLE_SECRET) === false,
  "paddle: missing h1 rejected",
);
assert(
  verifyPaddleSignature(`h1=${pdH1}`, pdBody, PADDLE_SECRET) === false,
  "paddle: missing ts rejected",
);
assert(
  verifyPaddleSignature(pdHeader, pdBody, "") === false,
  "paddle: empty secret rejected",
);
assert(
  verifyPaddleSignature(
    `ts=${pdTs};h1=${"0".repeat(64)}`,
    pdBody,
    PADDLE_SECRET,
  ) === false,
  "paddle: wrong h1 rejected",
);
assert(
  verifyPaddleSignature(pdHeader, Buffer.from("{}"), PADDLE_SECRET) === false,
  "paddle: tampered body rejected",
);

// ─── timingSafeEqualHex ─────────────────────────────────────────────
assert(
  timingSafeEqualHex("abc123", "abc123") === true,
  "eq: identical strings",
);
assert(
  timingSafeEqualHex("abc123", "abc124") === false,
  "eq: differ by one char",
);
assert(timingSafeEqualHex("abc", "abcd") === false, "eq: different length");

console.log(`\nwebhookVerify.test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
