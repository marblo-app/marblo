// 포트원 간편결제(EASY_PAY / 카카오페이/토스페이) 빌링키 축 단위테스트.
//
// 실행:
//   cd v3/functions && npm run test:portone-easypay
//
// 커버:
//  - 발급수단 정규화(레거시 구독 문서 = 카드)
//  - easyPayProvider allowlist (배선 안 된 간편결제사 차단)
//  - 채널키 선택: 간편결제 빌링키는 provider 별 발급 채널에 묶인다
//  - 수동 승인('NEEDS_CONFIRMATION' + billingIssueToken) 판정 — 카드에 없는 단계
//  - 갱신 크론 스킵 가드: 간편결제는 name/phone 없이도 청구 가능해야 한다
//    (소스 미러: v3/functions/src/index.ts scheduledChargePortOneSubscriptions)

import {
  normalizePortOneBillingKeyMethod,
  normalizeEasyPayProvider,
  enabledPortOneEasyPayProviders,
  portOneEasyPayChannelKeysForPurpose,
  resolvePortOneChannelKey,
  needsBillingKeyConfirmation,
  resolveIssuedBillingKey,
  PORTONE_BILLING_KEY_NEEDS_CONFIRMATION,
  SUPPORTED_EASY_PAY_PROVIDERS,
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

// ─── 발급수단 정규화 ────────────────────────────────────────────────
eq(
  normalizePortOneBillingKeyMethod("EASY_PAY"),
  "EASY_PAY",
  "EASY_PAY is preserved",
);
eq(
  normalizePortOneBillingKeyMethod("easy_pay"),
  "EASY_PAY",
  "method is case-insensitive",
);
eq(normalizePortOneBillingKeyMethod("CARD"), "CARD", "CARD is preserved");
// ★레거시 구독 문서에는 이 필드가 없다 — 카드로 읽혀야 갱신이 안 깨진다.
eq(
  normalizePortOneBillingKeyMethod(undefined),
  "CARD",
  "legacy subscription (no field) falls back to CARD",
);
eq(
  normalizePortOneBillingKeyMethod("PAYPAL"),
  "CARD",
  "unwired method falls back to CARD",
);

// ─── easyPayProvider allowlist ──────────────────────────────────────
eq(
  normalizeEasyPayProvider("KAKAOPAY"),
  "KAKAOPAY",
  "KAKAOPAY is the first wired provider",
);
eq(
  normalizeEasyPayProvider("kakaopay"),
  "KAKAOPAY",
  "provider is case-insensitive",
);
eq(
  normalizeEasyPayProvider("TOSSPAY"),
  "TOSSPAY",
  "TOSSPAY stays allowlisted for future env-only reactivation",
);
eq(
  normalizeEasyPayProvider("PAYCO"),
  null,
  "unwired provider is rejected",
);
eq(normalizeEasyPayProvider(""), null, "empty provider is rejected");
eq(normalizeEasyPayProvider(undefined), null, "missing provider is rejected");
assert(
  SUPPORTED_EASY_PAY_PROVIDERS.includes("KAKAOPAY"),
  "KAKAOPAY is in the supported list",
);
assert(
  SUPPORTED_EASY_PAY_PROVIDERS.includes("TOSSPAY"),
  "TOSSPAY is in the supported list for future env-only reactivation",
);

// ─── 채널키 선택 ────────────────────────────────────────────────────
eq(
  resolvePortOneChannelKey({
    purpose: "billing",
    method: "EASY_PAY",
    cardChannelKey: "ch_card",
    easyPayProvider: "KAKAOPAY",
    easyPayChannelKeys: {
      billing: { KAKAOPAY: "ch_kakao_billing", TOSSPAY: "ch_toss_billing" },
      onetime: { KAKAOPAY: "ch_kakao_onetime" },
    },
  }),
  "ch_kakao_billing",
  "KAKAOPAY billing uses the KAKAOPAY channel",
);
eq(
  resolvePortOneChannelKey({
    purpose: "billing",
    method: "EASY_PAY",
    cardChannelKey: "ch_card",
    easyPayProvider: "TOSSPAY",
    easyPayChannelKeys: {
      billing: { KAKAOPAY: "ch_kakao_billing", TOSSPAY: "ch_toss_billing" },
      onetime: { KAKAOPAY: "ch_kakao_onetime" },
    },
  }),
  "ch_toss_billing",
  "TOSSPAY billing uses the TOSSPAY channel when env is later added",
);
eq(
  resolvePortOneChannelKey({
    purpose: "billing",
    method: "EASY_PAY",
    cardChannelKey: "ch_card",
    easyPayProvider: "TOSSPAY",
    easyPayChannelKeys: {
      billing: { KAKAOPAY: "ch_kakao_billing" },
      onetime: { TOSSPAY: "ch_toss_onetime" },
    },
  }),
  "",
  "configured EASY_PAY provider without a channel does not borrow the card channel",
);
eq(
  resolvePortOneChannelKey({
    purpose: "billing",
    method: "EASY_PAY",
    cardChannelKey: "ch_card",
    easyPayProvider: null,
    easyPayChannelKeys: {
      billing: { KAKAOPAY: "ch_kakao_billing" },
      onetime: { KAKAOPAY: "ch_kakao_onetime" },
    },
  }),
  "ch_card",
  "legacy EASY_PAY without provider falls back to the card billing channel",
);
// ★카드 빌링키가 간편결제 채널로 새면 PG 가 거절한다.
eq(
  resolvePortOneChannelKey({
    purpose: "billing",
    method: "CARD",
    cardChannelKey: "ch_card",
    easyPayProvider: "KAKAOPAY",
    easyPayChannelKeys: {
      billing: { KAKAOPAY: "ch_kakao_billing" },
      onetime: { KAKAOPAY: "ch_kakao_onetime" },
    },
  }),
  "ch_card",
  "CARD never borrows the easy-pay channel",
);
// ★같은 provider 면 첫청구와 갱신이 같은 채널을 골라야 한다(빌링키는 채널에 묶임).
eq(
  resolvePortOneChannelKey({
    purpose: "billing",
    method: "EASY_PAY",
    cardChannelKey: "ch_card",
    easyPayProvider: "KAKAOPAY",
    easyPayChannelKeys: {
      billing: { KAKAOPAY: "ch_kakao_billing", TOSSPAY: "ch_toss_billing" },
      onetime: { KAKAOPAY: "ch_kakao_onetime" },
    },
  }),
  resolvePortOneChannelKey({
    purpose: "billing",
    method: normalizePortOneBillingKeyMethod("EASY_PAY"),
    cardChannelKey: "ch_card",
    easyPayProvider: normalizeEasyPayProvider("KAKAOPAY"),
    easyPayChannelKeys: {
      billing: { KAKAOPAY: "ch_kakao_billing", TOSSPAY: "ch_toss_billing" },
      onetime: { KAKAOPAY: "ch_kakao_onetime" },
    },
  }),
  "first charge and renewal resolve to the same channel",
);

eq(
  resolvePortOneChannelKey({
    purpose: "onetime",
    method: "EASY_PAY",
    cardChannelKey: "ch_card_onetime",
    easyPayProvider: "KAKAOPAY",
    easyPayChannelKeys: {
      billing: { KAKAOPAY: "ch_kakao_billing" },
      onetime: { KAKAOPAY: "ch_kakao_onetime" },
    },
  }),
  "ch_kakao_onetime",
  "KAKAOPAY one-time uses the KAKAOPAY one-time channel",
);
eq(
  resolvePortOneChannelKey({
    purpose: "onetime",
    method: "EASY_PAY",
    cardChannelKey: "ch_card_onetime",
    easyPayProvider: "TOSSPAY",
    easyPayChannelKeys: {
      billing: { TOSSPAY: "ch_toss_billing" },
      onetime: { KAKAOPAY: "ch_kakao_onetime" },
    },
  }),
  "ch_card_onetime",
  "one-time EASY_PAY without that provider's channel falls back to Inicis card",
);
eq(
  resolvePortOneChannelKey({
    purpose: "onetime",
    method: "EASY_PAY",
    cardChannelKey: "ch_card_onetime",
    easyPayProvider: null,
    easyPayChannelKeys: {
      billing: { KAKAOPAY: "ch_kakao_billing" },
      onetime: { KAKAOPAY: "ch_kakao_onetime" },
    },
  }),
  "ch_card_onetime",
  "one-time provider missing stays on card",
);
eq(
  resolvePortOneChannelKey({
    purpose: "billing",
    method: "EASY_PAY",
    cardChannelKey: "ch_card_billing",
    easyPayProvider: "KAKAOPAY",
    easyPayChannelKeys: {
      billing: { KAKAOPAY: "ch_kakao_billing" },
      onetime: { KAKAOPAY: "ch_kakao_onetime" },
    },
  }),
  "ch_kakao_billing",
  "billing does not borrow the one-time KakaoPay channel",
);
eq(
  resolvePortOneChannelKey({
    purpose: "onetime",
    method: "EASY_PAY",
    cardChannelKey: "ch_card_onetime",
    easyPayProvider: "KAKAOPAY",
    easyPayChannelKeys: {
      billing: { KAKAOPAY: "ch_kakao_billing" },
      onetime: { KAKAOPAY: "ch_kakao_onetime" },
    },
  }),
  "ch_kakao_onetime",
  "one-time does not borrow the billing KakaoPay channel",
);

const configChannels = {
  billing: { KAKAOPAY: "channel-key-test-kakao-billing" },
  onetime: { KAKAOPAY: "channel-key-test-kakao-onetime" },
};
eq(
  JSON.stringify(
    enabledPortOneEasyPayProviders({
      purpose: "billing",
      easyPayChannelKeys: configChannels,
    }),
  ),
  JSON.stringify(["KAKAOPAY"]),
  "checkout config exposes only configured billing providers",
);
eq(
  JSON.stringify(
    enabledPortOneEasyPayProviders({
      purpose: "onetime",
      easyPayChannelKeys: configChannels,
    }),
  ),
  JSON.stringify(["KAKAOPAY"]),
  "checkout config exposes only configured one-time providers",
);
eq(
  JSON.stringify(
    portOneEasyPayChannelKeysForPurpose({
      purpose: "billing",
      easyPayChannelKeys: configChannels,
    }),
  ),
  JSON.stringify({ KAKAOPAY: "channel-key-test-kakao-billing" }),
  "checkout config returns billing channel map for billing kind",
);
eq(
  JSON.stringify(
    portOneEasyPayChannelKeysForPurpose({
      purpose: "onetime",
      easyPayChannelKeys: configChannels,
    }),
  ),
  JSON.stringify({ KAKAOPAY: "channel-key-test-kakao-onetime" }),
  "checkout config returns one-time channel map for one-time kind",
);

// ─── 수동 승인(간편결제 정기결제 승인 차이) ─────────────────────────
eq(
  PORTONE_BILLING_KEY_NEEDS_CONFIRMATION,
  "NEEDS_CONFIRMATION",
  "manual-approval sentinel matches the browser SDK contract",
);
assert(
  needsBillingKeyConfirmation({
    billingKey: "NEEDS_CONFIRMATION",
    billingIssueToken: "tok_1",
  }),
  "sentinel + token needs the confirm API",
);
assert(
  needsBillingKeyConfirmation({
    billingKey: "NEEDS_CONFIRMATION",
    billingIssueToken: "kakao-token-1",
  }),
  "KAKAOPAY billing can use the manual-confirmation token path",
);
assert(
  needsBillingKeyConfirmation({ billingKey: null, billingIssueToken: "tok_1" }),
  "missing billingKey + token needs the confirm API",
);
// ★자동 승인 채널은 진짜 빌링키를 바로 준다 — 승인 API 를 태우면 안 된다.
assert(
  !needsBillingKeyConfirmation({
    billingKey: "billing-key-abc",
    billingIssueToken: "tok_1",
  }),
  "real billing key is used as-is even if a token tags along",
);
assert(
  !needsBillingKeyConfirmation({
    billingKey: "kakao-billing-key-abc",
    billingIssueToken: null,
  }),
  "KAKAOPAY billing can use an immediately issued billing key",
);
assert(
  !needsBillingKeyConfirmation({
    billingKey: "billing-key-abc",
    billingIssueToken: null,
  }),
  "card path (no token) never hits the confirm API",
);
assert(
  !needsBillingKeyConfirmation({ billingKey: null, billingIssueToken: null }),
  "no key and no token is not confirmable",
);

// ─── 발급 빌링키 해석 ───────────────────────────────────────────────
eq(
  resolveIssuedBillingKey(" billing-key-abc "),
  "billing-key-abc",
  "billing key is trimmed",
);
// ★센티넬을 빌링키로 저장하면 매 사이클 청구가 죽는다.
eq(
  resolveIssuedBillingKey("NEEDS_CONFIRMATION"),
  null,
  "sentinel is never treated as a billing key",
);
eq(resolveIssuedBillingKey(""), null, "empty billing key rejected");
eq(resolveIssuedBillingKey(undefined), null, "missing billing key rejected");

// ─── 갱신 크론 스킵 가드 미러 ───────────────────────────────────────
// 소스: v3/functions/src/index.ts scheduledChargePortOneSubscriptions
//   EASY_PAY → email 만 필수(customer.id 는 uid 라 항상 있음)
//   CARD     → KG이니시스 요구대로 name/phone/email 전부 필수
function cronSkips(sub) {
  const method = normalizePortOneBillingKeyMethod(sub.portoneBillingKeyMethod);
  const missingCustomerFields =
    method === "EASY_PAY"
      ? !sub.customerEmail
      : !sub.customerName || !sub.customerPhone || !sub.customerEmail;
  return !sub.portoneBillingKey || missingCustomerFields;
}

assert(
  !cronSkips({
    portoneBillingKey: "bk",
    portoneBillingKeyMethod: "EASY_PAY",
    customerEmail: "a@b.com",
    customerName: null,
    customerPhone: null,
  }),
  "EASY_PAY renews without name/phone (tosspay only needs customer id + email)",
);
assert(
  cronSkips({
    portoneBillingKey: "bk",
    portoneBillingKeyMethod: "CARD",
    customerEmail: "a@b.com",
    customerName: null,
    customerPhone: null,
  }),
  "CARD still skips without name/phone (KG이니시스 requirement, unchanged)",
);
assert(
  cronSkips({
    portoneBillingKey: null,
    portoneBillingKeyMethod: "EASY_PAY",
    customerEmail: "a@b.com",
  }),
  "no billing key always skips",
);
assert(
  cronSkips({
    portoneBillingKey: "bk",
    portoneBillingKeyMethod: "EASY_PAY",
    customerEmail: null,
  }),
  "EASY_PAY still requires email",
);
assert(
  !cronSkips({
    portoneBillingKey: "bk",
    customerEmail: "a@b.com",
    customerName: "홍길동",
    customerPhone: "01012345678",
  }),
  "legacy card subscription (no method field) renews as before",
);

if (failed) {
  console.error(`\n${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`✓ portoneEasyPay.test.mjs: ${passed} passed`);
