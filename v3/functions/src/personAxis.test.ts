// personAxis 순수 로직 단위테스트 (analyticsPseudonym.test.ts 규약).
// 실행:
//   cd v3/functions && npm run test:person-axis
//
// ★이 파일이 지키는 것 다섯 — 전부 설계 문서가 "이게 핵심" 이라고 적은 자리다
//   (v3/docs/person-axis-user-key-design-2026-08-21.md):
//
//   1) 게이트가 unset 이면 **0행 + 사유**다. 던지지도, 전체를 보여주지도 않는다.
//   2) 소급은 저장이 아니라 조회다 — **링크표를 지우면 소급이 즉시 취소된다.**
//   3) 공용 기기는 값을 만들지 않고 **센다.**
//   4) 이벤트 행에는 user_key 컬럼이 없다(있으면 되돌릴 수 없어진다).
//   5) 권한 분리는 데이터셋 이름이 아니라 **IAM** 으로 갈려야 한다.
import test from "node:test";
import assert from "node:assert/strict";

import {
  FORBIDDEN_ON_LINK_AXIS,
  LINK_SOURCE_TELEMETRY_AUTH,
  LINK_SOURCE_UID28_INLINE,
  PERSON_AXIS_BASIS_LABEL,
  PERSON_AXIS_EFFECTIVE_FROM_ENV,
  PERSON_AXIS_VIEW_COLUMNS,
  TABLE_USER_INSTALL,
  USER_INSTALL_SCHEMA,
  assertLinkDatasetIsolation,
  attributePersonRows,
  buildLinkRowId,
  buildPersonAxisEraseSql,
  buildPersonAxisViewDdl,
  buildPersonAxisViewSql,
  buildUserInstallMergeSql,
  buildUserInstallTableDdl,
  computePersonAxisCoverage,
  findSharedInstalls,
  maskPrincipal,
  planUserInstallLink,
  resolvePersonAxisGate,
  type PersonAxisDailyRow,
  type UserInstallLink,
} from "./personAxis";

const SALT = "test-salt-not-a-real-secret";
const PROJECT = "marblo-2253d";
const EFFECTIVE_FROM = "2026-09-01";

const OPEN_GATE = resolvePersonAxisGate({
  [PERSON_AXIS_EFFECTIVE_FROM_ENV]: EFFECTIVE_FROM,
});
const CLOSED_GATE = resolvePersonAxisGate({});

/** 익명축 일별 행 — ★user_key 컬럼이 없다. 그게 이 설계의 전제다. */
const DAILY: ReadonlyArray<PersonAxisDailyRow> = [
  // 발효일 이전 — 상한에 걸린다.
  { install_key: "in_aaa", day: "2026-08-20", active: true, event_count: 3 },
  // 링크 이전 — since_link 에서만 걸린다.
  { install_key: "in_aaa", day: "2026-09-02", active: true, event_count: 5 },
  // 링크 이후 — 두 뷰 모두 통과.
  { install_key: "in_aaa", day: "2026-09-10", active: true, event_count: 7 },
  // 링크가 없는 설치 — 버리지 않고 센다.
  { install_key: "in_zzz", day: "2026-09-10", active: true, event_count: 1 },
];

const LINKS: ReadonlyArray<UserInstallLink> = [
  {
    user_key: "us_person1",
    install_key: "in_aaa",
    id_scheme: "uuid36",
    link_source: LINK_SOURCE_TELEMETRY_AUTH,
    first_linked_at: "2026-09-05T00:00:00Z",
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// 1) 게이트 — 만들되 켜지 않는다
// ═══════════════════════════════════════════════════════════════════════════

test("★unset 이면 게이트가 닫히고 **사유**를 들고 다닌다 (던지지 않는다)", () => {
  const gate = resolvePersonAxisGate({});
  assert.equal(gate.open, false);
  assert.equal(gate.effectiveFrom, null);
  assert.equal(gate.open === false && gate.reasonCode, "unset");
  assert.match(String(gate.reason), /PERSON_AXIS_EFFECTIVE_FROM/);
  // 사유가 "왜 닫혀 있나" 를 말한다 — 화면이 이 문장을 그대로 그린다.
  assert.match(String(gate.reason), /발효일/);
});

test("공백만 있는 값도 unset 과 같다", () => {
  assert.equal(
    resolvePersonAxisGate({ PERSON_AXIS_EFFECTIVE_FROM: "   " }).open,
    false
  );
});

test("★모양이 틀린 값은 여는 게 아니라 닫는다 (잘못된 상한보다 닫힘이 안전하다)", () => {
  for (const bad of ["2026/09/01", "2026-9-1", "yesterday", "2026-02-31"]) {
    const gate = resolvePersonAxisGate({ PERSON_AXIS_EFFECTIVE_FROM: bad });
    assert.equal(gate.open, false, `${bad} 가 게이트를 열었다`);
    assert.equal(gate.open === false && gate.reasonCode, "invalid");
  }
});

test("정상 날짜면 열린다", () => {
  assert.equal(OPEN_GATE.open, true);
  assert.equal(OPEN_GATE.effectiveFrom, EFFECTIVE_FROM);
  assert.equal(OPEN_GATE.reason, null);
});

test("★게이트가 닫히면 사람 축은 0행 + 사유다 — 예외도, 전체 노출도 아니다", () => {
  // 던지지 않는다.
  const out = attributePersonRows(DAILY, LINKS, "all_time", CLOSED_GATE);
  // 0행이다.
  assert.equal(out.rows.length, 0);
  // 사유가 실려 나온다.
  assert.match(String(out.disabledReason), /PERSON_AXIS_EFFECTIVE_FROM/);
  // ★그리고 "조용히 전체를 보여주는" 실패 모드가 아니다 — 입력에 링크가 있고
  //   발효일 상한이 없는데도 한 행도 나오지 않는다.
  assert.ok(LINKS.length > 0 && DAILY.length > 0);
});

test("★게이트가 닫힌 뷰 SQL 은 0행이고, 원천 테이블을 참조조차 하지 않는다", () => {
  for (const basis of ["since_link", "all_time"] as const) {
    const sql = buildPersonAxisViewSql(basis, CLOSED_GATE, PROJECT);
    assert.match(sql, /FROM UNNEST\(ARRAY<STRING>\[\]\)/);
    assert.ok(!sql.includes("analytics_user_daily"), "닫힌 뷰가 원천을 읽는다");
    assert.ok(!sql.includes(TABLE_USER_INSTALL), "닫힌 뷰가 링크표를 읽는다");
    assert.match(sql, /disabled_reason/);
    assert.match(sql, /PERSON_AXIS_EFFECTIVE_FROM/);
  }
});

test("★열림/닫힘의 컬럼 모양이 같다 — 닫힘을 장애로 읽히게 하지 않는다", () => {
  for (const basis of ["since_link", "all_time"] as const) {
    const closed = buildPersonAxisViewSql(basis, CLOSED_GATE, PROJECT);
    const open = buildPersonAxisViewSql(basis, OPEN_GATE, PROJECT);
    for (const col of PERSON_AXIS_VIEW_COLUMNS) {
      assert.ok(closed.includes(col.name), `닫힌 뷰에 ${col.name} 이 없다`);
      assert.ok(open.includes(col.name), `열린 뷰에 ${col.name} 이 없다`);
    }
  }
});

test("DDL 은 CREATE OR REPLACE VIEW — 원본 테이블을 만들지도 고치지도 않는다", () => {
  const ddl = buildPersonAxisViewDdl("since_link", CLOSED_GATE, PROJECT);
  assert.match(ddl, /^CREATE OR REPLACE VIEW/);
  assert.match(ddl, /v_person_since_link/);
  const mutatesTable = new RegExp(
    ["CREATE TABLE", "ALTER TABLE", ["DROP", "TABLE"].join(" ")].join("|")
  );
  assert.ok(!mutatesTable.test(ddl));
  assert.ok(!/\bUPDATE\b|\bINSERT\b|\bDELETE\b/.test(ddl));
});

// ═══════════════════════════════════════════════════════════════════════════
// 2) ★소급은 저장이 아니라 조회 — 링크표를 지우면 즉시 취소된다
// ═══════════════════════════════════════════════════════════════════════════

test("★★링크표를 지우면 소급이 그 자리에서 취소된다 (설계의 핵심 성질)", () => {
  const before = attributePersonRows(DAILY, LINKS, "all_time", OPEN_GATE);
  assert.ok(before.rows.length > 0, "전제: 링크가 있으면 귀속이 생긴다");

  // 링크표를 비운다 = DELETE FROM analytics_user_install.
  const after = attributePersonRows(DAILY, [], "all_time", OPEN_GATE);
  assert.equal(after.rows.length, 0, "링크를 지웠는데 귀속이 남아 있다");

  // ★그리고 익명 기록은 익명으로 **그대로** 남는다 — 상한 위 행은 전부
  //   "붙일 링크가 없음" 으로 세어지지, 사라지지 않는다.
  assert.equal(
    after.unlinkedRows,
    DAILY.filter((d) => d.day >= EFFECTIVE_FROM).length
  );
});

test("★한 사람만 지워도 그 사람의 과거 귀속만 풀린다 (PIPA 제36조 = 한 줄)", () => {
  const twoPeople: UserInstallLink[] = [
    ...LINKS,
    {
      user_key: "us_person2",
      install_key: "in_bbb",
      id_scheme: "uuid36",
      link_source: LINK_SOURCE_TELEMETRY_AUTH,
      first_linked_at: "2026-09-01T00:00:00Z",
    },
  ];
  const daily: PersonAxisDailyRow[] = [
    ...DAILY,
    { install_key: "in_bbb", day: "2026-09-10", active: true, event_count: 2 },
  ];
  const all = attributePersonRows(daily, twoPeople, "all_time", OPEN_GATE);
  assert.ok(all.rows.some((r) => r.user_key === "us_person1"));
  assert.ok(all.rows.some((r) => r.user_key === "us_person2"));

  const erased = twoPeople.filter((l) => l.user_key !== "us_person1");
  const after = attributePersonRows(daily, erased, "all_time", OPEN_GATE);
  assert.ok(!after.rows.some((r) => r.user_key === "us_person1"));
  assert.ok(after.rows.some((r) => r.user_key === "us_person2"));
});

test("★이벤트 행은 통과해도 변하지 않는다 — 저장 소급이 아니라는 뜻", () => {
  const snapshot = JSON.stringify(DAILY);
  attributePersonRows(DAILY, LINKS, "all_time", OPEN_GATE);
  assert.equal(JSON.stringify(DAILY), snapshot, "입력 익명축 행이 변형됐다");
  // 익명축 원본에는 user_key 라는 이름의 컬럼이 애초에 없다.
  for (const row of DAILY) {
    assert.ok(!("user_key" in row));
  }
});

test("★삭제 SQL 은 링크표 한 줄 — 이벤트 테이블을 건드리지 않는다", () => {
  const sql = buildPersonAxisEraseSql(PROJECT);
  assert.match(sql, new RegExp(TABLE_USER_INSTALL));
  assert.match(sql, /WHERE user_key = @user_key/);
  for (const t of [
    "events",
    "agent_heartbeats",
    "task_outcomes",
    "analytics_user_daily",
  ]) {
    assert.ok(!sql.includes(t), `삭제 SQL 이 ${t} 를 건드린다`);
  }
  // 원시 uid 를 SQL 에 넣지 않는다(BQ 는 쿼리 본문을 job 히스토리에 보관한다).
  assert.ok(!sql.includes("uid ="));
});

// ═══════════════════════════════════════════════════════════════════════════
// 3) 뷰 두 벌 — 기본은 연결 이후, 소급은 캠페인 전용
// ═══════════════════════════════════════════════════════════════════════════

test("since_link — 링크 이전 행은 제외하고, 뺀 수를 센다", () => {
  const out = attributePersonRows(DAILY, LINKS, "since_link", OPEN_GATE);
  assert.deepEqual(
    out.rows.map((r) => r.day),
    ["2026-09-10"]
  );
  assert.equal(out.droppedBeforeLink, 1); // 09-02
  assert.equal(out.droppedBeforeEffectiveFrom, 1); // 08-20
  assert.equal(out.unlinkedRows, 1); // in_zzz
});

test("all_time — 링크 이전도 귀속한다. ★단 발효일 상한은 넘지 않는다", () => {
  const out = attributePersonRows(DAILY, LINKS, "all_time", OPEN_GATE);
  assert.deepEqual(
    out.rows.map((r) => r.day),
    ["2026-09-02", "2026-09-10"]
  );
  assert.equal(out.droppedBeforeLink, 0);
  // ★08-20 은 소급 뷰에서도 안 나온다 — 상한이 두 뷰 모두에 걸린다.
  assert.equal(out.droppedBeforeEffectiveFrom, 1);
  assert.ok(!out.rows.some((r) => r.day < EFFECTIVE_FROM));
});

test("★모든 행이 어느 기준인지 말한다 — 라벨 없는 사람 축 숫자 금지", () => {
  for (const basis of ["since_link", "all_time"] as const) {
    const out = attributePersonRows(DAILY, LINKS, basis, OPEN_GATE);
    assert.equal(out.basis, basis);
    for (const r of out.rows) {
      assert.equal(r.basis, basis);
      assert.equal(r.effective_from, EFFECTIVE_FROM);
    }
  }
  assert.equal(PERSON_AXIS_BASIS_LABEL.all_time, "설치 전체 이력 기준(소급)");
  assert.equal(PERSON_AXIS_BASIS_LABEL.since_link, "연결 이후 기준");
});

test("★uid28 구간 링크는 상한에 걸려 기본적으로 안 쓰인다 (설계 §5.6)", () => {
  const uid28Link: UserInstallLink[] = [
    {
      user_key: "us_old",
      install_key: "in_old",
      id_scheme: "uid28",
      link_source: LINK_SOURCE_UID28_INLINE,
      first_linked_at: "2026-05-01T00:00:00Z",
    },
  ];
  const old: PersonAxisDailyRow[] = [
    { install_key: "in_old", day: "2026-05-02", active: true },
  ];
  const out = attributePersonRows(old, uid28Link, "all_time", OPEN_GATE);
  assert.equal(out.rows.length, 0);
  assert.equal(out.droppedBeforeEffectiveFrom, 1);
});

test("열린 뷰 SQL 에 상한과 공용기기 제외가 둘 다 들어 있다", () => {
  const since = buildPersonAxisViewSql("since_link", OPEN_GATE, PROJECT);
  const all = buildPersonAxisViewSql("all_time", OPEN_GATE, PROJECT);
  for (const sql of [since, all]) {
    assert.match(sql, /COUNT\(DISTINCT user_key\) > 1/);
    assert.match(sql, /install_key NOT IN \(SELECT install_key FROM shared\)/);
    assert.ok(sql.includes(`DATE("${EFFECTIVE_FROM}")`));
  }
  // ★기본 뷰에만 링크 경계가 있다.
  assert.match(since, /d\.day >= DATE\(l\.first_linked_at\)/);
  assert.ok(!all.includes("d.day >= DATE(l.first_linked_at)"));
});

// ═══════════════════════════════════════════════════════════════════════════
// 4) 공용 기기 — 값을 만들지 않고 센다
// ═══════════════════════════════════════════════════════════════════════════

const SHARED_LINKS: ReadonlyArray<UserInstallLink> = [
  {
    user_key: "us_p1",
    install_key: "in_shared",
    id_scheme: "uuid36",
    link_source: LINK_SOURCE_TELEMETRY_AUTH,
    first_linked_at: "2026-09-02T00:00:00Z",
  },
  {
    user_key: "us_p2",
    install_key: "in_shared",
    id_scheme: "uuid36",
    link_source: LINK_SOURCE_TELEMETRY_AUTH,
    first_linked_at: "2026-09-03T00:00:00Z",
  },
  {
    user_key: "us_p3",
    install_key: "in_solo",
    id_scheme: "uuid36",
    link_source: LINK_SOURCE_TELEMETRY_AUTH,
    first_linked_at: "2026-09-02T00:00:00Z",
  },
];

test("findSharedInstalls — 계정 2개 이상 붙은 설치만 골라낸다", () => {
  const shared = findSharedInstalls(SHARED_LINKS);
  assert.equal(shared.size, 1);
  assert.ok(shared.has("in_shared"));
  assert.ok(!shared.has("in_solo"));
});

test("★공용 기기는 두 뷰 모두에서 제외되고, 제외 수가 화면에 올라간다", () => {
  const daily: PersonAxisDailyRow[] = [
    {
      install_key: "in_shared",
      day: "2026-09-10",
      active: true,
      event_count: 9,
    },
    { install_key: "in_solo", day: "2026-09-10", active: true, event_count: 1 },
  ];
  for (const basis of ["since_link", "all_time"] as const) {
    const out = attributePersonRows(daily, SHARED_LINKS, basis, OPEN_GATE);
    // ★마지막 사람에게 몰아주지 않는다 — 값을 만들지 않는다.
    assert.ok(!out.rows.some((r) => r.install_key === "in_shared"));
    assert.ok(
      !out.rows.some((r) => r.user_key === "us_p1" || r.user_key === "us_p2")
    );
    // ★대신 센다.
    assert.equal(out.excludedSharedInstalls, 1);
    assert.equal(out.droppedSharedRows, 1);
    // 나머지는 정상 귀속.
    assert.equal(out.rows.length, 1);
    assert.equal(out.rows[0].user_key, "us_p3");
  }
});

test("실측 0건이어도 규칙이 먼저 있다 — 공용기기 없는 입력은 제외 0", () => {
  const out = attributePersonRows(DAILY, LINKS, "all_time", OPEN_GATE);
  assert.equal(out.excludedSharedInstalls, 0);
  assert.equal(out.droppedSharedRows, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// 5) 링크 행 — 저장은 소급하지 않는다 · MERGE 는 멱등
// ═══════════════════════════════════════════════════════════════════════════

test("row_id 는 결정적 — 같은 쌍이면 같은 키(재실행 멱등)", () => {
  const a = buildLinkRowId("us_1", "in_1", SALT);
  const b = buildLinkRowId("us_1", "in_1", SALT);
  assert.equal(a, b);
  assert.equal(String(a).startsWith("lk_"), true);
  assert.notEqual(a, buildLinkRowId("us_1", "in_2", SALT));
});

test("★솔트가 없으면 row_id 를 만들지 않는다(fail-safe) — 임시 해시 금지", () => {
  assert.equal(buildLinkRowId("us_1", "in_1", null), null);
});

test("★게이트가 닫혀 있으면 링크 행을 만들지 않는다 — 적재까지 막아야 '안 켠 것'", () => {
  const out = planUserInstallLink(
    {
      userKey: "us_1",
      installKey: "in_1",
      idScheme: "uuid36",
      linkSource: LINK_SOURCE_TELEMETRY_AUTH,
      observedAt: "2026-09-10T01:02:03Z",
      policyVersion: "2026-09-01",
      salt: SALT,
    },
    CLOSED_GATE
  );
  assert.equal(out.written, false);
  assert.match(
    String(out.written === false && out.reason),
    /PERSON_AXIS_EFFECTIVE_FROM/
  );
});

test("★발효일 이전 관측은 링크를 만들지 않는다 — 소급의 재료를 저장하지 않는다", () => {
  const out = planUserInstallLink(
    {
      userKey: "us_1",
      installKey: "in_1",
      idScheme: "uid28",
      linkSource: LINK_SOURCE_UID28_INLINE,
      observedAt: "2026-05-01T00:00:00Z",
      policyVersion: "2026-09-01",
      salt: SALT,
    },
    OPEN_GATE
  );
  assert.equal(out.written, false);
  assert.match(String(out.written === false && out.reason), /발효일/);
});

test("게이트가 열리고 상한 위면 행을 만든다 — 원시 uid 는 어디에도 없다", () => {
  const out = planUserInstallLink(
    {
      userKey: "us_1",
      installKey: "in_1",
      idScheme: "uuid36",
      linkSource: LINK_SOURCE_TELEMETRY_AUTH,
      observedAt: "2026-09-10T01:02:03Z",
      policyVersion: "2026-09-01",
      salt: SALT,
    },
    OPEN_GATE
  );
  assert.equal(out.written, true);
  if (out.written) {
    assert.equal(out.row.first_linked_at, out.row.last_seen_at);
    const names = Object.keys(out.row);
    for (const banned of FORBIDDEN_ON_LINK_AXIS) {
      assert.ok(!names.includes(banned), `${banned} 가 링크 행에 있다`);
    }
    // 스키마에 선언된 컬럼만 있다(적재 시 no such field 방지).
    const declared = new Set(USER_INSTALL_SCHEMA.map((f) => f.name));
    for (const n of names) assert.ok(declared.has(n), `${n} 이 스키마에 없다`);
    for (const f of USER_INSTALL_SCHEMA) {
      if (f.mode === "REQUIRED") {
        assert.ok(names.includes(f.name), `${f.name} 누락`);
      }
    }
  }
});

test("★MERGE 는 first_linked_at 을 덮지 않는다 — 소급 경계가 뒤로 밀리면 안 된다", () => {
  const sql = buildUserInstallMergeSql(
    PROJECT,
    "analytics_user_install_staging"
  );
  assert.match(
    sql,
    /T\.first_linked_at = LEAST\(T\.first_linked_at, S\.first_linked_at\)/
  );
  assert.match(
    sql,
    /T\.last_seen_at = GREATEST\(T\.last_seen_at, S\.last_seen_at\)/
  );
  assert.match(sql, /ON T\.row_id = S\.row_id/);
  // 원본 텔레메트리 데이터셋을 건드리지 않는다.
  assert.ok(!sql.includes("marblo_telemetry"));
});

test("★링크표 DDL — 파티션/클러스터가 소급 경계와 삭제요청을 탄다", () => {
  const ddl = buildUserInstallTableDdl(PROJECT);
  assert.match(ddl, /^CREATE TABLE IF NOT EXISTS/);
  assert.match(ddl, /PARTITION BY DATE\(first_linked_at\)/);
  assert.match(ddl, /CLUSTER BY user_key, install_key/);
  // REQUIRED 컬럼은 NOT NULL 로 나간다 — 자리만 있고 비는 컬럼을 못 만들게.
  for (const f of USER_INSTALL_SCHEMA) {
    if (f.mode === "REQUIRED") {
      assert.ok(
        ddl.includes(`${f.name} ${f.type} NOT NULL`),
        `${f.name} 이 NOT NULL 이 아니다`
      );
    }
  }
  // ★금지 컬럼은 자리조차 없다.
  for (const banned of FORBIDDEN_ON_LINK_AXIS) {
    assert.ok(
      !new RegExp(`^  ${banned} `, "m").test(ddl),
      `${banned} 컬럼이 DDL 에 있다`
    );
  }
  // 원본 데이터셋을 건드리지 않는다.
  assert.ok(!ddl.includes("marblo_telemetry"));
});

// ═══════════════════════════════════════════════════════════════════════════
// 6) 커버리지 — 부분 적재 중에 화면이 거짓말하지 않게
// ═══════════════════════════════════════════════════════════════════════════

const COV_BASE = {
  basis: "since_link" as const,
  linkedInstalls: 6,
  totalInstalls: 20,
  linkedActiveInstalls: 6,
  activeInstalls: 14,
  excludedSharedInstalls: 0,
  lastLinkedAt: "2026-09-10T00:00:00Z",
};

test("★게이트가 닫히면 state=disabled 이고 사유가 실린다 ('적재 전'이 아니다)", () => {
  const cov = computePersonAxisCoverage({ ...COV_BASE, gate: CLOSED_GATE });
  assert.equal(cov.state, "disabled");
  assert.match(String(cov.disabledReason), /PERSON_AXIS_EFFECTIVE_FROM/);
  assert.equal(cov.effectiveFrom, null);
  // 닫혀 있으면 신뢰할 근거가 없는 수치는 0 으로 접는다.
  assert.equal(cov.linkedInstalls, 0);
  assert.equal(cov.linkedActiveInstalls, 0);
});

test("링크 0 이면 pending — 새 상태를 만들지 않고 기존 '적재 전' 을 쓴다", () => {
  const cov = computePersonAxisCoverage({
    ...COV_BASE,
    gate: OPEN_GATE,
    linkedInstalls: 0,
    linkedActiveInstalls: 0,
  });
  assert.equal(cov.state, "pending");
});

test("일부만 붙었으면 ingesting — 이 구간에 퍼센트 헤드라인을 그리면 안 된다", () => {
  const cov = computePersonAxisCoverage({ ...COV_BASE, gate: OPEN_GATE });
  assert.equal(cov.state, "ingesting");
  assert.equal(cov.linkedActiveInstalls, 6);
  assert.equal(cov.activeInstalls, 14);
});

test("★complete 판정은 '전체 설치' 가 아니라 '활동한 설치' 기준이다", () => {
  // 잠자는 설치(20대 중 14대만 활동)를 기다리면 영원히 complete 가 안 되고,
  // 그러면 이 장치가 늑대소년이 된다.
  const cov = computePersonAxisCoverage({
    ...COV_BASE,
    gate: OPEN_GATE,
    linkedActiveInstalls: 14,
    activeInstalls: 14,
  });
  assert.equal(cov.state, "complete");
  assert.ok(
    cov.linkedInstalls < cov.totalInstalls,
    "전제: 전체는 아직 안 붙었다"
  );
});

test("★활동 설치가 0 이면 complete 로 올리지 않는다 (분모 0 의 완전성은 공허참)", () => {
  const cov = computePersonAxisCoverage({
    ...COV_BASE,
    gate: OPEN_GATE,
    linkedActiveInstalls: 0,
    activeInstalls: 0,
  });
  assert.equal(cov.state, "pending");
});

test("커버리지는 제외된 공용기기 수를 그대로 실어 보낸다", () => {
  const cov = computePersonAxisCoverage({
    ...COV_BASE,
    gate: OPEN_GATE,
    excludedSharedInstalls: 2,
  });
  assert.equal(cov.excludedSharedInstalls, 2);
  assert.equal(cov.basis, "since_link");
});

// ═══════════════════════════════════════════════════════════════════════════
// 7) 권한 분리 — 이름이 아니라 IAM 으로 갈렸는가
// ═══════════════════════════════════════════════════════════════════════════

const TELEMETRY_ACL = [
  {
    role: "READER",
    principal: "analytics-reader@marblo.iam.gserviceaccount.com",
  },
  { role: "READER", principal: "dashboard@marblo.iam.gserviceaccount.com" },
  { role: "OWNER", principal: "owner@hypemarc.com" },
];

test("★principal 집합이 같으면 분리가 아니다 — 이름표만 바꾼 같은 방", () => {
  const rep = assertLinkDatasetIsolation(TELEMETRY_ACL, TELEMETRY_ACL);
  assert.equal(rep.ok, false);
  assert.equal(rep.findings[0].code, "identical_principals");
  assert.equal(rep.identityOnly.length, 0);
});

test("identity 가 telemetry 를 전부 포함하면 좁혀진 게 아니라 넓어진 것", () => {
  const rep = assertLinkDatasetIsolation(TELEMETRY_ACL, [
    ...TELEMETRY_ACL,
    { role: "READER", principal: "extra@hypemarc.com" },
  ]);
  assert.equal(rep.ok, false);
  assert.equal(rep.findings[0].code, "no_narrowing");
});

test("좁혀졌으면 통과한다", () => {
  const rep = assertLinkDatasetIsolation(TELEMETRY_ACL, [
    { role: "OWNER", principal: "owner@hypemarc.com" },
    {
      role: "READER",
      principal: "person-axis@marblo.iam.gserviceaccount.com",
    },
  ]);
  assert.equal(rep.ok, true, JSON.stringify(rep.findings));
  assert.equal(rep.identityOnly.length, 1);
  assert.equal(rep.overlapping.length, 1);
});

test("★광역/도메인 principal 은 분리가 아니라 공개다", () => {
  const pub = assertLinkDatasetIsolation(TELEMETRY_ACL, [
    { role: "READER", principal: "allAuthenticatedUsers" },
  ]);
  assert.ok(pub.findings.some((f) => f.code === "public_principal"));

  const dom = assertLinkDatasetIsolation(TELEMETRY_ACL, [
    { role: "READER", principal: "hypemarc.com", principalType: "domain" },
  ]);
  assert.ok(dom.findings.some((f) => f.code === "domain_wide"));
});

test("리포트는 이메일 원문을 남기지 않는다", () => {
  assert.equal(maskPrincipal("john.kim@hypemarc.com"), "j***@hypemarc.com");
  const rep = assertLinkDatasetIsolation(TELEMETRY_ACL, TELEMETRY_ACL);
  const dump = JSON.stringify(rep);
  assert.ok(!dump.includes("john.kim"));
  assert.ok(!dump.includes("owner@hypemarc.com"));
});
