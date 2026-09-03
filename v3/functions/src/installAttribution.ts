// 설치 어트리뷰션 링크백 — 순수 로직(BQ/Firestore 무의존). node --test 로 검증.
//
// 배경: 앱은 최초 실행에서 익명 설치 ID 를 들고 `marblo.app/<locale>/link` 를
// 기본 브라우저로 연다. 그 페이지는 **다운로드했던 그 브라우저**에서 도는 것이
// 보통이므로 `_ga` 쿠키(=GA4 client_id, BQ export 의 user_pseudo_id)를 읽을 수
// 있고, 그 값을 설치 ID 와 함께 이 콜러블로 보낸다. 이게 uid 없이 웹↔앱을 잇는
// 유일한 결정론적 다리다(#901 §6 의 (c) 클립보드 안을 쓰지 않는 이유도 같다 —
// 조용히 틀리는 대신 여기선 성공/실패가 눈에 보인다).
//
// ★서버가 저장하지 않는 것: Firebase uid, 이메일, 이름, **요청 IP**.
//   IP 는 레이트리밋 키로만 쓰고 행에 남기지 않는다(개인정보).
// ★국가를 여기서 만들지 않는 이유: 국가의 정본은 GA4 geo 다(#901 §7-4).
//   조인 시점에 GA4 쪽에서 붙으므로 클라가 보낸(=위조 가능한) 국가는 받지 않는다.
//
// 귀속률 조회·광고 URL 규약: v3/docs/install-attribution-utm-rate.md
// (`ANALYTICS_ID_SALT` 무변경, 원시 식별자 미생성, IP 지문 금지).
//
// ── ★키 공간이 갈려 있었다 (ticket OqSGPuyOTR8t6Bgl0WI5) ─────────────────────
// 이 행의 `gaClientId` 는 **원시** GA4 client_id 다(길이 20~21, `<int>.<int>`).
// 반면 GA4 브리지(`ga4_first_touch_current.gaKey`)와 익명축 신원표
// (`analytics_identity.ga_key`)에 적히는 값은 **가명**이다(`ga_` + 24자 HMAC).
// 그래서 `install_attribution.gaClientId = ga4_first_touch_current.gaKey` 는
// 에러 없이 **항상 0행**이었다 — 실측 2026-08-24: installs 632 / joined 0.
//
// 가명키는 단방향이라 브리지 쪽 값을 원본으로 되돌릴 수 없다. 그래서 해법은
// **원본이 있는 이쪽에 가명키 컬럼을 더하는 것**이다(#1171 의
// `analytics_user_daily.install_key_hmac` 과 같은 선택). 원시 `gaClientId` 는
// 그대로 두고 `gaKeyHmac` 을 나란히 적는다.
//
// ★가명은 `deriveGaKey()` = `pseudonymizeAnalyticsId("ga", ...)` 로만 만든다.
//   kind 는 추측이 아니라 GA4 적재 경로 전수 확인 결과다 — GA4 쪽 gaKey 생산자는
//   정확히 두 곳이고 둘 다 kind `"ga"` · 같은 솔트다:
//     1) index.ts `syncGa4FirstTouchInternal` → `deriveGaKey(user_pseudo_id, salt)`
//        → `ga4_first_touch.gaKey`
//     2) scripts/backfill-analytics-identity.ts → `pseudonymizeAnalyticsId("ga", ...)`
//        → `analytics_identity.ga_key`
//   새 가명 체계를 만들면(kind 를 새로 파면) 조인이 다시 조용히 0 이 된다.
// ★`ANALYTICS_ID_SALT` 는 건드리지 않는다 — 바꾸면 과거 가명키가 전부 무효다.
// ★소급 백필은 여기서 하지 않는다. 원시 `gaClientId` 가 원장에 남아 있으므로
//   나중에 채울 수 있다(계획: v3/docs/install-attribution-utm-rate.md).

import { deriveGaKey } from "./analyticsPseudonym";

/** 콜러블이 받아 BigQuery 로 적재하는 한 행. */
export interface InstallAttributionRow {
  installId: string;
  /** 원시 GA4 client_id. 기존 컬럼이므로 보존한다. */
  gaClientId: string | null;
  /**
   * `ga_` + HMAC(salt, `"ga:" + gaClientId`). GA4 브리지·익명축 신원표와 **같은
   * 공간**의 조인키다 — 채널 조인은 이 컬럼으로만 한다.
   *
   * `gaClientId` 가 없거나 솔트가 없으면 null(원시값 폴백 금지). 소급 재작성은
   * 하지 않으므로 이 컬럼이 생기기 전 행은 영구히 NULL 이다.
   */
  gaKeyHmac: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  /**
   * `utm_content` — **소재(크리에이티브) 축**. 같은 캠페인 안에서 어떤 배너·
   * 카피가 설치를 만들었는지는 이 값 없이는 영영 알 수 없다.
   * ★광고를 켠 뒤에 컬럼을 만들면 그 전 구간은 복구되지 않는다(BigQuery 는
   *   과거 파티션에 값을 소급 생성해 주지 않는다) — 그래서 지금 만든다.
   */
  utmContent: string | null;
  /** `utm_term` — 검색 키워드 축. utmContent 와 같은 이유로 지금 만든다. */
  utmTerm: string | null;
  referrerHost: string | null;
  landingPath: string | null;
  platform: string | null;
  appVersion: string | null;
  /**
   * `"dev"` = 개발/테스트 재실행, `"prod"` = 배포된 앱의 첫 실행,
   * `null` = 표식이 붙기 전(2026-08-21 이전) 앱이 보낸 행.
   *
   * ★유입 집계는 `buildChannel = "prod"` 만 세야 한다. 이 컬럼이 생기기 전
   *   550행은 전부 개발 루프였고(gaClientId 3개·10~30초 간격 버스트), 그걸
   *   다운로드 수로 읽으면 유입을 두 자릿수 배로 부풀린다.
   * ★클라이언트가 보내는 값이라 위조 가능하다 — 집계 위생용이지 보안 통제가
   *   아니다. 이 값으로 권한을 가르지 않는다.
   */
  buildChannel: string | null;
  linkedAt: string;
  linkSource: string;
}

/** 파싱 실패 사유 — 클라에 코드로만 돌려준다(값은 로그에 남기지 않는다). */
export type AttributionRejectReason =
  | "missing_install_id"
  | "bad_install_id"
  | "bad_ga_client_id";

/** 허용되는 빌드 채널. 이 둘 밖의 값은 조용히 null 로 접는다. */
export const BUILD_CHANNELS = ["dev", "prod"] as const;

export type ParseResult =
  | { ok: true; row: InstallAttributionRow }
  | { ok: false; reason: AttributionRejectReason };

const MAX_FIELD = 100;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** GA4 client_id 는 `<int>.<int>`. 그 외 형태는 조인키가 될 수 없다. */
const GA_CLIENT_ID_RE = /^\d{1,20}\.\d{1,20}$/;

/** 제어문자 제거 + 길이 제한. 빈 값은 null 로 접는다(BQ 에서 NULL). */
export function cleanField(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw
    // eslint-disable-next-line no-control-regex -- intentional: strip control chars before writing analytics fields to BQ
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, MAX_FIELD);
  return v.length > 0 ? v : null;
}

/**
 * 앱 설치 ID 검증. 앱의 익명 clientId 는 `crypto.randomUUID()` 이고, 스토리지를
 * 못 쓰는 설치는 리터럴 `"anon"` 을 쓴다(telemetryService.getClientId) — 그건
 * 모든 설치가 공유하는 값이라 조인키가 될 수 없으므로 거부한다.
 */
export function parseInstallId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (!UUID_RE.test(v)) return null;
  return v;
}

/** GA4 client_id 검증. 없으면(광고차단 등) null 이 정상값이다. */
export function parseGaClientId(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return GA_CLIENT_ID_RE.test(v) ? v : null;
}

/**
 * 빌드 채널 검증. 구버전 앱은 이 필드를 아예 안 보내므로 **없음(null)이
 * 정상값**이다 — 거부하지 않는다(거부하면 구버전 앱의 유입이 통째로 사라진다).
 * 형식이 틀린 값도 거부 대신 null 로 접는다: 이 표식은 집계 위생용이고,
 * 쓰레기 값 하나 때문에 어트리뷰션 행 자체를 잃는 게 더 손해다.
 */
export function parseBuildChannel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  return (BUILD_CHANNELS as readonly string[]).includes(v) ? v : null;
}

/**
 * 콜러블 입력 → BigQuery 행. 실패하면 사유만 돌려준다.
 *
 * @param now  적재 시각(테스트 주입). ISO 문자열로 행에 실린다.
 * @param analyticsIdSalt
 *   `ANALYTICS_ID_SALT`. 주면 `gaKeyHmac` 을 채우고, 없으면(기본값 null)
 *   **원시값으로 폴백하지 않고** null 을 적는다 — fail-safe 는 가명화 모듈의
 *   규약이고 여기서 예외를 두지 않는다. 솔트는 이 순수 모듈이 읽지 않는다
 *   (호출부가 `readAnalyticsIdSalt()` 로 주입한다).
 */
export function parseLinkInstallRequest(
  data: unknown,
  now: Date,
  analyticsIdSalt: string | null = null
): ParseResult {
  const d = (data ?? {}) as Record<string, unknown>;
  if (d.installId === undefined || d.installId === null || d.installId === "") {
    return { ok: false, reason: "missing_install_id" };
  }
  const installId = parseInstallId(d.installId);
  if (!installId) return { ok: false, reason: "bad_install_id" };

  // gaClientId 는 "없음" 은 허용하되 "형식이 틀림" 은 거부한다 — 쓰레기 값이
  // 조인키 컬럼에 들어가면 매칭률 지표 자체를 못 믿게 된다.
  const rawGa = d.gaClientId;
  const gaClientId = parseGaClientId(rawGa);
  if (
    gaClientId === null &&
    rawGa !== null &&
    rawGa !== undefined &&
    rawGa !== ""
  ) {
    return { ok: false, reason: "bad_ga_client_id" };
  }

  return {
    ok: true,
    row: {
      installId,
      gaClientId,
      // ★조인키는 여기서 한 번만 만든다. 원시 gaClientId 는 그대로 남기고
      //   가명을 나란히 적는다 — 브리지 쪽 값을 되돌릴 수는 없기 때문이다.
      gaKeyHmac: deriveGaKey(gaClientId, analyticsIdSalt),
      utmSource: cleanField(d.utmSource),
      utmMedium: cleanField(d.utmMedium),
      utmCampaign: cleanField(d.utmCampaign),
      utmContent: cleanField(d.utmContent),
      utmTerm: cleanField(d.utmTerm),
      referrerHost: cleanField(d.referrerHost),
      landingPath: cleanField(d.landingPath),
      platform: cleanField(d.platform),
      appVersion: cleanField(d.appVersion),
      buildChannel: parseBuildChannel(d.buildChannel),
      linkedAt: now.toISOString(),
      linkSource: "app_first_run",
    },
  };
}

/** BigQuery 테이블 스키마(수동 마이그레이션 없이 최초 1회 자동 생성). */
export const INSTALL_ATTRIBUTION_SCHEMA = [
  { name: "installId", type: "STRING", mode: "REQUIRED" },
  { name: "gaClientId", type: "STRING", mode: "NULLABLE" },
  {
    name: "gaKeyHmac",
    type: "STRING",
    mode: "NULLABLE",
    description:
      "ga_ + HMAC(salt, 'ga:' + gaClientId). ★원시 gaClientId 는 보존하고, " +
      "ga4_first_touch_current.gaKey / analytics_identity.ga_key 와 조인할 때만 " +
      "이 컬럼을 쓴다(원시 컬럼으로 조인하면 키 공간이 갈려 항상 0행이다). " +
      "소급 재작성은 하지 않으므로 과거 행은 NULL 이다.",
  },
  { name: "utmSource", type: "STRING", mode: "NULLABLE" },
  { name: "utmMedium", type: "STRING", mode: "NULLABLE" },
  { name: "utmCampaign", type: "STRING", mode: "NULLABLE" },
  {
    name: "utmContent",
    type: "STRING",
    mode: "NULLABLE",
    description:
      "utm_content — 소재(크리에이티브) 축. 유료 광고 전이라 지금은 대부분 " +
      "NULL 이지만, 광고를 켠 뒤에 컬럼을 만들면 그 전 구간은 복구되지 않는다.",
  },
  {
    name: "utmTerm",
    type: "STRING",
    mode: "NULLABLE",
    description: "utm_term — 검색 키워드 축. utmContent 와 같은 이유로 지금 만든다.",
  },
  { name: "referrerHost", type: "STRING", mode: "NULLABLE" },
  { name: "landingPath", type: "STRING", mode: "NULLABLE" },
  { name: "platform", type: "STRING", mode: "NULLABLE" },
  { name: "appVersion", type: "STRING", mode: "NULLABLE" },
  { name: "buildChannel", type: "STRING", mode: "NULLABLE" },
  { name: "linkedAt", type: "TIMESTAMP", mode: "REQUIRED" },
  { name: "linkSource", type: "STRING", mode: "NULLABLE" },
] as const;
