// 팀/조직 스코프 실행 원장 — `/org` 5단 드릴다운에 Mission→Ticket→Agent→Model→
// Cost→Result 한 줄을 붙인다. 순수 로직(Firestore 무의존). node --test 로
// 단위검증한다(teamAudit.ts / teamUsage.ts 와 같은 규약).
//
// 티켓: uYcCq9DRPLT8ZEh0rlkh — "원장이 /admin 에만 있다".
//
// ★이 파일이 하지 않는 것
//   - 새 집계를 만들지 않는다. 행은 전부 `projectAudit.buildExecutionLedger`
//     (기존, `/admin` 과 공유)가 조립한 것을 **좁히기만** 한다.
//   - `teamAudit.ts` 의 `narrowAuditForTeam`/`TeamProjectAuditResult` 를 건드리지
//     않는다. 그 응답은 "금액·토큰 필드가 하나도 없다" 는 게 파일 자체의 설계
//     경계다(teamAudit.ts:34-39) — 원장에는 `cost` 축이 있으므로 그 타입에
//     끼워 넣으면 게이트가 감사 탭 경유로 우회된다. 그래서 **별도 콜러블·별도
//     응답 타입**이다.
//
// ── ★권한 판단 (이 티켓의 핵심, 근거를 남긴다) ────────────────────────────────
//
// #1497 이 `/org` 5단 드릴다운의 사람 축에 세운 규율:
//   "전 프로젝트 owner/admin 은 전부, 그 외(member/none)는 **공집합**"
//   (`orgDrilldownContract.decidePersonScopeAccess` — 부분집합은 없다.)
//
// 원장은 사람 축보다 **더 민감하다** — 비용(`cost.total`)을 포함한다.
// `teamUsage.ts` 규율 4가 이미 이렇게 못박았다: "일반 멤버는 자기 것만 본다.
// 팀 총계도 못 본다." 그 규율을 원장에 그대로 적용하려면 멤버를 "자기 행만"
// 으로 부분 필터링해야 하는데, `ExecutionLedgerRow` 에는 그 필터를 걸 축이
// 없다 — `claimedBy`/`agentId`는 **에이전트**축이지 사람(uid)축이 아니다
// (`resolveTeamProjectRole` 의 self 스코프가 쓰는 `actorUid` 가 원장 행에는
// 없다). 신뢰할 수 없는 필터로 "이게 네 것" 이라 주장하는 것은, 안 보여주는
// 것보다 나쁘다(엉뚱한 행을 "네 것" 이라 자를 수도, 진짜 네 것을 빠뜨릴 수도
// 있다). 그래서 원장에서는 **member 를 self 로 부분 허용하지 않고 restricted
// 로 접는다** — 사람 축보다 한 단 더 좁다. 이건 사람 축과의 불일치가 아니라
// "비용 축은 근거 있는 필터가 없으면 전부 아니면 0" 이라는 같은 원칙(S ⊆
// visible(u))을 원장이라는 더 엄격한 데이터에 적용한 것이다.
//
// 그리고 비용을 싣는 이상 `TEAM_USAGE_EFFECTIVE_FROM` 게이트(고지 개정 전까지
// 멤버별 지출 비공개, teamUsage.ts §1)도 **독립적으로** 적용한다. 역할이
// owner/admin 이어도 게이트가 닫혀 있으면 원장은 닫힌다 — 두 문이다.

import { scrubIdentityLike } from "./teamAudit";
import type { TeamProjectRole } from "./teamAudit";
import type { TeamUsageGate } from "./teamUsage";
import type {
  ExecutionLedgerCoverage,
  ExecutionLedgerRow,
} from "./projectAudit";

// ── 응답 상태 ────────────────────────────────────────────────────────────────

export type TeamExecutionLedgerState =
  | "disabled"
  | "empty"
  | "complete"
  | "partial";

export const TEAM_EXECUTION_LEDGER_REASON_CODES = [
  "no_role",
  "no_project",
  "restricted_role",
  "gate_unset",
  "gate_invalid",
] as const;

export type TeamExecutionLedgerReasonCode =
  (typeof TEAM_EXECUTION_LEDGER_REASON_CODES)[number];

const REASON_TEXT: Readonly<Record<TeamExecutionLedgerReasonCode, string>> = {
  no_role: "이 프로젝트의 실행 원장을 볼 수 있는 권한이 없습니다.",
  no_project: "표시할 프로젝트가 없습니다.",
  // ★member/none 을 자기 행만으로 부분 허용하지 않는 이유는 파일 상단 주석.
  restricted_role:
    "이 프로젝트의 실행 원장은 프로젝트 관리자만 볼 수 있습니다.",
  gate_unset:
    "실행 원장 열람이 아직 열려 있지 않습니다. 사용량·비용 기록은 지금 " +
    "'본인의 구독·정산 확인' 목적으로만 보관한다고 안내하고 있어, 개별 실행의 " +
    "비용을 보는 기능은 안내 개정과 사전 통지 뒤에 열립니다.",
  gate_invalid: "실행 원장 열람이 아직 열려 있지 않습니다.",
};

export function executionLedgerReasonText(
  code: TeamExecutionLedgerReasonCode,
): string {
  return REASON_TEXT[code];
}

export const PARTIAL_SOURCES_NOTE =
  "기록 일부를 불러오지 못해 아래 원장이 전부가 아닙니다.";

export interface TeamExecutionLedgerEnvelope {
  state: TeamExecutionLedgerState;
  reasonCode: TeamExecutionLedgerReasonCode | null;
  /** ★화면이 그대로 그려도 되는 문장. 정상(`complete`/`empty`)이면 null. */
  reason: string | null;
  role: Exclude<TeamProjectRole, "none"> | null;
  /** ★partial 일 때만 채워진다 — 조용한 절단 금지. */
  partialNote: string | null;
  basis: "execution_ledger";
}

export interface TeamProjectExecutionLedgerResult {
  generatedAt: string;
  projectId: string | null;
  envelope: TeamExecutionLedgerEnvelope;
  rows: ExecutionLedgerRow[];
  /** ★닫힌 응답은 커버리지도 없다 — 미공개 사실 위에 숫자를 얹지 않는다. */
  coverage: ExecutionLedgerCoverage | null;
}

function closedEnvelope(
  reasonCode: TeamExecutionLedgerReasonCode,
  role: Exclude<TeamProjectRole, "none"> | null,
): TeamExecutionLedgerEnvelope {
  return {
    state: "disabled",
    reasonCode,
    reason: executionLedgerReasonText(reasonCode),
    role,
    partialNote: null,
    basis: "execution_ledger",
  };
}

/**
 * 권한 없음 / 게이트 닫힘 응답. ★존재하지 않는 프로젝트와 권한 없는 프로젝트가
 * 구분되지 않는 같은 모양이다(teamAudit.deniedTeamAudit 과 같은 규약).
 */
export function deniedExecutionLedger(
  nowMs: number,
  projectId: string | null,
  reasonCode: TeamExecutionLedgerReasonCode,
  role: Exclude<TeamProjectRole, "none"> | null = null,
): TeamProjectExecutionLedgerResult {
  return {
    generatedAt: new Date(nowMs).toISOString(),
    projectId,
    envelope: closedEnvelope(reasonCode, role),
    rows: [],
    coverage: null,
  };
}

/**
 * ★값 수준 신원 스크럽. `teamAudit.scrubIdentityLike` 재사용 — 원장 행에도
 * 같은 방어가 필요하다: `claimedBy`(id 일 수도 사람이 지은 이름일 수도 있다)와
 * `agentName`(`spawn_agent` 의 자유 문자열)에 이메일/uid 모양 값이 실릴 수 있다.
 */
function scrubRow(row: ExecutionLedgerRow): ExecutionLedgerRow {
  return {
    ...row,
    claimedBy: scrubIdentityLike(row.claimedBy),
    agentName: scrubIdentityLike(row.agentName),
    agentId: scrubIdentityLike(row.agentId),
    // ★미션 목표는 사람이 친 지시문(Tier-2 자유 텍스트) — teamAudit.ts 의
    //   `withheld_mission_goal` 과 같은 경계. `/admin` 과 달리 `/org` 응답
    //   어디에도 이 문자열이 이미 나가 있지 않으므로 "이미 노출된 것의 재사용"
    //   이 아니다 — 여기서 새로 만들지 않는다.
    missionGoal: null,
  };
}

export interface NarrowExecutionLedgerForTeamInput {
  projectId: string;
  role: TeamProjectRole;
  gate: TeamUsageGate;
  rows: ReadonlyArray<ExecutionLedgerRow>;
  coverage: ExecutionLedgerCoverage;
  /** 소스 중 하나라도 못 읽었거나 스캔이 상한에서 잘렸나 → `partial`. */
  sourcesIncomplete: boolean;
  nowMs: number;
}

/**
 * ★팀/조직 경계를 강제하는 유일한 지점. 넓히는 경로는 없다 — 이 함수를 거치지
 * 않고 `buildExecutionLedger` 결과가 `/org` 응답에 실릴 길을 만들지 마라.
 */
export function narrowExecutionLedgerForTeam(
  input: NarrowExecutionLedgerForTeamInput,
): TeamProjectExecutionLedgerResult {
  const { projectId, role, gate, rows, coverage, sourcesIncomplete, nowMs } =
    input;

  if (role === "none") {
    return deniedExecutionLedger(nowMs, projectId, "no_role");
  }
  // ★S ⊆ visible(u) — 전부(owner/admin) 아니면 공집합(member). 부분집합은 없다.
  if (role !== "owner" && role !== "admin") {
    return deniedExecutionLedger(nowMs, projectId, "restricted_role", null);
  }
  if (!gate.open) {
    return deniedExecutionLedger(
      nowMs,
      projectId,
      gate.reasonCode === "invalid" ? "gate_invalid" : "gate_unset",
      role,
    );
  }

  const scrubbedRows = rows.map(scrubRow);
  const state: TeamExecutionLedgerState = sourcesIncomplete
    ? "partial"
    : scrubbedRows.length === 0
      ? "empty"
      : "complete";

  return {
    generatedAt: new Date(nowMs).toISOString(),
    projectId,
    envelope: {
      state,
      reasonCode: null,
      reason: null,
      role,
      partialNote: state === "partial" ? PARTIAL_SOURCES_NOTE : null,
      basis: "execution_ledger",
    },
    rows: scrubbedRows,
    coverage,
  };
}
