import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPaddlePriceCatalog,
  paddlePriceCatalogByPriceId,
  paddlePriceIdEnvKey,
  resolvePaddlePriceEntry,
} from "./paddle";

test("Paddle price id env names include plan, billing cycle, and currency", () => {
  assert.equal(
    paddlePriceIdEnvKey("pro", "monthly", "USD"),
    "PADDLE_PRICE_ID_PRO_MONTHLY_USD",
  );
  assert.equal(
    paddlePriceIdEnvKey("team_plus", "annual", "JPY"),
    "PADDLE_PRICE_ID_TEAM_PLUS_ANNUAL_JPY",
  );
});

test("Paddle catalog includes empty team_plus slots without inventing values", () => {
  const entries = buildPaddlePriceCatalog({});
  assert.ok(
    entries.some(
      (entry) =>
        entry.planType === "team_plus" &&
        entry.billingCycle === "monthly" &&
        entry.currency === "USD" &&
        entry.envKey === "PADDLE_PRICE_ID_TEAM_PLUS_MONTHLY_USD" &&
        entry.priceId === "",
    ),
  );
});

test("missing Paddle price id resolves to null", () => {
  assert.equal(
    resolvePaddlePriceEntry(
      {},
      { planType: "pro", billingCycle: "monthly", currency: "USD" },
    ),
    null,
  );
});

test("configured Paddle price id resolves and can map webhook price id back to plan", () => {
  const env = {
    PADDLE_PRICE_ID_PRO_MONTHLY_USD: " pri_pro_usd ",
    PADDLE_PRICE_ID_TEAM_PLUS_ANNUAL_JPY: "pri_team_plus_jpy_annual",
  };
  const entry = resolvePaddlePriceEntry(env, {
    planType: "pro",
    billingCycle: "monthly",
    currency: "USD",
  });
  assert.deepEqual(entry, {
    planType: "pro",
    billingCycle: "monthly",
    currency: "USD",
    priceId: "pri_pro_usd",
    envKey: "PADDLE_PRICE_ID_PRO_MONTHLY_USD",
  });
  const byPriceId = paddlePriceCatalogByPriceId(buildPaddlePriceCatalog(env));
  assert.equal(byPriceId.pri_team_plus_jpy_annual.planType, "team_plus");
  assert.equal(byPriceId.pri_team_plus_jpy_annual.billingCycle, "annual");
  assert.equal(byPriceId.pri_team_plus_jpy_annual.currency, "JPY");
});

test("legacy app-side Paddle price ids remain readable as monthly USD", () => {
  const entry = resolvePaddlePriceEntry(
    { PADDLE_TEAM_PRICE_ID: "pri_team_legacy" },
    { planType: "team", billingCycle: "monthly", currency: "USD" },
  );
  assert.equal(entry?.priceId, "pri_team_legacy");
  assert.equal(entry?.envKey, "PADDLE_TEAM_PRICE_ID");
});
