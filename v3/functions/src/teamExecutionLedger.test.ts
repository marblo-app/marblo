// teamExecutionLedger.ts 단위검증 — node --test (teamAudit.test.ts 와 같은 규약).
//
// ★이 파일이 지키는 것은 "동작" 이 아니라 **약속**이다:
//   1) S ⊆ visible(u) — owner/admin 은 전부, 그 외(member/none)는 공집합.
//      부분집합(자기 행만)은 없다 — 신뢰할 수 없는 필터로 "네 것" 이라 주장하지
//      않는다(teamExecutionLedger.ts 상단 주석의 판단 근거).
//   2) 비용을 싣기 때문에 `TEAM_USAGE_EFFECTIVE_FROM` 게이트가 owner/admin 에게도
//      독립적으로 적용된다 — 역할이 있어도 게이트가 닫히면 0행이다.
//   3) 미션 목표(자유 텍스트)는 절대 나가지 않는다. 이메일/uid 모양 값은 가려진다.
//   4) 미측정(`null`)이 narrowing 을 거쳐도 `0`/`"$0.00"` 으로 접히지 않는다.
//   5) 가드를 끄면(role 검사를 건너뛰면) 몇 건이 새는지 — 이 파일의 각
//      "restricted" 테스트가 입력 행 수와 출력 행 수(0)를 함께 단언해 그 격차를
//      숫자로 고정한다.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  deniedExecutionLedger,
  narrowExecutionLedgerForTeam,
  TEAM_EXECUTION_LEDGER_REASON_CODES,
  type TeamExecutionLedgerReasonCode,
} from "./teamExecutionLedger";
import type {
  ExecutionLedgerCoverage,
  ExecutionLedgerRow,
} from "./projectAudit";
import type { TeamUsageGate } from "./teamUsage";

const OPEN_GATE: TeamUsageGate = {
  open: true,
  reasonCode: null,
  reason: null,
  operatorReason: null,
  effectiveFrom: "2026-08-01",
};

const UNSET_GATE: TeamUsageGate = {
  open: false,
  reasonCode: "unset",
  reason: "closed(unset)",
  operatorReason: "operator(unset)",
  effectiveFrom: null,
};

const INVALID_GATE: TeamUsageGate = {
  open: false,
  reasonCode: "invalid",
  reason: "closed(invalid)",
  operatorReason: "operator(invalid)",
  effectiveFrom: null,
};

// 28자, 대소문자+숫자 혼합 — teamAudit.ts 의 uidLikeRe 에 걸리는 모양.
const UID_LIKE_AGENT_ID = "uidAgent28charsAAAAAAAAAAAA1";
const EMAIL_LIKE_NAME = "agent-owner <ops@corp.com>";

function makeRow(
  overrides: Partial<ExecutionLedgerRow> = {},
): ExecutionLedgerRow {
  return {
    taskId: "task-1",
    missionId: "mission-1",
    missionGoal: "사람이 친 지시문 — 절대 나가면 안 된다",
    ticketTitle: "티켓 제목",
    role: "backend",
    claimedBy: "backend-1",
    agentId: "agent-doc-1",
    agentName: "backend-1",
    agentResolved: true,
    model: {
      actual: "claude-sonnet-5",
      actualSource: "detectedModelId",
      harness: "claude",
    },
    cost: { total: 1.23, inputTokens: 1000, outputTokens: 200, retries: 0 },
    result: {
      status: "DONE",
      completedAt: "2026-09-01T00:00:00.000Z",
      prUrl: null,
      merged: true,
      actions: 4,
      failedActions: 0,
    },
    at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeCoverage(
  overrides: Partial<ExecutionLedgerCoverage> = {},
): ExecutionLedgerCoverage {
  return {
    rows: 1,
    ticketsWithoutExecution: 0,
    modelMeasured: 1,
    costMeasured: 1,
    agentResolved: 1,
    costMeasuredTotal: 1.23,
    ...overrides,
  };
}

const NOW_MS = Date.parse("2026-09-06T00:00:00.000Z");

// ── 1) S ⊆ visible(u): role 이 없거나 member 면 공집합 ──────────────────────

test("role=none — 입력 3행이 있어도 출력은 0행이다(격차를 숫자로 고정)", () => {
  const rows = [
    makeRow(),
    makeRow({ taskId: "task-2" }),
    makeRow({ taskId: "task-3" }),
  ];
  const result = narrowExecutionLedgerForTeam({
    projectId: "p1",
    role: "none",
    gate: OPEN_GATE,
    rows,
    coverage: makeCoverage({ rows: 3 }),
    sourcesIncomplete: false,
    nowMs: NOW_MS,
  });
  assert.equal(rows.length, 3, "입력 표본이 실제로 3행인지 확인");
  assert.equal(
    result.rows.length,
    0,
    "role=none 이면 0행이어야 한다 — 새면 버그",
  );
  assert.equal(result.coverage, null, "닫힌 응답은 커버리지도 없다");
  assert.equal(result.envelope.state, "disabled");
  assert.equal(result.envelope.reasonCode, "no_role");
});

test("role=member — 자기 행만 부분 허용하지 않는다(부분집합 금지 — 0행)", () => {
  const rows = [makeRow(), makeRow({ taskId: "task-2" })];
  const result = narrowExecutionLedgerForTeam({
    projectId: "p1",
    role: "member",
    gate: OPEN_GATE,
    rows,
    coverage: makeCoverage({ rows: 2 }),
    sourcesIncomplete: false,
    nowMs: NOW_MS,
  });
  assert.equal(result.rows.length, 0);
  assert.equal(result.envelope.state, "disabled");
  assert.equal(result.envelope.reasonCode, "restricted_role");
  assert.equal(result.envelope.role, null, "역할 이름을 담지 않는다");
});

test("role=owner — 전수가 가시 집합이다(부분집합은 없다)", () => {
  const rows = [
    makeRow(),
    makeRow({ taskId: "task-2" }),
    makeRow({ taskId: "task-3" }),
  ];
  const result = narrowExecutionLedgerForTeam({
    projectId: "p1",
    role: "owner",
    gate: OPEN_GATE,
    rows,
    coverage: makeCoverage({ rows: 3 }),
    sourcesIncomplete: false,
    nowMs: NOW_MS,
  });
  assert.equal(result.rows.length, 3);
  assert.equal(result.envelope.state, "complete");
  assert.equal(result.envelope.reasonCode, null);
});

test("role=admin — owner 와 같은 축이다(전수)", () => {
  const rows = [makeRow(), makeRow({ taskId: "task-2" })];
  const result = narrowExecutionLedgerForTeam({
    projectId: "p1",
    role: "admin",
    gate: OPEN_GATE,
    rows,
    coverage: makeCoverage({ rows: 2 }),
    sourcesIncomplete: false,
    nowMs: NOW_MS,
  });
  assert.equal(result.rows.length, 2);
  assert.equal(result.envelope.state, "complete");
});

// ── 2) 비용 게이트 — owner/admin 이어도 게이트가 닫히면 0행 ──────────────────

test("owner + 게이트 unset — 0행, gate_unset", () => {
  const result = narrowExecutionLedgerForTeam({
    projectId: "p1",
    role: "owner",
    gate: UNSET_GATE,
    rows: [makeRow()],
    coverage: makeCoverage(),
    sourcesIncomplete: false,
    nowMs: NOW_MS,
  });
  assert.equal(result.rows.length, 0);
  assert.equal(result.envelope.state, "disabled");
  assert.equal(result.envelope.reasonCode, "gate_unset");
  assert.equal(
    result.envelope.role,
    "owner",
    "게이트 닫힘 사유에서는 역할은 밝혀도 된다(존재 탐지가 아니다)",
  );
});

test("admin + 게이트 invalid — 0행, gate_invalid", () => {
  const result = narrowExecutionLedgerForTeam({
    projectId: "p1",
    role: "admin",
    gate: INVALID_GATE,
    rows: [makeRow()],
    coverage: makeCoverage(),
    sourcesIncomplete: false,
    nowMs: NOW_MS,
  });
  assert.equal(result.rows.length, 0);
  assert.equal(result.envelope.reasonCode, "gate_invalid");
});

// ── 3) 값 스크럽 — 미션 목표는 항상 null, 이메일/uid 모양 값은 가려진다 ──────

test("미션 목표는 항상 null 이다 — teamAudit 의 withheld_mission_goal 경계를 원장도 지킨다", () => {
  const result = narrowExecutionLedgerForTeam({
    projectId: "p1",
    role: "owner",
    gate: OPEN_GATE,
    rows: [makeRow({ missionGoal: "이 문장이 나가면 버그다" })],
    coverage: makeCoverage(),
    sourcesIncomplete: false,
    nowMs: NOW_MS,
  });
  assert.equal(result.rows[0]?.missionGoal, null);
});

test("이메일 모양 agentName·uid 모양 agentId 는 가려진다", () => {
  const result = narrowExecutionLedgerForTeam({
    projectId: "p1",
    role: "admin",
    gate: OPEN_GATE,
    rows: [
      makeRow({
        claimedBy: EMAIL_LIKE_NAME,
        agentName: EMAIL_LIKE_NAME,
        agentId: UID_LIKE_AGENT_ID,
      }),
    ],
    coverage: makeCoverage(),
    sourcesIncomplete: false,
    nowMs: NOW_MS,
  });
  const row = result.rows[0]!;
  assert.ok(
    !row.claimedBy?.includes("ops@corp.com"),
    "이메일이 그대로 새면 안 된다",
  );
  assert.ok(!row.agentName?.includes("ops@corp.com"));
  assert.notEqual(
    row.agentId,
    UID_LIKE_AGENT_ID,
    "uid 모양 전체 일치는 가려진다",
  );
});

test("ticketTitle 은 그대로 통과한다 — 팀 감사 응답에 이미 있는 값이라 새 노출이 아니다", () => {
  const result = narrowExecutionLedgerForTeam({
    projectId: "p1",
    role: "owner",
    gate: OPEN_GATE,
    rows: [makeRow({ ticketTitle: "이미 보드에 있는 제목" })],
    coverage: makeCoverage(),
    sourcesIncomplete: false,
    nowMs: NOW_MS,
  });
  assert.equal(result.rows[0]?.ticketTitle, "이미 보드에 있는 제목");
});

// ── 4) 미측정은 0 이 아니다 — narrowing 이 값을 건드리지 않는지 회귀 고정 ────

test("cost.total=null(미측정)은 narrowing 을 거쳐도 null 그대로다", () => {
  const result = narrowExecutionLedgerForTeam({
    projectId: "p1",
    role: "owner",
    gate: OPEN_GATE,
    rows: [
      makeRow({
        cost: {
          total: null,
          inputTokens: null,
          outputTokens: null,
          retries: null,
        },
        model: { actual: null, actualSource: null, harness: null },
      }),
    ],
    coverage: makeCoverage({
      modelMeasured: 0,
      costMeasured: 0,
      costMeasuredTotal: 0,
    }),
    sourcesIncomplete: false,
    nowMs: NOW_MS,
  });
  assert.equal(result.rows[0]?.cost.total, null);
  assert.equal(result.rows[0]?.model.actual, null);
});

// ── 5) 상태 — empty/partial/complete ────────────────────────────────────────

test("행이 0건이면 empty 다(닫힘이 아니다)", () => {
  const result = narrowExecutionLedgerForTeam({
    projectId: "p1",
    role: "owner",
    gate: OPEN_GATE,
    rows: [],
    coverage: makeCoverage({ rows: 0 }),
    sourcesIncomplete: false,
    nowMs: NOW_MS,
  });
  assert.equal(result.envelope.state, "empty");
  assert.deepEqual(result.rows, []);
  assert.notEqual(
    result.coverage,
    null,
    "empty 는 열린 응답이다 — 커버리지가 있다",
  );
});

test("소스 일부 실패/스캔 절단 — partial 이고 조용히 넘어가지 않는다", () => {
  const result = narrowExecutionLedgerForTeam({
    projectId: "p1",
    role: "admin",
    gate: OPEN_GATE,
    rows: [makeRow()],
    coverage: makeCoverage(),
    sourcesIncomplete: true,
    nowMs: NOW_MS,
  });
  assert.equal(result.envelope.state, "partial");
  assert.ok(
    result.envelope.partialNote && result.envelope.partialNote.length > 0,
  );
});

// ── 6) deniedExecutionLedger — 존재하지 않는 프로젝트와 권한 없는 프로젝트가
//      구분되지 않는 같은 모양이다 ───────────────────────────────────────────

test("no_project 와 no_role 은 같은 모양(0행 + disabled)이다", () => {
  const noProject = deniedExecutionLedger(NOW_MS, null, "no_project");
  const noRole = deniedExecutionLedger(NOW_MS, "p1", "no_role");
  assert.equal(noProject.envelope.state, "disabled");
  assert.equal(noRole.envelope.state, "disabled");
  assert.deepEqual(noProject.rows, []);
  assert.deepEqual(noRole.rows, []);
});

test("모든 사유 코드에 화면이 그대로 그릴 수 있는 문장이 있다", () => {
  for (const code of TEAM_EXECUTION_LEDGER_REASON_CODES) {
    const result = deniedExecutionLedger(
      NOW_MS,
      "p1",
      code as TeamExecutionLedgerReasonCode,
    );
    assert.ok(
      result.envelope.reason && result.envelope.reason.length > 0,
      `사유 ${code} 문장 누락`,
    );
  }
});
