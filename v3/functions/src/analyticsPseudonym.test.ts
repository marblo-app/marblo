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
import { createHmac } from "node:crypto";

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

// ── 익명축 kind 추가분 (ticket dTpcKWwRw5DvEMKxpCZi) ─────────────────────────

test("★install/ga/user kind 는 ANALYTICS_ID_FIELDS 에 없다 — 라이브 쓰기 동작 불변", () => {
  // 여기에 올리면 살아 있는 events/agent_heartbeats 쓰기가 바뀌어 기존 분석이
  // 그 시점에 끊긴다. 백필은 pseudonymizeAnalyticsId 를 직접 부른다.
  const kinds = Object.values(ANALYTICS_ID_FIELDS);
  assert.ok(!kinds.includes("install"));
  assert.ok(!kinds.includes("ga"));
  assert.ok(!kinds.includes("user"));
  // userId 는 어느 축에서도 자동 치환 대상이 아니다.
  assert.ok(!("userId" in ANALYTICS_ID_FIELDS));
});

// ── 사람 축 kind 추가분 (ticket cZWmTzoOXpHCg9HAUwqw / 설계 §3, §7) ──────────
//
// ★이 자리에는 원래 "계정축 kind('user')는 이 모듈에 존재하지 않는다" 가 있었다.
//   사람 축 설계(PR #1081 §3.3, §7)가 kind 하나를 추가하기로 확정했으므로 그
//   테스트는 더 이상 참이 아니다. 지우지 않고 **더 센 것으로 바꾼다** — 원래
//   테스트가 지키던 것은 "kind 가 없다" 가 아니라 "익명 테이블이 계정으로 되짚히지
//   않는다" 였고, 그 불변식은 아래 세 테스트 + analyticsProfiles 의
//   FORBIDDEN_ON_ANONYMOUS_AXIS 가 계속 지킨다.

test("★user kind 는 자동 치환 목록에 오르지 않는다 (설계 §3.4 — 익명축 조인 보호)", () => {
  // 익명 세계의 userId 는 계정 uid 가 아니라 **익명 설치 UUID** 다. 이걸 user
  // kind 로 가명화하면 install kind 로 만든 install_key 와 값이 갈려서 익명축
  // 조인이 통째로 끊긴다 — 행은 쌓이고 조인만 0 이 되는 조용한 실패다.
  const row = { userId: "8f14e45f-ceea-467a-9d3f-b0a2f0a1c111", agentId: "a1" };
  const out = pseudonymizeAnalyticsRow(row, SALT);
  assert.equal(out.userId, row.userId, "userId 는 자동 치환되면 안 된다");
  assert.notEqual(out.agentId, row.agentId, "등재된 필드는 치환돼야 한다");
});

test("★user kind 와 install kind 는 같은 원시값에서도 다른 가명 — 두 축은 값이 안 겹친다", () => {
  const asUser = pseudonymizeAnalyticsId("user", "same-id", SALT);
  const asInstall = pseudonymizeAnalyticsId("install", "same-id", SALT);
  assert.notEqual(asUser, asInstall);
  assert.equal(String(asUser).startsWith("us_"), true);
  assert.equal(String(asInstall).startsWith("in_"), true);
});

test("user kind — 결정적 + 솔트 없으면 null(fail-safe), 기존 kind 무회귀", () => {
  assert.equal(
    pseudonymizeAnalyticsId("user", "uid-abc", SALT),
    pseudonymizeAnalyticsId("user", "uid-abc", SALT)
  );
  assert.equal(pseudonymizeAnalyticsId("user", "uid-abc", null), null);
  // ★기존 kind 6종의 출력은 한 글자도 바뀌지 않는다(kind 가 HMAC 입력에 들어가
  //   서로 간섭이 없다). 593행·1,100만행 무회귀의 근거.
  assert.equal(
    pseudonymizeAnalyticsId("agent", "agent_77", SALT),
    "ag_" + createHmac("sha256", SALT)
      .update("agent:agent_77")
      .digest("hex")
      .slice(0, 24)
  );
});

test("★person kind 를 만들지 않았다 — 키는 user_key 하나 (설계 §3.1)", () => {
  // person_key 와 user_key 를 둘 다 두면 WHERE person_key = user_key 가 영원히
  // 0행이 된다. 에러가 아니라 빈 표라서 아무도 못 알아챈다.
  const asRecord = pseudonymizeAnalyticsId as unknown as (
    k: string,
    r: unknown,
    s: string | null
  ) => unknown;
  const out = String(asRecord("person", "some-uid", SALT));
  assert.ok(out.startsWith("undefined_"), `예상 밖 출력: ${out.slice(0, 12)}…`);
});

test("install/ga — 같은 원시값이어도 kind 가 다르면 다른 가명", () => {
  const asInstall = pseudonymizeAnalyticsId("install", "same-id", SALT);
  const asGa = pseudonymizeAnalyticsId("ga", "same-id", SALT);
  const asAgent = pseudonymizeAnalyticsId("agent", "same-id", SALT);
  assert.notEqual(asInstall, asGa);
  assert.notEqual(asInstall, asAgent);
  assert.equal(String(asInstall).startsWith("in_"), true);
  assert.equal(String(asGa).startsWith("ga_"), true);
});

test("install/ga — 결정적(같은 입력 → 같은 가명), 백필 재실행 안전", () => {
  const a = pseudonymizeAnalyticsId("install", "uuid-abc", SALT);
  const b = pseudonymizeAnalyticsId("install", "uuid-abc", SALT);
  assert.equal(a, b);
});

test("install/ga — 솔트 없으면 null (fail-safe, 원시값 폴백 금지)", () => {
  assert.equal(pseudonymizeAnalyticsId("install", "uuid-abc", null), null);
  assert.equal(pseudonymizeAnalyticsId("ga", "123.456", null), null);
});

test("install/ga — 빈 값은 모양 유지(NULL 관례 보존)", () => {
  assert.equal(pseudonymizeAnalyticsId("ga", null, SALT), null);
  assert.equal(pseudonymizeAnalyticsId("ga", "", SALT), "");
});
