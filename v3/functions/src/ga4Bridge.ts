// GA4 → US 얇은 브리지 — 순수 로직(BQ/Firebase 무의존). node --test 로 단위검증한다
// (countryFunnel.ts / installAttribution.ts 와 같은 규약).
//
// ── ★무엇을 푸나 (ticket Th9VRMvm2HkyWSjwF12X) ───────────────────────────────
// GA4 export 는 `asia-northeast3`, 앱 텔레메트리는 `US` 다. BigQuery 는 **한
// 쿼리에서 리전이 다른 데이터셋을 참조하지 못한다** — 권한 문제가 아니고
// 페더레이티드 쿼리로도 우회되지 않는다. 지금까지의 우회는 콜러블이 두 리전에
// 각각 쿼리를 던져 **메모리에서** 합치는 것이었다(countryFunnel.ts). 그 방식은
// 오늘 돌아가지만 조회할 때마다 GA4 를 다시 스캔하고, 규모 상한이 있고, 무엇보다
// SQL 로는 아무도 이 조인을 쓸 수 없다.
//
// ── ★왜 "얇은" 브리지인가 (GA4 전체 복사가 아니다) ──────────────────────────
// 우리가 필요한 건 GA4 원문 이벤트가 아니라 **한 방문자당 유입 사실 한 줄**이다.
// 그래서 집계를 **GA4 쪽(asia-northeast3)에서 먼저** 끝내고, 그 결과(방문자당
// 1행)만 US 로 옮긴다.
//   - 비용: 옮기는 바이트가 자릿수로 줄고, US 쪽 조인은 작은 테이블 하나가 된다.
//   - 개인정보: **GA4 원문 이벤트가 US 로 넘어가지 않는다.** 넘어가는 식별자도
//     원시 `user_pseudo_id` 가 아니라 비밀 솔트로 키드된 HMAC 가명(`gaKey`)이다
//     (analyticsPseudonym.ts, 솔트는 BQ 에 없고 함수 런타임 env 에만 있다).
//
// ── ★귀속 소스를 왜 traffic_source 로 골랐나 ────────────────────────────────
// GA4 export 에는 유입 정보가 **세 군데** 있고 서로 다른 값을 준다:
//
//   1. `traffic_source.{source,medium,name}`
//      = **유저 단위 최초획득(first-touch)**. 그 유저를 처음 데려온 소스이며
//        이후 세션이 무엇이든 바뀌지 않는다. 우리가 재려는 축과 정확히 같다.
//        한계: `content`/`term` 필드가 **아예 없다**(3개 필드뿐). 그리고 속성이
//        수집을 시작하기 전에 획득된 유저에게는 null 이다.
//   2. `collected_traffic_source.manual_*`
//      = **그 이벤트와 함께 수집된 값**(URL 의 utm_* 원문, gclid 등). 이벤트
//        단위라 그 자체로는 first-touch 가 아니지만, `manual_content` /
//        `manual_term` 이 존재하는 **유일한** 자리다.
//   3. `session_traffic_source_last_click.*`
//      = **세션 단위 last-click**. 이름 그대로 마지막 클릭 귀속이고 세션마다
//        값이 달라진다 — first-touch 축에 쓰면 재방문이 최초 유입을 덮는다.
//
// → 채택: **source/medium/campaign 은 (1) traffic_source**(first-touch 정의와
//   일치). **content/term 은 (2) collected_traffic_source 의 유저 최초 non-null
//   값**(1에 그 필드가 없어서 다른 선택지가 없다). (3) 은 **쓰지 않는다** —
//   last-click 이라 축이 어긋난다.
//   (1)이 통째로 null 인 유저에 한해서만 (2)로 source/medium/campaign 을 메우고,
//   어느 쪽에서 왔는지를 `attributionSource` 컬럼에 **행마다 기록**한다. 근거
//   없이 섞인 채널 축은 다음 사람이 반드시 다르게 읽는다.
//
// ── ★campaign/content/term 컬럼을 지금 비었다고 빼지 않는 이유 ──────────────
// 유료 광고 전이라 대부분 null 이다. 그러나 광고를 켜는 순간 채워져야 하고, 그때
// 스키마를 고치면 **고치기 전에 들어온 트래픽은 통째로 빈칸으로 남는다**
// (BigQuery 는 과거 파티션에 값을 소급 생성해 주지 않는다). 컬럼은 지금 만든다.

// ── 상수 ─────────────────────────────────────────────────────────────────────

/** US(`marblo_telemetry`) 에 적재되는 브리지 테이블. */
export const GA4_BRIDGE_TABLE = "ga4_first_touch";

/** 브리지의 정본 읽기 뷰 — ga_key 당 1행(가장 이른 유입). */
export const GA4_BRIDGE_CURRENT_VIEW = "ga4_first_touch_current";

/**
 * ★신원 뷰를 만들지 않는다 — 조인점은 이미 있다.
 *
 * 초안은 `install_attribution` 위에 신원 뷰를 새로 만들었다. 그건 **이미 착지한
 * 일을 두 번째로 만드는 것**이었다. `marblo_telemetry.analytics_identity` 가
 * 익명축 신원표로 이미 존재하고(`install_key` ↔ `ga_key` ↔ `ft_*`),
 * `scripts/backfill-analytics-identity.ts` 가 `gaClientId` 에서
 * `pseudonymizeAnalyticsId("ga", ...)` 로 `ga_key` 를 파생한다 —
 * 이 파일의 `deriveGaKey()` 와 **같은 kind·같은 솔트·같은 스킴**이다.
 *
 * 실측으로 확인했다(2026-08-21): 라이브 `analytics_identity` 의 non-null
 * `ga_key` 550행이 전부 `^ga_[0-9a-f]{24}$` 를 만족한다 = 우리 형식과 동일.
 * 따라서 브리지는 표 한 장만 얹으면 되고 조인은 이렇게 성립한다:
 *
 *   ga4_first_touch_current.gaKey  ⋈  analytics_identity.ga_key
 *                                       ↓ install_key
 *                                  analytics_user_daily / analytics_install_profile
 *
 * ★신원표를 두 벌 만들면 익명축 조인이 에러 없이 갈라진다(행은 쌓이고 조인만
 *   0 이 되는 조용한 실패). 여기에 신원 뷰를 다시 추가하지 마라.
 */
export const ANALYTICS_IDENTITY_TABLE = "analytics_identity";

/** 한 번의 동기화가 GA4 에서 읽어 오는 방문자 상한(방문자당 1행). */
export const GA4_SYNC_ROW_LIMIT = 200000;

/** 스케줄 1회분 조회창(일). 첫 적재는 반드시 백필로 전 구간을 한 번 덮는다. */
export const GA4_SYNC_DEFAULT_DAYS = 3;

/** 백필 최대 조회창(일). */
export const GA4_SYNC_MAX_DAYS = 400;

/** 귀속 소스 표기 — 행마다 어디서 온 값인지 남긴다. */
export const ATTRIBUTION_SOURCE_FIRST_TOUCH = "traffic_source";
export const ATTRIBUTION_SOURCE_COLLECTED = "collected_traffic_source";
export const ATTRIBUTION_SOURCE_NONE = "(none)";

// ── 행 타입 ──────────────────────────────────────────────────────────────────

/** GA4(서울) 집계 쿼리가 돌려주는 한 행. 값은 전부 신뢰하지 않는다(unknown). */
export interface Ga4BridgeSourceRow {
  gaClientId: unknown;
  country: unknown;
  region: unknown;
  tsSource: unknown;
  tsMedium: unknown;
  tsCampaign: unknown;
  ctSource: unknown;
  ctMedium: unknown;
  ctCampaign: unknown;
  content: unknown;
  term: unknown;
  firstVisitDate: unknown;
  deviceCategory: unknown;
  landingPage: unknown;
  downloads: unknown;
}

/** US 브리지 테이블에 적히는 한 행. **raw gaClientId 는 여기 없다.** */
export interface Ga4BridgeRow {
  /** HMAC 가명. 원시 GA4 client_id 는 US 로 넘어가지 않는다. */
  gaKey: string;
  country: string | null;
  region: string | null;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  /** 유료 광고 전이라 지금은 대부분 null — 컬럼을 빼면 안 된다(머리말 참고). */
  content: string | null;
  term: string | null;
  /** `YYYY-MM-DD`. GA4 event_date 의 최솟값. */
  firstVisitDate: string | null;
  deviceCategory: string | null;
  /**
   * 쿼리스트링을 **버린** host+path. utm 은 이미 컬럼으로 실리고, 랜딩 URL 의
   * 쿼리에는 개인을 가리킬 수 있는 토큰이 섞여 들어온다.
   */
  landingPage: string | null;
  downloads: number;
  /** `traffic_source` | `collected_traffic_source` | `(none)`. */
  attributionSource: string;
  syncedAt: string;
}

// ── 정규화 ───────────────────────────────────────────────────────────────────

const MAX_FIELD = 200;

/** 제어문자 제거 + 길이 제한. 빈 값은 null(BQ NULL). */
export function cleanBridgeField(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const v = raw
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, MAX_FIELD);
  return v.length > 0 ? v : null;
}

/** BQ 가 INT64 를 문자열로 돌려주는 경우가 있다(countryFunnel 과 같은 방어). */
export function bridgeCount(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  if (typeof raw === "string") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** GA4 client_id 형식(`<int>.<int>`). installAttribution 의 검증과 같은 규약. */
const GA_CLIENT_ID_RE = /^\d{1,20}\.\d{1,20}$/;

export function isGaClientId(raw: unknown): raw is string {
  return typeof raw === "string" && GA_CLIENT_ID_RE.test(raw.trim());
}

/** `YYYY-MM-DD` 만 통과. BQ DATE 컬럼에 쓰레기를 넣지 않는다. */
export function normalizeFirstVisitDate(raw: unknown): string | null {
  const v = cleanBridgeField(raw);
  if (!v) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/**
 * 랜딩 페이지 정규화 — **쿼리스트링과 프래그먼트를 버리고** host+path 만 남긴다.
 *
 * ★왜 버리나: utm_* 는 이미 별도 컬럼으로 실린다. 반면 랜딩 URL 의 쿼리에는
 *   메일 캠페인의 수신자 토큰처럼 개인을 가리킬 수 있는 값이 섞여 들어온다.
 *   그걸 US 브리지에 적재하면 "필요한 필드만 옮긴다" 는 이 설계의 전제가 깨진다.
 */
export function sanitizeLandingPage(raw: unknown): string | null {
  const v = cleanBridgeField(raw);
  if (!v) return null;
  try {
    const u = new URL(v);
    const path = u.pathname || "/";
    return cleanBridgeField(`${u.host}${path}`);
  } catch {
    // 절대 URL 이 아니면 경로로 보고 ? / # 앞만 취한다.
    return cleanBridgeField(v.split(/[?#]/)[0]);
  }
}

/**
 * GA4 집계 행 하나 → US 브리지 행.
 *
 * @param gaKey  이미 파생된 HMAC 가명. 여기서 솔트를 다루지 않는다(순수 유지).
 * @param syncedAt 적재 시각(ISO).
 */
export function toBridgeRow(
  raw: Ga4BridgeSourceRow,
  gaKey: string,
  syncedAt: string
): Ga4BridgeRow {
  const tsSource = cleanBridgeField(raw.tsSource);
  const tsMedium = cleanBridgeField(raw.tsMedium);
  const tsCampaign = cleanBridgeField(raw.tsCampaign);
  const ctSource = cleanBridgeField(raw.ctSource);
  const ctMedium = cleanBridgeField(raw.ctMedium);
  const ctCampaign = cleanBridgeField(raw.ctCampaign);

  // ★귀속 축 결정. traffic_source(유저 최초획득) 가 정본이고, 그게 **통째로**
  //   비어 있을 때만 collected_traffic_source 로 메운다. 두 축을 필드별로 섞지
  //   않는다 — 한 행 안에서 source 는 first-touch, medium 은 다른 축 같은
  //   조합이 나오면 채널 표가 조용히 틀린다.
  const hasFirstTouch =
    tsSource !== null || tsMedium !== null || tsCampaign !== null;
  const hasCollected =
    ctSource !== null || ctMedium !== null || ctCampaign !== null;

  let source: string | null = null;
  let medium: string | null = null;
  let campaign: string | null = null;
  let attributionSource = ATTRIBUTION_SOURCE_NONE;
  if (hasFirstTouch) {
    source = tsSource;
    medium = tsMedium;
    campaign = tsCampaign;
    attributionSource = ATTRIBUTION_SOURCE_FIRST_TOUCH;
  } else if (hasCollected) {
    source = ctSource;
    medium = ctMedium;
    campaign = ctCampaign;
    attributionSource = ATTRIBUTION_SOURCE_COLLECTED;
  }

  return {
    gaKey,
    country: cleanBridgeField(raw.country),
    region: cleanBridgeField(raw.region),
    source,
    medium,
    campaign,
    // content/term 은 traffic_source 에 존재하지 않는다 → 항상 collected 쪽 값.
    content: cleanBridgeField(raw.content),
    term: cleanBridgeField(raw.term),
    firstVisitDate: normalizeFirstVisitDate(raw.firstVisitDate),
    deviceCategory: cleanBridgeField(raw.deviceCategory),
    landingPage: sanitizeLandingPage(raw.landingPage),
    downloads: bridgeCount(raw.downloads),
    attributionSource,
    syncedAt,
  };
}

/**
 * 이미 브리지에 있는 ga_key 는 **다시 쓰지 않는다** — first-touch 는 나중 값으로
 * 덮지 않는 게 정의다. 같은 배치 안의 중복도 첫 행만 남긴다.
 */
export function selectNewBridgeRows(
  rows: readonly Ga4BridgeRow[],
  existingKeys: ReadonlySet<string>
): Ga4BridgeRow[] {
  const seen = new Set<string>();
  const out: Ga4BridgeRow[] = [];
  for (const row of rows) {
    if (!row.gaKey) continue;
    if (existingKeys.has(row.gaKey) || seen.has(row.gaKey)) continue;
    seen.add(row.gaKey);
    out.push(row);
  }
  return out;
}

/** 요청 하나당 행 수 상한을 지키기 위한 분할(BQ insert 요청 크기 한계). */
export function chunkRows<T>(rows: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error("chunk size must be a positive integer");
  }
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    out.push(rows.slice(i, i + size));
  }
  return out;
}

/** 조회창 정규화. 스케줄은 기본값, 어드민 백필만 큰 값을 준다. */
export function parseSyncDays(raw: unknown): number {
  const n =
    typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return GA4_SYNC_DEFAULT_DAYS;
  const i = Math.floor(n);
  if (i < 1) return 1;
  return i > GA4_SYNC_MAX_DAYS ? GA4_SYNC_MAX_DAYS : i;
}

// ── BigQuery 식별자 ──────────────────────────────────────────────────────────

/** 데이터셋/프로젝트 이름은 SQL 에 그대로 박히므로 화이트리스트를 강제한다. */
export function isSafeBqIdentifier(raw: unknown): raw is string {
  return typeof raw === "string" && /^[A-Za-z0-9_-]{1,1024}$/.test(raw);
}

function assertIdent(kind: string, value: string): void {
  if (!isSafeBqIdentifier(value)) {
    throw new Error(`unsafe BigQuery identifier for ${kind}`);
  }
}

// ── SQL ──────────────────────────────────────────────────────────────────────

/**
 * GA4(asia-northeast3) 집계 쿼리 — **방문자당 1행**. 이 결과만 US 로 넘어간다.
 *
 * @param opts.includeCollectedTrafficSource
 *   `collected_traffic_source` 는 비교적 최근 export 스키마에만 있다. 없는
 *   속성에서 이 컬럼을 참조하면 쿼리 전체가 죽으므로, 호출측이 실패 시 false 로
 *   1회 재시도한다. **그때도 content/term 컬럼은 사라지지 않는다 — null 이 된다.**
 */
export function buildGa4FirstTouchQuery(opts: {
  project: string;
  dataset: string;
  includeCollectedTrafficSource: boolean;
  limit?: number;
}): string {
  assertIdent("project", opts.project);
  assertIdent("GA4 dataset", opts.dataset);
  const limit = opts.limit ?? GA4_SYNC_ROW_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("limit must be a positive integer");
  }

  const collected = opts.includeCollectedTrafficSource
    ? `
        collected_traffic_source.manual_source        AS ct_source,
        collected_traffic_source.manual_medium        AS ct_medium,
        collected_traffic_source.manual_campaign_name AS ct_campaign,
        collected_traffic_source.manual_content       AS ct_content,
        collected_traffic_source.manual_term          AS ct_term,`
    : `
        CAST(NULL AS STRING) AS ct_source,
        CAST(NULL AS STRING) AS ct_medium,
        CAST(NULL AS STRING) AS ct_campaign,
        CAST(NULL AS STRING) AS ct_content,
        CAST(NULL AS STRING) AS ct_term,`;

  // 첫 non-null 을 **가장 이른 이벤트 순서**로 고른다 = first-touch.
  const firstOf = (col: string): string =>
    `ARRAY_AGG(${col} IGNORE NULLS ORDER BY event_timestamp LIMIT 1)[SAFE_OFFSET(0)]`;

  return `
    WITH ev AS (
      SELECT
        user_pseudo_id,
        event_timestamp,
        event_date,
        event_name,
        geo.country           AS country,
        geo.region            AS region,
        device.category       AS device_category,
        traffic_source.source AS ts_source,
        traffic_source.medium AS ts_medium,
        traffic_source.name   AS ts_campaign,${collected}
        (SELECT value.string_value FROM UNNEST(event_params)
          WHERE key = 'page_location') AS page_location
      FROM \`${opts.project}.${opts.dataset}.events_*\`
      WHERE _TABLE_SUFFIX BETWEEN
              FORMAT_DATE('%Y%m%d',
                DATE_SUB(CURRENT_DATE('Asia/Seoul'), INTERVAL @days DAY))
            AND FORMAT_DATE('%Y%m%d', CURRENT_DATE('Asia/Seoul'))
        AND user_pseudo_id IS NOT NULL
    )
    SELECT
      user_pseudo_id                                AS gaClientId,
      ${firstOf("country")}                         AS country,
      ${firstOf("region")}                          AS region,
      ${firstOf("ts_source")}                       AS tsSource,
      ${firstOf("ts_medium")}                       AS tsMedium,
      ${firstOf("ts_campaign")}                     AS tsCampaign,
      ${firstOf("ct_source")}                       AS ctSource,
      ${firstOf("ct_medium")}                       AS ctMedium,
      ${firstOf("ct_campaign")}                     AS ctCampaign,
      ${firstOf("ct_content")}                      AS content,
      ${firstOf("ct_term")}                         AS term,
      FORMAT_DATE('%Y-%m-%d', MIN(PARSE_DATE('%Y%m%d', event_date)))
                                                    AS firstVisitDate,
      ${firstOf("device_category")}                 AS deviceCategory,
      ${firstOf("page_location")}                   AS landingPage,
      COUNTIF(event_name = 'download')              AS downloads
    FROM ev
    GROUP BY gaClientId
    LIMIT ${limit}
  `;
}

/** 브리지에 이미 있는 ga_key 조회. 후보 집합으로 좁혀 전량 스캔을 피한다. */
export function buildExistingKeysQuery(opts: {
  project: string;
  dataset: string;
}): string {
  assertIdent("project", opts.project);
  assertIdent("dataset", opts.dataset);
  return `
    SELECT DISTINCT gaKey
    FROM \`${opts.project}.${opts.dataset}.${GA4_BRIDGE_TABLE}\`
    WHERE gaKey IN UNNEST(@keys)
  `;
}

/**
 * 브리지 정본 읽기 뷰. ga_key 당 **가장 이른 유입 1행**만 남긴다.
 *
 * ★왜 뷰가 따로 필요한가: 적재는 streaming insert 라 방금 넣은 행이 잠깐
 *   조회에 안 잡힐 수 있고(streaming buffer), 그 창에 재실행이 겹치면 같은
 *   ga_key 가 두 번 들어갈 수 있다. 쓰기 쪽 중복 제거만 믿지 않고 **읽기에서도**
 *   first-touch 를 강제한다. 백필을 나중에 돌려 더 이른 유입을 발견해도 이
 *   뷰에서 자동으로 그쪽이 이긴다.
 */
export function buildBridgeCurrentViewSql(opts: {
  project: string;
  dataset: string;
}): string {
  assertIdent("project", opts.project);
  assertIdent("dataset", opts.dataset);
  return `
    SELECT * EXCEPT(rn)
    FROM (
      SELECT
        b.*,
        ROW_NUMBER() OVER (
          PARTITION BY gaKey
          ORDER BY firstVisitDate ASC NULLS LAST, syncedAt ASC
        ) AS rn
      FROM \`${opts.project}.${opts.dataset}.${GA4_BRIDGE_TABLE}\` AS b
    )
    WHERE rn = 1
  `;
}


// ── 스키마 ───────────────────────────────────────────────────────────────────

/**
 * 브리지 테이블 스키마.
 *
 * ★`campaign` / `content` / `term` 은 **지금 거의 전부 null 이다**(유료 광고 전).
 *   그렇다고 빼면 안 된다 — 광고를 켜는 순간 채워져야 하는데 그때 컬럼을
 *   추가하면 추가 이전 트래픽은 영영 빈칸이다. 지금 만들어 둔다.
 * ★기존 테이블에 나중에 덧붙일 컬럼은 전부 NULLABLE 이어야 한다. REQUIRED 를
 *   덧붙이는 건 BigQuery 가 거부하고, 거부당하면 적재가 통째로 막힌다.
 */
export const GA4_BRIDGE_SCHEMA = [
  { name: "gaKey", type: "STRING", mode: "REQUIRED" },
  { name: "country", type: "STRING", mode: "NULLABLE" },
  { name: "region", type: "STRING", mode: "NULLABLE" },
  { name: "source", type: "STRING", mode: "NULLABLE" },
  { name: "medium", type: "STRING", mode: "NULLABLE" },
  { name: "campaign", type: "STRING", mode: "NULLABLE" },
  { name: "content", type: "STRING", mode: "NULLABLE" },
  { name: "term", type: "STRING", mode: "NULLABLE" },
  { name: "firstVisitDate", type: "DATE", mode: "NULLABLE" },
  { name: "deviceCategory", type: "STRING", mode: "NULLABLE" },
  { name: "landingPage", type: "STRING", mode: "NULLABLE" },
  { name: "downloads", type: "INT64", mode: "NULLABLE" },
  { name: "attributionSource", type: "STRING", mode: "NULLABLE" },
  { name: "syncedAt", type: "TIMESTAMP", mode: "REQUIRED" },
] as const;
