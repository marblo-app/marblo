// 어드민 ① 획득 탭의 읽기 경로 — 통합 뷰 `v_install_unified` 위의 얇은 층.
//
// 순수 로직(BQ/Firebase 무의존). node --test 로 단위검증한다
// (installUnified.ts / countryFunnel.ts / botTraffic.ts 와 같은 규약).
//
// 설계 정본 셋. 어긋나면 코드가 아니라 문서가 이긴다:
//   · v3/docs/admin-analytics-replan-2026-08-24.md  (계획 — §2 버릴 목록·§4-1 획득 탭)
//   · v3/docs/install-unified-view-2026-08-24.md    (컬럼명 — 새 이름을 짓지 않는다)
//   · marblo-web/docs/DASHBOARD-QUALITY-BAR-2026-08-25.md (품질 기준)
//
// ── ★이 모듈이 존재하는 이유 (계획 §0) ──────────────────────────────────────
//   화면이 지저분했던 건 결과지 원인이 아니다. 원인은 **집계가 16곳에서 따로
//   돌았다**는 것이다 — 같은 "사용자 수" 를 세는 코드가 세 벌이고 세 벌의 알갱이가
//   달랐다. 그래서 이 모듈은 **아무것도 재계산하지 않는다.** 뷰가 이미 설치 1행으로
//   접어 둔 것을 GROUP BY 하고 사유별로 나눌 뿐이다. 새 지표를 여기서 만들면
//   17번째 집계가 되고, 그게 정확히 이 재설계가 없애려는 병이다.
//
// ── ★이 모듈이 지키는 규율 넷 ───────────────────────────────────────────────
//
//  1) **0 과 미상을 가른다.** 뷰가 못 읽히면 0 을 그리지 않고 `unavailable` +
//     사유를 돌려준다. 빈 표를 "유입 0" 으로 속이면 광고 판단이 뒤집힌다.
//  2) ★**'모른다' 와 '안다, 캠페인이 없었다' 를 가른다.** `no_ga4_row`(조인이
//     깨졌다)와 `no_utm`(자연유입 — 유입을 **안다**, 캠페인이 없었을 뿐)은 화면에서
//     같은 칸에 있으면 안 된다. 사유마다 `kind` 를 실어 보내는 이유가 이것이다.
//  3) ★**분모는 방문이 아니라 설치다.** 봇은 Electron 데스크톱을 내려받아 설치하고
//     실행하지 않는다(botTraffic.ts 머리말 ①). 그래서 이 축은 봇 규칙이 하나도
//     없어도 이미 봇을 0으로 센다. 방문 축의 '의심 유입 N' 은 여전히 화면에
//     남되(버리지 않는다) **다른 축**이라고 못 박는다.
//  4) ★**설치 수를 사람 수로 읽지 않는다.** 실측(2026-08-24): 원장 631행의 고유
//     gaClientId 가 5개였다 — 한 브라우저가 2주 만에 539번 '최초 실행' 을 한
//     재설치 루프다(#1198 analyticsProfiles.INSTALL_CLASS_DEFINITION). 전체 설치와
//     사람 추정치를 **같이** 낸다. 하나만 내면 반드시 오독된다.

import {
  EXTERNALITY_REASON_DEV_BUILD_CHANNEL,
  EXTERNALITY_REASON_NON_DEV_BUILD_CHANNEL,
  EXTERNALITY_REASON_PRE_TAG_DEV_BROWSER,
  EXTERNALITY_REASON_SELF_VERIFICATION,
  SELF_VERIFICATION_UTM_CAMPAIGN_PREFIX,
  TELEMETRY_DATASET,
  VIEW_INSTALL_UNIFIED,
  sqlNotOurOwnTraffic,
  type Externality,
} from "./installUnified";

/** #1198 이 `install_class`·`ft_browser_installs` 를 붙인 표. 뷰의 알갱이 원본. */
export const SOURCE_INSTALL_PROFILE = "analytics_install_profile";

/** 화면이 부르는 콜러블 이름. 프론트 상수와 이 값이 계약이다. */
export const CALLABLE_INSTALL_UNIFIED = "getAdminInstallUnified";

/**
 * ★퍼센트를 만들지 않는 분모 하한 (계획 §4 공통 규칙).
 *
 * 분모가 5 미만이면 한 건이 20%p 이상을 움직인다. 그런 표의 퍼센트는 정보가
 * 아니라 거짓말이다. **분수는 그대로 낸다** — 가리는 것은 비율뿐이고, 원자료를
 * 숨기면 그건 또 다른 종류의 거짓말이다.
 */
export const SMALL_SAMPLE_MIN_DENOMINATOR = 5;

/** 표 한 장이 넘길 수 있는 행 수. 넘으면 잘랐다는 사실을 응답에 적는다. */
export const CHANNEL_ROW_LIMIT = 100;
export const COUNTRY_ROW_LIMIT = 50;

// ════════════════════════════════════════════════════════════════════════════
// 1. 사유 어휘 — '모른다' 와 '없다(진짜 0)' 를 화면 문구까지 갈라 둔다
// ════════════════════════════════════════════════════════════════════════════

/** 사유가 "모른다" 인가 "안다, 없었다" 인가. install-unified 문서 §4-1 의 표와 같다. */
export type ReasonKind = "unknown" | "true_zero" | "known";

export interface ChannelReasonCopy {
  readonly reason: string;
  readonly kind: ReasonKind;
  /** 화면 라벨. */
  readonly label: string;
  /** ★이 사유가 많으면 **우리가 무엇을 하나**. 계획 §2-5 의 결정 문장이다. */
  readonly action: string;
}

/** 캠페인 축이 실재하는 행에 붙는 가짜 사유 키. NULL 을 표의 한 행으로 세우려면 이름이 필요하다. */
export const CHANNEL_REASON_KNOWN = "(known)";

/**
 * ★이 표가 이 페이지에서 가장 중요한 신설물이다(계획 §4-1 표2).
 *
 * 채널별 표가 비었을 때 그게 "광고를 안 켰다" 인지 "조인이 깨졌다" 인지는
 * **여기서만** 알 수 있다. 두 답은 우리가 할 일이 정반대다 — 전자는 아무것도 안
 * 해도 되고, 후자는 오늘 백필을 돌려야 한다.
 */
export const CHANNEL_REASON_COPY: ReadonlyArray<ChannelReasonCopy> = [
  {
    reason: CHANNEL_REASON_KNOWN,
    kind: "known",
    label: "캠페인 실재",
    action: "채널별 표에 이 행들이 올라간다.",
  },
  {
    reason: "no_ledger_row",
    kind: "unknown",
    label: "모름 — 링크백 원장에 이 설치가 없다",
    action:
      "앱이 링크백을 못 보냈다. 배포 버전과 linkInstallAttribution 을 본다.",
  },
  {
    reason: "no_ga_client_id",
    kind: "unknown",
    label: "모름 — 원장에 GA4 client_id 가 없다",
    action: "쿠키·광고 차단으로 웹에서 키를 못 실어 보냈다. 복구 경로가 없다.",
  },
  {
    reason: "key_mismatch",
    kind: "unknown",
    label: "모름 — 가명 조인키(gaKeyHmac)가 없다",
    action: "#1195 배포 전 원장 행이다. 소급 백필을 돌리면 채워진다.",
  },
  {
    reason: "no_ga4_row",
    kind: "unknown",
    label: "모름 — 브리지에 그 방문자가 없다",
    action: "★GA4 브리지 백필을 돌린다. 자연유입이 아니라 조인이 안 된 것이다.",
  },
  {
    reason: "no_utm",
    kind: "true_zero",
    label: "★안다 — 캠페인이 없었다(자연·직접 유입)",
    action:
      "진짜 0 이다. 백필할 것이 없다. 이 수를 결측으로 읽으면 채널 판단이 뒤집힌다.",
  },
];

const REASON_COPY_BY_KEY = new Map(
  CHANNEL_REASON_COPY.map((c) => [c.reason, c] as const),
);

/**
 * 사유 → 화면 어휘. 모르는 사유가 와도 **버리지 않는다** — 뷰가 사다리에 칸을
 * 추가했는데 화면이 조용히 삼키면, 그 설치들은 어느 표에도 안 나온 채 사라진다.
 */
export function describeChannelReason(
  reason: string | null,
): ChannelReasonCopy {
  const key = reason ?? CHANNEL_REASON_KNOWN;
  const found = REASON_COPY_BY_KEY.get(key);
  if (found) return found;
  return {
    reason: key,
    kind: "unknown",
    label: `모름 — 화면이 모르는 사유(${key})`,
    action:
      "뷰의 사유 사다리가 늘었다. adminInstallUnified.CHANNEL_REASON_COPY 에 칸을 추가하라.",
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 1-B. 외부성 어휘 — ★'모름' 을 '외부' 로 반올림하지 않는 자리
// ════════════════════════════════════════════════════════════════════════════
//
// ── 이 절이 왜 생겼나 (실제로 난 사고) ──────────────────────────────────────
//   `isDevInstall` 은 불리언이라 "모른다" 를 담을 칸이 없었고, 귀속 원장 행이 없는
//   설치가 조용히 `false`=외부로 떨어졌다. 그 결과 오너 프로젝트에서 일하던 설치가
//   "외부 지속 사용자 1명" 으로 사장님께 보고됐다가 기각됐다
//   (docs/wiki/30-investigations/sole-persistent-user-is-not-external.md, #1310).
//
// ★그래서 이 모듈의 규율이 하나 늘었다(머리말 4개 + 이것):
//   5) **'외부' 와 '모름' 을 가른다.** `unknown` 은 어느 쪽으로도 반올림하지 않고
//      **분모에서 빼고 별도 칸으로 센다.** 3값으로 바꿔 놓고 화면에서 다시 2값으로
//      접으면 아무것도 안 고친 것이다.

/** 외부성별 설치 수 + **그 판정의 근거**. 근거 없는 판정을 화면에 올리지 않는다. */
export interface ExternalityRow {
  externality: Externality;
  reason: string;
  /** 화면 라벨. */
  label: string;
  /** ★이 사유가 많으면 **우리가 무엇을 하나**. */
  action: string;
  installs: number;
}

export interface ExternalityReasonCopy {
  readonly reason: string;
  readonly externality: Externality;
  readonly label: string;
  readonly action: string;
}

/**
 * 외부성 사유 → 화면 어휘. ★뷰의 `EXTERNALITY_REASONS` 와 **같은 사유 키**를 쓴다.
 *
 * 사유 키가 뷰에서 오고 라벨만 여기 있는 이유는 채널 사유표와 같다 — 사유 문자열을
 * 두 벌 적으면 반드시 갈리고, 갈리면 설치들이 어느 표에도 안 나온 채 사라진다.
 */
export const EXTERNALITY_REASON_COPY: ReadonlyArray<ExternalityReasonCopy> = [
  {
    reason: EXTERNALITY_REASON_NON_DEV_BUILD_CHANNEL,
    externality: "external",
    label: "외부 — dev 가 아닌 빌드 채널을 봤다",
    action:
      "★'우리 팀이 아니다' 가 아니라 '배포본을 실행했다' 까지만 뜻한다. 설치 축에는 '누구' 가 없다.",
  },
  {
    reason: EXTERNALITY_REASON_DEV_BUILD_CHANNEL,
    externality: "internal",
    label: "내부 — dev 빌드 채널을 봤다",
    action: "분모에서 뺐지만 숨기지 않았다. 전체 설치에는 그대로 있다.",
  },
  {
    reason: "no_ledger_row",
    externality: "unknown",
    label: "★모름 — 링크백 원장에 이 설치가 없다",
    action:
      "★외부로 세지 마라. 앱이 링크백을 못 보냈다 — 배포 버전과 linkInstallAttribution 을 본다. #1310 의 A·B·C·D 가 전부 이 칸이었다.",
  },
  {
    reason: "no_build_channel",
    externality: "unknown",
    label: "★모름 — 원장은 있는데 빌드 채널 칸이 비었고 브라우저도 모른다",
    action:
      "★외부로 세지 마라. #1071 이전 앱이거나 install_attribution 스키마 드리프트다(index.ts FIRST_TOUCH_OPTIONAL_COLUMNS). 채널을 적재하면 채워진다.",
  },
  {
    reason: EXTERNALITY_REASON_PRE_TAG_DEV_BROWSER,
    externality: "internal",
    label: "내부 — 채널 칸은 비었지만 그 브라우저가 dev 를 돌린 적이 있다",
    action:
      "#1071(2026-08-21) 이전 앱이라 표식만 없다. 브라우저 일치는 정황이 아니라 관측이다 — 실측 2026-08-29: null 채널 551행의 브라우저 3개가 dev 95행의 브라우저 5개에 완전히 포함된다.",
  },
  {
    reason: EXTERNALITY_REASON_SELF_VERIFICATION,
    externality: "synthetic",
    label: `검증 — 우리가 만든 합성 설치(${SELF_VERIFICATION_UTM_CAMPAIGN_PREFIX}…)`,
    action:
      "★유입이 아니다. 콜러블을 직접 불러 만든 행이다(docs/utm-live-verification-2026-08-24.md). 앞으로의 자체 검증도 이 캠페인 접두사를 써야 유입에 섞이지 않는다.",
  },
];

const EXTERNALITY_COPY_BY_KEY = new Map(
  EXTERNALITY_REASON_COPY.map((c) => [c.reason, c] as const),
);

/**
 * 사유 → 어휘. 모르는 사유가 와도 **버리지 않는다.** ★그리고 모르는 사유는
 * `unknown` 으로 떨어뜨린다 — 화면이 모르는 사유를 외부로 낙관하면 이 티켓이
 * 고친 결함이 이름만 바꿔 되살아난다.
 */
export function describeExternalityReason(
  reason: string | null,
  externality: Externality,
): ExternalityReasonCopy {
  const key = reason ?? "(missing)";
  const found = EXTERNALITY_COPY_BY_KEY.get(key);
  if (found) return found;
  return {
    reason: key,
    externality,
    label: `모름 — 화면이 모르는 외부성 사유(${key})`,
    action:
      "뷰의 외부성 사다리가 늘었다. adminInstallUnified.EXTERNALITY_REASON_COPY 에 칸을 추가하라.",
  };
}

/** 뷰가 돌려준 문자열을 3값으로 좁힌다. ★못 읽으면 `unknown` 이다 — 외부가 아니다. */
export function toExternality(v: unknown): Externality {
  const t = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (t === "external" || t === "internal" || t === "synthetic") return t;
  return "unknown";
}

// ════════════════════════════════════════════════════════════════════════════
// 2. 값 정규화 — BigQuery 가 돌려주는 것을 믿지 않는다
// ════════════════════════════════════════════════════════════════════════════

export function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof v === "bigint") return Number(v);
  if (v && typeof v === "object" && "value" in (v as Record<string, unknown>)) {
    return num((v as { value: unknown }).value);
  }
  return 0;
}

/**
 * ★문자열 축. 빈 문자열을 `(unknown)` 같은 라벨로 **승급시키지 않는다** — NULL 은
 * NULL 로 올려보내고, 화면이 "미상" 이라고 쓸지 "(direct)" 라고 쓸지는 사유 컬럼이
 * 정한다. 여기서 라벨을 지어내면 조인 실패가 채널명으로 둔갑한다.
 */
export function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/** BigQuery DATE 는 `{ value: 'YYYY-MM-DD' }` 로 온다. */
export function dateStr(v: unknown): string | null {
  if (typeof v === "string") return str(v);
  if (v && typeof v === "object" && "value" in (v as Record<string, unknown>)) {
    return dateStr((v as { value: unknown }).value);
  }
  return null;
}

export function bool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.toLowerCase() === "true";
  return false;
}

// ════════════════════════════════════════════════════════════════════════════
// 3. 분수 — 퍼센트보다 분모가 먼저다
// ════════════════════════════════════════════════════════════════════════════

export interface UnifiedRatio {
  numerator: number;
  denominator: number;
  /** 분모가 0 이거나 `SMALL_SAMPLE_MIN_DENOMINATOR` 미만이면 null. 0 이 아니다. */
  rate: number | null;
  /** 분모가 하한 미만 — 화면은 퍼센트 대신 '표본 부족' 을 쓴다. */
  smallSample: boolean;
}

/**
 * ★분자·분모를 **둘 다** 돌려준다. 퍼센트만 남기면 그게 4명 중 1명인지 4천명 중
 * 900명인지 화면에서 복원할 수 없다 — 3.1% 사고가 그렇게 났다.
 */
export function ratio(numerator: number, denominator: number): UnifiedRatio {
  const n = Math.max(0, Math.round(num(numerator)));
  const d = Math.max(0, Math.round(num(denominator)));
  const smallSample = d > 0 && d < SMALL_SAMPLE_MIN_DENOMINATOR;
  return {
    numerator: n,
    denominator: d,
    rate: d === 0 || smallSample ? null : n / d,
    smallSample,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 4. 응답 계약 — 프론트 타입과 한 벌이다
// ════════════════════════════════════════════════════════════════════════════

/**
 * 분모 위생. ★"전체" 와 "사람 추정치" 를 **같이** 낸다.
 *
 * 왜 범위(min~max)인가: `gaKeyHmac` 이 없는 설치는 브라우저를 모른다. 그걸 조용히
 * 1명씩 더하면 사람 수가 부풀고, 조용히 빼면 줄어든다. 둘 다 거짓이라 **양끝을
 * 다 낸다** — 폭이 넓다는 사실 자체가 "아직 못 센다" 는 정보다.
 */
export interface InstallHygiene {
  installsTotal: number;
  /**
   * ★분모의 정본. `externality = 'external'` — **`unknown` 은 안 들어온다.**
   *
   * 예전에는 `NOT isDevInstall` 이었고, 그게 "모른다" 를 외부로 반올림해 사고를
   * 냈다(#1310). 이 수가 갑자기 줄었다면 데이터가 사라진 게 아니라 **원래
   * 몰랐던 것이 이제 미상 칸으로 옮겨간 것**이다.
   */
  installsExternal: number;
  /** `externality = 'internal'` — dev 빌드 채널을 봤거나 그 브라우저를 아는 설치. */
  installsInternal: number;
  /**
   * ★`externality = 'synthetic'` — **우리가 만든** 검증용 합성 설치.
   *
   * `internal` 과 따로 세는 이유: 저 수는 "개발 빌드를 돌렸다" 는 관측이고 이
   * 수는 "이 행을 만들려고 만들었다" 는 사실이다. 합치면 '내부 N' 이 무엇의 N
   * 인지 복원할 수 없다. ★분모에는 둘 다 안 들어간다.
   */
  installsSynthetic: number;
  /**
   * ★`externality = 'unknown'` — 외부인지 내부인지 **모르는** 설치.
   *
   * 분모에 넣지 마라. 이 수가 크다는 것 자체가 "우리는 아직 외부 사용자를 못
   * 센다" 는 정보이고, 그게 지금 화면이 말해야 할 사실이다.
   */
  installsExternalityUnknown: number;
  /** 외부성 판정의 **근거별** 분해. 합이 installsTotal 이다 — 어느 칸도 삼키지 않는다. */
  externalityRows: ExternalityRow[];
  /**
   * 사람 추정치 하한 = 고유 브라우저(gaKey) 수.
   *
   * ★모집단은 `externality <> 'internal'`(외부 + 미상)이다. 브라우저 중복제거는
   *   외부성과 다른 축의 질문이라 미상을 여기서 버리면 사람 수가 통째로 사라진다.
   *   대신 그 사실을 필드 주석과 화면 note 에 적는다 — 조용히 섞지 않는다.
   */
  humanEstimateMin: number;
  /** 상한 = 하한 + 브라우저를 모르는 설치 수. */
  humanEstimateMax: number;
  /** `gaKeyHmac IS NULL` — 브라우저 판정 불가. 조용히 distinct 로 치지 않는다. */
  unknownBrowserInstalls: number;
  /** #1198 `install_class` 분해. 합이 installsTotal 이다. */
  byInstallClass: Array<{ installClass: string; installs: number }>;
  /** 한 브라우저가 만든 최대 설치 수(`ft_browser_installs`). 5 이상이면 재설치 루프. */
  maxInstallsPerBrowser: number | null;
  /** install_class 를 못 읽었을 때의 사유. 읽었으면 null. */
  hygieneMissingReason: string | null;
}

export interface AcquisitionHeadline {
  /** ①설치(외부) — 분모의 정본. */
  hygiene: InstallHygiene;
  /** ②채널을 아는 설치 — "유입 0" 과 "모름" 을 가르는 한 칸. */
  channelKnown: UnifiedRatio;
  /** 첫 스폰 도달(외부 설치 기준). 채널 질을 보는 최소 대조군. */
  spawned: UnifiedRatio;
}

export interface ChannelRow {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  content: string | null;
  installs: number;
  /**
   * ★이 행의 설치 중 외부성이 **미상**인 건수. 0 이 아니면 이 행을 "외부 유입"
   * 으로 읽으면 안 된다. 행을 지우지도, 조용히 외부로 세지도 않고 **칸으로 적는다.**
   */
  externalityUnknown: number;
  spawned: UnifiedRatio;
  completed: UnifiedRatio;
}

export interface MissingReasonRow extends ChannelReasonCopy {
  /** 브리지에 GA4 행이 붙었나. `no_utm` 은 항상 true 다 — 그래서 '안다' 다. */
  hasGa4Row: boolean;
  installs: number;
}

export interface CountryRow {
  country: string | null;
  installs: number;
  /** ★이 행의 설치 중 외부성 미상 건수. ChannelRow 와 같은 규약이다. */
  externalityUnknown: number;
  channelKnown: UnifiedRatio;
  spawned: UnifiedRatio;
}

export interface InstallDayPoint {
  date: string;
  installs: number;
  /** ★그 날 설치 중 외부성 미상 건수. 추이를 '외부 유입 추이' 로 읽지 못하게 한다. */
  externalityUnknown: number;
  channelKnown: number;
}

export interface InstallUnifiedParitySql {
  /**
   * 설치 1행 보존 대조.
   *
   * 세는 단위: 설치 1행(`analytics_install_profile.install_key` /
   * `v_install_unified.installKey`). 이 값이 갈리면 화면 연결을 멈추고 뷰
   * 프로비저닝을 되돌린다.
   */
  installRows: string;
  /**
   * first_run 이벤트 표본과 통합 설치축 대조.
   *
   * 세는 단위가 일부러 다르다: 왼쪽은 옵트인 이벤트를 보낸 clientId 1개,
   * 오른쪽은 설치 1행. 이 쿼리는 "같아야 한다" 가 아니라 이벤트 표본을 설치
   * 분모로 쓰지 못하게 잠그는 경고 장치다.
   */
  firstRunAxisWarning: string;
}

/**
 * ★계획 §3-3 이 요청한 파생 컬럼 중 **아직 뷰에 없는 것**.
 *
 * 화면이 대신 계산하면 §0 의 병(집계가 여러 곳에서 따로 돎)이 그대로 재발한다.
 * 그래서 계산하지 않고 **없다는 사실을 표에 적는다.**
 */
export const PENDING_VIEW_COLUMNS: ReadonlyArray<{
  column: string;
  blocks: string;
}> = [
  {
    column: "retainedD7 / retainedD14 / retainedD30",
    blocks: "채널별 D7·D30 잔존",
  },
  { column: "cohortWeek", blocks: "주간 코호트" },
  { column: "minutesToFirstSpawn", blocks: "첫 스폰까지 중앙 소요(분)" },
];

export interface AcquisitionUnified {
  generatedAt: string;
  /** 뷰를 못 읽었으면 `unavailable`. ★그때 0 을 그리지 않는다. */
  state: "ready" | "unavailable";
  /** `unavailable` 일 때의 사유. 화면이 그대로 보여 준다. */
  reason: string | null;
  /** 근거 — 어느 표에서 나왔나. 숨기지 않는다. */
  source: string;
  rangeDays: number;
  smallSampleMinDenominator: number;
  headline: AcquisitionHeadline | null;
  channelRows: ChannelRow[];
  channelRowsTruncated: boolean;
  missingReasonRows: MissingReasonRow[];
  countryRows: CountryRow[];
  countryRowsTruncated: boolean;
  installsByDay: InstallDayPoint[];
  pendingColumns: ReadonlyArray<{ column: string; blocks: string }>;
  notes: string[];
}

// ════════════════════════════════════════════════════════════════════════════
// 5. SQL — GROUP BY 와 필터뿐이다. 새 지표를 만들지 않는다
// ════════════════════════════════════════════════════════════════════════════

function viewRef(projectId: string): string {
  return `\`${projectId}.${TELEMETRY_DATASET}.${VIEW_INSTALL_UNIFIED}\``;
}

function profileRef(projectId: string): string {
  return `\`${projectId}.${TELEMETRY_DATASET}.${SOURCE_INSTALL_PROFILE}\``;
}

/**
 * ★헤드라인은 뷰 하나만 읽는다. 보조 프로필 컬럼(`install_class`)이 아직 없거나
 * 덜 배포돼도 설치 분모 화면 전체를 죽이면 안 된다. 재설치 루프 최대값은
 * `v_install_unified.gaKeyInstallCount` 로 이미 노출된다.
 */
export function buildHygieneSql(projectId: string): string {
  return `SELECT
  COUNT(*)                                              AS installsTotal,
  -- ★분모의 정본. 'unknown' 은 여기 안 들어온다 — 그게 이 티켓의 요점이다.
  COUNTIF(u.externality = 'external')                   AS installsExternal,
  COUNTIF(u.externality = 'internal')                   AS installsInternal,
  -- ★우리가 만든 검증 행. 내부와 합치지 않는다 — 근거가 다른 사실이다.
  COUNTIF(u.externality = 'synthetic')                  AS installsSynthetic,
  -- ★미상은 별도 칸이다. 어느 쪽으로도 반올림하지 않는다.
  COUNTIF(u.externality = 'unknown')                    AS installsExternalityUnknown,
  COUNTIF(u.externality = 'external' AND u.hasGa4Row)   AS channelKnownInstalls,
  COUNTIF(u.externality = 'external' AND u.hasSpawned)  AS spawnedExternal,
  -- ★사람 추정치 하한. 브라우저 중복제거는 외부성과 **다른 축의 질문**이라
  --   모집단이 '우리 트래픽이 아닌 설치'(외부 + 미상)다. 그 사실은 note 로 화면에 적는다.
  COUNT(DISTINCT IF(${sqlNotOurOwnTraffic("u")}, u.gaKeyHmac, NULL)) AS distinctBrowsers,
  -- ★상한을 만드는 항. 브라우저를 모르는 설치는 조용히 1명으로도 0명으로도 치지 않는다.
  COUNTIF(${sqlNotOurOwnTraffic("u")} AND u.gaKeyHmac IS NULL) AS unknownBrowserInstalls,
  MAX(u.gaKeyInstallCount)                              AS maxInstallsPerBrowser
FROM ${viewRef(projectId)} u`;
}

/**
 * ★외부성 × 판정근거 분해표. 이 티켓의 핵심 신설물이다.
 *
 * "외부 설치가 몇이냐" 보다 먼저 답해야 하는 것이 **"그 판정의 근거가 있느냐"** 다.
 * 근거 컬럼이 없어서 A·B·C·D 넷이 근거 0 인 채로 외부에 섞였고, 그게 검증 불가능
 * 했기 때문에 잘못된 보고가 사장님까지 올라갔다(#1310).
 *
 * 합이 `installsTotal` 이다 — 어느 칸도 삼키지 않는다.
 */
export function buildExternalitySql(projectId: string): string {
  return `SELECT
  externality           AS externality,
  externalityReason     AS reason,
  COUNT(*)              AS installs
FROM ${viewRef(projectId)}
GROUP BY externality, reason
ORDER BY installs DESC`;
}

/** #1198 분모 위생 등급 분해. 합이 installsTotal 이다 — 어느 등급도 삼키지 않는다. */
export function buildInstallClassSql(projectId: string): string {
  return `SELECT
  IFNULL(p.install_class, 'unknown') AS installClass,
  COUNT(*)                           AS installs
FROM ${viewRef(projectId)} u
LEFT JOIN ${profileRef(projectId)} p ON u.installKey = p.install_key
GROUP BY installClass
ORDER BY installs DESC`;
}

/**
 * 채널별 통합표. ★`channelMissingReason IS NULL` — 캠페인이 **실재하는** 행만.
 *
 * 광고를 켜기 전인 지금 이 표는 0행이고, 그 자리에 화면이 "유료 광고를 켠 적이
 * 없습니다" 라고 쓴다. 빈 표를 '유입 0' 으로 속이지 않는다(계획 §4-1 표1).
 */
export function buildChannelSql(projectId: string): string {
  return `SELECT
  channelSource                          AS source,
  channelMedium                          AS medium,
  channelCampaign                        AS campaign,
  channelContent                         AS content,
  COUNT(*)                               AS installs,
  -- ★이 행에 섞인 '외부성 미상' 건수. 행을 지우지도, 외부로 세지도 않는다.
  COUNTIF(externality = 'unknown')       AS externalityUnknown,
  COUNTIF(hasSpawned)                    AS spawned,
  COUNTIF(firstCompletedAt IS NOT NULL)  AS completed
FROM ${viewRef(projectId)}
-- ★우리 트래픽(내부 + 검증)만 뺀다. 미상을 여기서 지우면 '캠페인 유입이 없다'
--   로 읽히고, 외부로 세면 이 티켓이 고친 반올림이 되살아난다 — 그래서 남기고
--   옆 칸에 센다. ★검증 행을 빼지 않으면 자체 검증 utm 이 '광고 채널 1건' 으로
--   표에 올라간다(실측 2026-08-29 의 그 1행).
WHERE channelMissingReason IS NULL AND ${sqlNotOurOwnTraffic()}
GROUP BY source, medium, campaign, content
ORDER BY installs DESC
LIMIT ${CHANNEL_ROW_LIMIT + 1}`;
}

/** ★채널 미상 사유표. 이 페이지에서 가장 중요한 신설물(계획 §4-1 표2). */
export function buildMissingReasonSql(projectId: string): string {
  return `SELECT
  IFNULL(channelMissingReason, '${CHANNEL_REASON_KNOWN}') AS reason,
  hasGa4Row                                               AS hasGa4Row,
  COUNT(*)                                                AS installs
FROM ${viewRef(projectId)}
-- ★우리 트래픽(내부 + 검증)만 뺀다(외부성 분해는 buildExternalitySql 이 따로 한다).
WHERE ${sqlNotOurOwnTraffic()}
GROUP BY reason, hasGa4Row
ORDER BY installs DESC`;
}

/** 국가별. 다운로드 0 국가는 방문 축(getAdminCountryFunnel)이 계속 말한다. */
export function buildCountrySql(projectId: string): string {
  return `SELECT
  channelCountry                    AS country,
  COUNT(*)                          AS installs,
  COUNTIF(externality = 'unknown')  AS externalityUnknown,
  COUNTIF(hasGa4Row)                AS channelKnown,
  COUNTIF(hasSpawned)               AS spawned
FROM ${viewRef(projectId)}
WHERE ${sqlNotOurOwnTraffic()}
GROUP BY country
ORDER BY installs DESC
LIMIT ${COUNTRY_ROW_LIMIT + 1}`;
}

/**
 * 일별 설치 추이(차트용). ★`firstRunAt` 이 없는 설치는 **빼고 그 사실을 적는다** —
 * 없는 날짜를 지어내 오늘로 몰면 추이가 통째로 거짓이 된다.
 */
export function buildInstallsByDaySql(projectId: string): string {
  return `SELECT
  DATE(firstRunAt)                  AS day,
  COUNT(*)                          AS installs,
  COUNTIF(externality = 'unknown')  AS externalityUnknown,
  COUNTIF(hasGa4Row)                AS channelKnown
FROM ${viewRef(projectId)}
WHERE ${sqlNotOurOwnTraffic()}
  AND firstRunAt IS NOT NULL
  AND DATE(firstRunAt) >= DATE_SUB(CURRENT_DATE(), INTERVAL @days DAY)
GROUP BY day
ORDER BY day`;
}

export function buildInstallUnifiedParitySql(
  projectId: string,
): InstallUnifiedParitySql {
  return {
    installRows: `SELECT
  (SELECT COUNT(*) FROM ${profileRef(projectId)})                    AS sourceInstallRows,
  (SELECT COUNT(*) FROM ${viewRef(projectId)})                       AS unifiedInstallRows,
  (SELECT COUNT(DISTINCT installKey) FROM ${viewRef(projectId)})     AS unifiedDistinctInstalls`,
    firstRunAxisWarning: `SELECT
  (SELECT COUNT(DISTINCT userId)
   FROM \`${projectId}.${TELEMETRY_DATASET}.events\`
   WHERE event = 'app:first_run')                                    AS eventClientIds,
  (SELECT COUNT(*)
   FROM ${viewRef(projectId)}
   WHERE firstRunAt IS NOT NULL)                                     AS unifiedInstallRowsWithFirstRun`,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 6. 행 조립 — 서버에서 마스킹한다(계획 §5 PR 2)
// ════════════════════════════════════════════════════════════════════════════

export type BqRow = Record<string, unknown>;

/**
 * 외부성 분해표. ★`installs` 내림차순이되 **미상을 먼저** 올린다 — 이 표를 보는
 * 이유가 "얼마나 모르나" 이기 때문이다. 모름이 맨 아래 있으면 아무도 안 본다.
 */
export function buildExternalityRows(
  rows: ReadonlyArray<BqRow> | null,
): ExternalityRow[] {
  const order: Record<Externality, number> = {
    unknown: 0,
    external: 1,
    synthetic: 2,
    internal: 3,
  };
  return (rows ?? [])
    .map((r) => {
      const externality = toExternality(r.externality);
      const copy = describeExternalityReason(str(r.reason), externality);
      return {
        externality: copy.externality,
        reason: copy.reason,
        label: copy.label,
        action: copy.action,
        installs: num(r.installs),
      };
    })
    .sort(
      (a, b) =>
        order[a.externality] - order[b.externality] || b.installs - a.installs,
    );
}

export function buildHygiene(
  headRow: BqRow | undefined,
  classRows: ReadonlyArray<BqRow> | null,
  externalityRows: ReadonlyArray<BqRow> | null = null,
): InstallHygiene {
  const h = headRow ?? {};
  const distinctBrowsers = num(h.distinctBrowsers);
  const unknownBrowserInstalls = num(h.unknownBrowserInstalls);
  const maxPerBrowser =
    h.maxInstallsPerBrowser == null ? null : num(h.maxInstallsPerBrowser);
  return {
    installsTotal: num(h.installsTotal),
    installsExternal: num(h.installsExternal),
    installsInternal: num(h.installsInternal),
    installsSynthetic: num(h.installsSynthetic),
    installsExternalityUnknown: num(h.installsExternalityUnknown),
    externalityRows: buildExternalityRows(externalityRows),
    humanEstimateMin: distinctBrowsers,
    humanEstimateMax: distinctBrowsers + unknownBrowserInstalls,
    unknownBrowserInstalls,
    byInstallClass: (classRows ?? []).map((r) => ({
      installClass: str(r.installClass) ?? "unknown",
      installs: num(r.installs),
    })),
    maxInstallsPerBrowser: maxPerBrowser,
    hygieneMissingReason:
      classRows === null
        ? `${SOURCE_INSTALL_PROFILE}.install_class 를 못 읽었다 — #1198 배포 전이거나 컬럼이 없다. 사람 추정치는 gaKey 축으로만 냈다.`
        : null,
  };
}

export function buildChannelRows(rows: ReadonlyArray<BqRow>): {
  rows: ChannelRow[];
  truncated: boolean;
} {
  const truncated = rows.length > CHANNEL_ROW_LIMIT;
  return {
    truncated,
    rows: rows.slice(0, CHANNEL_ROW_LIMIT).map((r) => {
      const installs = num(r.installs);
      return {
        source: str(r.source),
        medium: str(r.medium),
        campaign: str(r.campaign),
        content: str(r.content),
        installs,
        externalityUnknown: num(r.externalityUnknown),
        spawned: ratio(num(r.spawned), installs),
        completed: ratio(num(r.completed), installs),
      };
    }),
  };
}

/**
 * ★사유표. `kind` 로 '모른다' 와 '안다, 없었다' 를 갈라 실어 보낸다 — 화면이
 * 문자열을 다시 해석하게 두면 두 벌이 갈린다.
 */
export function buildMissingReasonRows(
  rows: ReadonlyArray<BqRow>,
): MissingReasonRow[] {
  return rows
    .map((r) => {
      const copy = describeChannelReason(str(r.reason));
      return {
        ...copy,
        hasGa4Row: bool(r.hasGa4Row),
        installs: num(r.installs),
      };
    })
    .sort((a, b) => b.installs - a.installs);
}

export function buildCountryRows(rows: ReadonlyArray<BqRow>): {
  rows: CountryRow[];
  truncated: boolean;
} {
  const truncated = rows.length > COUNTRY_ROW_LIMIT;
  return {
    truncated,
    rows: rows.slice(0, COUNTRY_ROW_LIMIT).map((r) => {
      const installs = num(r.installs);
      return {
        country: str(r.country),
        installs,
        externalityUnknown: num(r.externalityUnknown),
        channelKnown: ratio(num(r.channelKnown), installs),
        spawned: ratio(num(r.spawned), installs),
      };
    }),
  };
}

export function buildInstallsByDay(
  rows: ReadonlyArray<BqRow>,
): InstallDayPoint[] {
  const points: InstallDayPoint[] = [];
  for (const r of rows) {
    const date = dateStr(r.day);
    // ★날짜가 없으면 그 행을 버린다. 오늘로 몰면 추이가 거짓이 된다.
    if (!date) continue;
    points.push({
      date,
      installs: num(r.installs),
      externalityUnknown: num(r.externalityUnknown),
      channelKnown: num(r.channelKnown),
    });
  }
  return points.sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
}

/**
 * ★화면이 스스로 알 수 없는 caveat 을 서버가 적어 보낸다. 주석은 안 읽히고
 *   문서는 안 열리지만, 표 밑의 한 줄은 읽힌다.
 */
export function buildNotes(
  hygiene: InstallHygiene,
  byDayRows: number,
  byDay: number,
): string[] {
  const notes: string[] = [];
  if (
    hygiene.maxInstallsPerBrowser != null &&
    hygiene.maxInstallsPerBrowser >= 5
  ) {
    notes.push(
      `★분모 위생 경보 — 한 브라우저가 만든 설치가 최대 ${hygiene.maxInstallsPerBrowser}건이다. ` +
        "사람 수가 아니라 재설치 루프를 세고 있을 가능성이 높다(#1198 install_class).",
    );
  }
  if (hygiene.unknownBrowserInstalls > 0) {
    notes.push(
      `브라우저를 모르는 설치 ${hygiene.unknownBrowserInstalls}건은 사람 추정치의 하한에도 상한에도 ` +
        "한쪽으로만 들어간다 — 그래서 추정치를 범위로 낸다.",
    );
  }
  if (hygiene.installsInternal > 0) {
    notes.push(
      `내부(dev 빌드 채널이거나 그 브라우저를 아는) 설치 ${hygiene.installsInternal}건은 분모에서 뺐지만 ` +
        "숨기지 않았다 — 전체는 위 '전체 설치' 에 그대로 있다. ★원본 행은 하나도 지우지 않았다. " +
        "바뀐 것은 해석뿐이다.",
    );
  }
  // ★검증 행을 '유입 1' 로 읽던 자리. 이 note 가 없으면 분모가 1 줄어든 이유를
  //   다음 사람이 데이터 유실로 오해한다.
  if (hygiene.installsSynthetic > 0) {
    notes.push(
      `★검증용 합성 설치 ${hygiene.installsSynthetic}건(${SELF_VERIFICATION_UTM_CAMPAIGN_PREFIX}… 캠페인)은 ` +
        "우리가 콜러블을 직접 불러 만든 행이라 유입 분모에서 뺐다 — 광고 유입이 아니다. " +
        "행은 그대로 있고 채널표에서만 빠진다.",
    );
  }
  // ★"실사용자 0" 을 화면이 0 으로 말하게 하는 자리. 빈 칸은 아무 말도 하지
  //   않지만, 이 문장은 "아직 한 명도 없다" 를 명시한다 — 그것이 지금의 사실이다.
  if (
    hygiene.installsExternal === 0 &&
    hygiene.installsTotal > 0 &&
    hygiene.installsExternalityUnknown === 0
  ) {
    notes.push(
      "★외부(실사용자) 설치가 0 이고 미상도 0 이다 — 전체 설치가 전부 우리 것(내부 + 검증)으로 " +
        "설명된다. 빈 칸이 아니라 **아직 실사용자 유입이 한 건도 없다**는 뜻이다.",
    );
  }
  // ★이 티켓이 심은 경보. 미상이 남아 있는 한 "외부 사용자 N명" 은 하한이지
  //   실측이 아니다 — 그 사실을 표 밑 한 줄로 못 박는다.
  if (hygiene.installsExternalityUnknown > 0) {
    const share =
      hygiene.installsTotal > 0
        ? Math.round(
            (hygiene.installsExternalityUnknown / hygiene.installsTotal) * 100,
          )
        : 0;
    const top = hygiene.externalityRows.find(
      (r) => r.externality === "unknown",
    );
    notes.push(
      `★외부성 미상 ${hygiene.installsExternalityUnknown}건(전체의 ${share}%)은 ` +
        "외부에도 내부에도 넣지 않고 분모에서 뺐다 — 그래서 위 '설치 (외부)' 는 " +
        "실측이 아니라 **하한**이다. 이 수를 외부로 세면 #1310 의 오분류가 되살아난다." +
        (top ? ` 가장 많은 사유: ${top.label} (${top.installs}건) — ${top.action}` : ""),
    );
  }
  if (hygiene.installsExternalityUnknown > 0 || hygiene.installsInternal > 0) {
    notes.push(
      "사람 추정 범위의 모집단은 '내부가 아닌 설치'(외부 + 외부성 미상)다 — " +
        "브라우저 중복제거는 외부성과 다른 축의 질문이라 미상을 여기서 버리지 않았다.",
    );
  }
  if (byDayRows > byDay) {
    notes.push(
      `일별 추이에서 ${byDayRows - byDay}일치를 뺐다 — 날짜(firstRunAt)가 없는 행이다. ` +
        "없는 날짜를 오늘로 몰지 않는다.",
    );
  }
  return notes;
}

/** 뷰를 못 읽었을 때의 응답. ★0 이 아니라 사유다. */
export function unavailable(
  projectId: string,
  rangeDays: number,
  reason: string,
  generatedAt: string,
): AcquisitionUnified {
  return {
    generatedAt,
    state: "unavailable",
    reason,
    source: `${projectId}.${TELEMETRY_DATASET}.${VIEW_INSTALL_UNIFIED}`,
    rangeDays,
    smallSampleMinDenominator: SMALL_SAMPLE_MIN_DENOMINATOR,
    headline: null,
    channelRows: [],
    channelRowsTruncated: false,
    missingReasonRows: [],
    countryRows: [],
    countryRowsTruncated: false,
    installsByDay: [],
    pendingColumns: PENDING_VIEW_COLUMNS,
    notes: [],
  };
}

/** 조회 기간. 화면 토글이 주는 값을 그대로 믿지 않는다. */
export function normalizeRangeDays(raw: unknown): number {
  const n = Math.round(num(raw));
  if (!Number.isFinite(n) || n <= 0) return 30;
  return Math.min(365, Math.max(1, n));
}
