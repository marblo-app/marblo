/**
 * ⓪ KPI 탭(베타 종료 스코어카드) 렌더 규약 — 티켓 6jeXDBQ1xoH0FoXwjqAL.
 *
 * ★이 화면의 실패 모드는 "숫자가 안 나온다" 가 아니라 **"틀린 숫자를 예쁘게
 *   그린다"** 다. 그래서 못박는 것도 그쪽이다:
 *
 *   1. 모든 비율에 **분모**가 함께 그려진다. `50%` 만 있고 `3/6` 이 없으면 실패.
 *   2. 축이 **설치**임을 화면이 **말한다**. '명' 으로 읽히면 거짓이다.
 *   3. 측정 못 하는 지표는 **0 을 안 그린다**(흐린 0 도 0 으로 읽힌다).
 *   4. 사람 축 블록은 **비율을 만들지 않는다**(분모 1~2에서 %는 동전 던지기다).
 *   5. D30 이 가장 크다(사장님이 그게 제일 중요하다고 명시하셨다).
 *
 * ★목 데이터에 진짜 uid·이메일·키는 없다. 전부 더미값이다.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  BetaScorecard,
  BusinessSummary,
  ScorecardMetric,
} from "./AnalyticsPanel";

type PanelModule = typeof import("./AnalyticsPanel");
let P: PanelModule;

before(async () => {
  // 패널은 모듈 로드 시 firebase 앱을 초기화한다(AnalyticsPanelStates 와 같은 이유).
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY ??= "test-api-key";
  P = await import("./AnalyticsPanel");
});

/** 한 엘리먼트의 전체 텍스트가 0 인 자리. 흐리게 칠해도 잡힌다. */
const BARE_ZERO = />\s*[-−]?0(?:\.0+)?\s*</;
const ANY_PERCENT = /(\d+(?:\.\d+)?)%/g;

function textOf(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

function impossiblePercents(html: string): string[] {
  return (html.match(ANY_PERCENT) ?? []).filter((s) => parseFloat(s) > 100);
}

// ── 목 봉투 ────────────────────────────────────────────────────────────────
// 서버 순수 빌더(buildBetaScorecard)의 응답 shape 그대로. 값은 2026-08-29
// 프로덕션 실측을 흉내낸 것이고 식별자는 하나도 없다.

function metric(over: Partial<ScorecardMetric>): ScorecardMetric {
  return {
    key: "x",
    label: "X",
    definition: "정의",
    measuredAs: "설치 축으로 셌다",
    axis: "install",
    unit: "count",
    value: 0,
    counted: null,
    targetMin: 10,
    targetMax: 10,
    seedMin: null,
    attainment: 0,
    remaining: 10,
    met: false,
    measurable: true,
    unmeasuredReason: null,
    externalSource: null,
    ...over,
  };
}

const rate = (
  key: string,
  label: string,
  n: number,
  d: number,
  targetMin: number,
  targetMax: number
): ScorecardMetric => {
  const r = d > 0 ? n / d : null;
  return metric({
    key,
    label,
    unit: "rate",
    value: r,
    counted: {
      numerator: n,
      denominator: d,
      rate: r,
      display: `${n}/${d} (${r == null ? "—" : `${(r * 100).toFixed(1)}%`})`,
    },
    targetMin,
    targetMax,
    attainment: r == null ? null : r / targetMin,
    remaining: r == null ? null : Math.max(0, targetMin - r),
    met: r != null && r >= targetMin,
    measuredAs:
      "완료 task 를 한 번이라도 더 한 설치를 셉니다. 단위는 설치입니다.",
  });
};

function scorecard(over: Partial<BetaScorecard> = {}): BetaScorecard {
  return {
    heroKey: "d30_retention",
    smallSampleMax: 10,
    axisNote:
      "이 표의 지표는 익명 설치 축입니다. 두 블록의 숫자를 더하거나 서로 비교하지 마세요.",
    note: "분모가 한 자릿수라 곡선이 의미를 못 가집니다.",
    personAxisCounts: { linkedPeople: 2, peopleWithTask: 1, activePeople: 2 },
    personUnavailableReason: null,
    installUnavailableReason: null,
    leadingIndicators: [
      metric({
        key: "first_spawn_leading",
        label: "첫 스폰 (선행지표 · Activated 아님)",
        value: 18,
        // ★목표 없음 — 달성 판정 자체가 없다.
        targetMin: 0,
        targetMax: 0,
        attainment: null,
        remaining: null,
        met: false,
      }),
    ],
    metrics: [
      metric({
        key: "qualified_beta",
        label: "Qualified Beta",
        axis: "account",
        value: null,
        targetMin: 500,
        targetMax: 500,
        seedMin: 500,
        attainment: null,
        remaining: null,
        externalSource: "getAdminBusinessSummary.betaAccess.grantTotal",
      }),
      rate("d7_retention", "D7 Retention", 3, 7, 0.35, 0.35),
      rate("d14_retention", "D14 Retention", 4, 7, 0.25, 0.3),
      rate("d30_retention", "D30 Retention", 3, 6, 0.15, 0.2),
      metric({
        key: "paying_users",
        label: "Paying Users",
        axis: "account",
        value: null,
        attainment: null,
        remaining: null,
        targetMin: 20,
        targetMax: 50,
        externalSource: "getAdminBusinessSummary.subscriptions.paidCurrent",
      }),
      metric({
        key: "design_partners",
        label: "Design Partners",
        axis: "manual",
        value: null,
        attainment: null,
        remaining: null,
        targetMin: 3,
        targetMax: 5,
        measurable: false,
        unmeasuredReason: "계약·영업 사실이라 텔레메트리에 없습니다.",
      }),
    ],
    ...over,
  };
}

const legacyGauge = {
  key: "retention_7d",
  label: "7일 잔존(2번째 세션 근사)",
  unit: "rate" as const,
  current: 0.2,
  target: 0.3,
  met: false,
  numerator: 2,
  denominator: 10,
};

/**
 * 계정 축 목 봉투. 실측(2026-08-29)을 흉내낸 값이고 이메일·uid 는 없다.
 *   신청 73 → 선정 65 → 접근권 34 → 유효 8 · 만료 26 · 부여기간 1개월
 */
function business(over: Partial<BusinessSummary> = {}): BusinessSummary {
  return {
    rangeDays: 30,
    generatedAt: "2026-08-29T00:00:00.000Z",
    subscriptions: {
      total: 35,
      byStatus: { active: 9, canceled: 26 },
      byPlanActive: {},
      byProviderActive: {},
      paidProActive: 1,
      founderGrantActive: 8,
      pastDue: 0,
      newInWindow: 0,
      churnedInWindow: 0,
      proConversionRateVsSubscribers: 0,
      proConversionRateVsWaitlist: 0,
    },
    founders: {
      total: 65,
      accessGranted: 65,
      interviewCompleted: 0,
      feedbackSubmitted: 0,
    },
    waitlist: { total: 73, newInWindow: 0 },
    agents: {
      liveCount: 0,
      byStatus: {},
      rollingTotalCost: 0,
      rollingTotalTokens: 0,
    },
    betaAccess: {
      grantTotal: 34,
      grantActive: 8,
      grantExpired: 26,
      expiryMonths: 1,
    },
    ...(over as object),
  } as BusinessSummary;
}

function render(
  over: Partial<BetaScorecard> = {},
  biz: BusinessSummary | null = business()
) {
  return renderToStaticMarkup(
    <P.BetaScorecardView
      scorecard={scorecard(over)}
      biz={biz}
      legacyRetention={[legacyGauge]}
      rangeDays={30}
    />
  );
}

// ── 1) 모든 비율에 분모가 붙는다 ───────────────────────────────────────────

test("★모든 비율이 분수와 함께 그려진다 — 퍼센트만 있는 자리가 없다", () => {
  const t = textOf(render());
  // 분수가 먼저다. 퍼센트는 그 옆 작은 글씨(Ratio 규약).
  assert.match(t, /3\/7/, "D7 분수가 없다");
  assert.match(t, /4\/7/, "D14 분수가 없다");
  assert.match(t, /3\/6/, "D30 분수가 없다");
  // 그리고 각 분수 옆에 퍼센트가 붙는다.
  assert.match(t, /42\.9%/);
  assert.match(t, /57\.1%/);
  assert.match(t, /50\.0%/);
});

test("★100% 를 넘는 퍼센트가 화면까지 오지 않는다", () => {
  assert.deepEqual(impossiblePercents(render()), []);
});

// ── 2) 축을 말한다 ─────────────────────────────────────────────────────────

test("★축이 설치임을 화면이 말한다 — '명' 으로 읽힐 자리를 남기지 않는다", () => {
  const t = textOf(render());
  assert.match(t, /설치 축/, "축 배지/경고가 없다");
  assert.match(t, /더하거나/, "두 축을 섞지 말라는 문장이 없다");
  // 운영자 제외가 이 축에서 불가능하다는 사실도 숨기지 않는다.
  assert.match(t, /운영자 제외/);
  assert.match(t, /낙관 편향/);
});

test("축이 다른 지표는 배지로 갈린다(계정 축 · 수동)", () => {
  const t = textOf(render());
  assert.match(t, /계정 축/);
  assert.match(t, /수동\(측정 안 함\)/);
});

// ── 3) 측정 불가 지표는 0 을 안 그린다 ─────────────────────────────────────

test("★측정 불가 지표는 0 이 아니라 '측정 안 함' 이다", () => {
  const html = render({
    metrics: [
      metric({
        key: "design_partners",
        label: "Design Partners",
        axis: "manual",
        value: null,
        attainment: null,
        remaining: null,
        targetMin: 3,
        targetMax: 5,
        measurable: false,
        unmeasuredReason: "계약·영업 사실이라 텔레메트리에 없습니다.",
      }),
    ],
    heroKey: "none",
    personAxisCounts: null,
    personUnavailableReason: "링크가 아직 없습니다.",
  });
  const t = textOf(html);
  assert.match(t, /측정 안 함/);
  assert.match(t, /계약·영업 사실/, "왜 못 재는지를 화면이 말해야 한다");
  // ★값 자리에 0 을 그리면 "아직 한 곳도 없다" 로 읽힌다 — 우리는 그것조차 모른다.
  assert.doesNotMatch(html, BARE_ZERO, "측정 불가 지표에 0 이 그려졌다");
});

test("★Paying Users 는 값이 없으면 0 으로 채우지 않고 출처를 말한다", () => {
  // 봉투 자체가 없는 상태(로딩 중·구버전 functions).
  const t = textOf(render({}, null));
  assert.match(t, /다른 봉투 대기/);
  assert.match(t, /getAdminBusinessSummary\.subscriptions\.paidCurrent/);
});

test("Paying Users 는 다른 봉투의 값이 오면 그것으로 채워진다", () => {
  const withPaid = business();
  withPaid.subscriptions.paidCurrent = 34;
  const t = textOf(render({}, withPaid));
  assert.match(t, /Paying Users/);
  // 34 / 목표 20 → 목표 하한 도달.
  assert.match(t, /목표 하한 도달/);
});

test("resolveScorecardMetrics: 숫자가 아니면 채우지 않는다(0 으로 접지 않는다)", () => {
  const m = scorecard().metrics;
  const before = m.find((x) => x.key === "paying_users");
  for (const bad of [null, undefined, NaN]) {
    const out = P.resolveScorecardMetrics(m, { payingUsers: bad });
    const after = out.find((x) => x.key === "paying_users");
    assert.equal(after?.value, null, `payingUsers=${String(bad)} 에서 채워졌다`);
    assert.equal(after?.met, false);
  }
  const filled = P.resolveScorecardMetrics(m, { payingUsers: 34 }).find(
    (x) => x.key === "paying_users"
  );
  assert.equal(filled?.value, 34);
  assert.equal(filled?.met, true);
  assert.equal(filled?.remaining, 0);
  // ★원본 배열을 변형하지 않는다.
  assert.equal(before?.value, null);
});

// ── 4) 사람 축은 비율을 만들지 않는다 ──────────────────────────────────────

test("★사람 축 블록은 원수만 내고 비율을 만들지 않는다", () => {
  const t = textOf(render());
  assert.match(t, /링크가 닿은 사람/);
  assert.match(t, /실제 Task 를 한 사람/);
  // 왜 비율을 안 그리는지 화면이 직접 말한다.
  assert.match(t, /D7\/D14\/D30 비율을 그리지 않습니다/);
  assert.match(t, /100%p/);
});

test("사람 축이 없으면 0 이 아니라 '연결 전' 으로 접는다", () => {
  const html = render({
    personAxisCounts: null,
    personUnavailableReason: "사람 축 게이트가 닫혀 있습니다.",
  });
  const t = textOf(html);
  assert.match(t, /사람 축 게이트가 닫혀 있습니다/);
  // ★'연결 전' 이지 '0명' 이 아니다.
  assert.match(t, /연결 전/);
  // ★사람 수 **값 자리**를 세우지 않는다. "링크가 닿은 사람 수" 라는 글자는
  //   '붙으면 보임' 목록에 남아도 되지만(그건 설명이다), 그 옆에 숫자가 붙은
  //   StatCard 는 없어야 한다 — 숫자가 붙는 순간 0 으로 읽힐 칸이 생긴다.
  assert.doesNotMatch(
    t,
    /링크가 닿은 사람\d/,
    "사람 수 값 자리가 세워졌다"
  );
  assert.doesNotMatch(t, /연결 이후 구간에 활동 기록이 있는 사람 수/);
});

// ── 5) D30 이 가장 크다 ────────────────────────────────────────────────────

test("★D30 이 시각적으로 가장 크다(사장님 1순위)", () => {
  const html = render();
  assert.match(html, /★D30 Retention — 베타 종료 판단의 1순위/);
  // 히어로 카드만 lg 크기 분수(text-lg)를 쓴다 — 나머지는 text-sm 이다.
  const heroFraction = html.match(/text-lg[^>]*>3\/6</);
  assert.ok(heroFraction, "D30 분수가 히어로 크기로 그려지지 않았다");
  // 그리고 그 자리에 '분모가 작으면 달성이 아니다' 가 붙어 있다.
  const t = textOf(html);
  assert.match(t, /아직 아무것도 모른다/);
});

test("★분모가 작으면 화면이 경고한다(분수를 읽고 퍼센트는 참고만)", () => {
  const t = textOf(render());
  assert.match(t, /표본이/);
  assert.match(t, /퍼센트는 한 건이 움직일 때마다/);
});

// ── 6) 리텐션 정의가 둘이라는 사실 ─────────────────────────────────────────

test("★리텐션 정의 두 벌이 라벨로 갈려 나란히 보인다", () => {
  const t = textOf(render());
  assert.match(t, /리텐션 정의가 둘입니다/);
  assert.match(t, /사장님 정의 \(실제 Task 수행\)/);
  assert.match(t, /기존 베타종료 게이지 \(2번째 세션 근사\)/);
  // 기존 게이지 값도 분모와 함께.
  assert.match(t, /2\/10/);
});

// ── 7) 분모 0 ──────────────────────────────────────────────────────────────

test("★분모가 0 이면 0.0% 가 아니라 '—' 다(분수는 남는다)", () => {
  const html = render({
    metrics: [rate("d30_retention", "D30 Retention", 0, 0, 0.15, 0.2)],
  });
  const t = textOf(html);
  // ★분수는 남긴다(지우면 측정값을 숨기는 것이다). 퍼센트 자리만 '—' 다.
  // ★목표 라벨에도 "20.0%" 같은 글자가 있으므로 **값 자리**만 좁혀서 잰다 —
  //   넓게 재면 정직한 목표 표기가 결함으로 잡힌다.
  assert.match(t, /0\/0\(—\)/, "분모 0 자리가 '0/0 (—)' 이 아니다");
  assert.doesNotMatch(t, /0\/0\(\d/, "분모 0 에 퍼센트를 그렸다");
  // 값 자리에 "0.0%" 가 없다(목표 라벨의 20.0% 는 값이 아니다).
  assert.doesNotMatch(t, /표본 없음0\.0%/);
});

// ── 8) 설치 축 조회 실패 ───────────────────────────────────────────────────

test("★설치 축을 못 읽으면 0 이 아니라 사유가 뜨고 값은 '—' 다", () => {
  const html = render({
    installUnavailableReason: "kpi.scorecard 조회가 실패했습니다.",
    metrics: [
      metric({
        key: "qualified_beta",
        label: "Qualified Beta",
        value: null,
        attainment: null,
        remaining: null,
        targetMin: 400,
        targetMax: 500,
        measurable: false,
        unmeasuredReason: "kpi.scorecard 조회가 실패했습니다.",
      }),
    ],
    heroKey: "none",
    personAxisCounts: null,
    personUnavailableReason: "링크 없음",
  });
  const t = textOf(html);
  assert.match(t, /설치 축 지표를 못 읽었습니다/);
  assert.match(t, /kpi\.scorecard 조회가 실패했습니다/);
  // ★'—' 를 0 으로 오독하지 말라고 화면이 직접 말한다.
  assert.match(t, /‘—’ 는 ‘0’ 이 아닙니다|—.*는.*0.*이 아닙니다/);
  // 값 자리에 0 이 없다.
  assert.doesNotMatch(html, BARE_ZERO);
});

// ── 9) ★리뷰 반영 — 사장님 최종 확정 정의 ─────────────────────────────────

test("★D30 카드 밑에 접근권 만료 경고가 붙는다 (제품 이탈 ≠ 정책 만료)", () => {
  const html = render();
  const t = textOf(html);
  assert.match(t, /접근권 만료.*그리고 있을 수|제품 리텐션이 아니라/);
  assert.match(t, /접근권 부여/);
  assert.match(t, /만료로 끊긴 인원/);
  // 부여 34 중 26 만료 — 분수로 그린다(숫자만 던지지 않는다).
  assert.match(t, /26\/34/);
  // 부여 기간은 서버가 준 숫자를 그대로 읽는다(web 에 상수를 복제하지 않는다).
  assert.match(t, /1개월/);
  // ★D30 히어로 **뒤에** 와야 한다 — 위로 올라가면 D30 을 가린다.
  const heroAt = html.indexOf("베타 종료 판단의 1순위");
  const warnAt = html.indexOf("만료로 끊긴 인원");
  assert.ok(heroAt >= 0 && warnAt > heroAt, "경고가 D30 히어로 앞에 있다");
});

test("★왜 D30 분모를 보정하지 않았는지 화면이 말한다 (축 조인 금지)", () => {
  const t = textOf(render());
  assert.match(t, /보정하지 않았습니다/);
  assert.match(t, /assertAxisPurity/);
  assert.match(t, /공유하는 조인 키는 없습니다/);
});

test("접근권 봉투가 없으면 0 이 아니라 무엇을 기다리는지 적는다", () => {
  const noAccess = business();
  delete (noAccess as { betaAccess?: unknown }).betaAccess;
  const html = render({}, noAccess);
  const t = textOf(html);
  assert.match(t, /getAdminBusinessSummary\.betaAccess/);
  assert.match(t, /구분되지 않습니다/);
  // 만료 0명이라고 그리지 않는다.
  assert.doesNotMatch(t, /만료로 끊긴 인원/);
});

test("★Qualified Beta 사다리가 신청·선정·접근권·유효 넷을 갈라 그린다", () => {
  const t = textOf(render());
  for (const label of ["신청", "선정(승인)", "접근권 부여", "현재 유효"]) {
    assert.match(t, new RegExp(label.replace(/[()]/g, "\\$&")));
  }
  assert.match(t, /73/); // 신청
  assert.match(t, /65/); // 선정
  // ★선정 65 → 접근권 34 사이의 31명 구멍을 화면이 말한다.
  assert.match(t, /31명.*접근권 문서가 없습니다|접근권 문서가 없습니다/);
});

test("★Qualified Beta 는 설치 수(44)가 아니라 계정 축 값으로 채워진다", () => {
  const t = textOf(render());
  // 접근권 부여 34 가 지표 값이 된다. 설치 수 44 는 이 지표에 안 들어간다.
  const m = P.resolveScorecardMetrics(scorecard().metrics, {
    payingUsers: null,
    qualifiedBeta: 34,
  }).find((x) => x.key === "qualified_beta");
  assert.equal(m?.value, 34);
  assert.equal(m?.targetMin, 500);
  assert.equal(m?.met, false);
  assert.equal(m?.remaining, 466);
  assert.match(t, /Qualified Beta/);
});

test("★선행지표는 KPI 격자 밖 · 목표 없음 · Activated 로 안 읽힌다", () => {
  const t = textOf(render());
  assert.match(t, /광고 최적화용 선행지표 — KPI 가 아닙니다/);
  assert.match(t, /베타 종료·Seed 판단에는 쓰지 마세요/);
  assert.match(t, /첫 스폰/);
  assert.match(t, /Activated 아님/);
  // ★목표가 없으므로 이 줄에 '목표 하한 도달' 이 뜨면 안 된다(늘 초록 금지).
  const spawnBlock = t.slice(t.indexOf("광고 최적화용 선행지표"));
  assert.doesNotMatch(
    spawnBlock.slice(0, 600),
    /목표 하한 도달/,
    "목표 없는 줄이 '달성'으로 떴다"
  );
});

test("★선행지표가 비면 그 섹션 자체가 없다(빈 칸을 세우지 않는다)", () => {
  const t = textOf(render({ leadingIndicators: [] }));
  assert.doesNotMatch(t, /광고 최적화용 선행지표/);
});

test("resolveScorecardMetrics: 좌표가 다른 두 값이 서로 섞이지 않는다", () => {
  const out = P.resolveScorecardMetrics(scorecard().metrics, {
    payingUsers: 7,
    qualifiedBeta: 34,
  });
  assert.equal(out.find((m) => m.key === "paying_users")?.value, 7);
  assert.equal(out.find((m) => m.key === "qualified_beta")?.value, 34);
  // 외부 소스가 없는 지표는 손대지 않는다.
  const d30 = out.find((m) => m.key === "d30_retention");
  assert.equal(d30?.value, 0.5);
});
