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

/** 콜러블이 받아 BigQuery 로 적재하는 한 행. */
export interface InstallAttributionRow {
  installId: string;
  gaClientId: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
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
  // eslint-disable-next-line no-control-regex
  const v = raw
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
 */
export function parseLinkInstallRequest(data: unknown, now: Date): ParseResult {
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
      utmSource: cleanField(d.utmSource),
      utmMedium: cleanField(d.utmMedium),
      utmCampaign: cleanField(d.utmCampaign),
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
  { name: "utmSource", type: "STRING", mode: "NULLABLE" },
  { name: "utmMedium", type: "STRING", mode: "NULLABLE" },
  { name: "utmCampaign", type: "STRING", mode: "NULLABLE" },
  { name: "referrerHost", type: "STRING", mode: "NULLABLE" },
  { name: "landingPath", type: "STRING", mode: "NULLABLE" },
  { name: "platform", type: "STRING", mode: "NULLABLE" },
  { name: "appVersion", type: "STRING", mode: "NULLABLE" },
  { name: "buildChannel", type: "STRING", mode: "NULLABLE" },
  { name: "linkedAt", type: "TIMESTAMP", mode: "REQUIRED" },
  { name: "linkSource", type: "STRING", mode: "NULLABLE" },
] as const;
