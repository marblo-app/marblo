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

/**
 * 일 1회 15:00 KST. GA4 일별 export 는 D-1 표가 보통 10:00–12:00 KST 에
 * 생긴다(실측 2026-08-24: events_20260823 생성 ~11:28 KST). 05:30 은 그 전에
 * 돌아 D+2 가 됐다. 분·시간 단위로 올리지 않는다 — 일 단위 신선도가 목표다.
 */
export const GA4_SYNC_SCHEDULE_CRON = "0 15 * * *";
export const GA4_SYNC_SCHEDULE_TZ = "Asia/Seoul";

/**
 * 브리지 표의 firstVisitDate 폭이 이 값 이하면 **400일 백필을 한 번** 돌린다.
 * 설계 문서의 713행은 days=400 소스 쿼리였고, 라이브 표는 스케줄 3일창만
 * 받아 100행이다. 폭이 짧으면 백필이 한 번도 안 돈 것이다.
 */
export const GA4_HISTORY_BACKFILL_IF_SPAN_DAYS = 14;

/** 마지막 동기 서울 날짜가 오늘보다 이 일수 이상 뒤면 stale. */
export const GA4_FRESHNESS_STALE_AFTER_DAYS = 2;

/** 매 실행(0행 insert 포함)을 남기는 워터마크. MAX(bridge.syncedAt) 는 마지막 INSERT 라 0-insert 날이 '멈춤'으로 보인다. */
export const GA4_BRIDGE_SYNC_LOG_TABLE = "ga4_bridge_sync_log";

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
  browser: unknown;
  operatingSystem: unknown;
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
  /**
   * ★봇 지문 3축 — `device.category` / `device.web_info.browser` /
   * `device.operating_system`. 셋을 **함께** 옮기는 이유는 개별 값이 아니라
   * 조합의 집중도가 판정 축이기 때문이다(botTraffic.ts). 실측에서 Iran 106명이
   * 전부 desktop/Chrome/Macintosh 하나였고, 대조군 South Korea 201명은 15가지로
   * 흩어졌다. 개별 축만 옮기면 그 조합을 US 리전에서 다시 만들 수 없다.
   */
  deviceCategory: string | null;
  browser: string | null;
  operatingSystem: string | null;
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
  syncedAt: string,
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
    browser: cleanBridgeField(raw.browser),
    operatingSystem: cleanBridgeField(raw.operatingSystem),
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
  existingKeys: ReadonlySet<string>,
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
        device.category            AS device_category,
        device.web_info.browser    AS browser,
        device.operating_system    AS operating_system,
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
      ${firstOf("browser")}                         AS browser,
      ${firstOf("operating_system")}                AS operatingSystem,
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

/** 브리지 표 한 줄 요약 — 어드민 신선도 + 스케줄 백필 판정용. */
export function buildBridgeStatsQuery(opts: {
  project: string;
  dataset: string;
}): string {
  assertIdent("project", opts.project);
  assertIdent("dataset", opts.dataset);
  return `
    SELECT
      COUNT(*) AS rowCount,
      COUNT(DISTINCT gaKey) AS distinctGaKeys,
      CAST(MIN(firstVisitDate) AS STRING) AS minFirstVisitDate,
      CAST(MAX(firstVisitDate) AS STRING) AS maxFirstVisitDate,
      FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', MAX(syncedAt)) AS lastSyncedAt
    FROM \`${opts.project}.${opts.dataset}.${GA4_BRIDGE_TABLE}\`
  `;
}

/** 마지막 실행 한 줄. 0-insert 날도 행이 남는다. */
export function buildLatestSyncLogQuery(opts: {
  project: string;
  dataset: string;
}): string {
  assertIdent("project", opts.project);
  assertIdent("dataset", opts.dataset);
  return `
    SELECT
      FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', syncedAt) AS lastSyncedAt,
      rangeDays,
      scanned,
      eligible,
      inserted,
      skippedExisting,
      reason,
      ok,
      errorMessage
    FROM \`${opts.project}.${opts.dataset}.${GA4_BRIDGE_SYNC_LOG_TABLE}\`
    ORDER BY syncedAt DESC
    LIMIT 1
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
  // ★봇 지문 축. 기존 표에는 NULLABLE 로 덧붙는다(ensureGa4BridgeTable 의
  //   additive 마이그레이션) — 추가 이전 행은 null 이라 판정 불능 = 무죄다.
  { name: "browser", type: "STRING", mode: "NULLABLE" },
  { name: "operatingSystem", type: "STRING", mode: "NULLABLE" },
  { name: "landingPage", type: "STRING", mode: "NULLABLE" },
  { name: "downloads", type: "INT64", mode: "NULLABLE" },
  { name: "attributionSource", type: "STRING", mode: "NULLABLE" },
  { name: "syncedAt", type: "TIMESTAMP", mode: "REQUIRED" },
] as const;

export const GA4_BRIDGE_SYNC_LOG_SCHEMA = [
  { name: "syncedAt", type: "TIMESTAMP", mode: "REQUIRED" },
  { name: "rangeDays", type: "INT64", mode: "REQUIRED" },
  { name: "scanned", type: "INT64", mode: "NULLABLE" },
  { name: "eligible", type: "INT64", mode: "NULLABLE" },
  { name: "inserted", type: "INT64", mode: "NULLABLE" },
  { name: "skippedExisting", type: "INT64", mode: "NULLABLE" },
  { name: "reason", type: "STRING", mode: "NULLABLE" },
  { name: "ok", type: "BOOL", mode: "REQUIRED" },
  { name: "errorMessage", type: "STRING", mode: "NULLABLE" },
] as const;

export type Ga4BridgeSyncReason =
  | "incremental"
  | "historical-backfill"
  | "manual";

export type Ga4BridgeFreshnessStatus =
  | "not_ingested"
  | "loaded"
  | "stale"
  | "unknown";

export interface Ga4BridgeStats {
  rowCount: number;
  distinctGaKeys: number;
  minFirstVisitDate: string | null;
  maxFirstVisitDate: string | null;
  lastSyncedAt: string | null;
}

export interface Ga4BridgeSyncLogRow {
  lastSyncedAt: string | null;
  rangeDays: number | null;
  scanned: number | null;
  eligible: number | null;
  inserted: number | null;
  skippedExisting: number | null;
  reason: string | null;
  ok: boolean | null;
  errorMessage: string | null;
}

export interface Ga4BridgeFreshness {
  lastSyncedAt: string | null;
  rowCount: number;
  distinctGaKeys: number;
  minFirstVisitDate: string | null;
  maxFirstVisitDate: string | null;
  visitLagDays: number | null;
  lastSyncLagDays: number | null;
  status: Ga4BridgeFreshnessStatus;
  rangeDays: number | null;
  scanned: number | null;
  inserted: number | null;
  skippedExisting: number | null;
  reason: string | null;
  ok: boolean | null;
  errorMessage: string | null;
}

export interface Ga4BridgeSyncLogWrite {
  syncedAt: string;
  rangeDays: number;
  scanned: number | null;
  eligible: number | null;
  inserted: number | null;
  skippedExisting: number | null;
  reason: Ga4BridgeSyncReason;
  ok: boolean;
  errorMessage: string | null;
}

/** BQ 가 `{ value }` 로 감싸 주는 스칼라를 벗긴다. */
export function unwrapBqValue(raw: unknown): unknown {
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

export function seoulDateString(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error("failed to format Asia/Seoul date");
  }
  return `${year}-${month}-${day}`;
}

export function calendarDaysBetween(from: string, to: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return null;
  }
  const a = Date.UTC(
    Number(from.slice(0, 4)),
    Number(from.slice(5, 7)) - 1,
    Number(from.slice(8, 10)),
  );
  const b = Date.UTC(
    Number(to.slice(0, 4)),
    Number(to.slice(5, 7)) - 1,
    Number(to.slice(8, 10)),
  );
  return Math.round((b - a) / 86_400_000);
}

export function timestampToSeoulDate(raw: string): string | null {
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return null;
  return seoulDateString(d);
}

export function emptyGa4BridgeStats(): Ga4BridgeStats {
  return {
    rowCount: 0,
    distinctGaKeys: 0,
    minFirstVisitDate: null,
    maxFirstVisitDate: null,
    lastSyncedAt: null,
  };
}

export function parseBridgeStatsRow(raw: unknown): Ga4BridgeStats {
  if (!raw || typeof raw !== "object") return emptyGa4BridgeStats();
  const row = raw as Record<string, unknown>;
  return {
    rowCount: bridgeCount(unwrapBqValue(row.rowCount)),
    distinctGaKeys: bridgeCount(unwrapBqValue(row.distinctGaKeys)),
    minFirstVisitDate: normalizeFirstVisitDate(
      unwrapBqValue(row.minFirstVisitDate),
    ),
    maxFirstVisitDate: normalizeFirstVisitDate(
      unwrapBqValue(row.maxFirstVisitDate),
    ),
    lastSyncedAt: asTimestampIso(unwrapBqValue(row.lastSyncedAt)),
  };
}

export function parseSyncLogRow(raw: unknown): Ga4BridgeSyncLogRow | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const okRaw = unwrapBqValue(row.ok);
  let ok: boolean | null = null;
  if (typeof okRaw === "boolean") ok = okRaw;
  else if (okRaw === "true") ok = true;
  else if (okRaw === "false") ok = false;
  const reasonRaw = cleanBridgeField(unwrapBqValue(row.reason));
  const errRaw = unwrapBqValue(row.errorMessage);
  return {
    lastSyncedAt: asTimestampIso(unwrapBqValue(row.lastSyncedAt)),
    rangeDays: nullableCount(unwrapBqValue(row.rangeDays)),
    scanned: nullableCount(unwrapBqValue(row.scanned)),
    eligible: nullableCount(unwrapBqValue(row.eligible)),
    inserted: nullableCount(unwrapBqValue(row.inserted)),
    skippedExisting: nullableCount(unwrapBqValue(row.skippedExisting)),
    reason: reasonRaw,
    ok,
    errorMessage:
      typeof errRaw === "string" && errRaw.trim() ? errRaw.trim() : null,
  };
}

function nullableCount(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  return bridgeCount(raw);
}

export function asTimestampIso(raw: unknown): string | null {
  if (raw instanceof Date) {
    return Number.isFinite(raw.getTime()) ? raw.toISOString() : null;
  }
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/**
 * 스케줄 조회창. 표가 없거나 firstVisit 폭이 3일창(+여유) 수준이면
 * 400일 백필을 **한 번** 고른다. 매일 400일을 도는 게 아니다.
 */
export function chooseSyncDays(opts: {
  rowCount: number;
  minFirstVisitDate: string | null;
  todaySeoul: string;
}): { days: number; reason: Ga4BridgeSyncReason } {
  if (opts.rowCount < 1 || !opts.minFirstVisitDate) {
    return { days: GA4_SYNC_MAX_DAYS, reason: "historical-backfill" };
  }
  const span = calendarDaysBetween(opts.minFirstVisitDate, opts.todaySeoul);
  if (span == null || span <= GA4_HISTORY_BACKFILL_IF_SPAN_DAYS) {
    return { days: GA4_SYNC_MAX_DAYS, reason: "historical-backfill" };
  }
  return { days: GA4_SYNC_DEFAULT_DAYS, reason: "incremental" };
}

export function classifyGa4BridgeFreshness(opts: {
  lastSyncedAt: string | null;
  todaySeoul: string;
  statsError?: boolean;
}): Ga4BridgeFreshnessStatus {
  if (opts.statsError && !opts.lastSyncedAt) return "unknown";
  if (!opts.lastSyncedAt) return "not_ingested";
  const syncDay = timestampToSeoulDate(opts.lastSyncedAt);
  if (!syncDay) return "unknown";
  const lag = calendarDaysBetween(syncDay, opts.todaySeoul);
  if (lag == null) return "unknown";
  if (lag >= GA4_FRESHNESS_STALE_AFTER_DAYS) return "stale";
  return "loaded";
}

export function assembleGa4BridgeFreshness(opts: {
  todaySeoul: string;
  stats: Ga4BridgeStats;
  log: Ga4BridgeSyncLogRow | null;
  statsError?: boolean;
}): Ga4BridgeFreshness {
  const lastSyncedAt = opts.log?.lastSyncedAt ?? opts.stats.lastSyncedAt;
  const visitLagDays = opts.stats.maxFirstVisitDate
    ? calendarDaysBetween(opts.stats.maxFirstVisitDate, opts.todaySeoul)
    : null;
  const syncDay = lastSyncedAt ? timestampToSeoulDate(lastSyncedAt) : null;
  const lastSyncLagDays = syncDay
    ? calendarDaysBetween(syncDay, opts.todaySeoul)
    : null;
  return {
    lastSyncedAt,
    rowCount: opts.stats.rowCount,
    distinctGaKeys: opts.stats.distinctGaKeys,
    minFirstVisitDate: opts.stats.minFirstVisitDate,
    maxFirstVisitDate: opts.stats.maxFirstVisitDate,
    visitLagDays,
    lastSyncLagDays,
    status: classifyGa4BridgeFreshness({
      lastSyncedAt,
      todaySeoul: opts.todaySeoul,
      statsError: opts.statsError,
    }),
    rangeDays: opts.log?.rangeDays ?? null,
    scanned: opts.log?.scanned ?? null,
    inserted: opts.log?.inserted ?? null,
    skippedExisting: opts.log?.skippedExisting ?? null,
    reason: opts.log?.reason ?? null,
    ok: opts.log?.ok ?? null,
    errorMessage: opts.log?.errorMessage ?? null,
  };
}

/** 일 단위 cron 만 허용 — 분 단위로 올리면 비용만 는다. */
export function isDailyCron(cron: string): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  if (minute !== "0" && minute !== "00") return false;
  if (!/^\d{1,2}$/.test(hour)) return false;
  const h = Number(hour);
  if (h < 0 || h > 23) return false;
  return dayOfMonth === "*" && month === "*" && dayOfWeek === "*";
}

// ════════════════════════════════════════════════════════════════════════════
// GA4 이커머스 브리지 — 방문자×날짜 1행 (ticket VV733VRpsfGvijYuPWCl)
// ════════════════════════════════════════════════════════════════════════════
//
// ── ★왜 first-touch 브리지에 컬럼을 덧붙이지 않나 ───────────────────────────
//   `ga4_first_touch` 는 **덮지 않는 표**다(selectNewBridgeRows). 그게 first-touch
//   의 정의다 — 나중 값이 최초 유입을 덮으면 안 된다. 그런데 퍼널 카운트는
//   **누적**이라 매번 갱신돼야 한다. 같은 표에 넣으면 카운트가 첫 동기 시점에
//   얼어붙고, 그 사실은 에러 없이 조용히 틀린 숫자로만 나타난다.
//   그래서 표를 나눈다: 유입은 안 덮고, 이커머스는 날짜를 알갱이에 넣어 누적한다.
//
// ── ★알갱이를 (gaKey, eventDate) 로 잡은 이유 ───────────────────────────────
//   1) 3일 조회창이 **멱등**해진다. 이미 있는 날을 다시 읽어도 같은 값이 나온다.
//   2) GA4 일별 export 는 **완성된 하루**만 표로 만든다(D-1 이 D 오전에 착지).
//      `events_intraday_*` 는 `_TABLE_SUFFIX BETWEEN '2026…' AND '2026…'` 에
//      사전순으로 안 걸린다('i' > '2'). 그래서 우리가 읽는 날은 항상 완성본이다 —
//      반쪽짜리 하루가 표에 박히는 경우가 없다.
//   3) 결제가 **언제** 일어났는지가 공짜로 따라온다(채널→결제 지연 측정).
//
// ── ★읽기 뷰가 마지막 syncedAt 을 이기게 하는 이유 ──────────────────────────
//   GA4 는 지각 이벤트로 과거 일자 표를 다시 내보낼 수 있다. 쓰기에서 "이미 있는
//   날은 건너뛴다" 로 막으면 그 교정이 영영 반영되지 않는다. 그래서 **append 하고
//   읽기에서 같은 (gaKey, eventDate) 의 가장 최근 syncedAt 을 고른다**.
//   400일 백필이 과거를 실제로 고쳐 준다(ga4_first_touch_current 와 같은 수법).

/** 이커머스 일별 적재 표(US). 알갱이 = (gaKey, eventDate). */
export const GA4_ECOMMERCE_TABLE = "ga4_ecommerce_daily";

/** 이커머스 정본 읽기 뷰 — `gaKey` 당 1행으로 롤업. */
export const GA4_ECOMMERCE_CURRENT_VIEW = "ga4_ecommerce_current";

/**
 * ★이 다섯 개가 마블로 이커머스 퍼널의 전부다.
 *
 * `add_to_cart` / `view_cart` 를 **일부러 넣지 않는다.** 마블로는 장바구니가 없는
 * 구독 상품이라 그 이벤트는 존재할 수 없다. 컬럼으로 만들어 두면 영원히 0 인 칸이
 * 생기고, 다음 사람은 그걸 "태깅 누락" 으로 읽는다. 없는 단계를 표에 만들지 않는다.
 */
export const GA4_ECOMMERCE_EVENTS: ReadonlyArray<string> = [
  "view_item_list",
  "view_item",
  "begin_checkout",
  "add_payment_info",
  "purchase",
];

/** 한 번의 이커머스 동기화가 읽어 오는 (방문자×날짜) 상한. */
export const GA4_ECOMMERCE_ROW_LIMIT = 200000;

/**
 * ★GA4 가 "값이 없다" 를 말할 때 쓰는 자기 센티널.
 *
 * 실측(2026-08-24): `ecommerce.transaction_id` 가 `purchase` 를 뺀 **모든**
 * 이커머스 이벤트에서 리터럴 `'(not set)'` 이다. 이걸 거래 식별자로 세면
 * begin_checkout 18건이 전부 주문 18건으로 둔갑한다. `(direct)` 를 캠페인명으로
 * 세지 않는 것과 정확히 같은 함정이다.
 *
 * ★그리고 이 브리지는 **원시 transaction_id 를 US 로 넘기지 않는다.** 그건
 *   결제 원장 행을 직접 가리키는 주문 식별자고, 이 표의 축(익명 gaKey)과 다른
 *   공간이다. 넘기는 것은 건수·금액·통화뿐이다.
 */
export const GA4_NOT_SET_SENTINEL = "(not set)";

/** GA4(서울) 이커머스 집계 쿼리가 돌려주는 한 행. 값은 전부 신뢰하지 않는다. */
export interface Ga4EcommerceSourceRow {
  gaClientId: unknown;
  eventDate: unknown;
  viewItemListEvents: unknown;
  viewItemEvents: unknown;
  beginCheckoutEvents: unknown;
  addPaymentInfoEvents: unknown;
  purchaseEvents: unknown;
  purchaseRevenue: unknown;
  purchaseRevenueUsd: unknown;
  purchaseCurrency: unknown;
  currencyCount: unknown;
}

/** US 이커머스 표에 적히는 한 행. **raw gaClientId 도 transaction_id 도 없다.** */
export interface Ga4EcommerceRow {
  gaKey: string;
  /** `YYYY-MM-DD`. GA4 event_date. */
  eventDate: string;
  viewItemListEvents: number;
  viewItemEvents: number;
  beginCheckoutEvents: number;
  addPaymentInfoEvents: number;
  purchaseEvents: number;
  /** 이벤트 통화 기준 합. ★통화가 둘 이상이면 NULL — 합칠 수 없다. */
  purchaseRevenue: number | null;
  /** GA4 가 자기 환율로 환산한 USD. 통화가 섞여도 합산이 성립한다(근사치). */
  purchaseRevenueUsd: number | null;
  /** 통화가 정확히 하나일 때만 값이 있다. */
  purchaseCurrency: string | null;
  /** 그날 결제의 distinct 통화 수. 0 이면 결제가 없었다는 뜻이다. */
  currencyCount: number;
  syncedAt: string;
}

/**
 * GA4 가 돌려준 금액을 숫자로. **정수 KRW 만 오는 지금도 소수를 버리지 않는다** —
 * purchase_revenue_in_usd 는 애초에 소수다(실측 13.356367).
 * 숫자가 아니면 0 이 아니라 `null`(미상)이다.
 */
export function bridgeAmount(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") {
    const v = raw.trim();
    if (v.length === 0) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * GA4 통화 코드. 센티널(`(not set)` 등)과 형식이 아닌 값은 **통화가 아니다** —
 * 값을 지어내지 않고 null 로 떨어뜨린다.
 */
export function normalizeCurrency(raw: unknown): string | null {
  const v = cleanBridgeField(raw);
  if (!v) return null;
  if (v === GA4_NOT_SET_SENTINEL) return null;
  const up = v.toUpperCase();
  return /^[A-Z]{3}$/.test(up) ? up : null;
}

/**
 * GA4 이커머스 집계 행 하나 → US 표 행.
 *
 * ★통화가 둘 이상인 날은 `purchaseRevenue` 를 **NULL 로 떨어뜨린다.** 서로 다른
 *   통화를 더한 숫자는 0 보다 나쁘다 — 그럴듯해서 아무도 안 의심한다.
 *   `purchaseRevenueUsd` 는 GA4 가 이미 환산해 둔 값이라 그때도 합산이 성립한다.
 *
 * @param gaKey  이미 파생된 HMAC 가명. 여기서 솔트를 다루지 않는다(순수 유지).
 */
export function toEcommerceRow(
  raw: Ga4EcommerceSourceRow,
  gaKey: string,
  syncedAt: string,
): Ga4EcommerceRow | null {
  const eventDate = normalizeFirstVisitDate(raw.eventDate);
  // 날짜가 없으면 알갱이가 성립하지 않는다 — 행을 만들지 않는다.
  if (!eventDate) return null;

  const currencyCount = bridgeCount(raw.currencyCount);
  const purchaseCurrency =
    currencyCount === 1 ? normalizeCurrency(raw.purchaseCurrency) : null;
  const purchaseRevenue =
    currencyCount === 1 ? bridgeAmount(raw.purchaseRevenue) : null;

  return {
    gaKey,
    eventDate,
    viewItemListEvents: bridgeCount(raw.viewItemListEvents),
    viewItemEvents: bridgeCount(raw.viewItemEvents),
    beginCheckoutEvents: bridgeCount(raw.beginCheckoutEvents),
    addPaymentInfoEvents: bridgeCount(raw.addPaymentInfoEvents),
    purchaseEvents: bridgeCount(raw.purchaseEvents),
    purchaseRevenue,
    purchaseRevenueUsd: bridgeAmount(raw.purchaseRevenueUsd),
    purchaseCurrency,
    currencyCount,
    syncedAt,
  };
}

/**
 * 같은 배치 안의 (gaKey, eventDate) 중복만 접는다.
 *
 * ★`selectNewBridgeRows` 와 **다르다.** 이미 표에 있는 날도 다시 적재한다 —
 *   GA4 지각 이벤트 교정과 400일 백필이 실제로 과거를 고칠 수 있어야 하고,
 *   읽기 뷰가 가장 최근 `syncedAt` 을 고르기 때문이다.
 */
export function dedupeEcommerceRows(
  rows: readonly Ga4EcommerceRow[],
): Ga4EcommerceRow[] {
  const seen = new Set<string>();
  const out: Ga4EcommerceRow[] = [];
  for (const row of rows) {
    if (!row.gaKey || !row.eventDate) continue;
    const key = `${row.gaKey} ${row.eventDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

/**
 * GA4(asia-northeast3) 이커머스 집계 쿼리 — **방문자×날짜 1행**.
 *
 * ★`ecommerce.purchase_revenue` 는 GA4 스펙상 `purchase` 이벤트에만 실린다.
 *   다른 이벤트의 `event_params.value`(19000)를 매출로 세면 begin_checkout 18건이
 *   34만 원의 매출이 된다. 그래서 금액은 `event_name = 'purchase'` 로 **잠근다**.
 * ★통화는 `event_params.currency` 다(export 에 ecommerce.currency 는 없다).
 */
export function buildGa4EcommerceQuery(opts: {
  project: string;
  dataset: string;
  limit?: number;
}): string {
  assertIdent("project", opts.project);
  assertIdent("GA4 dataset", opts.dataset);
  const limit = opts.limit ?? GA4_ECOMMERCE_ROW_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("limit must be a positive integer");
  }

  const eventList = GA4_ECOMMERCE_EVENTS.map((e) => `'${e}'`).join(", ");
  const countOf = (event: string): string => `COUNTIF(event_name = '${event}')`;

  return `
    WITH ev AS (
      SELECT
        user_pseudo_id,
        PARSE_DATE('%Y%m%d', event_date)  AS event_day,
        event_name,
        ecommerce.purchase_revenue        AS purchase_revenue,
        ecommerce.purchase_revenue_in_usd AS purchase_revenue_usd,
        (SELECT value.string_value FROM UNNEST(event_params)
          WHERE key = 'currency')         AS currency
      FROM \`${opts.project}.${opts.dataset}.events_*\`
      WHERE _TABLE_SUFFIX BETWEEN
              FORMAT_DATE('%Y%m%d',
                DATE_SUB(CURRENT_DATE('Asia/Seoul'), INTERVAL @days DAY))
            AND FORMAT_DATE('%Y%m%d', CURRENT_DATE('Asia/Seoul'))
        AND user_pseudo_id IS NOT NULL
        AND event_name IN (${eventList})
    )
    SELECT
      user_pseudo_id                            AS gaClientId,
      FORMAT_DATE('%Y-%m-%d', event_day)        AS eventDate,
      ${countOf("view_item_list")}              AS viewItemListEvents,
      ${countOf("view_item")}                   AS viewItemEvents,
      ${countOf("begin_checkout")}              AS beginCheckoutEvents,
      ${countOf("add_payment_info")}            AS addPaymentInfoEvents,
      ${countOf("purchase")}                    AS purchaseEvents,
      -- 금액은 purchase 에만 있다. 다른 이벤트의 value 를 매출로 세지 않는다.
      SUM(IF(event_name = 'purchase', purchase_revenue, NULL))
                                                AS purchaseRevenue,
      SUM(IF(event_name = 'purchase', purchase_revenue_usd, NULL))
                                                AS purchaseRevenueUsd,
      ANY_VALUE(IF(event_name = 'purchase', currency, NULL))
                                                AS purchaseCurrency,
      COUNT(DISTINCT IF(event_name = 'purchase', currency, NULL))
                                                AS currencyCount
    FROM ev
    GROUP BY gaClientId, event_day
    LIMIT ${limit}
  `;
}

/**
 * 이커머스 정본 읽기 뷰 — `gaKey` 당 1행.
 *
 * 두 단계다:
 *   1) `(gaKey, eventDate)` 당 **가장 최근 syncedAt** 한 행만 남긴다(지각 교정·백필
 *      이 이긴다).
 *   2) 그 위에서 `gaKey` 로 롤업한다.
 *
 * ★통화가 섞이면 `purchaseRevenue` 는 NULL 이다 — 0 이 아니라 "합칠 수 없다" 다.
 *   `purchaseRevenueUsd` 는 GA4 환산값이라 그때도 남는다(근사치임을 컬럼명이 말한다).
 */
export function buildEcommerceCurrentViewSql(opts: {
  project: string;
  dataset: string;
}): string {
  assertIdent("project", opts.project);
  assertIdent("dataset", opts.dataset);
  return `
    WITH latest AS (
      SELECT * EXCEPT(rn)
      FROM (
        SELECT
          e.*,
          ROW_NUMBER() OVER (
            PARTITION BY gaKey, eventDate
            ORDER BY syncedAt DESC
          ) AS rn
        FROM \`${opts.project}.${opts.dataset}.${GA4_ECOMMERCE_TABLE}\` AS e
      )
      WHERE rn = 1
    ),
    rolled AS (
      SELECT
        gaKey,
        SUM(viewItemListEvents)   AS viewItemListEvents,
        SUM(viewItemEvents)       AS viewItemEvents,
        SUM(beginCheckoutEvents)  AS beginCheckoutEvents,
        SUM(addPaymentInfoEvents) AS addPaymentInfoEvents,
        SUM(purchaseEvents)       AS purchaseEvents,
        SUM(purchaseRevenue)      AS purchaseRevenueRaw,
        SUM(purchaseRevenueUsd)   AS purchaseRevenueUsd,
        MAX(purchaseCurrency)     AS purchaseCurrencyRaw,
        -- 하루 안에서 섞였을 수도(MAX), 날짜를 건너뛰며 섞였을 수도(COUNT DISTINCT)
        -- 있다. 둘 중 큰 쪽이 이 방문자의 통화 수다.
        GREATEST(
          IFNULL(MAX(currencyCount), 0),
          COUNT(DISTINCT purchaseCurrency)
        )                         AS currencyCount,
        MIN(eventDate)            AS firstEcommerceDate,
        MAX(eventDate)            AS lastEcommerceDate,
        MIN(IF(purchaseEvents > 0, eventDate, NULL)) AS firstPurchaseDate
      FROM latest
      GROUP BY gaKey
    )
    SELECT
      gaKey,
      -- ★행이 있으면 카운트는 실수다. 0 은 "그 단계를 안 밟았다" 이지 "모른다" 가
      --   아니다. 조인이 안 붙어 모르는 경우는 이 뷰에 행 자체가 없다.
      IFNULL(viewItemListEvents, 0)   AS viewItemListEvents,
      IFNULL(viewItemEvents, 0)       AS viewItemEvents,
      IFNULL(beginCheckoutEvents, 0)  AS beginCheckoutEvents,
      IFNULL(addPaymentInfoEvents, 0) AS addPaymentInfoEvents,
      IFNULL(purchaseEvents, 0)       AS purchaseEvents,
      -- ★결제가 0건이면 매출은 **0원**이다(NULL 아님). NULL 인 자리는 통화가
      --   섞여 **더할 수 없는** 경우 하나뿐이고, 그건 currencyCount 가 말한다.
      IF(currencyCount > 1, NULL, IFNULL(purchaseRevenueRaw, NUMERIC '0'))
                                      AS purchaseRevenue,
      -- 결제가 0건이면 통화는 없다 — 여기서만은 NULL 이 맞다(0원짜리 통화는 없다).
      IF(currencyCount = 1, purchaseCurrencyRaw, NULL)
                                      AS purchaseCurrency,
      IFNULL(purchaseRevenueUsd, NUMERIC '0')
                                      AS purchaseRevenueUsd,
      currencyCount,
      firstEcommerceDate,
      lastEcommerceDate,
      firstPurchaseDate
    FROM rolled
  `;
}

/** 이커머스 표 한 줄 요약 — 어드민 신선도 · 백필 판정용. */
export function buildEcommerceStatsQuery(opts: {
  project: string;
  dataset: string;
}): string {
  assertIdent("project", opts.project);
  assertIdent("dataset", opts.dataset);
  return `
    SELECT
      COUNT(*) AS rowCount,
      COUNT(DISTINCT gaKey) AS distinctGaKeys,
      CAST(MIN(eventDate) AS STRING) AS minEventDate,
      CAST(MAX(eventDate) AS STRING) AS maxEventDate,
      SUM(purchaseEvents) AS purchaseEvents,
      FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', MAX(syncedAt)) AS lastSyncedAt
    FROM \`${opts.project}.${opts.dataset}.${GA4_ECOMMERCE_TABLE}\`
  `;
}

/**
 * 이커머스 표 스키마.
 *
 * ★금액은 NUMERIC 이다. GA4 는 FLOAT64 로 주지만 돈을 float 로 두면 합계가
 *   미세하게 어긋나고, INT64 → NUMERIC 은 BigQuery 가 제자리 변경을 허용하지
 *   않는다(analytics_purchase.amount 와 같은 판단).
 * ★덧붙이는 컬럼은 전부 NULLABLE 이어야 한다 — REQUIRED 를 덧붙이면 BigQuery 가
 *   거부하고, 거부당하면 적재가 통째로 막힌다.
 */
export const GA4_ECOMMERCE_SCHEMA = [
  { name: "gaKey", type: "STRING", mode: "REQUIRED" },
  { name: "eventDate", type: "DATE", mode: "REQUIRED" },
  { name: "viewItemListEvents", type: "INT64", mode: "NULLABLE" },
  { name: "viewItemEvents", type: "INT64", mode: "NULLABLE" },
  { name: "beginCheckoutEvents", type: "INT64", mode: "NULLABLE" },
  { name: "addPaymentInfoEvents", type: "INT64", mode: "NULLABLE" },
  { name: "purchaseEvents", type: "INT64", mode: "NULLABLE" },
  { name: "purchaseRevenue", type: "NUMERIC", mode: "NULLABLE" },
  { name: "purchaseRevenueUsd", type: "NUMERIC", mode: "NULLABLE" },
  { name: "purchaseCurrency", type: "STRING", mode: "NULLABLE" },
  { name: "currencyCount", type: "INT64", mode: "NULLABLE" },
  { name: "syncedAt", type: "TIMESTAMP", mode: "REQUIRED" },
] as const;

export interface Ga4EcommerceStats {
  rowCount: number;
  distinctGaKeys: number;
  minEventDate: string | null;
  maxEventDate: string | null;
  purchaseEvents: number;
  lastSyncedAt: string | null;
}

export function emptyGa4EcommerceStats(): Ga4EcommerceStats {
  return {
    rowCount: 0,
    distinctGaKeys: 0,
    minEventDate: null,
    maxEventDate: null,
    purchaseEvents: 0,
    lastSyncedAt: null,
  };
}

export function parseEcommerceStatsRow(raw: unknown): Ga4EcommerceStats {
  if (!raw || typeof raw !== "object") return emptyGa4EcommerceStats();
  const row = raw as Record<string, unknown>;
  return {
    rowCount: bridgeCount(unwrapBqValue(row.rowCount)),
    distinctGaKeys: bridgeCount(unwrapBqValue(row.distinctGaKeys)),
    minEventDate: normalizeFirstVisitDate(unwrapBqValue(row.minEventDate)),
    maxEventDate: normalizeFirstVisitDate(unwrapBqValue(row.maxEventDate)),
    purchaseEvents: bridgeCount(unwrapBqValue(row.purchaseEvents)),
    lastSyncedAt: asTimestampIso(unwrapBqValue(row.lastSyncedAt)),
  };
}
