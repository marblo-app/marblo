// analytics_ad_spend 순수 로직 단위테스트.
// package.json: npm run test:analytics-ad-spend
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  adSpendRowId,
  buildCacSummary,
  normalizeCampaignKey,
  parseManualAdSpendInput,
  toAdSpendLedgerRow,
} from "./analyticsAdSpend";

const SALT = "0123456789abcdef0123456789abcdef";

test("normalizeCampaignKey folds platform/GA4 campaign spelling differences", () => {
  assert.equal(normalizeCampaignKey(" Launch Campaign 01 "), "launch-campaign-01");
  assert.equal(normalizeCampaignKey("Launch_Campaign-01"), "launch-campaign-01");
  assert.equal(normalizeCampaignKey("런칭 캠페인 01"), "런칭-캠페인-01");
  assert.equal(normalizeCampaignKey("   "), null);
  assert.equal(normalizeCampaignKey(null), null);
});

test("parseManualAdSpendInput validates admin manual entry shape", () => {
  const parsed = parseManualAdSpendInput({
    spendDate: "2026-08-24",
    platform: "Meta",
    campaignName: "Launch Campaign",
    source: "instagram",
    medium: "paid_social",
    amountKrw: "120000",
    note: "first run",
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) assert.fail("expected valid manual ad spend input");
  assert.equal(parsed.entry.platform, "meta");
  assert.equal(parsed.entry.amountKrw, 120000);
  assert.equal(parsed.entry.campaignKey, "launch-campaign");
  assert.equal(parsed.entry.currency, "KRW");

  assert.deepEqual(
    parseManualAdSpendInput({
      spendDate: "2026-8-24",
      platform: "meta",
      campaignName: "x",
      source: "",
      medium: "",
      amountKrw: 1,
    }),
    { ok: false, reason: "invalid_spend_date" }
  );
  assert.deepEqual(
    parseManualAdSpendInput({
      spendDate: "2026-08-24",
      platform: "unknown",
      campaignName: "x",
      source: "",
      medium: "",
      amountKrw: 1,
    }),
    { ok: false, reason: "invalid_platform" }
  );
  assert.deepEqual(
    parseManualAdSpendInput({
      spendDate: "2026-08-24",
      platform: "meta",
      campaignName: "x",
      source: "",
      medium: "",
      amountKrw: 0,
    }),
    { ok: false, reason: "invalid_amount_krw" }
  );
});

test("ad spend row ids are deterministic and salt-gated", () => {
  assert.equal(adSpendRowId("analyticsAdSpendLedger/docA", null), null);
  assert.equal(
    adSpendRowId("analyticsAdSpendLedger/docA", SALT),
    adSpendRowId("analyticsAdSpendLedger/docA", SALT)
  );
  assert.notEqual(
    adSpendRowId("analyticsAdSpendLedger/docA", SALT),
    adSpendRowId("analyticsAdSpendLedger/docB", SALT)
  );
});

test("toAdSpendLedgerRow emits only pseudonymous keys", () => {
  const parsed = parseManualAdSpendInput({
    spendDate: "2026-08-24",
    platform: "manual",
    campaignName: "Launch",
    source: null,
    medium: null,
    amountKrw: 30000,
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  const row = toAdSpendLedgerRow({
    sourceDocId: "analyticsAdSpendLedger/rawDoc",
    entry: parsed.entry,
    enteredByUid: "uid-secret",
    salt: SALT,
    createdAt: "2026-08-24T00:00:00.000Z",
    ingestedAt: "2026-08-24T00:01:00.000Z",
  });
  assert.ok(row);
  assert.match(row.rowId, /^pu_/);
  assert.match(row.enteredByKey, /^us_/);
  assert.equal(JSON.stringify(row).includes("uid-secret"), false);
});

test("buildCacSummary separates unmatched spend instead of dropping it", () => {
  const summary = buildCacSummary(
    [
      {
        spendDate: "2026-08-24",
        platform: "meta",
        campaignName: "Launch Campaign",
        campaignKey: "launch-campaign",
        amountKrw: 100000,
      },
      {
        spendDate: "2026-08-24",
        platform: "google_ads",
        campaignName: "No GA4 Match",
        campaignKey: "no-ga4-match",
        amountKrw: 70000,
      },
    ],
    [
      { campaign: "launch campaign", acquired: 4 },
      { campaign: "(organic)", acquired: 9 },
    ]
  );

  assert.equal(summary.matchedSpendKrw, 100000);
  assert.equal(summary.unmatchedSpendKrw, 70000);
  assert.equal(summary.acquiredFromMatchedCampaigns, 4);
  assert.equal(summary.overallCacKrw, 25000);
  assert.equal(summary.campaigns[0].cacKrw, 25000);
  assert.equal(summary.unmatched[0].campaignKey, "no-ga4-match");
  assert.match(summary.notes.join("\n"), /미매칭 광고비 70,000원/);
});
