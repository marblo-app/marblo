// 어드민 ⓪ KPI · ① 획득 탭의 **사람 축 읽기 경로** — 순수 로직(BQ/Firebase 무의존).
//
// 실행(테스트): cd v3/functions && npm run test:person-axis-cohort
//
// 티켓 ymfPL2AorfuEniHpVpCT. 선행 실측 셋이 이 모듈의 전제다 — 재조사하지 않는다:
//   · person-axis-event-stamp-2026-08-29.md        (§2.4 경계는 데이터에서 읽는다)
//   · person-axis-ga4-join-verification-2026-08-29.md (§3 사슬 5단계 · §6 코호트 SQL)
//   · person-install-link-coverage-investigation-2026-08-29.md (소급 불가)
//
// ── ★이 모듈이 지키는 규율 다섯 ────────────────────────────────────────────
//
//  1) **전환 시점을 하드코딩하지 않는다.** 경계는 `events.userKey` 가 처음 붙은
//     행의 `MIN(timestamp)` 다(`buildEventStampBoundarySql`). env 선언값은 **옆에**
//     싣되 화면의 경계선이 되지 않는다 — 배포가 밀리면 선언 ≠ 사실이다.
//  2) **경계 이전은 사람으로 세지 않는다.** 일별 행은 경계 이전 날에 `people` 을
//     `null` 로 둔다(0 이 아니다). 0 을 쓰면 "그날 사람이 없었다" 로 읽힌다.
//  3) **사슬이 끊긴 자리를 숫자로 말한다.** GA4 유입 × 사람키 코호트가 0행인
//     것은 지금 사실이다. 0행만 돌려주면 화면이 "데이터 없음" 으로 뭉갠다 —
//     그래서 5단계 각각의 남은 수와 **어느 단계에서 0 이 됐는지**를 같이 싣는다.
//  4) **사슬을 고치지 않는다.** `analytics_identity` 갱신은 별건 티켓이다. 이
//     모듈은 그 표의 신선도(마지막 linked_at vs 원장 마지막 linkedAt)를 **읽기만**
//     한다.
//  5) **가명 공간끼리만 조인한다.** `us_`/`in_`/`ga_` 뿐이고 SQL 본문에 솔트·원시
//     uid 는 없다. 유일한 원시 조인은 `events.userId`(설치 UUID) 의 일별 DISTINCT
//     뿐이며 그것은 설치 축 안이다(다른 어드민 콜러블과 같은 규약).

import { ACTIVATED_MIN_TASKS_COMPLETED } from "./activatedDefinition";
import {
  IDENTITY_DATASET,
  SOURCE_TABLE_ANALYTICS_IDENTITY,
  SOURCE_TABLE_USER_DAILY,
  TABLE_USER_INSTALL,
  TELEMETRY_DATASET,
  VIEW_PERSON_SINCE_LINK,
} from "./personAxis";
import { EVENT_USER_KEY_FIELD, type EventStampGate } from "./personAxisStamp";

/** 화면이 부르는 콜러블 이름. 프론트 상수와 이 값이 계약이다. */
export const CALLABLE_PERSON_AXIS_COHORT = "getAdminPersonAxisCohort";

/** GA4 브리지 현재 뷰 — ga4Bridge.GA4_BRIDGE_CURRENT_VIEW 와 같은 이름. */
export const SOURCE_GA4_FIRST_TOUCH_CURRENT = "ga4_first_touch_current";
/** 설치 링크백 원장 — installUnified.SOURCE_INSTALL_ATTRIBUTION 과 같은 이름. */
export const SOURCE_INSTALL_ATTRIBUTION = "install_attribution";
export const SOURCE_EVENTS = "events";

/** 유입원 표의 행 상한(화면 폭). 넘치면 truncated 로 알린다. */
export const COHORT_ROW_LIMIT = 50;

/** 경계 판정 문구 — 화면 배지가 그대로 쓴다. */
export const BOUNDARY_SOURCE_LABEL = `${SOURCE_EVENTS}.${EVENT_USER_KEY_FIELD} 가 처음 붙은 행의 MIN(timestamp)`;

// ════════════════════════════════════════════════════════════════════════════
// 1. 응답 모양 — 프론트 PersonAxisCohortPanel.tsx 의 타입과 글자까지 같다
// ════════════════════════════════════════════════════════════════════════════

export type ChainUnit = "browser" | "install" | "person";

export type ChainStep = {
  key: string;
  label: string;
  /** 이 단계를 통과해 남은 수. null = 이 단계 자체를 못 셌다(쿼리 실패). */
  count: number | null;
  unit: ChainUnit;
  /** 조인 키 — 화면에 가명 공간 이름만 보인다. */
  joinKey: string | null;
};

export type ChainFreshness = {
  /** `analytics_identity.linked_at` 의 최댓값. null = 표가 비었거나 못 읽음. */
  identityMaxLinkedAt: string | null;
  /** `install_attribution.linkedAt` 의 최댓값. */
  ledgerMaxLinkedAt: string | null;
  /** identity 마지막 갱신 이후 원장에 들어온 행 수 = identity 가 모르는 설치. */
  ledgerRowsAfterIdentity: number | null;
};

export type PersonAxisChain = {
  steps: ChainStep[];
  /** 남은 수가 처음 0 이 되는 단계의 key. 끝까지 살아 있으면 null. */
  breakAtKey: string | null;
  /** 왜 거기서 0 인지 — 데이터가 말해 주는 만큼만. */
  breakReason: string | null;
  freshness: ChainFreshness;
};

export type PersonAxisBoundary = {
  /** ★실측 경계. env 선언이 아니라 데이터에서 온 값. null = 각인된 행이 없다. */
  firstStampedAt: string | null;
  lastStampedAt: string | null;
  /** env 선언값(EVENTS_PERSON_STAMP_FROM). 실측과 나란히 보여 배포 지연을 드러낸다. */
  declaredStampFrom: string | null;
  stampGate: "on" | "off";
  stampGateReason: string | null;
  source: string;
};

export type PersonAxisDailyRow = {
  day: string;
  /** 그날이 어느 축인가. 경계가 지나는 날은 mixed — 두 축이 한 날에 섞여 있다. */
  axis: "install" | "person" | "mixed";
  activeInstalls: number;
  /** ★경계 이전 날은 null — 0 이 아니다. */
  people: number | null;
  stampedRows: number;
  unstampedRows: number;
};

export type SinceBoundarySummary = {
  stampedRows: number;
  unstampedRows: number;
  totalRows: number;
  people: number;
  installs: number;
};

export type Ga4PersonCohortRow = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  country: string | null;
  peopleLinked: number;
  peopleWithEvents: number;
  stampedRows: number;
  taskDone: number;
};

export type Ga4InstallFallbackRow = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  country: string | null;
  installs: number;
  browsers: number;
};

export type PersonScorecard = {
  basis: "since_link";
  view: string;
  linkedPeople: number;
  /** 누적 완료 task ≥ ACTIVATED_MIN_TASKS_COMPLETED 인 사람. 설치 축 Activated 의 사람 축 재계산. */
  activatedPeople: number;
  activatedMinTasks: number;
  d30: {
    cohort: number;
    retained: number;
    pending: number;
  };
};

export type PersonAxisCohort = {
  generatedAt: string;
  rangeDays: number;
  /** ★`unavailable` 이면 아무 숫자도 그리지 않는다. */
  state: "ready" | "unavailable";
  reason: string | null;
  boundary: PersonAxisBoundary;
  sinceBoundary: SinceBoundarySummary | null;
  daily: PersonAxisDailyRow[];
  chain: PersonAxisChain | null;
  cohortRows: Ga4PersonCohortRow[];
  cohortRowsTruncated: boolean;
  installFallbackRows: Ga4InstallFallbackRow[];
  personScorecard: PersonScorecard | null;
  personScorecardReason: string | null;
  queryStatus: { ok: boolean; errors: Array<{ name: string; error: string }> };
  notes: string[];
};

// ════════════════════════════════════════════════════════════════════════════
// 2. SQL — 전부 가명 공간. 파라미터는 날짜/타임스탬프뿐
// ════════════════════════════════════════════════════════════════════════════

function tbl(projectId: string, dataset: string, name: string): string {
  return `\`${projectId}.${dataset}.${name}\``;
}

const STAMPED = `(${EVENT_USER_KEY_FIELD} IS NOT NULL AND ${EVENT_USER_KEY_FIELD} != "")`;

/**
 * 일별 두 축. `@since` 는 조회 구간 시작일(DATE). 경계 판정은 SQL 이 아니라
 * `buildDailyRows` 가 실측 경계로 한다 — SQL 에 경계를 넣으면 경계가 두 벌이 된다.
 */
export function buildDailySql(projectId: string): string {
  const ev = tbl(projectId, TELEMETRY_DATASET, SOURCE_EVENTS);
  return [
    "SELECT",
    "  FORMAT_DATE('%F', DATE(timestamp)) AS day,",
    "  COUNT(DISTINCT userId) AS active_installs,",
    `  COUNT(DISTINCT IF(${STAMPED}, ${EVENT_USER_KEY_FIELD}, NULL)) AS people,`,
    `  COUNTIF(${STAMPED}) AS stamped_rows,`,
    `  COUNTIF(NOT ${STAMPED}) AS unstamped_rows`,
    `FROM ${ev}`,
    "WHERE timestamp >= TIMESTAMP(DATE(@since))",
    "GROUP BY day",
    "ORDER BY day",
  ].join("\n");
}

/** 경계 이후 구간 요약. `@boundary` 는 실측 경계 타임스탬프(STRING). */
export function buildSinceBoundarySql(projectId: string): string {
  const ev = tbl(projectId, TELEMETRY_DATASET, SOURCE_EVENTS);
  return [
    "SELECT",
    `  COUNTIF(${STAMPED}) AS stamped_rows,`,
    `  COUNTIF(NOT ${STAMPED}) AS unstamped_rows,`,
    "  COUNT(*) AS total_rows,",
    `  COUNT(DISTINCT IF(${STAMPED}, ${EVENT_USER_KEY_FIELD}, NULL)) AS people,`,
    "  COUNT(DISTINCT userId) AS installs",
    `FROM ${ev}`,
    "WHERE timestamp >= TIMESTAMP(@boundary)",
  ].join("\n");
}

/**
 * 사슬 5단계(검증 문서 §3 그대로) + `analytics_identity` 신선도.
 * ★`@boundary` 이후 이벤트만 사람으로 센다(규율 2).
 */
export function buildChainSql(projectId: string): string {
  const ft = tbl(projectId, TELEMETRY_DATASET, SOURCE_GA4_FIRST_TOUCH_CURRENT);
  const ai = tbl(projectId, TELEMETRY_DATASET, SOURCE_TABLE_ANALYTICS_IDENTITY);
  const aui = tbl(projectId, IDENTITY_DATASET, TABLE_USER_INSTALL);
  const ev = tbl(projectId, TELEMETRY_DATASET, SOURCE_EVENTS);
  const ledger = tbl(projectId, TELEMETRY_DATASET, SOURCE_INSTALL_ATTRIBUTION);
  return [
    "WITH",
    `  ft AS (SELECT DISTINCT gaKey FROM ${ft} WHERE gaKey IS NOT NULL),`,
    `  ai AS (SELECT DISTINCT install_key, ga_key FROM ${ai}),`,
    `  aui AS (SELECT DISTINCT user_key, install_key FROM ${aui}),`,
    `  ev AS (SELECT DISTINCT ${EVENT_USER_KEY_FIELD} AS user_key FROM ${ev}`,
    `         WHERE timestamp >= TIMESTAMP(@boundary) AND ${STAMPED})`,
    "SELECT",
    "  (SELECT COUNT(*) FROM ft) AS s1_browsers,",
    "  (SELECT COUNT(DISTINCT ai.install_key) FROM ft JOIN ai ON ai.ga_key = ft.gaKey) AS s2_installs,",
    "  (SELECT COUNT(DISTINCT aui.user_key) FROM ft JOIN ai ON ai.ga_key = ft.gaKey",
    "     JOIN aui ON aui.install_key = ai.install_key) AS s3_people,",
    "  (SELECT COUNT(DISTINCT ev.user_key) FROM ft JOIN ai ON ai.ga_key = ft.gaKey",
    "     JOIN aui ON aui.install_key = ai.install_key JOIN ev ON ev.user_key = aui.user_key) AS s4_people_with_events,",
    "  (SELECT COUNT(DISTINCT aui.user_key) FROM aui) AS linked_people_total,",
    "  (SELECT COUNT(DISTINCT aui.install_key) FROM aui) AS linked_installs_total,",
    "  (SELECT COUNT(DISTINCT aui.install_key) FROM aui JOIN ai ON ai.install_key = aui.install_key",
    "     WHERE ai.ga_key IS NOT NULL) AS linked_installs_with_ga_key,",
    `  CAST((SELECT MAX(linked_at) FROM ${ai}) AS STRING) AS identity_max_linked_at,`,
    `  CAST((SELECT MAX(linkedAt) FROM ${ledger}) AS STRING) AS ledger_max_linked_at,`,
    `  (SELECT COUNT(*) FROM ${ledger}`,
    `     WHERE linkedAt > (SELECT MAX(linked_at) FROM ${ai})) AS ledger_rows_after_identity`,
  ].join("\n");
}

/** GA4 유입 × 사람키 코호트 — 검증 문서 §6 정식 사슬 쿼리 그대로. */
export function buildGa4PersonCohortSql(projectId: string): string {
  const ft = tbl(projectId, TELEMETRY_DATASET, SOURCE_GA4_FIRST_TOUCH_CURRENT);
  const ai = tbl(projectId, TELEMETRY_DATASET, SOURCE_TABLE_ANALYTICS_IDENTITY);
  const aui = tbl(projectId, IDENTITY_DATASET, TABLE_USER_INSTALL);
  const ev = tbl(projectId, TELEMETRY_DATASET, SOURCE_EVENTS);
  return [
    "WITH ev AS (",
    `  SELECT ${EVENT_USER_KEY_FIELD} AS user_key, COUNT(*) AS rows_,`,
    "         COUNTIF(event = 'task:completed') AS task_done",
    `  FROM ${ev}`,
    `  WHERE timestamp >= TIMESTAMP(@boundary) AND ${STAMPED}`,
    "  GROUP BY 1),",
    "person_ft AS (",
    "  SELECT aui.user_key, ft.source, ft.medium, ft.campaign, ft.country",
    `  FROM ${aui} aui`,
    `  JOIN ${ai} ai ON ai.install_key = aui.install_key`,
    `  JOIN ${ft} ft ON ft.gaKey = ai.ga_key)`,
    "SELECT p.source, p.medium, p.campaign, p.country,",
    "       COUNT(DISTINCT p.user_key) AS people_linked,",
    "       COUNT(DISTINCT ev.user_key) AS people_with_events,",
    "       IFNULL(SUM(ev.rows_), 0) AS stamped_rows,",
    "       IFNULL(SUM(ev.task_done), 0) AS task_done",
    "FROM person_ft p LEFT JOIN ev ON ev.user_key = p.user_key",
    "GROUP BY 1, 2, 3, 4",
    "ORDER BY people_linked DESC, people_with_events DESC",
    `LIMIT ${COHORT_ROW_LIMIT + 1}`,
  ].join("\n");
}

/** 같은 표를 **설치 축까지만** — 사람 축이 0 일 때 "유입 자체가 있나" 를 보인다. */
export function buildGa4InstallFallbackSql(projectId: string): string {
  const ft = tbl(projectId, TELEMETRY_DATASET, SOURCE_GA4_FIRST_TOUCH_CURRENT);
  const ai = tbl(projectId, TELEMETRY_DATASET, SOURCE_TABLE_ANALYTICS_IDENTITY);
  return [
    "SELECT ft.source, ft.medium, ft.campaign, ft.country,",
    "       COUNT(DISTINCT ai.install_key) AS installs,",
    "       COUNT(DISTINCT ft.gaKey) AS browsers",
    `FROM ${ft} ft`,
    `JOIN ${ai} ai ON ai.ga_key = ft.gaKey`,
    "GROUP BY 1, 2, 3, 4",
    "ORDER BY installs DESC",
    `LIMIT ${COHORT_ROW_LIMIT + 1}`,
  ].join("\n");
}

/**
 * 사람 축 Activated / D30 재계산 — 설치 축 스코어카드(adminAnalytics.
 * buildBetaScorecard)와 **같은 정의**를 `v_person_since_link` 위에서 사람 단위로.
 *
 *   Activated: 누적 완료 task ≥ ACTIVATED_MIN_TASKS_COMPLETED 인 **사람**.
 *   D30: 첫 완료 task 가 있던 날을 코호트 기준일로, 그 다음날부터 +30일 안에
 *        완료 task 를 한 번이라도 더 한 사람. D+30 이 안 온 사람은 pending.
 *
 * ★뷰는 daily 를 이미 조인해 만든 것이라 tasks_completed 를 얻으려 daily 로
 *   되돌아가는 조인은 새 다리가 아니다(getAdminKpiCockpit kpi.personCounts 와
 *   같은 키 `install_key_hmac`).
 */
export function buildPersonScorecardSql(projectId: string): string {
  const v = tbl(projectId, IDENTITY_DATASET, VIEW_PERSON_SINCE_LINK);
  const d = tbl(projectId, TELEMETRY_DATASET, SOURCE_TABLE_USER_DAILY);
  return [
    "WITH pd AS (",
    "  SELECT v.user_key, v.day, IFNULL(d.tasks_completed, 0) AS tasks_completed",
    `  FROM ${v} v`,
    `  JOIN ${d} d ON d.install_key_hmac = v.install_key AND d.day = v.day),`,
    "person AS (",
    "  SELECT user_key,",
    "         SUM(tasks_completed) AS tasks_total,",
    "         MIN(IF(tasks_completed > 0, day, NULL)) AS cohort_day",
    "  FROM pd GROUP BY user_key),",
    "horizon AS (",
    "  SELECT p.user_key, p.tasks_total, p.cohort_day,",
    "         DATE_DIFF(CURRENT_DATE(), p.cohort_day, DAY) AS age_days,",
    "         (SELECT COUNT(*) FROM pd x",
    "            WHERE x.user_key = p.user_key AND x.tasks_completed > 0",
    "              AND x.day > p.cohort_day",
    "              AND x.day <= DATE_ADD(p.cohort_day, INTERVAL 30 DAY)) AS r30",
    "  FROM person p)",
    "SELECT",
    "  (SELECT COUNT(*) FROM person) AS linked_people,",
    `  (SELECT COUNTIF(tasks_total >= ${ACTIVATED_MIN_TASKS_COMPLETED}) FROM person) AS activated_people,`,
    "  (SELECT COUNTIF(cohort_day IS NOT NULL AND age_days >= 30) FROM horizon) AS d30_cohort,",
    "  (SELECT COUNTIF(cohort_day IS NOT NULL AND age_days >= 30 AND r30 > 0) FROM horizon) AS d30_retained,",
    "  (SELECT COUNTIF(cohort_day IS NOT NULL AND age_days < 30) FROM horizon) AS d30_pending",
  ].join("\n");
}

// ════════════════════════════════════════════════════════════════════════════
// 3. 행 조립 — 숫자 강제 · 경계 판정 · 끊긴 자리 찾기
// ════════════════════════════════════════════════════════════════════════════

export type BqRow = Record<string, unknown>;

export function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  if (v && typeof v === "object" && "value" in v) {
    return num((v as { value: unknown }).value);
  }
  return 0;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return num(v);
}

export function str(v: unknown): string | null {
  if (typeof v === "string") return v.trim().length > 0 ? v : null;
  if (v && typeof v === "object" && "value" in v) {
    return str((v as { value: unknown }).value);
  }
  return null;
}

/**
 * 경계 타임스탬프의 UTC 날짜. BQ `CAST(TIMESTAMP AS STRING)` 은 항상
 * `YYYY-MM-DD HH:MM:SS[.ffffff]+00` 꼴(UTC)이라 앞 10자가 곧 날짜다.
 * ★파싱하지 않는다 — 시간대 변환이 끼면 경계 날짜가 하루 밀릴 수 있다.
 */
export function boundaryDay(firstStampedAt: string | null): string | null {
  if (!firstStampedAt) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(firstStampedAt.trim());
  return m ? m[1] : null;
}

/**
 * 경계 봉투. `coverageRow` 는 `buildEventStampBoundarySql` 의 한 행이다.
 * 게이트가 꺼져 있으면 쿼리를 안 했으므로 row 는 null 이다.
 */
export function buildBoundary(
  coverageRow: BqRow | null | undefined,
  gate: EventStampGate
): PersonAxisBoundary {
  return {
    firstStampedAt: str(coverageRow?.first_stamped_at),
    lastStampedAt: str(coverageRow?.last_stamped_at),
    declaredStampFrom: gate.on ? gate.stampFrom : null,
    stampGate: gate.on ? "on" : "off",
    stampGateReason: gate.on ? null : gate.reason,
    source: BOUNDARY_SOURCE_LABEL,
  };
}

/** ★경계 이전 날의 `people` 은 null. 경계 당일은 mixed. */
export function buildDailyRows(
  rows: readonly BqRow[],
  firstStampedAt: string | null
): PersonAxisDailyRow[] {
  const bDay = boundaryDay(firstStampedAt);
  return rows
    .map((r) => {
      const day = str(r.day) ?? "";
      const axis: PersonAxisDailyRow["axis"] =
        bDay == null || day < bDay
          ? "install"
          : day === bDay
          ? "mixed"
          : "person";
      return {
        day,
        axis,
        activeInstalls: num(r.active_installs),
        people: axis === "install" ? null : num(r.people),
        stampedRows: num(r.stamped_rows),
        unstampedRows: num(r.unstamped_rows),
      };
    })
    .filter((r) => r.day.length > 0);
}

export function buildSinceBoundary(
  row: BqRow | null | undefined
): SinceBoundarySummary | null {
  if (!row) return null;
  return {
    stampedRows: num(row.stamped_rows),
    unstampedRows: num(row.unstamped_rows),
    totalRows: num(row.total_rows),
    people: num(row.people),
    installs: num(row.installs),
  };
}

export const CHAIN_STEP_KEYS = ["s1", "s2", "s3", "s4"] as const;

/** 사슬 봉투. 끊긴 단계와 사유는 **행이 말하는 만큼만** 적는다. */
export function buildChain(
  row: BqRow | null | undefined
): PersonAxisChain | null {
  if (!row) return null;
  const steps: ChainStep[] = [
    {
      key: "s1",
      label: "GA4 첫 방문 브라우저",
      count: numOrNull(row.s1_browsers),
      unit: "browser",
      joinKey: `${SOURCE_GA4_FIRST_TOUCH_CURRENT}.gaKey`,
    },
    {
      key: "s2",
      label: "⋈ analytics_identity (브라우저→설치)",
      count: numOrNull(row.s2_installs),
      unit: "install",
      joinKey: "ga_key",
    },
    {
      key: "s3",
      label: "⋈ analytics_user_install (설치→사람)",
      count: numOrNull(row.s3_people),
      unit: "person",
      joinKey: "install_key",
    },
    {
      key: "s4",
      label: "⋈ events.userKey (경계 이후 활동한 사람)",
      count: numOrNull(row.s4_people_with_events),
      unit: "person",
      joinKey: "user_key",
    },
  ];
  const first = steps.find((s) => s.count === 0);
  const breakAtKey = first?.key ?? null;

  const linkedInstalls = num(row.linked_installs_total);
  const linkedWithGa = num(row.linked_installs_with_ga_key);
  const ledgerAfter = numOrNull(row.ledger_rows_after_identity);
  const identityMax = str(row.identity_max_linked_at);
  const ledgerMax = str(row.ledger_max_linked_at);

  let breakReason: string | null = null;
  if (breakAtKey === "s1") {
    breakReason =
      "GA4 브리지 표가 비어 있다 — 유입 자체가 없거나 브리지 동기화가 안 돌았다.";
  } else if (breakAtKey === "s2") {
    breakReason = "GA4 브라우저 중 설치를 낸 것이 analytics_identity 에 없다.";
  } else if (breakAtKey === "s3") {
    breakReason =
      `링크된 설치 ${linkedInstalls}대 중 analytics_identity 에서 ga_key 를 가진 설치가 ` +
      `${linkedWithGa}대다.` +
      (identityMax
        ? ` analytics_identity 마지막 갱신 ${identityMax}` +
          (ledgerAfter != null && ledgerAfter > 0
            ? `, 그 뒤 원장에 들어온 설치 ${ledgerAfter}건이 아직 반영되지 않았다(갱신 스케줄 없음 — 별건 수리).`
            : ".")
        : " analytics_identity 가 비어 있다.");
  } else if (breakAtKey === "s4") {
    breakReason =
      "사람까지는 닿았지만 경계 이후 각인된 이벤트가 없는 사람뿐이다.";
  }

  return {
    steps,
    breakAtKey,
    breakReason,
    freshness: {
      identityMaxLinkedAt: identityMax,
      ledgerMaxLinkedAt: ledgerMax,
      ledgerRowsAfterIdentity: ledgerAfter,
    },
  };
}

export function buildCohortRows(rows: readonly BqRow[]): {
  rows: Ga4PersonCohortRow[];
  truncated: boolean;
} {
  const mapped = rows.map((r) => ({
    source: str(r.source),
    medium: str(r.medium),
    campaign: str(r.campaign),
    country: str(r.country),
    peopleLinked: num(r.people_linked),
    peopleWithEvents: num(r.people_with_events),
    stampedRows: num(r.stamped_rows),
    taskDone: num(r.task_done),
  }));
  return {
    rows: mapped.slice(0, COHORT_ROW_LIMIT),
    truncated: mapped.length > COHORT_ROW_LIMIT,
  };
}

export function buildInstallFallbackRows(
  rows: readonly BqRow[]
): Ga4InstallFallbackRow[] {
  return rows.slice(0, COHORT_ROW_LIMIT).map((r) => ({
    source: str(r.source),
    medium: str(r.medium),
    campaign: str(r.campaign),
    country: str(r.country),
    installs: num(r.installs),
    browsers: num(r.browsers),
  }));
}

export function buildPersonScorecard(
  row: BqRow | null | undefined,
  projectId: string
): PersonScorecard | null {
  if (!row) return null;
  return {
    basis: "since_link",
    view: `${projectId}.${IDENTITY_DATASET}.${VIEW_PERSON_SINCE_LINK}`,
    linkedPeople: num(row.linked_people),
    activatedPeople: num(row.activated_people),
    activatedMinTasks: ACTIVATED_MIN_TASKS_COMPLETED,
    d30: {
      cohort: num(row.d30_cohort),
      retained: num(row.d30_retained),
      pending: num(row.d30_pending),
    },
  };
}

/** 조회 구간 시작일(UTC, 'YYYY-MM-DD'). */
export function rangeStartDay(
  rangeDays: number,
  now: Date = new Date()
): string {
  const days = Math.max(1, Math.floor(rangeDays));
  const start = new Date(now.getTime() - (days - 1) * 86400000);
  return start.toISOString().slice(0, 10);
}

export function buildNotes(input: {
  boundary: PersonAxisBoundary;
  sinceBoundary: SinceBoundarySummary | null;
  chain: PersonAxisChain | null;
  cohortRowCount: number;
}): string[] {
  const notes: string[] = [];
  if (input.boundary.stampGate === "off") {
    notes.push(
      "이벤트 행 사람키 각인이 꺼져 있다(EVENTS_PERSON_STAMP_FROM 미설정). 사람 축 시계열은 존재하지 않는다 — 0 이 아니라 없음이다."
    );
  } else if (!input.boundary.firstStampedAt) {
    notes.push(
      "각인은 켜져 있지만 아직 각인된 행이 없다. 경계는 첫 행이 들어온 순간 데이터에서 생긴다."
    );
  } else {
    notes.push(
      `사람 축 경계 ${input.boundary.firstStampedAt} (${input.boundary.source}). 이 시각 이전 행은 전부 userKey NULL 이고 백필하지 않는다 — 그 구간의 사람 수는 '없음' 이 아니라 '셀 수 없음' 이다.`
    );
    if (
      input.boundary.declaredStampFrom &&
      boundaryDay(input.boundary.firstStampedAt) !==
        input.boundary.declaredStampFrom
    ) {
      notes.push(
        `env 선언(${
          input.boundary.declaredStampFrom
        })과 실측 경계(${boundaryDay(
          input.boundary.firstStampedAt
        )})가 다르다. 화면의 경계선은 실측이다.`
      );
    }
  }
  if (input.sinceBoundary && input.sinceBoundary.unstampedRows > 0) {
    notes.push(
      `경계 이후에도 userKey 가 없는 행 ${input.sinceBoundary.unstampedRows}건이 있다 — 미인증(로그인 전) 텔레메트리 경로다. 결함이 아니라 설계다(각인 문서 §2.5).`
    );
  }
  if (input.chain?.breakAtKey && input.cohortRowCount === 0) {
    notes.push(
      `GA4 유입 × 사람키 코호트가 0행인 이유는 사슬 ${input.chain.breakAtKey} 단계다. 사슬이 복구되면 이 표는 같은 쿼리로 그대로 채워진다.`
    );
  }
  return notes;
}

/** 읽기 경로 자체가 죽었을 때. ★숫자 0 을 하나도 싣지 않는다. */
export function unavailable(
  rangeDays: number,
  reason: string,
  gate: EventStampGate,
  generatedAt: string = new Date().toISOString()
): PersonAxisCohort {
  return {
    generatedAt,
    rangeDays,
    state: "unavailable",
    reason,
    boundary: buildBoundary(null, gate),
    sinceBoundary: null,
    daily: [],
    chain: null,
    cohortRows: [],
    cohortRowsTruncated: false,
    installFallbackRows: [],
    personScorecard: null,
    personScorecardReason: null,
    queryStatus: { ok: false, errors: [{ name: "boundary", error: reason }] },
    notes: [],
  };
}
