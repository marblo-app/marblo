// personAxisCohort 순수 로직 단위테스트.
// 실행: cd v3/functions && npm run test:person-axis-cohort
//
// ★재는 것은 "SQL 이 돈다" 가 아니라 **규율이 안 깨진다** 는 것이다:
//   1) 경계를 하드코딩하지 않는다 — 봉투의 경계는 행에서 온 값이고 env 는 옆자리다.
//   2) 경계 이전 날의 people 은 null 이지 0 이 아니다.
//   3) 사슬이 0 이 되는 단계와 사유가 행에서 나온다(지어내지 않는다).
//   4) SQL 본문에 솔트·원시 uid·날짜 리터럴이 없다. 조인은 가명 공간끼리다.
//   5) 읽기 실패는 0 이 아니라 unavailable 이다.
import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveEventStampGate } from "./personAxisStamp";
import {
  BOUNDARY_SOURCE_LABEL,
  COHORT_ROW_LIMIT,
  boundaryDay,
  buildBoundary,
  buildChain,
  buildChainSql,
  buildCohortRows,
  buildDailyRows,
  buildDailySql,
  buildGa4InstallFallbackSql,
  buildGa4PersonCohortSql,
  buildInstallFallbackRows,
  buildNotes,
  buildPersonScorecard,
  buildPersonScorecardSql,
  buildSinceBoundary,
  buildSinceBoundarySql,
  rangeStartDay,
  unavailable,
} from "./personAxisCohort";

const P = "marblo-test";
const GATE_ON = resolveEventStampGate({
  EVENTS_PERSON_STAMP_FROM: "2026-08-29",
});
const GATE_OFF = resolveEventStampGate({});

const ALL_SQL = () => [
  buildDailySql(P),
  buildSinceBoundarySql(P),
  buildChainSql(P),
  buildGa4PersonCohortSql(P),
  buildGa4InstallFallbackSql(P),
  buildPersonScorecardSql(P),
];

// ── 규율 4: SQL 위생 ───────────────────────────────────────────────────────

test("SQL 본문에 날짜 리터럴·솔트·원시 uid 가 없다 (경계는 파라미터로만 들어온다)", () => {
  for (const sql of ALL_SQL()) {
    assert.doesNotMatch(
      sql,
      /\d{4}-\d{2}-\d{2}/,
      "날짜 리터럴 = 하드코딩된 경계",
    );
    assert.doesNotMatch(sql, /salt|SALT/, "솔트가 SQL 에 들어가면 안 된다");
    assert.doesNotMatch(
      sql,
      /firebase_uid|accountUserId/,
      "원시 uid 컬럼 참조 금지",
    );
  }
});

test("경계를 쓰는 SQL 은 전부 @boundary 파라미터를 참조한다", () => {
  for (const sql of [
    buildSinceBoundarySql(P),
    buildChainSql(P),
    buildGa4PersonCohortSql(P),
  ]) {
    assert.match(sql, /@boundary/);
  }
  assert.match(buildDailySql(P), /@since/);
  assert.doesNotMatch(
    buildDailySql(P),
    /@boundary/,
    "일별 SQL 은 경계를 모른다 — 판정은 조립측이 한다",
  );
});

test("사슬 조인은 가명 공간끼리다 (gaKey↔ga_key, install_key, user_key)", () => {
  const sql = buildChainSql(P);
  assert.match(sql, /ai\.ga_key = ft\.gaKey/);
  assert.match(sql, /aui\.install_key = ai\.install_key/);
  assert.match(sql, /ev\.user_key = aui\.user_key/);
  assert.doesNotMatch(sql, /gaClientId|user_pseudo_id/, "원시 GA 식별자 금지");
  // 사슬 표 이름이 문서 §3 과 같다.
  assert.match(sql, /marblo_telemetry\.ga4_first_touch_current/);
  assert.match(sql, /marblo_telemetry\.analytics_identity/);
  assert.match(sql, /marblo_identity\.analytics_user_install/);
  // 신선도: identity 마지막 갱신 vs 원장.
  assert.match(sql, /ledger_rows_after_identity/);
});

test("코호트 SQL 은 검증 문서 §6 의 정식 사슬이고 상한+1 행을 요청한다", () => {
  const sql = buildGa4PersonCohortSql(P);
  assert.match(sql, /task:completed/);
  assert.match(sql, /people_linked/);
  assert.match(sql, new RegExp(`LIMIT ${COHORT_ROW_LIMIT + 1}`));
});

test("사람 축 스코어카드 SQL 은 v_person_since_link 위에서 Activated 임계를 정의 상수로 쓴다", () => {
  const sql = buildPersonScorecardSql(P);
  assert.match(sql, /marblo_identity\.v_person_since_link/);
  assert.match(sql, /tasks_total >= 3/);
  assert.match(sql, /INTERVAL 30 DAY/);
  assert.match(sql, /d30_pending/);
});

// ── 규율 1: 경계는 데이터에서 ────────────────────────────────────────────────

test("경계 봉투의 firstStampedAt 은 행에서, declaredStampFrom 은 env 에서 — 둘이 따로 실린다", () => {
  const b = buildBoundary(
    {
      first_stamped_at: "2026-08-29 13:14:19+00",
      last_stamped_at: "2026-08-29 13:26:00+00",
    },
    GATE_ON,
  );
  assert.equal(b.firstStampedAt, "2026-08-29 13:14:19+00");
  assert.equal(b.declaredStampFrom, "2026-08-29");
  assert.equal(b.stampGate, "on");
  assert.equal(b.source, BOUNDARY_SOURCE_LABEL);
});

test("게이트가 꺼져 있으면 경계는 null 이고 사유가 실린다 (0 이 아니다)", () => {
  const b = buildBoundary(null, GATE_OFF);
  assert.equal(b.firstStampedAt, null);
  assert.equal(b.declaredStampFrom, null);
  assert.equal(b.stampGate, "off");
  assert.ok(b.stampGateReason && b.stampGateReason.length > 0);
});

test("boundaryDay 는 BQ 문자열의 앞 10자다 — 시간대 변환으로 하루가 밀리지 않는다", () => {
  assert.equal(boundaryDay("2026-08-29 23:59:59+00"), "2026-08-29");
  assert.equal(boundaryDay("2026-08-29T00:00:01.000Z"), "2026-08-29");
  assert.equal(boundaryDay(null), null);
  assert.equal(boundaryDay("garbage"), null);
});

// ── 규율 2: 경계 이전은 사람으로 세지 않는다 ────────────────────────────────

test("일별 행: 경계 이전은 people=null, 경계 당일 mixed, 이후 person", () => {
  const rows = buildDailyRows(
    [
      {
        day: "2026-08-27",
        active_installs: 4,
        people: 0,
        stamped_rows: 0,
        unstamped_rows: 900,
      },
      {
        day: "2026-08-28",
        active_installs: 5,
        people: 0,
        stamped_rows: 0,
        unstamped_rows: 800,
      },
      {
        day: "2026-08-29",
        active_installs: 3,
        people: 1,
        stamped_rows: 353,
        unstamped_rows: 11695,
      },
      {
        day: "2026-08-30",
        active_installs: 2,
        people: 1,
        stamped_rows: 120,
        unstamped_rows: 0,
      },
    ],
    "2026-08-29 13:14:19+00",
  );
  assert.deepEqual(
    rows.map((r) => [r.day, r.axis, r.people]),
    [
      ["2026-08-27", "install", null],
      ["2026-08-28", "install", null],
      ["2026-08-29", "mixed", 1],
      ["2026-08-30", "person", 1],
    ],
  );
  assert.equal(rows[0]?.activeInstalls, 4);
});

test("경계가 없으면(각인 전) 모든 날이 설치 축이고 people 은 전부 null", () => {
  const rows = buildDailyRows(
    [
      {
        day: "2026-08-27",
        active_installs: 4,
        people: 0,
        stamped_rows: 0,
        unstamped_rows: 9,
      },
    ],
    null,
  );
  assert.equal(rows[0]?.axis, "install");
  assert.equal(rows[0]?.people, null);
});

test("경계 이후 요약은 미인증(unstamped) 행을 따로 센다", () => {
  const s = buildSinceBoundary({
    stamped_rows: 353,
    unstamped_rows: 2,
    total_rows: 355,
    people: 1,
    installs: 2,
  });
  assert.deepEqual(s, {
    stampedRows: 353,
    unstampedRows: 2,
    totalRows: 355,
    people: 1,
    installs: 2,
  });
  assert.equal(buildSinceBoundary(null), null);
});

// ── 규율 3: 끊긴 자리는 행이 말한다 ────────────────────────────────────────

const CHAIN_ROW_NOW = {
  s1_browsers: 863,
  s2_installs: 550,
  s3_people: 0,
  s4_people_with_events: 0,
  linked_people_total: 4,
  linked_installs_total: 4,
  linked_installs_with_ga_key: 0,
  identity_max_linked_at: "2026-08-20 09:00:00+00",
  ledger_max_linked_at: "2026-08-29 12:19:00+00",
  ledger_rows_after_identity: 98,
};

test("실측 사슬(863→550→0→0): s3 에서 끊기고 사유에 identity 정지·미반영 원장 수가 들어간다", () => {
  const c = buildChain(CHAIN_ROW_NOW);
  assert.ok(c);
  assert.deepEqual(
    c.steps.map((s) => [s.key, s.count, s.unit]),
    [
      ["s1", 863, "browser"],
      ["s2", 550, "install"],
      ["s3", 0, "person"],
      ["s4", 0, "person"],
    ],
  );
  assert.equal(c.breakAtKey, "s3");
  assert.match(c.breakReason ?? "", /링크된 설치 4대 중/);
  assert.match(c.breakReason ?? "", /ga_key 를 가진 설치가 0대/);
  assert.match(c.breakReason ?? "", /2026-08-20/);
  assert.match(c.breakReason ?? "", /98건/);
  assert.match(c.breakReason ?? "", /별건 수리/);
  assert.equal(c.freshness.ledgerRowsAfterIdentity, 98);
});

test("사슬이 끝까지 살아 있으면 breakAt 은 null 이고 사유를 지어내지 않는다", () => {
  const c = buildChain({
    ...CHAIN_ROW_NOW,
    s3_people: 3,
    s4_people_with_events: 2,
    linked_installs_with_ga_key: 3,
    ledger_rows_after_identity: 0,
  });
  assert.ok(c);
  assert.equal(c.breakAtKey, null);
  assert.equal(c.breakReason, null);
});

test("사슬 행이 없으면(쿼리 실패) chain 은 null — 0 단계를 그리지 않는다", () => {
  assert.equal(buildChain(null), null);
});

// ── 행 조립 ────────────────────────────────────────────────────────────────

test("코호트 행: 0행이면 빈 배열 + truncated=false (그 '왜' 는 chain 이 말한다)", () => {
  assert.deepEqual(buildCohortRows([]), { rows: [], truncated: false });
});

test("코호트 행: 상한을 넘으면 잘라내고 truncated 로 알린다", () => {
  const many = Array.from({ length: COHORT_ROW_LIMIT + 1 }, (_, i) => ({
    source: `s${i}`,
    medium: "m",
    campaign: null,
    country: "KR",
    people_linked: 1,
    people_with_events: 0,
    stamped_rows: 0,
    task_done: 0,
  }));
  const r = buildCohortRows(many);
  assert.equal(r.rows.length, COHORT_ROW_LIMIT);
  assert.equal(r.truncated, true);
  assert.equal(r.rows[0]?.source, "s0");
  assert.equal(r.rows[0]?.campaign, null);
});

test("설치 축 폴백 행은 사람 열이 없다 — 사람으로 읽힐 자리를 만들지 않는다", () => {
  const rows = buildInstallFallbackRows([
    {
      source: "(direct)",
      medium: "(none)",
      campaign: "(direct)",
      country: "South Korea",
      installs: 550,
      browsers: 3,
    },
  ]);
  assert.deepEqual(Object.keys(rows[0] ?? {}).sort(), [
    "browsers",
    "campaign",
    "country",
    "installs",
    "medium",
    "source",
  ]);
  assert.equal(rows[0]?.installs, 550);
});

test("사람 축 스코어카드: 실측(사람 1명) 모양이 그대로 실리고 basis 가 since_link 다", () => {
  const s = buildPersonScorecard(
    {
      linked_people: 1,
      activated_people: 1,
      d30_cohort: 0,
      d30_retained: 0,
      d30_pending: 1,
    },
    P,
  );
  assert.ok(s);
  assert.equal(s.basis, "since_link");
  assert.match(s.view, /v_person_since_link$/);
  assert.equal(s.activatedMinTasks, 3);
  assert.deepEqual(s.d30, { cohort: 0, retained: 0, pending: 1 });
  assert.equal(buildPersonScorecard(null, P), null);
});

test("rangeStartDay 는 오늘 포함 N일의 첫날(UTC)", () => {
  const now = new Date("2026-08-30T10:00:00Z");
  assert.equal(rangeStartDay(30, now), "2026-08-01");
  assert.equal(rangeStartDay(1, now), "2026-08-30");
});

// ── 노트 · 불가 ─────────────────────────────────────────────────────────────

test("노트: 선언과 실측이 다르면 그 사실을 적고, 경계 이후 미인증 행과 0행 사유를 적는다", () => {
  const boundary = buildBoundary(
    { first_stamped_at: "2026-08-30 01:00:00+00", last_stamped_at: null },
    GATE_ON, // 선언 2026-08-29
  );
  const notes = buildNotes({
    boundary,
    sinceBoundary: {
      stampedRows: 10,
      unstampedRows: 3,
      totalRows: 13,
      people: 1,
      installs: 1,
    },
    chain: buildChain(CHAIN_ROW_NOW),
    cohortRowCount: 0,
  });
  assert.ok(
    notes.some((n) =>
      /env 선언\(2026-08-29\)과 실측 경계\(2026-08-30\)/.test(n),
    ),
  );
  assert.ok(notes.some((n) => /userKey 가 없는 행 3건/.test(n)));
  assert.ok(notes.some((n) => /0행인 이유는 사슬 s3 단계/.test(n)));
});

test("노트: 게이트가 꺼져 있으면 '없음' 이지 0 이 아니라고 말한다", () => {
  const notes = buildNotes({
    boundary: buildBoundary(null, GATE_OFF),
    sinceBoundary: null,
    chain: null,
    cohortRowCount: 0,
  });
  assert.ok(notes.some((n) => /0 이 아니라 없음/.test(n)));
});

test("unavailable 봉투에는 숫자가 하나도 없다 — 0 을 그릴 길이 없다", () => {
  const u = unavailable(30, "boom", GATE_ON, "2026-08-30T00:00:00.000Z");
  assert.equal(u.state, "unavailable");
  assert.equal(u.sinceBoundary, null);
  assert.equal(u.chain, null);
  assert.equal(u.personScorecard, null);
  assert.deepEqual(u.daily, []);
  assert.deepEqual(u.cohortRows, []);
  assert.equal(u.queryStatus.ok, false);
  assert.equal(u.reason, "boom");
});
