import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanField,
  parseBuildChannel,
  parseGaClientId,
  parseInstallId,
  parseLinkInstallRequest,
  INSTALL_ATTRIBUTION_SCHEMA,
} from "./installAttribution";
import {
  deriveGaKey,
  pseudonymizeAnalyticsId,
} from "./analyticsPseudonym";

const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const NOW = new Date("2026-08-10T00:00:00.000Z");
const SALT = "test-salt-not-a-real-secret";

test("parseInstallId: UUID 만 통과(대문자는 소문자로 정규화)", () => {
  assert.equal(parseInstallId(UUID), UUID);
  assert.equal(parseInstallId(UUID.toUpperCase()), UUID);
  assert.equal(parseInstallId("  " + UUID + "  "), UUID);
});

test("parseInstallId: 'anon' 폴백과 임의 문자열은 거부", () => {
  // 스토리지를 못 쓰는 설치가 쓰는 공유 리터럴 — 조인키가 될 수 없다.
  assert.equal(parseInstallId("anon"), null);
  assert.equal(parseInstallId("' OR 1=1 --"), null);
  assert.equal(parseInstallId(123), null);
  assert.equal(parseInstallId(undefined), null);
});

test("parseGaClientId: <int>.<int> 만 통과", () => {
  assert.equal(
    parseGaClientId("1234567890.1699999999"),
    "1234567890.1699999999",
  );
  assert.equal(parseGaClientId(""), null);
  assert.equal(parseGaClientId(null), null);
  assert.equal(parseGaClientId("GA1.1.1.2"), null);
  assert.equal(parseGaClientId("abc.def"), null);
});

test("cleanField: 제어문자 제거 + 100자 절단, 빈 값은 null", () => {
  assert.equal(cleanField("  youtube  "), "youtube");
  assert.equal(cleanField("a\u0000b"), "ab");
  assert.equal(cleanField("x".repeat(200))?.length, 100);
  assert.equal(cleanField("   "), null);
  assert.equal(cleanField(42), null);
});

test("parseLinkInstallRequest: 정상 페이로드 → BQ 행", () => {
  const res = parseLinkInstallRequest(
    {
      installId: UUID,
      gaClientId: "111.222",
      utmSource: "youtube",
      utmMedium: "video",
      utmCampaign: "ep12",
      utmContent: "banner_a",
      utmTerm: "ai agent",
      referrerHost: "www.youtube.com",
      landingPath: "/ko/download",
      platform: "darwin",
      appVersion: "3.0.22",
    },
    NOW,
    SALT,
  );
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.deepEqual(res.row, {
    installId: UUID,
    gaClientId: "111.222",
    gaKeyHmac: deriveGaKey("111.222", SALT),
    utmSource: "youtube",
    utmMedium: "video",
    utmCampaign: "ep12",
    utmContent: "banner_a",
    utmTerm: "ai agent",
    referrerHost: "www.youtube.com",
    landingPath: "/ko/download",
    platform: "darwin",
    appVersion: "3.0.22",
    buildChannel: null,
    linkedAt: "2026-08-10T00:00:00.000Z",
    linkSource: "app_first_run",
  });
});

test("parseLinkInstallRequest: GA4 client_id 없음은 정상(광고차단 세션)", () => {
  const res = parseLinkInstallRequest({ installId: UUID }, NOW);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.row.gaClientId, null);
  assert.equal(res.row.utmSource, null);
});

test("parseLinkInstallRequest: gaClientId 형식이 틀리면 거부(쓰레기 조인키 방지)", () => {
  const res = parseLinkInstallRequest(
    { installId: UUID, gaClientId: "not-an-id" },
    NOW,
  );
  assert.deepEqual(res, { ok: false, reason: "bad_ga_client_id" });
});

test("parseLinkInstallRequest: installId 누락/불량 구분", () => {
  assert.deepEqual(parseLinkInstallRequest({}, NOW), {
    ok: false,
    reason: "missing_install_id",
  });
  assert.deepEqual(parseLinkInstallRequest({ installId: "nope" }, NOW), {
    ok: false,
    reason: "bad_install_id",
  });
});

test("parseLinkInstallRequest: 계정 식별자는 실려 와도 행에 남지 않는다", () => {
  const res = parseLinkInstallRequest(
    {
      installId: UUID,
      // 클라가 잘못 보내더라도 스키마에 없는 키는 통째로 버려진다.
      uid: "firebase-uid-1234",
      email: "a@b.com",
      ip: "1.2.3.4",
      country: "KR",
    },
    NOW,
  );
  assert.equal(res.ok, true);
  if (!res.ok) return;
  const keys: string[] = Object.keys(res.row).sort();
  const schemaKeys: string[] = INSTALL_ATTRIBUTION_SCHEMA.map(
    (c) => c.name as string,
  ).sort();
  assert.deepEqual(
    keys,
    schemaKeys,
    "BQ 행 키가 스키마와 정확히 일치해야 한다",
  );
  for (const forbidden of ["uid", "email", "ip", "country"]) {
    assert.equal(
      Object.keys(res.row).includes(forbidden),
      false,
      `${forbidden} 가 행에 남았다`,
    );
  }
});

test("parseBuildChannel: dev/prod 만 통과하고 나머지는 null 로 접는다", () => {
  assert.equal(parseBuildChannel("dev"), "dev");
  assert.equal(parseBuildChannel("prod"), "prod");
  assert.equal(parseBuildChannel(" PROD "), "prod");
  // ★거부가 아니라 null 이다: 표식 하나 때문에 어트리뷰션 행을 잃으면 안 된다.
  assert.equal(parseBuildChannel("staging"), null);
  assert.equal(parseBuildChannel(""), null);
  assert.equal(parseBuildChannel(undefined), null);
  assert.equal(parseBuildChannel(123), null);
});

test("parseLinkInstallRequest: buildChannel 을 행에 싣는다", () => {
  const r = parseLinkInstallRequest(
    { installId: UUID, gaClientId: null, buildChannel: "prod" },
    NOW,
  );
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.row.buildChannel, "prod");
});

test("parseLinkInstallRequest: 표식을 안 보내는 구버전 앱도 그대로 받는다", () => {
  // 구버전 앱은 `c` 파라미터 자체가 없다. 그 유입을 잃으면 안 되므로 null 로
  // 채워 통과시킨다 — "표식 이전 행" 은 null 로 식별된다.
  const r = parseLinkInstallRequest({ installId: UUID, gaClientId: null }, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.row.buildChannel, null);
});

test("INSTALL_ATTRIBUTION_SCHEMA: buildChannel 은 NULLABLE 이다", () => {
  // 이미 존재하는 테이블에 덧붙는 컬럼이라 REQUIRED 면 BigQuery 가 거부한다
  // (index.ts ensureAttributionTable 의 추가 마이그레이션 조건).
  const f = INSTALL_ATTRIBUTION_SCHEMA.find((x) => x.name === "buildChannel");
  assert.ok(f);
  assert.equal(f?.type, "STRING");
  assert.equal(f?.mode, "NULLABLE");
});

// ── ★키 공간 (ticket OqSGPuyOTR8t6Bgl0WI5) ──────────────────────────────────
// 원장은 원시 gaClientId 를 들고, GA4 브리지는 `ga_`+HMAC 을 든다. 두 컬럼을
// 직접 조인하면 에러 없이 **항상 0행**이다(실측 632 → 0). 아래 테스트들이
// 지키는 것은 "가명이 붙는다" 가 아니라 **"GA4 쪽과 같은 가명이 붙는다"** 다.

test("★gaKeyHmac 은 GA4 적재 경로와 같은 kind(`ga`)·같은 스킴이다", () => {
  const r = parseLinkInstallRequest(
    { installId: UUID, gaClientId: "1234567890.1712345678" },
    NOW,
    SALT,
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  // GA4 브리지(index.ts syncGa4FirstTouchInternal)가 user_pseudo_id 에 쓰는
  // 바로 그 함수. 여기가 갈리면 조인이 다시 0 이 된다.
  assert.equal(r.row.gaKeyHmac, deriveGaKey("1234567890.1712345678", SALT));
  // analytics_identity 백필(scripts/backfill-analytics-identity.ts:209)이
  // ga_key 를 만드는 호출과도 같은 값이어야 한다.
  assert.equal(
    r.row.gaKeyHmac,
    pseudonymizeAnalyticsId("ga", "1234567890.1712345678", SALT),
  );
  // 실측 형식: 라이브 analytics_identity 의 non-null ga_key 550행이 전부 이 모양.
  assert.match(String(r.row.gaKeyHmac), /^ga_[0-9a-f]{24}$/);
});

test("★원시 gaClientId 는 보존된다 — 가명은 더하는 것이지 바꾸는 게 아니다", () => {
  // 원시값이 남아 있어야 나중에 소급 백필로 과거 행의 gaKeyHmac 을 채울 수 있다.
  const r = parseLinkInstallRequest(
    { installId: UUID, gaClientId: "1234567890.1712345678" },
    NOW,
    SALT,
  );
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.row.gaClientId, "1234567890.1712345678");
});

test("★솔트가 없으면 원시값으로 폴백하지 않고 gaKeyHmac 은 null 이다", () => {
  const r = parseLinkInstallRequest(
    { installId: UUID, gaClientId: "111.222" },
    NOW,
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.row.gaKeyHmac, null);
  assert.equal(r.row.gaClientId, "111.222");
});

test("gaClientId 가 없으면 gaKeyHmac 도 null(광고차단 세션)", () => {
  const r = parseLinkInstallRequest({ installId: UUID }, NOW, SALT);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.row.gaKeyHmac, null);
});

test("★같은 client_id → 항상 같은 gaKeyHmac(조인이 성립하는 조건)", () => {
  const a = parseLinkInstallRequest(
    { installId: UUID, gaClientId: "111.222" },
    NOW,
    SALT,
  );
  const b = parseLinkInstallRequest(
    { installId: UUID, gaClientId: "111.222" },
    new Date("2027-01-01T00:00:00.000Z"),
    SALT,
  );
  assert.equal(a.ok && b.ok && a.row.gaKeyHmac, b.ok ? b.row.gaKeyHmac : null);
  // 솔트가 바뀌면 값이 달라진다 = ANALYTICS_ID_SALT 를 바꾸면 과거 키가 무효다.
  const c = parseLinkInstallRequest(
    { installId: UUID, gaClientId: "111.222" },
    NOW,
    "other-salt",
  );
  assert.notEqual(a.ok && a.row.gaKeyHmac, c.ok ? c.row.gaKeyHmac : null);
});

// ── ★소재 축 (같은 티켓) ────────────────────────────────────────────────────

test("★utm_content / utm_term 이 행에 실린다 — 소재 단위 분석의 유일한 축", () => {
  const r = parseLinkInstallRequest(
    {
      installId: UUID,
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "launch",
      utmContent: "video_15s_b",
      utmTerm: "ai coding agent",
    },
    NOW,
    SALT,
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.row.utmContent, "video_15s_b");
  assert.equal(r.row.utmTerm, "ai coding agent");
});

test("utmContent / utmTerm 도 제어문자 제거 + 100자 절단 + 빈 값 null", () => {
  const r = parseLinkInstallRequest(
    {
      installId: UUID,
      utmContent: "  a\u0000b  ",
      utmTerm: "x".repeat(200),
    },
    NOW,
    SALT,
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.row.utmContent, "ab");
  assert.equal(r.row.utmTerm?.length, 100);

  const empty = parseLinkInstallRequest({ installId: UUID }, NOW, SALT);
  assert.equal(empty.ok, true);
  assert.equal(empty.ok && empty.row.utmContent, null);
  assert.equal(empty.ok && empty.row.utmTerm, null);
});

test("★새 컬럼 3개는 전부 NULLABLE 이다(기존 테이블에 덧붙일 수 있어야 한다)", () => {
  // REQUIRED 를 기존 테이블에 붙이면 BigQuery 가 거부하고, 거부되면
  // ensureAttributionTable 이 던져 insert 까지 막힌다 = 어트리뷰션 영구 유실.
  for (const name of ["gaKeyHmac", "utmContent", "utmTerm"]) {
    const f = INSTALL_ATTRIBUTION_SCHEMA.find((x) => x.name === name);
    assert.ok(f, `${name} 컬럼이 스키마에 없다`);
    assert.equal(f?.type, "STRING");
    assert.equal(f?.mode, "NULLABLE");
  }
});

test("★스키마 컬럼과 행 키가 1:1 이다(BQ insert 의 no such field 방지)", () => {
  const r = parseLinkInstallRequest(
    { installId: UUID, gaClientId: "111.222" },
    NOW,
    SALT,
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(
    Object.keys(r.row).sort(),
    INSTALL_ATTRIBUTION_SCHEMA.map((f) => f.name).sort(),
  );
});
