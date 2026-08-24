// 익명 어트리뷰션 — 웹(marblo.app) ↔ 데스크탑 앱을 **Firebase uid 없이** 잇는 다리.
//
// 설계: v3/docs/web-app-join-attribution-design-2026-08-09.md (#901) + 후속
// v3/docs/ga4-country-funnel-attribution-2026-08-10.md.
//
// 조인키는 **GA4 client_id** 하나다. GA4 웹 스트림에서 BigQuery export 의
// `user_pseudo_id` 컬럼 값이 곧 이 client_id 이므로, 앱이 이 값을 익명으로
// 넘겨받기만 하면 uid 없이도 "이 방문자 = 이 설치" 가 이어진다.
//
// ★비식별 규약(woXp2c70 과 정합):
//   - Firebase uid / email / 이름 / 전화 / IP 를 **저장하지도 전송하지도 않는다.**
//   - referrer 는 **호스트명만** 남긴다(경로·쿼리에 PII 가 실릴 수 있다).
//   - landing 은 **경로만** 남긴다(쿼리스트링 전체 저장 금지 — utm 만 골라 뽑는다).
//     ★골라 뽑는 utm 은 5개다: source / medium / campaign / **content** / **term**.
//     content·term 은 사장님이 요구한 **소재 단위 분석**의 유일한 축이고,
//     광고를 켠 뒤에 수집을 시작하면 그 전 구간은 복구되지 않는다
//     (ticket OqSGPuyOTR8t6Bgl0WI5).
//   - 국가는 여기서 만들지 않는다. 국가의 정답은 GA4 geo 이고(#901 §7-4),
//     조인 시점에 BigQuery 에서 붙는다. 클라가 보낸 국가는 위조 가능하다.

/** 첫 방문(first-touch) 유입맥락. 값은 전부 비식별이며 길이 제한이 걸린다. */
export interface FirstTouch {
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  /**
   * `utm_content` — **소재(크리에이티브) 축**. 같은 캠페인 안에서 어떤 배너·
   * 카피가 설치를 만들었는지는 이 값 없이는 알 수 없다.
   *
   * ★유료 광고 전이라 지금은 거의 항상 빈 문자열이다. 그래도 **지금** 파싱해
   *   두는 이유: 광고를 켠 뒤에 수집을 시작하면 그 전 구간은 영영 복구되지
   *   않는다(ticket OqSGPuyOTR8t6Bgl0WI5).
   */
  utmContent: string;
  /** `utm_term` — 검색 키워드 축. utmContent 와 같은 이유로 지금부터 받는다. */
  utmTerm: string;
  /** referrer 의 **호스트명만**. 경로/쿼리는 버린다. */
  referrerHost: string;
  /** 최초 랜딩 **경로만**(쿼리 제외). */
  landingPath: string;
  /** epoch ms. 캡처 시각(신선도 판단용). */
  capturedAt: number;
}

export const FIRST_TOUCH_STORAGE_KEY = "marblo.attr.firstTouch";

/** 개별 필드 최대 길이. GA4 파라미터 관례(100자)에 맞춘다. */
const MAX_FIELD = 100;

/** 제어문자 제거 + 길이 제한. 비식별 값만 통과시키는 마지막 관문. */
export function sanitizeField(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const stripped = raw.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  return stripped.slice(0, MAX_FIELD);
}

/**
 * `_ga` 쿠키에서 GA4 client_id 를 뽑는다.
 *
 * 쿠키 포맷은 `GA1.<도메인깊이>.<clientId앞>.<clientId뒤>` 이고
 * client_id 는 마지막 두 조각을 점으로 이은 값이다(예: `GA1.1.123.456` → `123.456`).
 * 이 값이 BigQuery export 의 `user_pseudo_id` 와 같다.
 *
 * 못 찾으면 null — 광고차단/쿠키거부 세션이 정상적으로 존재하며, 그 경우
 * 어트리뷰션은 utm 폴백만 남고 국가는 unknown 이 된다(조용히 지어내지 않는다).
 */
export function parseGaClientId(cookieString: string): string | null {
  if (typeof cookieString !== "string" || cookieString.length === 0)
    return null;
  for (const chunk of cookieString.split(";")) {
    const eq = chunk.indexOf("=");
    if (eq < 0) continue;
    const name = chunk.slice(0, eq).trim();
    if (name !== "_ga") continue;
    const value = chunk.slice(eq + 1).trim();
    const parts = value.split(".");
    if (parts.length < 4) return null;
    const id = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
    // client_id 는 `<int>.<int>` 형태다. 그 외 값은 신뢰하지 않는다.
    return /^\d+\.\d+$/.test(id) ? id : null;
  }
  return null;
}

/** 브라우저에서 GA4 client_id 읽기. SSR/쿠키없음 → null. */
export function readGaClientId(): string | null {
  if (typeof document === "undefined") return null;
  try {
    return parseGaClientId(document.cookie);
  } catch {
    return null;
  }
}

/**
 * 현재 URL + referrer 로 first-touch 를 만든다(순수 함수 — 테스트 진입점).
 *
 * @param href      전체 URL (`window.location.href`)
 * @param referrer  `document.referrer` (없으면 빈 문자열)
 * @param now       epoch ms
 */
export function deriveFirstTouch(
  href: string,
  referrer: string,
  now: number
): FirstTouch {
  let params: URLSearchParams;
  let landingPath = "/";
  try {
    const url = new URL(href);
    params = url.searchParams;
    landingPath = url.pathname;
  } catch {
    params = new URLSearchParams();
  }

  let referrerHost = "";
  if (referrer) {
    try {
      referrerHost = new URL(referrer).hostname;
    } catch {
      referrerHost = "";
    }
  }

  return {
    utmSource: sanitizeField(params.get("utm_source")),
    utmMedium: sanitizeField(params.get("utm_medium")),
    utmCampaign: sanitizeField(params.get("utm_campaign")),
    utmContent: sanitizeField(params.get("utm_content")),
    utmTerm: sanitizeField(params.get("utm_term")),
    referrerHost: sanitizeField(referrerHost),
    landingPath: sanitizeField(landingPath) || "/",
    capturedAt: now,
  };
}

/** localStorage 최소 인터페이스 — 테스트에서 주입한다. */
export interface AttributionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * 앱이 여는 환영 페이지(`/{locale}/link`). 마케팅 랜딩이 아니다.
 * 여기 빈 utm/referrer 를 first-touch 로 잠그면 이후 진짜 채널이 영원히 덮인다.
 */
export function isLinkbackPath(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, "") || "/";
  return p === "/link" || p.endsWith("/link");
}

/**
 * utm 또는 referrer 호스트가 있으면 유입 채널이 있는 것이다.
 *
 * ★소재 축(`utm_content`/`utm_term`)도 utm 이다 — 여기 빠뜨리면 소재만 붙은
 *   링크가 "채널 없음(direct)" 으로 읽혀 다음 방문에 덮인다.
 */
export function hasAttributionChannel(ft: FirstTouch): boolean {
  return Boolean(
    ft.utmSource ||
      ft.utmMedium ||
      ft.utmCampaign ||
      ft.utmContent ||
      ft.utmTerm ||
      ft.referrerHost
  );
}

function isLockedEmptyLinkback(ft: FirstTouch): boolean {
  return isLinkbackPath(ft.landingPath) && !hasAttributionChannel(ft);
}

/**
 * first-touch 를 **한 번만** 저장한다. 채널이 있는 값은 덮어쓰지 않는다(#901 §5-3).
 * 두 번째 방문의 utm 으로 첫 유입 채널을 덮으면 귀속이 통째로 틀어진다.
 *
 * 예외 두 가지:
 *   1) `/{locale}/link` 자기 페이지의 빈 유입은 마케팅 랜딩이 아니므로 저장하지
 *      않는다(실측 548/608 행이 이 잘못된 잠금이었다).
 *   2) 저장된 값이 채널 없는 direct 이면, 이후 utm/referrer 가 오면 업그레이드
 *      한다(first non-direct). 광고 클릭 전에 홈을 한 번 연 사람을 잃지 않기 위함.
 *
 * @returns 저장돼 있는(또는 방금 저장한) first-touch. 스토리지 불가·빈 링크백이면 null.
 */
export function captureFirstTouchInto(
  storage: AttributionStorage,
  href: string,
  referrer: string,
  now: number
): FirstTouch | null {
  try {
    const existing = storage.getItem(FIRST_TOUCH_STORAGE_KEY);
    const parsed = existing ? parseFirstTouch(existing) : null;
    // 채널이 있는 first-touch 는 잠근다. 빈 값(direct)은 아래서 업그레이드할 수 있다.
    if (parsed && hasAttributionChannel(parsed)) return parsed;

    const fresh = deriveFirstTouch(href, referrer, now);
    if (isLockedEmptyLinkback(fresh)) {
      // 빈 /link 로 덮지 않는다. 홈을 먼저 연 빈 값이 있으면 그걸 유지.
      return parsed && !isLinkbackPath(parsed.landingPath) ? parsed : null;
    }
    if (parsed && !hasAttributionChannel(fresh)) return parsed;

    storage.setItem(FIRST_TOUCH_STORAGE_KEY, JSON.stringify(fresh));
    return fresh;
  } catch {
    // 시크릿 모드/스토리지 차단 — 어트리뷰션은 포기하되 페이지는 정상 동작.
    return null;
  }
}

/** 저장된 JSON 을 FirstTouch 로 되살린다. 형태가 깨졌으면 null. */
export function parseFirstTouch(raw: string): FirstTouch | null {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!o || typeof o !== "object") return null;
    const capturedAt =
      typeof o.capturedAt === "number" && Number.isFinite(o.capturedAt)
        ? o.capturedAt
        : 0;
    return {
      utmSource: sanitizeField(o.utmSource),
      utmMedium: sanitizeField(o.utmMedium),
      utmCampaign: sanitizeField(o.utmCampaign),
      // ★이 필드가 생기기 전에 저장된 first-touch 에는 키가 없다 →
      //   sanitizeField(undefined) = "". 옛 값을 버리지 않는다.
      utmContent: sanitizeField(o.utmContent),
      utmTerm: sanitizeField(o.utmTerm),
      referrerHost: sanitizeField(o.referrerHost),
      landingPath: sanitizeField(o.landingPath) || "/",
      capturedAt,
    };
  } catch {
    return null;
  }
}

/** 브라우저용 래퍼 — 최초 랜딩에서 1회 호출한다. */
export function captureFirstTouch(now: number = Date.now()): FirstTouch | null {
  if (typeof window === "undefined") return null;
  try {
    return captureFirstTouchInto(
      window.localStorage,
      window.location.href,
      document.referrer || "",
      now
    );
  } catch {
    return null;
  }
}

/** 저장된 first-touch 읽기(없으면 null). */
export function readFirstTouch(): FirstTouch | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(FIRST_TOUCH_STORAGE_KEY);
    return raw ? parseFirstTouch(raw) : null;
  } catch {
    return null;
  }
}

/**
 * 앱이 넘겨준 설치 ID 검증. 앱의 익명 clientId 는 `crypto.randomUUID()` 이고,
 * 스토리지를 못 쓰는 설치는 리터럴 `"anon"` 을 쓴다(telemetryService.getClientId).
 * 그 두 형태만 받는다 — 임의 문자열을 받으면 조인 테이블이 쓰레기로 찬다.
 */
export function sanitizeInstallId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (v === "anon") return null; // 익명 폴백은 조인키가 될 수 없다 — 버린다.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
    v
  )
    ? v
    : null;
}

/**
 * 앱이 `?c=` 로 알려 주는 빌드 채널. 개발 루프의 재실행(`dev`)이 실사용자
 * 유입(`prod`)과 같은 행으로 섞이지 않게 하는 표식이다 — 첫 550행이 정확히
 * 그렇게 섞여 유입 수를 못 믿게 만들었다. 표식을 안 보내는 구버전 앱은 null.
 */
export type BuildChannel = "dev" | "prod";

/**
 * 빌드 채널 검증. 없거나 형식이 틀리면 null — **거부하지 않는다.** 구버전 앱은
 * 아예 안 보내고, 표식 하나 때문에 어트리뷰션 행을 통째로 잃는 게 더 손해다.
 */
export function sanitizeBuildChannel(raw: unknown): BuildChannel | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  return v === "dev" || v === "prod" ? v : null;
}

/** 앱→웹 링크백 페이로드(콜러블 `linkInstallAttribution` 입력과 1:1). */
export interface LinkInstallPayload {
  installId: string;
  gaClientId: string | null;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string;
  utmTerm: string;
  referrerHost: string;
  landingPath: string;
  platform: string;
  appVersion: string;
  buildChannel: BuildChannel | null;
}

/**
 * 링크백 페이로드를 만든다. installId 가 유효하지 않으면 null —
 * 호출부는 전송하지 않는다.
 */
export function buildLinkInstallPayload(args: {
  installId: unknown;
  gaClientId: string | null;
  firstTouch: FirstTouch | null;
  platform: unknown;
  appVersion: unknown;
  buildChannel?: unknown;
}): LinkInstallPayload | null {
  const installId = sanitizeInstallId(args.installId);
  if (!installId) return null;
  const ft = args.firstTouch;
  return {
    installId,
    gaClientId: args.gaClientId,
    utmSource: ft?.utmSource ?? "",
    utmMedium: ft?.utmMedium ?? "",
    utmCampaign: ft?.utmCampaign ?? "",
    utmContent: ft?.utmContent ?? "",
    utmTerm: ft?.utmTerm ?? "",
    referrerHost: ft?.referrerHost ?? "",
    landingPath: ft?.landingPath ?? "",
    platform: sanitizeField(args.platform),
    appVersion: sanitizeField(args.appVersion),
    buildChannel: sanitizeBuildChannel(args.buildChannel),
  };
}
