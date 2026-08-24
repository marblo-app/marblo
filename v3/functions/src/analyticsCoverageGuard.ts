// ═══════════════════════════════════════════════════════════════════════════
// analyticsCoverageGuard — "이벤트는 오는데 프로필 필드가 0" 을 잡는 검사
// (ticket sx56j9XA26yEXka8QIhr · 순수 로직, BQ/Firestore 무의존, node --test)
// ═══════════════════════════════════════════════════════════════════════════
//
// ★왜 이 파일이 있나
//
// 2026-08-24 하루에 **같은 모양의 조용한 단절이 세 번** 나왔다:
//   #1171  person axis   — daily.install_key(원본) vs 링크표(HMAC). 조인 0행.
//   #1195  GA4 조인      — install_attribution.gaClientId(원본) vs gaKey(HMAC).
//                          632건 중 0건.
//   이 티켓 첫스폰 지표  — 분모는 미인증 어트리뷰션, 분자는 인증 events.
//                          first_run_at 주차 08-10 199건 / 스폰 **0**.
//
// 세 번 다 **행은 그대로 있고 결과 숫자만 0** 이었다. 파이프라인은 성공했고
// 로그는 깨끗했으며, 사람이 주차별로 갈라 보고 나서야 발견됐다. 그 전까지 그
// 0 은 "사람이 안 썼다" 로 읽혔고, 실제로 광고 집행·기능 우선순위 판단의
// 근거가 됐다.
//
// 그래서 검사의 대상은 "쿼리가 실패했나" 가 아니라 **"원천에는 신호가 있는데
// 파생 테이블의 그 칸이 비었나"** 다. 이건 예외가 아니라 정합성이므로 아무도
// 던지지 않는다 — 우리가 세야 한다.
//
// ★이 모듈은 판정만 한다. 쿼리도 시계도 없다(adminAnalytics.ts 와 같은 규약).
//   index.ts 가 BQ 에서 뽑은 주차별 실측을 넣으면 findings 가 나온다.

/** 심각도. red 는 "숫자를 인용하지 마라" 를 뜻한다. */
export type CoverageSeverity = "ok" | "amber" | "red";

/** 검사 규칙 식별자 — 사람이 읽는 문구가 아니라 코드로 센다. */
export type CoverageRuleKey =
  | "weekly_numerator_gap"
  | "key_space_break"
  | "population_mix"
  | "denominator_inflation";

export type CoverageFinding = {
  rule: CoverageRuleKey;
  severity: CoverageSeverity;
  /** 어느 주차인가('YYYY-MM-DD' 월요일). 전역 규칙이면 null. */
  week: string | null;
  /** 어느 파생 컬럼인가. */
  field: string;
  /** 사람이 읽는 한 줄. ★식별자를 넣지 않는다(로그로 나간다). */
  message: string;
  /** 판정 근거 수치 — 요약만 보고도 재현할 수 있게 같이 싣는다. */
  observed: Record<string, number>;
};

/**
 * 한 주차의 실측 한 줄.
 *
 * ★`eventKeys` 는 **원천(events)** 에서, 나머지는 **파생(프로필)** 에서 온다.
 *   두 쪽을 같은 행에 놓는 게 이 검사의 전부다 — 한쪽만 보면 영원히 못 잡는다.
 */
export type WeeklyMilestoneCoverage = {
  /** KST 월요일 기준 주 시작일 'YYYY-MM-DD'. */
  week: string;
  /** 그 주 코호트에 들어온 프로필 행 수(분모 원값). */
  cohortInstalls: number;
  /** 그 중 인증 텔레메트리가 있어 이 필드를 가질 **수 있는** 행 수. */
  observableInstalls: number;
  /** 그 중 대상 필드가 non-null 인 행 수(분자). */
  filledInstalls: number;
  /** 그 주 원천 events 에서 소스 이벤트를 낸 고유 설치 키 수. */
  eventKeys: number;
  /** 그 주 분모의 고유 브라우저(ga_key) 수. 알 수 없으면 null. */
  distinctBrowsers: number | null;
};

export type MilestoneCoverageInput = {
  /** 파생 컬럼 이름(예: 'first_spawn_at'). */
  field: string;
  /** 그 컬럼을 채우는 원천 이벤트 이름(예: 'agent:spawned'). */
  sourceEvent: string;
  weeks: ReadonlyArray<WeeklyMilestoneCoverage>;
};

export type CoverageThresholds = {
  /** 이 수 이상 코호트가 있어야 주차 규칙을 발화한다(잡음 억제). */
  minCohortInstalls: number;
  /** 분모 중 관측 가능 비율이 이 밑이면 red. */
  minObservableShare: number;
  /** 브라우저당 설치 수가 이 이상이면 red(재설치 루프). */
  maxInstallsPerBrowser: number;
  /** 원천 키 대비 채워진 비율이 이 밑이면 amber. */
  amberFillRatio: number;
};

export const DEFAULT_COVERAGE_THRESHOLDS: CoverageThresholds = {
  minCohortInstalls: 1,
  // 실측 근거: 2026-08-10 주차는 199행 중 관측 가능 0행(0.0%), 08-17 주차는
  // 368행 중 3행(0.8%) 이었다. 10% 는 "그 정도로 갈렸으면 비율이 아니라
  // 계측을 의심해라" 선이다.
  minObservableShare: 0.1,
  // 실측 근거: 631 '설치' 의 고유 브라우저가 5개(브라우저당 126)였다.
  maxInstallsPerBrowser: 5,
  amberFillRatio: 0.5,
};

export type CoverageReport = {
  status: CoverageSeverity;
  findings: CoverageFinding[];
  /** 사람이 읽는 요약 줄(로그·notes 에 그대로 싣는다). */
  lines: string[];
};

function worst(a: CoverageSeverity, b: CoverageSeverity): CoverageSeverity {
  if (a === "red" || b === "red") return "red";
  if (a === "amber" || b === "amber") return "amber";
  return "ok";
}

/**
 * 주차별 실측 → 발견. 규칙은 넷이다.
 *
 *  1) weekly_numerator_gap  — 그 주 원천 이벤트는 있는데 그 주 코호트의 필드가
 *                             **통째로 0**. 이 티켓이 딱 그 모양이다.
 *  2) key_space_break       — 관측 가능한 행이 있는데도 전 주차에서 필드가 0.
 *                             #1171 · #1195 형(가명/원본 키 공간 단절).
 *  3) population_mix        — 분모의 대부분이 분자를 가질 수 없는 행이다.
 *  4) denominator_inflation — 브라우저당 설치 수가 사람으로 설명되지 않는다.
 *
 * ★한 가지 규율: **비어 있음을 정상으로 접지 않는다.** 원천이 0이면 규칙은
 *   발화하지 않고 'ok' 가 되는데, 그건 "괜찮다" 가 아니라 "판단할 근거가
 *   없다" 이므로 lines 에 그렇게 적는다.
 */
export function auditMilestoneCoverage(
  input: MilestoneCoverageInput,
  thresholds: CoverageThresholds = DEFAULT_COVERAGE_THRESHOLDS
): CoverageReport {
  const findings: CoverageFinding[] = [];
  const weeks = [...input.weeks].sort((a, b) => a.week.localeCompare(b.week));

  for (const w of weeks) {
    if (w.cohortInstalls < thresholds.minCohortInstalls) continue;

    // 1) 원천에는 신호가 있는데 그 주 코호트의 필드가 0.
    if (w.eventKeys >= 1 && w.filledInstalls === 0) {
      findings.push({
        rule: "weekly_numerator_gap",
        severity: "red",
        week: w.week,
        field: input.field,
        message:
          `${w.week} 주차 — 원천 '${input.sourceEvent}' 는 고유 설치 ` +
          `${w.eventKeys}개에서 오는데 ${input.field} 가 채워진 코호트 행이 ` +
          `0 이다(코호트 ${w.cohortInstalls}행). 이 0 은 '아무도 안 했다' 가 ` +
          "아니라 '분자가 이 모집단에 닿지 못한다' 일 수 있다.",
        observed: {
          cohortInstalls: w.cohortInstalls,
          observableInstalls: w.observableInstalls,
          filledInstalls: 0,
          eventKeys: w.eventKeys,
        },
      });
    } else if (
      w.eventKeys >= 1 &&
      w.filledInstalls < w.eventKeys * thresholds.amberFillRatio
    ) {
      findings.push({
        rule: "weekly_numerator_gap",
        severity: "amber",
        week: w.week,
        field: input.field,
        message:
          `${w.week} 주차 — 원천 고유 설치 ${w.eventKeys}개 대비 ` +
          `${input.field} 가 ${w.filledInstalls}행뿐이다. 코호트 정의로 설명되는지 ` +
          "확인해라(첫 스폰은 코호트 지표라 재방문 사용자는 이전 주에 잡힌다).",
        observed: {
          cohortInstalls: w.cohortInstalls,
          observableInstalls: w.observableInstalls,
          filledInstalls: w.filledInstalls,
          eventKeys: w.eventKeys,
        },
      });
    }

    // 3) 분모의 대부분이 분자를 가질 수 없다.
    const observableShare =
      w.cohortInstalls > 0 ? w.observableInstalls / w.cohortInstalls : null;
    if (
      observableShare != null &&
      observableShare < thresholds.minObservableShare
    ) {
      findings.push({
        rule: "population_mix",
        severity: "red",
        week: w.week,
        field: input.field,
        message:
          `${w.week} 주차 — 코호트 ${w.cohortInstalls}행 중 인증 텔레메트리가 ` +
          `있는 행이 ${w.observableInstalls}행(${(
            observableShare * 100
          ).toFixed(1)}%)` +
          "뿐이다. 분모와 분자가 서로 다른 모집단이다 — 이 주차의 비율을 " +
          "제품 판단에 인용하지 마라.",
        observed: {
          cohortInstalls: w.cohortInstalls,
          observableInstalls: w.observableInstalls,
          observableSharePct: Number((observableShare * 100).toFixed(2)),
        },
      });
    }

    // 4) 브라우저당 설치 수.
    if (w.distinctBrowsers != null && w.distinctBrowsers > 0) {
      const perBrowser = w.cohortInstalls / w.distinctBrowsers;
      if (perBrowser >= thresholds.maxInstallsPerBrowser) {
        findings.push({
          rule: "denominator_inflation",
          severity: "red",
          week: w.week,
          field: input.field,
          message:
            `${w.week} 주차 — 설치 ${w.cohortInstalls}행이 브라우저 ` +
            `${w.distinctBrowsers}개에서 나왔다(브라우저당 ${perBrowser.toFixed(
              1
            )}). ` +
            "사람 수가 아니라 재설치 루프를 세고 있다 — 분모가 부풀었다.",
          observed: {
            cohortInstalls: w.cohortInstalls,
            distinctBrowsers: w.distinctBrowsers,
            installsPerBrowser: Number(perBrowser.toFixed(2)),
          },
        });
      }
    }
  }

  // 2) 전 주차에서 필드가 0 인데 관측 가능한 행은 있었다 = 키 공간 단절 형.
  const totalObservable = weeks.reduce((n, w) => n + w.observableInstalls, 0);
  const totalFilled = weeks.reduce((n, w) => n + w.filledInstalls, 0);
  const totalEventKeys = weeks.reduce((n, w) => n + w.eventKeys, 0);
  if (totalObservable >= 1 && totalEventKeys >= 1 && totalFilled === 0) {
    findings.push({
      rule: "key_space_break",
      severity: "red",
      week: null,
      field: input.field,
      message:
        `전 주차에서 ${input.field} 가 0 이다 — 관측 가능한 설치 ` +
        `${totalObservable}행과 원천 이벤트 고유 키 ${totalEventKeys}개가 ` +
        "있는데도 그렇다. 조인 키 공간이 갈렸는지부터 봐라(#1171 · #1195 형).",
      observed: {
        observableInstalls: totalObservable,
        filledInstalls: 0,
        eventKeys: totalEventKeys,
      },
    });
  }

  const status = findings.reduce<CoverageSeverity>(
    (acc, f) => worst(acc, f.severity),
    "ok"
  );
  const lines =
    findings.length > 0
      ? findings.map((f) => `[${f.severity.toUpperCase()}] ${f.message}`)
      : [
          totalEventKeys === 0
            ? `★${input.field} — 원천 '${input.sourceEvent}' 가 이 창에서 0건이라 ` +
              "판정할 근거가 없다. '이상 없음' 이 아니다."
            : `${input.field} — 커버리지 이상 없음(주차 ${weeks.length}개 검사).`,
        ];

  return { status, findings, lines };
}

/** 여러 필드를 한 번에 검사하고 하나의 리포트로 합친다. */
export function auditProfileCoverage(
  inputs: ReadonlyArray<MilestoneCoverageInput>,
  thresholds: CoverageThresholds = DEFAULT_COVERAGE_THRESHOLDS
): CoverageReport {
  const findings: CoverageFinding[] = [];
  const lines: string[] = [];
  let status: CoverageSeverity = "ok";
  for (const input of inputs) {
    const r = auditMilestoneCoverage(input, thresholds);
    findings.push(...r.findings);
    lines.push(...r.lines);
    status = worst(status, r.status);
  }
  return { status, findings, lines };
}
