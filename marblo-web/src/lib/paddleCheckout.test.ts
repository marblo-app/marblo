import { test } from "node:test";
import assert from "node:assert/strict";
import {
  paddlePriceIdEnvKey,
  resolvePaddleCheckoutPrice,
  type PaddlePriceIds,
} from "./paddleCheckout";

const EMPTY_PRICE_IDS: PaddlePriceIds = {
  pro: {
    monthly: { USD: "", JPY: "" },
    annual: { USD: "", JPY: "" },
  },
  team: {
    monthly: { USD: "", JPY: "" },
    annual: { USD: "", JPY: "" },
  },
  team_plus: {
    monthly: { USD: "", JPY: "" },
    annual: { USD: "", JPY: "" },
  },
};

test("Paddle price id env key names are plan + billing + currency", () => {
  assert.equal(
    paddlePriceIdEnvKey("pro", "monthly", "USD"),
    "NEXT_PUBLIC_PADDLE_PRICE_ID_PRO_MONTHLY_USD",
  );
  assert.equal(
    paddlePriceIdEnvKey("team_plus", "annual", "JPY"),
    "NEXT_PUBLIC_PADDLE_PRICE_ID_TEAM_PLUS_ANNUAL_JPY",
  );
  assert.equal(
    paddlePriceIdEnvKey("team_plus", "monthly", "USD", ""),
    "PADDLE_PRICE_ID_TEAM_PLUS_MONTHLY_USD",
  );
});

test("missing Paddle price id returns null instead of a broken checkout button", () => {
  assert.equal(
    resolvePaddleCheckoutPrice({
      plan: "pro",
      billing: "monthly",
      currency: "USD",
      priceIds: EMPTY_PRICE_IDS,
    }),
    null,
  );
});

test("configured Paddle price id resolves with its env key", () => {
  const priceIds: PaddlePriceIds = {
    ...EMPTY_PRICE_IDS,
    pro: {
      ...EMPTY_PRICE_IDS.pro,
      monthly: { USD: " pri_123 ", JPY: "" },
    },
  };
  assert.deepEqual(
    resolvePaddleCheckoutPrice({
      plan: "pro",
      billing: "monthly",
      currency: "USD",
      priceIds,
    }),
    {
      priceId: "pri_123",
      envKey: "NEXT_PUBLIC_PADDLE_PRICE_ID_PRO_MONTHLY_USD",
    },
  );
});

test("Paddle checkout only accepts paid subscription plans and overseas currencies", () => {
  assert.equal(
    resolvePaddleCheckoutPrice({
      plan: "enterprise",
      billing: "monthly",
      currency: "USD",
      priceIds: EMPTY_PRICE_IDS,
    }),
    null,
  );
  assert.equal(
    resolvePaddleCheckoutPrice({
      plan: "pro",
      billing: "monthly",
      currency: "KRW",
      priceIds: EMPTY_PRICE_IDS,
    }),
    null,
  );
});
