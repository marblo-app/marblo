import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCountryFunnel,
  channelFromInstall,
  normalizeChannel,
  normalizeCountry,
  UNKNOWN_COUNTRY,
  type InstallRow,
  type WebVisitorRow,
} from "./countryFunnel";

function web(
  gaClientId: string,
  country: string | null,
  source: string | null,
  medium: string | null,
  downloads: number
): WebVisitorRow {
  return { gaClientId, country, source, medium, campaign: null, downloads };
}

function install(over: Partial<InstallRow> = {}): InstallRow {
  return {
    installId: "i-" + Math.random().toString(36).slice(2),
    gaClientId: null,
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    referrerHost: null,
    firstRun: 1,
    modelConnected: null,
    within10m: null,
    ...over,
  };
}

// ── 정규화 ───────────────────────────────────────────────────────────────────

test("normalizeCountry: 빈 값은 (unknown) — 추정으로 채우지 않는다", () => {
  assert.equal(normalizeCountry("South Korea"), "South Korea");
  assert.equal(normalizeCountry(""), UNKNOWN_COUNTRY);
  assert.equal(normalizeCountry(null), UNKNOWN_COUNTRY);
});

test("normalizeChannel: GA4 의 (direct)/(none) 관례를 따른다", () => {
  assert.deepEqual(normalizeChannel({ source: null, medium: null }), {
    key: "(direct) / (none)",
    source: "(direct)",
    medium: "(none)",
  });
  assert.equal(
    normalizeChannel({ source: "youtube.com", medium: "referral" }).key,
    "youtube.com / referral"
  );
});

test("channelFromInstall: utm 없으면 referrer 호스트를 referral 로 승격", () => {
  assert.equal(
    channelFromInstall(install({ referrerHost: "l.threads.com" })).key,
    "l.threads.com / referral"
  );
  assert.equal(
    channelFromInstall(install({ utmSource: "youtube", utmMedium: "video" }))
      .key,
    "youtube / video"
  );
  assert.equal(channelFromInstall(install()).key, "(direct) / (none)");
});

// ── 조인 ─────────────────────────────────────────────────────────────────────

test("buildCountryFunnel: GA4 client_id 로 방문↔설치가 이어진다(uid 없이)", () => {
  const visitors = [
    web("1.1", "South Korea", "youtube.com", "referral", 1),
    web("2.2", "South Korea", "(direct)", "(none)", 0),
    web("3.3", "United States", "google", "organic", 0),
  ];
  const installs = [
    install({ gaClientId: "1.1", modelConnected: 1, within10m: 1 }),
  ];

  const r = buildCountryFunnel(visitors, installs);

  const kr = r.byCountry.find((c) => c.key === "South Korea")!;
  assert.equal(kr.visitors, 2);
  assert.equal(kr.downloads, 1);
  assert.equal(kr.installs, 1);
  assert.equal(kr.connected, 1);
  assert.equal(kr.activated10m, 1);
  assert.equal(kr.downloadRate, 0.5);
  assert.equal(kr.installRate, 1);

  // ★사장님이 보고 싶어 한 그림: 해외 방문은 있는데 다운로드 0.
  const us = r.byCountry.find((c) => c.key === "United States")!;
  assert.equal(us.visitors, 1);
  assert.equal(us.downloads, 0);
  assert.equal(us.installs, 0);
  assert.equal(us.downloadRate, 0);
  // 분모가 0 인 전환율은 0% 가 아니라 null("없음"과 "실패"는 다르다).
  assert.equal(us.installRate, null);

  assert.equal(r.coverage.installs, 1);
  assert.equal(r.coverage.withGaClientId, 1);
  assert.equal(r.coverage.matchedToWeb, 1);
  assert.equal(r.coverage.matchRate, 1);
});

test("buildCountryFunnel: 채널 축은 GA4 traffic_source 로 접힌다", () => {
  const visitors = [
    web("1.1", "South Korea", "youtube.com", "referral", 1),
    web("2.2", "South Korea", "youtube.com", "referral", 1),
    web("3.3", "South Korea", "l.threads.com", "referral", 0),
  ];
  const installs = [install({ gaClientId: "2.2", modelConnected: 1 })];
  const r = buildCountryFunnel(visitors, installs);

  const yt = r.byChannel.find((c) => c.key === "youtube.com / referral")!;
  assert.equal(yt.visitors, 2);
  assert.equal(yt.downloads, 2);
  assert.equal(yt.installs, 1);
  assert.equal(yt.connected, 1);
  assert.equal(yt.activated10m, 0);
  assert.equal(yt.activationRate, 0);
  // 정렬은 방문자 내림차순.
  assert.equal(r.byChannel[0].key, "youtube.com / referral");
});

test("buildCountryFunnel: 조인 실패 설치는 (unknown) 국가 + 링크백 utm 채널", () => {
  const visitors = [web("1.1", "South Korea", "youtube.com", "referral", 1)];
  const installs = [
    // GA4 쿠키를 못 읽은 설치(광고차단) — utm 폴백만 있다.
    install({ gaClientId: null, utmSource: "threads", utmMedium: "social" }),
    // client_id 는 있는데 조회창 안 GA4 행이 없는 설치.
    install({ gaClientId: "9.9" }),
  ];
  const r = buildCountryFunnel(visitors, installs);

  const unknown = r.byCountry.find((c) => c.key === UNKNOWN_COUNTRY)!;
  assert.equal(unknown.installs, 2);
  assert.equal(unknown.visitors, 0);
  assert.equal(unknown.downloads, 0);

  assert.ok(r.byChannel.some((c) => c.key === "threads / social"));
  assert.equal(r.coverage.withGaClientId, 1);
  assert.equal(r.coverage.matchedToWeb, 0);
  assert.equal(r.coverage.matchRate, 0);
  assert.ok(
    r.notes.some((n) => n.includes("매칭된 설치가 0")),
    "조인 0 인 사실을 note 로 드러내야 한다"
  );
});

test("buildCountryFunnel: 설치 > 다운로드 버킷은 조용히 깎지 않고 anomaly 로 표시", () => {
  // 조회창 밖에서 다운로드하고 이번 창에 설치한 케이스.
  const visitors = [web("1.1", "South Korea", "(direct)", "(none)", 0)];
  const installs = [
    install({ gaClientId: "1.1" }),
    install({ gaClientId: "1.1" }),
  ];
  const r = buildCountryFunnel(visitors, installs);
  const kr = r.byCountry.find((c) => c.key === "South Korea")!;
  assert.equal(kr.downloads, 0);
  assert.equal(kr.installs, 2);
  assert.equal(kr.anomaly, true);
  assert.equal(kr.installRate, null);
});

test("buildCountryFunnel: 웹 데이터가 없어도 설치 이후 칸은 유효하다", () => {
  const r = buildCountryFunnel(
    [],
    [install({ modelConnected: 1, within10m: 1 })]
  );
  assert.equal(r.totals.visitors, 0);
  assert.equal(r.totals.installs, 1);
  assert.equal(r.totals.activated10m, 1);
  assert.ok(r.notes.some((n) => n.includes("GA4(서울) 방문 데이터가 비어")));
});

test("buildCountryFunnel: totals 는 축별 합과 일치한다", () => {
  const visitors = [
    web("1.1", "South Korea", "youtube.com", "referral", 2),
    web("2.2", "Iran", "(direct)", "(none)", 0),
  ];
  const installs = [
    install({ gaClientId: "1.1", modelConnected: 1, within10m: 1 }),
    install({ gaClientId: null }),
  ];
  const r = buildCountryFunnel(visitors, installs);
  const sum = (
    rows: { visitors: number; downloads: number; installs: number }[]
  ) =>
    rows.reduce(
      (acc, x) => ({
        visitors: acc.visitors + x.visitors,
        downloads: acc.downloads + x.downloads,
        installs: acc.installs + x.installs,
      }),
      { visitors: 0, downloads: 0, installs: 0 }
    );
  assert.deepEqual(sum(r.byCountry), {
    visitors: r.totals.visitors,
    downloads: r.totals.downloads,
    installs: r.totals.installs,
  });
  assert.deepEqual(sum(r.byChannel), {
    visitors: r.totals.visitors,
    downloads: r.totals.downloads,
    installs: r.totals.installs,
  });
});

test("buildCountryFunnel: BQ 가 int64 를 문자열로 줘도 숫자로 센다", () => {
  const r = buildCountryFunnel(
    [{ ...web("1.1", "South Korea", "google", "organic", 0), downloads: "3" }],
    []
  );
  assert.equal(r.totals.downloads, 3);
});
