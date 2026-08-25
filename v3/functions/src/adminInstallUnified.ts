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

import { TELEMETRY_DATASET, VIEW_INSTALL_UNIFIED } from "./installUnified";

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
    action: "앱이 링크백을 못 보냈다. 배포 버전과 linkInstallAttribution 을 본다.",
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
    action: "진짜 0 이다. 백필할 것이 없다. 이 수를 결측으로 읽으면 채널 판단이 뒤집힌다.",
  },
];

const REASON_COPY_BY_KEY = new Map(
  CHANNEL_REASON_COPY.map((c) => [c.reason, c] as const)
);

/**
 * 사유 → 화면 어휘. 모르는 사유가 와도 **버리지 않는다** — 뷰가 사다리에 칸을
 * 추가했는데 화면이 조용히 삼키면, 그 설치들은 어느 표에도 안 나온 채 사라진다.
 */
export function describeChannelReason(reason: string | null): ChannelReasonCopy {
  const key = reason ?? CHANNEL_REASON_KNOWN;
  const found = REASON_COPY_BY_KEY.get(key);
  if (found) return found;
  return {
    reason: key,
    kind: "unknown",
    label: `모름 — 화면이 모르는 사유(${key})`,
    action: "뷰의 사유 사다리가 늘었다. adminInstallUnified.CHANNEL_REASON_COPY 에 칸을 추가하라.",
  };
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
  /** ★분모의 정본. `NOT isDevInstall`. 화면 맨 위에 못 박는다(계획 §4-1). */
  installsExternal: number;
  installsDev: number;
  /** 사람 추정치 하한 = 고유 브라우저(gaKey) 수. */
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
  channelKnown: UnifiedRatio;
  spawned: UnifiedRatio;
}

export interface InstallDayPoint {
  date: string;
  installs: number;
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
  { column: "retainedD7 / retainedD14 / retainedD30", blocks: "채널별 D7·D30 잔존" },
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
  COUNTIF(NOT u.isDevInstall)                           AS installsExternal,
  COUNTIF(u.isDevInstall)                               AS installsDev,
  COUNTIF(NOT u.isDevInstall AND u.hasGa4Row)           AS channelKnownInstalls,
  COUNTIF(NOT u.isDevInstall AND u.hasSpawned)          AS spawnedExternal,
  -- ★사람 추정치 하한. 브라우저를 아는 외부 설치를 gaKey 로 접는다.
  COUNT(DISTINCT IF(NOT u.isDevInstall, u.gaKeyHmac, NULL)) AS distinctBrowsers,
  -- ★상한을 만드는 항. 브라우저를 모르는 설치는 조용히 1명으로도 0명으로도 치지 않는다.
  COUNTIF(NOT u.isDevInstall AND u.gaKeyHmac IS NULL)   AS unknownBrowserInstalls,
  MAX(u.gaKeyInstallCount)                              AS maxInstallsPerBrowser
FROM ${viewRef(projectId)} u`;
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
  COUNTIF(hasSpawned)                    AS spawned,
  COUNTIF(firstCompletedAt IS NOT NULL)  AS completed
FROM ${viewRef(projectId)}
WHERE channelMissingReason IS NULL AND NOT isDevInstall
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
WHERE NOT isDevInstall
GROUP BY reason, hasGa4Row
ORDER BY installs DESC`;
}

/** 국가별. 다운로드 0 국가는 방문 축(getAdminCountryFunnel)이 계속 말한다. */
export function buildCountrySql(projectId: string): string {
  return `SELECT
  channelCountry       AS country,
  COUNT(*)             AS installs,
  COUNTIF(hasGa4Row)   AS channelKnown,
  COUNTIF(hasSpawned)  AS spawned
FROM ${viewRef(projectId)}
WHERE NOT isDevInstall
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
  DATE(firstRunAt)      AS day,
  COUNT(*)              AS installs,
  COUNTIF(hasGa4Row)    AS channelKnown
FROM ${viewRef(projectId)}
WHERE NOT isDevInstall
  AND firstRunAt IS NOT NULL
  AND DATE(firstRunAt) >= DATE_SUB(CURRENT_DATE(), INTERVAL @days DAY)
GROUP BY day
ORDER BY day`;
}

export function buildInstallUnifiedParitySql(
  projectId: string
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

export function buildHygiene(
  headRow: BqRow | undefined,
  classRows: ReadonlyArray<BqRow> | null
): InstallHygiene {
  const h = headRow ?? {};
  const distinctBrowsers = num(h.distinctBrowsers);
  const unknownBrowserInstalls = num(h.unknownBrowserInstalls);
  const maxPerBrowser = h.maxInstallsPerBrowser == null
    ? null
    : num(h.maxInstallsPerBrowser);
  return {
    installsTotal: num(h.installsTotal),
    installsExternal: num(h.installsExternal),
    installsDev: num(h.installsDev),
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
  rows: ReadonlyArray<BqRow>
): MissingReasonRow[] {
  return rows
    .map((r) => {
      const copy = describeChannelReason(str(r.reason));
      return { ...copy, hasGa4Row: bool(r.hasGa4Row), installs: num(r.installs) };
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
        channelKnown: ratio(num(r.channelKnown), installs),
        spawned: ratio(num(r.spawned), installs),
      };
    }),
  };
}

export function buildInstallsByDay(
  rows: ReadonlyArray<BqRow>
): InstallDayPoint[] {
  const points: InstallDayPoint[] = [];
  for (const r of rows) {
    const date = dateStr(r.day);
    // ★날짜가 없으면 그 행을 버린다. 오늘로 몰면 추이가 거짓이 된다.
    if (!date) continue;
    points.push({
      date,
      installs: num(r.installs),
      channelKnown: num(r.channelKnown),
    });
  }
  return points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * ★화면이 스스로 알 수 없는 caveat 을 서버가 적어 보낸다. 주석은 안 읽히고
 *   문서는 안 열리지만, 표 밑의 한 줄은 읽힌다.
 */
export function buildNotes(hygiene: InstallHygiene, byDayRows: number, byDay: number): string[] {
  const notes: string[] = [];
  if (
    hygiene.maxInstallsPerBrowser != null &&
    hygiene.maxInstallsPerBrowser >= 5
  ) {
    notes.push(
      `★분모 위생 경보 — 한 브라우저가 만든 설치가 최대 ${hygiene.maxInstallsPerBrowser}건이다. ` +
        "사람 수가 아니라 재설치 루프를 세고 있을 가능성이 높다(#1198 install_class)."
    );
  }
  if (hygiene.unknownBrowserInstalls > 0) {
    notes.push(
      `브라우저를 모르는 설치 ${hygiene.unknownBrowserInstalls}건은 사람 추정치의 하한에도 상한에도 ` +
        "한쪽으로만 들어간다 — 그래서 추정치를 범위로 낸다."
    );
  }
  if (hygiene.installsDev > 0) {
    notes.push(
      `개발·dev 태깅 설치 ${hygiene.installsDev}건은 분모에서 뺐지만 숨기지 않았다 — ` +
        "전체는 위 '전체 설치' 에 그대로 있다."
    );
  }
  if (byDayRows > byDay) {
    notes.push(
      `일별 추이에서 ${byDayRows - byDay}일치를 뺐다 — 날짜(firstRunAt)가 없는 행이다. ` +
        "없는 날짜를 오늘로 몰지 않는다."
    );
  }
  return notes;
}

/** 뷰를 못 읽었을 때의 응답. ★0 이 아니라 사유다. */
export function unavailable(
  projectId: string,
  rangeDays: number,
  reason: string,
  generatedAt: string
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
