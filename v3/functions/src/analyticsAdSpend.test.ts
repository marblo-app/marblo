// analytics_ad_spend 순수 로직 단위테스트.
// package.json: npm run test:analytics-ad-spend
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  adSpendRowId,
  buildCacSummary,
  CAC_ACQUISITION_BASIS,
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
      { campaign: "launch campaign", visitors: 400, downloaders: 4 },
      { campaign: "(organic)", visitors: 900, downloaders: 9 },
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

// ── ★CAC 분모는 방문이 아니라 다운로드·설치 (ticket IU1KDbYAv7FEewPkwHPU) ───

const SPEND = [
  {
    spendDate: "2026-08-24",
    platform: "instagram",
    campaignName: "Launch Campaign",
    campaignKey: "launch-campaign",
    amountKrw: 100000,
  },
];

test("★CAC 분모가 방문이 아니라 다운로드다 — 봇 방문이 CAC 를 부풀리지 못한다", () => {
  // 방문 1000(= 봇 990 + 사람 10) 중 다운로드까지 간 사람은 4명.
  const summary = buildCacSummary(SPEND, [
    { campaign: "Launch Campaign", visitors: 1000, downloaders: 4, downloadEvents: 6 },
  ]);

  assert.equal(summary.acquisitionBasis, CAC_ACQUISITION_BASIS);
  assert.equal(CAC_ACQUISITION_BASIS, "download");
  assert.equal(summary.acquiredFromMatchedCampaigns, 4);
  assert.equal(summary.overallCacKrw, 25000, "100,000원 / 4명");
  assert.notEqual(summary.overallCacKrw, 100, "방문 1000 을 분모로 쓰면 100원이 된다");

  const row = summary.campaigns[0];
  assert.equal(row.acquired, 4);
  assert.equal(row.acquiredBasis, "download");
  assert.equal(row.cacKrw, 25000);
  assert.equal(row.visitors, 1000, "방문은 대조용으로만 남는다");
  assert.match(
    summary.notes.join("\n"),
    /CAC 분모는 방문이 아니라 다운로드한 사람 수다/
  );
});

test("★설치 기준 CAC 를 함께 낸다 — 링크백 커버리지가 낮으면 값이 더 크다", () => {
  const summary = buildCacSummary(
    SPEND,
    [{ campaign: "Launch Campaign", visitors: 1000, downloaders: 4 }],
    [{ campaign: "launch_campaign", installs: 2 }]
  );
  assert.equal(summary.installsFromMatchedCampaigns, 2);
  assert.equal(summary.overallCacPerInstallKrw, 50000);
  assert.equal(summary.campaigns[0].installs, 2);
  assert.equal(summary.campaigns[0].cacPerInstallKrw, 50000);
  assert.ok(
    (summary.overallCacPerInstallKrw ?? 0) >= (summary.overallCacKrw ?? 0)
  );
});

test("★다운로드 0 인 캠페인은 '획득' 이 아니라 미매칭 — 방문만으로 CAC 를 만들지 않는다", () => {
  const summary = buildCacSummary(SPEND, [
    { campaign: "Launch Campaign", visitors: 900, downloaders: 0 },
  ]);
  assert.equal(summary.matchedSpendKrw, 0);
  assert.equal(summary.unmatchedSpendKrw, 100000);
  assert.equal(summary.overallCacKrw, null, "0원이 아니라 '모름'");
  assert.equal(summary.unmatched[0].visitors, 900);
  assert.equal(summary.unmatched[0].cacKrw, null);
  assert.match(summary.notes.join("\n"), /미매칭 광고비 100,000원/);
});

test("설치 데이터가 없어도 다운로드 기준 CAC 는 나온다(설치 CAC 만 null)", () => {
  const summary = buildCacSummary(SPEND, [
    { campaign: "Launch Campaign", visitors: 10, downloaders: 5 },
  ]);
  assert.equal(summary.overallCacKrw, 20000);
  assert.equal(summary.overallCacPerInstallKrw, null);
  assert.equal(summary.campaigns[0].cacPerInstallKrw, null);
});

test("BQ 가 INT64 를 문자열로 줘도 분모를 숫자로 센다", () => {
  const summary = buildCacSummary(SPEND, [
    { campaign: "Launch Campaign", visitors: "10", downloaders: "4" },
  ]);
  assert.equal(summary.acquiredFromMatchedCampaigns, 4);
  assert.equal(summary.overallCacKrw, 25000);
});
