// Plain-Node smoke test for the rate-limit core logic. Mirrors the
// production module in v3/functions/src/rateLimit.ts. Run:
//   node v3/functions/tests/rateLimit.test.mjs
//
// We can't easily run a Firestore emulator from here, so we test the
// pure decision function (in-window count + remaining + retryAfter)
// against an inlined version. The production transaction wrapper is
// trivial glue around this logic.

function decideRate(existingAttempts, rules, nowMs) {
  const maxWindowMs = Math.max(...rules.map((r) => r.windowSeconds)) * 1000;
  const trimmed = existingAttempts.filter((t) => nowMs - t < maxWindowMs);
  let worstRemaining = Infinity;
  for (const rule of rules) {
    const windowMs = rule.windowSeconds * 1000;
    const inWindow = trimmed.filter((t) => nowMs - t < windowMs);
    const remaining = rule.max - inWindow.length;
    if (remaining < worstRemaining) worstRemaining = remaining;
    if (remaining <= 0) {
      const oldest = inWindow[0] ?? nowMs;
      const retryAfterSec = Math.ceil((oldest + windowMs - nowMs) / 1000);
      return {
        allowed: false,
        remaining: 0,
        retryAfter: Math.max(1, retryAfterSec),
        trimmed,
      };
    }
  }
  return {
    allowed: true,
    remaining: Math.max(0, worstRemaining - 1),
    retryAfter: 0,
    trimmed,
  };
}

const now = 1_000_000_000_000;
const SEC = 1000;
const COUPON_UID = [
  { windowSeconds: 60, max: 5 },
  { windowSeconds: 300, max: 30 },
];

const cases = [
  // ── Empty history ──────────────────────────────────────────
  [
    "fresh key allowed",
    () => {
      const r = decideRate([], COUPON_UID, now);
      return r.allowed && r.remaining === 4 && r.retryAfter === 0;
    },
  ],
  [
    "4 prior in window allowed (5th attempt)",
    () => {
      const attempts = [
        now - 10 * SEC,
        now - 8 * SEC,
        now - 5 * SEC,
        now - 1 * SEC,
      ];
      const r = decideRate(attempts, COUPON_UID, now);
      return r.allowed && r.remaining === 0;
    },
  ],
  [
    "5 prior in window blocked",
    () => {
      const attempts = Array.from({ length: 5 }, (_, i) => now - (i + 1) * SEC);
      const r = decideRate(attempts, COUPON_UID, now);
      return !r.allowed && r.remaining === 0 && r.retryAfter > 0;
    },
  ],
  [
    "10 prior but all > 60s old → 1min rule passes, but 5min rule sees them",
    () => {
      // 10 attempts each 65s apart → none in 60s window
      // but all 10 are in the 300s window (rule max=30) → still allowed
      const attempts = Array.from(
        { length: 10 },
        (_, i) => now - (65 + i * 10) * SEC,
      );
      const r = decideRate(attempts, COUPON_UID, now);
      // None in 60s window, 0 in 300s window (oldest is 155s ago, fits)
      // Actually all 10 are within 300s (oldest 65 + 90 = 155s ago)
      return r.allowed;
    },
  ],
  [
    "30 prior in 5min window → blocked by second rule",
    () => {
      const attempts = Array.from(
        { length: 30 },
        (_, i) => now - (61 + i * 5) * SEC,
      );
      // None in 60s window (all 61s+ old)
      // 30 in 300s window (oldest = 61 + 145 = 206s ago, fits) → rule 2 max=30 → blocked
      const r = decideRate(attempts, COUPON_UID, now);
      return !r.allowed;
    },
  ],
  [
    "retryAfter reflects oldest-in-window expiry",
    () => {
      // 5 attempts all in last 30s; oldest 30s ago. retryAfter ≈ 60-30 = 30s
      const attempts = Array.from(
        { length: 5 },
        (_, i) => now - (30 - i * 5) * SEC,
      );
      const r = decideRate(attempts, COUPON_UID, now);
      return !r.allowed && r.retryAfter >= 28 && r.retryAfter <= 32;
    },
  ],
  [
    "old attempts (outside max window) get trimmed",
    () => {
      // Mix: 3 in last min (allowed), 10 from 10min ago (should drop)
      const recent = [now - 10 * SEC, now - 20 * SEC, now - 30 * SEC];
      const stale = Array.from(
        { length: 10 },
        (_, i) => now - (600 + i * 10) * SEC,
      );
      const r = decideRate([...stale, ...recent], COUPON_UID, now);
      // After trim, only 3 remain → allowed
      return r.allowed && r.trimmed.length === 3;
    },
  ],
  [
    "concurrent slot — exactly at limit blocks",
    () => {
      const attempts = Array.from({ length: 5 }, (_, i) => now - (1 + i) * SEC);
      const r = decideRate(attempts, COUPON_UID, now);
      return !r.allowed;
    },
  ],
  [
    "remaining decreases as attempts accrue",
    () => {
      const r1 = decideRate([], COUPON_UID, now);
      const r2 = decideRate([now - 1 * SEC], COUPON_UID, now);
      const r3 = decideRate([now - 1 * SEC, now - 2 * SEC], COUPON_UID, now);
      return r1.remaining === 4 && r2.remaining === 3 && r3.remaining === 2;
    },
  ],

  // ── IP-style: 20/min, 100/10min ────────────────────────────
  [
    "IP 19 in window allowed",
    () => {
      const attempts = Array.from(
        { length: 19 },
        (_, i) => now - (i + 1) * SEC,
      );
      const r = decideRate(
        attempts,
        [
          { windowSeconds: 60, max: 20 },
          { windowSeconds: 600, max: 100 },
        ],
        now,
      );
      return r.allowed;
    },
  ],
  [
    "IP 20 in window blocked",
    () => {
      const attempts = Array.from(
        { length: 20 },
        (_, i) => now - (i + 1) * SEC,
      );
      const r = decideRate(
        attempts,
        [
          { windowSeconds: 60, max: 20 },
          { windowSeconds: 600, max: 100 },
        ],
        now,
      );
      return !r.allowed;
    },
  ],

  // ── Edge: no rules → unlimited ─────────────────────────────
  [
    "empty rules array → always allowed",
    () => {
      const r = decideRate(
        Array.from({ length: 1000 }, (_, i) => now - i),
        [],
        now,
      );
      // For empty rules, Math.max returns -Infinity → maxWindowMs is -Infinity
      // trimmed becomes empty (no item satisfies nowMs - t < -Infinity)
      // worstRemaining stays Infinity, loop body never runs → allowed=true
      return r.allowed;
    },
  ],
];

let pass = 0;
let fail = 0;
for (const [name, fn] of cases) {
  try {
    if (fn()) pass++;
    else {
      console.log("FAIL:", name);
      fail++;
    }
  } catch (err) {
    console.log("THROW:", name, err.message);
    fail++;
  }
}
console.log(
  `\nrateLimit: ${pass}/${cases.length} passed${fail ? `, ${fail} failed` : ""}`,
);
process.exit(fail ? 1 : 0);
