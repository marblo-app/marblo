import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ATTRIBUTION_SOURCE_COLLECTED,
  ATTRIBUTION_SOURCE_FIRST_TOUCH,
  ATTRIBUTION_SOURCE_NONE,
  GA4_BRIDGE_SCHEMA,
  GA4_BRIDGE_TABLE,
  GA4_BRIDGE_CURRENT_VIEW,
  GA4_BRIDGE_SYNC_LOG_TABLE,
  GA4_BRIDGE_SYNC_LOG_SCHEMA,
  GA4_SYNC_DEFAULT_DAYS,
  GA4_SYNC_MAX_DAYS,
  GA4_SYNC_SCHEDULE_CRON,
  GA4_SYNC_SCHEDULE_TZ,
  ANALYTICS_IDENTITY_TABLE,
  GA4_ECOMMERCE_TABLE,
  GA4_ECOMMERCE_CURRENT_VIEW,
  GA4_ECOMMERCE_EVENTS,
  GA4_ECOMMERCE_SCHEMA,
  GA4_NOT_SET_SENTINEL,
  bridgeAmount,
  buildEcommerceCurrentViewSql,
  buildGa4EcommerceQuery,
  dedupeEcommerceRows,
  emptyGa4EcommerceStats,
  normalizeCurrency,
  parseEcommerceStatsRow,
  toEcommerceRow,
  type Ga4EcommerceRow,
  type Ga4EcommerceSourceRow,
  assembleGa4BridgeFreshness,
  buildBridgeCurrentViewSql,
  buildBridgeStatsQuery,
  buildExistingKeysQuery,
  buildGa4FirstTouchQuery,
  buildLatestSyncLogQuery,
  bridgeCount,
  calendarDaysBetween,
  chooseSyncDays,
  chunkRows,
  classifyGa4BridgeFreshness,
  cleanBridgeField,
  emptyGa4BridgeStats,
  isDailyCron,
  isGaClientId,
  isSafeBqIdentifier,
  normalizeFirstVisitDate,
  parseBridgeStatsRow,
  parseSyncDays,
  parseSyncLogRow,
  sanitizeLandingPage,
  selectNewBridgeRows,
  seoulDateString,
  toBridgeRow,
  type Ga4BridgeSourceRow,
} from "./ga4Bridge";
import {
  deriveGaKey,
  pseudonymizeAnalyticsId,
} from "./analyticsPseudonym";

// ── 픽스처 ───────────────────────────────────────────────────────────────────

function sourceRow(over: Partial<Ga4BridgeSourceRow> = {}): Ga4BridgeSourceRow {
  return {
    gaClientId: "1234567890.1712345678",
    country: "South Korea",
    region: "Seoul",
    tsSource: null,
    tsMedium: null,
    tsCampaign: null,
    ctSource: null,
    ctMedium: null,
    ctCampaign: null,
    content: null,
    term: null,
    firstVisitDate: "2026-08-01",
    deviceCategory: "desktop",
    browser: "Chrome",
    operatingSystem: "Macintosh",
    landingPage: "https://marblo.app/ko",
    downloads: 0,
    ...over,
  };
}

// ── 귀속 소스 선택 ───────────────────────────────────────────────────────────

test("귀속: traffic_source 가 있으면 그쪽이 정본이다(first-touch)", () => {
  const r = toBridgeRow(
    sourceRow({
      tsSource: "google",
      tsMedium: "organic",
      tsCampaign: "(organic)",
      // 같은 유저의 collected 값이 달라도 first-touch 를 덮지 않는다.
      ctSource: "newsletter",
      ctMedium: "email",
      ctCampaign: "aug-blast",
    }),
    "ga_x",
    "2026-08-21T00:00:00.000Z"
  );
  assert.equal(r.source, "google");
  assert.equal(r.medium, "organic");
  assert.equal(r.campaign, "(organic)");
  assert.equal(r.attributionSource, ATTRIBUTION_SOURCE_FIRST_TOUCH);
});

test("귀속: traffic_source 가 통째로 비면 collected 로 메우고 출처를 표기한다", () => {
  const r = toBridgeRow(
    sourceRow({
      ctSource: "newsletter",
      ctMedium: "email",
      ctCampaign: "aug-blast",
    }),
    "ga_x",
    "2026-08-21T00:00:00.000Z"
  );
  assert.equal(r.source, "newsletter");
  assert.equal(r.medium, "email");
  assert.equal(r.campaign, "aug-blast");
  assert.equal(r.attributionSource, ATTRIBUTION_SOURCE_COLLECTED);
});

test("귀속: 두 축을 필드별로 섞지 않는다 — traffic_source 의 빈 medium 을 collected 로 채우지 않는다", () => {
  const r = toBridgeRow(
    sourceRow({ tsSource: "google", ctMedium: "email" }),
    "ga_x",
    "2026-08-21T00:00:00.000Z"
  );
  assert.equal(r.source, "google");
  assert.equal(r.medium, null); // ← collected 의 email 이 새어 들어오면 안 된다
  assert.equal(r.attributionSource, ATTRIBUTION_SOURCE_FIRST_TOUCH);
});

test("귀속: 양쪽 다 없으면 (none) 으로 표기한다(지어내지 않는다)", () => {
  const r = toBridgeRow(sourceRow(), "ga_x", "2026-08-21T00:00:00.000Z");
  assert.equal(r.source, null);
  assert.equal(r.attributionSource, ATTRIBUTION_SOURCE_NONE);
});

test("content/term 은 traffic_source 에 없으므로 항상 collected 쪽 값이 실린다", () => {
  const r = toBridgeRow(
    sourceRow({
      tsSource: "google",
      tsMedium: "cpc",
      content: "hero-a",
      term: "ai agent",
    }),
    "ga_x",
    "2026-08-21T00:00:00.000Z"
  );
  assert.equal(r.content, "hero-a");
  assert.equal(r.term, "ai agent");
});

// ── 광고 전에도 컬럼은 남는다 ────────────────────────────────────────────────

test("★campaign/content/term 컬럼은 값이 비어도 스키마에 남는다", () => {
  const names: string[] = GA4_BRIDGE_SCHEMA.map((f) => f.name);
  for (const col of ["campaign", "content", "term"]) {
    assert.ok(names.includes(col), `${col} 컬럼이 스키마에서 사라졌다`);
  }
  // 값이 비어도 행에 키가 존재해야 한다(BQ 가 NULL 로 받는다).
  const r = toBridgeRow(sourceRow(), "ga_x", "2026-08-21T00:00:00.000Z");
  assert.ok("campaign" in r && "content" in r && "term" in r);
  assert.equal(r.campaign, null);
});

test("스키마: 나중에 덧붙일 수 있게 REQUIRED 는 조인키와 적재시각뿐이다", () => {
  const required = GA4_BRIDGE_SCHEMA.filter((f) => f.mode === "REQUIRED").map(
    (f) => f.name
  );
  assert.deepEqual(required, ["gaKey", "syncedAt"]);
});

test("스키마: 원시 gaClientId 컬럼은 US 브리지에 없다", () => {
  const names: string[] = GA4_BRIDGE_SCHEMA.map((f) => f.name);
  assert.ok(!names.includes("gaClientId"));
  assert.ok(!names.includes("user_pseudo_id"));
});

// ── 정규화 ───────────────────────────────────────────────────────────────────

test("cleanBridgeField: 제어문자 제거·트림, 빈 값은 null", () => {
  assert.equal(cleanBridgeField("  google\u0000  "), "google");
  assert.equal(cleanBridgeField("   "), null);
  assert.equal(cleanBridgeField(42), null);
  assert.equal(cleanBridgeField(null), null);
});

test("bridgeCount: BQ 가 INT64 를 문자열로 줘도 숫자로 센다", () => {
  assert.equal(bridgeCount("3"), 3);
  assert.equal(bridgeCount(3), 3);
  assert.equal(bridgeCount("셋"), 0);
  assert.equal(bridgeCount(undefined), 0);
});

test("normalizeFirstVisitDate: YYYY-MM-DD 만 통과한다", () => {
  assert.equal(normalizeFirstVisitDate("2026-08-01"), "2026-08-01");
  assert.equal(normalizeFirstVisitDate("20260801"), null);
  assert.equal(normalizeFirstVisitDate(null), null);
});

test("★sanitizeLandingPage: 쿼리스트링을 버린다(랜딩 URL 로 개인정보가 넘어가지 않게)", () => {
  assert.equal(
    sanitizeLandingPage("https://marblo.app/ko?utm_source=x&rcpt=me@ex.com"),
    "marblo.app/ko"
  );
  assert.equal(sanitizeLandingPage("https://marblo.app"), "marblo.app/");
  assert.equal(sanitizeLandingPage("/ko/download?u=1#top"), "/ko/download");
  assert.equal(sanitizeLandingPage(null), null);
});

test("isGaClientId: <int>.<int> 만 조인키가 된다", () => {
  assert.ok(isGaClientId("1234567890.1712345678"));
  assert.ok(!isGaClientId("anon"));
  assert.ok(!isGaClientId("1234567890"));
  assert.ok(!isGaClientId(null));
});

// ── first-touch 불변 ─────────────────────────────────────────────────────────

test("★selectNewBridgeRows: 이미 있는 ga_key 는 다시 쓰지 않는다(나중 값이 덮지 않는다)", () => {
  const a = toBridgeRow(sourceRow(), "ga_a", "2026-08-21T00:00:00.000Z");
  const b = toBridgeRow(sourceRow(), "ga_b", "2026-08-21T00:00:00.000Z");
  const fresh = selectNewBridgeRows([a, b], new Set(["ga_a"]));
  assert.deepEqual(
    fresh.map((r) => r.gaKey),
    ["ga_b"]
  );
});

test("selectNewBridgeRows: 같은 배치 안의 중복도 첫 행만 남는다", () => {
  const a1 = toBridgeRow(
    sourceRow({ tsSource: "google" }),
    "ga_a",
    "2026-08-21T00:00:00.000Z"
  );
  const a2 = toBridgeRow(
    sourceRow({ tsSource: "twitter" }),
    "ga_a",
    "2026-08-21T00:00:00.000Z"
  );
  const fresh = selectNewBridgeRows([a1, a2], new Set());
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].source, "google");
});

// ── 조회창 / 청크 ────────────────────────────────────────────────────────────

test("parseSyncDays: 기본값·하한·상한", () => {
  assert.equal(parseSyncDays(undefined), GA4_SYNC_DEFAULT_DAYS);
  assert.equal(parseSyncDays("14"), 14);
  assert.equal(parseSyncDays(0), 1);
  assert.equal(parseSyncDays(9999), GA4_SYNC_MAX_DAYS);
  assert.equal(parseSyncDays("이틀"), GA4_SYNC_DEFAULT_DAYS);
});

test("chunkRows: 나눠도 원소 순서와 총수가 보존된다", () => {
  const rows = [1, 2, 3, 4, 5];
  assert.deepEqual(chunkRows(rows, 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunkRows([], 2), []);
  assert.throws(() => chunkRows(rows, 0));
});

// ── SQL 조립 ─────────────────────────────────────────────────────────────────

test("★GA4 쿼리는 방문자당 1행으로 집계한다(원문 이벤트를 옮기지 않는다)", () => {
  const sql = buildGa4FirstTouchQuery({
    project: "marblo-2253d",
    dataset: "analytics_543991508",
    includeCollectedTrafficSource: true,
  });
  assert.match(sql, /GROUP BY gaClientId/);
  assert.match(sql, /marblo-2253d\.analytics_543991508\.events_\*/);
  // 조회창은 파라미터로만 들어간다(문자열 삽입 금지).
  assert.match(sql, /INTERVAL @days DAY/);
});

test("GA4 쿼리: first-touch 는 가장 이른 이벤트의 non-null 값으로 고른다", () => {
  const sql = buildGa4FirstTouchQuery({
    project: "p",
    dataset: "d",
    includeCollectedTrafficSource: true,
  });
  assert.match(
    sql,
    /ARRAY_AGG\(ts_source IGNORE NULLS ORDER BY event_timestamp LIMIT 1\)/
  );
});

test("★GA4 쿼리는 session_traffic_source_last_click 을 쓰지 않는다(축이 다르다)", () => {
  const sql = buildGa4FirstTouchQuery({
    project: "p",
    dataset: "d",
    includeCollectedTrafficSource: true,
  });
  assert.ok(!sql.includes("session_traffic_source_last_click"));
});

test("collected_traffic_source 를 끄면 컬럼이 사라지지 않고 NULL 로 간다", () => {
  const sql = buildGa4FirstTouchQuery({
    project: "p",
    dataset: "d",
    includeCollectedTrafficSource: false,
  });
  assert.ok(!sql.includes("collected_traffic_source"));
  assert.match(sql, /AS content/);
  assert.match(sql, /AS term/);
  assert.match(sql, /CAST\(NULL AS STRING\) AS ct_content/);
});

test("SQL 조립: 데이터셋 이름에 식별자 아닌 값이 오면 던진다(주입 방지)", () => {
  assert.throws(() =>
    buildGa4FirstTouchQuery({
      project: "p",
      dataset: "d`; DROP TABLE x; --",
      includeCollectedTrafficSource: true,
    })
  );
  assert.ok(isSafeBqIdentifier("analytics_543991508"));
  assert.ok(isSafeBqIdentifier("marblo-2253d"));
  assert.ok(!isSafeBqIdentifier("a.b"));
  assert.ok(!isSafeBqIdentifier(""));
});

test("기존 키 조회는 후보 집합으로만 좁힌다(전량 스캔 금지)", () => {
  const sql = buildExistingKeysQuery({ project: "p", dataset: "d" });
  assert.match(sql, /WHERE gaKey IN UNNEST\(@keys\)/);
  assert.match(sql, new RegExp(`p\\.d\\.${GA4_BRIDGE_TABLE}`));
});

test("★정본 뷰는 ga_key 당 가장 이른 유입 1행만 남긴다", () => {
  const sql = buildBridgeCurrentViewSql({ project: "p", dataset: "d" });
  assert.match(sql, /PARTITION BY gaKey/);
  assert.match(sql, /ORDER BY firstVisitDate ASC NULLS LAST, syncedAt ASC/);
  assert.match(sql, /WHERE rn = 1/);
});

test("★브리지는 신원표를 새로 만들지 않는다 — 조인 상대는 기존 analytics_identity", () => {
  // 사람 축 작업이 익명축 신원표를 이미 착지시켰다(install_key ↔ ga_key).
  // 브리지가 두 번째 신원표를 만들면 익명축 조인이 에러 없이 갈라진다.
  assert.equal(ANALYTICS_IDENTITY_TABLE, "analytics_identity");
  // 브리지가 **만드는** 것은 표 1 + 뷰 1 뿐이고, 신원표는 그 안에 없다.
  const created = [GA4_BRIDGE_TABLE, GA4_BRIDGE_CURRENT_VIEW];
  assert.equal(new Set(created).size, created.length);
  assert.ok(!created.includes(ANALYTICS_IDENTITY_TABLE));
});

test("★ga_key 는 기존 analytics_identity.ga_key 와 같은 형식이어야 조인된다", () => {
  // 실측(2026-08-21): 라이브 analytics_identity 의 non-null ga_key 550행이
  // 전부 이 정규식을 만족한다. 형식이 갈리면 조인이 조용히 0행이 된다.
  assert.match(String(deriveGaKey("1234567890.1712345678", "salt")),
    /^ga_[0-9a-f]{24}$/);
});

// ── 가명 ─────────────────────────────────────────────────────────────────────

test("★ga_key: 같은 client_id + 같은 솔트 → 항상 같은 값(브리지↔신원 조인 성립)", () => {
  const a = deriveGaKey("1234567890.1712345678", "salt");
  const b = deriveGaKey("1234567890.1712345678", "salt");
  assert.equal(a, b);
  assert.match(String(a), /^ga_[0-9a-f]{24}$/);
});

test("★ga_key: 솔트가 없으면 원시값으로 폴백하지 않고 null 이다(fail-safe)", () => {
  assert.equal(deriveGaKey("1234567890.1712345678", null), null);
});

test("★ga_key 는 다른 가명 공간(agent/task)과 값이 겹치지 않는다", () => {
  const ga = deriveGaKey("abc", "salt");
  assert.notEqual(ga, pseudonymizeAnalyticsId("agent", "abc", "salt"));
  assert.notEqual(ga, pseudonymizeAnalyticsId("task", "abc", "salt"));
  // 솔트가 다르면 값도 다르다 — 솔트를 모르면 되짚을 수 없다.
  assert.notEqual(ga, deriveGaKey("abc", "other-salt"));
});

// ── 신선도·스케줄 (티켓 Tscd3JzH) ───────────────────────────────────────────

test("스케줄은 일 1회이고 GA4 export 이후(12시 이후 KST)다 — 분 단위 금지", () => {
  assert.equal(isDailyCron(GA4_SYNC_SCHEDULE_CRON), true);
  assert.equal(isDailyCron("*/5 * * * *"), false);
  assert.equal(isDailyCron("0 * * * *"), false);
  assert.equal(isDailyCron("0 */2 * * *"), false);
  const hour = Number(GA4_SYNC_SCHEDULE_CRON.split(/\s+/)[1]);
  assert.ok(
    hour >= 12,
    "05:30 KST 는 D-1 export 착지 전이라 D+2 가 됐다"
  );
  assert.equal(GA4_SYNC_SCHEDULE_TZ, "Asia/Seoul");
});

test("seoulDateString: UTC 20:30 은 다음 날 KST 이다", () => {
  assert.equal(seoulDateString(new Date("2026-08-23T20:30:08Z")), "2026-08-24");
  assert.equal(seoulDateString(new Date("2026-08-24T06:00:00Z")), "2026-08-24");
});

test("calendarDaysBetween: 날짜만 센다", () => {
  assert.equal(calendarDaysBetween("2026-08-19", "2026-08-24"), 5);
  assert.equal(calendarDaysBetween("2026-08-24", "2026-08-24"), 0);
  assert.equal(calendarDaysBetween("bad", "2026-08-24"), null);
});

test("chooseSyncDays: 표가 비었거나 폭이 짧으면 400일 백필 한 번", () => {
  assert.deepEqual(
    chooseSyncDays({
      rowCount: 0,
      minFirstVisitDate: null,
      todaySeoul: "2026-08-24",
    }),
    { days: GA4_SYNC_MAX_DAYS, reason: "historical-backfill" }
  );
  // 라이브 실측: min 08-19, 오늘 08-24, 100행 — 3일창만 돌아 백필이 안 된 상태.
  assert.deepEqual(
    chooseSyncDays({
      rowCount: 100,
      minFirstVisitDate: "2026-08-19",
      todaySeoul: "2026-08-24",
    }),
    { days: GA4_SYNC_MAX_DAYS, reason: "historical-backfill" }
  );
  assert.deepEqual(
    chooseSyncDays({
      rowCount: 776,
      minFirstVisitDate: "2026-07-08",
      todaySeoul: "2026-08-24",
    }),
    { days: GA4_SYNC_DEFAULT_DAYS, reason: "incremental" }
  );
});

test("classify: 동기 기록 없음 = 미적재 (유입 0 이 아님)", () => {
  assert.equal(
    classifyGa4BridgeFreshness({
      lastSyncedAt: null,
      todaySeoul: "2026-08-24",
    }),
    "not_ingested"
  );
  assert.equal(
    classifyGa4BridgeFreshness({
      lastSyncedAt: "2026-08-23T20:30:08.000Z",
      todaySeoul: "2026-08-24",
    }),
    "loaded"
  );
  assert.equal(
    classifyGa4BridgeFreshness({
      lastSyncedAt: "2026-08-21T20:30:00.000Z",
      todaySeoul: "2026-08-24",
    }),
    "stale"
  );
  assert.equal(
    classifyGa4BridgeFreshness({
      lastSyncedAt: null,
      todaySeoul: "2026-08-24",
      statsError: true,
    }),
    "unknown"
  );
});

test("assemble: 워터마크가 표 MAX(syncedAt) 보다 우선이다 (0-insert 날)", () => {
  const f = assembleGa4BridgeFreshness({
    todaySeoul: "2026-08-24",
    stats: {
      rowCount: 100,
      distinctGaKeys: 100,
      minFirstVisitDate: "2026-08-19",
      maxFirstVisitDate: "2026-08-22",
      lastSyncedAt: "2026-08-23T20:30:08.000Z",
    },
    log: {
      lastSyncedAt: "2026-08-24T06:00:00.000Z",
      rangeDays: 3,
      scanned: 58,
      eligible: 58,
      inserted: 0,
      skippedExisting: 58,
      reason: "incremental",
      ok: true,
      errorMessage: null,
    },
  });
  assert.equal(f.lastSyncedAt, "2026-08-24T06:00:00.000Z");
  assert.equal(f.status, "loaded");
  assert.equal(f.inserted, 0);
  assert.equal(f.rowCount, 100);
  assert.equal(f.visitLagDays, 2);
});

test("assemble: 행 0 + 동기 없음 = not_ingested (빈 표 ≠ 유입 0)", () => {
  const f = assembleGa4BridgeFreshness({
    todaySeoul: "2026-08-24",
    stats: emptyGa4BridgeStats(),
    log: null,
  });
  assert.equal(f.status, "not_ingested");
  assert.equal(f.rowCount, 0);
  assert.equal(f.lastSyncedAt, null);
});

test("parseBridgeStatsRow: BQ {value} 래퍼와 문자열 INT64", () => {
  const s = parseBridgeStatsRow({
    rowCount: { value: "100" },
    distinctGaKeys: "100",
    minFirstVisitDate: { value: "2026-08-19" },
    maxFirstVisitDate: "2026-08-22",
    lastSyncedAt: { value: "2026-08-23T20:30:08.000Z" },
  });
  assert.equal(s.rowCount, 100);
  assert.equal(s.minFirstVisitDate, "2026-08-19");
  assert.equal(s.lastSyncedAt, "2026-08-23T20:30:08.000Z");
});

test("parseSyncLogRow: ok 불리언과 문자열", () => {
  const a = parseSyncLogRow({
    lastSyncedAt: "2026-08-24T06:00:00.000Z",
    rangeDays: 400,
    scanned: 776,
    inserted: 676,
    ok: true,
    reason: "historical-backfill",
  });
  assert.equal(a?.ok, true);
  assert.equal(a?.reason, "historical-backfill");
  const b = parseSyncLogRow({ ok: "false", errorMessage: "failed-precondition" });
  assert.equal(b?.ok, false);
  assert.equal(b?.errorMessage, "failed-precondition");
});

test("신선도 SQL 은 camelCase 컬럼을 읽고 동기 로그 표를 가리킨다", () => {
  const stats = buildBridgeStatsQuery({ project: "p", dataset: "d" });
  assert.match(stats, /COUNT\(DISTINCT gaKey\)/);
  assert.match(stats, /MIN\(firstVisitDate\)/);
  assert.match(stats, /MAX\(syncedAt\)/);
  assert.match(stats, new RegExp(`p\\.d\\.${GA4_BRIDGE_TABLE}`));
  const log = buildLatestSyncLogQuery({ project: "p", dataset: "d" });
  assert.match(log, new RegExp(`p\\.d\\.${GA4_BRIDGE_SYNC_LOG_TABLE}`));
  assert.match(log, /ORDER BY syncedAt DESC/);
  const logCols = GA4_BRIDGE_SYNC_LOG_SCHEMA.map((f) => f.name);
  assert.ok(logCols.includes("ok"));
  assert.ok(logCols.includes("inserted"));
});

// ── ★봇 지문 3축 (ticket IU1KDbYAv7FEewPkwHPU) ──────────────────────────────

test("★지문 3축이 US 브리지로 함께 넘어간다 — 조합이 판정 축이라 하나라도 빠지면 안 된다", () => {
  const r = toBridgeRow(
    sourceRow({
      deviceCategory: "desktop",
      browser: "Chrome",
      operatingSystem: "Macintosh",
    }),
    "ga_x",
    "2026-08-24T00:00:00.000Z"
  );
  assert.equal(r.deviceCategory, "desktop");
  assert.equal(r.browser, "Chrome");
  assert.equal(r.operatingSystem, "Macintosh");

  const names: string[] = GA4_BRIDGE_SCHEMA.map((f) => f.name);
  for (const axis of ["deviceCategory", "browser", "operatingSystem"]) {
    assert.ok(names.includes(axis), `${axis} 컬럼이 스키마에 있어야 한다`);
  }
});

test("★지문 컬럼은 NULLABLE 이다 — 기존 표에 덧붙여야 적재가 막히지 않는다", () => {
  for (const axis of ["browser", "operatingSystem"]) {
    const field = GA4_BRIDGE_SCHEMA.find((f) => f.name === axis);
    assert.ok(field);
    assert.equal(field.mode, "NULLABLE");
  }
});

test("지문 축이 비면 null 로 남는다 — 지어내지 않는다(판정 불능 = 무죄)", () => {
  const r = toBridgeRow(
    sourceRow({ browser: null, operatingSystem: "  " }),
    "ga_x",
    "2026-08-24T00:00:00.000Z"
  );
  assert.equal(r.browser, null);
  assert.equal(r.operatingSystem, null);
});

test("★GA4 집계 쿼리가 지문 3축을 first-touch 로 뽑는다", () => {
  const sql = buildGa4FirstTouchQuery({
    project: "marblo-2253d",
    dataset: "analytics_543991508",
    includeCollectedTrafficSource: true,
  });
  assert.match(sql, /device\.category\s+AS device_category/);
  assert.match(sql, /device\.web_info\.browser\s+AS browser/);
  assert.match(sql, /device\.operating_system\s+AS operating_system/);
  assert.match(sql, /AS browser,/);
  assert.match(sql, /AS operatingSystem,/);
});

// ── GA4 이커머스 브리지 (ticket VV733VRpsfGvijYuPWCl) ────────────────────────

function ecomSource(
  patch: Partial<Ga4EcommerceSourceRow> = {}
): Ga4EcommerceSourceRow {
  return {
    gaClientId: "907527541.1783036649",
    eventDate: "2026-08-07",
    viewItemListEvents: 6,
    viewItemEvents: 2,
    beginCheckoutEvents: 4,
    addPaymentInfoEvents: 1,
    purchaseEvents: 1,
    purchaseRevenue: 19000,
    purchaseRevenueUsd: 13.356367,
    purchaseCurrency: "KRW",
    currencyCount: 1,
    ...patch,
  };
}

test("이커머스 행 정규화 — 실측 모양 그대로 통과한다", () => {
  const row = toEcommerceRow(ecomSource(), "ga_abc", "2026-08-24T06:00:00Z");
  assert.ok(row);
  assert.equal(row.gaKey, "ga_abc");
  assert.equal(row.eventDate, "2026-08-07");
  assert.equal(row.purchaseEvents, 1);
  assert.equal(row.purchaseRevenue, 19000);
  assert.equal(row.purchaseCurrency, "KRW");
  // ★소수를 버리지 않는다 — USD 환산값은 애초에 소수다.
  assert.equal(row.purchaseRevenueUsd, 13.356367);
});

test("★날짜가 없으면 행을 만들지 않는다 — 알갱이가 (gaKey, eventDate) 다", () => {
  assert.equal(
    toEcommerceRow(ecomSource({ eventDate: null }), "ga_abc", "2026-08-24T06:00:00Z"),
    null
  );
  assert.equal(
    toEcommerceRow(ecomSource({ eventDate: "not-a-date" }), "ga_abc", "2026-08-24T06:00:00Z"),
    null
  );
});

test("★통화가 섞인 날은 금액을 NULL 로 떨어뜨린다 — 더한 숫자는 0 보다 나쁘다", () => {
  const row = toEcommerceRow(
    ecomSource({ currencyCount: 2, purchaseRevenue: 33000, purchaseCurrency: "KRW" }),
    "ga_abc",
    "2026-08-24T06:00:00Z"
  );
  assert.ok(row);
  assert.equal(row.purchaseRevenue, null);
  assert.equal(row.purchaseCurrency, null);
  assert.equal(row.currencyCount, 2);
  // ★USD 는 GA4 가 이미 환산해 둔 값이라 그때도 남는다.
  assert.equal(row.purchaseRevenueUsd, 13.356367);
  // 퍼널 카운트는 통화와 무관하게 멀쩡하다.
  assert.equal(row.beginCheckoutEvents, 4);
});

test("★결제가 없는 날도 행이 남는다 — 카운트 0 은 사실이고 금액은 그때 미상이다", () => {
  const row = toEcommerceRow(
    ecomSource({
      purchaseEvents: 0,
      purchaseRevenue: null,
      purchaseRevenueUsd: null,
      purchaseCurrency: null,
      currencyCount: 0,
    }),
    "ga_abc",
    "2026-08-24T06:00:00Z"
  );
  assert.ok(row);
  assert.equal(row.purchaseEvents, 0);
  assert.equal(row.viewItemListEvents, 6);
  assert.equal(row.currencyCount, 0);
  // 일별 행에서는 null 이고, 롤업 뷰가 "결제 0건 → 0원" 으로 확정한다.
  assert.equal(row.purchaseRevenue, null);
});

test("★'(not set)' 은 통화가 아니다 — GA4 자기 센티널이다", () => {
  assert.equal(normalizeCurrency(GA4_NOT_SET_SENTINEL), null);
  assert.equal(normalizeCurrency("(direct)"), null);
  assert.equal(normalizeCurrency(""), null);
  assert.equal(normalizeCurrency("krw"), "KRW");
  assert.equal(normalizeCurrency("KRW"), "KRW");
  // 세 글자가 아니면 통화 코드가 아니다.
  assert.equal(normalizeCurrency("KOREAN_WON"), null);
});

test("bridgeAmount 는 숫자가 아니면 0 이 아니라 null 이다", () => {
  assert.equal(bridgeAmount(19000), 19000);
  assert.equal(bridgeAmount("19000"), 19000);
  assert.equal(bridgeAmount("13.356367"), 13.356367);
  assert.equal(bridgeAmount(null), null);
  assert.equal(bridgeAmount("보통"), null);
  assert.equal(bridgeAmount(Number.NaN), null);
  // ★0 은 진짜 0 이다 — null 로 접지 않는다.
  assert.equal(bridgeAmount(0), 0);
});

test("배치 안의 (gaKey, eventDate) 중복만 접는다", () => {
  const mk = (gaKey: string, eventDate: string): Ga4EcommerceRow => ({
    gaKey,
    eventDate,
    viewItemListEvents: 1,
    viewItemEvents: 0,
    beginCheckoutEvents: 0,
    addPaymentInfoEvents: 0,
    purchaseEvents: 0,
    purchaseRevenue: null,
    purchaseRevenueUsd: null,
    purchaseCurrency: null,
    currencyCount: 0,
    syncedAt: "2026-08-24T06:00:00Z",
  });
  const out = dedupeEcommerceRows([
    mk("ga_a", "2026-08-07"),
    mk("ga_a", "2026-08-07"),
    mk("ga_a", "2026-08-08"),
    mk("ga_b", "2026-08-07"),
  ]);
  assert.equal(out.length, 3);
});

test("★이미 있는 날도 다시 적재한다 — first-touch 와 다른 규칙이다", () => {
  // selectNewBridgeRows 는 존재하는 키를 버린다(first-touch 는 안 덮는다).
  // 이커머스는 그런 함수가 없다 — 지각 이벤트 교정과 백필이 이겨야 하기 때문이다.
  // 읽기 뷰가 (gaKey, eventDate) 당 가장 최근 syncedAt 을 고른다.
  const sql = buildEcommerceCurrentViewSql({ project: "p", dataset: "d" });
  assert.match(sql, /PARTITION BY gaKey, eventDate\s*\n?\s*ORDER BY syncedAt DESC/);
});

test("★금액은 purchase 이벤트로 잠긴다 — 다른 이벤트의 value 를 매출로 세지 않는다", () => {
  const sql = buildGa4EcommerceQuery({ project: "marblo-2253d", dataset: "analytics_543991508" });
  assert.match(sql, /SUM\(IF\(event_name = 'purchase', purchase_revenue, NULL\)\)/);
  assert.match(sql, /SUM\(IF\(event_name = 'purchase', purchase_revenue_usd, NULL\)\)/);
  // begin_checkout 등의 event_params.value 를 금액으로 읽는 자리가 없어야 한다.
  assert.ok(!/key = 'value'/.test(sql));
});

test("★원시 transaction_id 를 US 로 넘기지 않는다", () => {
  const sql = buildGa4EcommerceQuery({ project: "p", dataset: "d" });
  assert.ok(!/transaction_id/.test(sql));
  assert.ok(!GA4_ECOMMERCE_SCHEMA.some((f) => /transaction/i.test(f.name)));
});

test("★장바구니 이벤트를 만들지 않는다 — 마블로는 장바구니 없는 구독이다", () => {
  assert.ok(!GA4_ECOMMERCE_EVENTS.includes("add_to_cart"));
  assert.ok(!GA4_ECOMMERCE_EVENTS.includes("view_cart"));
  assert.deepEqual([...GA4_ECOMMERCE_EVENTS], [
    "view_item_list",
    "view_item",
    "begin_checkout",
    "add_payment_info",
    "purchase",
  ]);
});

test("이커머스 쿼리는 서울 날짜창과 @days 를 쓴다 (first-touch 쿼리와 같은 규약)", () => {
  const sql = buildGa4EcommerceQuery({ project: "marblo-2253d", dataset: "analytics_543991508" });
  assert.match(sql, /CURRENT_DATE\('Asia\/Seoul'\)/);
  assert.match(sql, /INTERVAL @days DAY/);
  assert.match(sql, /marblo-2253d\.analytics_543991508\.events_\*/);
  // ★알갱이는 (방문자, 날짜) 다.
  assert.match(sql, /GROUP BY gaClientId, event_day/);
});

test("이커머스 쿼리도 식별자 화이트리스트를 강제한다", () => {
  assert.throws(() =>
    buildGa4EcommerceQuery({ project: "p`; DROP", dataset: "d" })
  );
  assert.throws(() => buildGa4EcommerceQuery({ project: "p", dataset: "d;--" }));
  assert.throws(() =>
    buildGa4EcommerceQuery({ project: "p", dataset: "d", limit: 0 })
  );
});

test("★롤업 뷰에서 '결제 0건' 은 0원이고 '통화가 섞였다' 만 NULL 이다", () => {
  const sql = buildEcommerceCurrentViewSql({ project: "p", dataset: "d" });
  assert.match(
    sql,
    /IF\(currencyCount > 1, NULL, IFNULL\(purchaseRevenueRaw, NUMERIC '0'\)\)/
  );
  // 카운트도 0 으로 확정된다(행이 있으면 카운트는 실수다).
  assert.match(sql, /IFNULL\(viewItemListEvents, 0\)/);
  assert.match(sql, /IFNULL\(purchaseEvents, 0\)/);
});

test("★하루 안에서 섞인 통화도, 날짜를 건너뛰며 섞인 통화도 잡는다", () => {
  const sql = buildEcommerceCurrentViewSql({ project: "p", dataset: "d" });
  assert.match(sql, /GREATEST\(\s*\n?\s*IFNULL\(MAX\(currencyCount\), 0\),\s*\n?\s*COUNT\(DISTINCT purchaseCurrency\)\s*\n?\s*\)/);
});

test("이커머스 스키마 — 금액은 NUMERIC, 덧붙일 컬럼은 NULLABLE", () => {
  const byName = new Map(GA4_ECOMMERCE_SCHEMA.map((f) => [f.name, f]));
  assert.equal(byName.get("purchaseRevenue")?.type, "NUMERIC");
  assert.equal(byName.get("purchaseRevenueUsd")?.type, "NUMERIC");
  // 알갱이를 이루는 두 컬럼만 REQUIRED 다(+ syncedAt).
  const required = GA4_ECOMMERCE_SCHEMA.filter((f) => f.mode === "REQUIRED").map(
    (f) => f.name
  );
  assert.deepEqual(required, ["gaKey", "eventDate", "syncedAt"]);
});

test("이커머스 표·뷰 이름이 first-touch 와 겹치지 않는다", () => {
  assert.notEqual(GA4_ECOMMERCE_TABLE, GA4_BRIDGE_TABLE);
  assert.notEqual(GA4_ECOMMERCE_CURRENT_VIEW, GA4_BRIDGE_CURRENT_VIEW);
  assert.equal(GA4_ECOMMERCE_TABLE, "ga4_ecommerce_daily");
  assert.equal(GA4_ECOMMERCE_CURRENT_VIEW, "ga4_ecommerce_current");
});

test("이커머스 통계 행 파싱", () => {
  const stats = parseEcommerceStatsRow({
    rowCount: "42",
    distinctGaKeys: "31",
    minEventDate: "2026-07-10",
    maxEventDate: "2026-08-22",
    purchaseEvents: "1",
    lastSyncedAt: "2026-08-24T06:00:00Z",
  });
  assert.equal(stats.rowCount, 42);
  assert.equal(stats.distinctGaKeys, 31);
  assert.equal(stats.purchaseEvents, 1);
  assert.equal(stats.minEventDate, "2026-07-10");
  assert.deepEqual(parseEcommerceStatsRow(null), emptyGa4EcommerceStats());
});
