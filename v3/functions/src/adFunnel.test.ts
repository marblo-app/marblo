// 광고→ACTIVATED 사다리 + ACTIVATED 단일 정의 단위테스트 (ticket O5JPlh4F).
// node --test 로 돈다 — `npm run test:ad-funnel`.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ACTIVATED_CRITERIA,
  ACTIVATED_DEFINITION_ID,
  ACTIVATED_MIN_TASKS_COMPLETED,
  activatedDefinition,
  activatedSqlPredicate,
  isActivated,
} from "./activatedDefinition";
import {
  ACTIVATED_PROFILE_TABLE,
  AD_FUNNEL_LADDER_COLUMNS,
  AD_FUNNEL_PROFILE_COLUMNS,
  activatedLadderSelectSql,
  activatedProfileSelectSql,
  buildActivatedLadder,
  buildActivatedProfile,
} from "./adFunnel";

// ── 정의: 4개 조건 전부가 필요하다 ──────────────────────────────────────────

const FULL = {
  installed: true,
  projectConnected: true,
  agentConnected: true,
  tasksCompleted: ACTIVATED_MIN_TASKS_COMPLETED,
};

test("isActivated: 4개 조건이 모두 참이고 Task 가 임계 이상이면 활성화", () => {
  assert.equal(isActivated(FULL), true);
});

test("isActivated: 임계 미만 Task 는 활성화가 아니다(경계값)", () => {
  assert.equal(
    isActivated({ ...FULL, tasksCompleted: ACTIVATED_MIN_TASKS_COMPLETED - 1 }),
    false
  );
  assert.equal(
    isActivated({ ...FULL, tasksCompleted: ACTIVATED_MIN_TASKS_COMPLETED + 1 }),
    true
  );
});

test("isActivated: 조건 하나만 빠져도 활성화가 아니다", () => {
  assert.equal(isActivated({ ...FULL, installed: false }), false);
  assert.equal(isActivated({ ...FULL, projectConnected: false }), false);
  assert.equal(isActivated({ ...FULL, agentConnected: false }), false);
});

test("isActivated: NaN Task 수는 활성화가 아니다(0 으로 둔갑 금지)", () => {
  assert.equal(isActivated({ ...FULL, tasksCompleted: Number.NaN }), false);
});

test("정의문은 4개 조건과 임계값을 그대로 싣는다", () => {
  const d = activatedDefinition();
  assert.equal(d.id, ACTIVATED_DEFINITION_ID);
  assert.equal(d.minTasksCompleted, ACTIVATED_MIN_TASKS_COMPLETED);
  assert.equal(d.axis, "install");
  assert.equal(d.criteria.length, 4);
  assert.deepEqual(
    d.criteria.map((c) => c.key),
    ACTIVATED_CRITERIA.map((c) => c.key)
  );
  // ★축 라벨이 "명" 이라고 말하지 않는다 — 설치 축임을 화면이 밝혀야 한다.
  assert.match(d.axisLabel, /설치 축/);
  assert.match(d.axisNote, /설치 축/);
});

test("축은 파라미터다 — 정의는 그대로고 라벨만 바뀐다", () => {
  const person = activatedDefinition("person");
  assert.equal(person.axis, "person");
  assert.equal(person.minTasksCompleted, ACTIVATED_MIN_TASKS_COMPLETED);
  assert.match(person.axisLabel, /사람 축/);
});

// ── SQL: 임계값을 손으로 적지 않는다 ────────────────────────────────────────

test("activatedSqlPredicate 는 임계값을 상수에서 넣는다", () => {
  const sql = activatedSqlPredicate({
    installed: "a",
    projectConnected: "b",
    agentConnected: "c",
    tasksCompleted: "n",
  });
  assert.equal(
    sql,
    `(a) AND (b) AND (c) AND (n) >= ${ACTIVATED_MIN_TASKS_COMPLETED}`
  );
});

test("사다리 SELECT 는 7칸을 모두 만들고 새 이벤트를 스캔하지 않는다", () => {
  const sql = activatedLadderSelectSql();
  for (const col of Object.values(AD_FUNNEL_LADDER_COLUMNS)) {
    assert.ok(sql.includes(`AS ${col}`), `${col} 누락`);
  }
  // ★marks CTE 에 이미 있는 컬럼만 참조한다. 새 이벤트명이 SQL 에 등장하면
  //   스캔이 늘어난 것이고, 그건 잔존율을 조용히 올리는 그 함정이다.
  assert.equal(/'[a-z]+:[a-z_]+'/.test(sql), false);
  assert.ok(sql.includes(`>= ${ACTIVATED_MIN_TASKS_COMPLETED}`));
});

// ── 사다리 조립 ─────────────────────────────────────────────────────────────

const ROW = {
  c_install: 40,
  c_login_success: 30,
  c_project_connected: 20,
  c_agent_spawned: 12,
  c_task_completed_1: 8,
  c_task_completed_min: 5,
  c_activated: 5,
};

test("사다리: 7칸 순서와 전환율", () => {
  const l = buildActivatedLadder(ROW);
  assert.deepEqual(
    l.steps.map((s) => s.key),
    [
      "install",
      "login_success",
      "project_connected",
      "agent_spawned",
      "task_completed_1",
      "task_completed_min",
      "activated",
    ]
  );
  assert.equal(l.steps[0].conversionFromPrev, null); // 첫 칸엔 직전이 없다
  assert.equal(l.steps[1].conversionFromPrev, 30 / 40);
  assert.equal(l.activatedUnits, 5);
  assert.equal(l.installUnits, 40);
});

test("사다리: BQ 가 int64 를 문자열로 줘도 숫자로 읽는다", () => {
  const l = buildActivatedLadder({ ...ROW, c_install: "40", c_activated: "5" });
  assert.equal(l.installUnits, 40);
  assert.equal(l.activatedUnits, 5);
});

test("★빈 데이터: 전 칸 0 이고 전환율은 0% 가 아니라 null 이다", () => {
  const l = buildActivatedLadder(undefined);
  assert.equal(l.steps.length, 7);
  assert.ok(l.steps.every((s) => s.units === 0));
  // 분모 0 → null. 0% 로 그리면 "전원 이탈"이라는 없는 사실이 생긴다.
  assert.ok(l.steps.every((s) => s.conversionFromPrev === null));
  assert.equal(l.activatedUnits, 0);
});

test("★분모 0: 상위 칸이 0 이면 하위 전환율은 null", () => {
  const l = buildActivatedLadder({ ...ROW, c_install: 0 });
  assert.equal(l.steps[1].conversionFromPrev, null);
});

test("★계측 공백: 분자가 분모보다 크면 깎지 않고 플래그를 세운다", () => {
  const l = buildActivatedLadder({ ...ROW, c_login_success: 50 });
  const login = l.steps[1];
  assert.equal(login.units, 50); // 50 을 40 으로 깎지 않는다
  assert.equal(login.exceedsPrev, true);
  assert.ok(l.notes.some((n) => n.includes("직전 칸보다 큽니다")));
});

test("ACTIVATED 와 3 Tasks 가 다르면 그 차이를 note 로 밝힌다", () => {
  const same = buildActivatedLadder(ROW);
  assert.equal(
    same.notes.some((n) => n.includes("ACTIVATED")),
    false
  );
  const diff = buildActivatedLadder({ ...ROW, c_task_completed_min: 7 });
  assert.ok(diff.notes.some((n) => n.includes("ACTIVATED")));
});

test("사다리는 정의문을 그대로 실어 보낸다(화면이 지어내지 않게)", () => {
  const l = buildActivatedLadder(ROW);
  assert.equal(l.definition.minTasksCompleted, ACTIVATED_MIN_TASKS_COMPLETED);
  assert.match(l.definition.derivationNote, /새 이벤트 없이/);
});

// ── ★교차 확인 소스(analytics_install_profile) ──────────────────────────────

const PROFILE_ROW = {
  p_install: 659,
  p_agent: 18,
  p_task_min: 5,
  p_activated: 5,
};

test("교차 확인 SQL 은 임계값을 상수에서 넣고 events 를 스캔하지 않는다", () => {
  const sql = activatedProfileSelectSql();
  for (const col of Object.values(AD_FUNNEL_PROFILE_COLUMNS)) {
    assert.ok(sql.includes(`AS ${col}`), `${col} 누락`);
  }
  assert.ok(sql.includes(`>= ${ACTIVATED_MIN_TASKS_COMPLETED}`));
  // events 테이블을 참조하면 스캔이 두 배가 된다 — 이 소스는 파생 테이블만 읽는다.
  assert.equal(sql.includes("events"), false);
  assert.equal(ACTIVATED_PROFILE_TABLE, "analytics_install_profile");
});

test("교차 확인: 프로필 행을 읽고 '프로젝트 조건은 추론' 임을 밝힌다", () => {
  const p = buildActivatedProfile(PROFILE_ROW);
  assert.ok(p);
  assert.equal(p.activatedUnits, 5);
  assert.equal(p.installUnits, 659);
  assert.equal(p.projectConditionInferred, true);
  assert.match(p.note, /추론/);
});

test("★교차 확인 쿼리가 실패하면 0 이 아니라 null 이다", () => {
  assert.equal(buildActivatedProfile(null), null);
  assert.equal(buildActivatedProfile(undefined), null);
  const l = buildActivatedLadder(ROW, "install", null);
  assert.equal(l.profile, null);
});

test("★두 소스의 ACTIVATED 가 다르면 한쪽을 지우지 않고 note 로 밝힌다", () => {
  const l = buildActivatedLadder(ROW, "install", PROFILE_ROW);
  assert.equal(l.activatedUnits, 5); // events 축
  assert.equal(l.profile?.activatedUnits, 5); // 프로필 축 — 같으면 note 없음
  assert.equal(
    l.notes.some((n) => n.includes("소스마다 ACTIVATED")),
    false
  );

  const diff = buildActivatedLadder({ ...ROW, c_activated: 2 }, "install", PROFILE_ROW);
  assert.equal(diff.activatedUnits, 2);
  assert.equal(diff.profile?.activatedUnits, 5);
  const note = diff.notes.find((n) => n.includes("소스마다 ACTIVATED"));
  assert.ok(note, "두 소스가 다른데 note 가 없다");
  assert.ok(note.includes("2") && note.includes("5"));
});

test("교차 확인도 문자열 int64 를 숫자로 읽는다", () => {
  const p = buildActivatedProfile({ ...PROFILE_ROW, p_activated: "5" });
  assert.equal(p?.activatedUnits, 5);
});
