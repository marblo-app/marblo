/**
 * 실행 원장 축 계약 테스트. 티켓 uYcCq9DRPLT8ZEh0rlkh.
 *
 * ★이 파일이 지키는 것: 모르는 응답 모양은 `unwired` 로 접힌다(0 을 지어내지
 * 않는다) · `disabled` 는 `restricted` 로 옮겨진다 · 미션 목표는 서버가 무엇을
 * 보내든 항상 `null` 이다(이중 방어) · 이메일/uid 모양 값은 클라에서도 다시
 * 가려진다 · 미측정(`null`)이 0 으로 바뀌지 않는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeTeamExecutionLedger } from "./teamExecutionLedgerContract";

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    taskId: "task-1",
    missionId: "mission-1",
    missionGoal: "사람이 친 지시문",
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

function baseCoverage(overrides: Record<string, unknown> = {}) {
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

// ── 모르는 모양은 unwired 다 ─────────────────────────────────────────────────

test("undefined/null/배열 — 전부 unwired 다", () => {
  assert.deepEqual(normalizeTeamExecutionLedger(undefined), {
    kind: "unwired",
  });
  assert.deepEqual(normalizeTeamExecutionLedger(null), { kind: "unwired" });
  assert.deepEqual(normalizeTeamExecutionLedger([1, 2, 3]), {
    kind: "unwired",
  });
});

test("envelope 이 없거나 state 가 알려지지 않은 값이면 unwired 다", () => {
  assert.deepEqual(normalizeTeamExecutionLedger({}), { kind: "unwired" });
  assert.deepEqual(
    normalizeTeamExecutionLedger({ envelope: { state: "something-new" } }),
    { kind: "unwired" }
  );
});

test("★열린 상태(complete)인데 coverage 를 못 읽으면 unwired 다 — 0 을 지어내지 않는다", () => {
  const result = normalizeTeamExecutionLedger({
    envelope: { state: "complete" },
    rows: [baseRow()],
    coverage: null,
  });
  assert.deepEqual(result, { kind: "unwired" });
});

// ── disabled → restricted ────────────────────────────────────────────────────

test("state=disabled 는 restricted 로 옮겨지고 사유를 그대로 싣는다", () => {
  const result = normalizeTeamExecutionLedger({
    envelope: {
      state: "disabled",
      reasonCode: "restricted_role",
      reason: "이 프로젝트의 실행 원장은 프로젝트 관리자만 볼 수 있습니다.",
    },
  });
  assert.deepEqual(result, {
    kind: "restricted",
    reasonCode: "restricted_role",
    reason: "이 프로젝트의 실행 원장은 프로젝트 관리자만 볼 수 있습니다.",
  });
});

test("사유 코드가 알려지지 않은 값이면 null 로 접는다(지어내지 않는다)", () => {
  const result = normalizeTeamExecutionLedger({
    envelope: { state: "disabled", reasonCode: "made_up_code", reason: "x" },
  });
  assert.equal(result.kind, "restricted");
  assert.equal((result as { reasonCode: string | null }).reasonCode, null);
});

// ── empty ────────────────────────────────────────────────────────────────────

test("state=empty 는 empty 다", () => {
  assert.deepEqual(
    normalizeTeamExecutionLedger({ envelope: { state: "empty" } }),
    {
      kind: "empty",
    }
  );
});

// ── measured — 값 스크럽과 미측정 보존 ───────────────────────────────────────

test("미션 목표는 서버가 무엇을 보내든 항상 null 이다(이중 방어)", () => {
  const result = normalizeTeamExecutionLedger({
    envelope: { state: "complete" },
    rows: [baseRow({ missionGoal: "이 문장이 나가면 버그다" })],
    coverage: baseCoverage(),
  });
  assert.equal(result.kind, "measured");
  assert.equal(
    (result as { rows: Array<{ missionGoal: string | null }> }).rows[0]
      ?.missionGoal,
    null
  );
});

test("이메일 모양 claimedBy·uid 모양 agentId 는 클라에서도 다시 가려진다", () => {
  const result = normalizeTeamExecutionLedger({
    envelope: { state: "complete" },
    rows: [
      baseRow({
        claimedBy: "agent-owner <ops@corp.com>",
        agentName: "agent-owner <ops@corp.com>",
        agentId: "uidAgent28charsAAAAAAAAAAAA1",
      }),
    ],
    coverage: baseCoverage(),
  });
  assert.equal(result.kind, "measured");
  const row = (
    result as {
      rows: Array<{
        claimedBy: string | null;
        agentName: string | null;
        agentId: string | null;
      }>;
    }
  ).rows[0]!;
  assert.ok(!row.claimedBy?.includes("ops@corp.com"));
  assert.ok(!row.agentName?.includes("ops@corp.com"));
  assert.notEqual(row.agentId, "uidAgent28charsAAAAAAAAAAAA1");
});

test("서버가 이미 스크럽한 자리표시(가려짐)는 그대로 통과한다", () => {
  const result = normalizeTeamExecutionLedger({
    envelope: { state: "complete" },
    rows: [baseRow({ claimedBy: "(가려짐)" })],
    coverage: baseCoverage(),
  });
  assert.equal(result.kind, "measured");
  assert.equal(
    (result as { rows: Array<{ claimedBy: string | null }> }).rows[0]
      ?.claimedBy,
    "(가려짐)"
  );
});

test("cost.total=null(미측정)은 정규화를 거쳐도 null 그대로다 — 0 이 아니다", () => {
  const result = normalizeTeamExecutionLedger({
    envelope: { state: "complete" },
    rows: [
      baseRow({
        cost: {
          total: null,
          inputTokens: null,
          outputTokens: null,
          retries: null,
        },
        model: { actual: null, actualSource: null, harness: null },
      }),
    ],
    coverage: baseCoverage({
      modelMeasured: 0,
      costMeasured: 0,
      costMeasuredTotal: 0,
    }),
  });
  assert.equal(result.kind, "measured");
  const row = (
    result as {
      rows: Array<{
        cost: { total: number | null };
        model: { actual: string | null };
      }>;
    }
  ).rows[0]!;
  assert.equal(row.cost.total, null);
  assert.equal(row.model.actual, null);
});

test("taskId 가 없는 행은 버린다 — 무엇의 행인지 못 그린다", () => {
  const result = normalizeTeamExecutionLedger({
    envelope: { state: "complete" },
    rows: [baseRow({ taskId: "" }), baseRow({ taskId: "task-ok" })],
    coverage: baseCoverage({ rows: 2 }),
  });
  assert.equal(result.kind, "measured");
  const rows = (result as { rows: Array<{ taskId: string }> }).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.taskId, "task-ok");
});

test("state=partial 은 truncated:true 를 싣는다 — 조용히 넘어가지 않는다", () => {
  const result = normalizeTeamExecutionLedger({
    envelope: { state: "partial" },
    rows: [baseRow()],
    coverage: baseCoverage(),
  });
  assert.equal(result.kind, "measured");
  assert.equal((result as { truncated: boolean }).truncated, true);
});

test("ticketTitle 은 그대로 통과한다 — 팀 감사 응답에 이미 있는 값이다", () => {
  const result = normalizeTeamExecutionLedger({
    envelope: { state: "complete" },
    rows: [baseRow({ ticketTitle: "이미 보드에 있는 제목" })],
    coverage: baseCoverage(),
  });
  assert.equal(result.kind, "measured");
  assert.equal(
    (result as { rows: Array<{ ticketTitle: string | null }> }).rows[0]
      ?.ticketTitle,
    "이미 보드에 있는 제목"
  );
});
