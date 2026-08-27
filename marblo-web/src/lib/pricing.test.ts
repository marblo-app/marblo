import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { currencyForLocale, formatPlanPrice, getPlanAmount } from "./pricing";

test("pricing matrix pins KRW, USD, and Japan Pro monthly pricing", () => {
  assert.equal(getPlanAmount("pro", "monthly", "KRW"), 19_000);
  assert.equal(getPlanAmount("pro", "monthly", "USD"), 19);
  assert.equal(getPlanAmount("pro", "monthly", "JPY"), 2_980);
  assert.equal(getPlanAmount("pro", "annual", "JPY"), 29_800);
  assert.equal(currencyForLocale("ko"), "KRW");
  assert.equal(currencyForLocale("en"), "USD");
  assert.equal(currencyForLocale("ja"), "JPY");
  assert.equal(currencyForLocale("fr"), "USD");
  assert.equal(formatPlanPrice("pro", "monthly", "USD"), "$19");
  assert.equal(formatPlanPrice("pro", "monthly", "JPY"), "￥2,980");
});

test("paid pricing is present for public locales and JPY annual remains monthly times ten", () => {
  const localeCurrencyCases = [
    ["ko", "KRW"],
    ["en", "USD"],
    ["ja", "JPY"],
  ] as const;
  const paidPlans = ["pro", "team", "team_plus"] as const;
  const billings = ["monthly", "annual"] as const;

  for (const [locale, currency] of localeCurrencyCases) {
    assert.equal(currencyForLocale(locale), currency);
    for (const plan of paidPlans) {
      for (const billing of billings) {
        const amount = getPlanAmount(plan, billing, currency);
        const formatted = formatPlanPrice(plan, billing, currency);
        assert.equal(
          typeof amount,
          "number",
          `${locale}.${plan}.${billing}.${currency} must be numeric`
        );
        assert.notEqual(
          formatted,
          null,
          `${locale}.${plan}.${billing}.${currency} must not be pricePending`
        );
      }
    }
  }

  for (const plan of paidPlans) {
    assert.equal(
      getPlanAmount(plan, "annual", "JPY"),
      Number(getPlanAmount(plan, "monthly", "JPY")) * 10,
      `${plan}.annual.JPY must be monthly times ten`
    );
  }
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
