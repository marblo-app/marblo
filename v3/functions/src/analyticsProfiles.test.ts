// analyticsProfiles 순수 로직 단위테스트 (adminAnalytics.test.ts 규약).
// 실행:
//   npm run test:analytics-profiles
//
// 이 파일이 지키는 것 넷 — 전부 실측에서 데인 자리다:
//   1) 축 분리(두 테이블에 조인 키가 생기지 않는다)
//   2) active 정의(하트비트 존재로 세지 않는다) + present_only 격리
//   3) D7/D14 두 정의(exact/window)와 pending 처리
//   4) 분자·분모 보존(비율만 저장하지 않는다)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACCOUNT_PROFILE_SCHEMA,
  ANONYMOUS_AXIS_TABLES,
  ACCOUNT_AXIS_TABLES,
  INSTALL_PROFILE_SCHEMA,
  USER_DAILY_SCHEMA,
  TABLE_ACCOUNT_PROFILE,
  TABLE_INSTALL_PROFILE,
  TABLE_USER_DAILY,
  assertAxisPurity,
  buildAccountProfileRows,
  buildInstallProfileRows,
  buildUserDailyRows,
  classifyIdScheme,
  summarizeInstallRetention,
  summarizeFirstSpawnActivation,
  foldWeeklyProfileCoverage,
  weekStartMonday,
  REINSTALL_LOOP_MIN_INSTALLS,
  HORIZON_DEFINITION_EXACT,
  HORIZON_DEFINITION_WINDOW,
  HORIZON_DEFINITION_PENDING,
  PROFILE_HORIZONS,
  FORBIDDEN_ON_ANONYMOUS_AXIS,
  FORBIDDEN_ON_LINK_AXIS,
  LINK_AXIS_TABLES,
  TABLE_USER_INSTALL,
  type BqField,
  type DailySourceRow,
  type UserDailyRow,
} from "./analyticsProfiles";
import { pseudonymizeAnalyticsId } from "./analyticsPseudonym";
import { USER_INSTALL_SCHEMA } from "./personAxis";
import {
  TEAM_USAGE_DAILY_SCHEMA,
  TEAM_USAGE_UNATTRIBUTED_SCHEMA,
  VIEW_TEAM_USAGE_DAILY,
  VIEW_TEAM_USAGE_UNATTRIBUTED,
} from "./teamUsage";

// ═══════════════════════════════════════════════════════════════════════════
// 1) 축 분리 — 주석은 안 읽힐 수 있으니 기계가 읽는다
// ═══════════════════════════════════════════════════════════════════════════

test("익명축 스키마 3종에 계정축 컬럼이 없다", () => {
  assertAxisPurity(TABLE_USER_DAILY, USER_DAILY_SCHEMA);
  assertAxisPurity(TABLE_INSTALL_PROFILE, INSTALL_PROFILE_SCHEMA);
  assertAxisPurity(TABLE_ACCOUNT_PROFILE, ACCOUNT_PROFILE_SCHEMA);
});

test("★install_profile 에 user_key 를 붙이면 즉시 실패한다", () => {
  const tainted: BqField[] = [
    ...INSTALL_PROFILE_SCHEMA,
    { name: "user_key", type: "STRING", mode: "NULLABLE" },
  ];
  assert.throws(
    () => assertAxisPurity(TABLE_INSTALL_PROFILE, tainted),
    /조인 키를 만들지 마라/
  );
});

test("★account_profile 에 install_key 를 붙이면 즉시 실패한다(반대 방향)", () => {
  const tainted: BqField[] = [
    ...ACCOUNT_PROFILE_SCHEMA,
    { name: "install_key", type: "STRING", mode: "NULLABLE" },
  ];
  assert.throws(
    () => assertAxisPurity(TABLE_ACCOUNT_PROFILE, tainted),
    /조인 키를 만들지 마라/
  );
});

test("중첩 RECORD 안에 숨긴 조인 키도 잡는다", () => {
  const tainted: BqField[] = [
    { name: "install_key", type: "STRING", mode: "REQUIRED" },
    {
      name: "model_mix",
      type: "RECORD",
      mode: "REPEATED",
      fields: [
        { name: "model", type: "STRING", mode: "NULLABLE" },
        { name: "uid", type: "STRING", mode: "NULLABLE" },
      ],
    },
  ];
  assert.throws(
    () => assertAxisPurity(TABLE_INSTALL_PROFILE, tainted),
    /model_mix\.uid/
  );
});

test("★비용·캐시 컬럼은 익명축에서 거부된다(계정축에서만 나오는 값)", () => {
  for (const name of [
    "cost_usd",
    "cache_read_tokens",
    "cache_hit_rate",
    "is_admin",
  ]) {
    assert.throws(
      () =>
        assertAxisPurity(TABLE_USER_DAILY, [
          { name: "install_key", type: "STRING", mode: "REQUIRED" },
          { name, type: "FLOAT64", mode: "NULLABLE" },
        ]),
      new RegExp(name),
      `${name} 이 익명축에서 통과했다`
    );
  }
});

test("축이 선언되지 않은 테이블은 통과시키지 않는다", () => {
  assert.throws(
    () => assertAxisPurity("analytics_something_new", []),
    /축이 선언되지 않은 테이블/
  );
  // 목록 자체도 겹치지 않아야 한다.
  for (const t of ANONYMOUS_AXIS_TABLES) {
    assert.ok(!ACCOUNT_AXIS_TABLES.includes(t), `${t} 이 양쪽에 있다`);
    assert.ok(!LINK_AXIS_TABLES.includes(t), `${t} 이 익명축과 링크축 양쪽에 있다`);
  }
  for (const t of ACCOUNT_AXIS_TABLES) {
    assert.ok(!LINK_AXIS_TABLES.includes(t), `${t} 이 계정축과 링크축 양쪽에 있다`);
  }
});

// ── 팀 오버뷰 뷰 (#1103 설계 §4.2) ──────────────────────────────────────────
//
// ★"조심하겠다" 가 아니라 기계가 대신 읽는다. 뷰를 계정축에 **등재**했으므로
//   누가 나중에 뷰에 익명축 조인키를 더하면 아래 테스트가 깨진다.

test("팀 오버뷰 뷰 두 벌이 계정축에 등재돼 있고 축 검사를 통과한다", () => {
  assert.ok(ACCOUNT_AXIS_TABLES.includes(VIEW_TEAM_USAGE_DAILY));
  assert.ok(ACCOUNT_AXIS_TABLES.includes(VIEW_TEAM_USAGE_UNATTRIBUTED));
  assertAxisPurity(VIEW_TEAM_USAGE_DAILY, TEAM_USAGE_DAILY_SCHEMA as BqField[]);
  assertAxisPurity(
    VIEW_TEAM_USAGE_UNATTRIBUTED,
    TEAM_USAGE_UNATTRIBUTED_SCHEMA as BqField[]
  );
});

test("★팀 오버뷰 뷰에 익명축 조인키를 더하면 즉시 실패한다", () => {
  for (const name of ["install_key", "client_id", "ga_key", "install_label"]) {
    assert.throws(
      () =>
        assertAxisPurity(VIEW_TEAM_USAGE_DAILY, [
          ...(TEAM_USAGE_DAILY_SCHEMA as BqField[]),
          { name, type: "STRING", mode: "NULLABLE" },
        ]),
      new RegExp(name),
      `${name} 이 팀 오버뷰 뷰에서 통과했다`
    );
  }
});

test("★귀속 불가 뷰에는 금액·토큰 컬럼이 자리조차 없다 — 크로스테넌트 방지", () => {
  // 귀속 못 하는 행은 조회자가 속하지 않은 프로젝트의 지출일 수 있다(설계 §5.3-3).
  // 규모(행 수)만 낸다는 약속을 스키마 상수로 못 박는다.
  assert.deepEqual(
    TEAM_USAGE_UNATTRIBUTED_SCHEMA.map((f) => f.name),
    ["day", "account_uid", "rows_n"]
  );
});

// ── 링크축 추가분 (ticket cZWmTzoOXpHCg9HAUwqw / 사람 축 설계 §4, §6.1) ──────
//
// ★축이 셋이 됐다고 익명축이 넓어진 것이 아니다. 아래 첫 테스트가 그 사실을
//   못 박는다 — FORBIDDEN_ON_ANONYMOUS_AXIS 에서 항목이 빠지면 빨개진다.

test("★★익명축 금지 목록은 사람 축이 생겨도 한 항목도 줄지 않는다", () => {
  // #1079 가 넣은 목록이다. 사람 축을 열려고 여기서 user_key 를 빼는 것이
  // 가장 쉬운 우회로이고, 그래서 여기가 제일 먼저 빨개져야 한다.
  for (const name of [
    "user_key",
    "user_id",
    "uid",
    "account_key",
    "email",
    "cost_usd",
    "mrr_usd",
    "ltv_usd",
    "cache_hit_rate",
    "is_admin",
  ]) {
    assert.ok(
      FORBIDDEN_ON_ANONYMOUS_AXIS.includes(name),
      `${name} 이 익명축 금지 목록에서 사라졌다`
    );
  }
  // 그리고 실제로 계속 잡는다(목록만 있고 검사가 안 도는 상태 방지).
  assert.throws(
    () =>
      assertAxisPurity(TABLE_USER_DAILY, [
        ...USER_DAILY_SCHEMA,
        { name: "user_key", type: "STRING", mode: "NULLABLE" },
      ]),
    /user_key/
  );
});

test("링크표 스키마는 링크축에서 통과한다 — 두 키를 한 행에 담는 유일한 자리", () => {
  assertAxisPurity(TABLE_USER_INSTALL, USER_INSTALL_SCHEMA as BqField[]);
});

test("★같은 스키마를 익명축 표에 넣으면 여전히 거부된다", () => {
  // 링크축이 허용됐다고 익명축이 함께 열린 게 아니라는 확인.
  assert.throws(
    () => assertAxisPurity(TABLE_USER_DAILY, USER_INSTALL_SCHEMA as BqField[]),
    /user_key/
  );
});

test("★링크표에 원시 식별자를 붙이면 즉시 실패한다 — 가명 매핑이지 명부가 아니다", () => {
  for (const name of ["uid", "email", "person_key", "ip", "device_name"]) {
    assert.throws(
      () =>
        assertAxisPurity(TABLE_USER_INSTALL, [
          ...(USER_INSTALL_SCHEMA as BqField[]),
          { name, type: "STRING", mode: "NULLABLE" },
        ]),
      new RegExp(name),
      `${name} 이 링크축에서 통과했다`
    );
    assert.ok(FORBIDDEN_ON_LINK_AXIS.includes(name));
  }
});

test("★링크축 목록은 표 하나다 — 잇는 자리가 늘면 되돌리기가 깨진다", () => {
  // 링크표를 지우면 사람 축이 통째로 사라진다는 성질은 "잇는 자리가 하나뿐"
  // 이라는 사실에 걸려 있다(설계 §4.2-5).
  assert.equal(LINK_AXIS_TABLES.length, 1);
  assert.equal(LINK_AXIS_TABLES[0], TABLE_USER_INSTALL);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2) analytics_user_daily — active 정의와 present_only 격리
// ═══════════════════════════════════════════════════════════════════════════

const INSTALL_A = "aaaaaaaa-1111-2222-3333-444444444444"; // 36자 = uuid36

test("★하트비트만 35,170건인 좀비는 active 가 아니라 present_only 다", () => {
  const rows: DailySourceRow[] = [
    {
      installKey: INSTALL_A,
      day: "2026-08-01",
      workingBeats: 0,
      presenceBeats: 35170,
      eventCount: 0,
    },
  ];
  const [row] = buildUserDailyRows(rows);
  assert.equal(row.active, false, "working 0 · 이벤트 0 인데 활동으로 잡혔다");
  assert.equal(row.present_only, true);
  assert.equal(row.presence_beats, 35170);
});

test("working 하트비트 1건이면 active, 이벤트 1건이어도 active", () => {
  const byWorking = buildUserDailyRows([
    {
      installKey: INSTALL_A,
      day: "2026-08-01",
      workingBeats: 1,
      presenceBeats: 900,
    },
  ])[0];
  assert.equal(byWorking.active, true);
  assert.equal(byWorking.present_only, false);

  const byEvent = buildUserDailyRows([
    {
      installKey: INSTALL_A,
      day: "2026-08-01",
      workingBeats: 0,
      presenceBeats: 900,
      eventCount: 1,
    },
  ])[0];
  assert.equal(byEvent.active, true);
  assert.equal(byEvent.present_only, false);
});

test("active 와 present_only 는 배타적이다", () => {
  const rows = buildUserDailyRows([
    {
      installKey: INSTALL_A,
      day: "2026-08-01",
      workingBeats: 3,
      presenceBeats: 10,
    },
    {
      installKey: INSTALL_A,
      day: "2026-08-02",
      workingBeats: 0,
      presenceBeats: 10,
    },
    {
      installKey: INSTALL_A,
      day: "2026-08-03",
      workingBeats: 0,
      presenceBeats: 0,
    },
  ]);
  for (const r of rows) {
    assert.ok(!(r.active && r.present_only), `${r.day} 가 양쪽 다 true 다`);
  }
  assert.deepEqual(
    rows.map((r) => [r.active, r.present_only]),
    [
      [true, false],
      [false, true],
      [false, false], // 신호가 아예 없는 날은 둘 다 아니다
    ]
  );
});

test("같은 (설치,날짜)가 소스별로 쪼개져 와도 합쳐진다", () => {
  const rows = buildUserDailyRows([
    {
      installKey: INSTALL_A,
      day: "2026-08-01",
      eventCount: 2,
      tokensInput: 100,
      models: [{ model: "opus", calls: 1 }],
    },
    {
      installKey: INSTALL_A,
      day: "2026-08-01",
      workingBeats: 5,
      presenceBeats: 20,
    },
    {
      installKey: INSTALL_A,
      day: "2026-08-01",
      tokensOutput: 50,
      models: [{ model: "opus", calls: 2 }],
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].event_count, 2);
  assert.equal(rows[0].working_beats, 5);
  assert.equal(rows[0].tokens_total, 150);
  assert.deepEqual(rows[0].models, [{ model: "opus", calls: 3 }]);
});

test('clientId 미제공 폴백("anon")과 잘못된 날짜는 버린다', () => {
  const rows = buildUserDailyRows([
    { installKey: "anon", day: "2026-08-01", eventCount: 9 },
    { installKey: "", day: "2026-08-01", eventCount: 9 },
    { installKey: INSTALL_A, day: "not-a-date", eventCount: 9 },
    { installKey: INSTALL_A, day: "2026-08-01", eventCount: 1 },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].install_key, INSTALL_A);
});

test("★daily 는 raw install_key 를 보존하고 HMAC 보조 컬럼을 새로 채운다", () => {
  const salt = "test-salt-not-a-real-secret";
  const [row] = buildUserDailyRows(
    [{ installKey: INSTALL_A, day: "2026-08-01", eventCount: 1 }],
    salt
  );
  assert.equal(row.install_key, INSTALL_A);
  assert.equal(
    row.install_key_hmac,
    pseudonymizeAnalyticsId("install", INSTALL_A, salt)
  );
  assert.match(String(row.install_key_hmac), /^in_[0-9a-f]{24}$/);
});

test("★salt 가 없으면 raw fallback 하지 않고 install_key_hmac 은 null 이다", () => {
  const [row] = buildUserDailyRows([
    { installKey: INSTALL_A, day: "2026-08-01", eventCount: 1 },
  ]);
  assert.equal(row.install_key, INSTALL_A);
  assert.equal(row.install_key_hmac, null);
});

test("★daily 행에 비용 필드가 없다(계정축 개념)", () => {
  const [row] = buildUserDailyRows([
    { installKey: INSTALL_A, day: "2026-08-01", eventCount: 1 },
  ]);
  const keys = Object.keys(row).map((k) => k.toLowerCase());
  for (const banned of ["cost", "cost_usd", "cache_read_tokens", "user_key"]) {
    assert.ok(!keys.includes(banned), `daily 행에 ${banned} 가 있다`);
  }
  // models STRUCT 도 cost 로 넓히면 안 된다.
  const withModels = buildUserDailyRows([
    {
      installKey: INSTALL_A,
      day: "2026-08-01",
      models: [{ model: "opus", calls: 1, cost: 9.9 }],
    },
  ])[0];
  assert.deepEqual(Object.keys(withModels.models[0]).sort(), [
    "calls",
    "model",
  ]);
});

// ── id_scheme ───────────────────────────────────────────────────────────────

test("id_scheme 은 uid 28자 / UUID 36자 / 그 외 unknown", () => {
  assert.equal(classifyIdScheme("a".repeat(28)), "legacy_uid28");
  assert.equal(classifyIdScheme("a".repeat(36)), "uuid36");
  assert.equal(classifyIdScheme("short"), "unknown");
});

test("★가명 install_key 는 원시 길이를 받아야 스킴을 안다(모르면 unknown)", () => {
  // 선행 티켓이 install_key 를 HMAC 가명으로 바꾸면 길이 정보가 사라진다.
  assert.equal(classifyIdScheme("in_0123456789abcdef01234567"), "unknown");
  assert.equal(
    classifyIdScheme("in_0123456789abcdef01234567", 28),
    "legacy_uid28"
  );
  assert.equal(classifyIdScheme("in_0123456789abcdef01234567", 36), "uuid36");
});

// ═══════════════════════════════════════════════════════════════════════════
// 3) analytics_install_profile — 리텐션 두 정의 · 스트릭 · 좀비
// ═══════════════════════════════════════════════════════════════════════════

/** 활동일 목록으로 daily 행을 만든다(전부 이벤트 1건 = active). */
function dailyFor(
  installKey: string,
  activeDays: string[],
  presentOnlyDays: string[] = []
): UserDailyRow[] {
  return buildUserDailyRows([
    ...activeDays.map((day) => ({ installKey, day, eventCount: 1 })),
    ...presentOnlyDays.map((day) => ({
      installKey,
      day,
      presenceBeats: 100,
      workingBeats: 0,
    })),
  ]);
}

test("★D7 exact 와 window 가 갈린다 — 어느 쪽을 인용하는지가 결론을 바꾼다", () => {
  // 첫 활동 08-01. 08-04 에 한 번 더 왔고 08-08(=+7일) 에는 안 왔다.
  //  → exact(정확히 +7일 당일)   = false
  //  → window(+1 ~ +7 사이 하루) = true
  const daily = dailyFor(INSTALL_A, ["2026-08-01", "2026-08-04"]);
  const [p] = buildInstallProfileRows({ today: "2026-08-20", daily });
  assert.equal(p.first_active_day, "2026-08-01");
  assert.equal(p.d7_pending, false);
  assert.equal(p.d7_exact, false, "exact 가 window 처럼 계산됐다");
  assert.equal(p.d7_window, true);
});

test("D7 exact 는 +7일 **당일** 활동만 센다", () => {
  const daily = dailyFor(INSTALL_A, ["2026-08-01", "2026-08-08"]);
  const [p] = buildInstallProfileRows({ today: "2026-08-20", daily });
  assert.equal(p.d7_exact, true);
  assert.equal(p.d7_window, true);
});

test("window 는 day 0 을 분자에 넣지 않는다(첫날만 쓴 설치는 이탈)", () => {
  const daily = dailyFor(INSTALL_A, ["2026-08-01"]);
  const [p] = buildInstallProfileRows({ today: "2026-08-20", daily });
  assert.equal(p.d1_window, false);
  assert.equal(p.d1_exact, false);
  assert.equal(p.d7_window, false);
});

test("★관측창 미도달은 pending — 분자에도 분모에도 안 들어간다", () => {
  // 오늘이 첫 활동 +3일. D1/D3 는 판정 가능, D7/D14/D30 은 불가.
  const daily = dailyFor(INSTALL_A, ["2026-08-18"]);
  const [p] = buildInstallProfileRows({ today: "2026-08-21", daily });
  assert.equal(p.d1_pending, false);
  assert.equal(p.d3_pending, false);
  assert.equal(p.d7_pending, true);
  assert.equal(p.d7_exact, null, "pending 인데 exact 가 false 로 찍혔다");
  assert.equal(p.d7_window, null);
  assert.equal(p.d14_pending, true);
  assert.equal(p.d30_pending, true);
});

test("★좀비는 first_active_day 가 null 이라 코호트에 못 들어간다", () => {
  const daily = dailyFor(
    INSTALL_A,
    [],
    ["2026-08-01", "2026-08-02", "2026-08-03"]
  );
  const [p] = buildInstallProfileRows({ today: "2026-08-21", daily });
  assert.equal(p.first_active_day, null);
  assert.equal(p.active_days, 0);
  assert.equal(p.present_only_days, 3);
  assert.equal(p.zombie, true);
  assert.equal(p.d7_pending, true);
});

test("active_days 와 present_only_days 는 겹치지 않는다", () => {
  const daily = dailyFor(
    INSTALL_A,
    ["2026-08-01", "2026-08-02"],
    ["2026-08-03", "2026-08-04", "2026-08-05"]
  );
  const [p] = buildInstallProfileRows({ today: "2026-08-21", daily });
  assert.equal(p.active_days, 2);
  assert.equal(p.present_only_days, 3);
  assert.equal(p.observed_days, 5);
  assert.equal(p.zombie, false, "활동일이 있는데 좀비로 찍혔다");
});

test("max_streak / current_streak — 끊긴 연속은 current 가 아니다", () => {
  const daily = dailyFor(INSTALL_A, [
    "2026-08-01",
    "2026-08-02",
    "2026-08-03", // 3연속
    "2026-08-10",
    "2026-08-11", // 2연속(마지막)
  ]);
  const stale = buildInstallProfileRows({ today: "2026-08-21", daily })[0];
  assert.equal(stale.max_streak, 3);
  assert.equal(stale.current_streak, 0, "10일 전에 끊긴 연속이 현재로 잡혔다");
  assert.equal(stale.days_since_last_active, 10);

  // 어제까지 이어졌으면 살아 있는 것으로 본다(오늘은 부분 집계).
  const fresh = buildInstallProfileRows({ today: "2026-08-12", daily })[0];
  assert.equal(fresh.current_streak, 2);
});

test("first_touch 와 이정표를 승계한다 — 첫 실행은 이벤트가 링크시각보다 우선", () => {
  const daily = dailyFor(INSTALL_A, ["2026-08-01"]);
  const [p] = buildInstallProfileRows({
    today: "2026-08-21",
    daily,
    firstTouch: [
      {
        installKey: INSTALL_A,
        gaKey: "GA1.1.999",
        utmSource: "producthunt",
        utmMedium: "referral",
        referrerHost: "www.producthunt.com",
        firstVisitAt: "2026-07-30T00:00:00.000Z",
        linkedAt: "2026-08-01T10:00:00.000Z",
      },
    ],
    milestones: [
      {
        installKey: INSTALL_A,
        firstRunAt: "2026-08-01T09:00:00.000Z",
        firstSpawnAt: "2026-08-01T09:30:00.000Z",
        firstCompletedAt: "2026-08-02T11:00:00.000Z",
      },
    ],
  });
  assert.equal(p.ga_key, "GA1.1.999");
  assert.equal(p.ft_utm_source, "producthunt");
  assert.equal(p.first_visit_at, "2026-07-30T00:00:00.000Z");
  assert.equal(p.first_run_at, "2026-08-01T09:00:00.000Z");
  assert.equal(p.first_spawn_at, "2026-08-01T09:30:00.000Z");
  assert.equal(p.first_completed_at, "2026-08-02T11:00:00.000Z");
});

test("first_touch 가 중복으로 와도 가장 이른 linkedAt 을 남긴다(first-touch)", () => {
  const daily = dailyFor(INSTALL_A, ["2026-08-01"]);
  const [p] = buildInstallProfileRows({
    today: "2026-08-21",
    daily,
    firstTouch: [
      {
        installKey: INSTALL_A,
        utmSource: "later",
        linkedAt: "2026-08-05T00:00:00.000Z",
      },
      {
        installKey: INSTALL_A,
        utmSource: "first",
        linkedAt: "2026-08-01T00:00:00.000Z",
      },
    ],
  });
  assert.equal(p.ft_utm_source, "first", "재방문 채널이 first-touch 를 덮었다");
});

test("★success_rate 는 분자·분모와 함께 저장된다 (분모 0 이면 null)", () => {
  const daily = buildUserDailyRows([
    {
      installKey: INSTALL_A,
      day: "2026-08-01",
      eventCount: 1,
      tasksCompleted: 1,
      tasksFailed: 1,
    },
  ]);
  const [p] = buildInstallProfileRows({ today: "2026-08-21", daily });
  assert.equal(p.tasks_completed, 1);
  assert.equal(p.tasks_failed, 1);
  assert.equal(p.tasks_attempted, 2);
  assert.equal(p.success_rate, 0.5);
  assert.equal(p.success_display, "1/2 (50.0%)");

  const none = buildInstallProfileRows({
    today: "2026-08-21",
    daily: dailyFor(INSTALL_A, ["2026-08-01"]),
  })[0];
  assert.equal(none.tasks_attempted, 0);
  assert.equal(none.success_rate, null, "분모 0 이 0% 로 찍혔다");
  assert.equal(none.success_display, "0/0 (—)");
});

test("model_mix 는 share 를 담되 분모 0 이면 null", () => {
  const daily = buildUserDailyRows([
    {
      installKey: INSTALL_A,
      day: "2026-08-01",
      eventCount: 1,
      models: [
        { model: "opus", calls: 3 },
        { model: "haiku", calls: 1 },
      ],
    },
  ]);
  const [p] = buildInstallProfileRows({ today: "2026-08-21", daily });
  assert.deepEqual(p.model_mix, [
    { model: "opus", calls: 3, share: 0.75 },
    { model: "haiku", calls: 1, share: 0.25 },
  ]);

  const empty = buildInstallProfileRows({
    today: "2026-08-21",
    daily: dailyFor(INSTALL_A, ["2026-08-01"]),
  })[0];
  assert.deepEqual(empty.model_mix, []);
});

test("top_errors 는 상한을 지키고 빈도 순으로 자른다", () => {
  const daily = buildUserDailyRows([
    {
      installKey: INSTALL_A,
      day: "2026-08-01",
      eventCount: 1,
      errorCategories: [
        { category: "timeout", count: 5 },
        { category: "auth", count: 3 },
        { category: "quota", count: 1 },
      ],
    },
  ]);
  const [p] = buildInstallProfileRows({
    today: "2026-08-21",
    daily,
    topErrorLimit: 2,
  });
  assert.deepEqual(p.top_errors, [
    { category: "timeout", count: 5 },
    { category: "auth", count: 3 },
  ]);
});

test("★install_profile 행에 계정축 값이 하나도 없다", () => {
  const [p] = buildInstallProfileRows({
    today: "2026-08-21",
    daily: dailyFor(INSTALL_A, ["2026-08-01"]),
  });
  const keys = Object.keys(p).map((k) => k.toLowerCase());
  for (const banned of [
    "user_key",
    "uid",
    "total_cost_usd",
    "cost_usd",
    "cache_hit_rate",
    "cache_read_tokens",
    "is_admin",
    "plan",
    "mrr_usd",
    "ltv_usd",
    "first_paid_at",
  ]) {
    assert.ok(!keys.includes(banned), `install_profile 에 ${banned} 가 있다`);
  }
});

// ── ★분자·분모 롤업 ─────────────────────────────────────────────────────────

test("★summarizeInstallRetention 이 1/2 (50.0%) 를 만들어 준다", () => {
  // 두 설치 다 08-01 첫 활동. 하나는 08-08 복귀, 하나는 안 옴.
  const daily = [
    ...dailyFor("i-retained-aaaaaaaaaaaaaaaaaaaaaaaaaa", [
      "2026-08-01",
      "2026-08-08",
    ]),
    ...dailyFor("i-churned-bbbbbbbbbbbbbbbbbbbbbbbbbb", ["2026-08-01"]),
  ];
  const profiles = buildInstallProfileRows({ today: "2026-08-21", daily });
  const s = summarizeInstallRetention(profiles);
  const d7 = s.horizons.find((h) => h.key === "d7");
  assert.ok(d7);
  assert.equal(d7.exact.numerator, 1);
  assert.equal(d7.exact.denominator, 2);
  assert.equal(d7.exact.display, "1/2 (50.0%)");
  assert.equal(d7.pending, 0);
  assert.equal(s.installsCohort, 2);
});

test("★pending 설치는 분모에서 빠진다 — 어제 들어온 신규가 이탈로 찍히지 않는다", () => {
  const daily = [
    ...dailyFor("i-old-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", [
      "2026-08-01",
      "2026-08-08",
    ]),
    ...dailyFor("i-new-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", ["2026-08-20"]),
  ];
  const s = summarizeInstallRetention(
    buildInstallProfileRows({ today: "2026-08-21", daily })
  );
  const d7 = s.horizons.find((h) => h.key === "d7");
  assert.ok(d7);
  assert.equal(d7.pending, 1);
  assert.equal(d7.exact.denominator, 1, "관측창 미도달 설치가 분모에 들어갔다");
  assert.equal(d7.exact.display, "1/1 (100.0%)");
});

test("★분모 0 은 0% 가 아니라 '—'(판단 불가)", () => {
  const s = summarizeInstallRetention([]);
  for (const h of s.horizons) {
    assert.equal(h.exact.rate, null);
    assert.equal(h.exact.display, "0/0 (—)");
  }
  assert.equal(s.installsCohort, 0);
});

test("좀비는 코호트 분모에 안 들어가고 따로 세어진다", () => {
  const daily = [
    ...dailyFor("i-real-aaaaaaaaaaaaaaaaaaaaaaaaaaaaa", [
      "2026-08-01",
      "2026-08-08",
    ]),
    ...dailyFor(
      "i-zomb-bbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      [],
      ["2026-08-01", "2026-08-02"]
    ),
  ];
  const s = summarizeInstallRetention(
    buildInstallProfileRows({ today: "2026-08-21", daily })
  );
  assert.equal(s.installsObserved, 2);
  assert.equal(s.installsZombie, 1);
  assert.equal(s.installsNeverActive, 1);
  assert.equal(s.installsNeverRan, 0, "좀비가 미실행으로도 세어졌다");
  assert.equal(s.installsCohort, 1, "좀비가 코호트에 들어갔다");
});

test("★어트리뷰션만 있고 활동이 없는 설치도 행이 생긴다(다운로드 후 미실행)", () => {
  // 실측(2026-08-21): 어트리뷰션 550건 대비 최근 활동 설치는 8개였다. 활동
  // 행에서만 프로필을 만들면 "다운로드는 했는데 한 번도 안 쓴 사람" 이 통째로
  // 사라져 활성화 퍼널 분모가 8이 된다.
  const profiles = buildInstallProfileRows({
    today: "2026-08-21",
    daily: dailyFor(INSTALL_A, ["2026-08-01", "2026-08-08"]),
    firstTouch: [
      { installKey: INSTALL_A, utmSource: "producthunt" },
      { installKey: "i-never-ran-cccccccccccccccccccccc", utmSource: "x" },
    ],
  });
  assert.equal(profiles.length, 2, "미실행 설치가 조용히 빠졌다");
  const never = profiles.find(
    (p) => p.install_key === "i-never-ran-cccccccccccccccccccccc"
  );
  assert.ok(never);
  assert.equal(never.observed_days, 0);
  assert.equal(never.active_days, 0);
  assert.equal(never.present_only_days, 0);
  assert.equal(never.first_active_day, null);
  assert.equal(never.ft_utm_source, "x", "first-touch 가 안 붙었다");
  // ★좀비가 아니다 — 하트비트조차 없다. 원인이 다르면 다르게 세야 한다.
  assert.equal(never.zombie, false);
});

test("★미실행과 좀비를 갈라서 센다(원인이 다르다)", () => {
  const profiles = buildInstallProfileRows({
    today: "2026-08-21",
    daily: [
      ...dailyFor("i-real-aaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ["2026-08-01"]),
      ...dailyFor("i-zomb-bbbbbbbbbbbbbbbbbbbbbbbbbbbbb", [], ["2026-08-01"]),
    ],
    firstTouch: [{ installKey: "i-never-ran-cccccccccccccccccccccc" }],
  });
  const s = summarizeInstallRetention(profiles);
  assert.equal(s.installsObserved, 3);
  assert.equal(s.installsNeverActive, 2);
  assert.equal(s.installsZombie, 1);
  assert.equal(s.installsNeverRan, 1);
  assert.equal(s.installsCohort, 1);
  // 합이 맞아야 한다 — 어느 쪽에도 안 들어간 설치가 생기면 인원이 새는 것이다.
  assert.equal(
    s.installsZombie + s.installsNeverRan + s.installsCohort,
    s.installsObserved
  );
});

test("★D7/D14 정의 문자열이 요약에 실려 나간다(화면이 그대로 적게)", () => {
  const s = summarizeInstallRetention([]);
  assert.ok(s.horizonDefinitions.includes(HORIZON_DEFINITION_EXACT));
  assert.ok(s.horizonDefinitions.includes(HORIZON_DEFINITION_WINDOW));
  assert.ok(s.horizonDefinitions.includes(HORIZON_DEFINITION_PENDING));
  assert.ok(s.activityDefinition.includes("working"));
  assert.ok(s.presentOnlyDefinition.includes("35,170"));
  // 지평은 지시 스펙 그대로 다섯이다.
  assert.deepEqual(
    PROFILE_HORIZONS.map((h) => h.key),
    ["d1", "d3", "d7", "d14", "d30"]
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 4) analytics_account_profile — 계정축
// ═══════════════════════════════════════════════════════════════════════════

const UID = "uid-account-0001";

test("cost_logs 를 계정으로 접고 캐시 히트율을 분자·분모로 저장한다", () => {
  const [row] = buildAccountProfileRows({
    costs: [
      {
        userKey: UID,
        day: "2026-08-01",
        model: "opus",
        inputTokens: 100,
        outputTokens: 40,
        cacheReadTokens: 300,
        cacheWriteTokens: 50,
        totalCost: 1.25,
      },
      {
        userKey: UID,
        day: "2026-08-02",
        model: "haiku",
        inputTokens: 100,
        outputTokens: 10,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalCost: 0.05,
      },
    ],
  });
  assert.equal(row.user_key, UID);
  assert.equal(row.input_tokens, 200);
  assert.equal(row.cache_read_tokens, 300);
  // 분자 300 / 분모 (input 200 + cacheRead 300) = 500
  assert.equal(row.cache_hit_numerator, 300);
  assert.equal(row.cache_hit_denominator, 500);
  assert.equal(row.cache_hit_rate, 0.6);
  assert.equal(row.cache_hit_display, "300/500 (60.0%)");
  assert.equal(row.total_cost_usd, 1.3);
  assert.equal(row.cost_days, 2);
  assert.equal(row.first_cost_at, "2026-08-01");
  assert.equal(row.last_cost_at, "2026-08-02");
});

test("캐시 분모 0 이면 rate 는 0 이 아니라 null", () => {
  const [row] = buildAccountProfileRows({
    costs: [{ userKey: UID, day: "2026-08-01", model: "opus", totalCost: 0.1 }],
  });
  assert.equal(row.cache_hit_denominator, 0);
  assert.equal(row.cache_hit_rate, null);
  assert.equal(row.cache_hit_display, "0/0 (—)");
});

test("is_admin 은 ADMIN_UID 기준 — 새 판정 규약을 만들지 않는다", () => {
  const rows = buildAccountProfileRows({
    costs: [
      { userKey: UID, day: "2026-08-01", totalCost: 1 },
      { userKey: "uid-operator", day: "2026-08-01", totalCost: 1 },
    ],
    adminUid: "uid-operator",
  });
  const byKey = new Map(rows.map((r) => [r.user_key, r]));
  assert.equal(byKey.get("uid-operator")?.is_admin, true);
  assert.equal(byKey.get(UID)?.is_admin, false);
});

test("ADMIN_UID 미설정이면 아무도 운영자가 아니다(빈 문자열이 매칭되지 않는다)", () => {
  const rows = buildAccountProfileRows({
    costs: [
      { userKey: "", day: "2026-08-01" },
      { userKey: UID, day: "2026-08-01" },
    ],
    adminUid: "",
  });
  assert.equal(rows.length, 1, "빈 userKey 행이 살아남았다");
  assert.equal(rows[0].is_admin, false);
});

test("★결제만 있고 사용 기록이 없는 계정도 행이 생긴다(조용히 빼면 유료가 줄어 보인다)", () => {
  const rows = buildAccountProfileRows({
    costs: [],
    billing: [
      {
        userKey: "uid-paid-no-usage",
        firstPaidAt: "2026-07-01T00:00:00.000Z",
        plan: "pro",
        mrrUsd: 20,
        ltvUsd: 40,
      },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].first_paid_at, "2026-07-01T00:00:00.000Z");
  assert.equal(rows[0].plan, "pro");
  assert.equal(rows[0].mrr_usd, 20);
  assert.equal(rows[0].ltv_usd, 40);
  assert.equal(rows[0].total_cost_usd, 0);
  assert.equal(rows[0].cost_days, 0);
});

test("결제 정보가 없으면 plan/mrr/ltv 는 0 이 아니라 null", () => {
  const [row] = buildAccountProfileRows({
    costs: [{ userKey: UID, day: "2026-08-01", totalCost: 1 }],
  });
  assert.equal(row.plan, null);
  assert.equal(
    row.mrr_usd,
    null,
    "무료 사용자와 '아직 모름' 이 같은 값이 됐다"
  );
  assert.equal(row.ltv_usd, null);
  assert.equal(row.first_paid_at, null);
});

test("★account_profile 행에 익명축 값이 하나도 없다", () => {
  const [row] = buildAccountProfileRows({
    costs: [{ userKey: UID, day: "2026-08-01", totalCost: 1 }],
  });
  const keys = Object.keys(row).map((k) => k.toLowerCase());
  for (const banned of [
    "install_key",
    "ga_key",
    "client_id",
    "active_days",
    "present_only_days",
    "d7_exact",
  ]) {
    assert.ok(!keys.includes(banned), `account_profile 에 ${banned} 가 있다`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 5) 멱등 — 같은 입력이면 같은 행(스케줄 재실행이 테이블을 흔들지 않는다)
// ═══════════════════════════════════════════════════════════════════════════

test("★같은 입력을 두 번 돌리면 완전히 같은 행이 나온다(순서까지)", () => {
  const src: DailySourceRow[] = [
    {
      installKey: "i-bbb-2222222222222222222222222222",
      day: "2026-08-02",
      eventCount: 1,
    },
    {
      installKey: "i-aaa-1111111111111111111111111111",
      day: "2026-08-01",
      workingBeats: 2,
      presenceBeats: 9,
    },
    {
      installKey: "i-aaa-1111111111111111111111111111",
      day: "2026-08-03",
      eventCount: 4,
    },
  ];
  const first = buildUserDailyRows(src);
  const second = buildUserDailyRows([...src].reverse());
  assert.deepEqual(second, first, "입력 순서가 결과를 바꿨다 — 멱등이 아니다");

  const p1 = buildInstallProfileRows({ today: "2026-08-21", daily: first });
  const p2 = buildInstallProfileRows({ today: "2026-08-21", daily: second });
  assert.deepEqual(p2, p1);

  const a1 = buildAccountProfileRows({
    costs: [
      { userKey: "uid-2", day: "2026-08-01", model: "opus", totalCost: 1 },
      { userKey: "uid-1", day: "2026-08-01", model: "haiku", totalCost: 2 },
    ],
  });
  const a2 = buildAccountProfileRows({
    costs: [
      { userKey: "uid-1", day: "2026-08-01", model: "haiku", totalCost: 2 },
      { userKey: "uid-2", day: "2026-08-01", model: "opus", totalCost: 1 },
    ],
  });
  assert.deepEqual(a2, a1);
});

test("빌드 결과의 모든 컬럼이 스키마에 선언돼 있다(적재 시 no such field 방지)", () => {
  const declared = (fields: ReadonlyArray<BqField>) =>
    new Set(fields.map((f) => f.name));

  const daily = buildUserDailyRows([
    { installKey: INSTALL_A, day: "2026-08-01", eventCount: 1 },
  ]);
  const dailyFields = declared(USER_DAILY_SCHEMA);
  for (const k of Object.keys(daily[0])) {
    assert.ok(dailyFields.has(k), `USER_DAILY_SCHEMA 에 ${k} 가 없다`);
  }

  const profile = buildInstallProfileRows({ today: "2026-08-21", daily })[0];
  const profileFields = declared(INSTALL_PROFILE_SCHEMA);
  for (const k of Object.keys(profile)) {
    assert.ok(profileFields.has(k), `INSTALL_PROFILE_SCHEMA 에 ${k} 가 없다`);
  }

  const account = buildAccountProfileRows({
    costs: [{ userKey: UID, day: "2026-08-01" }],
  })[0];
  const accountFields = declared(ACCOUNT_PROFILE_SCHEMA);
  for (const k of Object.keys(account)) {
    assert.ok(accountFields.has(k), `ACCOUNT_PROFILE_SCHEMA 에 ${k} 가 없다`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ★활성화 분자·분모의 모집단 (ticket sx56j9XA26yEXka8QIhr)
// ═══════════════════════════════════════════════════════════════════════════
//
// 2026-08-24 실측 재현: analytics_install_profile 606행을 출처별로 가르면
//   어트리뷰션만(이벤트 0) 564행 — first_run 564 · first_spawn 0 · 활동일 0
//   이벤트만(어트리뷰션 0)  43행 — first_run  12 · first_spawn 17 · 활동일 184
//   둘 다                    1행
// 아래 테스트들이 못박는 건 하나다 — **분자 자격이 없는 행을 분모에 넣지 않는다.**

const INSTALL_ATTR_ONLY = "bbbbbbbb-1111-2222-3333-444444444444";
const INSTALL_EVENT_ONLY = "cccccccc-1111-2222-3333-444444444444";

test("★어트리뷰션만 있고 이벤트가 0 인 설치는 활성화 분모에서 빠진다", () => {
  // 실측 모양: 링크는 왔지만(미인증 경로) events 는 한 줄도 없다.
  const rows = buildInstallProfileRows({
    today: "2026-08-24",
    daily: dailyFor(INSTALL_EVENT_ONLY, ["2026-08-18"]),
    firstTouch: [
      {
        installKey: INSTALL_ATTR_ONLY,
        gaKey: "1111111111.1111111111",
        linkedAt: "2026-08-18T02:00:00.000Z",
      },
    ],
    milestones: [
      {
        installKey: INSTALL_EVENT_ONLY,
        firstSpawnAt: "2026-08-18T05:00:00.000Z",
      },
    ],
  });
  const attr = rows.find((r) => r.install_key === INSTALL_ATTR_ONLY)!;
  const ev = rows.find((r) => r.install_key === INSTALL_EVENT_ONLY)!;

  assert.equal(attr.first_run_at, "2026-08-18T02:00:00.000Z");
  assert.equal(attr.first_run_source, "attribution");
  assert.equal(
    attr.activation_observable,
    false,
    "인증 텔레메트리가 0인데 분자 자격이 있는 것으로 잡혔다"
  );
  assert.equal(attr.first_spawn_at, null);

  // 이벤트만 있는 설치는 app:first_run 이 없어도 코호트에 들어가야 한다.
  assert.equal(ev.first_run_at, null);
  assert.equal(ev.first_run_source, "activity");
  assert.equal(ev.cohort_day, "2026-08-18");
  assert.equal(ev.activation_observable, true);
  assert.equal(ev.first_spawn_at, "2026-08-18T05:00:00.000Z");

  const sum = summarizeFirstSpawnActivation(rows);
  assert.equal(sum.installsRaw, 2);
  assert.equal(sum.installsObservable, 1);
  assert.equal(sum.excludedNoTelemetry, 1);
  assert.equal(sum.spawned, 1);
  assert.equal(sum.display, "1/1 (100.0%)", "분모에 미관측 행이 섞였다");
});

test("★고친 것: 종전 정의였다면 같은 데이터가 1/2 (50.0%) 로 보였다", () => {
  // 종전 정의(분모 = first_run_at 이 있는 모든 행)를 손으로 재현해 대조한다.
  const rows = buildInstallProfileRows({
    today: "2026-08-24",
    daily: dailyFor(INSTALL_EVENT_ONLY, ["2026-08-18"]),
    firstTouch: [
      { installKey: INSTALL_ATTR_ONLY, linkedAt: "2026-08-18T02:00:00.000Z" },
    ],
    milestones: [
      {
        installKey: INSTALL_EVENT_ONLY,
        firstRunAt: "2026-08-18T04:00:00.000Z",
        firstSpawnAt: "2026-08-18T05:00:00.000Z",
      },
    ],
  });
  const legacyDen = rows.filter((r) => r.first_run_at != null).length;
  const legacyNum = rows.filter((r) => r.first_spawn_at != null).length;
  assert.equal(legacyDen, 2);
  assert.equal(legacyNum, 1);

  const fixed = summarizeFirstSpawnActivation(rows);
  assert.equal(fixed.installsObservable, 1);
  assert.equal(fixed.spawned, 1);
  assert.notEqual(
    fixed.rate,
    legacyNum / legacyDen,
    "모집단을 갈랐는데도 종전과 같은 비율이 나온다"
  );
});

test("★한 브라우저가 만든 재설치 루프는 install_class 로 갈리고 분모에서 빠진다", () => {
  // 실측: 631 '설치' 의 고유 gaClientId 는 5개였다(539/69/16/6/1).
  const ga = "2222222222.2222222222";
  const loopKeys = Array.from(
    { length: REINSTALL_LOOP_MIN_INSTALLS },
    (_, i) => `dddddddd-1111-2222-3333-44444444440${i}`
  );
  const rows = buildInstallProfileRows({
    today: "2026-08-24",
    daily: [],
    firstTouch: loopKeys.map((installKey) => ({
      installKey,
      gaKey: ga,
      linkedAt: "2026-08-18T02:00:00.000Z",
    })),
  });
  for (const r of rows) {
    assert.equal(r.ft_browser_installs, REINSTALL_LOOP_MIN_INSTALLS);
    assert.equal(r.install_class, "reinstall_loop");
  }
  const sum = summarizeFirstSpawnActivation(rows);
  assert.equal(sum.installsRaw, REINSTALL_LOOP_MIN_INSTALLS);
  assert.equal(sum.distinctBrowsers, 1, "한 브라우저인데 여러 개로 셌다");
  assert.equal(sum.excludedReinstallLoop, REINSTALL_LOOP_MIN_INSTALLS);
  assert.equal(sum.rate, null, "분모 0 인데 0% 로 잡혔다");
});

test("dev 로 태깅된 설치는 dev_tagged 로 갈린다 — ft_build_channel NULL 은 미태깅이지 prod 가 아니다", () => {
  const rows = buildInstallProfileRows({
    today: "2026-08-24",
    daily: [],
    firstTouch: [
      {
        installKey: INSTALL_ATTR_ONLY,
        gaKey: "3333333333.3333333333",
        buildChannel: "dev",
        linkedAt: "2026-08-22T02:00:00.000Z",
      },
      {
        installKey: INSTALL_EVENT_ONLY,
        gaKey: "4444444444.4444444444",
        linkedAt: "2026-08-22T02:00:00.000Z",
      },
    ],
  });
  const byKey = new Map(rows.map((r) => [r.install_key, r]));
  assert.equal(byKey.get(INSTALL_ATTR_ONLY)!.install_class, "dev_tagged");
  assert.equal(byKey.get(INSTALL_EVENT_ONLY)!.ft_build_channel, null);
  assert.equal(
    byKey.get(INSTALL_EVENT_ONLY)!.install_class,
    "distinct",
    "채널 미태깅을 dev 로도 unknown 으로도 접으면 안 된다(ga_key 는 있다)"
  );
});

test("ga_key 가 없으면 install_class 는 unknown — 조용히 distinct 로 치지 않는다", () => {
  const [row] = buildInstallProfileRows({
    today: "2026-08-24",
    daily: [],
    firstTouch: [
      { installKey: INSTALL_ATTR_ONLY, linkedAt: "2026-08-22T02:00:00.000Z" },
    ],
  });
  assert.equal(row.ga_key, null);
  assert.equal(row.ft_browser_installs, null);
  assert.equal(row.install_class, "unknown");
});

test("weekStartMonday — 주 경계는 월요일이고 시간대 변환을 태우지 않는다", () => {
  assert.equal(weekStartMonday("2026-08-24"), "2026-08-24"); // 월요일
  assert.equal(weekStartMonday("2026-08-23"), "2026-08-17"); // 일요일
  assert.equal(weekStartMonday("2026-08-18"), "2026-08-17");
  assert.equal(weekStartMonday("nope"), null);
});

test("foldWeeklyProfileCoverage — 주차별로 코호트·관측가능·채워짐·브라우저를 센다", () => {
  const rows = buildInstallProfileRows({
    today: "2026-08-24",
    daily: dailyFor(INSTALL_EVENT_ONLY, ["2026-08-18"]),
    firstTouch: [
      {
        installKey: INSTALL_ATTR_ONLY,
        gaKey: "5555555555.5555555555",
        linkedAt: "2026-08-19T02:00:00.000Z",
      },
    ],
    milestones: [
      {
        installKey: INSTALL_EVENT_ONLY,
        firstSpawnAt: "2026-08-18T05:00:00.000Z",
      },
    ],
  });
  const weeks = foldWeeklyProfileCoverage(rows, (r) => r.first_spawn_at);
  assert.equal(weeks.length, 1);
  assert.deepEqual(weeks[0], {
    week: "2026-08-17",
    cohortInstalls: 2,
    observableInstalls: 1,
    filledInstalls: 1,
    distinctBrowsers: 2,
  });
});

test("★스키마에 모집단 컬럼이 있고 축 순수성은 그대로다", () => {
  const names = new Set(INSTALL_PROFILE_SCHEMA.map((f) => f.name));
  for (const col of [
    "first_run_source",
    "cohort_day",
    "activation_observable",
    "ft_browser_installs",
    "install_class",
  ]) {
    assert.equal(names.has(col), true, `${col} 이 스키마에 없다`);
  }
  // 새 컬럼이 계정축 키를 끌고 들어오지 않았는지 다시 확인한다.
  assertAxisPurity(TABLE_INSTALL_PROFILE, INSTALL_PROFILE_SCHEMA);
});
