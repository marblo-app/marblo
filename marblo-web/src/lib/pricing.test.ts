import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { currencyForLocale, formatPlanPrice, getPlanAmount } from "./pricing";

test("pricing matrix pins KRW, USD, and Japan Pro monthly pricing", () => {
  assert.equal(getPlanAmount("pro", "monthly", "KRW"), 19_000);
  assert.equal(getPlanAmount("pro", "monthly", "USD"), 19);
  assert.equal(getPlanAmount("pro", "monthly", "JPY"), 2_900);
  assert.equal(getPlanAmount("pro", "annual", "JPY"), null);
  assert.equal(currencyForLocale("ko"), "KRW");
  assert.equal(currencyForLocale("en"), "USD");
  assert.equal(currencyForLocale("ja"), "JPY");
  assert.equal(currencyForLocale("fr"), "USD");
  assert.equal(formatPlanPrice("pro", "monthly", "USD"), "$19");
  assert.equal(formatPlanPrice("pro", "monthly", "JPY"), "￥2,900");
});

test("Japan team plan pricing remains pending", () => {
  assert.equal(getPlanAmount("team", "monthly", "JPY"), null);
  assert.equal(getPlanAmount("team", "annual", "JPY"), null);
  assert.equal(getPlanAmount("team_plus", "monthly", "JPY"), null);
  assert.equal(getPlanAmount("team_plus", "annual", "JPY"), null);
  assert.equal(formatPlanPrice("team", "monthly", "JPY"), null);
  assert.equal(formatPlanPrice("team_plus", "monthly", "JPY"), null);
});

test("pricing literals do not drift outside the pricing source", () => {
  const files = [
    "src/components/PricingSection.tsx",
    "src/app/[locale]/page.tsx",
    "src/app/[locale]/checkout/page.tsx",
    "src/app/[locale]/checkout/success/page.tsx",
    "src/app/[locale]/legal/terms/page.tsx",
    "src/components/PricingGA4Tracker.tsx",
    "src/lib/schema.ts",
    "src/lib/coupon.ts",
    "messages/ko.json",
    "messages/en.json",
    "messages/ja.json",
    "../v3/src/components/settings/BillingPage.tsx",
  ];
  const forbidden = [
    "19000",
    "19,000",
    "\u20a919",
    "$15",
    "\u00a52,200",
    "\u00a53,700",
    "\u00a536,500",
  ];

  for (const file of files) {
    const content = readFileSync(resolve(process.cwd(), file), "utf8");
    for (const literal of forbidden) {
      assert.equal(
        content.includes(literal),
        false,
        `${file} must read pricing from src/lib/pricing.ts instead of containing ${literal}`
      );
    }
  }
});
