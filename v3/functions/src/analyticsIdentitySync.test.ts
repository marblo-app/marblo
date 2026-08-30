import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANALYTICS_IDENTITY_SCHEMA,
  ANALYTICS_IDENTITY_SYNC_LOG_SCHEMA,
  ANALYTICS_IDENTITY_SYNC_SCHEDULE_CRON,
  buildAnalyticsIdentityCandidates,
  buildAttributionLedgerSql,
  buildExistingIdentityRowsQuery,
  buildIdentityStatsQuery,
  buildLatestIdentitySyncLogQuery,
  buildTelemetryFirstVisitSql,
  buildUpgradeIdentityRowParams,
  buildUpgradeIdentityRowSql,
  emptyAnalyticsIdentityStats,
  parseIdentityStatsRow,
  parseIdentitySyncLogRow,
  planAnalyticsIdentitySync,
  type AnalyticsIdentityRow,
  type AttributionLedgerRow,
  type LinkConfidence,
  type TelemetryFirstVisitRow,
} from "./analyticsIdentitySync";

// ── 후보 조립 ────────────────────────────────────────────────────────────────

function fakePseudonymize(prefix: string): (raw: string) => string | null {
  return (raw) => `${prefix}_${raw}`;
}

test("buildAnalyticsIdentityCandidates: joins telemetry + ledger by installId", () => {
  const telemetryRows: TelemetryFirstVisitRow[] = [
    { installId: "install-a", firstVisitAt: "2026-08-01T00:00:00Z" },
    { installId: "install-b", firstVisitAt: "2026-08-02T00:00:00Z" },
  ];
  const attributionRows: AttributionLedgerRow[] = [
    {
      installId: "install-a",
      gaClientId: "111.222",
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: null,
      referrerHost: "google.com",
      landingPath: "/",
      platform: "web",
      linkedAt: "2026-08-01T00:05:00Z",
    },
  ];

  const result = buildAnalyticsIdentityCandidates({
    telemetryRows,
    attributionRows,
    pseudonymizeInstall: fakePseudonymize("in"),
    pseudonymizeGa: fakePseudonymize("ga"),
  });

  assert.equal(result.rows.length, 2);
  const a = result.rows.find((r) => r.install_key === "in_install-a");
  const b = result.rows.find((r) => r.install_key === "in_install-b");
  assert.ok(a);
  assert.ok(b);
  assert.equal(a?.ga_key, "ga_111.222");
  assert.equal(a?.link_confidence, "joined");
  // install-b has telemetry only, no ledger row → unmapped, ga_key null.
  assert.equal(b?.ga_key, null);
  assert.equal(b?.link_confidence, "unmapped");
  assert.equal(result.gaKeyNullNoLedgerRow, 1);
  assert.equal(result.gaKeyNullLedgerNoGaClientId, 0);
});

test("buildAnalyticsIdentityCandidates: distinguishes no-ledger-row vs ledger-without-gaClientId", () => {
  const telemetryRows: TelemetryFirstVisitRow[] = [
    { installId: "no-ledger", firstVisitAt: "2026-08-01T00:00:00Z" },
    { installId: "ledger-no-ga", firstVisitAt: "2026-08-01T00:00:00Z" },
  ];
  const attributionRows: AttributionLedgerRow[] = [
    {
      installId: "ledger-no-ga",
      gaClientId: null,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      referrerHost: null,
      landingPath: null,
      platform: "web",
      linkedAt: "2026-08-01T00:05:00Z",
    },
  ];

  const result = buildAnalyticsIdentityCandidates({
    telemetryRows,
    attributionRows,
    pseudonymizeInstall: fakePseudonymize("in"),
    pseudonymizeGa: fakePseudonymize("ga"),
  });

  assert.equal(result.gaKeyNullNoLedgerRow, 1);
  assert.equal(result.gaKeyNullLedgerNoGaClientId, 1);
  const withLedger = result.rows.find(
    (r) => r.install_key === "in_ledger-no-ga",
  );
  // ledger row exists (linked_at set) but ga_key stays null — that's the
  // second NULL cause, distinct from "no ledger row at all".
  assert.equal(withLedger?.linked_at, "2026-08-01T00:05:00Z");
  assert.equal(withLedger?.ga_key, null);
});

test("buildAnalyticsIdentityCandidates: drops shared sentinel 'anon' installId", () => {
  const result = buildAnalyticsIdentityCandidates({
    telemetryRows: [{ installId: "anon", firstVisitAt: null }],
    attributionRows: [],
    pseudonymizeInstall: fakePseudonymize("in"),
    pseudonymizeGa: fakePseudonymize("ga"),
  });
  assert.equal(result.rows.length, 0);
  assert.equal(result.skippedSharedSentinel, 1);
});

// ── 멱등 계획 ────────────────────────────────────────────────────────────────

function row(
  installKey: string,
  confidence: LinkConfidence,
): AnalyticsIdentityRow {
  return {
    install_key: installKey,
    ga_key: confidence === "joined" ? `ga_${installKey}` : null,
    ft_source: null,
    ft_medium: null,
    ft_campaign: null,
    ft_referrer_host: null,
    ft_landing_path: null,
    ft_device: null,
    first_visit_at: null,
    linked_at: confidence === "joined" ? "2026-08-30T00:00:00Z" : null,
    id_scheme: "uuid36",
    link_confidence: confidence,
  };
}

test("planAnalyticsIdentitySync: new install_key -> insert", () => {
  const candidates = [row("in_1", "joined")];
  const plan = planAnalyticsIdentitySync(candidates, new Map());
  assert.equal(plan.toInsert.length, 1);
  assert.equal(plan.toUpgrade.length, 0);
});

test("planAnalyticsIdentitySync: unmapped -> joined upgrades in place", () => {
  const candidates = [row("in_1", "joined")];
  const existing = new Map<string, LinkConfidence>([["in_1", "unmapped"]]);
  const plan = planAnalyticsIdentitySync(candidates, existing);
  assert.equal(plan.toInsert.length, 0);
  assert.equal(plan.toUpgrade.length, 1);
});

test("planAnalyticsIdentitySync: already joined is left untouched", () => {
  const candidates = [row("in_1", "joined")];
  const existing = new Map<string, LinkConfidence>([["in_1", "joined"]]);
  const plan = planAnalyticsIdentitySync(candidates, existing);
  assert.equal(plan.toInsert.length, 0);
  assert.equal(plan.toUpgrade.length, 0);
});

test("planAnalyticsIdentitySync: still unmapped is left untouched", () => {
  const candidates = [row("in_1", "unmapped")];
  const existing = new Map<string, LinkConfidence>([["in_1", "unmapped"]]);
  const plan = planAnalyticsIdentitySync(candidates, existing);
  assert.equal(plan.toInsert.length, 0);
  assert.equal(plan.toUpgrade.length, 0);
});

test("planAnalyticsIdentitySync: idempotent end-to-end over two runs", () => {
  const candidates = [
    row("in_new", "joined"),
    row("in_upgrade", "joined"),
    row("in_stays_unmapped", "unmapped"),
  ];
  const existingBeforeFirstRun = new Map<string, LinkConfidence>([
    ["in_upgrade", "unmapped"],
    ["in_stays_unmapped", "unmapped"],
  ]);

  const firstPlan = planAnalyticsIdentitySync(
    candidates,
    existingBeforeFirstRun,
  );
  assert.equal(firstPlan.toInsert.length, 1);
  assert.equal(firstPlan.toUpgrade.length, 1);

  // Simulate applying the first plan: existing table now reflects it.
  const existingAfterFirstRun = new Map(existingBeforeFirstRun);
  for (const r of firstPlan.toInsert) {
    existingAfterFirstRun.set(r.install_key, r.link_confidence);
  }
  for (const r of firstPlan.toUpgrade) {
    existingAfterFirstRun.set(r.install_key, r.link_confidence);
  }

  const secondPlan = planAnalyticsIdentitySync(
    candidates,
    existingAfterFirstRun,
  );
  assert.equal(secondPlan.toInsert.length, 0);
  assert.equal(secondPlan.toUpgrade.length, 0);
});

// ── SQL 조립 ─────────────────────────────────────────────────────────────────

test("buildTelemetryFirstVisitSql / buildAttributionLedgerSql: reference expected tables", () => {
  const opts = { project: "proj", dataset: "ds" };
  const telemetrySql = buildTelemetryFirstVisitSql(opts);
  assert.match(telemetrySql, /agent_heartbeats/);
  assert.match(telemetrySql, /events/);
  assert.match(telemetrySql, /@since/);

  const attributionSql = buildAttributionLedgerSql(opts);
  assert.match(attributionSql, /install_attribution/);
  assert.match(attributionSql, /ORDER BY linkedAt ASC/);
});

test("buildExistingIdentityRowsQuery / buildUpgradeIdentityRowSql: target analytics_identity, upgrade guards on unmapped", () => {
  const opts = { project: "proj", dataset: "ds" };
  assert.match(buildExistingIdentityRowsQuery(opts), /analytics_identity/);
  const upgradeSql = buildUpgradeIdentityRowSql(opts);
  assert.match(upgradeSql, /analytics_identity/);
  assert.match(upgradeSql, /link_confidence = 'unmapped'/);
});

test("buildUpgradeIdentityRowParams: types only cover null-valued fields", () => {
  // ★실측(2026-08-30, @google-cloud/bigquery 8.3.1): 값이 있는 파라미터에
  //   명시적 types 를 씌우면 조용히 NULL 로 바인딩된다. null 값 파라미터에는
  //   types 가 없으면 클라이언트가 던진다. 그래서 null 인 필드에만 채운다.
  const fullyJoined: AnalyticsIdentityRow = {
    ...row("in_full", "joined"),
    ft_source: "google",
    ft_medium: "cpc",
    ft_campaign: "spring",
    ft_referrer_host: "google.com",
    ft_landing_path: "/",
    ft_device: "web",
  };
  const { params, types } = buildUpgradeIdentityRowParams(fullyJoined);
  assert.equal(params.install_key, "in_full");
  assert.deepEqual(types, {});

  const sparse = row("in_sparse", "joined");
  const sparseResult = buildUpgradeIdentityRowParams(sparse);
  assert.deepEqual(sparseResult.types, {
    ft_source: "STRING",
    ft_medium: "STRING",
    ft_campaign: "STRING",
    ft_referrer_host: "STRING",
    ft_landing_path: "STRING",
    ft_device: "STRING",
  });
  // ga_key/linked_at/link_confidence/install_key are non-null here — no type override.
  assert.ok(!("ga_key" in sparseResult.types));
  assert.ok(!("linked_at" in sparseResult.types));
});

test("buildIdentityStatsQuery / buildLatestIdentitySyncLogQuery: target the right tables", () => {
  const opts = { project: "proj", dataset: "ds" };
  assert.match(buildIdentityStatsQuery(opts), /analytics_identity/);
  assert.match(
    buildLatestIdentitySyncLogQuery(opts),
    /analytics_identity_sync_log/,
  );
});

// ── 파싱 ─────────────────────────────────────────────────────────────────────

test("parseIdentityStatsRow: parses wrapped BQ scalars", () => {
  const parsed = parseIdentityStatsRow({
    rowCount: { value: "691" },
    gaKeyPresent: { value: "550" },
    unmappedCount: { value: "43" },
    maxLinkedAt: { value: "2026-08-30 07:49:10" },
  });
  assert.deepEqual(parsed, {
    rowCount: 691,
    gaKeyPresent: 550,
    unmappedCount: 43,
    maxLinkedAt: "2026-08-30 07:49:10",
  });
});

test("parseIdentityStatsRow: empty on missing row", () => {
  assert.deepEqual(parseIdentityStatsRow(null), emptyAnalyticsIdentityStats());
});

test("parseIdentitySyncLogRow: parses ok flag and nullable counts", () => {
  const parsed = parseIdentitySyncLogRow({
    lastSyncedAt: "2026-08-30T15:40:00Z",
    telemetryInstalls: { value: "700" },
    attributionInstalls: { value: "648" },
    candidates: { value: "700" },
    inserted: { value: "98" },
    upgraded: { value: "0" },
    skippedSharedSentinel: { value: "0" },
    gaKeyNullNoLedgerRow: { value: "43" },
    gaKeyNullLedgerNoGaClientId: { value: "0" },
    ok: true,
    errorMessage: null,
  });
  assert.equal(parsed?.inserted, 98);
  assert.equal(parsed?.ok, true);
  assert.equal(parsed?.errorMessage, null);
});

test("planAnalyticsIdentitySync + schema sanity: no user_key column, install_key/link_confidence required", () => {
  const names: string[] = ANALYTICS_IDENTITY_SCHEMA.map((f) => f.name);
  assert.ok(!names.includes("user_key"));
  assert.ok(names.includes("install_key"));
  assert.ok(names.includes("link_confidence"));
});

test("sync log schema has no PII/raw id columns", () => {
  const names: string[] = ANALYTICS_IDENTITY_SYNC_LOG_SCHEMA.map((f) => f.name);
  assert.ok(!names.includes("install_key"));
  assert.ok(!names.includes("ga_key"));
});

test("schedule cron is daily, offset from the GA4 bridge schedule", () => {
  assert.equal(ANALYTICS_IDENTITY_SYNC_SCHEDULE_CRON, "40 15 * * *");
});
