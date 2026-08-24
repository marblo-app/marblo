// analyticsCoverageGuard 순수 로직 단위테스트 (ticket sx56j9XA26yEXka8QIhr).
// 실행:
//   npm run test:coverage-guard
//
// ★이 파일의 첫 번째 테스트는 **오늘(2026-08-24) 실측을 그대로 넣어 RED 가
//   나오는 것**을 못박는다. 검사가 지금 상태를 통과하면 그 검사는 아무것도
//   지키지 않는다.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_COVERAGE_THRESHOLDS,
  auditMilestoneCoverage,
  auditProfileCoverage,
  type WeeklyMilestoneCoverage,
} from "./analyticsCoverageGuard";

/**
 * 2026-08-24 BigQuery 실측(john.kim ADC REST).
 *
 * 파생측 — analytics_install_profile 을
 *   cohort_day = COALESCE(DATE(first_run_at,'Asia/Seoul'), first_active_day)
 * 로 접은 주차 집계.
 * 원천측 — events 의 event='agent:spawned' 주차별 COUNT(DISTINCT userId).
 *
 * 이 표가 이 티켓의 물증이다. 08-10 주차는 코호트 199행인데 관측 가능한 행이
 * 0행이고 first_spawn_at 이 채워진 행도 0행인 반면, 같은 주 원천에는 스폰을 낸
 * 고유 설치가 3개 있다.
 */
const LIVE_2026_08_24: WeeklyMilestoneCoverage[] = [
  {
    week: "2026-05-25",
    cohortInstalls: 1,
    observableInstalls: 1,
    filledInstalls: 1,
    eventKeys: 1,
    distinctBrowsers: 1,
  },
  {
    week: "2026-07-13",
    cohortInstalls: 29,
    observableInstalls: 29,
    filledInstalls: 7,
    eventKeys: 11,
    distinctBrowsers: 29,
  },
  {
    week: "2026-07-20",
    cohortInstalls: 7,
    observableInstalls: 7,
    filledInstalls: 6,
    eventKeys: 6,
    distinctBrowsers: 7,
  },
  {
    week: "2026-07-27",
    cohortInstalls: 3,
    observableInstalls: 3,
    filledInstalls: 3,
    eventKeys: 6,
    distinctBrowsers: 3,
  },
  {
    week: "2026-08-03",
    cohortInstalls: 1,
    observableInstalls: 1,
    filledInstalls: 0,
    eventKeys: 3,
    distinctBrowsers: 1,
  },
  {
    week: "2026-08-10",
    cohortInstalls: 199,
    observableInstalls: 0,
    filledInstalls: 0,
    eventKeys: 3,
    distinctBrowsers: 2,
  },
  {
    week: "2026-08-17",
    cohortInstalls: 368,
    observableInstalls: 3,
    filledInstalls: 1,
    eventKeys: 4,
    distinctBrowsers: 6,
  },
];

test("★지금 상태(2026-08-24 실측)에서 RED 가 난다 — 통과하면 검사가 아니다", () => {
  const report = auditMilestoneCoverage({
    field: "first_spawn_at",
    sourceEvent: "agent:spawned",
    weeks: LIVE_2026_08_24,
  });
  assert.equal(report.status, "red");

  const byRule = (rule: string, week: string | null) =>
    report.findings.find((f) => f.rule === rule && f.week === week);

  // 1) 이벤트는 오는데 그 주 코호트의 필드가 0 — 이 티켓의 모양 그대로.
  const gap0810 = byRule("weekly_numerator_gap", "2026-08-10");
  assert.ok(gap0810, "08-10 주차의 분자 공백을 못 잡았다");
  assert.equal(gap0810!.severity, "red");
  assert.equal(gap0810!.observed.cohortInstalls, 199);
  assert.equal(gap0810!.observed.eventKeys, 3);

  const gap0803 = byRule("weekly_numerator_gap", "2026-08-03");
  assert.ok(gap0803, "08-03 주차의 분자 공백을 못 잡았다");
  assert.equal(gap0803!.severity, "red");

  // 2) 분모의 대부분이 분자를 가질 수 없는 행이다.
  const mix0810 = byRule("population_mix", "2026-08-10");
  assert.ok(mix0810, "08-10 주차의 모집단 혼합을 못 잡았다");
  assert.equal(mix0810!.observed.observableInstalls, 0);
  const mix0817 = byRule("population_mix", "2026-08-17");
  assert.ok(mix0817, "08-17 주차의 모집단 혼합을 못 잡았다 (3/368 = 0.8%)");

  // 3) 브라우저당 설치 수 — 사람이 아니라 재설치 루프.
  const infl0810 = byRule("denominator_inflation", "2026-08-10");
  assert.ok(infl0810, "08-10 주차의 분모 부풀림을 못 잡았다");
  assert.equal(infl0810!.observed.installsPerBrowser, 99.5);
  const infl0817 = byRule("denominator_inflation", "2026-08-17");
  assert.ok(infl0817, "08-17 주차의 분모 부풀림을 못 잡았다");

  // 정상 주차(07-20 · 07-27)에는 아무 발견도 없어야 한다 — 전부 red 로 칠하면
  // 그것도 신호가 아니다.
  for (const week of ["2026-07-20", "2026-07-27"]) {
    assert.equal(
      report.findings.filter((f) => f.week === week).length,
      0,
      `${week} 는 건강한 주차인데 발견이 붙었다`,
    );
  }
});

test("★#1171 · #1195 형(키 공간 단절)도 같은 검사에 걸린다", () => {
  // 관측 가능한 설치도 있고 원천 이벤트도 있는데 파생 필드가 **전 주차 0**.
  // 조인 키가 갈렸을 때 나오는 모양이다(행은 있고 결과만 0).
  const report = auditMilestoneCoverage({
    field: "first_spawn_at",
    sourceEvent: "agent:spawned",
    weeks: [
      {
        week: "2026-08-10",
        cohortInstalls: 6,
        observableInstalls: 6,
        filledInstalls: 0,
        eventKeys: 5,
        distinctBrowsers: 6,
      },
      {
        week: "2026-08-17",
        cohortInstalls: 8,
        observableInstalls: 8,
        filledInstalls: 0,
        eventKeys: 6,
        distinctBrowsers: 8,
      },
    ],
  });
  assert.equal(report.status, "red");
  const keyBreak = report.findings.find((f) => f.rule === "key_space_break");
  assert.ok(keyBreak, "전 주차 0 인데 키 공간 단절로 잡지 않았다");
  assert.equal(keyBreak!.week, null);
  assert.equal(keyBreak!.observed.observableInstalls, 14);
});

test("건강한 주차만 있으면 ok 다 — 아무거나 red 로 칠하지 않는다", () => {
  const report = auditMilestoneCoverage({
    field: "first_spawn_at",
    sourceEvent: "agent:spawned",
    weeks: [
      {
        week: "2026-07-20",
        cohortInstalls: 7,
        observableInstalls: 7,
        filledInstalls: 6,
        eventKeys: 6,
        distinctBrowsers: 7,
      },
      {
        week: "2026-07-27",
        cohortInstalls: 3,
        observableInstalls: 3,
        filledInstalls: 3,
        eventKeys: 6,
        distinctBrowsers: 3,
      },
    ],
  });
  assert.equal(report.status, "ok");
  assert.equal(report.findings.length, 0);
});

test("★원천이 0건이면 '이상 없음' 이 아니라 '판단 근거 없음' 이라고 적는다", () => {
  const report = auditMilestoneCoverage({
    field: "first_spawn_at",
    sourceEvent: "agent:spawned",
    weeks: [
      {
        week: "2026-08-17",
        cohortInstalls: 3,
        observableInstalls: 3,
        filledInstalls: 0,
        eventKeys: 0,
        distinctBrowsers: 3,
      },
    ],
  });
  assert.equal(report.status, "ok");
  // ★한글 정규화(NFC/NFD)가 파일마다 다를 수 있어 정규식 대신 정규화 후 비교한다.
  const line = report.lines[0].normalize("NFC");
  assert.ok(
    line.includes("판정할 근거가 없다".normalize("NFC")),
    `원천 0건을 '이상 없음' 으로 접었다: ${line}`
  );
  assert.ok(!line.includes("커버리지 이상 없음".normalize("NFC")));
});

test("분자가 원천의 절반에 못 미치면 amber 로 남긴다(코호트 정의로 설명될 수 있다)", () => {
  const report = auditMilestoneCoverage({
    field: "first_spawn_at",
    sourceEvent: "agent:spawned",
    weeks: [
      {
        week: "2026-08-17",
        cohortInstalls: 10,
        observableInstalls: 10,
        filledInstalls: 2,
        eventKeys: 8,
        distinctBrowsers: 10,
      },
    ],
  });
  assert.equal(report.status, "amber");
  assert.equal(report.findings[0].rule, "weekly_numerator_gap");
  assert.equal(report.findings[0].severity, "amber");
});

test("임계값은 실측에서 나온 값이다 — 조용히 느슨해지면 검사가 죽는다", () => {
  // 08-17 주차 3/368 = 0.8% 가 red 여야 하므로 10% 보다 낮출 수 없다.
  assert.equal(DEFAULT_COVERAGE_THRESHOLDS.minObservableShare, 0.1);
  // 631 설치 / 브라우저 5개 = 126. 5 는 "사람 하나가 한 창에서 5번 최초실행"
  // 을 정상으로 보지 않겠다는 선이다.
  assert.equal(DEFAULT_COVERAGE_THRESHOLDS.maxInstallsPerBrowser, 5);
});

test("여러 필드를 합쳐도 가장 나쁜 상태가 살아남는다", () => {
  const report = auditProfileCoverage([
    {
      field: "first_completed_at",
      sourceEvent: "task:completed",
      weeks: [
        {
          week: "2026-07-20",
          cohortInstalls: 7,
          observableInstalls: 7,
          filledInstalls: 6,
          eventKeys: 6,
          distinctBrowsers: 7,
        },
      ],
    },
    {
      field: "first_spawn_at",
      sourceEvent: "agent:spawned",
      weeks: LIVE_2026_08_24,
    },
  ]);
  assert.equal(report.status, "red");
  assert.ok(report.findings.some((f) => f.field === "first_spawn_at"));
  assert.ok(report.lines.length >= 2);
});
