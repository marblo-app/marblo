// 획득 탭 읽기 경로 단위 테스트 — GUI 없이, BigQuery 없이 잠근다.
//
// 실행: cd v3/functions && npm run test:admin-install-unified
//
// ★여기서 재는 것은 "SQL 이 돈다" 가 아니라 **규율이 안 깨진다** 는 것이다:
//   0 과 미상이 갈리나 · no_utm 과 no_ga4_row 가 다르게 나가나 · 분모가 설치인가 ·
//   설치 수를 사람 수로 안 읽나 · n<5 에 퍼센트를 안 만드나.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CHANNEL_REASON_COPY,
  CHANNEL_REASON_KNOWN,
  CHANNEL_ROW_LIMIT,
  COUNTRY_ROW_LIMIT,
  PENDING_VIEW_COLUMNS,
  SMALL_SAMPLE_MIN_DENOMINATOR,
  buildChannelRows,
  buildChannelSql,
  buildCountryRows,
  buildCountrySql,
  buildHygiene,
  buildHygieneSql,
  buildInstallClassSql,
  buildInstallUnifiedParitySql,
  buildInstallsByDay,
  buildInstallsByDaySql,
  buildMissingReasonRows,
  buildMissingReasonSql,
  buildNotes,
  dateStr,
  describeChannelReason,
  normalizeRangeDays,
  num,
  ratio,
  str,
  unavailable,
} from "./adminInstallUnified";

const PROJECT = "marblo-2253d";

// ── ★규율 1: 0 과 미상을 가른다 ─────────────────────────────────────────────

test("뷰를 못 읽으면 0 이 아니라 사유를 낸다 — 빈 표를 '유입 0' 으로 속이지 않는다", () => {
  const r = unavailable(PROJECT, 30, "뷰 없음", "2026-08-25T00:00:00.000Z");
  assert.equal(r.state, "unavailable");
  assert.equal(r.reason, "뷰 없음");
  assert.equal(r.headline, null, "headline 이 0 으로 채워지면 안 된다");
  assert.deepEqual(r.channelRows, []);
  assert.match(r.source, /v_install_unified/);
});

test("분모 0 이면 rate 는 0 이 아니라 null 이다", () => {
  const r = ratio(0, 0);
  assert.equal(r.rate, null);
  assert.equal(r.numerator, 0);
  assert.equal(r.denominator, 0);
});

test("빈 문자열을 라벨로 승급시키지 않는다 — 조인 실패가 채널명이 되면 안 된다", () => {
  assert.equal(str(""), null);
  assert.equal(str("   "), null);
  assert.equal(str("google"), "google");
  assert.equal(str(null), null);
});

// ── ★규율 2: '모른다' 와 '안다, 캠페인이 없었다' 를 가른다 ──────────────────

test("★no_utm 은 진짜 0 이고 no_ga4_row 는 모름이다 — 같은 칸에 두지 않는다", () => {
  const noUtm = describeChannelReason("no_utm");
  const noGa4 = describeChannelReason("no_ga4_row");
  assert.equal(noUtm.kind, "true_zero");
  assert.equal(noGa4.kind, "unknown");
  assert.notEqual(noUtm.label, noGa4.label);
  // 우리가 할 일이 정반대다 — 그 사실이 문구에 있어야 한다.
  assert.match(noGa4.action, /백필/);
  assert.match(noUtm.action, /백필할 것이 없다/);
});

test("사유 사다리 다섯 칸이 전부 어휘를 갖는다 (install-unified 문서 §4-1)", () => {
  for (const reason of [
    "no_ledger_row",
    "no_ga_client_id",
    "key_mismatch",
    "no_ga4_row",
    "no_utm",
  ]) {
    const copy = describeChannelReason(reason);
    assert.equal(copy.reason, reason);
    assert.ok(
      !/화면이 모르는 사유/.test(copy.label),
      `${reason} 어휘 누락`
    );
  }
  // NULL = 캠페인 실재.
  assert.equal(describeChannelReason(null).kind, "known");
  assert.equal(describeChannelReason(null).reason, CHANNEL_REASON_KNOWN);
});

test("★모르는 사유가 와도 삼키지 않는다 — 어느 표에도 안 나온 채 사라지면 안 된다", () => {
  const copy = describeChannelReason("brand_new_rung");
  assert.equal(copy.kind, "unknown");
  assert.match(copy.label, /brand_new_rung/);
  const rows = buildMissingReasonRows([
    { reason: "brand_new_rung", hasGa4Row: false, installs: 7 },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].installs, 7);
});

test("사유표는 건수 내림차순이고 hasGa4Row 를 그대로 싣는다", () => {
  const rows = buildMissingReasonRows([
    { reason: "no_utm", hasGa4Row: true, installs: 3 },
    { reason: "key_mismatch", hasGa4Row: false, installs: 565 },
    { reason: CHANNEL_REASON_KNOWN, hasGa4Row: true, installs: 1 },
  ]);
  assert.deepEqual(
    rows.map((r) => r.reason),
    ["key_mismatch", "no_utm", CHANNEL_REASON_KNOWN]
  );
  assert.equal(rows[1].hasGa4Row, true);
  assert.equal(rows[1].kind, "true_zero");
});

// ── ★규율 3: 분모는 방문이 아니라 설치다 ────────────────────────────────────

test("모든 표의 모집단이 설치(NOT isDevInstall)다 — 방문 축이 섞이지 않는다", () => {
  for (const sql of [
    buildChannelSql(PROJECT),
    buildMissingReasonSql(PROJECT),
    buildCountrySql(PROJECT),
    buildInstallsByDaySql(PROJECT),
  ]) {
    assert.match(sql, /NOT isDevInstall/, "외부 설치 필터가 빠졌다");
    assert.match(sql, /v_install_unified/, "통합 뷰가 아닌 표를 읽고 있다");
    assert.doesNotMatch(sql, /visitors|user_pseudo_id/, "방문 축이 섞였다");
  }
});

test("★채널표는 캠페인이 실재하는 행만 센다 (channelMissingReason IS NULL)", () => {
  assert.match(buildChannelSql(PROJECT), /channelMissingReason IS NULL/);
});

test("이 모듈은 재집계하지 않는다 — 뷰의 컬럼만 GROUP BY 한다", () => {
  const sqls = [
    buildChannelSql(PROJECT),
    buildMissingReasonSql(PROJECT),
    buildCountrySql(PROJECT),
  ];
  for (const sql of sqls) {
    // 원천 표를 직접 읽으면 §0 의 병(집계 16곳)이 재발한다.
    assert.doesNotMatch(sql, /analytics_user_daily|install_attribution|ga4_first_touch_current/);
  }
});

test("★이관 전/후 설치 행수 대조 쿼리를 제공한다 — 세는 단위는 설치 1행이다", () => {
  const sql = buildInstallUnifiedParitySql(PROJECT).installRows;
  assert.match(sql, /analytics_install_profile/);
  assert.match(sql, /v_install_unified/);
  assert.match(sql, /COUNT\(DISTINCT installKey\)/);
  assert.doesNotMatch(sql, /events|user_pseudo_id|analytics_purchase/);
});

test("★first_run 이벤트 표본은 설치 분모와 같다고 잠그지 않는다", () => {
  const sql = buildInstallUnifiedParitySql(PROJECT).firstRunAxisWarning;
  assert.match(sql, /event = 'app:first_run'/);
  assert.match(sql, /COUNT\(DISTINCT userId\)/);
  assert.match(sql, /firstRunAt IS NOT NULL/);
  assert.match(sql, /eventClientIds/);
  assert.match(sql, /unifiedInstallRowsWithFirstRun/);
});

// ── ★규율 4: 설치 수를 사람 수로 읽지 않는다 ────────────────────────────────

test("★전체 설치와 사람 추정치를 같이 낸다 — 하나만 내면 반드시 오독된다", () => {
  const h = buildHygiene(
    {
      installsTotal: 608,
      installsExternal: 577,
      installsDev: 31,
      distinctBrowsers: 5,
      unknownBrowserInstalls: 42,
      maxInstallsPerBrowser: 539,
    },
    [
      { installClass: "reinstall_loop", installs: 539 },
      { installClass: "dev_tagged", installs: 31 },
      { installClass: "distinct", installs: 4 },
      { installClass: "unknown", installs: 34 },
    ]
  );
  assert.equal(h.installsTotal, 608);
  assert.equal(h.installsExternal, 577);
  // 하한 = 고유 브라우저, 상한 = 하한 + 브라우저를 모르는 설치.
  assert.equal(h.humanEstimateMin, 5);
  assert.equal(h.humanEstimateMax, 47);
  assert.equal(h.byInstallClass.length, 4);
  assert.equal(h.hygieneMissingReason, null);
});

test("★브라우저를 모르는 설치를 조용히 distinct 로 치지 않는다", () => {
  const h = buildHygiene(
    { installsTotal: 10, installsExternal: 10, distinctBrowsers: 2, unknownBrowserInstalls: 8 },
    []
  );
  assert.notEqual(h.humanEstimateMin, h.humanEstimateMax, "폭이 0 이면 모른다는 사실이 사라진다");
  assert.equal(h.unknownBrowserInstalls, 8);
});

test("install_class 를 못 읽으면 0 이 아니라 사유가 붙는다", () => {
  const h = buildHygiene({ installsTotal: 1 }, null);
  assert.deepEqual(h.byInstallClass, []);
  assert.match(h.hygieneMissingReason ?? "", /install_class/);
});

test("재설치 루프는 주석이 아니라 표 밑 한 줄로 나온다", () => {
  const h = buildHygiene(
    { installsTotal: 608, installsExternal: 577, installsDev: 31, distinctBrowsers: 5, unknownBrowserInstalls: 0, maxInstallsPerBrowser: 539 },
    []
  );
  const notes = buildNotes(h, 0, 0);
  assert.ok(notes.some((n) => /재설치 루프/.test(n)), "위생 경보가 없다");
  assert.ok(notes.some((n) => /숨기지 않았다/.test(n)), "dev 설치를 조용히 뺐다");
});

test("헤드라인은 뷰 단독으로 읽고 프로필 보조 컬럼이 없어도 죽지 않는다", () => {
  const sql = buildHygieneSql(PROJECT);
  assert.doesNotMatch(sql, /analytics_install_profile/);
  assert.doesNotMatch(sql, /ft_browser_installs/);
  assert.match(sql, /gaKeyInstallCount/);
});

test("install_class 보조 표는 별도 쿼리로만 읽고 실패하면 사유로 접는다", () => {
  assert.match(buildInstallClassSql(PROJECT), /install_class/);
});

// ── ★n<5 마스킹은 서버에서 (계획 §5 PR 2) ──────────────────────────────────

test("★분모가 5 미만이면 퍼센트를 만들지 않는다 — 분수는 그대로 낸다", () => {
  const r = ratio(2, 3);
  assert.equal(r.rate, null, "한 건이 33%p 를 움직이는 표에 퍼센트는 거짓말이다");
  assert.equal(r.smallSample, true);
  assert.equal(r.numerator, 2, "원자료까지 가리면 그것도 거짓말이다");
  assert.equal(r.denominator, 3);
});

test("분모가 하한 이상이면 퍼센트가 나온다", () => {
  const r = ratio(1, SMALL_SAMPLE_MIN_DENOMINATOR);
  assert.equal(r.smallSample, false);
  assert.equal(r.rate, 1 / SMALL_SAMPLE_MIN_DENOMINATOR);
});

test("채널·국가 행의 비율도 같은 규칙을 탄다", () => {
  const ch = buildChannelRows([
    { source: "google", medium: "cpc", campaign: "launch", content: "a", installs: 3, spawned: 1, completed: 0 },
  ]);
  assert.equal(ch.rows[0].spawned.smallSample, true);
  assert.equal(ch.rows[0].spawned.rate, null);
  const co = buildCountryRows([{ country: "KR", installs: 12, channelKnown: 9, spawned: 2 }]);
  assert.equal(co.rows[0].channelKnown.smallSample, false);
  assert.equal(co.rows[0].channelKnown.rate, 9 / 12);
});

// ── 잘라낸 사실을 숨기지 않는다 ─────────────────────────────────────────────

test("행이 상한을 넘으면 잘랐다고 말한다", () => {
  const many = Array.from({ length: CHANNEL_ROW_LIMIT + 1 }, (_, i) => ({
    source: `s${i}`, medium: "m", campaign: "c", content: null, installs: 1, spawned: 0, completed: 0,
  }));
  const ch = buildChannelRows(many);
  assert.equal(ch.truncated, true);
  assert.equal(ch.rows.length, CHANNEL_ROW_LIMIT);

  const countries = Array.from({ length: COUNTRY_ROW_LIMIT + 1 }, (_, i) => ({
    country: `C${i}`, installs: 1, channelKnown: 0, spawned: 0,
  }));
  assert.equal(buildCountryRows(countries).truncated, true);
});

// ── 일별 추이 ───────────────────────────────────────────────────────────────

test("★날짜 없는 행은 오늘로 몰지 않고 빼고, 뺐다고 적는다", () => {
  const points = buildInstallsByDay([
    { day: { value: "2026-08-03" }, installs: 2, channelKnown: 1 },
    { day: null, installs: 9, channelKnown: 9 },
    { day: "2026-08-01", installs: 5, channelKnown: 0 },
  ]);
  assert.deepEqual(points.map((p) => p.date), ["2026-08-01", "2026-08-03"]);
  const notes = buildNotes(buildHygiene({}, []), 3, points.length);
  assert.ok(notes.some((n) => /firstRunAt/.test(n)));
});

test("BigQuery DATE 래퍼를 푼다", () => {
  assert.equal(dateStr({ value: "2026-08-25" }), "2026-08-25");
  assert.equal(dateStr("2026-08-25"), "2026-08-25");
  assert.equal(dateStr(undefined), null);
});

test("INT64 가 문자열·BigInt·래퍼로 와도 같은 수다", () => {
  assert.equal(num("631"), 631);
  assert.equal(num(631n), 631);
  assert.equal(num({ value: "631" }), 631);
  assert.equal(num(undefined), 0);
});

// ── 계약 ────────────────────────────────────────────────────────────────────

test("조회 기간은 화면 값을 그대로 믿지 않는다", () => {
  assert.equal(normalizeRangeDays(30), 30);
  assert.equal(normalizeRangeDays(0), 30);
  assert.equal(normalizeRangeDays(-5), 30);
  assert.equal(normalizeRangeDays(9999), 365);
  assert.equal(normalizeRangeDays("7"), 7);
  assert.equal(normalizeRangeDays(undefined), 30);
});

test("★뷰에 아직 없는 파생 컬럼을 화면이 대신 계산하지 않고 목록으로 낸다", () => {
  const cols = PENDING_VIEW_COLUMNS.map((c) => c.column).join(" ");
  assert.match(cols, /retainedD7/);
  assert.match(cols, /cohortWeek/);
  assert.match(cols, /minutesToFirstSpawn/);
});

test("사유 어휘에 결정 문장이 빠진 칸이 없다 (계획 §2-5)", () => {
  for (const c of CHANNEL_REASON_COPY) {
    assert.ok(c.action.length > 0, `${c.reason} 에 '무슨 결정을 하나' 가 없다`);
    assert.ok(c.label.length > 0);
  }
});
