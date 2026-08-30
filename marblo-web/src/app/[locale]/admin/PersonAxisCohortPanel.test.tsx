/**
 * 사람 축 코호트 화면 렌더 규약 — 티켓 ymfPL2AorfuEniHpVpCT.
 *
 * ★기본 상태가 **빈 상태**다. 실데이터가 사람 1명(내부) / GA4 코호트 0행이라,
 *   사장님이 보시는 화면은 이 파일의 "실측 모양" 케이스 그대로다. 이게 깨지면
 *   보이는 것이 그것뿐이다.
 *
 * 못박는 것:
 *   1. 모든 숫자 옆에 축 배지가 있다 — 배지 없는 숫자 카드가 렌더되지 않는다.
 *   2. 경계는 props 에서만 온다. 이 컴포넌트 소스에 날짜 리터럴이 없다.
 *   3. 경계 이전 날은 사람 축 계열에 점이 **없다**(0 이 아니다).
 *   4. GA4 코호트 0행은 "데이터 없음" 이 아니라 **끊긴 단계 + 이유**로 그려진다.
 *   5. 사람 축 블록은 퍼센트를 만들지 않는다.
 *   6. 연결 전 / 읽기 실패 / 각인 꺼짐 상태에서 숫자 0 을 그리지 않는다.
 *
 * ★목 데이터에 진짜 uid·이메일·키는 없다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AxisStat,
  CALLABLE_PERSON_AXIS_COHORT,
  Ga4PersonCohortView,
  PersonAxisBoundaryView,
  PersonAxisScorecardView,
  boundaryDayOf,
  chainBreakIndex,
  splitDailyByBoundary,
  type CohortLoad,
  type PersonAxisCohort,
} from "./PersonAxisCohortPanel";

const BARE_ZERO = />\s*[-−]?0(?:\.0+)?\s*</;
const ANY_PERCENT = /\d+(?:\.\d+)?%/;

function textOf(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

/** ★경계는 목에서만 온다. 소스에는 없다(아래 테스트가 잰다). */
const BOUNDARY = "2026-08-29 13:14:19+00";
const BOUNDARY_DAY = "2026-08-29";

/** 2026-08-29 실측 모양: 사람 1명(내부) · 설치 2 · 사슬 863→550→0→0 · 코호트 0행. */
function realShape(over: Partial<PersonAxisCohort> = {}): PersonAxisCohort {
  return {
    generatedAt: "2026-08-30T00:00:00.000Z",
    rangeDays: 7,
    state: "ready",
    reason: null,
    boundary: {
      firstStampedAt: BOUNDARY,
      lastStampedAt: "2026-08-29 13:26:00+00",
      declaredStampFrom: BOUNDARY_DAY,
      stampGate: "on",
      stampGateReason: null,
      source: "events.userKey 가 처음 붙은 행의 MIN(timestamp)",
    },
    sinceBoundary: {
      stampedRows: 353,
      unstampedRows: 0,
      totalRows: 353,
      people: 1,
      installs: 2,
    },
    daily: [
      {
        day: "2026-08-26",
        axis: "install",
        activeInstalls: 4,
        people: null,
        stampedRows: 0,
        unstampedRows: 900,
      },
      {
        day: "2026-08-27",
        axis: "install",
        activeInstalls: 5,
        people: null,
        stampedRows: 0,
        unstampedRows: 800,
      },
      {
        day: "2026-08-28",
        axis: "install",
        activeInstalls: 3,
        people: null,
        stampedRows: 0,
        unstampedRows: 700,
      },
      {
        day: "2026-08-29",
        axis: "mixed",
        activeInstalls: 3,
        people: 1,
        stampedRows: 353,
        unstampedRows: 11695,
      },
      {
        day: "2026-08-30",
        axis: "person",
        activeInstalls: 2,
        people: 1,
        stampedRows: 120,
        unstampedRows: 0,
      },
    ],
    chain: {
      steps: [
        {
          key: "s1",
          label: "GA4 첫 방문 브라우저",
          count: 863,
          unit: "browser",
          joinKey: "ga4_first_touch_current.gaKey",
        },
        {
          key: "s2",
          label: "⋈ analytics_identity (브라우저→설치)",
          count: 550,
          unit: "install",
          joinKey: "ga_key",
        },
        {
          key: "s3",
          label: "⋈ analytics_user_install (설치→사람)",
          count: 0,
          unit: "person",
          joinKey: "install_key",
        },
        {
          key: "s4",
          label: "⋈ events.userKey (경계 이후 활동한 사람)",
          count: 0,
          unit: "person",
          joinKey: "user_key",
        },
      ],
      breakAtKey: "s3",
      breakReason:
        "링크된 설치 4대 중 analytics_identity 에서 ga_key 를 가진 설치가 0대다. analytics_identity 마지막 갱신 2026-08-20 09:00:00+00, 그 뒤 원장에 들어온 설치 98건이 아직 반영되지 않았다(갱신 스케줄 없음 — 별건 수리).",
      freshness: {
        identityMaxLinkedAt: "2026-08-20 09:00:00+00",
        ledgerMaxLinkedAt: "2026-08-29 12:19:00+00",
        ledgerRowsAfterIdentity: 98,
      },
    },
    cohortRows: [],
    cohortRowsTruncated: false,
    installFallbackRows: [
      {
        source: "(direct)",
        medium: "(none)",
        campaign: "(direct)",
        country: "South Korea",
        installs: 550,
        browsers: 3,
      },
    ],
    personScorecard: {
      basis: "since_link",
      view: "marblo-2253d.marblo_identity.v_person_since_link",
      linkedPeople: 1,
      activatedPeople: 1,
      activatedMinTasks: 3,
      d30: { cohort: 0, retained: 0, pending: 1 },
    },
    personScorecardReason: null,
    queryStatus: { ok: true, errors: [] },
    notes: [
      "사람 축 경계 " +
        BOUNDARY +
        " (events.userKey 첫 행). 이 시각 이전 행은 전부 userKey NULL 이고 백필하지 않는다.",
    ],
    ...over,
  };
}

const ready = (data: PersonAxisCohort): CohortLoad => ({
  data,
  loading: false,
  error: null,
});

// ── 규약 2: 경계를 하드코딩하지 않는다 ────────────────────────────────────────

test("★컴포넌트 소스에 날짜 리터럴이 없다 — 경계는 props 로만 들어온다", () => {
  const src = readFileSync(
    join(__dirname, "PersonAxisCohortPanel.tsx"),
    "utf8",
  );
  assert.doesNotMatch(
    src,
    /20\d{2}-\d{2}-\d{2}/,
    "소스에 YYYY-MM-DD 리터럴이 있다",
  );
});

test("★경계는 props 값이 그대로 화면에 찍힌다 — 다른 값을 주면 다른 값이 찍힌다", () => {
  const a = renderToStaticMarkup(
    <PersonAxisBoundaryView load={ready(realShape())} />,
  );
  assert.match(a, new RegExp(BOUNDARY.replace("+", "\\+")));
  const other = "2027-01-02 03:04:05+00";
  const b = renderToStaticMarkup(
    <PersonAxisBoundaryView
      load={ready(
        realShape({
          boundary: {
            ...realShape().boundary,
            firstStampedAt: other,
            declaredStampFrom: "2027-01-02",
          },
          notes: [],
        }),
      )}
    />,
  );
  assert.match(b, /2027-01-02 03:04:05\+00/);
  assert.doesNotMatch(b, new RegExp(BOUNDARY.replace("+", "\\+")));
});

test("선언(env)과 실측이 다르면 화면이 그 사실을 말하고 실측을 경계로 쓴다", () => {
  const html = renderToStaticMarkup(
    <PersonAxisBoundaryView
      load={ready(
        realShape({
          boundary: {
            ...realShape().boundary,
            declaredStampFrom: "2026-08-25",
          },
        }),
      )}
    />,
  );
  assert.match(html, /실측\(2026-08-29\)과 다릅니다/);
  assert.match(html, /화면의 경계선은 실측입니다/);
});

// ── 규약 3: 경계 이전은 사람 축에 점이 없다 ──────────────────────────────────

test("★splitDailyByBoundary: 사람 축 계열은 경계 이전 날에 점이 없다 (0 이 아니다)", () => {
  const s = splitDailyByBoundary(realShape().daily);
  assert.deepEqual(
    s.personSeries.points.map((p) => p.date),
    ["2026-08-29", "2026-08-30"],
  );
  assert.equal(s.installSeries.points.length, 5);
  assert.equal(s.preBoundaryDays, 3);
  assert.equal(s.postBoundaryDays, 2);
  assert.match(s.installSeries.label, /설치 축/);
  assert.match(s.personSeries.label, /사람 축/);
});

test("boundaryDayOf 는 앞 10자다", () => {
  assert.equal(boundaryDayOf(BOUNDARY), BOUNDARY_DAY);
  assert.equal(boundaryDayOf(null), null);
});

test("경계 전후가 **다른 차트**에 그려진다 — 설치 축 차트와 사람 축 차트 제목이 둘 다 있다", () => {
  const html = renderToStaticMarkup(
    <PersonAxisBoundaryView load={ready(realShape())} />,
  );
  assert.match(html, /설치 축 · 일별 활성 설치 \(전 구간\)/);
  assert.match(html, /사람 축 · 일별 사람 \(경계 이후만\)/);
  assert.match(html, /설치 축만 있는 날/);
  assert.match(html, /사람 축이 있는 날/);
});

// ── 규약 1: 축 배지 ─────────────────────────────────────────────────────────

test("★경계 이후 원수 카드 넷에 전부 축 배지가 붙는다 (사람·설치·이벤트 행)", () => {
  const html = renderToStaticMarkup(
    <PersonAxisBoundaryView load={ready(realShape())} />,
  );
  const cards = html.match(/data-axis="(person|install|event|browser)"/g) ?? [];
  assert.ok(
    cards.length >= 5,
    `축 배지 ${cards.length}개 — 경계 카드 1 + 원수 카드 4 이상이어야 한다`,
  );
  assert.match(html, /data-axis="person"/);
  assert.match(html, /data-axis="install"/);
  assert.match(html, /data-axis="event"/);
  // 단위가 축을 따라간다: 사람은 명, 설치는 건.
  assert.match(html, /경계 이후 사람/);
  assert.match(html, /경계 이후 설치/);
});

test("AxisStat 은 축 배지 없이는 타입이 안 맞는다 — 배지가 렌더에 반드시 포함된다", () => {
  const html = renderToStaticMarkup(
    <AxisStat label="x" value={3} axis="install" />,
  );
  assert.match(html, /data-axis="install"/);
  assert.match(html, />3<span[^>]*>건</);
});

// ── 규약 4: 0행은 이유와 함께 ────────────────────────────────────────────────

test("★실측 모양(코호트 0행): '데이터 없음' 이 아니라 끊긴 단계와 이유가 그려진다", () => {
  const html = renderToStaticMarkup(
    <Ga4PersonCohortView load={ready(realShape())} />,
  );
  const text = textOf(html);
  assert.match(html, /data-chain-step="s3" data-chain-broken="true"/);
  assert.match(text, /★여기서 끊김/);
  assert.match(text, /왜 0 인가:/);
  assert.match(text, /ga_key 를 가진 설치가 0대/);
  assert.match(text, /98건/);
  assert.match(text, /지금 이 표는 0행입니다 — 데이터가 없어서가 아닙니다/);
  assert.match(text, /사슬 s3 단계에서 남는 사람이 0/);
  assert.match(text, /같은\s*쿼리로 그대로 채워집니다/);
  assert.doesNotMatch(text, /데이터 없음/);
  // 사슬 단계 수는 남아 있다 — 863 / 550 이 축 배지와 함께.
  assert.match(text, /863/);
  assert.match(text, /550/);
  // 설치 축 폴백은 사람 열이 없다.
  assert.match(text, /같은 표를 설치 축까지만/);
  assert.match(text, /550건/);
  assert.match(text, /3대/);
});

test("chainBreakIndex 는 끊긴 단계의 위치다", () => {
  assert.equal(chainBreakIndex(realShape().chain), 2);
  assert.equal(chainBreakIndex(null), -1);
  const alive = realShape().chain!;
  assert.equal(chainBreakIndex({ ...alive, breakAtKey: null }), -1);
});

test("사슬이 복구된 모양(코호트 행 있음)이면 표가 그려지고 '끊김' 은 사라진다", () => {
  const html = renderToStaticMarkup(
    <Ga4PersonCohortView
      load={ready(
        realShape({
          chain: {
            ...realShape().chain!,
            steps: realShape().chain!.steps.map((s) => ({
              ...s,
              count: s.key === "s3" ? 2 : s.key === "s4" ? 1 : s.count,
            })),
            breakAtKey: null,
            breakReason: null,
          },
          cohortRows: [
            {
              source: "google",
              medium: "cpc",
              campaign: "launch",
              country: "South Korea",
              peopleLinked: 2,
              peopleWithEvents: 1,
              stampedRows: 120,
              taskDone: 0,
            },
          ],
        }),
      )}
    />,
  );
  const text = textOf(html);
  assert.doesNotMatch(text, /여기서 끊김/);
  assert.match(text, /google/);
  assert.match(text, /2명/);
  assert.match(text, /1명/);
  assert.doesNotMatch(text, /지금 이 표는 0행입니다/);
});

// ── 규약 5: 사람 축 블록은 퍼센트를 만들지 않는다 ──────────────────────────────

test("★사람 축 스코어카드(실측: 사람 1 · D30 분모 0): 퍼센트 없음 · 분모 0 은 판단 불가", () => {
  const html = renderToStaticMarkup(
    <PersonAxisScorecardView load={ready(realShape())} />,
  );
  const text = textOf(html);
  assert.doesNotMatch(text, ANY_PERCENT, "사람 축 블록에 퍼센트가 있다");
  assert.match(text, /판단 불가/);
  assert.match(text, /창이 닫힌 사람이 아직 없어 분모가 없습니다/);
  assert.match(text, /Activated \(task ≥ 3\)/);
  assert.match(html, /data-axis="person"/);
  assert.match(text, /위 11개 격자의 Activated · D7\/D14\/D30 은 설치 축/);
  assert.match(text, /값을 바꾸지 않았습니다/);
});

test("사람 축 D30 분모가 있어도 분수만 그린다", () => {
  const html = renderToStaticMarkup(
    <PersonAxisScorecardView
      load={ready(
        realShape({
          personScorecard: {
            ...realShape().personScorecard!,
            d30: { cohort: 4, retained: 1, pending: 2 },
          },
        }),
      )}
    />,
  );
  const text = textOf(html);
  assert.match(text, /1\/4/);
  assert.doesNotMatch(text, ANY_PERCENT);
});

test("사람 축 게이트가 닫혀 스코어카드가 없으면 사유를 적고 설치 축 값은 그대로라고 말한다", () => {
  const html = renderToStaticMarkup(
    <PersonAxisScorecardView
      load={ready(
        realShape({
          personScorecard: null,
          personScorecardReason: "PERSON_AXIS_EFFECTIVE_FROM 미설정",
        }),
      )}
    />,
  );
  const text = textOf(html);
  assert.match(text, /PERSON_AXIS_EFFECTIVE_FROM 미설정/);
  assert.match(text, /설치 축이고 그 값은 그대로입니다/);
  assert.doesNotMatch(html, BARE_ZERO);
});

// ── 규약 6: 비수치 상태에서 0 을 그리지 않는다 ──────────────────────────────

test("연결 전(notDeployed): 콜러블 이름과 '연결 전' 배지, 숫자 0 없음", () => {
  const load: CohortLoad = {
    data: null,
    loading: false,
    error: null,
    notDeployed: true,
  };
  for (const View of [
    PersonAxisBoundaryView,
    PersonAxisScorecardView,
    Ga4PersonCohortView,
  ]) {
    const html = renderToStaticMarkup(<View load={load} />);
    assert.match(html, /연결 전/);
    assert.match(html, new RegExp(CALLABLE_PERSON_AXIS_COHORT));
    assert.doesNotMatch(html, BARE_ZERO);
    assert.doesNotMatch(html, /tabular-nums/);
  }
});

test("읽기 실패(state=unavailable): 사유가 보이고 숫자 0 없음", () => {
  const data = realShape({
    state: "unavailable",
    reason: "events.userKey 경계를 읽지 못했다: boom",
    sinceBoundary: null,
    chain: null,
    daily: [],
    personScorecard: null,
  });
  for (const View of [
    PersonAxisBoundaryView,
    PersonAxisScorecardView,
    Ga4PersonCohortView,
  ]) {
    const html = renderToStaticMarkup(<View load={ready(data)} />);
    assert.match(html, /boom/);
    assert.doesNotMatch(html, BARE_ZERO);
  }
});

test("각인 꺼짐(stampGate=off): 사람 축은 '없음' 이고 설치 축 차트만 남는다 · 코호트는 '조회하지 않음'", () => {
  const data = realShape({
    boundary: {
      firstStampedAt: null,
      lastStampedAt: null,
      declaredStampFrom: null,
      stampGate: "off",
      stampGateReason: "EVENTS_PERSON_STAMP_FROM 미설정",
      source: "x",
    },
    sinceBoundary: null,
    chain: null,
    daily: realShape().daily.map((d) => ({
      ...d,
      axis: "install" as const,
      people: null,
    })),
  });
  const b = textOf(
    renderToStaticMarkup(<PersonAxisBoundaryView load={ready(data)} />),
  );
  assert.match(b, /각인이 꺼져 있습니다/);
  assert.match(b, /0 이 아니라 없음/);
  assert.doesNotMatch(b, /사람 축 · 일별 사람/);
  const c = textOf(
    renderToStaticMarkup(<Ga4PersonCohortView load={ready(data)} />),
  );
  assert.match(c, /조회하지 않은 것/);
  assert.doesNotMatch(c, /여기서 끊김/);
});

test("각인은 켜졌지만 아직 첫 행이 없으면 경계 카드가 그 사실을 말하고 사람 차트는 pending", () => {
  const data = realShape({
    boundary: {
      ...realShape().boundary,
      firstStampedAt: null,
      lastStampedAt: null,
    },
    sinceBoundary: null,
    chain: null,
    daily: realShape().daily.map((d) => ({
      ...d,
      axis: "install" as const,
      people: null,
    })),
  });
  const html = renderToStaticMarkup(
    <PersonAxisBoundaryView load={ready(data)} />,
  );
  const text = textOf(html);
  assert.match(text, /아직 각인된 행이 없습니다/);
  assert.match(text, /각인 전 — 사람 축 시계열이 아직 없습니다/);
});

test("로딩 중에는 숫자를 그리지 않는다", () => {
  const html = renderToStaticMarkup(
    <PersonAxisBoundaryView
      load={{ data: null, loading: true, error: null }}
    />,
  );
  assert.match(html, /불러오는 중/);
  assert.doesNotMatch(html, /tabular-nums/);
});
