import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ATTRIBUTION_SOURCE_COLLECTED,
  ATTRIBUTION_SOURCE_FIRST_TOUCH,
  ATTRIBUTION_SOURCE_NONE,
  GA4_BRIDGE_SCHEMA,
  GA4_BRIDGE_TABLE,
  GA4_BRIDGE_CURRENT_VIEW,
  GA4_SYNC_DEFAULT_DAYS,
  GA4_SYNC_MAX_DAYS,
  ANALYTICS_IDENTITY_TABLE,
  buildBridgeCurrentViewSql,
  buildExistingKeysQuery,
  buildGa4FirstTouchQuery,
  bridgeCount,
  chunkRows,
  cleanBridgeField,
  isGaClientId,
  isSafeBqIdentifier,
  normalizeFirstVisitDate,
  parseSyncDays,
  sanitizeLandingPage,
  selectNewBridgeRows,
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
