// analyticsPseudonym 순수 로직 단위테스트 (telemetryMetadata.test.ts 규약).
//
// 실행:
//   cd v3/functions && npm run test:analytics-pseudonym
//
// ★이 파일의 존재 이유(ticket U5OPOKf0D3I2TSRP8yUq): **익명 세계와 cost_logs 가
// 다시 조인되는 변경을 빨갛게 만든다.** uid 컬럼을 지운 뒤에도 두 세계가 같은
// 원시 agentId/taskId/projectId 를 공유하는 한 계정 재연결은 가능했다.
import test from "node:test";
import assert from "node:assert/strict";

import {
  ANALYTICS_ID_FIELDS,
  pseudonymizeAnalyticsId,
  pseudonymizeAnalyticsRow,
  readAnalyticsIdSalt,
} from "./analyticsPseudonym";

const SALT = "test-salt-not-a-real-secret";

/**
 * ★핵심 시나리오. cost_logs 는 계정 uid 와 원시 조인키를 함께 보관한다.
 * 어떤 조인키로도 익명 row 와 이어지면 계정 재연결이 성립한다.
 */
const COST_LOG_ROW = {
  userId: "firebase-uid-abc123", // 계정 uid — cost_logs 에는 남아 있다(본인 Usage).
  projectId: "proj_9f2",
  agentId: "agent_77",
  taskId: "task_5150",
};

/** 익명 세계 row 하나를 cost_logs 와 조인 시도해 성공한 키 목록을 돌려준다. */
function joinableKeys(
  anonRow: Record<string, unknown>,
  costRow: Record<string, unknown>
): string[] {
  return Object.keys(ANALYTICS_ID_FIELDS).filter((field) => {
    const a = anonRow[field];
    const c = costRow[field];
    return typeof a === "string" && a.length > 0 && a === c;
  });
}

test("★계정 재연결 불가 — 같은 실행이어도 익명 row 의 어떤 키도 cost_logs 와 조인되지 않는다", () => {
  // 같은 에이전트 실행에서 나온 events row(원시 id 는 cost_logs 와 동일했다).
  const rawEvent = {
    event: "agent:spawned",
    userId: "install-anon-1", // 익명 설치 ID — uid 가 아니다.
    projectId: COST_LOG_ROW.projectId,
    agentId: COST_LOG_ROW.agentId,
    taskId: COST_LOG_ROW.taskId,
  };

  // 가명화 전에는 세 키 전부로 조인이 성립했다(= 예전 상태의 회귀 감지).
  assert.deepEqual(joinableKeys(rawEvent, COST_LOG_ROW).sort(), [
    "agentId",
    "projectId",
    "taskId",
  ]);

  const stored = pseudonymizeAnalyticsRow(rawEvent, SALT);
  assert.deepEqual(
    joinableKeys(stored, COST_LOG_ROW),
    [],
    "익명 row 가 cost_logs 와 아직 조인된다 — 계정 재연결 다리가 살아 있다"
  );
});

test("★가명 안에 원시 id 가 남지 않는다(부분일치 재연결도 불가)", () => {
  const stored = pseudonymizeAnalyticsRow(
    { agentId: "agent_77", taskId: "task_5150", projectId: "proj_9f2" },
    SALT
  );
  for (const value of Object.values(stored)) {
    assert.equal(typeof value, "string");
    for (const raw of ["agent_77", "task_5150", "proj_9f2"]) {
      assert.equal(
        String(value).includes(raw),
        false,
        `가명 ${String(value)} 에 원시값 ${raw} 이 남아 있다`
      );
    }
  }
});

test("익명 세계 내부 조인은 유지된다 — 같은 (종류, 원시값) 은 같은 가명", () => {
  // events.agentId ↔ agent_heartbeats.agentId 는 계속 이어져야 한다.
  const event = pseudonymizeAnalyticsRow({ agentId: "agent_77" }, SALT);
  const beat = pseudonymizeAnalyticsRow({ agentId: "agent_77" }, SALT);
  assert.equal(event.agentId, beat.agentId);
  // events.taskId ↔ task_outcomes.taskId 도 마찬가지.
  const outcome = pseudonymizeAnalyticsRow({ taskId: "task_5150" }, SALT);
  const evt2 = pseudonymizeAnalyticsRow({ taskId: "task_5150" }, SALT);
  assert.equal(outcome.taskId, evt2.taskId);
  // 서로 다른 원시값은 서로 다른 가명(고유 카운트 보존).
  const other = pseudonymizeAnalyticsRow({ agentId: "agent_78" }, SALT);
  assert.notEqual(event.agentId, other.agentId);
});

test("종류가 다르면 같은 원시값도 다른 가명이 된다(축 교차 조인 차단)", () => {
  const asAgent = pseudonymizeAnalyticsId("agent", "same-id", SALT);
  const asTask = pseudonymizeAnalyticsId("task", "same-id", SALT);
  const asProject = pseudonymizeAnalyticsId("project", "same-id", SALT);
  assert.notEqual(asAgent, asTask);
  assert.notEqual(asTask, asProject);
  assert.notEqual(asAgent, asProject);
});

test("솔트가 다르면 가명도 다르다 — 솔트가 실제로 키 역할을 한다", () => {
  const a = pseudonymizeAnalyticsId("agent", "agent_77", SALT);
  const b = pseudonymizeAnalyticsId("agent", "agent_77", "another-salt");
  assert.notEqual(a, b);
});

test("★fail-safe: 솔트가 없으면 원시값이 아니라 null 을 적는다", () => {
  const stored = pseudonymizeAnalyticsRow(
    { agentId: "agent_77", taskId: "task_5150", projectId: "proj_9f2" },
    null
  );
  assert.deepEqual(stored, {
    agentId: null,
    taskId: null,
    projectId: null,
  });
  assert.deepEqual(joinableKeys(stored, COST_LOG_ROW), []);
});

test("빈 값의 모양은 그대로 둔다(null 은 null, '' 는 '')", () => {
  const stored = pseudonymizeAnalyticsRow(
    { agentId: "", taskId: null, projectId: undefined },
    SALT
  );
  assert.equal(stored.agentId, "");
  assert.equal(stored.taskId, null);
  assert.equal(stored.projectId, null);
});

test("등재되지 않은 필드는 건드리지 않는다(사본 반환, 입력 불변)", () => {
  const input = {
    event: "agent:spawned",
    model: "claude-opus-5",
    agentId: "a1",
  };
  const stored = pseudonymizeAnalyticsRow(input, SALT);
  assert.equal(stored.event, "agent:spawned");
  assert.equal(stored.model, "claude-opus-5");
  assert.equal(input.agentId, "a1", "입력 row 가 변형됐다");
  assert.notEqual(stored.agentId, "a1");
});

test("가명화 대상 필드 목록은 조인키를 빠짐없이 덮는다", () => {
  // cost_logs 가 보관하는 조인키 + 익명 세계가 쓰는 에이전트/플로우 축.
  for (const field of ["projectId", "agentId", "taskId"]) {
    assert.ok(
      field in ANALYTICS_ID_FIELDS,
      `${field} 가 가명화 대상에서 빠졌다 — cost_logs 와 조인 가능해진다`
    );
  }
});

test("readAnalyticsIdSalt — 미설정/공백은 null, 값은 trim 후 반환", () => {
  assert.equal(readAnalyticsIdSalt({}), null);
  assert.equal(readAnalyticsIdSalt({ ANALYTICS_ID_SALT: "   " }), null);
  assert.equal(
    readAnalyticsIdSalt({ ANALYTICS_ID_SALT: " s3cret " }),
    "s3cret"
  );
});
