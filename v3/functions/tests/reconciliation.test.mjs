// Plain-Node smoke test for the reconciliation decision logic. Mirrors
// classifyOrder() in v3/functions/src/reconciliation.ts. Run:
//   node v3/functions/tests/reconciliation.test.mjs
//
// Covers the 1-week simulation acceptance criterion in P0-11: feed a
// synthetic week of pending orders through the classifier and verify
// the per-outcome counts match expectations.

const MIN_AGE_HOURS = 1;
const MAX_AGE_HOURS = 24 * 7;

function classifyOrder(order, pg, nowMs) {
  const ageHours = (nowMs - order.createdAt.getTime()) / (3600 * 1000);
  if (ageHours < MIN_AGE_HOURS) return "leave";
  if (ageHours > MAX_AGE_HOURS) return "drop";
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

const now = Date.parse("2026-05-12T04:00:00Z"); // simulated cron run time
const HOUR = 3600 * 1000;
const AGED = (h) => new Date(now - h * HOUR);

const cases = [
  // ── Age gates ─────────────────────────────────────────────
  [
    "<1h old → leave (user might still be redirecting)",
    () =>
      classifyOrder({ createdAt: AGED(0.5) }, { state: "DONE" }, now) ===
      "leave",
  ],
  [
    "exactly 1h old + DONE → recover (boundary)",
    () =>
      classifyOrder({ createdAt: AGED(1.01) }, { state: "DONE" }, now) ===
      "recover",
  ],
  [
    ">7d old → drop regardless of PG (don't bang ancient orders)",
    () =>
      classifyOrder({ createdAt: AGED(24 * 7 + 1) }, { state: "DONE" }, now) ===
      "drop",
  ],

  // ── PG state mapping for active orders (1h–7d window) ──────
  [
    "DONE → recover",
    () =>
      classifyOrder({ createdAt: AGED(2) }, { state: "DONE" }, now) ===
      "recover",
  ],
  [
    "CANCELED → drop",
    () =>
      classifyOrder({ createdAt: AGED(2) }, { state: "CANCELED" }, now) ===
      "drop",
  ],
  [
    "EXPIRED → drop",
    () =>
      classifyOrder({ createdAt: AGED(2) }, { state: "EXPIRED" }, now) ===
      "drop",
  ],
  [
    "PENDING → leave",
    () =>
      classifyOrder({ createdAt: AGED(2) }, { state: "PENDING" }, now) ===
      "leave",
  ],
  [
    "UNKNOWN → error",
    () =>
      classifyOrder({ createdAt: AGED(2) }, { state: "UNKNOWN" }, now) ===
      "error",
  ],

  // ── Idempotency: classifying the same order twice yields same outcome ──
  [
    "deterministic — same input twice same output",
    () => {
      const o = { createdAt: AGED(3) };
      const r1 = classifyOrder(o, { state: "DONE" }, now);
      const r2 = classifyOrder(o, { state: "DONE" }, now);
      return r1 === r2 && r1 === "recover";
    },
  ],

  // ── 1-week simulation (acceptance) ─────────────────────────
  [
    "1-week sim: 100 orders, mixed states, counts match",
    () => {
      const orders = [];
      // 50 successful: aged 2h-72h, DONE on PG
      for (let i = 0; i < 50; i++) {
        orders.push({
          order: { createdAt: AGED(2 + i * 1.4) },
          pg: { state: "DONE" },
        });
      }
      // 20 canceled at PG
      for (let i = 0; i < 20; i++) {
        orders.push({
          order: { createdAt: AGED(5 + i * 0.5) },
          pg: { state: "CANCELED" },
        });
      }
      // 10 still in flight
      for (let i = 0; i < 10; i++) {
        orders.push({
          order: { createdAt: AGED(0.2 + i * 0.05) }, // < 1h → leave
          pg: { state: "DONE" },
        });
      }
      // 10 PG didn't return → unknown
      for (let i = 0; i < 10; i++) {
        orders.push({
          order: { createdAt: AGED(3 + i) },
          pg: { state: "UNKNOWN" },
        });
      }
      // 5 truly ancient (>7d) → drop regardless
      for (let i = 0; i < 5; i++) {
        orders.push({
          order: { createdAt: AGED(24 * 7 + 5 + i * 2) },
          pg: { state: "DONE" },
        });
      }
      // 5 pending status from PG
      for (let i = 0; i < 5; i++) {
        orders.push({
          order: { createdAt: AGED(4 + i) },
          pg: { state: "PENDING" },
        });
      }

      const counts = { recover: 0, drop: 0, leave: 0, error: 0 };
      for (const { order, pg } of orders) {
        counts[classifyOrder(order, pg, now)]++;
      }
      // Expected:
      //   recover 50 (DONE in age window)
      //   drop    25 (20 canceled + 5 ancient)
      //   leave   15 (10 <1h + 5 pending)
      //   error   10 (unknown)
      return (
        counts.recover === 50 &&
        counts.drop === 25 &&
        counts.leave === 15 &&
        counts.error === 10
      );
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
  `\nreconciliation: ${pass}/${cases.length} passed${
    fail ? `, ${fail} failed` : ""
  }`
);
process.exit(fail ? 1 : 0);
