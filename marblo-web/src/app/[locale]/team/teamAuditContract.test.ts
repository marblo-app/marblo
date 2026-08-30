/**
 * 감사 봉투 계약 테스트 (설계 §12).
 *
 * 감사에서 가장 나쁜 실패는 **조용한 누락**이다. 그래서 여기서 보는 것은
 * "함수가 돈다" 가 아니라: 결측이 0 으로 접히지 않나 · 페이징이 행을 건너뛰거나
 * 중복시키지 않나 · 가명 공간 밖 값이 통과하지 않나 · 커서 없이 더 보기를
 * 켜지 않나.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendEvents,
  formatCount,
  formatEventTime,
  isAuditEmpty,
  isAuditPartial,
  isAuditRenderable,
  isTeamMemberKey,
  memberChipLabel,
  nextCursorOf,
  normalizeTeamAudit,
  resolveAuditReason,
  resolveCodedLine,
  agentLabelOf,
  derivedCounts,
} from "./teamAuditContract";

// ── 결측을 0 으로 만들지 않는다 ─────────────────────────────────────────────

test("빈 응답도 던지지 않고, 봉투는 null 로 남는다(사건 0건이 아니다)", () => {
  const env = normalizeTeamAudit(undefined);
  assert.equal(env.teamAudit, null);
  assert.equal(env.summary, null);
  assert.deepEqual(env.events, []);
  assert.deepEqual(env.withheld, []);
  assert.equal(isAuditRenderable(env), false);
  assert.equal(isAuditEmpty(env), true);
});

test("요약 결측은 0 이 아니라 null 이고, 화면 문구로 '모름' 이 된다", () => {
  const env = normalizeTeamAudit({ summary: { tasksOpen: 3 } });
  assert.equal(env.summary?.tasksOpen, 3);
  assert.equal(env.summary?.tasksDone, null);
  assert.equal(env.summary?.eventsInWindow, null);
  assert.equal(formatCount(null, "ko", "모름"), "모름");
  assert.equal(formatCount(0, "ko", "모름"), "0");
});

test("머지 크기 결측도 0 으로 접지 않는다 — 0줄 변경과 다른 사실이다", () => {
  const env = normalizeTeamAudit({
    events: [
      {
        id: "merge:1",
        kind: "merge",
        action: "merge_history",
        merge: { branch: "main", prNumber: 7 },
      },
    ],
  });
  const m = env.events[0].merge;
  assert.equal(m?.prNumber, 7);
  assert.equal(m?.filesChanged, null);
  assert.equal(m?.linesAdded, null);
});

test("모르는 state·reasonCode·kind 는 인정하지 않는다", () => {
  const env = normalizeTeamAudit({
    teamAudit: { state: "kinda", basis: "project_event_ledger" },
    events: [{ id: "x", kind: "tool_call" }],
  });
  assert.equal(env.teamAudit, null);
  // 허용목록 밖 분류는 그리지 않는다 — 서버의 fail-closed 와 같은 방향.
  assert.deepEqual(env.events, []);
});

test("reasonCode 가 enum 밖이면 코드로 인정하지 않고 산문 폴백으로 간다", () => {
  const env = normalizeTeamAudit({
    teamAudit: {
      state: "disabled",
      reasonCode: "made_up",
      reason: "서버 산문",
      basis: "project_event_ledger",
    },
  });
  assert.equal(env.teamAudit?.reasonCode, null);
  assert.equal(env.teamAudit?.reason, "서버 산문");
  assert.equal(
    resolveAuditReason(
      env.teamAudit?.reasonCode ?? null,
      "서버 산문",
      {},
      "폴백"
    ),
    "서버 산문"
  );
});

// ── ★프라이버시 ────────────────────────────────────────────────────────────

test("가명 공간 밖 memberKey 는 통과하지 못하고 null 이 된다", () => {
  const env = normalizeTeamAudit({
    events: [
      { id: "a", kind: "merge", memberKey: "us_abcd1234" },
      { id: "b", kind: "merge", memberKey: "aB3xY7zQ1mN5pR8sT2vW4uK6" },
      { id: "c", kind: "merge", memberKey: "tm_abcd1234" },
    ],
  });
  assert.equal(env.events[0].memberKey, null);
  assert.equal(env.events[1].memberKey, null);
  assert.equal(env.events[2].memberKey, "tm_abcd1234");
  assert.equal(isTeamMemberKey("us_abcd1234"), false);
});

test("★'가려짐' 과 '없음' 은 다른 상태다 — 같은 칸으로 접지 않는다", () => {
  // 에이전트 이름은 사람이 자유롭게 짓는다. 자기 이메일로 이름 지으면 키만 보는
  // 검사기는 통과한다 — 서버가 값 수준에서 막고, 여기가 이중 방어다.
  assert.deepEqual(agentLabelOf("john.kim@hypemarc.com"), { kind: "redacted" });
  assert.deepEqual(agentLabelOf("aB3xY7zQ1mN5pR8sT2vW4uK6xYz1"), {
    kind: "redacted",
  });
  // 서버가 이미 가린 자리표시도 '가려짐' 이다 — 값으로 그리지 않는다.
  assert.deepEqual(agentLabelOf("(가려짐)"), { kind: "redacted" });
  // ★값이 없는 것은 '없음' 이다. 가린 것과 다른 사실이다.
  assert.deepEqual(agentLabelOf(null), { kind: "absent" });
  assert.deepEqual(agentLabelOf(""), { kind: "absent" });
});

test("정상 에이전트 이름을 과잉 차단하지 않는다", () => {
  // 과잉 차단하면 감사 피드가 통째로 '가려짐' 이 되어 못 쓰게 된다.
  for (const ok of [
    "backend-claude-1h50",
    "orchestrator-claude-p1",
    "프론트-2",
    "backend-1",
  ]) {
    assert.deepEqual(agentLabelOf(ok), { kind: "value", value: ok }, ok);
  }
});

test("식별자가 가려져도 에이전트 행을 버리지 않는다", () => {
  const env = normalizeTeamAudit({
    workload: [
      { agentId: "john.kim@hypemarc.com", name: null, openTasks: 1, doneTasks: 0 },
    ],
  });
  // 행을 버리면 그게 감사에서 가장 나쁜 실패(조용한 누락)다.
  assert.equal(env.workload.length, 1);
  assert.deepEqual(env.workload[0].agentId, { kind: "redacted" });
  assert.deepEqual(env.workload[0].name, { kind: "absent" });
});

test("가명 칩은 키 전체를 뿌리지 않는다", () => {
  const label = memberChipLabel("tm_abcdef1234567890");
  assert.equal(label, "abcdef");
  assert.ok(label !== null && !label.startsWith("tm_"));
  // ★null 은 정상이다 — merge_history 에 행위자 필드가 없다(§12.7).
  assert.equal(memberChipLabel(null), null);
});

// ── ★페이징 — 건너뛰지도 중복시키지도 않는다 ────────────────────────────────

test("hasMore 만 있고 커서가 없으면 더 보기를 켜지 않는다", () => {
  const env = normalizeTeamAudit({
    page: { limit: 50, returned: 50, hasMore: true, nextCursor: null },
  });
  // 켜면 같은 인자로 1페이지를 무한히 다시 부른다.
  assert.equal(nextCursorOf(env), null);
});

test("커서가 있고 hasMore 면 그 값을 그대로 넘긴다 (가공 금지)", () => {
  const env = normalizeTeamAudit({
    page: { hasMore: true, nextCursor: "eyJhdCI6MSwiaWQiOiJ4In0" },
  });
  assert.equal(nextCursorOf(env), "eyJhdCI6MSwiaWQiOiJ4In0");
});

test("hasMore 가 false 면 끝이다", () => {
  const env = normalizeTeamAudit({
    page: { hasMore: false, nextCursor: "still-here" },
  });
  assert.equal(nextCursorOf(env), null);
});

test("페이지 이어붙이기는 중복 id 를 버리고 순서를 뒤집지 않는다", () => {
  const p1 = normalizeTeamAudit({
    events: [
      { id: "a", kind: "merge" },
      { id: "b", kind: "merge" },
    ],
  }).events;
  const p2 = normalizeTeamAudit({
    events: [
      { id: "b", kind: "merge" },
      { id: "c", kind: "merge" },
    ],
  }).events;
  const merged = appendEvents(p1, p2);
  assert.deepEqual(
    merged.map((e) => e.id),
    ["a", "b", "c"]
  );
});

// ── 상태 판정 ───────────────────────────────────────────────────────────────

test("disabled 는 그리지 않고, empty 는 그리되 비어 있다", () => {
  const disabled = normalizeTeamAudit({
    teamAudit: { state: "disabled", basis: "project_event_ledger" },
  });
  assert.equal(isAuditRenderable(disabled), false);

  const empty = normalizeTeamAudit({
    teamAudit: { state: "empty", basis: "project_event_ledger" },
  });
  assert.equal(isAuditRenderable(empty), true);
  assert.equal(isAuditEmpty(empty), true);
});

test("partial 은 목록을 그리되 '전부가 아니다' 로 표시된다", () => {
  const env = normalizeTeamAudit({
    teamAudit: {
      state: "partial",
      reasonCode: "partial_sources",
      basis: "project_event_ledger",
    },
    events: [{ id: "a", kind: "merge" }],
  });
  assert.equal(isAuditPartial(env), true);
  assert.equal(isAuditEmpty(env), false);
});

test("role 이 없으면 null 이다 — 없는 역할을 발명하지 않는다", () => {
  const env = normalizeTeamAudit({
    teamAudit: {
      state: "disabled",
      role: "none",
      basis: "project_event_ledger",
    },
  });
  assert.equal(env.teamAudit?.role, null);
});

// ── withheld / notes ────────────────────────────────────────────────────────

test("withheld·notes 는 {code,text} 로 접히고 순서를 지킨다", () => {
  const env = normalizeTeamAudit({
    withheld: [
      { code: "withheld_money", text: "금액·토큰 수치 전부" },
      { code: null, text: "" },
      null,
      42,
      { code: "withheld_raw_identity", text: "원시 uid" },
    ],
    notes: [{ code: "note_read_only", text: "읽기 전용이다" }],
  });
  assert.deepEqual(
    env.withheld.map((l) => l.code),
    ["withheld_money", "withheld_raw_identity"]
  );
  assert.equal(env.notes[0].code, "note_read_only");
});

test("코드 없는 옛 모양(맨 문자열)도 버리지 않는다", () => {
  // ★계약은 {code,text} 지만 배포가 뒤처진 환경이 있을 수 있다. 그때 목록이
  //   통째로 사라지면 화면이 "숨긴 것이 없다" 고 말하는 셈이 된다.
  const env = normalizeTeamAudit({ withheld: ["옛 줄", ""] });
  assert.deepEqual(env.withheld, [{ code: null, text: "옛 줄" }]);
});

test("코드만 오고 문장이 없어도 버리지 않는다 (사전이 채운다)", () => {
  const env = normalizeTeamAudit({ notes: [{ code: "note_read_only" }] });
  assert.equal(env.notes.length, 1);
  assert.equal(
    resolveCodedLine(env.notes[0], { note_read_only: "읽기 전용입니다" }),
    "읽기 전용입니다"
  );
});

test("코드가 사전에 없으면 서버 문장으로 떨어진다 (빈칸 아님)", () => {
  const line = { code: "brand_new_code", text: "서버가 준 문장" };
  assert.equal(resolveCodedLine(line, {}), "서버가 준 문장");
});

// ── ★summary ↔ 목록 불변식 ─────────────────────────────────────────────────

test("목록이 뒷받침하는 카운트는 목록에서 센다", () => {
  const env = normalizeTeamAudit({
    attention: [
      { id: "a", attention: { severity: "critical", kinds: [], idleMs: null } },
      { id: "b", attention: { severity: "warning", kinds: [], idleMs: null } },
    ],
    workload: [
      { agentId: "a1", openTasks: 0, doneTasks: 0 },
      { agentId: "a2", openTasks: 0, doneTasks: 0 },
      { agentId: "a3", openTasks: 0, doneTasks: 0 },
    ],
  });
  assert.deepEqual(derivedCounts(env), {
    attention: 2,
    critical: 1,
    agents: 3,
  });
});

test("서버 카운트가 목록과 어긋나도 화면이 세는 값은 목록 기준이다", () => {
  // ★"주의 3건" 이라 써 놓고 2건만 보이는 화면을 막는다. 서버가 불변식을 깨도
  //   화면은 스스로와 모순되지 않는다.
  const env = normalizeTeamAudit({
    summary: { attentionCount: 3, criticalCount: 3, agentsTotal: 9 },
    attention: [
      { id: "a", attention: { severity: "critical", kinds: [], idleMs: null } },
    ],
    workload: [{ agentId: "a1", openTasks: 0, doneTasks: 0 }],
  });
  assert.equal(env.summary?.attentionCount, 3);
  assert.deepEqual(derivedCounts(env), {
    attention: 1,
    critical: 1,
    agents: 1,
  });
});

test("★대조하면 안 되는 짝 — 창 기준과 페이지는 **일부러** 다르다", () => {
  // 이 둘이 다른 것은 버그가 아니다. 여기 적어 두지 않으면 다음 사람이
  // "숫자가 안 맞네" 하고 틀린 짝을 대조해 오경보를 만든다.
  const env = normalizeTeamAudit({
    summary: { eventsInWindow: 120, tasksTotal: 40 },
    page: { limit: 50, returned: 2, hasMore: true, nextCursor: "c" },
    events: [
      { id: "e1", kind: "merge" },
      { id: "e2", kind: "merge" },
    ],
  });
  assert.equal(env.summary?.eventsInWindow, 120); // 창 기준
  assert.equal(env.events.length, 2); // 한 페이지
  assert.notEqual(env.summary?.eventsInWindow, env.events.length);
  // `tasksTotal` 도 삭제된 티켓을 뺀 값이라 목록 길이와 다를 수 있다.
  assert.equal(env.summary?.tasksTotal, 40);
});

test("mergesTotal 은 계약에서 빠졌다 — 실려 와도 봉투에 남지 않는다", () => {
  // ★머지 타일은 `eventsByKind.merge` 로만 그린다. self 스코프에서 머지 행위자가
  //   없어 피드에서 전부 빠지는데, 프로젝트 전체 머지 수를 타일에 그리면
  //   "머지 12건" 이라 써 놓고 피드엔 0건인 화면이 된다.
  const env = normalizeTeamAudit({
    summary: { mergesTotal: 12, eventsByKind: { merge: 0 } },
  });
  assert.ok(!JSON.stringify(env.summary).includes("mergesTotal"));
  assert.equal(env.summary?.eventsByKind.merge, 0);
});

// ── ★판정 기준값(criteria) ─────────────────────────────────────────────────

test("criteria 는 없을 수도 있다 — 없으면 null 이지 0 이 아니다", () => {
  assert.equal(normalizeTeamAudit({}).criteria, null);
  assert.equal(
    normalizeTeamAudit({ criteria: { stalledAfterHours: 6 } }).criteria
      ?.stalledAfterHours,
    6
  );
});

test("0 이하·비수치 기준은 값으로 인정하지 않는다", () => {
  // 인정하면 화면이 "0시간 동안" 이라고 쓴다 — 문장이 참이 아니게 된다.
  for (const bad of [0, -1, Number.NaN, "6", null]) {
    const env = normalizeTeamAudit({ criteria: { stalledAfterHours: bad } });
    assert.equal(env.criteria?.stalledAfterHours, null, String(bad));
  }
});

// ── ★금액이 이 봉투에 없다 ──────────────────────────────────────────────────

test("서버가 실수로 금액을 실어도 정규화가 걸러 낸다", () => {
  const env = normalizeTeamAudit({
    workload: [{ agentId: "a1", openTasks: 1, doneTasks: 2, totalCost: 99.5 }],
    events: [{ id: "e", kind: "merge", costUsd: 12.3 }],
  });
  const asJson = JSON.stringify(env);
  // 감사 탭에 금액이 들어오면 사용량 게이트가 이 탭 경유로 우회된다(§12.4).
  assert.ok(!asJson.includes("totalCost"));
  assert.ok(!asJson.includes("costUsd"));
  assert.ok(!asJson.includes("99.5"));
  assert.ok(!asJson.includes("12.3"));
});

test("사건에 자유 텍스트 필드가 새어 들어오지 않는다", () => {
  const env = normalizeTeamAudit({
    events: [
      {
        id: "e",
        kind: "task_transition",
        params: { token: "secret" },
        result: "file contents",
        message: "activity body",
        instructionRedacted: "prompt",
      },
    ],
  });
  const asJson = JSON.stringify(env);
  for (const leaked of ["secret", "file contents", "activity body", "prompt"]) {
    assert.ok(!asJson.includes(leaked), `${leaked} 가 새면 안 된다`);
  }
});

// ── 시각 ────────────────────────────────────────────────────────────────────

test("시각을 못 읽은 행은 버리지 않고 '모름' 으로 남는다", () => {
  assert.equal(formatEventTime(null, "ko", "모름"), "모름");
  assert.equal(formatEventTime("nope", "ko", "모름"), "모름");
  assert.notEqual(
    formatEventTime("2026-08-21T09:00:00.000Z", "ko", "모름"),
    "모름"
  );
});

test("프로토타입 오염된 사유 코드로 사전을 뚫지 못한다", () => {
  assert.equal(resolveAuditReason(null, null, {}, "폴백"), "폴백");
});

// ── ★성공/실패 — 계정 축(티켓 원장)의 FAILED 만 센다 ─────────────────────────
//
// `task_outcomes.success`(익명 축) 는 이 화면으로 오지 않는다 — 축 가드가 막는
// 조인이다. 그래서 여기서 보는 성공/실패는 **티켓 상태**이고, 그 값은 서버
// `summary.tasksByStatus` 에서만 온다.

test("tasksByStatus.FAILED 가 tasksFailed 로 들어온다", () => {
  const env = normalizeTeamAudit({
    summary: { tasksByStatus: { DONE: 5, FAILED: 2, TODO: 1 } },
  });
  assert.equal(env.summary?.tasksFailed, 2);
});

test("tasksByStatus 가 없으면 tasksFailed 는 0 이 아니라 null(모름)", () => {
  const env = normalizeTeamAudit({ summary: { tasksDone: 5 } });
  assert.equal(env.summary?.tasksFailed, null);
});

test("tasksByStatus 는 있는데 FAILED 가 숫자가 아니면 null 로 접는다", () => {
  const env = normalizeTeamAudit({
    summary: { tasksByStatus: { FAILED: "2" } },
  });
  assert.equal(env.summary?.tasksFailed, null);
});

test("FAILED: 0 은 실제 0 이다(결측과 갈린다)", () => {
  const env = normalizeTeamAudit({
    summary: { tasksByStatus: { DONE: 3, FAILED: 0 } },
  });
  assert.equal(env.summary?.tasksFailed, 0);
});
