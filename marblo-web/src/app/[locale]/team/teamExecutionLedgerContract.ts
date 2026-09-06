/**
 * 실행 원장 축 계약 — `getTeamProjectExecutionLedger` 응답을 화면이 읽는
 * 모양으로 접는다. 티켓 uYcCq9DRPLT8ZEh0rlkh — "원장이 /admin 에만 있다".
 *
 * 서버 구현: `v3/functions/src/teamExecutionLedger.ts`(타입 원본) + `index.ts`
 * 콜러블. 행·커버리지 모양은 `/admin` 의 `ExecutionLedgerSection` 이 정의한
 * `ExecutionLedgerRow`/`ExecutionLedgerCoverage` **그대로**다 — 이 파일은 그
 * 타입을 다시 정의하지 않고 가져다 쓴다(두 번 만들지 않는다).
 *
 * ★`teamAuditContract.ts`(§7)와 같은 규약: `state` + `reasonCode`(i18n 키) +
 *   `reason`(ko 문장 폴백). "모르는 것을 0 으로 만들지 않는다" 도 같다 — state
 *   가 알려지지 않은 값이면 `unwired` 로 접는다(그리지 않는다. 0 을 그리지
 *   않는다).
 *
 * ★비용을 싣는 축이라 `teamUsageContract`/`teamAuditContract` 보다 한 겹 더
 *   본다: 서버가 이미 이메일/uid 모양 값을 가렸어도(`scrubIdentityLike`),
 *   `agentLabelOf`(teamAuditContract.ts)로 **값 수준 재검사**를 한 번 더 한다
 *   — 응답은 화면 말고도 갈 데가 있다는 그 파일의 판단을 그대로 잇는다.
 *
 * ★React·firebase 무의존. `tsx --test` 로 그대로 돈다.
 */

import type {
  ExecutionLedgerCoverage,
  ExecutionLedgerRow,
} from "../admin/ExecutionLedgerSection";
import { agentLabelOf, SERVER_REDACTED_MARKER } from "./teamAuditContract";

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
  typeof TEAM_EXECUTION_LEDGER_REASON_CODES[number];

/**
 * 화면이 실제로 그리는 축. ★서버의 `envelope.state` 를 그대로 옮긴다 —
 * 역할을 다시 계산하지 않는다(§6.1 "조직 역할은 프로젝트 내용을 안 준다").
 *
 * - `unwired`    — 콜러블을 못 불렀거나 응답 모양을 못 읽었다(구 배포 포함).
 * - `restricted` — 서버가 `disabled` 를 돌려줬다(권한 없음 또는 비용 게이트
 *                  닫힘). 숫자를 그리지 않고 사유만 말한다.
 * - `empty`      — 권한은 있고 창 안에 실행 흔적이 0 건이다.
 * - `measured`   — 실측. `truncated` 면 "전부가 아니다" 를 밝힌다.
 */
export type TeamExecutionLedgerAxis =
  | { kind: "unwired" }
  | {
      kind: "restricted";
      reasonCode: TeamExecutionLedgerReasonCode | null;
      reason: string | null;
    }
  | { kind: "empty" }
  | {
      kind: "measured";
      rows: ExecutionLedgerRow[];
      coverage: ExecutionLedgerCoverage;
      truncated: boolean;
    };

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/** `agentLabelOf` 로 값 수준 재스크럽 후 컴포넌트가 기대하는 문자열 모양으로 편다. */
function labelString(v: unknown): string | null {
  const label = agentLabelOf(v);
  if (label.kind === "value") return label.value;
  if (label.kind === "redacted") return SERVER_REDACTED_MARKER;
  return null;
}

const REASON_CODES: ReadonlySet<string> = new Set(
  TEAM_EXECUTION_LEDGER_REASON_CODES
);

function reasonCode(v: unknown): TeamExecutionLedgerReasonCode | null {
  return typeof v === "string" && REASON_CODES.has(v)
    ? (v as TeamExecutionLedgerReasonCode)
    : null;
}

function normalizeModel(v: unknown): ExecutionLedgerRow["model"] {
  const r = asRecord(v);
  const actualSource = r?.actualSource;
  return {
    actual: str(r?.actual),
    actualSource:
      actualSource === "detectedModelId" || actualSource === "spawnedModel"
        ? actualSource
        : null,
    harness: str(r?.harness),
  };
}

function normalizeCost(v: unknown): ExecutionLedgerRow["cost"] {
  const r = asRecord(v);
  return {
    total: num(r?.total),
    inputTokens: num(r?.inputTokens),
    outputTokens: num(r?.outputTokens),
    retries: num(r?.retries),
  };
}

function normalizeResult(v: unknown): ExecutionLedgerRow["result"] {
  const r = asRecord(v);
  return {
    status: str(r?.status),
    completedAt: str(r?.completedAt),
    prUrl: str(r?.prUrl),
    merged: r?.merged === true,
    actions: num(r?.actions) ?? 0,
    failedActions: num(r?.failedActions) ?? 0,
  };
}

/** 원장 행 하나. ★taskId 가 없으면 무엇의 행인지 못 그리므로 버린다. */
function normalizeRow(v: unknown): ExecutionLedgerRow | null {
  const r = asRecord(v);
  const taskId = str(r?.taskId);
  if (!r || !taskId) return null;
  return {
    taskId,
    missionId: str(r.missionId),
    // ★서버가 이미 항상 null 로 보낸다(teamExecutionLedger.ts). 여기서도
    //   신뢰하지 않고 다시 null 로 접는다 — 두 겹 방어(파일 상단 주석).
    missionGoal: null,
    ticketTitle: str(r.ticketTitle),
    role: str(r.role),
    claimedBy: labelString(r.claimedBy),
    agentId: labelString(r.agentId),
    agentName: labelString(r.agentName),
    agentResolved: r.agentResolved === true,
    model: normalizeModel(r.model),
    cost: normalizeCost(r.cost),
    result: normalizeResult(r.result),
    at: str(r.at),
  };
}

function normalizeRows(v: unknown): ExecutionLedgerRow[] {
  return Array.isArray(v)
    ? v.flatMap((row) => {
        const parsed = normalizeRow(row);
        return parsed ? [parsed] : [];
      })
    : [];
}

function normalizeCoverage(v: unknown): ExecutionLedgerCoverage | null {
  const r = asRecord(v);
  if (!r) return null;
  return {
    rows: num(r.rows) ?? 0,
    ticketsWithoutExecution: num(r.ticketsWithoutExecution) ?? 0,
    modelMeasured: num(r.modelMeasured) ?? 0,
    costMeasured: num(r.costMeasured) ?? 0,
    agentResolved: num(r.agentResolved) ?? 0,
    costMeasuredTotal: num(r.costMeasuredTotal) ?? 0,
  };
}

/**
 * ★신뢰 경계. 어떤 입력이 와도 던지지 않고, 모르는 모양은 `unwired` 로 접는다
 * (0 을 그리는 것보다 안 그리는 쪽이 안전하다).
 */
export function normalizeTeamExecutionLedger(
  raw: unknown
): TeamExecutionLedgerAxis {
  const r = asRecord(raw);
  if (!r) return { kind: "unwired" };
  const envelope = asRecord(r.envelope);
  const state = envelope?.state;

  if (state === "disabled") {
    return {
      kind: "restricted",
      reasonCode: reasonCode(envelope?.reasonCode),
      reason: str(envelope?.reason),
    };
  }
  if (state === "empty") return { kind: "empty" };
  if (state === "complete" || state === "partial") {
    const coverage = normalizeCoverage(r.coverage);
    // ★열린 상태인데 커버리지를 못 읽으면 신뢰할 수 없다 — 0 을 지어내지 않고
    //   안 그린다.
    if (!coverage) return { kind: "unwired" };
    return {
      kind: "measured",
      rows: normalizeRows(r.rows),
      coverage,
      truncated: state === "partial",
    };
  }
  return { kind: "unwired" };
}
