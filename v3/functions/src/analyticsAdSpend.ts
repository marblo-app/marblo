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
 *
 * ★CAC denominator (ticket IU1KDbYAv7FEewPkwHPU):
 * the denominator is **downloaders / installs, never visits**. Bots do not
 * download, install, and run an Electron desktop app, so a download-based
 * denominator is the strongest bot filter we have and it costs nothing — no
 * rule, no threshold, no country list. A visit-based denominator inflated CAC
 * denominators with traffic that cannot convert, which made overseas channels
 * read worse than they are. See botTraffic.ts for the second line of defense
 * (single-fingerprint concentration) that only matters on the visit axis.
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

/**
 * `ga4_first_touch_current` 를 캠페인으로 접은 한 줄.
 *
 * ★`acquired`(방문 수) 필드는 의도적으로 없앴다. 남겨 두면 구 호출부가 조용히
 *   방문 기준 CAC 를 계속 그린다 — 컴파일 에러로 드러나게 한다.
 */
export interface FirstTouchCampaignRow {
  campaign: unknown;
  /** ★CAC 분모. `download` 이벤트가 1건 이상인 **사람 수**. */
  downloaders: unknown;
  /** 다운로드 이벤트 수(사람 수가 아니다). 참고 표기 전용. */
  downloadEvents?: unknown;
  /** 방문 수 — **분모로 쓰지 않는다.** 대조용으로만 표에 남는다. */
  visitors?: unknown;
}

/** `install_attribution` 를 캠페인으로 접은 한 줄. 보조 분모(설치). */
export interface CampaignInstallRow {
  campaign: unknown;
  installs: unknown;
}

/**
 * ★CAC 분모의 정의. 방문이 아니다.
 *
 * 완료기준에 이 상수와 아래 `buildCacSummary` 의 계산이 단위 테스트로 고정돼
 * 있다(analyticsAdSpend.test.ts).
 */
export const CAC_ACQUISITION_BASIS = "download" as const;

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
  /** ★CAC 분모 = 다운로드한 사람 수. 방문이 아니다. */
  acquired: number;
  acquiredBasis: typeof CAC_ACQUISITION_BASIS;
  /** 보조 분모. 링크백이 도달한 설치 수. */
  installs: number;
  /** 참고 표기 전용 — 분모가 아니다. */
  visitors: number;
  /** `spendKrw / acquired`. 다운로드 0 이면 null(0 원이 아니다). */
  cacKrw: number | null;
  /** `spendKrw / installs`. 설치 0 이면 null. */
  cacPerInstallKrw: number | null;
}

export interface CacSummary {
  acquisitionBasis: typeof CAC_ACQUISITION_BASIS;
  matchedSpendKrw: number;
  unmatchedSpendKrw: number;
  acquiredFromMatchedCampaigns: number;
  installsFromMatchedCampaigns: number;
  overallCacKrw: number | null;
  overallCacPerInstallKrw: number | null;
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

/**
 * 광고비 원장 × 획득 = CAC.
 *
 * ★분모는 **다운로드한 사람 수**(`firstTouchRows[].downloaders`)다. 방문이
 *   아니다. 방문 분모는 봇 유입을 그대로 삼켜 CAC 를 부풀렸고, 그 위에 광고비
 *   판단이 쌓이고 있었다(ticket IU1KDbYAv7FEewPkwHPU).
 * ★설치(`installRows`)는 보조 분모다 — 링크백이 도달한 설치만 세므로
 *   다운로드보다 항상 작거나 같고, 링크백 커버리지가 낮은 동안 기본 분모로
 *   쓰면 CAC 가 과대 표시된다. 그래서 `cacKrw` 는 다운로드, `cacPerInstallKrw`
 *   는 설치 기준으로 **둘 다** 내보낸다.
 * ★미매칭 광고비는 버리지 않는다(#1193 과 같은 원칙).
 */
export function buildCacSummary(
  spendRows: ReadonlyArray<AdSpendSummaryRow>,
  firstTouchRows: ReadonlyArray<FirstTouchCampaignRow>,
  installRows: ReadonlyArray<CampaignInstallRow> = []
): CacSummary {
  const count = (value: unknown): number => {
    const n = Number(value ?? 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  const acquiredByKey = new Map<string, number>();
  const visitorsByKey = new Map<string, number>();
  for (const row of firstTouchRows) {
    const key = normalizeCampaignKey(row.campaign);
    if (!key) continue;
    acquiredByKey.set(key, (acquiredByKey.get(key) ?? 0) + count(row.downloaders));
    visitorsByKey.set(key, (visitorsByKey.get(key) ?? 0) + count(row.visitors));
  }

  const installsByKey = new Map<string, number>();
  for (const row of installRows) {
    const key = normalizeCampaignKey(row.campaign);
    if (!key) continue;
    installsByKey.set(key, (installsByKey.get(key) ?? 0) + count(row.installs));
  }

  const spendByKey = new Map<string, { campaignName: string; spendKrw: number }>();
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
      spendByKey.set(key, { campaignName, spendKrw: amount });
    }
  }

  let matchedSpendKrw = 0;
  let unmatchedSpendKrw = 0;
  let acquiredFromMatchedCampaigns = 0;
  let installsFromMatchedCampaigns = 0;
  const campaigns: CacCampaignSummary[] = [];
  const unmatched: CacCampaignSummary[] = [];

  for (const [campaignKey, spend] of spendByKey.entries()) {
    const acquired = acquiredByKey.get(campaignKey) ?? 0;
    const installs = installsByKey.get(campaignKey) ?? 0;
    const row: CacCampaignSummary = {
      campaignKey,
      campaignName: spend.campaignName,
      spendKrw: spend.spendKrw,
      acquired,
      acquiredBasis: CAC_ACQUISITION_BASIS,
      installs,
      visitors: visitorsByKey.get(campaignKey) ?? 0,
      cacKrw: acquired > 0 ? spend.spendKrw / acquired : null,
      cacPerInstallKrw: installs > 0 ? spend.spendKrw / installs : null,
    };
    // ★매칭 판정도 다운로드 기준이다. 방문만 있는 캠페인은 '미매칭' 으로
    //   드러난다 — 방문을 획득으로 세면 봇 방문이 CAC 를 좋아 보이게 만든다.
    if (acquired > 0) {
      matchedSpendKrw += spend.spendKrw;
      acquiredFromMatchedCampaigns += acquired;
      installsFromMatchedCampaigns += installs;
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
    "★CAC 분모는 방문이 아니라 다운로드한 사람 수다 — 봇은 Electron 데스크톱을 내려받아 설치하지 않으므로 이 분모 자체가 가장 강한 봇 필터다(규칙·국가목록 불필요).",
    "설치 기준 CAC(cacPerInstallKrw)는 링크백이 도달한 설치만 세므로 다운로드 기준보다 항상 크거나 같다 — 커버리지가 오를 때까지 기본값으로 읽지 마라.",
  ];
  if (unmatchedSpendKrw > 0) {
    notes.push(
      `미매칭 광고비 ${unmatchedSpendKrw.toLocaleString("ko-KR")}원 — CAC 분자에서 조용히 버리지 않는다.`
    );
  }

  return {
    acquisitionBasis: CAC_ACQUISITION_BASIS,
    matchedSpendKrw,
    unmatchedSpendKrw,
    acquiredFromMatchedCampaigns,
    installsFromMatchedCampaigns,
    overallCacKrw:
      acquiredFromMatchedCampaigns > 0
        ? matchedSpendKrw / acquiredFromMatchedCampaigns
        : null,
    overallCacPerInstallKrw:
      installsFromMatchedCampaigns > 0
        ? matchedSpendKrw / installsFromMatchedCampaigns
        : null,
    campaigns,
    unmatched,
    notes,
  };
}
