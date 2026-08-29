// personAxisStamp 순수 로직 단위테스트 (personAxis.test.ts 규약).
// 실행:
//   cd v3/functions && npm run test:person-axis-stamp
//
// ★이 파일이 지키는 것 여섯:
//   1) 게이트가 **둘 다** 열려야 각인한다(배포 게이트 + 방침 게이트).
//   2) 각인이 없으면 컬럼을 **아예 넣지 않는다** — ALTER 전 배포가 안전하다.
//   3) 솔트가 없으면 원시 uid 폴백이 아니라 각인 없음이다.
//   4) 각인 값은 링크표/`analytics_purchase` 의 `user_key` 와 **한 글자도 같다.**
//   5) SQL 본문에 원시 uid 도 솔트도 없다.
//   6) 삭제는 DELETE 가 아니라 SET NULL 이다 — 사실이 아니라 연결을 지운다.
import test from "node:test";
import assert from "node:assert/strict";

import { pseudonymizeAnalyticsId } from "./analyticsPseudonym";
import { resolvePersonAxisGate } from "./personAxis";
import {
  EVENTS_PERSON_STAMP_FROM_ENV,
  EVENT_USER_KEY_FIELD,
  EVENT_USER_KEY_FIELD_SCHEMA,
  applyEventUserKeyStamp,
  buildEventStampBoundarySql,
  buildEventStampEraseOutsideBufferSql,
  buildEventStampEraseSql,
  buildEventUserKeyAlterSql,
  buildPersonErasePlan,
  EVENT_STAMP_ERASE_BUFFER_MINUTES,
  planEventUserKeyStamp,
  resolveEventStampGate,
  summarizeEventStampCoverage,
} from "./personAxisStamp";

const SALT = "test-salt-do-not-use-in-prod";
const UID = "abcdefghijklmnopqrstuvwx1234";
const PROJECT = "marblo-test";
const DATASET = "marblo_telemetry";
const TABLE = "events";

const OPEN_PERSON_GATE = resolvePersonAxisGate({
  PERSON_AXIS_EFFECTIVE_FROM: "2026-04-01",
});
const CLOSED_PERSON_GATE = resolvePersonAxisGate({});
const ON_STAMP_GATE = resolveEventStampGate({
  [EVENTS_PERSON_STAMP_FROM_ENV]: "2026-08-29",
});
const OFF_STAMP_GATE = resolveEventStampGate({});

// ═══════════════════════════════════════════════════════════════════════════
// 1) 배포 게이트 — 꺼짐이 기본이고, 꺼짐은 정상 상태다
// ═══════════════════════════════════════════════════════════════════════════

test("★unset 이면 꺼진다 — 던지지 않고 사유를 들고 다닌다", () => {
  const gate = resolveEventStampGate({});
  assert.equal(gate.on, false);
  assert.equal(gate.reasonCode, "unset");
  assert.ok(gate.reason && gate.reason.length > 0);
  assert.equal(gate.stampFrom, null);
});

test("★잘못된 날짜는 켜지 않는다 — 잘못된 경계로 켜는 것보다 꺼진 편이 안전하다", () => {
  for (const bad of ["2026-13-01", "2026-02-31", "20260829", "어제", " "]) {
    const gate = resolveEventStampGate({
      [EVENTS_PERSON_STAMP_FROM_ENV]: bad,
    });
    assert.equal(gate.on, false, `${bad} 가 게이트를 열었다`);
    if (bad.trim() === "") assert.equal(gate.reasonCode, "unset");
    else assert.equal(gate.reasonCode, "invalid");
  }
});

test("올바른 날짜면 켜진다", () => {
  assert.equal(ON_STAMP_GATE.on, true);
  assert.equal(ON_STAMP_GATE.stampFrom, "2026-08-29");
});

// ═══════════════════════════════════════════════════════════════════════════
// 2) 각인 판정 — 게이트 둘, 솔트 하나, uid 하나
// ═══════════════════════════════════════════════════════════════════════════

test("★게이트가 둘 다 열려야 각인한다", () => {
  const cases: Array<[typeof ON_STAMP_GATE, typeof OPEN_PERSON_GATE, string]> = [
    [OFF_STAMP_GATE, OPEN_PERSON_GATE, "stamp_gate_off"],
    [ON_STAMP_GATE, CLOSED_PERSON_GATE, "person_gate_closed"],
    [OFF_STAMP_GATE, CLOSED_PERSON_GATE, "stamp_gate_off"],
  ];
  for (const [stampGate, personGate, reason] of cases) {
    const plan = planEventUserKeyStamp({
      uid: UID,
      salt: SALT,
      personGate,
      stampGate,
    });
    assert.equal(plan.stamped, false);
    assert.equal(plan.stamped === false && plan.reason, reason);
  }
});

test("★배포 게이트가 방침 게이트보다 먼저 판정된다 — 컬럼이 없으면 방침은 무의미하다", () => {
  const plan = planEventUserKeyStamp({
    uid: UID,
    salt: SALT,
    personGate: CLOSED_PERSON_GATE,
    stampGate: OFF_STAMP_GATE,
  });
  assert.equal(plan.stamped === false && plan.reason, "stamp_gate_off");
});

test("★솔트가 없으면 원시 uid 폴백이 아니라 각인 없음이다", () => {
  const plan = planEventUserKeyStamp({
    uid: UID,
    salt: null,
    personGate: OPEN_PERSON_GATE,
    stampGate: ON_STAMP_GATE,
  });
  assert.equal(plan.stamped, false);
  assert.equal(plan.stamped === false && plan.reason, "no_salt");
});

test("uid 가 없거나 문자열이 아니면 각인하지 않는다", () => {
  for (const uid of ["", "   ", null, undefined, 42, {}]) {
    const plan = planEventUserKeyStamp({
      uid,
      salt: SALT,
      personGate: OPEN_PERSON_GATE,
      stampGate: ON_STAMP_GATE,
    });
    assert.equal(plan.stamped, false, `${String(uid)} 가 각인됐다`);
    assert.equal(plan.stamped === false && plan.reason, "no_uid");
  }
});

test("★각인 값은 링크표·analytics_purchase 의 user_key 와 한 글자도 같다", () => {
  const plan = planEventUserKeyStamp({
    uid: UID,
    salt: SALT,
    personGate: OPEN_PERSON_GATE,
    stampGate: ON_STAMP_GATE,
  });
  assert.equal(plan.stamped, true);
  const expected = pseudonymizeAnalyticsId("user", UID, SALT);
  assert.equal(plan.stamped === true && plan.userKey, expected);
  // 같은 kind·같은 솔트가 아니면 조인이 에러 없이 0행이 된다(설계 §3.1).
  assert.match(String(expected), /^us_[0-9a-f]{24}$/);
});

test("★가명은 되돌릴 수 없다 — 원시 uid 가 값 어디에도 없다", () => {
  const plan = planEventUserKeyStamp({
    uid: UID,
    salt: SALT,
    personGate: OPEN_PERSON_GATE,
    stampGate: ON_STAMP_GATE,
  });
  assert.equal(plan.stamped, true);
  if (plan.stamped) assert.ok(!plan.userKey.includes(UID));
});

// ═══════════════════════════════════════════════════════════════════════════
// 3) 행에 얹기 — 각인이 없으면 컬럼을 아예 넣지 않는다
// ═══════════════════════════════════════════════════════════════════════════

test("★각인이 없으면 컬럼 자체가 없다 — ALTER 전 배포가 안전한 근거", () => {
  const row = { event: "task:completed", userId: "install-uuid" };
  const out = applyEventUserKeyStamp(row, {
    stamped: false,
    reason: "stamp_gate_off",
  });
  assert.ok(!(EVENT_USER_KEY_FIELD in out));
  // null 을 명시적으로 넣지도 않는다 — 넣으면 존재하지 않는 컬럼을 언급하게 된다.
  assert.deepEqual(out, row);
});

test("각인이 있으면 컬럼 하나만 더해지고 나머지는 그대로다", () => {
  const row: Record<string, unknown> = {
    event: "task:completed",
    userId: "install-uuid",
    cost: null,
  };
  const out = applyEventUserKeyStamp(row, {
    stamped: true,
    userKey: "us_deadbeefdeadbeefdeadbeef",
  });
  assert.equal(out[EVENT_USER_KEY_FIELD], "us_deadbeefdeadbeefdeadbeef");
  assert.equal(out.event, row.event);
  assert.equal(out.userId, row.userId);
  assert.equal(out.cost, null);
  // 입력을 변형하지 않는다(pseudonymizeAnalyticsRow 와 같은 규약).
  assert.ok(!(EVENT_USER_KEY_FIELD in row));
});

// ═══════════════════════════════════════════════════════════════════════════
// 4) 컬럼 이름·스키마 — 한 번 만들면 못 지운다
// ═══════════════════════════════════════════════════════════════════════════

test("★컬럼은 NULLABLE 이다 — REQUIRED 면 미인증 경로·과거 행·삭제요청이 전부 막힌다", () => {
  assert.equal(EVENT_USER_KEY_FIELD_SCHEMA.mode, "NULLABLE");
  assert.equal(EVENT_USER_KEY_FIELD_SCHEMA.name, EVENT_USER_KEY_FIELD);
  assert.equal(EVENT_USER_KEY_FIELD_SCHEMA.type, "STRING");
});

test("★컬럼 이름은 events 의 camelCase 규약을 따른다", () => {
  assert.equal(EVENT_USER_KEY_FIELD, "userKey");
});

test("ALTER 는 IF NOT EXISTS 라 여러 번 돌려도 안전하다", () => {
  const sql = buildEventUserKeyAlterSql(PROJECT, DATASET, TABLE);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS userKey STRING/);
  assert.match(sql, /ALTER TABLE `marblo-test\.marblo_telemetry\.events`/);
});

// ═══════════════════════════════════════════════════════════════════════════
// 5) 전환 시점은 **데이터에서** 읽는다
// ═══════════════════════════════════════════════════════════════════════════

test("★경계 SQL 본문에 원시 uid 도 솔트도 없다 — BQ 는 쿼리를 수개월 보관한다", () => {
  const sql = buildEventStampBoundarySql(PROJECT, DATASET, TABLE);
  assert.ok(!sql.includes(SALT));
  assert.ok(!sql.includes(UID));
  assert.match(sql, /@since/);
  // 파라미터는 날짜 하나뿐이다.
  assert.deepEqual([...sql.matchAll(/@(\w+)/g)].map((m) => m[1]), ["since"]);
});

test("경계 SQL 은 각인 첫 행 시각을 돌려준다 — env 선언이 아니라 실측이다", () => {
  const sql = buildEventStampBoundarySql(PROJECT, DATASET, TABLE);
  assert.match(sql, /first_stamped_at/);
  assert.match(sql, /stamped_rows/);
  assert.match(sql, /stamped_people/);
});

test("★게이트가 꺼져 있으면 state 는 off 이고 사유가 붙는다", () => {
  const cov = summarizeEventStampCoverage(null, OFF_STAMP_GATE);
  assert.equal(cov.state, "off");
  assert.ok(cov.reason && cov.reason.length > 0);
  assert.equal(cov.declaredStampFrom, null);
  assert.equal(cov.stampedRows, 0);
});

test("★부분 각인은 stamping 이다 — 퍼센트를 헤드라인으로 그리지 말라고 화면에 적는다", () => {
  const cov = summarizeEventStampCoverage(
    {
      stamped_rows: "40",
      total_rows: "100",
      stamped_people: "4",
      first_stamped_at: "2026-08-29 10:00:00+00",
      last_stamped_at: "2026-08-29 12:00:00+00",
    },
    ON_STAMP_GATE
  );
  assert.equal(cov.state, "stamping");
  assert.equal(cov.stampedRows, 40);
  assert.equal(cov.totalRows, 100);
  assert.equal(cov.stampedPeople, 4);
  assert.equal(cov.firstStampedAt, "2026-08-29 10:00:00+00");
  assert.equal(cov.declaredStampFrom, "2026-08-29");
  assert.ok(cov.reason && cov.reason.includes("분수"));
});

test("창 안의 모든 행이 각인됐을 때만 complete 다", () => {
  const cov = summarizeEventStampCoverage(
    { stamped_rows: 100, total_rows: 100, stamped_people: 7 },
    ON_STAMP_GATE
  );
  assert.equal(cov.state, "complete");
  assert.equal(cov.reason, null);
});

test("행이 0 이면 complete 가 아니다 — 빈 창을 완료로 읽지 않는다", () => {
  const cov = summarizeEventStampCoverage(
    { stamped_rows: 0, total_rows: 0 },
    ON_STAMP_GATE
  );
  assert.equal(cov.state, "stamping");
});

test("★선언(env)과 실측이 갈라진 것을 화면이 볼 수 있다 — 배포가 밀리면 그렇게 된다", () => {
  const cov = summarizeEventStampCoverage(
    {
      stamped_rows: 1,
      total_rows: 2,
      first_stamped_at: "2026-09-05 00:00:00+00",
    },
    ON_STAMP_GATE
  );
  assert.equal(cov.declaredStampFrom, "2026-08-29");
  assert.equal(cov.firstStampedAt, "2026-09-05 00:00:00+00");
  // 둘을 같이 실어야 "선언은 08-29 인데 실제 첫 각인은 09-05" 를 말할 수 있다.
});

// ═══════════════════════════════════════════════════════════════════════════
// 6) 삭제요청 — 되돌릴 수 있어야 각인이 정당하다
// ═══════════════════════════════════════════════════════════════════════════

test("★삭제는 DELETE 가 아니라 SET NULL 이다 — 사실이 아니라 연결을 지운다", () => {
  const sql = buildEventStampEraseSql(PROJECT, DATASET, TABLE);
  assert.match(sql, /^UPDATE /);
  assert.match(sql, /SET userKey = NULL/);
  assert.match(sql, /WHERE userKey = @user_key/);
  assert.ok(!sql.includes("DELETE"));
});

test("★삭제 SQL 에 원시 uid 가 없다 — 파라미터는 가명 하나뿐이다", () => {
  const sql = buildEventStampEraseSql(PROJECT, DATASET, TABLE);
  assert.ok(!sql.includes(UID));
  assert.deepEqual([...sql.matchAll(/@(\w+)/g)].map((m) => m[1]), ["user_key"]);
});

// ═══════════════════════════════════════════════════════════════════════════
// 7) ★삭제요청은 한 덩어리다 — 반쪽을 부를 수 있으면 언젠가 반쪽이 남는다
// ═══════════════════════════════════════════════════════════════════════════
//
// 각인을 켜기 전 실측(2026-08-29): `buildPersonAxisEraseSql` 도
// `buildEventStampEraseSql` 도 **호출자가 한 명도 없었다.** 짝이라는 사실이
// 주석에만 있었다는 뜻이다. 아래 테스트가 그 사실을 코드로 옮긴다.

test("★삭제 계획은 두 문장을 **같이** 돌려준다 — 링크표와 각인 중 하나만 나올 수 없다", () => {
  const plan = buildPersonErasePlan(PROJECT, DATASET, TABLE);
  assert.equal(plan.statements.length, 2);
  const joined = plan.statements.map((s) => s.sql).join("\n");
  // 각인 쪽: events 를 SET NULL 한다.
  assert.match(joined, /UPDATE .*events`[\s\S]*SET userKey = NULL/);
  // 링크표 쪽: analytics_user_install 에서 DELETE 한다.
  assert.match(joined, /DELETE FROM .*analytics_user_install`/);
});

test("★깨지기 쉬운 문장이 먼저다 — 각인 UPDATE → 링크표 DELETE", () => {
  const plan = buildPersonErasePlan(PROJECT, DATASET, TABLE);
  // 링크를 먼저 지우고 각인이 스트리밍 버퍼로 거절되면 정확히 설계가 경고한
  // 반쪽이 남는다(링크는 없는데 각인된 행이 그 사람을 계속 가리킨다).
  assert.match(plan.statements[0].sql, /^UPDATE /);
  assert.match(plan.statements[1].sql, /^DELETE FROM /);
});

test("★운영 문장은 스트리밍 버퍼를 피한다 — BQ 가 버퍼 행 UPDATE 를 문장째 거절한다", () => {
  const sql = buildEventStampEraseOutsideBufferSql(PROJECT, DATASET, TABLE);
  assert.match(
    sql,
    new RegExp(
      `timestamp < TIMESTAMP_SUB\\(CURRENT_TIMESTAMP\\(\\), INTERVAL ${EVENT_STAMP_ERASE_BUFFER_MINUTES} MINUTE\\)`,
    ),
  );
});

test("★시간 가드를 붙였으면 잔여를 **세야** 한다 — 안 세면 그게 조용한 반쪽이다", () => {
  const plan = buildPersonErasePlan(PROJECT, DATASET, TABLE);
  assert.match(plan.residualCheck.sql, /^SELECT COUNT\(\*\) AS residual_rows/);
  assert.match(plan.residualCheck.sql, /WHERE userKey = @user_key/);
  // 잔여 카운트에는 시간 가드가 **없어야** 한다 — 버퍼 안에 남은 행까지 세야
  // "아직 안 끝났다" 를 말할 수 있다.
  assert.ok(!plan.residualCheck.sql.includes("TIMESTAMP_SUB"));
});

test("★삭제 계획 어느 문장에도 원시 uid·솔트가 없다 — 파라미터는 @user_key 하나뿐", () => {
  const plan = buildPersonErasePlan(PROJECT, DATASET, TABLE);
  for (const s of [...plan.statements, plan.residualCheck]) {
    assert.ok(!s.sql.includes(UID), `${s.label} 에 원시 uid 가 있다`);
    assert.ok(!s.sql.includes(SALT), `${s.label} 에 솔트가 있다`);
    const params = new Set([...s.sql.matchAll(/@(\w+)/g)].map((m) => m[1]));
    assert.deepEqual([...params], ["user_key"], `${s.label} 의 파라미터`);
  }
});
