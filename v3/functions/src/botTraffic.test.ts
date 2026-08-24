// 봇 트래픽 판별 순수 로직 단위테스트.
// package.json: npm run test:bot-traffic
//
// ★고정점은 실측이다. 아래 코호트 수치는 GA4 원본(analytics_543991508,
//   asia-northeast3, 최근 30일, 2026-08-24 측정)에서 그대로 가져왔다.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyBotTraffic,
  isJudgeable,
  normalizeCohort,
  suspectedVisitorLookup,
  trafficFingerprint,
  SUSPECT_MIN_COHORT_VISITORS,
  SUSPECT_SIGNATURE_SHARE,
  UNKNOWN_COHORT,
  type FingerprintVisitorRow,
} from "./botTraffic";

let seq = 0;
function visitor(
  country: string,
  fp: [string, string, string] | null,
  downloads = 0
): FingerprintVisitorRow {
  seq += 1;
  return {
    gaClientId: `${seq}.${seq}`,
    country,
    deviceCategory: fp?.[0] ?? null,
    browser: fp?.[1] ?? null,
    operatingSystem: fp?.[2] ?? null,
    downloads,
  };
}

/** 같은 지문 n명. */
function clones(
  country: string,
  fp: [string, string, string],
  n: number,
  downloads = 0
): FingerprintVisitorRow[] {
  return Array.from({ length: n }, () => visitor(country, fp, downloads));
}

const BOT_FP: [string, string, string] = ["desktop", "Chrome", "Macintosh"];

/** 실측 South Korea 대조군 — 자연스럽게 흩어진다(최다 점유 약 24%). */
function koreaCohort(): FingerprintVisitorRow[] {
  const mix: Array<[[string, string, string], number]> = [
    [["desktop", "Chrome", "Windows"], 45],
    [["desktop", "Chrome", "Macintosh"], 38],
    [["mobile", "Safari", "iOS"], 35],
    [["mobile", "Android Webview", "Android"], 26],
    [["desktop", "Edge", "Windows"], 14],
    [["mobile", "Chrome", "Android"], 11],
    [["mobile", "Chrome", "iOS"], 9],
    [["desktop", "Safari", "Macintosh"], 6],
    [["desktop", "Firefox", "Windows"], 3],
    [["tablet", "Safari", "iOS"], 3],
  ];
  const rows = mix.flatMap(([fp, n]) => clones("South Korea", fp, n));
  // 다운로드까지 간 실사용자 9명.
  rows.push(...clones("South Korea", ["desktop", "Chrome", "Windows"], 9, 1));
  return rows;
}

// ── 지문 ────────────────────────────────────────────────────────────────────

test("trafficFingerprint: 3축이 전부 있어야 지문이다 — 하나라도 비면 판정 불능(무죄)", () => {
  assert.equal(
    trafficFingerprint({
      deviceCategory: "desktop",
      browser: "Chrome",
      operatingSystem: "Macintosh",
    }),
    "desktop / Chrome / Macintosh"
  );
  assert.equal(
    trafficFingerprint({ deviceCategory: "desktop", browser: "Chrome" }),
    null
  );
  assert.equal(
    trafficFingerprint({
      deviceCategory: "desktop",
      browser: "  ",
      operatingSystem: "Macintosh",
    }),
    null
  );
  assert.equal(trafficFingerprint({}), null);
});

test("★지문이 통째로 비는 날 전 세계가 하나의 지문을 공유해 봇이 되지 않는다", () => {
  // GA4 가 device 필드를 못 채운 상황. 방문 40명 전원 판정 불능.
  const rows = Array.from({ length: 40 }, () => visitor("Iran", null));
  const verdict = classifyBotTraffic(rows);
  assert.equal(verdict.totals.suspectedVisitors, 0);
  assert.equal(verdict.suspectedCohorts.length, 0);
  assert.equal(verdict.cohorts[0].unresolvedVisitors, 40);
  assert.equal(verdict.cohorts[0].judgedVisitors, 0);
});

test("isJudgeable: 다운로드한 방문자는 어떤 코호트에서도 판정 대상이 아니다", () => {
  assert.equal(isJudgeable(visitor("Iran", BOT_FP, 0)), true);
  assert.equal(isJudgeable(visitor("Iran", BOT_FP, 1)), false);
  assert.equal(isJudgeable(visitor("Iran", null, 0)), false);
});

test("normalizeCohort: 빈 국가는 지어내지 않고 (unknown)", () => {
  assert.equal(normalizeCohort("Iran"), "Iran");
  assert.equal(normalizeCohort(""), UNKNOWN_COHORT);
  assert.equal(normalizeCohort(undefined), UNKNOWN_COHORT);
});

// ── ★핵심: 실측 코호트가 의심/정상으로 갈린다 ───────────────────────────────

test("★Iran 129 · Netherlands 89 는 의심으로, South Korea 201 은 정상으로 갈린다", () => {
  const rows = [
    ...clones("Iran", BOT_FP, 129),
    ...clones("Netherlands", BOT_FP, 89),
    ...clones("Luxembourg", BOT_FP, 17),
    ...clones("Russia", BOT_FP, 14),
    ...clones("Norway", BOT_FP, 9),
    ...koreaCohort(),
  ];
  const verdict = classifyBotTraffic(rows);
  const by = new Map(verdict.cohorts.map((c) => [c.cohort, c]));

  for (const [name, n] of [
    ["Iran", 129],
    ["Netherlands", 89],
    ["Luxembourg", 17],
    ["Russia", 14],
    ["Norway", 9],
  ] as const) {
    const c = by.get(name);
    assert.ok(c, `${name} 코호트가 있어야 한다`);
    assert.equal(c.suspected, true, `${name} 는 의심이어야 한다`);
    assert.equal(c.suspectedVisitors, n);
    assert.equal(c.distinctFingerprints, 1);
    assert.equal(c.topFingerprintShare, 1);
    assert.equal(c.downloads, 0);
  }

  const kr = by.get("South Korea");
  assert.ok(kr);
  assert.equal(kr.suspected, false, "South Korea 는 정상이어야 한다");
  assert.equal(kr.suspectedVisitors, 0);
  assert.equal(kr.visitors, 199);
  assert.ok(kr.distinctFingerprints > 1);
  assert.ok((kr.topFingerprintShare ?? 1) < SUSPECT_SIGNATURE_SHARE);

  assert.equal(verdict.totals.suspectedVisitors, 129 + 89 + 17 + 14 + 9);
  assert.equal(verdict.totals.suspectedCohorts, 5);
});

// ── ★국가로 차단하지 않는다 ────────────────────────────────────────────────

test("★이란에 진짜 사용자가 생기면 보인다 — 다운로드한 이란 사용자는 의심으로 안 빠진다", () => {
  const real = visitor("Iran", ["mobile", "Safari", "iOS"], 1);
  const realSameFingerprint = visitor("Iran", BOT_FP, 1);
  const rows = [...clones("Iran", BOT_FP, 129), real, realSameFingerprint];
  const verdict = classifyBotTraffic(rows);
  const isSuspected = suspectedVisitorLookup(verdict);

  assert.equal(isSuspected(real), false);
  // 봇과 **지문이 같아도** 다운로드했으면 의심이 아니다.
  assert.equal(isSuspected(realSameFingerprint), false);
  assert.equal(isSuspected(rows[0]), true);

  const iran = verdict.cohorts.find((c) => c.cohort === "Iran");
  assert.ok(iran);
  assert.equal(iran.visitors, 131, "코호트 전체 방문은 그대로 센다");
  assert.equal(iran.suspectedVisitors, 129, "의심은 봇 129명뿐");
  assert.equal(iran.downloaders, 2);
});

test("★국가가 아니라 지문 다양성이 판정한다 — 다운로드 0 이어도 지문이 흩어지면 통과", () => {
  // 실측 United States: 19명 · 다운로드 0 · 지문 11가지 → 정상.
  const fps: Array<[string, string, string]> = [
    ["desktop", "Chrome", "Macintosh"],
    ["desktop", "Chrome", "Windows"],
    ["desktop", "Chrome", "Linux"],
    ["desktop", "Safari", "Macintosh"],
    ["desktop", "Edge", "Windows"],
    ["desktop", "Firefox", "Windows"],
    ["mobile", "Safari", "iOS"],
    ["mobile", "Chrome", "Android"],
    ["mobile", "Chrome", "iOS"],
    ["tablet", "Safari", "iOS"],
    ["desktop", "Firefox", "Linux"],
  ];
  const rows = fps.flatMap((fp) => clones("United States", fp, 2)).slice(0, 19);
  const verdict = classifyBotTraffic(rows);
  const us = verdict.cohorts.find((c) => c.cohort === "United States");
  assert.ok(us);
  assert.equal(us.downloads, 0);
  assert.equal(us.suspected, false);
  assert.equal(us.suspectedVisitors, 0);
});

test("★단일지문이어도 코호트가 작으면 판정하지 않는다 — 소수 코호트는 원래 지문이 하나다", () => {
  const rows = clones("Japan", BOT_FP, SUSPECT_MIN_COHORT_VISITORS - 1);
  const verdict = classifyBotTraffic(rows);
  assert.equal(verdict.totals.suspectedVisitors, 0);
  const jp = verdict.cohorts[0];
  assert.equal(jp.suspected, false);
  assert.match(jp.reason, /판정하지 않는다/);

  // 한 명만 더 들어오면 임계값을 넘는다.
  const verdict2 = classifyBotTraffic([
    ...rows,
    visitor("Japan", BOT_FP),
  ]);
  assert.equal(verdict2.totals.suspectedVisitors, SUSPECT_MIN_COHORT_VISITORS);
});

test("의심 코호트에 섞인 다른 지문 방문자는 의심에 들어가지 않는다", () => {
  const odd = visitor("Netherlands", ["mobile", "Safari", "iOS"], 0);
  const verdict = classifyBotTraffic([
    ...clones("Netherlands", BOT_FP, 89),
    odd,
  ]);
  const nl = verdict.cohorts.find((c) => c.cohort === "Netherlands");
  assert.ok(nl);
  assert.equal(nl.suspected, true);
  assert.equal(nl.suspectedVisitors, 89);
  assert.equal(suspectedVisitorLookup(verdict)(odd), false);
});

// ── ★거른 것을 버리지 않는다 · 판정은 파생이다 ─────────────────────────────

test("★거른 것을 버리지 않는다 — 의심 방문이 합계에 남고 note 로 드러난다", () => {
  const verdict = classifyBotTraffic([
    ...clones("Iran", BOT_FP, 129),
    ...koreaCohort(),
  ]);
  assert.equal(verdict.totals.visitors, 129 + 199);
  assert.equal(verdict.totals.suspectedVisitors, 129);
  assert.equal(verdict.totals.qualifiedVisitors, 199);
  assert.equal(
    verdict.totals.visitors,
    verdict.totals.qualifiedVisitors + verdict.totals.suspectedVisitors
  );
  assert.ok(verdict.notes.some((n) => n.includes("의심 유입 129방문")));
});

test("★판정은 파생이다 — 입력 행을 변형하지 않고 임계값만 바꿔도 과거가 다시 읽힌다", () => {
  const rows = clones("Iran", BOT_FP, 129);
  const snapshot = JSON.stringify(rows);

  const strict = classifyBotTraffic(rows);
  assert.equal(strict.totals.suspectedVisitors, 129);

  // 규칙을 느슨하게 바꾸면 **같은 원본**이 즉시 다르게 읽힌다 — 원장을 다시
  // 쓸 일이 없다는 뜻이고, 그래서 bot 플래그를 굽지 않는다.
  const loose = classifyBotTraffic(rows, { minCohortVisitors: 500 });
  assert.equal(loose.totals.suspectedVisitors, 0);
  assert.equal(loose.rule.minCohortVisitors, 500);
  assert.equal(loose.rule.derived, true);

  assert.equal(JSON.stringify(rows), snapshot, "입력 행은 변형되지 않는다");
  assert.ok(
    strict.notes.some((n) => n.includes("파생")),
    "판정이 파생이라는 사실이 응답에 남는다"
  );
});

test("규칙 파라미터가 응답에 실려 화면이 임계값을 말할 수 있다", () => {
  const rule = classifyBotTraffic([]).rule;
  assert.equal(rule.cohortAxis, "country");
  assert.equal(rule.minCohortVisitors, SUSPECT_MIN_COHORT_VISITORS);
  assert.equal(rule.signatureShare, SUSPECT_SIGNATURE_SHARE);
  assert.deepEqual(rule.fingerprintAxes, [
    "deviceCategory",
    "browser",
    "operatingSystem",
  ]);
});

test("빈 입력은 조용히 0 — 코호트도 의심도 없다", () => {
  const verdict = classifyBotTraffic([]);
  assert.deepEqual(verdict.cohorts, []);
  assert.equal(verdict.totals.visitors, 0);
  assert.equal(suspectedVisitorLookup(verdict)(visitor("Iran", BOT_FP)), false);
});
