// Unit tests for the payment webhook signature verification (H1 defense).
// Imports the COMPILED module so the test tracks the real implementation
// (no logic drift). Build first, then run:
//   cd v3/functions && npm run build && node tests/webhookVerify.test.mjs
//
// Covers the acceptance from ticket 0E3zUE8EOcjZay7jJcyf:
//   - valid signature passes
//   - missing signature / timestamp / body / secret is rejected
//   - wrong signature is rejected (forged webhook → 401 upstream)
//   - tampered body is rejected (HMAC computed on original bytes)
//   - wrong timestamp is rejected (timestamp is part of the signed message)

import crypto from "node:crypto";
import {
  verifyTossWebhook,
  verifyPaddleSignature,
  timingSafeEqualHex,
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

// ─── Toss: HMAC-SHA256(secret, `${ts}.${rawBody}`) hex ──────────────
const TOSS_SECRET = "test_toss_webhook_secret";
const tossTs = "1720000000000";
const tossBody = Buffer.from(
  JSON.stringify({
    eventType: "PAYMENT_STATUS_CHANGED",
    data: { status: "CANCELED" },
  }),
);
const tossSig = crypto
  .createHmac("sha256", TOSS_SECRET)
  .update(`${tossTs}.${tossBody.toString("utf8")}`)
  .digest("hex");

assert(
  verifyTossWebhook(tossSig, tossTs, tossBody, TOSS_SECRET) === true,
  "toss: valid signature passes",
);
assert(
  verifyTossWebhook("", tossTs, tossBody, TOSS_SECRET) === false,
  "toss: missing signature rejected",
);
assert(
  verifyTossWebhook(tossSig, "", tossBody, TOSS_SECRET) === false,
  "toss: missing timestamp rejected",
);
assert(
  verifyTossWebhook(tossSig, tossTs, undefined, TOSS_SECRET) === false,
  "toss: missing rawBody rejected",
);
assert(
  verifyTossWebhook(tossSig, tossTs, tossBody, "") === false,
  "toss: empty secret rejected (unconfigured = closed)",
);
assert(
  verifyTossWebhook("deadbeef".repeat(8), tossTs, tossBody, TOSS_SECRET) ===
    false,
  "toss: wrong signature rejected",
);
assert(
  verifyTossWebhook(
    tossSig,
    tossTs,
    Buffer.from(tossBody.toString("utf8").replace("CANCELED", "DONE")),
    TOSS_SECRET,
  ) === false,
  "toss: tampered body rejected",
);
assert(
  verifyTossWebhook(tossSig, "1720000009999", tossBody, TOSS_SECRET) === false,
  "toss: wrong timestamp rejected (ts is part of signed message)",
);
assert(
  verifyTossWebhook(tossSig, tossTs, tossBody, "wrong_secret") === false,
  "toss: wrong secret rejected",
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
