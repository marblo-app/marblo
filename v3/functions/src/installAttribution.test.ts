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

const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const NOW = new Date("2026-08-10T00:00:00.000Z");

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
      referrerHost: "www.youtube.com",
      landingPath: "/ko/download",
      platform: "darwin",
      appVersion: "3.0.22",
    },
    NOW,
  );
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.deepEqual(res.row, {
    installId: UUID,
    gaClientId: "111.222",
    utmSource: "youtube",
    utmMedium: "video",
    utmCampaign: "ep12",
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
