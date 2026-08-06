// PortOne V2 순수 검증 테스트.
// 빌드 후 실행:
//   cd v3/functions && npm run build && node tests/portone.test.mjs

import {
  portonePaymentId,
  portoneChargeDocId,
  portoneExpectedAmount,
  validatePortOnePaidPayment,
  extractPortOneBillingKey,
} from "../lib/portone.js";

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error("  ✗ FAIL:", msg);
  }
}
function eq(a, b, msg) {
  assert(
    a === b,
    `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`,
  );
}

const paymentId = portonePaymentId("uid/A", "subscription", "123");
eq(
  paymentId,
  "portone_subscription_uid_A_123",
  "paymentId ASCII-safe deterministic",
);
eq(
  portoneChargeDocId(paymentId),
  "portone_portone_subscription_uid_A_123",
  "billingCharges doc id is provider-scoped",
);

{
  const expected = portoneExpectedAmount("pro", "annual");
  assert(expected !== null, "pro annual is chargeable");
  eq(expected.amount, 190000, "pro annual amount");
  eq(expected.billingCycle, "annual", "annual cycle preserved");
  eq(portoneExpectedAmount("free", "monthly"), null, "free is not chargeable");
}

const paid = {
  id: paymentId,
  storeId: "store_test",
  status: "PAID",
  amount: { total: 190000 },
  currency: "KRW",
};

assert(
  validatePortOnePaidPayment(paid, {
    paymentId,
    storeId: "store_test",
    amount: 190000,
    currency: "KRW",
  }).ok,
  "valid paid payment passes",
);

eq(
  validatePortOnePaidPayment(
    { ...paid, amount: { total: 1000 } },
    {
      paymentId,
      storeId: "store_test",
      amount: 190000,
      currency: "KRW",
    },
  ).reason,
  "amount_mismatch",
  "tampered client amount is rejected",
);

eq(
  validatePortOnePaidPayment(
    { ...paid, status: "READY" },
    {
      paymentId,
      storeId: "store_test",
      amount: 190000,
      currency: "KRW",
    },
  ).reason,
  "payment_not_paid",
  "non-PAID status is rejected",
);

eq(
  validatePortOnePaidPayment(
    { ...paid, storeId: "other_store" },
    {
      paymentId,
      storeId: "store_test",
      amount: 190000,
      currency: "KRW",
    },
  ).reason,
  "store_id_mismatch",
  "wrong store is rejected",
);

eq(
  extractPortOneBillingKey({ billingKeyPayment: { billingKey: " bk_test " } }),
  "bk_test",
  "billing key extracted and trimmed",
);
eq(
  extractPortOneBillingKey({ billingKeyPayment: { billingKey: "" } }),
  null,
  "empty billing key rejected",
);

if (failed) {
  console.error(`\n${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`✓ portone.test.mjs: ${passed} passed`);
