/**
 * CAC numerator source: manual ad-spend ledger.
 *
 * First paid campaigns are few and manually operated. A Google Ads/Meta sync
 * would add OAuth, account mapping, backfill, and quota failure modes before
 * there is enough volume to justify it. This ledger gives CAC a truthful
 * numerator now while keeping API imports a later, explicit task.
 *
 * Matching rule:
 * ad platforms provide campaign names, while acquisition rows expose
 * ga4_first_touch_current.campaign. We normalize both into a campaign key, but
 * unmatched spend is never dropped: reports carry unmatchedSpendKrw so CAC does
 * not look better than reality.
 */

import { pseudonymizeAnalyticsId } from "./analyticsPseudonym";

export const ANALYTICS_AD_SPEND_COLLECTION = "analyticsAdSpendLedger";
export const ANALYTICS_AD_SPEND_TABLE = "analytics_ad_spend";

export const AD_SPEND_PLATFORMS = [
  "google_ads",
  "meta",
  "youtube",
  "instagram",
  "facebook",
  "threads",
  "manual",
] as const;

export type AdSpendPlatform = (typeof AD_SPEND_PLATFORMS)[number];

export interface ManualAdSpendInput {
  spendDate?: unknown;
  platform?: unknown;
  campaignName?: unknown;
  source?: unknown;
  medium?: unknown;
  amountKrw?: unknown;
  note?: unknown;
}

export interface ManualAdSpendEntry {
  spendDate: string;
  platform: AdSpendPlatform;
  campaignName: string;
  campaignKey: string | null;
  source: string | null;
  medium: string | null;
  amountKrw: number;
  currency: "KRW";
  note: string | null;
}

export interface AdSpendLedgerRow extends ManualAdSpendEntry {
  rowId: string;
  enteredByKey: string;
  sourceDocId: string;
  createdAt: string;
  ingestedAt: string;
}

export interface FirstTouchCampaignRow {
  campaign: unknown;
  acquired: unknown;
}

export interface AdSpendSummaryRow {
  spendDate: unknown;
  platform: unknown;
  campaignName: unknown;
  campaignKey: unknown;
  amountKrw: unknown;
}

export interface CacCampaignSummary {
  campaignKey: string;
  campaignName: string;
  spendKrw: number;
  acquired: number;
  cacKrw: number | null;
}

export interface CacSummary {
  matchedSpendKrw: number;
  unmatchedSpendKrw: number;
  acquiredFromMatchedCampaigns: number;
  overallCacKrw: number | null;
  campaigns: CacCampaignSummary[];
  unmatched: CacCampaignSummary[];
  notes: string[];
}

export const ANALYTICS_AD_SPEND_SCHEMA = [
  { name: "rowId", type: "STRING", mode: "REQUIRED" },
  { name: "spendDate", type: "DATE", mode: "REQUIRED" },
  { name: "platform", type: "STRING", mode: "REQUIRED" },
  { name: "campaignName", type: "STRING", mode: "REQUIRED" },
  { name: "campaignKey", type: "STRING", mode: "NULLABLE" },
  { name: "source", type: "STRING", mode: "NULLABLE" },
  { name: "medium", type: "STRING", mode: "NULLABLE" },
  { name: "amountKrw", type: "NUMERIC", mode: "REQUIRED" },
  { name: "currency", type: "STRING", mode: "REQUIRED" },
  { name: "enteredByKey", type: "STRING", mode: "REQUIRED" },
  { name: "sourceDocId", type: "STRING", mode: "REQUIRED" },
  { name: "createdAt", type: "TIMESTAMP", mode: "REQUIRED" },
  { name: "ingestedAt", type: "TIMESTAMP", mode: "REQUIRED" },
] as const;

export function normalizeCampaignKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return normalized === "" ? null : normalized;
}

function nullableString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return trimmed.slice(0, max);
}

function parseSpendDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const date = new Date(`${trimmed}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : trimmed;
}

function parsePlatform(value: unknown): AdSpendPlatform | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return AD_SPEND_PLATFORMS.includes(normalized as AdSpendPlatform)
    ? (normalized as AdSpendPlatform)
    : null;
}

function parseAmountKrw(value: unknown): number | null {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) return null;
  const rounded = Math.round(amount);
  return rounded > 0 ? rounded : null;
}

export function parseManualAdSpendInput(
  input: ManualAdSpendInput
): { ok: true; entry: ManualAdSpendEntry } | { ok: false; reason: string } {
  const spendDate = parseSpendDate(input.spendDate);
  if (!spendDate) return { ok: false, reason: "invalid_spend_date" };

  const platform = parsePlatform(input.platform);
  if (!platform) return { ok: false, reason: "invalid_platform" };

  const campaignName = nullableString(input.campaignName, 160);
  if (!campaignName) return { ok: false, reason: "invalid_campaign_name" };

  const amountKrw = parseAmountKrw(input.amountKrw);
  if (amountKrw === null) return { ok: false, reason: "invalid_amount_krw" };

  return {
    ok: true,
    entry: {
      spendDate,
      platform,
      campaignName,
      campaignKey: normalizeCampaignKey(campaignName),
      source: nullableString(input.source, 80),
      medium: nullableString(input.medium, 80),
      amountKrw,
      currency: "KRW",
      note: nullableString(input.note, 500),
    },
  };
}

export function adSpendRowId(sourceDocId: string, salt: string | null): string | null {
  const id = pseudonymizeAnalyticsId("purchase", sourceDocId, salt);
  return typeof id === "string" ? id : null;
}

export function toAdSpendLedgerRow(params: {
  sourceDocId: string;
  entry: ManualAdSpendEntry;
  enteredByUid: string;
  salt: string | null;
  createdAt: string;
  ingestedAt: string;
}): AdSpendLedgerRow | null {
  const rowId = adSpendRowId(params.sourceDocId, params.salt);
  const enteredByKey = pseudonymizeAnalyticsId(
    "user",
    params.enteredByUid,
    params.salt
  );
  if (!rowId || typeof enteredByKey !== "string") return null;
  return {
    rowId,
    ...params.entry,
    enteredByKey,
    sourceDocId: params.sourceDocId,
    createdAt: params.createdAt,
    ingestedAt: params.ingestedAt,
  };
}

export function buildCacSummary(
  spendRows: ReadonlyArray<AdSpendSummaryRow>,
  firstTouchRows: ReadonlyArray<FirstTouchCampaignRow>
): CacSummary {
  const acquiredByKey = new Map<string, number>();
  for (const row of firstTouchRows) {
    const key = normalizeCampaignKey(row.campaign);
    if (!key) continue;
    acquiredByKey.set(key, (acquiredByKey.get(key) ?? 0) + Number(row.acquired ?? 0));
  }

  const spendByKey = new Map<
    string,
    { campaignName: string; spendKrw: number; matched: boolean }
  >();
  for (const row of spendRows) {
    const key = normalizeCampaignKey(row.campaignKey) ?? normalizeCampaignKey(row.campaignName);
    const amount = Number(row.amountKrw ?? 0);
    if (!key || !Number.isFinite(amount) || amount <= 0) continue;
    const existing = spendByKey.get(key);
    const campaignName =
      typeof row.campaignName === "string" && row.campaignName.trim()
        ? row.campaignName.trim()
        : key;
    if (existing) {
      existing.spendKrw += amount;
    } else {
      spendByKey.set(key, {
        campaignName,
        spendKrw: amount,
        matched: acquiredByKey.has(key),
      });
    }
  }

  let matchedSpendKrw = 0;
  let unmatchedSpendKrw = 0;
  let acquiredFromMatchedCampaigns = 0;
  const campaigns: CacCampaignSummary[] = [];
  const unmatched: CacCampaignSummary[] = [];

  for (const [campaignKey, spend] of spendByKey.entries()) {
    const acquired = acquiredByKey.get(campaignKey) ?? 0;
    const row: CacCampaignSummary = {
      campaignKey,
      campaignName: spend.campaignName,
      spendKrw: spend.spendKrw,
      acquired,
      cacKrw: acquired > 0 ? spend.spendKrw / acquired : null,
    };
    if (acquired > 0) {
      matchedSpendKrw += spend.spendKrw;
      acquiredFromMatchedCampaigns += acquired;
      campaigns.push(row);
    } else {
      unmatchedSpendKrw += spend.spendKrw;
      unmatched.push(row);
    }
  }

  campaigns.sort((a, b) => b.spendKrw - a.spendKrw);
  unmatched.sort((a, b) => b.spendKrw - a.spendKrw);

  const notes = [
    "CAC spend is manual append-only input; Google Ads/Meta API sync is intentionally out of scope.",
    "Campaign matching uses normalized campaign names against ga4_first_touch_current.campaign.",
  ];
  if (unmatchedSpendKrw > 0) {
    notes.push(
      `미매칭 광고비 ${unmatchedSpendKrw.toLocaleString("ko-KR")}원 — CAC 분자에서 조용히 버리지 않는다.`
    );
  }

  return {
    matchedSpendKrw,
    unmatchedSpendKrw,
    acquiredFromMatchedCampaigns,
    overallCacKrw:
      acquiredFromMatchedCampaigns > 0
        ? matchedSpendKrw / acquiredFromMatchedCampaigns
        : null,
    campaigns,
    unmatched,
    notes,
  };
}
