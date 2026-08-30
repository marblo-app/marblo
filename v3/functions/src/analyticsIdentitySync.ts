// analytics_identity 익명축 동기화 — 순수 로직(BQ/Firebase 무의존).
// ga4Bridge.ts 와 같은 규약으로 node --test 로 단위검증한다.
//
// ── ★이 파일이 생긴 이유 (ticket EFnVgBSdcjGVRRmNQ1dK) ───────────────────────
// analytics_identity 를 채우는 코드는 scripts/backfill-analytics-identity.ts
// 하나였고 npm script(수동 실행)로만 존재했다 — 스케줄이 없었다.
// scheduledSyncGa4Bridge(index.ts)는 ga4_first_touch 만 갱신하고
// analytics_identity 로 가는 INSERT/MERGE 는 소스 어디에도 없었다. 그 결과
// 2026-08-20 백필 이후 9일간 원장(install_attribution) 신규 98행이 한 번도
// 반영되지 않았다(#1321 실측). 이 파일은 백필 스크립트의 행 조립 로직을 순수
// 함수로 뽑아 index.ts 의 스케줄 함수와 scripts/backfill-analytics-identity.ts
// 양쪽이 재사용하게 한다.
//
// ── ★멱등 설계 — DELETE 없는 append/upgrade ─────────────────────────────────
// 매 실행마다 원장(install_attribution) + 텔레메트리 최초등장을 다시 훑어
// 후보 행을 재조립한다(가명은 결정적이라 같은 입력이면 같은 install_key/ga_key
// 가 나온다). 기존 표(existing)와 비교해:
//   - existing 에 없는 install_key → INSERT
//   - existing 에 'unmapped' 로 있는데 이번 후보가 'joined' 로 풀린 install_key
//     → UPDATE(원장이 나중에 들어온 경우 — 앞으로 들어올 유입이 나중에 붙는
//     경로가 바로 이것이다. 이 티켓의 프레임 "미래 유입이 새지 않게 한다" 가
//     여기서 코드가 된다)
//   - 그 외(이미 joined, 또는 여전히 unmapped) → 손대지 않는다
// 같은 입력으로 두 번 돌리면 두 번째는 INSERT 도 UPDATE 도 0건이다
// (analyticsIdentitySync.test.ts 의 idempotency 테스트가 이를 확인한다).
//
// ★원 스크립트(DELETE FROM ... WHERE TRUE 뒤 전량 재적재)도 멱등하긴 했지만
//   실행마다 표 전체를 스트리밍으로 다시 삽입했다. 여기서는 append/upgrade 만
//   하므로 이미 있는 행은 지워지지 않는다 — 스케줄로 매일 도는 경로에 더 맞는
//   설계다.

import {
  classifyIdScheme,
  isSharedSentinel,
  resolveLinkConfidence,
  type IdScheme,
  type LinkConfidence,
} from "./analyticsIdScheme";
import { ANALYTICS_IDENTITY_TABLE } from "./ga4Bridge";

export { ANALYTICS_IDENTITY_TABLE };
export type { IdScheme, LinkConfidence };

/** 백필 하한 — scripts/backfill-analytics-identity.ts 의 SINCE 와 동일해야 한다. */
export const ANALYTICS_IDENTITY_SINCE = "2026-04-01";

/**
 * ★익명축 전용 스키마. user_key 없음(자리도 없음) —
 * scripts/backfill-analytics-identity.ts 의 SCHEMA 와 반드시 같아야 한다.
 */
export const ANALYTICS_IDENTITY_SCHEMA = [
  { name: "install_key", type: "STRING", mode: "REQUIRED" },
  { name: "ga_key", type: "STRING", mode: "NULLABLE" },
  { name: "ft_source", type: "STRING", mode: "NULLABLE" },
  { name: "ft_medium", type: "STRING", mode: "NULLABLE" },
  { name: "ft_campaign", type: "STRING", mode: "NULLABLE" },
  { name: "ft_referrer_host", type: "STRING", mode: "NULLABLE" },
  { name: "ft_landing_path", type: "STRING", mode: "NULLABLE" },
  { name: "ft_device", type: "STRING", mode: "NULLABLE" },
  { name: "first_visit_at", type: "TIMESTAMP", mode: "NULLABLE" },
  { name: "linked_at", type: "TIMESTAMP", mode: "NULLABLE" },
  { name: "id_scheme", type: "STRING", mode: "REQUIRED" },
  { name: "link_confidence", type: "STRING", mode: "REQUIRED" },
] as const;

/**
 * 동기화 관측 로그 표 — 매 실행(0건 포함)을 남긴다. `ga4_bridge_sync_log` 와
 * 같은 규약이다. ★이 티켓이 존재하는 이유가 "9일간 멈춘 걸 아무도 몰랐다"
 * 이므로, 이번엔 실행마다 여기 한 줄이 남아야 다음에 또 멈추면 안다.
 */
export const ANALYTICS_IDENTITY_SYNC_LOG_TABLE = "analytics_identity_sync_log";

export const ANALYTICS_IDENTITY_SYNC_LOG_SCHEMA = [
  { name: "syncedAt", type: "TIMESTAMP", mode: "REQUIRED" },
  { name: "telemetryInstalls", type: "INT64", mode: "NULLABLE" },
  { name: "attributionInstalls", type: "INT64", mode: "NULLABLE" },
  { name: "candidates", type: "INT64", mode: "NULLABLE" },
  { name: "inserted", type: "INT64", mode: "NULLABLE" },
  { name: "upgraded", type: "INT64", mode: "NULLABLE" },
  { name: "skippedSharedSentinel", type: "INT64", mode: "NULLABLE" },
  { name: "gaKeyNullNoLedgerRow", type: "INT64", mode: "NULLABLE" },
  { name: "gaKeyNullLedgerNoGaClientId", type: "INT64", mode: "NULLABLE" },
  { name: "ok", type: "BOOL", mode: "REQUIRED" },
  { name: "errorMessage", type: "STRING", mode: "NULLABLE" },
] as const;

/**
 * 일 1회 15:40 KST — `scheduledSyncGa4Bridge`(15:00 KST)의 40분 뒤다.
 * ★두 스케줄은 서로 기다리지 않는다(별개 함수, 별개 표). 40분 여유는 GA4
 * 브리지가 먼저 끝나 있을 시간을 벌어 줄 뿐, analytics_identity 동기화 자체는
 * install_attribution/텔레메트리만 읽고 ga4_first_touch 를 읽지 않으므로
 * 순서 의존은 없다. 분 단위로 더 잘게 쪼개지 않는다 — 이 스케줄의 목적은
 * "9일간 멈춤" 재발 방지이지 초 단위 신선도가 아니다.
 */
export const ANALYTICS_IDENTITY_SYNC_SCHEDULE_CRON = "40 15 * * *";
export const ANALYTICS_IDENTITY_SYNC_SCHEDULE_TZ = "Asia/Seoul";

// ── 행 타입 ──────────────────────────────────────────────────────────────────

export interface TelemetryFirstVisitRow {
  installId: string;
  firstVisitAt: string | null;
}

export interface AttributionLedgerRow {
  installId: string;
  gaClientId: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  referrerHost: string | null;
  landingPath: string | null;
  platform: string | null;
  linkedAt: string | null;
}

export interface AnalyticsIdentityRow {
  install_key: string;
  ga_key: string | null;
  ft_source: string | null;
  ft_medium: string | null;
  ft_campaign: string | null;
  ft_referrer_host: string | null;
  ft_landing_path: string | null;
  ft_device: string | null;
  first_visit_at: string | null;
  linked_at: string | null;
  id_scheme: IdScheme;
  link_confidence: LinkConfidence;
}

export interface BuildCandidatesResult {
  rows: AnalyticsIdentityRow[];
  skippedSharedSentinel: number;
  /**
   * ga_key 가 NULL 인 이유 ①: 원장(install_attribution)에 이 설치 행 자체가
   * 없다 — 유입 정보가 원래 존재하지 않는다. 조인은 시도할 상대가 없다.
   */
  gaKeyNullNoLedgerRow: number;
  /**
   * ga_key 가 NULL 인 이유 ②: 원장 행은 있는데 gaClientId 가 비어 있다 — 그
   * 설치는 GA4 client id 를 넘기지 못했다. 이것도 "조인 실패"가 아니라
   * "원천에 값이 없다"이지만, ①과 원인 축이 달라 고치는 법도 다르다(①은
   * 손댈 데가 없고, ②는 gaClientId 캡처 경로를 봐야 한다) — 그래서 나눠 센다.
   */
  gaKeyNullLedgerNoGaClientId: number;
}

/**
 * telemetry(설치 최초 등장) ∪ attribution(원장) → analytics_identity 후보 행.
 *
 * ★pseudonymize 를 주입받는다 — 이 함수는 솔트를 모른다(순수 유지, 단위검증
 *   가능하게 하기 위해서다). 실제 호출측(script/index.ts)이
 *   `pseudonymizeAnalyticsId` 를 넘긴다. 솔트 부재로 가명 파생이 실패한 행은
 *   호출측이 이미 막았어야 하므로 여기서는 조용히 건너뛴다(방어적 skip).
 */
export function buildAnalyticsIdentityCandidates(opts: {
  telemetryRows: ReadonlyArray<TelemetryFirstVisitRow>;
  attributionRows: ReadonlyArray<AttributionLedgerRow>;
  pseudonymizeInstall: (raw: string) => string | null;
  pseudonymizeGa: (raw: string) => string | null;
}): BuildCandidatesResult {
  const attById = new Map<string, AttributionLedgerRow>();
  for (const r of opts.attributionRows) attById.set(r.installId, r);
  const telById = new Map<string, TelemetryFirstVisitRow>();
  for (const r of opts.telemetryRows) telById.set(r.installId, r);

  const allIds = new Set<string>([...telById.keys(), ...attById.keys()]);

  const rows: AnalyticsIdentityRow[] = [];
  let skippedSharedSentinel = 0;
  let gaKeyNullNoLedgerRow = 0;
  let gaKeyNullLedgerNoGaClientId = 0;

  for (const rawId of allIds) {
    // ★공유 리터럴('anon')만 제외한다 — 키로 쓰면 인원이 뭉친다.
    if (isSharedSentinel(rawId)) {
      skippedSharedSentinel += 1;
      continue;
    }
    // ★그 외 미분류 모양은 버리지 않는다(id_scheme='unknown') — 빼면 인원이
    //   줄어 보이고 그게 "이탈"로 오독된다.
    const scheme = classifyIdScheme(rawId);

    const tel = telById.get(rawId) ?? null;
    const att = attById.get(rawId) ?? null;

    // ★joined = 익명축 양쪽(제품사용 + 유입)이 다 있다는 뜻이다. 계정축과는
    //   무관하다.
    const confidence = resolveLinkConfidence(tel !== null && att !== null);

    const installKey = opts.pseudonymizeInstall(rawId);
    if (typeof installKey !== "string") continue;

    const gaRaw = att?.gaClientId ?? null;
    const gaKey = gaRaw && gaRaw.length > 0 ? opts.pseudonymizeGa(gaRaw) : null;
    const resolvedGaKey = typeof gaKey === "string" ? gaKey : null;

    if (resolvedGaKey === null) {
      if (att === null) gaKeyNullNoLedgerRow += 1;
      else gaKeyNullLedgerNoGaClientId += 1;
    }

    rows.push({
      install_key: installKey,
      ga_key: resolvedGaKey,
      ft_source: att?.utmSource ?? null,
      ft_medium: att?.utmMedium ?? null,
      ft_campaign: att?.utmCampaign ?? null,
      ft_referrer_host: att?.referrerHost ?? null,
      ft_landing_path: att?.landingPath ?? null,
      ft_device: att?.platform ?? null,
      first_visit_at: tel?.firstVisitAt ?? null,
      linked_at: att?.linkedAt ?? null,
      id_scheme: scheme,
      link_confidence: confidence,
    });
  }

  return {
    rows,
    skippedSharedSentinel,
    gaKeyNullNoLedgerRow,
    gaKeyNullLedgerNoGaClientId,
  };
}

export interface SyncPlan {
  toInsert: AnalyticsIdentityRow[];
  toUpgrade: AnalyticsIdentityRow[];
}

/**
 * 후보 vs 기존 표(install_key → link_confidence) → 실제로 쓸 것만 가른다.
 *
 * ★멱등의 핵심: existing 에 이미 'joined' 로 있는 install_key 는 후보 값이
 *   뭐든 손대지 않는다(재계산해도 같은 값이 나오지만, 굳이 쓰지 않는다).
 *   existing 에 없으면 INSERT, 'unmapped' 였다가 'joined' 로 풀리면 UPDATE.
 *   그 외(이미 joined / 여전히 unmapped)는 skip.
 *   같은 candidates + 그 결과를 반영한 existing 으로 다시 부르면 toInsert/
 *   toUpgrade 가 둘 다 빈다 — 이게 이 함수가 보장하는 멱등성이다.
 */
export function planAnalyticsIdentitySync(
  candidates: ReadonlyArray<AnalyticsIdentityRow>,
  existing: ReadonlyMap<string, LinkConfidence>,
): SyncPlan {
  const toInsert: AnalyticsIdentityRow[] = [];
  const toUpgrade: AnalyticsIdentityRow[] = [];
  for (const row of candidates) {
    const existingConfidence = existing.get(row.install_key);
    if (existingConfidence === undefined) {
      toInsert.push(row);
      continue;
    }
    if (existingConfidence === "unmapped" && row.link_confidence === "joined") {
      toUpgrade.push(row);
    }
  }
  return { toInsert, toUpgrade };
}

// ── SQL ──────────────────────────────────────────────────────────────────────

/**
 * 텔레메트리(익명 세계)에 등장한 설치와 **최초 등장 시각**.
 * `@since` 는 쿼리 파라미터로 넘긴다 — SQL 문자열에 값을 꿰매지 않는다.
 */
export function buildTelemetryFirstVisitSql(opts: {
  project: string;
  dataset: string;
}): string {
  return `
    WITH u AS (
      SELECT userId AS installId, timestamp AS ts
      FROM \`${opts.project}.${opts.dataset}.agent_heartbeats\`
      WHERE userId IS NOT NULL AND timestamp >= TIMESTAMP(@since)
      UNION ALL
      SELECT userId AS installId, timestamp AS ts
      FROM \`${opts.project}.${opts.dataset}.events\`
      WHERE userId IS NOT NULL AND timestamp >= TIMESTAMP(@since)
    )
    SELECT installId, MIN(ts) AS firstVisitAt
    FROM u GROUP BY installId
  `;
}

/** 어트리뷰션 원장 첫 행(설치당 가장 이른 linkedAt) — first-touch 는 뒤 행으로 덮지 않는다. */
export function buildAttributionLedgerSql(opts: {
  project: string;
  dataset: string;
}): string {
  return `
    SELECT installId, gaClientId, utmSource, utmMedium, utmCampaign,
           referrerHost, landingPath, platform, linkedAt
    FROM (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY installId ORDER BY linkedAt ASC
      ) AS rn
      FROM \`${opts.project}.${opts.dataset}.install_attribution\`
      WHERE installId IS NOT NULL
    )
    WHERE rn = 1
  `;
}

/** 기존 표 전체의 (install_key, link_confidence) — 멱등 판정의 기준선. */
export function buildExistingIdentityRowsQuery(opts: {
  project: string;
  dataset: string;
}): string {
  return `
    SELECT install_key, link_confidence
    FROM \`${opts.project}.${opts.dataset}.${ANALYTICS_IDENTITY_TABLE}\`
  `;
}

/**
 * unmapped → joined 승격 1행. ★WHERE 에 `link_confidence = 'unmapped'` 를
 *   다시 건다 — Node 쪽 planAnalyticsIdentitySync 가 이미 걸러도, DB 쪽에서도
 *   같은 조건을 걸어 두면 두 겹으로 멱등이 보장된다(동시 실행·재시도에도
 *   이미 joined 인 행을 건드리지 않는다).
 */
export function buildUpgradeIdentityRowSql(opts: {
  project: string;
  dataset: string;
}): string {
  return `
    UPDATE \`${opts.project}.${opts.dataset}.${ANALYTICS_IDENTITY_TABLE}\`
    SET ga_key = @ga_key,
        ft_source = @ft_source,
        ft_medium = @ft_medium,
        ft_campaign = @ft_campaign,
        ft_referrer_host = @ft_referrer_host,
        ft_landing_path = @ft_landing_path,
        ft_device = @ft_device,
        linked_at = @linked_at,
        link_confidence = @link_confidence
    WHERE install_key = @install_key
      AND link_confidence = 'unmapped'
  `;
}

/** `buildUpgradeIdentityRowSql` 파라미터의 BQ 타입 — null 값 파라미터에만 필요하다. */
const UPGRADE_ROW_PARAM_TYPES: Record<string, string> = {
  ga_key: "STRING",
  ft_source: "STRING",
  ft_medium: "STRING",
  ft_campaign: "STRING",
  ft_referrer_host: "STRING",
  ft_landing_path: "STRING",
  ft_device: "STRING",
  linked_at: "TIMESTAMP",
  link_confidence: "STRING",
  install_key: "STRING",
};

/**
 * `buildUpgradeIdentityRowSql` 에 넘길 params/types 쌍을 조립한다.
 *
 * ★실측(2026-08-30, @google-cloud/bigquery 8.3.1): 값이 있는 파라미터에
 *   명시적으로 `types` 를 씌우면(DATE 든 TIMESTAMP 든) 그 값이 **조용히
 *   NULL 로 바인딩된다** — 에러 없이 결과만 틀린다. 반대로 null 값
 *   파라미터는 `types` 를 안 주면 "Parameter types must be provided for
 *   null values" 로 던진다. 그래서 **null 인 필드에만** types 를 채운다 —
 *   값이 있는 필드는 클라이언트의 자동판정(STRING)에 맡기고, BQ 가 UPDATE
 *   SET 대상 컬럼 타입으로 그 STRING 리터럴을 캐스팅하게 둔다.
 */
export function buildUpgradeIdentityRowParams(row: AnalyticsIdentityRow): {
  params: Record<string, unknown>;
  types: Record<string, string>;
} {
  const params: Record<string, unknown> = {
    ga_key: row.ga_key,
    ft_source: row.ft_source,
    ft_medium: row.ft_medium,
    ft_campaign: row.ft_campaign,
    ft_referrer_host: row.ft_referrer_host,
    ft_landing_path: row.ft_landing_path,
    ft_device: row.ft_device,
    linked_at: row.linked_at,
    link_confidence: row.link_confidence,
    install_key: row.install_key,
  };
  const types: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === null) {
      types[key] = UPGRADE_ROW_PARAM_TYPES[key];
    }
  }
  return { params, types };
}

/** 표 한 줄 요약 — 어드민 신선도 확인용. */
export function buildIdentityStatsQuery(opts: {
  project: string;
  dataset: string;
}): string {
  return `
    SELECT
      COUNT(*) AS rowCount,
      COUNTIF(ga_key IS NOT NULL) AS gaKeyPresent,
      COUNTIF(link_confidence = 'unmapped') AS unmappedCount,
      CAST(MAX(linked_at) AS STRING) AS maxLinkedAt
    FROM \`${opts.project}.${opts.dataset}.${ANALYTICS_IDENTITY_TABLE}\`
  `;
}

/** 마지막 실행 한 줄. 0건 실행도 행이 남는다(관측 지점). */
export function buildLatestIdentitySyncLogQuery(opts: {
  project: string;
  dataset: string;
}): string {
  return `
    SELECT
      FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', syncedAt) AS lastSyncedAt,
      telemetryInstalls,
      attributionInstalls,
      candidates,
      inserted,
      upgraded,
      skippedSharedSentinel,
      gaKeyNullNoLedgerRow,
      gaKeyNullLedgerNoGaClientId,
      ok,
      errorMessage
    FROM \`${opts.project}.${opts.dataset}.${ANALYTICS_IDENTITY_SYNC_LOG_TABLE}\`
    ORDER BY syncedAt DESC
    LIMIT 1
  `;
}

// ── 파싱 헬퍼 ────────────────────────────────────────────────────────────────

/** BQ 가 `{ value }` 로 감싸 주는 스칼라를 벗긴다(ga4Bridge.unwrapBqValue 와 동일 규약). */
function unwrap(raw: unknown): unknown {
  let cur: unknown = raw;
  for (let i = 0; i < 4; i++) {
    if (cur && typeof cur === "object" && "value" in cur) {
      cur = (cur as { value: unknown }).value;
      continue;
    }
    break;
  }
  return cur;
}

function toCount(raw: unknown): number {
  const v = unwrap(raw);
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function toNullableCount(raw: unknown): number | null {
  const v = unwrap(raw);
  if (v === null || v === undefined || v === "") return null;
  return toCount(v);
}

function toNullableString(raw: unknown): string | null {
  const v = unwrap(raw);
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

export interface AnalyticsIdentityStats {
  rowCount: number;
  gaKeyPresent: number;
  unmappedCount: number;
  maxLinkedAt: string | null;
}

export function emptyAnalyticsIdentityStats(): AnalyticsIdentityStats {
  return { rowCount: 0, gaKeyPresent: 0, unmappedCount: 0, maxLinkedAt: null };
}

export function parseIdentityStatsRow(raw: unknown): AnalyticsIdentityStats {
  if (!raw || typeof raw !== "object") return emptyAnalyticsIdentityStats();
  const row = raw as Record<string, unknown>;
  return {
    rowCount: toCount(row.rowCount),
    gaKeyPresent: toCount(row.gaKeyPresent),
    unmappedCount: toCount(row.unmappedCount),
    maxLinkedAt: toNullableString(row.maxLinkedAt),
  };
}

export interface AnalyticsIdentitySyncLogRow {
  lastSyncedAt: string | null;
  telemetryInstalls: number | null;
  attributionInstalls: number | null;
  candidates: number | null;
  inserted: number | null;
  upgraded: number | null;
  skippedSharedSentinel: number | null;
  gaKeyNullNoLedgerRow: number | null;
  gaKeyNullLedgerNoGaClientId: number | null;
  ok: boolean | null;
  errorMessage: string | null;
}

export function parseIdentitySyncLogRow(
  raw: unknown,
): AnalyticsIdentitySyncLogRow | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const okRaw = unwrap(row.ok);
  let ok: boolean | null = null;
  if (typeof okRaw === "boolean") ok = okRaw;
  else if (okRaw === "true") ok = true;
  else if (okRaw === "false") ok = false;
  return {
    lastSyncedAt: toNullableString(row.lastSyncedAt),
    telemetryInstalls: toNullableCount(row.telemetryInstalls),
    attributionInstalls: toNullableCount(row.attributionInstalls),
    candidates: toNullableCount(row.candidates),
    inserted: toNullableCount(row.inserted),
    upgraded: toNullableCount(row.upgraded),
    skippedSharedSentinel: toNullableCount(row.skippedSharedSentinel),
    gaKeyNullNoLedgerRow: toNullableCount(row.gaKeyNullNoLedgerRow),
    gaKeyNullLedgerNoGaClientId: toNullableCount(
      row.gaKeyNullLedgerNoGaClientId,
    ),
    ok,
    errorMessage: toNullableString(row.errorMessage),
  };
}
