/**
 * 팀 오버뷰 봉투 계약 — 서버 응답을 화면이 읽을 수 있는 모양으로 접는다.
 *
 * 정본: `docs/team-usage-overview-design-2026-08-21.md` §7(응답 계약) · §5(권한 경계).
 * 서버 구현은 `v3/functions/src/teamUsage.ts` + `getTeamUsageSummary` 콜러블.
 *
 * ★이 모듈이 존재하는 이유는 하나다. **`0` 과 `미수집` 과 `적재 전` 은 셋 다 다른
 *   뜻인데, 숫자 하나로 받으면 화면이 셋을 못 가른다.** 서버가 봉투에 상태를 실어
 *   보내고, 여기서 그 상태를 잃지 않는 형태(`UsageCell`)로 접는다. 화면은
 *   `UsageCell` 만 그린다 — 숫자로 환원하는 경로를 타입 수준에서 남기지 않는다.
 *
 *   특히 오케 축: 오케스트레이터 비용은 **한 번도 비용 트래커에 붙은 적이 없다.**
 *   ★"몇 %였다" 는 수치를 여기에 적지 않는다. 과거 특정 구간에 오케 행이 있었지만,
 *   그건 콜드부트 reconnect 버그의 **중복청구**로 밝혀졌다(한 번들을 여러 agentId
 *   가 청구). 실지출이 아니었으므로 비중을 말하면 그 자체가 거짓이 된다.
 *   여기를 `0` 으로 그리면 오너가 "오케는 공짜" 로 읽고 그 위에 모델 선택을
 *   쌓는다 — 이 화면이 할 수 있는 가장 비싼 거짓말이다.
 *
 * ★React·firebase 무의존. 그래서 `tsx --test` 로 그대로 돈다.
 */

// ── 봉투 원형 (서버 미러) ───────────────────────────────────────────────────

/**
 * 팀 스코프 집계의 상태. 계약 `docs/team-usage-summary-contract-2026-08-21.md` §3.
 *
 * ★다섯이다. `not_provisioned` 을 `empty` 로 접으면 **`0`·`미수집`·`적재 전`
 *   3분법이 2분법으로 무너진다** — 이 화면에서는 그 구분이 전부다.
 *   - `empty`            = 행이 0. 팀이 아직 안 들어왔다(정상)
 *   - `not_provisioned`  = **적재 전.** 읽어 올 자리가 아직 없다. 0 이 아니다
 *   - `complete`/`partial` 인데 `totals.costUsd === 0` = **진짜 0**
 */
export type TeamUsageState =
  | "disabled"
  | "not_provisioned"
  | "empty"
  | "partial"
  | "complete";

/** 오케 축의 상태. 설계 §7 — **`0` 은 상태가 아니다.** */
export type OrchestratorAxisState = "not_collected" | "collecting";

export type UsageScope = "team" | "self";

/**
 * 사유 코드. ★열린 문자열이다 — 프론트가 enum 을 닫으면 백엔드가 새 사유를
 * 추가하는 순간 화면이 빈칸이 된다. 아는 코드는 번역하고, 모르는 코드는 서버가
 * 같이 보낸 산문(`reason`)을 그대로 그린다(`resolveReason`).
 */
export type ReasonCode = string;

export type TeamUsageGateEnvelope = {
  state: TeamUsageState;
  /** `disabled` 일 때만. 화면이 이 문장을 그대로 그린다(설계 §7 화면규칙 1). */
  disabledReason: string | null;
  disabledReasonCode: ReasonCode | null;
  effectiveFrom: string | null;
  /** ★라벨 없는 숫자 금지 — 항상 실린다(설계 §7 화면규칙 2). */
  basis: string;
  scope: UsageScope;
  projectsInScope: number;
};

export type OrchestratorAxisEnvelope = {
  state: OrchestratorAxisState;
  reason: string | null;
  reasonCode: ReasonCode | null;
  /** 수집 티켓 배포일. **그 이전 구간은 그리지 않는다.** */
  collectingSince: string | null;
  /**
   * 과거 구간에 남은 행. ★**시계열로 그리면 안 된다.**
   * 그 행들은 콜드부트 reconnect 버그의 중복청구로 밝혀졌다 — 실지출이 아니다.
   * ★문장은 서버가 `noteCode`/`note` 로 준다. 화면이 해석을 지어내지 않는다.
   */
  legacySegment: {
    from: string;
    to: string;
    noteCode: string | null;
    note: string | null;
  } | null;
};

export type UsageTotals = {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export type ByDayRow = {
  day: string;
  costUsd: number;
  tokens: number;
  /** 오늘 구간은 정의상 미완이다(설계 §6.3). */
  partial: boolean;
};

export type ByMemberRow = {
  /** 팀 전용 가명 공간 `tm_…`(설계 §4.6). ★원시 uid 가 아니다. */
  memberKey: string;
  displayName: string | null;
  costUsd: number;
  tokens: number;
  share: number | null;
  /**
   * ★`false` 는 **0 이 아니다** — 아무것도 보내지 않았을 수 있다(계약 §7 규칙 8).
   * 텔레메트리를 끈 사람이 "가장 일 안 한 사람" 으로 보이는 자리가 정확히 여기다.
   * 서버가 안 주면 `null`(모름)이고, 그때는 금액을 그대로 그린다.
   */
  hasRows: boolean | null;
};

export type ByProjectRow = {
  projectId: string;
  projectName: string | null;
  costUsd: number;
  tokens: number;
};

export type ByModelRow = { model: string; costUsd: number; tokens: number };

export type ByActorKindRow = {
  actorKind: "worker" | "orchestrator";
  costUsd: number;
  tokens: number;
};

export type UsageCoverage = {
  /** ★`0`(합이 0)과 `empty`(행이 0)를 화면이 가르는 데 쓰는 값(계약 §3). */
  rowsInWindow: number | null;
  rowsZeroPct: number | null;
  rowsWithoutTaskPct: number | null;
  unattributedRows: number | null;
  membersWithNoRows: number | null;
  /** 화면이 그대로 그리는 문장 — "0 = 안 씀" 이 아니라 "안 보냄" 일 수 있다. */
  telemetryOptOutNote: string | null;
  telemetryOptOutNoteCode: ReasonCode | null;
};

export type TeamUsageEnvelope = {
  rangeDays: number | null;
  generatedAt: string | null;
  cache: {
    hit: boolean;
    ageSeconds: number | null;
    ttlSeconds: number | null;
  } | null;
  /** ★봉투에 없을 수 있다. 없는 것은 상태가 아니라 **배선 전**이다. */
  teamUsage: TeamUsageGateEnvelope | null;
  orchestratorAxis: OrchestratorAxisEnvelope | null;
  totals: UsageTotals | null;
  byDay: ByDayRow[];
  byMember: ByMemberRow[];
  byProject: ByProjectRow[];
  byModel: ByModelRow[];
  byActorKind: ByActorKindRow[];
  coverage: UsageCoverage | null;
};

// ── ★화면이 그리는 유일한 단위 ──────────────────────────────────────────────

/**
 * 한 칸의 상태. **숫자가 아니라 상태다.**
 *
 * - `measured`  — 실측값. `costUsd === 0` 이면 **진짜 0** 이고, 화면은 그걸
 *                 "실측 0" 이라고 밝혀 그린다(빈칸과 구별되게).
 * - `partial`   — 실측값이지만 조회창의 **일부만** 수집됐다. 합계로 읽히면 안 된다.
 * - `notCollected` — 수집 자체가 안 되고 있다. ★숫자를 그리지 않는다.
 * - `pending`   — 수집은 배선됐지만 이 구간에 적재된 것이 아직 없다.
 * - `unwired`   — 봉투에 축이 아예 없다. 상태가 아니라 **계약 미배선**이다.
 *                 모르는 것을 0 으로 그리지 않기 위해 별도 종류로 남긴다.
 * - `restricted` — **권한으로 가려진 값.** 여섯 번째 부재다(#1205 §4.2) —
 *                 값은 존재하지만 이 사람의 권한으로 볼 수 없다. ★숫자를
 *                 그리지 않고, "왜 없는지" 가 아니라 "무엇이 필요한지"
 *                 (`requires`) 를 말한다. 이 종류는 **존재를 이미 알 권한이
 *                 있는 칸**에만 쓴다 — 스코프 밖 항목은 restricted 로 가리는
 *                 게 아니라 행을 아예 안 보낸다(omit, §4.3).
 */
export type UsageCell =
  | { kind: "measured"; costUsd: number; tokens: number }
  | { kind: "partial"; costUsd: number; tokens: number; coveredFrom: string }
  | {
      kind: "notCollected";
      reasonCode: ReasonCode | null;
      reason: string | null;
      legacySegment: OrchestratorAxisEnvelope["legacySegment"];
    }
  | { kind: "pending"; since: string | null }
  | { kind: "unwired" }
  | {
      kind: "restricted";
      /**
       * 무엇이 있어야 보이나. ★역할 이름만 담고 조직·프로젝트 식별자는 담지
       * 않는다 — 담으면 존재가 샌다(#1205 §4.2).
       */
      requires: "org_admin" | "project_admin";
      reasonCode: ReasonCode | null;
      reason: string | null;
    };

// ── 방어적 정규화 (신뢰 경계) ───────────────────────────────────────────────
//
// ★콜러블 응답은 신뢰 경계 바깥이다. 필드가 빠지거나 타입이 다를 때 `undefined`
//   가 화면까지 흘러가면 빈칸이 되고, `Number(undefined)` 로 접으면 **0 이 된다.**
//   빈칸도 0 도 이 화면에서는 거짓말이므로, 여기서 전부 명시 상태로 접는다.

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** 유한수만 통과. NaN·Infinity·문자열 숫자는 **모른다**로 접는다(0 이 아니다). */
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** 합계처럼 "없으면 0 이 맞는" 자리 전용. 그 판단이 필요한 곳에서만 쓴다. */
function numOr0(v: unknown): number {
  return num(v) ?? 0;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function bool(v: unknown): boolean {
  return v === true;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

const TEAM_USAGE_STATES: ReadonlyArray<TeamUsageState> = [
  "disabled",
  "not_provisioned",
  "empty",
  "partial",
  "complete",
];

function teamUsageState(v: unknown): TeamUsageState | null {
  return TEAM_USAGE_STATES.includes(v as TeamUsageState)
    ? (v as TeamUsageState)
    : null;
}

function orchestratorState(v: unknown): OrchestratorAxisState | null {
  return v === "not_collected" || v === "collecting" ? v : null;
}

/** 'YYYY-MM-DD' 만 통과. 다른 모양이면 경계 계산에 쓰지 않는다. */
export function isDayString(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function daySegment(v: unknown): OrchestratorAxisEnvelope["legacySegment"] {
  const r = asRecord(v);
  if (!r) return null;
  const from = r.from;
  const to = r.to;
  if (!isDayString(from) || !isDayString(to)) return null;
  return {
    from,
    to,
    noteCode: str(r.noteCode),
    note: str(r.note),
  };
}

function normalizeGate(v: unknown): TeamUsageGateEnvelope | null {
  const r = asRecord(v);
  if (!r) return null;
  const state = teamUsageState(r.state);
  if (!state) return null;
  const scope = r.scope === "self" ? "self" : "team";
  return {
    state,
    disabledReason: str(r.disabledReason),
    disabledReasonCode: str(r.disabledReasonCode) ?? str(r.reasonCode),
    effectiveFrom: str(r.effectiveFrom),
    // ★basis 가 없으면 빈 문자열이 아니라 null-안전한 자리표시로 접는다. 화면은
    //   basis 가 비면 숫자를 크게 그리지 않는다(라벨 없는 숫자 금지).
    basis: str(r.basis) ?? "",
    scope,
    projectsInScope: numOr0(r.projectsInScope),
  };
}

function normalizeAxis(v: unknown): OrchestratorAxisEnvelope | null {
  const r = asRecord(v);
  if (!r) return null;
  const state = orchestratorState(r.state);
  if (!state) return null;
  return {
    state,
    reason: str(r.reason),
    reasonCode: str(r.reasonCode),
    collectingSince: isDayString(r.collectingSince) ? r.collectingSince : null,
    legacySegment: daySegment(r.legacySegment),
  };
}

function normalizeTotals(v: unknown): UsageTotals | null {
  const r = asRecord(v);
  if (!r) return null;
  return {
    costUsd: numOr0(r.costUsd),
    inputTokens: numOr0(r.inputTokens),
    outputTokens: numOr0(r.outputTokens),
    cacheReadTokens: numOr0(r.cacheReadTokens),
    cacheWriteTokens: numOr0(r.cacheWriteTokens),
  };
}

function normalizeByDay(v: unknown): ByDayRow[] {
  return arr(v).flatMap((row) => {
    const r = asRecord(row);
    if (!r || !isDayString(r.day)) return [];
    return [
      {
        day: r.day,
        costUsd: numOr0(r.costUsd),
        tokens: numOr0(r.tokens),
        partial: bool(r.partial),
      },
    ];
  });
}

/**
 * ★가명 공간 검사(설계 §4.6). 팀 응답의 멤버 키는 `tm_` 접두여야 한다.
 * `us_`(사람 축 조인 키)나 원시 uid 가 오면 **그건 계약 위반이고, 화면은 그 값을
 * 그리지 않는다.** 그리는 순간 이 화면이 링크표의 이름 사전이 된다.
 */
export function isTeamMemberKey(v: unknown): v is string {
  return typeof v === "string" && /^tm_[A-Za-z0-9_-]{4,}$/.test(v);
}

/**
 * ★이메일·원시 uid 가 화면에 뜨지 않게 하는 마지막 문턱.
 * 서버가 실수로 이메일을 `displayName` 에 실어도 화면은 안 그린다.
 * 로컬파트만 남기지 않는다 — 로컬파트도 사람을 특정한다.
 */
export function maskDisplayName(name: string | null): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (trimmed === "") return null;
  if (trimmed.includes("@")) return null;
  // 28자 Firebase uid 모양(영숫자만)은 이름이 아니다.
  if (/^[A-Za-z0-9]{24,}$/.test(trimmed)) return null;
  return trimmed;
}

function normalizeByMember(v: unknown): ByMemberRow[] {
  return arr(v).flatMap((row) => {
    const r = asRecord(row);
    if (!r) return [];
    // ★가명 공간을 벗어난 키는 통째로 버린다. 익명 라벨로 살려 두면 그 옆의
    //   숫자만 남아 "누군지 모를 사람의 사용량" 이 되고, 그건 답이 아니라 잡음이다.
    if (!isTeamMemberKey(r.memberKey)) return [];
    const share = num(r.share);
    return [
      {
        memberKey: r.memberKey,
        displayName: maskDisplayName(str(r.displayName)),
        costUsd: numOr0(r.costUsd),
        tokens: numOr0(r.tokens),
        share: share !== null && share >= 0 && share <= 1 ? share : null,
        hasRows: typeof r.hasRows === "boolean" ? r.hasRows : null,
      },
    ];
  });
}

function normalizeByProject(v: unknown): ByProjectRow[] {
  return arr(v).flatMap((row) => {
    const r = asRecord(row);
    const projectId = str(r?.projectId);
    if (!r || !projectId) return [];
    return [
      {
        projectId,
        projectName: str(r.projectName),
        costUsd: numOr0(r.costUsd),
        tokens: numOr0(r.tokens),
      },
    ];
  });
}

function normalizeByModel(v: unknown): ByModelRow[] {
  return arr(v).flatMap((row) => {
    const r = asRecord(row);
    const model = str(r?.model);
    if (!r || !model) return [];
    return [{ model, costUsd: numOr0(r.costUsd), tokens: numOr0(r.tokens) }];
  });
}

function normalizeByActorKind(v: unknown): ByActorKindRow[] {
  return arr(v).flatMap((row) => {
    const r = asRecord(row);
    if (!r) return [];
    const kind = r.actorKind;
    if (kind !== "worker" && kind !== "orchestrator") return [];
    return [
      { actorKind: kind, costUsd: numOr0(r.costUsd), tokens: numOr0(r.tokens) },
    ];
  });
}

function normalizeCoverage(v: unknown): UsageCoverage | null {
  const r = asRecord(v);
  if (!r) return null;
  return {
    // ★여기는 `numOr0` 를 쓰지 않는다. 커버리지가 없는 것과 "결측 0%" 는 다르다.
    rowsInWindow: num(r.rowsInWindow),
    rowsZeroPct: num(r.rowsZeroPct),
    rowsWithoutTaskPct: num(r.rowsWithoutTaskPct),
    unattributedRows: num(r.unattributedRows),
    membersWithNoRows: num(r.membersWithNoRows),
    telemetryOptOutNote: str(r.telemetryOptOutNote),
    telemetryOptOutNoteCode: str(r.telemetryOptOutNoteCode),
  };
}

/** 콜러블 응답 → 화면이 읽는 봉투. 어떤 입력이 와도 던지지 않는다. */
export function normalizeTeamUsage(raw: unknown): TeamUsageEnvelope {
  const r = asRecord(raw) ?? {};
  const cache = asRecord(r.cache);
  return {
    rangeDays: num(r.rangeDays),
    generatedAt: str(r.generatedAt),
    cache: cache
      ? {
          hit: bool(cache.hit),
          ageSeconds: num(cache.ageSeconds),
          ttlSeconds: num(cache.ttlSeconds),
        }
      : null,
    teamUsage: normalizeGate(r.teamUsage),
    orchestratorAxis: normalizeAxis(r.orchestratorAxis),
    totals: normalizeTotals(r.totals),
    byDay: normalizeByDay(r.byDay),
    byMember: normalizeByMember(r.byMember),
    byProject: normalizeByProject(r.byProject),
    byModel: normalizeByModel(r.byModel),
    byActorKind: normalizeByActorKind(r.byActorKind),
    coverage: normalizeCoverage(r.coverage),
  };
}

// ── ★오케 칸 판정 — 이 티켓의 핵심 ──────────────────────────────────────────

/** 조회창. 서버가 준 `generatedAt`/`rangeDays` 로 만든다(클라 시계로 세지 않는다). */
export type UsageWindow = { fromDay: string; toDayExclusive: string };

/**
 * 서버 시각 기준 조회창. `AnalyticsPanel.analyticsRangeStart` 와 같은 규약
 * (끝일 포함 → 배타 경계는 하루 뒤).
 */
export function resolveWindow(
  generatedAt: string | null,
  rangeDays: number | null
): UsageWindow | null {
  if (!generatedAt || !rangeDays || rangeDays <= 0) return null;
  const end = new Date(generatedAt);
  if (Number.isNaN(end.getTime())) return null;
  const start = new Date(end.getTime() - (rangeDays - 1) * 86_400_000);
  const next = new Date(end.getTime() + 86_400_000);
  return {
    fromDay: start.toISOString().slice(0, 10),
    toDayExclusive: next.toISOString().slice(0, 10),
  };
}

/**
 * 오케 축을 어떻게 그릴지 판정한다.
 *
 * ★`not_collected` 면 **측정값이 딸려 와도 무시한다.** 2026-05~06 의 잔재 4,876행이
 *   그 예다 — 규약 이전 id 라 시계열이 아니고(설계 §1.3), 그걸 그리면 "오케 비용이
 *   6월에만 있었다" 는 잘못된 시계열이 된다. 대신 잔재 구간을 사실로 밝힌다.
 */
export function deriveOrchestratorCell(
  axis: OrchestratorAxisEnvelope | null,
  measured: { costUsd: number; tokens: number } | null,
  window: UsageWindow | null
): UsageCell {
  // 봉투에 축이 없다 = 계약 미배선. 모르는 것을 0 으로 그리지 않는다.
  if (!axis) return { kind: "unwired" };

  if (axis.state === "not_collected") {
    return {
      kind: "notCollected",
      reasonCode: axis.reasonCode,
      reason: axis.reason,
      legacySegment: axis.legacySegment,
    };
  }

  // collecting — 언제부터 수집됐는지를 모르면 그릴 기준이 없다.
  const since = axis.collectingSince;
  if (!since) return { kind: "pending", since: null };

  if (window) {
    // 조회창이 통째로 수집 시작 이전이다 → 이 구간에는 적재된 것이 없다.
    if (window.toDayExclusive <= since) return { kind: "pending", since };
    // 창이 수집 시작을 걸친다 → 합계로 읽히면 안 된다.
    if (window.fromDay < since) {
      return {
        kind: "partial",
        costUsd: measured?.costUsd ?? 0,
        tokens: measured?.tokens ?? 0,
        coveredFrom: since,
      };
    }
  }

  if (!measured) return { kind: "pending", since };
  return {
    kind: "measured",
    costUsd: measured.costUsd,
    tokens: measured.tokens,
  };
}

/** `byActorKind` 에서 한 종류를 꺼낸다. 없으면 **0 이 아니라 null** 이다. */
export function pickActorKind(
  rows: ByActorKindRow[],
  kind: "worker" | "orchestrator"
): { costUsd: number; tokens: number } | null {
  const hit = rows.find((r) => r.actorKind === kind);
  return hit ? { costUsd: hit.costUsd, tokens: hit.tokens } : null;
}

/**
 * 팀 스코프 자체가 그려질 수 있는지. `disabled` 면 **숫자를 아예 안 그린다**
 * (설계 §7 화면규칙 1). 봉투가 없으면 그것도 그리지 않는다.
 */
export function isUsageRenderable(env: TeamUsageEnvelope): boolean {
  return env.teamUsage !== null && env.teamUsage.state !== "disabled";
}

/** ★'적재 전' — 읽어 올 자리가 아직 없다. `empty` 와 **원인이 다르다**. */
export function isUsageNotProvisioned(env: TeamUsageEnvelope): boolean {
  return env.teamUsage?.state === "not_provisioned";
}

/**
 * 데이터가 실제로 없나. `empty` 는 고장이 아니라 **기본값**이다(설계 §1.2).
 *
 * ★`not_provisioned` 을 여기로 접지 않는다 — 그건 '적재 전' 이고 다른 문구로
 *   그려야 한다(계약 §7 규칙 7).
 * ★`rowsInWindow > 0` 이면 **행은 있었다.** 합이 0 이어도 그건 '진짜 0' 이지
 *   빈 상태가 아니다(계약 §3 판정 규칙).
 */
export function isUsageEmpty(env: TeamUsageEnvelope): boolean {
  if (!env.teamUsage) return true;
  if (env.teamUsage.state === "not_provisioned") return false;
  if (env.teamUsage.state === "empty") return true;
  if ((env.coverage?.rowsInWindow ?? 0) > 0) return false;
  return (
    env.byDay.length === 0 &&
    env.byMember.length === 0 &&
    env.byProject.length === 0 &&
    env.byModel.length === 0
  );
}

// ── 사유 문구 해석 ──────────────────────────────────────────────────────────

/**
 * 사유를 화면 문장으로 바꾼다.
 *
 * ★백엔드 계약이 "코드" 인지 "완성 문장" 인지 아직 확정되지 않았다(오케에 질의
 *   등록됨). 그래서 **둘 다 받는다**:
 *   1. `code` 가 있고 로케일 사전에 있으면 → 번역문. ko·en·ja 가 각자 맞는 말을 한다.
 *   2. 없으면 서버가 준 산문 `prose` 를 그대로 그린다(설계 §7 "화면이 이 문장을
 *      그대로 그린다"). 로케일이 안 맞을 수 있지만 **빈칸보다 낫다** — 사유가
 *      사라지면 미수집이 0 과 구별되지 않는다.
 *   3. 둘 다 없으면 마지막 폴백 문장.
 *
 *   확정이 오면 고칠 자리는 이 함수 하나다.
 */
export function resolveReason(
  code: ReasonCode | null,
  prose: string | null,
  dictionary: Readonly<Record<string, string>>,
  fallback: string
): string {
  if (code && Object.prototype.hasOwnProperty.call(dictionary, code)) {
    const hit = dictionary[code];
    if (typeof hit === "string" && hit !== "") return hit;
  }
  if (prose) return prose;
  return fallback;
}

// ── 포맷터 ──────────────────────────────────────────────────────────────────

/** ★금액은 **추정 비용**이다. '청구액' 이 아니다(설계 §1.5). 라벨은 호출부 몫. */
export function formatUsd(value: number, locale: string): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value !== 0 && Math.abs(value) < 1 ? 4 : 2,
  }).format(value);
}

export function formatInt(value: number, locale: string): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
    value
  );
}

export function formatPercent(value: number | null, locale: string): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
}

/** `generatedAt` 기준 "N분 전"(설계 §7 화면규칙 5). 신선도를 숨기지 않는다. */
export function freshnessMinutes(
  generatedAt: string | null,
  now: number
): number | null {
  if (!generatedAt) return null;
  const t = new Date(generatedAt).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / 60_000));
}
