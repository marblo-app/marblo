// 봇 트래픽 판별 — 순수 로직(BQ/Firestore 무의존). node --test 로 단위검증한다
// (countryFunnel.ts / ga4Bridge.ts 와 같은 규약).
//
// ── ★무엇을 푸나 (ticket IU1KDbYAv7FEewPkwHPU) ──────────────────────────────
// 인스타·유튜브·X(해외) 소액 집행을 앞두고 "봇은 거를 수 있나" 가 질문이었다.
// 거를 수 있다. GA4 원본(analytics_543991508, asia-northeast3)에서 실측한 지문은
// 이렇게 갈린다 (최근 30일, 2026-08-24 측정):
//
//   Iran         106명  device×browser×os 조합 **1가지**  다운로드 0
//   Luxembourg    12명  조합 1가지                        다운로드 0
//   Netherlands    9명  조합 1가지                        다운로드 0
//   Singapore      8명  조합 1가지                        다운로드 0
//   ────────────────────────────────────────────────────────────────
//   South Korea  201명  조합 15가지(최다 점유 24%)        다운로드 12
//   United States 19명  조합 11가지                       다운로드 0
//
// 106명이 전부 같은 OS·브라우저·기기종류인 인구 집단은 없다. GA4 기본 봇 필터가
// 켜져 있는데도 통과했다 — **알려진 봇 리스트로는 안 잡힌다**는 뜻이다.
//
// ── ★설계 원칙 셋 ──────────────────────────────────────────────────────────
//
// ① **가장 강한 필터는 규칙이 아니라 분모다.** 봇은 Electron 데스크톱을 내려받아
//    설치하고 실행하지 않는다. 그래서 CAC·채널 표의 기본 분모를 방문이 아니라
//    다운로드·설치로 고정한다(countryFunnel.FUNNEL_PRIMARY_DENOMINATOR /
//    analyticsAdSpend.CAC_ACQUISITION_BASIS). 그 분모를 쓰는 순간 아래 지문
//    규칙이 하나도 없어도 봇은 이미 0으로 센다. 지문 규칙은 **방문 축을 읽을
//    때만** 필요한 두 번째 방어선이다.
//
// ② **국가로 차단하지 않는다.** 이란·네덜란드에 진짜 사용자가 생기면 영영 안
//    보이게 된다. 국가는 여기서 **집계 단위(코호트)** 일 뿐이고 판정 축이
//    아니다. 판정 축은 두 가지 행동값이다 —
//      (a) 그 코호트의 device×browser×os 조합이 몇 가지인가(단일지문 집중도),
//      (b) 다운로드가 0인가.
//    실측이 이 구분을 증명한다: United States 19명은 다운로드가 0이지만 지문이
//    11가지라 통과하고, Mexico 2명은 지문이 1가지지만 둘 다 다운로드해서 판정
//    대상에서 아예 빠진다. 국가 목록이었다면 둘 다 틀렸을 것이다.
//
// ③ **거른 것을 버리지 않는다.** 의심 유입은 삭제가 아니라 `suspectedVisitors`
//    로 **따로 표기**된다. 조용히 뺀 숫자는 이 프로젝트가 이미 세 번 밟은
//    함정이고, 미매칭 광고비를 보이게 한 #1193 과 같은 원칙이다.
//
// ── ★판정은 파생이다 ───────────────────────────────────────────────────────
// 이 모듈은 원장에 아무것도 쓰지 않는다. `bot` 플래그를 BigQuery 행에 구워
// 넣으면 규칙이 바뀌었을 때 과거를 다시 못 읽는다. 입력은 읽기 전용이고 출력은
// 매 조회마다 새로 계산되는 판정문이다. 규칙을 바꾸면 **과거 데이터가 즉시 새
// 규칙으로 다시 읽힌다.**

// ── 규칙 파라미터 ───────────────────────────────────────────────────────────

/**
 * 판정풀이 이 인원 미만이면 코호트를 판정하지 않는다.
 *
 * 소수 코호트는 지문이 1가지인 게 정상이다 — 실측에서 Japan 2명·Canada 1명이
 * 전부 단일지문이었다. 8은 실측 최소 봇 코호트(Singapore 8, 티켓 시점 Norway 9)
 * 는 잡고 그 아래 자연 소수 코호트는 건드리지 않는 선이다.
 */
export const SUSPECT_MIN_COHORT_VISITORS = 8;

/**
 * 판정풀에서 최다 지문의 점유율이 이 값 이상이면 '단일지문 집중'.
 *
 * 1.0 이 아니라 0.95 인 이유: 봇 무리에 실사용자 한 명이 섞여도 판정이 통째로
 * 무너지면 안 된다. 대신 **의심으로 세는 것은 그 최다 지문을 가진 방문자뿐**
 * 이므로(§suspectedVisitors), 섞여 있던 다른 지문의 방문자는 의심에 들어가지
 * 않는다. 대조군 South Korea 의 최다 점유율은 0.237 이라 여유가 크다.
 */
export const SUSPECT_SIGNATURE_SHARE = 0.95;

/** 코호트 축. 국가는 **집계 단위**이지 차단 목록이 아니다(머리말 ②). */
export const SUSPECT_COHORT_AXIS = "country";

/** 코호트 키가 비었을 때의 라벨. countryFunnel.UNKNOWN_COUNTRY 와 같은 관례. */
export const UNKNOWN_COHORT = "(unknown)";

// ── 입력 ────────────────────────────────────────────────────────────────────

/**
 * GA4 방문자 한 명. 값은 BigQuery 에서 그대로 온 것이라 전부 신뢰하지 않는다.
 * 세 지문 축은 GA4 export 의 `device.category` ·
 * `device.web_info.browser` · `device.operating_system` 이다.
 */
export interface FingerprintVisitorRow {
  gaClientId?: unknown;
  country?: unknown;
  deviceCategory?: unknown;
  browser?: unknown;
  operatingSystem?: unknown;
  downloads?: unknown;
}

// ── 출력 ────────────────────────────────────────────────────────────────────

export interface SuspectCohort {
  /** 집계 단위(현재 축 = 국가). 차단 목록이 아니다. */
  cohort: string;
  /** 코호트 전체 방문자(의심 포함 — 아무것도 버리지 않는다). */
  visitors: number;
  /** 코호트 전체 다운로드 이벤트 수. */
  downloads: number;
  /** 다운로드가 1건 이상인 방문자 수. */
  downloaders: number;
  /** 판정풀 = 다운로드 0 **그리고** 지문 3축이 모두 해석된 방문자. */
  judgedVisitors: number;
  /** 지문 3축 중 하나라도 비어 판정할 수 없는 방문자(다운로드 0 중). */
  unresolvedVisitors: number;
  /** 판정풀 안의 고유 지문 가짓수. */
  distinctFingerprints: number;
  topFingerprint: string | null;
  topFingerprintVisitors: number;
  /** 최다 지문 점유율(판정풀 기준). 판정풀이 비면 null. */
  topFingerprintShare: number | null;
  suspected: boolean;
  /** 의심으로 분리되는 방문자 수 — 최다 지문을 가진 판정풀 방문자만. */
  suspectedVisitors: number;
  /** 사람이 읽는 판정 근거. 화면이 "왜" 를 말할 수 있게 문자열로 남긴다. */
  reason: string;
}

export interface BotTrafficRule {
  cohortAxis: typeof SUSPECT_COHORT_AXIS;
  minCohortVisitors: number;
  signatureShare: number;
  fingerprintAxes: readonly ["deviceCategory", "browser", "operatingSystem"];
  /** 규칙이 파생이라는 사실을 응답에 실어 둔다 — 원장에 굽지 않는다. */
  derived: true;
}

export interface BotTrafficVerdict {
  rule: BotTrafficRule;
  /** 전체 코호트. 의심 먼저, 그 다음 판정풀 크기 순. */
  cohorts: SuspectCohort[];
  /** 의심 코호트만. */
  suspectedCohorts: SuspectCohort[];
  totals: {
    visitors: number;
    suspectedVisitors: number;
    /** 의심을 뺀 방문 — 방문 축의 기본값. */
    qualifiedVisitors: number;
    downloads: number;
    downloaders: number;
    suspectedCohorts: number;
  };
  notes: string[];
}

// ── 정규화 ──────────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** 코호트 라벨. 비어 있으면 지어내지 않고 `(unknown)` 으로 남긴다. */
export function normalizeCohort(raw: unknown): string {
  const v = str(raw);
  return v.length > 0 ? v : UNKNOWN_COHORT;
}

/**
 * 지문 = `device / browser / os`.
 *
 * ★세 축이 **전부** 있어야 지문으로 인정한다. 하나라도 비면 null 이고 판정풀에
 *   들어가지 않는다. 이게 없으면 GA4 가 device 필드를 통째로 못 채운 날
 *   모두가 `(unknown)` 이라는 **하나의 지문**을 공유해 전 세계가 봇으로 잡힌다.
 *   판정 불능은 무죄다.
 */
export function trafficFingerprint(row: FingerprintVisitorRow): string | null {
  const device = str(row.deviceCategory);
  const browser = str(row.browser);
  const os = str(row.operatingSystem);
  if (!device || !browser || !os) return null;
  return `${device} / ${browser} / ${os}`;
}

/**
 * 이 방문자가 판정 대상인가 = 다운로드 0 **그리고** 지문이 해석됨.
 *
 * ★다운로드한 방문자는 어떤 코호트에 있든 판정 대상이 아니다. 이란에 진짜
 *   사용자가 생겨 앱을 내려받으면 그 사람은 이란 코호트가 통째로 의심이어도
 *   의심에 들어가지 않는다(머리말 ②).
 */
export function isJudgeable(row: FingerprintVisitorRow): boolean {
  return num(row.downloads) <= 0 && trafficFingerprint(row) !== null;
}

// ── 판정 ────────────────────────────────────────────────────────────────────

interface CohortAccumulator {
  cohort: string;
  visitors: number;
  downloads: number;
  downloaders: number;
  unresolvedVisitors: number;
  fingerprints: Map<string, number>;
}

function ratio(a: number, b: number): number | null {
  return b > 0 ? a / b : null;
}

function describe(c: SuspectCohort): string {
  if (c.suspected) {
    return (
      `판정풀 ${c.judgedVisitors}명이 지문 ${c.distinctFingerprints}가지뿐이고 ` +
      `최다 지문 "${c.topFingerprint}" 이 ${Math.round(
        (c.topFingerprintShare ?? 0) * 100
      )}% 를 차지한다 · 다운로드 ${c.downloads}건`
    );
  }
  if (c.judgedVisitors < SUSPECT_MIN_COHORT_VISITORS) {
    return `판정풀 ${c.judgedVisitors}명 — 최소 ${SUSPECT_MIN_COHORT_VISITORS}명 미만이라 판정하지 않는다`;
  }
  return (
    `지문 ${c.distinctFingerprints}가지로 흩어진다 · 최다 점유 ` +
    `${Math.round((c.topFingerprintShare ?? 0) * 100)}% · 다운로드 ${c.downloads}건`
  );
}

/**
 * 방문자 목록 → 코호트별 봇 판정. **입력을 변형하지 않는다.**
 *
 * @param rows GA4 방문자당 1행.
 * @param opts.minCohortVisitors / opts.signatureShare
 *   규칙 파라미터. 응답의 `rule` 에 그대로 실려 화면이 임계값을 말할 수 있다.
 *   규칙이 파생이라는 뜻이 여기 있다 — 값을 바꾸면 과거 데이터가 즉시 새
 *   규칙으로 다시 읽힌다(원장을 다시 쓸 일이 없다).
 */
export function classifyBotTraffic(
  rows: readonly FingerprintVisitorRow[],
  opts?: { minCohortVisitors?: number; signatureShare?: number }
): BotTrafficVerdict {
  const minCohortVisitors =
    typeof opts?.minCohortVisitors === "number" &&
    Number.isFinite(opts.minCohortVisitors)
      ? Math.max(1, Math.floor(opts.minCohortVisitors))
      : SUSPECT_MIN_COHORT_VISITORS;
  const signatureShare =
    typeof opts?.signatureShare === "number" &&
    Number.isFinite(opts.signatureShare)
      ? Math.min(1, Math.max(0, opts.signatureShare))
      : SUSPECT_SIGNATURE_SHARE;

  const acc = new Map<string, CohortAccumulator>();
  for (const row of rows) {
    const key = normalizeCohort(row.country);
    let c = acc.get(key);
    if (!c) {
      c = {
        cohort: key,
        visitors: 0,
        downloads: 0,
        downloaders: 0,
        unresolvedVisitors: 0,
        fingerprints: new Map(),
      };
      acc.set(key, c);
    }
    const downloads = num(row.downloads);
    c.visitors += 1;
    c.downloads += downloads;
    if (downloads > 0) {
      // 다운로드한 방문자는 판정 대상이 아니다 — 지문을 세지도 않는다.
      c.downloaders += 1;
      continue;
    }
    const fp = trafficFingerprint(row);
    if (fp === null) {
      c.unresolvedVisitors += 1;
      continue;
    }
    c.fingerprints.set(fp, (c.fingerprints.get(fp) ?? 0) + 1);
  }

  const cohorts: SuspectCohort[] = [];
  for (const c of acc.values()) {
    let judgedVisitors = 0;
    let topFingerprint: string | null = null;
    let topFingerprintVisitors = 0;
    for (const [fp, n] of c.fingerprints) {
      judgedVisitors += n;
      // 동점은 지문 문자열 사전순으로 깨서 결과를 안정시킨다.
      if (
        n > topFingerprintVisitors ||
        (n === topFingerprintVisitors &&
          topFingerprint !== null &&
          fp < topFingerprint)
      ) {
        topFingerprint = fp;
        topFingerprintVisitors = n;
      }
    }
    const share = ratio(topFingerprintVisitors, judgedVisitors);
    const suspected =
      judgedVisitors >= minCohortVisitors &&
      share !== null &&
      share >= signatureShare;
    const row: SuspectCohort = {
      cohort: c.cohort,
      visitors: c.visitors,
      downloads: c.downloads,
      downloaders: c.downloaders,
      judgedVisitors,
      unresolvedVisitors: c.unresolvedVisitors,
      distinctFingerprints: c.fingerprints.size,
      topFingerprint,
      topFingerprintVisitors,
      topFingerprintShare: share,
      suspected,
      // ★의심으로 분리되는 것은 최다 지문을 가진 방문자뿐이다.
      suspectedVisitors: suspected ? topFingerprintVisitors : 0,
      reason: "",
    };
    row.reason = describe(row);
    cohorts.push(row);
  }

  // 의심 먼저 → 의심 인원 → 판정풀 → 이름. 이름은 마지막 타이브레이커(안정 정렬).
  cohorts.sort(
    (a, b) =>
      Number(b.suspected) - Number(a.suspected) ||
      b.suspectedVisitors - a.suspectedVisitors ||
      b.judgedVisitors - a.judgedVisitors ||
      a.cohort.localeCompare(b.cohort)
  );

  const suspectedCohorts = cohorts.filter((c) => c.suspected);
  const totals = {
    visitors: 0,
    suspectedVisitors: 0,
    qualifiedVisitors: 0,
    downloads: 0,
    downloaders: 0,
    suspectedCohorts: suspectedCohorts.length,
  };
  for (const c of cohorts) {
    totals.visitors += c.visitors;
    totals.suspectedVisitors += c.suspectedVisitors;
    totals.downloads += c.downloads;
    totals.downloaders += c.downloaders;
  }
  totals.qualifiedVisitors = totals.visitors - totals.suspectedVisitors;

  const notes: string[] = [
    "봇 판정은 **파생**이다 — 원장(BigQuery)에 bot 플래그를 굽지 않는다. 규칙을 바꾸면 과거가 즉시 새 규칙으로 다시 읽힌다.",
    "판정 축은 국적이 아니라 행동이다 — 코호트의 device×browser×os 집중도와 다운로드 0. 국가는 집계 단위일 뿐 차단 목록이 아니다.",
  ];
  if (totals.suspectedVisitors > 0) {
    notes.push(
      `의심 유입 ${totals.suspectedVisitors}방문 — 삭제하지 않고 따로 센다.`
    );
  }

  return {
    rule: {
      cohortAxis: SUSPECT_COHORT_AXIS,
      minCohortVisitors,
      signatureShare,
      fingerprintAxes: ["deviceCategory", "browser", "operatingSystem"],
      derived: true,
    },
    cohorts,
    suspectedCohorts,
    totals,
    notes,
  };
}

/**
 * 판정문을 방문자 단위 조회로 바꾼다. 어떤 방문자가 의심인지 묻는 유일한 경로.
 *
 * 의심 = (그 코호트가 의심) ∧ (그 방문자가 판정 대상) ∧ (지문이 최다 지문).
 * 세 조건이 전부 있어야 한다 — 그래서 다운로드한 사람은 코호트가 무엇이든
 * 절대 의심이 되지 않는다.
 */
export function suspectedVisitorLookup(
  verdict: BotTrafficVerdict
): (row: FingerprintVisitorRow) => boolean {
  const byCohort = new Map<string, string>();
  for (const c of verdict.suspectedCohorts) {
    if (c.topFingerprint) byCohort.set(c.cohort, c.topFingerprint);
  }
  return (row: FingerprintVisitorRow): boolean => {
    if (byCohort.size === 0) return false;
    const top = byCohort.get(normalizeCohort(row.country));
    if (!top) return false;
    if (!isJudgeable(row)) return false;
    return trafficFingerprint(row) === top;
  };
}
