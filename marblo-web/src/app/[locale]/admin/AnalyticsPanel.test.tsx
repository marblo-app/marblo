/**
 * ★어드민 분석 4탭의 정직성 규약을 **렌더된 HTML 바이트로** 확인한다.
 *
 * 이 화면의 실패 모드는 버그가 아니라 오독이다 — 2명짜리 표본을 "50%" 로 크게
 * 띄우고, 소스가 없어서 비어 있는 칸에 0 을 그리는 것. 그래서 테스트도 "함수가
 * 돈다"가 아니라 "화면에 분모가 남아 있나 / 0 을 그리지 않았나"를 본다.
 *
 * AnalyticsPanel 은 모듈 로드 시 firebase 앱을 초기화한다(auth 가 apiKey 를
 * 요구한다). 그래서 정적 import 가 아니라 env 를 세운 뒤 동적 import 한다 —
 * 대역 컴포넌트를 흉내내지 않고 **화면이 실제로 쓰는 컴포넌트**를 렌더하기 위해서다.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  RetentionCohorts,
  OnboardingFunnel,
  OnboardingFunnelStep,
  StreakRetentionAxis,
  StreakUnit,
} from "./AnalyticsPanel";

type PanelModule = typeof import("./AnalyticsPanel");
let P: PanelModule;

before(async () => {
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY ??= "test-api-key";
  P = await import("./AnalyticsPanel");
});

// ── 분자/분모 규약 ──────────────────────────────────────────────────────────

test("Ratio 는 퍼센트를 분수 뒤에만 놓는다 (1/2 (50.0%))", () => {
  const html = renderToStaticMarkup(<P.Ratio numerator={1} denominator={2} />);
  assert.match(html, /1\/2/);
  assert.match(html, /\(50\.0%\)/);
  // 분수가 퍼센트보다 앞에 나와야 한다 — 순서가 뒤집히면 큰 글씨가 퍼센트가 된다.
  assert.ok(html.indexOf("1/2") < html.indexOf("50.0%"));
});

test("Ratio 는 분모 0 을 0.0% 가 아니라 — 로 그린다", () => {
  const html = renderToStaticMarkup(<P.Ratio numerator={0} denominator={0} />);
  assert.match(html, /0\/0/);
  assert.match(html, /\(—\)/);
  assert.doesNotMatch(html, /0\.0%/);
});

test("RatioCard 의 큰 글씨는 분수, 작은 글씨가 퍼센트다", () => {
  const html = renderToStaticMarkup(
    <P.RatioCard label="유료 전환" numerator={1} denominator={8} />
  );
  const big = html.indexOf("text-2xl");
  const frac = html.indexOf("1/8");
  const pct = html.indexOf("12.5%");
  assert.ok(big >= 0 && frac > big, "분수가 text-2xl 블록 안에 있어야 한다");
  assert.ok(frac < pct, "퍼센트가 분수보다 앞에 오면 안 된다");
});

test("작은 표본이면 화면이 경고한다 / 충분하면 조용하다", () => {
  const small = renderToStaticMarkup(
    <P.SmallSampleNotice n={2} what="코호트" unit="명" />
  );
  assert.match(small, /2명/);
  assert.match(small, /퍼센트/);
  const big = renderToStaticMarkup(
    <P.SmallSampleNotice n={5000} what="코호트" unit="명" />
  );
  assert.equal(big, "");
});

// ── 0 이 '없음' 인지 '미측정' 인지 ──────────────────────────────────────────

test("적재 전 칸은 0 을 그리지 않고 무엇을 기다리는지 말한다", () => {
  const html = renderToStaticMarkup(
    <P.PendingIngestion
      title="MRR · LTV"
      waitingOn="analytics_purchase 적재"
      willShow={["MRR", "코호트 LTV"]}
    />
  );
  assert.match(html, /적재 전/);
  assert.match(html, /analytics_purchase 적재/);
  assert.match(html, /MRR/);
  // ★가짜 0 금지 — 숫자 0 이 단독 토큰으로 등장하면 "아무도 안 샀다"로 읽힌다.
  assert.doesNotMatch(html, />\s*0\s*</);
  assert.doesNotMatch(html, /0%/);
});

test("축 한계 고지는 events 계정축의 NULL 구간을 그대로 싣는다", () => {
  const html = renderToStaticMarkup(
    <P.AxisLimitNote
      notes={[P.EVENTS_ACCOUNT_AXIS_LIMIT, null, undefined, ""]}
    />
  );
  assert.match(html, /2026-08-06~08-10/);
  assert.match(html, /측정되지 않았다/);
});

test("축 한계 고지는 실을 문장이 없으면 아무것도 안 그린다", () => {
  assert.equal(
    renderToStaticMarkup(<P.AxisLimitNote notes={[null, ""]} />),
    ""
  );
});

// ── 06-13 식별자 교체 경계선 ────────────────────────────────────────────────

test("식별자 교체 경계는 구간 안에 있을 때만 선이 된다", () => {
  const dates = ["2026-06-11", "2026-06-12", "2026-06-13", "2026-06-14"];
  assert.equal(P.markerIndex(dates, P.ID_SCHEME_MARKER), 2);
  // 구간이 통째로 교체 이후 → 경계가 화면 밖이라 선을 긋지 않는다.
  assert.equal(
    P.markerIndex(["2026-07-01", "2026-07-02"], P.ID_SCHEME_MARKER),
    null
  );
  // 구간이 통째로 교체 이전 → 그을 자리가 없다.
  assert.equal(
    P.markerIndex(["2026-05-01", "2026-05-02"], P.ID_SCHEME_MARKER),
    null
  );
  assert.equal(P.markerIndex(dates, undefined), null);
});

// ── 탭 = 질문 ───────────────────────────────────────────────────────────────

test("4탭이 각각 한 질문에 대응하고 tablist 로 노출된다", () => {
  assert.deepEqual(
    P.ANALYTICS_TABS.map((t) => t.id),
    ["acquisition", "activation", "retention", "revenue"]
  );
  const html = renderToStaticMarkup(
    <P.AnalyticsTabBar tab="retention" onChange={() => {}} />
  );
  assert.match(html, /role="tablist"/);
  assert.equal((html.match(/role="tab"/g) ?? []).length, 4);
  assert.match(
    html,
    /aria-selected="true"[^>]*aria-controls="analytics-panel-retention"/
  );
  assert.match(html, /남아서 계속 쓰나/);
});

// ── 리텐션/활성화 뷰 ────────────────────────────────────────────────────────

function cohortsFixture(
  over: Partial<RetentionCohorts> = {}
): RetentionCohorts {
  return {
    rangeDays: 30,
    generatedAt: "2026-08-21T00:00:00.000Z",
    cohorts: {
      day: [],
      week: [
        {
          period: "week",
          cohort: "2026-08-03",
          cohortUsers: 2,
          returningUsers: { d1: 1, d7: 0 },
          rates: { d1: 0.5, d7: 0, d14: null, d30: null },
        },
      ],
      note: "계정축 note",
    },
    activationGate: {
      steps: [
        {
          key: "install",
          event: "app:installed",
          label: "설치",
          users: 2,
          dropFromPrev: null,
          dropRateFromPrev: null,
          isMaxDrop: false,
        },
        {
          key: "login",
          event: "auth:login",
          label: "로그인",
          users: 1,
          dropFromPrev: 1,
          dropRateFromPrev: 0.5,
          isMaxDrop: true,
        },
      ],
      maxDrop: null,
      note: "게이트 note",
    },
    ...over,
  };
}

test("리텐션 코호트 표는 모든 칸에 분자/분모를 남긴다", () => {
  const html = renderToStaticMarkup(
    <P.RetentionCohortTableView data={cohortsFixture()} />
  );
  assert.match(html, /1\/2/); // D1 = 1/2
  assert.match(html, /0\/2/); // D7 = 0/2 — 0 도 분모와 함께
  assert.match(html, /계정축 note/);
  // 관측창 미도달(D14/D30) 은 0% 가 아니라 —.
  assert.match(html, /판단 불가/);
  // 2명짜리 표본이면 경고가 함께 뜬다.
  assert.match(html, /2명/);
});

test("코호트가 없으면 0% 가 아니라 '모수가 없다' 고 말한다", () => {
  const data = cohortsFixture();
  data.cohorts.week = [];
  const html = renderToStaticMarkup(<P.RetentionCohortTableView data={data} />);
  assert.match(html, /0% 가 아니라/);
  assert.doesNotMatch(html, /0\.0%/);
});

test("활성화 게이트의 이탈은 전 단계 분모와 함께 나온다", () => {
  const html = renderToStaticMarkup(
    <P.ActivationGateView data={cohortsFixture()} />
  );
  assert.match(html, /−1\/2/); // −50% 가 아니라 −1/2 (−50.0%)
  assert.match(html, /최대 이탈 구간/);
  assert.match(html, /진입 대비/);
  assert.match(html, /게이트 note/);
});

test("계정 귀속 이벤트가 0 이면 '아무도 안 왔다'가 아니라고 적는다", () => {
  const data = cohortsFixture();
  data.activationGate.steps = data.activationGate.steps.map((s) => ({
    ...s,
    users: 0,
    dropFromPrev: null,
    dropRateFromPrev: null,
    isMaxDrop: false,
  }));
  const html = renderToStaticMarkup(<P.ActivationGateView data={data} />);
  assert.match(html, /0 은 &#x27;아무도 안 왔다&#x27;가 아닙니다/);
});

// ── ★리텐션 표현: window 가 기본, exact 는 접힌다 (ticket baJU0Yv1gvux6Q5RQrQt) ──
//
// 이 표의 실패 모드는 "숫자가 틀리는 것" 이 아니라 **어느 숫자를 봐야 하는지 화면이
// 말해 주지 않는 것**이었다. `D7 exact 0%` 가 "활성 사용자 없음" 으로 읽혔다.
// 그래서 테스트도 계산이 아니라 **표현 규약**을 고정한다.

function streakUnitFixture(over: Partial<StreakUnit> = {}): StreakUnit {
  return {
    label: "I-aaaaaa",
    axis: "install",
    firstActive: "2026-08-10",
    lastActive: "2026-08-22",
    activeDays: 3,
    workingDays: 3,
    presentDays: 3,
    maxStreak: 1,
    currentStreak: 1,
    daysSinceLastActive: 0,
    // 격자 = 2026-08-09 ~ 2026-08-22 (14일). x 는 08-10 · 08-14 · 08-22.
    grid: ".x...x.......x",
    gridStart: "2026-08-09",
    gridEnd: "2026-08-22",
    zombie: false,
    adminExcluded: false,
    legacyIdScheme: false,
    suspectedIdSwitchChurn: false,
    inCohortWindow: true,
    mappedAccountLabel: null,
    mappingStatus: "unmapped",
    ...over,
  };
}

/**
 * 실측을 축소한 축: 코호트 3개 중 D7 판정 가능한 게 2개(1개는 관측창 미도달),
 * window 는 1/2 인데 exact 는 0/2 다 — 사장님이 본 그 벌어짐이다.
 */
function streakAxisFixture(
  over: Partial<StreakRetentionAxis> = {}
): StreakRetentionAxis {
  return {
    axis: "install",
    activityDefinition: "활동 = working 하트비트 또는 이벤트가 있는 날",
    gridLegend: "x=활동 · ~=하트비트만 · .=신호 없음",
    gridDays: 14,
    cohortWindowDays: 30,
    unitsObserved: 3,
    unitsZombie: 0,
    unitsAdminExcluded: 0,
    unitsBeforeWindow: 0,
    unitsCohort: 3,
    horizons: [
      {
        key: "d7",
        days: 7,
        pending: 1,
        exact: { numerator: 0, denominator: 2, rate: 0, display: "0/2" },
        window: { numerator: 1, denominator: 2, rate: 0.5, display: "1/2" },
      },
    ],
    units: [
      // 08-10 시작 → D7 창(08-11~08-17)에 08-14 활동 = 잔존. exact(08-17)는 아니다.
      streakUnitFixture(),
      // 08-11 시작 → 그날 말고는 안 왔다 = 미복귀.
      streakUnitFixture({
        label: "I-bbbbbb",
        firstActive: "2026-08-11",
        lastActive: "2026-08-11",
        grid: "..x...........",
        activeDays: 1,
        currentStreak: 0,
        daysSinceLastActive: 11,
      }),
      // 08-21 시작 → D7 관측창 미도달(pending). 분모에 넣지 않는다.
      streakUnitFixture({
        label: "I-cccccc",
        firstActive: "2026-08-21",
        lastActive: "2026-08-21",
        grid: "............x.",
        activeDays: 1,
        daysSinceLastActive: 1,
      }),
    ],
    identityScheme: {
      date: "2026-06-13",
      legacyUnits: 0,
      currentUnits: 3,
      suspectedIdSwitchChurn: 0,
      note: "식별자 스킴 note",
    },
    mapping: null,
    notes: ["축 note"],
    ...over,
  };
}

test("★기본 화면은 window 하나다 — exact 는 지우지 않고 접는다", () => {
  const html = renderToStaticMarkup(
    <P.StreakAxisView axis={streakAxisFixture()} />
  );
  // window 가 열(column)로 서 있다.
  assert.match(html, /window \(1~N일 중\)/);
  // exact 열은 접혀 있다 — 기본 화면에 헤더가 없다.
  assert.doesNotMatch(html, /exact \(\+N일 당일\)/);
  // ★그러나 지워지지 않았다. 펴는 장치가 화면에 있다(습관화를 볼 때 쓴다).
  assert.match(html, /exact 펴기/);
  assert.match(html, /습관화/);
});

test("★왜 두 숫자가 다른지 화면이 한 줄로 말한다", () => {
  const html = renderToStaticMarkup(
    <P.StreakAxisView axis={streakAxisFixture()} />
  );
  assert.match(html, /기본은 window/);
  // exact 의 0 이 이탈이 아니라 노이즈일 수 있다는 걸 화면이 직접 적는다.
  assert.match(html, /노이즈/);
  assert.match(html, /6일째·8일째/);
});

test("★셀 → 아래 사용자별 표. 어느 유닛이 그 셀에 들어갔는지 되찾는다", () => {
  const axis = streakAxisFixture();
  const m = P.deriveHorizonMembership(axis, axis.horizons[0], "window");
  assert.ok(m, "서버 수와 일치하면 링크가 열려야 한다");
  // 관측창 미도달(I-cccccc)은 분모에 없다 — 서버 pending 판정과 같다.
  assert.deepEqual(m.denominator, ["I-aaaaaa", "I-bbbbbb"]);
  assert.deepEqual(m.retained, ["I-aaaaaa"]);

  const ex = P.deriveHorizonMembership(axis, axis.horizons[0], "exact");
  assert.ok(ex);
  assert.deepEqual(ex.denominator, ["I-aaaaaa", "I-bbbbbb"]);
  assert.deepEqual(ex.retained, []);
});

test("★링크는 서버 수와 일치할 때만 열린다 (어긋나면 닫는다)", () => {
  const axis = streakAxisFixture();
  const tampered = {
    ...axis.horizons[0],
    // 서버가 2/2 라고 말하는데 격자로는 1 밖에 안 나온다 → 링크를 열면 안 된다.
    window: { numerator: 2, denominator: 2, rate: 1, display: "2/2" },
  };
  assert.equal(P.deriveHorizonMembership(axis, tampered, "window"), null);
});

test("★격자가 판정 구간을 못 덮으면 추측하지 않고 '연결 불가' 로 둔다", () => {
  // 첫 활동이 격자(최근 14일) 이전 — D7 창이 화면 데이터 밖이다.
  const axis = streakAxisFixture({
    unitsObserved: 1,
    unitsCohort: 1,
    units: [
      streakUnitFixture({
        firstActive: "2026-07-20",
        lastActive: "2026-08-22",
        grid: "x............x",
      }),
    ],
    horizons: [
      {
        key: "d7",
        days: 7,
        pending: 0,
        exact: { numerator: 0, denominator: 1, rate: 0, display: "0/1" },
        window: { numerator: 1, denominator: 1, rate: 1, display: "1/1" },
      },
    ],
  });
  assert.equal(P.deriveHorizonMembership(axis, axis.horizons[0], "window"), null);

  const html = renderToStaticMarkup(<P.StreakAxisView axis={axis} />);
  // 숫자는 서버 판정 그대로 남고, 링크만 닫힌다.
  assert.match(html, /1\/1/);
  assert.match(html, /연결 불가/);
  assert.doesNotMatch(html, /aria-pressed="true"/);
});

test("★링크 가능한 셀은 키보드로 누를 수 있는 버튼이다", () => {
  const html = renderToStaticMarkup(
    <P.StreakAxisView axis={streakAxisFixture()} />
  );
  assert.match(html, /<button[^>]*aria-pressed="false"/);
  assert.match(html, /아래 사용자별 표를 이 셀의 분모로 좁히기/);
});

test("★아래 표의 최근 14일 스파크라인은 그대로다 (이미 좋다 — 유지)", () => {
  const html = renderToStaticMarkup(
    <P.StreakAxisView axis={streakAxisFixture()} />
  );
  assert.match(html, /최근 14일/);
  assert.match(html, /x=활동/);
  // 격자 한 칸이 한 span 이다. 픽스처의 x 는 3+1+1 = 5개.
  assert.equal((html.match(/>x<\/span>/g) ?? []).length, 5);
  // 활동/신호없음이 색으로 갈린다(단, 색만으로 식별하지 않게 문자도 남는다).
  assert.match(html, /text-emerald-400/);
});

// ── 패널 전체가 실제로 서는가 (4탭 재배치 스모크) ──────────────────────────
// 흉내낸 트리가 아니라 화면이 쓰는 그 컴포넌트를 SSR 로 세운다. useEffect 는
// 서버 렌더에서 돌지 않으므로 콜러블은 나가지 않고, 초기 탭의 골격만 나온다.

test("패널은 4탭 tablist 를 세우고 선택된 탭만 렌더한다", () => {
  const html = renderToStaticMarkup(<P.default />);
  assert.match(html, /role="tablist"/);
  assert.equal((html.match(/role="tab"/g) ?? []).length, 4);
  // 기본 탭 = ① 획득. 나머지 탭 패널은 DOM 에 없다(숨김이 아니라 미렌더).
  assert.match(html, /id="analytics-panel-acquisition"/);
  assert.doesNotMatch(html, /id="analytics-panel-activation"/);
  assert.doesNotMatch(html, /id="analytics-panel-retention"/);
  assert.doesNotMatch(html, /id="analytics-panel-revenue"/);
  // 획득 탭은 GA4 브리지 적재 전 칸을 '적재 전' 으로 말한다.
  assert.match(html, /적재 전/);
  assert.match(html, /CAC/);
});

test("운영자 제외가 기본값이다 (체크박스 off)", () => {
  const html = renderToStaticMarkup(<P.default />);
  const box = html.match(/<input type="checkbox"[^>]*>/)?.[0] ?? "";
  assert.ok(box.length > 0, "운영자 포함 토글이 있어야 한다");
  assert.doesNotMatch(box, /checked/);
});
// ── ★사람 축 — 기준 라벨 없는 숫자를 금지한다 (설계 §10.4) ──────────────────
// 이 탭의 실패 모드는 버그가 아니라 **커버리지가 오르는 동안 지표가 저절로
// 좋아 보이는 것**이다. 그래서 아래 테스트는 "값이 맞나"가 아니라 "화면이 아직
// 덜 찼다고 말하고 있나 / 어느 기준인지 말하고 있나"를 본다.

function coverageFixture(
  over: Partial<import("./AnalyticsPanel").PersonAxisCoverage> = {}
): import("./AnalyticsPanel").PersonAxisCoverage {
  return {
    state: "ingesting",
    disabledReason: null,
    linkedInstalls: 6,
    totalInstalls: 43,
    linkedActiveInstalls: 6,
    activeInstalls: 14,
    excludedSharedInstalls: 0,
    effectiveFrom: "2026-04-01",
    basis: "since_link",
    lastLinkedAt: "2026-08-21T00:00:00.000Z",
    ...over,
  };
}

test("★소급 뷰를 쓰는 카드엔 '설치 전체 이력 기준(소급)' 라벨이 붙는다", () => {
  const html = renderToStaticMarkup(
    <P.PersonAxisBasisBadge basis="all_time" effectiveFrom="2026-04-01" />
  );
  assert.match(html, /설치 전체 이력 기준\(소급\)/);
  // 뷰 이름이 곧 고지다 — 어느 뷰인지 툴팁에 남아야 한다.
  assert.match(html, /v_person_all_time/);
  const since = renderToStaticMarkup(
    <P.PersonAxisBasisBadge basis="since_link" />
  );
  assert.match(since, /연결 이후 기준/);
  assert.match(since, /v_person_since_link/);
  // 두 라벨은 서로 다른 말이어야 한다. 같아지면 배지가 아무것도 고지하지 않는다.
  assert.notEqual(
    P.PERSON_AXIS_BASIS_LABEL.since_link,
    P.PERSON_AXIS_BASIS_LABEL.all_time
  );
});

test("★적재 중 화면은 커버리지를 분수로 그리고 라벨 없이 숫자를 내놓지 않는다", () => {
  const html = renderToStaticMarkup(
    <P.IngestionProgress
      coverage={coverageFixture({ excludedSharedInstalls: 2 })}
    />
  );
  // §10.4-3 — "활동한 설치 14대 중 6대 연결됨" 이 분자/분모로 남는다.
  assert.match(html, /6\/14/);
  assert.match(html, /남은/);
  assert.match(html, /8대/); // 14 - 6
  assert.match(html, /지금 표는/);
  // §10.4-1 — complete 가 아니면 퍼센트가 헤드라인이 아니다. 분수가 먼저 온다.
  assert.ok(html.indexOf("6/14") < html.indexOf("42.9%"));
  // §5.5 — 공용 기기 제외는 값을 만들지 않고 센다. 0 이어도 화면에 적는다.
  assert.match(html, /공용 기기로 판정돼 제외/);
  assert.match(html, /2대/);
  // §10.4-4 — "이 수치는 아직 커집니다" 를 먼저 말한다.
  assert.match(html, /아직 커집니다/);
  assert.match(html, /캡처해/);
  // §10.4-2 — 분모는 '전체 설치' 가 아니라 '링크된 설치' 다.
  assert.match(html, /링크된 설치/);
  // §10.4-5 — 기준 배지가 항상 붙는다.
  assert.match(html, /연결 이후 기준/);
});

test("★게이트가 닫힌 것은 '적재 전' 이 아니다 — 다른 말을 쓴다", () => {
  const html = renderToStaticMarkup(
    <P.PersonAxisCoverageNote
      coverage={coverageFixture({
        state: "disabled",
        disabledReason: "PERSON_AXIS_EFFECTIVE_FROM 미설정",
      })}
    />
  );
  assert.match(html, /아직 열지 않음/);
  assert.match(html, /PERSON_AXIS_EFFECTIVE_FROM 미설정/);
  // ★배지가 '적재 전' 이면 "곧 채워집니다" 라는 거짓 기대가 생긴다. 본문에서
  //   '적재 전 과 같은 말로 읽지 마세요' 라고 **가리키는** 것은 그 반대다 —
  //   그래서 배지 자리(>...<)만 본다.
  assert.doesNotMatch(html, />적재 전</);
  assert.match(html, /적재 전.{0,4}과 같은 말로 읽지 마세요/);
  // 가짜 0 금지는 여기서도 같다.
  assert.doesNotMatch(html, />\s*0\s*</);
});

/**
 * ★이 테스트는 §10.4-6("커버리지 0 에 새 상태를 만들지 않는다")을 지키다가
 *   **뒤집힌 자리**다. 티켓 NTQYPWMFCbvJgVLLcBfI 가 `state === "pending"` 을
 *   '적재 전' 에서 갈랐다.
 *
 *   이유는 두 개다.
 *     ① '적재 전' 배지가 달고 오는 본문이 "수치가 0 인 게 아니라 **소스가
 *        없습니다**" 인데, 이 자리에서 그건 사실이 아니다. 소스는 있다 —
 *        활동한 설치가 실제로 세어졌고, 없는 것은 사람 링크뿐이다.
 *     ② **보는 사람이 할 일이 다르다.** '적재 전' 은 기다리면 채워지고, 여기는
 *        기다려도 안 채워질 수 있다(forward-only · 소급 백필 불가).
 *
 *   §10.4-6 이 막으려던 것은 '할 일이 같은 내부 구분을 화면 상태로 만드는 것'
 *   이었고, 그건 **미배선**(coverage == null)에 여전히 살아 있다 — 아래 테스트.
 */
test("커버리지 0(매핑 불가)은 '적재 전' 과 다른 배지·문구를 쓴다 (§10.4-6 개정)", () => {
  const html = renderToStaticMarkup(
    <P.PersonAxisCoverageNote
      coverage={coverageFixture({
        state: "pending",
        linkedInstalls: 0,
        linkedActiveInstalls: 0,
      })}
    />
  );
  // ★배지로 잰다. 본문에서 '적재 전' 을 **부정하는** 문장은 그 반대이므로,
  //   PersonAxisDisabled 테스트와 같은 장치를 쓴다.
  assert.match(html, />매핑 불가</);
  assert.doesNotMatch(html, />적재 전</);
  // 이 자리에서 "소스가 없다" 는 거짓말이다 — 다음 사람이 적재부터 다시 판다.
  assert.doesNotMatch(html, /소스가 없습니다/);
  // ★배포 직후가 정상이라는 사실을 화면이 말해야 한다 — 안 적으면 "켰는데 왜
  //   비어 있지" 로 읽힌다.
  assert.match(html, /forward-only/);
  assert.match(html, /다음에 인증할 때/);
  // ★그리고 "곧 채워지겠지" 로 읽히면 안 된다. 그게 이 상태를 가른 이유다.
  assert.match(html, /기다린다고 채워지는 칸이 아닙니다/);
  assert.match(html, /소급 백필/);
  assert.doesNotMatch(html, /0%/);
});

test("커버리지 자체가 안 실려 오면(배선 전) 가짜 0 대신 '적재 전' 이다", () => {
  const html = renderToStaticMarkup(
    <P.PersonAxisCoverageNote coverage={null} />
  );
  assert.match(html, /적재 전/);
  assert.match(html, /v_person_since_link/);
  assert.doesNotMatch(html, />\s*0\s*</);
  assert.doesNotMatch(html, /0%/);
});

test("완료 상태에서도 기준 라벨과 공용기기 제외 수는 남는다", () => {
  const html = renderToStaticMarkup(
    <P.PersonAxisCoverageNote
      coverage={coverageFixture({
        state: "complete",
        basis: "all_time",
        linkedActiveInstalls: 14,
      })}
    />
  );
  assert.match(html, /14\/14/);
  assert.match(html, /설치 전체 이력 기준\(소급\)/);
  assert.match(html, /공용 기기 제외/);
});

test("퍼센트 헤드라인은 complete 일 때만 열린다 (§10.4-1)", () => {
  assert.equal(P.personAxisHeadlineAllowed(null), false);
  assert.equal(P.personAxisHeadlineAllowed(coverageFixture()), false);
  assert.equal(
    P.personAxisHeadlineAllowed(coverageFixture({ state: "pending" })),
    false
  );
  assert.equal(
    P.personAxisHeadlineAllowed(coverageFixture({ state: "disabled" })),
    false
  );
  assert.equal(
    P.personAxisHeadlineAllowed(coverageFixture({ state: "complete" })),
    true
  );
});

test("발효일 이전으로 뻗는 조회에만 경계 고지를 적는다 (§10.4-7)", () => {
  const cov = coverageFixture();
  assert.match(
    P.personAxisRangeNote(cov, "2026-03-01") ?? "",
    /사람 축이 없던 때/
  );
  // 구간이 통째로 발효일 이후 → 없는 고지를 적는 것도 거짓말이다.
  assert.equal(P.personAxisRangeNote(cov, "2026-05-01"), null);
  assert.equal(P.personAxisRangeNote(cov, "2026-04-01"), null);
  assert.equal(P.personAxisRangeNote(null, "2026-03-01"), null);
  // 게이트가 닫혀 effectiveFrom 이 없으면 그을 근거가 없다.
  assert.equal(
    P.personAxisRangeNote(
      coverageFixture({ effectiveFrom: null }),
      "2026-01-01"
    ),
    null
  );
});

test("발효일 경계선은 06-13 교체선과 같은 장치를 쓴다", () => {
  const marker = P.personAxisMarker(coverageFixture());
  assert.equal(marker?.date, "2026-04-01");
  assert.match(marker?.hint ?? "", /사람 축이 없던 때/);
  // 구간 밖이면 선을 긋지 않는다 — markerIndex 규약을 그대로 탄다.
  assert.equal(P.markerIndex(["2026-03-30", "2026-04-02"], marker), 1);
  assert.equal(P.markerIndex(["2026-05-01", "2026-05-02"], marker), null);
  assert.equal(
    P.personAxisMarker(coverageFixture({ effectiveFrom: null })),
    undefined
  );
});

test("조회 구간 시작일은 클라 시계가 아니라 서버 generatedAt 으로 센다", () => {
  assert.equal(
    P.analyticsRangeStart("2026-08-21T00:00:00.000Z", 30),
    "2026-07-23"
  );
  assert.equal(
    P.analyticsRangeStart("2026-08-21T00:00:00.000Z", 1),
    "2026-08-21"
  );
  assert.equal(P.analyticsRangeStart(null, 30), null);
  assert.equal(P.analyticsRangeStart("2026-08-21T00:00:00.000Z", 0), null);
  assert.equal(P.analyticsRangeStart("not-a-date", 30), null);
});

// ── 설치축 리텐션 요약 (analytics_install_profile) ──────────────────────────

function installSummaryFixture(): import("./AnalyticsPanel").InstallRetentionSummary {
  const rate = (n: number, d: number) => ({
    numerator: n,
    denominator: d,
    rate: d > 0 ? n / d : null,
    display: `${n}/${d}`,
  });
  return {
    installsObserved: 43,
    installsNeverActive: 37,
    installsZombie: 9,
    installsNeverRan: 28,
    installsCohort: 6,
    horizons: [
      { key: "d1", days: 1, pending: 0, exact: rate(1, 6), window: rate(2, 6) },
      { key: "d7", days: 7, pending: 2, exact: rate(0, 4), window: rate(1, 4) },
      {
        key: "d14",
        days: 14,
        pending: 6,
        exact: rate(0, 0),
        window: rate(0, 0),
      },
    ],
    activityDefinition: "활동 정의: status=working 또는 이벤트 1건 이상",
    presentOnlyDefinition: "present_only: 하트비트만 있고 working 이 0",
    horizonDefinitions: "exact = D+N 당일, window = 1~N일 중 하루라도",
    notes: [
      "이 축에는 is_admin 이 없다 — 익명축이라 운영자 자기제외가 불가능하다",
    ],
  };
}

test("★설치축 요약은 좀비와 '한 번도 안 켬' 을 합쳐 그리지 않는다", () => {
  const html = renderToStaticMarkup(
    <P.InstallRetentionSummaryView data={installSummaryFixture()} />
  );
  assert.match(html, /좀비 9/);
  assert.match(html, /한 번도 안 켬 28/);
  // 합계(37)도 함께 남아야 한다 — 두 수만 보이면 나머지가 어디 갔는지 모른다.
  assert.match(html, /37대/);
  assert.match(html, /원인이 달라/);
});

test("설치축 요약의 모든 칸은 분자/분모를 남기고 미도달은 0% 가 아니다", () => {
  const html = renderToStaticMarkup(
    <P.InstallRetentionSummaryView data={installSummaryFixture()} />
  );
  assert.match(html, /1\/6/);
  assert.match(html, /0\/4/); // 0 도 분모와 함께
  assert.match(html, /0\/0/);
  assert.match(html, /\(—\)/); // 분모 0 → 0.0% 가 아니라 —
  assert.match(html, /2대 제외/); // 관측창 미도달
  // 6대짜리 표본이면 경고가 함께 뜬다.
  assert.match(html, /6대/);
  assert.match(html, /퍼센트/);
  // ★익명축이라 운영자 제외가 불가능하다는 서버 note 를 화면이 그대로 싣는다.
  assert.match(html, /is_admin/);
});

test("코호트가 비면 0% 가 아니라 '표본이 없다' 고 말한다", () => {
  const data = installSummaryFixture();
  data.installsCohort = 0;
  const html = renderToStaticMarkup(
    <P.InstallRetentionSummaryView data={data} />
  );
  assert.match(html, /0% 가 아닙니다/);
  assert.doesNotMatch(html, /0\.0%/);
});

// ── 소스가 없는 것과 조회 경로가 없는 것을 가른다 ──────────────────────────

test("★이미 쌓이는 표에는 '적재 전' 이 아니라 '연결 전' 이라고 적는다", () => {
  const html = renderToStaticMarkup(
    <P.PendingIngestion
      missing="read-path"
      title="설치 단위 활동일"
      waitingOn="analytics_user_daily 를 읽는 어드민 콜러블"
      willShow={["설치 × 날짜 활동일"]}
    />
  );
  assert.match(html, /연결 전/);
  assert.doesNotMatch(html, /적재 전/);
  assert.match(html, /이미 쌓이고 있습니다/);
  // 어느 쪽이든 가짜 0 은 금지다.
  assert.doesNotMatch(html, />\s*0\s*</);
  assert.doesNotMatch(html, /0%/);
});

// ── 네 탭 각각을 SSR 로 세워 규약이 살아 있는지 본다 ────────────────────────
// 한 탭에서만 확인하면 나머지 셋에서 조용히 빠져도 아무도 모른다.

test("★리텐션 탭은 익명축에 운영자 토글이 닿지 않는다고 적는다", () => {
  const html = renderToStaticMarkup(<P.default initialTab="retention" />);
  assert.match(html, /id="analytics-panel-retention"/);
  // 토글은 화면에 떠 있다 — 그런데 이 축에는 닿지 않는다. 그 사실을 적는다.
  assert.match(html, /<input type="checkbox"/);
  assert.match(html, /운영자 포함/);
  assert.match(html, /토글이 동작하지 않습니다/);
  assert.match(html, /is_admin 이 없어/);
  // 사람 축 칸이 서 있고, 배선 전이라 '적재 전' 으로 접힌다.
  assert.match(html, /사람 축 커버리지/);
  assert.match(html, /적재 전/);
});

test("★활성화 탭은 설치 단위 활성 자리를 세운다 (콜러블 응답 대기)", () => {
  const html = renderToStaticMarkup(<P.default initialTab="activation" />);
  assert.match(html, /id="analytics-panel-activation"/);
  // SSR 에서는 useEffect 가 안 돌아 콜러블이 아직 loading 이다. 자리(섹션)가
  // 서 있는지만 본다 — '연결 전' 문구 자체는 컴포넌트 테스트가 고정한다.
  assert.match(html, /설치 단위 활성/);
  // ★가짜 0 금지는 로딩 중에도 같다.
  assert.doesNotMatch(html, /설치 단위 활성[\s\S]{0,400}0%/);
});

test("★콜러블 이름은 상수 한 곳에서만 나온다 (계약 이름 고정)", () => {
  // 백엔드가 다른 이름으로 내보내면 조용히 not-found 가 되고 화면은 영원히
  // '연결 전' 을 띄운다. 이름이 바뀌면 이 테스트가 먼저 빨개진다.
  assert.equal(P.CALLABLE_USER_DAILY, "getAdminUserDailySummary");
  assert.equal(P.CALLABLE_ACCOUNT_PROFILE, "getAdminAccountProfileSummary");
});

test("★수익 탭은 null 을 0 으로 그리지 않는다 (mrr_usd · ltv_usd 미기입)", () => {
  const html = renderToStaticMarkup(<P.default initialTab="revenue" />);
  assert.match(html, /id="analytics-panel-revenue"/);
  assert.match(html, /analytics_purchase/);
  assert.match(html, /적재 전/);
  assert.match(html, /null 은 0 이 아니라 미기입/);
});

test("★획득 탭은 기다리는 표 이름을 실제 이름으로 적는다", () => {
  const html = renderToStaticMarkup(<P.default initialTab="acquisition" />);
  assert.match(html, /ga4_first_touch_current/);
  assert.match(html, /analytics_identity/);
  assert.match(html, /적재 전/);
});

test("initialTab 은 선택된 탭만 렌더한다는 기존 규약을 깨지 않는다", () => {
  const html = renderToStaticMarkup(<P.default initialTab="revenue" />);
  assert.doesNotMatch(html, /id="analytics-panel-acquisition"/);
  assert.doesNotMatch(html, /id="analytics-panel-activation"/);
  assert.doesNotMatch(html, /id="analytics-panel-retention"/);
  assert.equal((html.match(/role="tab"/g) ?? []).length, 4);
  assert.match(
    html,
    /aria-selected="true"[^>]*aria-controls="analytics-panel-revenue"/
  );
});

test("★사람 축 숫자는 라벨 없이 그릴 방법이 없다 (시그니처가 규약을 지킨다)", () => {
  const html = renderToStaticMarkup(
    <P.PersonAxisNumber
      numerator={3}
      denominator={6}
      coverage={coverageFixture({ basis: "all_time" })}
      label="링크된 설치 중 D7 잔존"
    />
  );
  assert.match(html, /3\/6/);
  assert.match(html, /설치 전체 이력 기준\(소급\)/);
  // §10.4-2 — 분모 라벨이 함께 나온다. "전체 설치" 로 읽히면 안 된다.
  assert.match(html, /링크된 설치 중 D7 잔존/);
  // §10.4-1 — ingesting 이면 퍼센트가 헤드라인이 아니다(작은 글씨 유지).
  assert.doesNotMatch(html, /text-lg/);
  const done = renderToStaticMarkup(
    <P.PersonAxisNumber
      numerator={3}
      denominator={6}
      coverage={coverageFixture({ state: "complete" })}
      label="링크된 설치 중 D7 잔존"
    />
  );
  // complete 에서만 분수가 커진다 — 그래도 커지는 건 퍼센트가 아니라 분수다.
  assert.match(done, /text-lg/);
  assert.ok(done.indexOf("3/6") < done.indexOf("50.0%"));
});

// ── 콜러블이 오면 붙는 모양 (② analytics_user_daily / ④ account_profile) ────

test("★설치 × 날짜 뷰는 좀비를 활동에 섞지 않고 익명축 한계를 적는다", () => {
  const html = renderToStaticMarkup(
    <P.UserDailySummaryView
      data={{
        rangeDays: 30,
        generatedAt: "2026-08-21T00:00:00.000Z",
        installsObserved: 12,
        installsActive: 5,
        installsPresentOnly: 4,
        byDay: [
          {
            day: "2026-08-20",
            activeInstalls: 3,
            presentOnlyInstalls: 2,
            eventCount: 40,
            tokensTotal: 900,
          },
        ],
        notes: ["익명축 note"],
      }}
    />
  );
  assert.match(html, /5\/12/); // 활동 설치는 분자/분모와 함께
  assert.match(html, /좀비/);
  assert.match(html, /하트비트만/);
  // ★익명축이라 운영자 토글이 닿지 않는다 — 뷰가 스스로 적는다.
  assert.match(html, /토글이 동작하지 않습니다/);
  assert.match(html, /익명축 note/);
  // 5대짜리 표본이면 경고가 함께 뜬다.
  assert.match(html, /퍼센트/);
});

test("★계정 프로필 뷰는 null 을 0 으로 접지 않는다", () => {
  const html = renderToStaticMarkup(
    <P.AccountProfileSummaryView
      data={{
        generatedAt: "2026-08-21T00:00:00.000Z",
        accountsObserved: 5,
        accountsWithSpend: 2,
        accountsWithMrr: 0,
        mrrUsdTotal: null,
        ltvUsdTotal: null,
        costUsdTotal: 12.5,
        notes: [],
      }}
    />
  );
  assert.match(html, /2\/5/);
  // ★mrr 기입 계정 0 도 분모와 함께 — "아무도 안 냈다" 가 아니다.
  assert.match(html, /0\/5/);
  assert.match(html, /미기입/);
  assert.match(html, /—/);
  // 금액 칸에 0 을 그리지 않는다.
  assert.doesNotMatch(html, /\$0\.00/);
  // 지출은 실제 값이 있으므로 그대로 나온다.
  assert.match(html, /12\.5/);
});

// ── ★실매출 갈라내기 (ticket cDvehpHhz1sn0ZHNpNq5) ──────────────────────────
//
// 이 화면의 실패 모드는 "숫자가 작다" 가 아니라 **"숫자가 틀렸다"** 다.
// 운영자 본인의 테스트 결제 1건을 매출로 그리면 첫 화면부터 거짓이 된다.

const PURCHASE_BASIS =
  "전 기간 · analytics_purchase · account_class='external' · " +
  "amount_known=true · kind ∈ {paid, renew}";

function purchaseSummary(
  over: Partial<Parameters<typeof P.PurchaseSplitView>[0]["data"]> = {}
): Parameters<typeof P.PurchaseSplitView>[0]["data"] {
  return {
    generatedAt: "2026-08-21T00:00:00.000Z",
    state: "ingested",
    reason: null,
    revenue: {
      externalKrw: 0,
      externalRows: 0,
      internalRows: 1,
      grantRows: 33,
      unclassifiedRows: 0,
      amountUnknownRows: 34,
      totalRows: 35,
    },
    basis: PURCHASE_BASIS,
    notes: [],
    ...over,
  };
}

test("★실매출 0 은 '적재 전' 이 아니라 0 으로 그린다 — 둘은 완전히 다른 뜻이다", () => {
  const html = renderToStaticMarkup(
    <P.PurchaseSplitView data={purchaseSummary()} />
  );
  assert.match(html, /₩0/, "표가 있는데 0 을 안 그리면 측정값을 숨기는 것이다");
  // ★'적재 전' **배지**(PendingIngestion 의 단독 span)가 뜨면 안 된다. 본문에서
  //   "적재 전이 아니라" 라고 부정하는 문장은 그 반대이므로 배지 형태로만 잰다.
  assert.doesNotMatch(
    html,
    />적재 전</,
    "0 옆에 '적재 전' 배지를 붙이면 거짓말이다"
  );
  assert.match(html, /적재 전이 아니라 측정된 0/);
});

test("★표가 없으면 0 을 그리지 않고 '적재 전' 으로 둔다", () => {
  const html = renderToStaticMarkup(
    <P.PurchaseSplitView
      data={purchaseSummary({
        state: "not_ingested",
        reason: "analytics_purchase 테이블이 없다",
        revenue: null,
      })}
    />
  );
  assert.match(html, />적재 전</);
  assert.doesNotMatch(html, /₩0/, "소스가 없는데 0 을 그리면 두 겹으로 틀린다");
});

test("★뺀 내부 결제 건수가 화면에 그대로 보인다 — 지운 게 아니라 가른 것", () => {
  const html = renderToStaticMarkup(
    <P.PurchaseSplitView data={purchaseSummary()} />
  );
  assert.match(html, /내부·운영자 결제/);
  assert.match(html, /매출에서 뺌/);
  // 건수가 안 보이면 다음 사람이 "왜 결제가 하나도 안 잡히지" 로 또 판다.
  assert.match(html, />1</);
});

test("★founder_grant 건수는 0 으로 뭉개지지 않는다", () => {
  const html = renderToStaticMarkup(
    <P.PurchaseSplitView data={purchaseSummary()} />
  );
  assert.match(html, /무상 부여/);
  assert.match(html, />33</);
});

test("★기준 라벨 없는 숫자를 그리지 않는다", () => {
  const html = renderToStaticMarkup(
    <P.PurchaseSplitView data={purchaseSummary()} />
  );
  assert.match(html, /기준/);
  assert.match(html, /account_class/);
  assert.match(html, /amount_known/);
});

test("★금액 미상은 0 이 아니라고 화면이 직접 말한다", () => {
  const html = renderToStaticMarkup(
    <P.PurchaseSplitView data={purchaseSummary()} />
  );
  assert.match(html, /금액 미상/);
  assert.match(html, /미상은 0 이 아니라서/);
});

test("★계정 성격 미분류는 매출로 승격되지 않고 따로 세어진다", () => {
  const html = renderToStaticMarkup(
    <P.PurchaseSplitView
      data={purchaseSummary({
        revenue: {
          externalKrw: 0,
          externalRows: 0,
          internalRows: 0,
          grantRows: 0,
          unclassifiedRows: 7,
          amountUnknownRows: 0,
          totalRows: 7,
        },
      })}
    />
  );
  assert.match(html, /계정 성격 미분류/);
  assert.match(html, /매출로 올리지 않음/);
  assert.match(html, /₩0/);
});

test("콜러블 이름 계약이 백엔드와 같다", () => {
  assert.equal(P.CALLABLE_PURCHASE_SUMMARY, "getAdminPurchaseSummary");
});


// ── ★퍼널 계측 커버리지 (ticket 4KqBDPkH) ──────────────────────────────────
// 회귀 대상: 사장님 화면이 "첫 대화 0명 / 첫 티켓 0명 / 에이전트 스폰 2명" 을
// 한 화면에서 동시에 보여줬다. BQ 실측상 첫대화 이벤트는 30일 창 안에 4설치가
// 냈고, 0 은 순차 정의(로그인 성공 +24h 창) 밖이라 버려진 결과였다. 값을 고치는
// 대신 **그 0 이 무슨 0 인지**를 화면이 말해야 한다.

function funnelStep(
  over: Partial<OnboardingFunnelStep> &
    Pick<OnboardingFunnelStep, "key" | "event" | "label">
): OnboardingFunnelStep {
  return {
    kind: "reach",
    gating: true,
    clients: 0,
    events: 0,
    dropFromPrev: null,
    dropRateFromPrev: null,
    isMaxDrop: false,
    ...over,
  };
}

function funnelFixture(
  steps: OnboardingFunnelStep[],
  over: Partial<OnboardingFunnel> = {}
): OnboardingFunnel {
  return {
    rangeDays: 30,
    generatedAt: "2026-08-22T00:00:00.000Z",
    steps,
    failureBranches: [],
    note: "테스트 픽스처",
    ...over,
  };
}

test("★계측이 전기간 0건인 칸은 '0명' 이 아니라 '미수집' 으로 그린다", () => {
  const html = renderToStaticMarkup(
    <P.OnboardingFunnelView
      funnel={funnelFixture([
        funnelStep({
          key: "install",
          event: "app:installed",
          label: "설치(최초 실행 대체 신호)",
          clients: 0,
          coverage: "missing",
          firstObservedDay: null,
          everInWindow: null,
        }),
        funnelStep({
          key: "agent_spawned",
          event: "agent:spawned",
          label: "에이전트 스폰",
          clients: 2,
          events: 2452,
          coverage: "ok",
        }),
      ])}
    />
  );
  assert.match(html, /미수집/);
  // 이벤트 이름을 적어 다음 사람이 "무엇이 없는지" 를 알게 한다.
  assert.match(html, /app:installed/);
  // ★계측 공백 칸에 "0명" 막대를 그리면 안 된다 — 그게 오독의 출발점이다.
  assert.doesNotMatch(html, /설치\(최초 실행 대체 신호\)[\s\S]{0,300}0명/);
});

test("★순차 0 인데 창 안 실측이 있으면 두 수를 나란히 보여 준다", () => {
  const html = renderToStaticMarkup(
    <P.OnboardingFunnelView
      funnel={funnelFixture([
        funnelStep({
          key: "orchestrator_opened",
          event: "onboarding:orchestrator_opened",
          label: "오케 오픈(첫 스폰 시도)",
          clients: 2,
          coverage: "ok",
        }),
        funnelStep({
          key: "first_conversation",
          event: "onboarding:first_conversation",
          label: "첫 대화(오케에 첫 지시 전송)",
          gating: false,
          clients: 0,
          coverage: "partial",
          firstObservedDay: "2026-08-10",
          everInWindow: 4,
        }),
        funnelStep({
          key: "agent_spawned",
          event: "agent:spawned",
          label: "에이전트 스폰",
          clients: 2,
          coverage: "ok",
        }),
      ])}
    />
  );
  // 배지가 '참고' 가 아니라 왜 못 믿는지를 말한다.
  assert.match(html, /부분 구간/);
  // 실측값과 계측 시작일이 화면에 남는다.
  assert.match(html, /4개/);
  assert.match(html, /2026-08-10/);
  // ★값 자체는 고치지 않는다(소급 보정 금지) — 0 도 그대로 남아 있다.
  assert.match(html, /0명/);
});

test("★활성화율 0% 옆에는 '같은 기간 실제 완료 설치 수' 가 붙는다", () => {
  const html = renderToStaticMarkup(
    <P.OnboardingFunnelView
      funnel={funnelFixture(
        [
          funnelStep({
            key: "agent_spawned",
            event: "agent:spawned",
            label: "에이전트 스폰",
            clients: 2,
            coverage: "ok",
          }),
        ],
        {
          headline: {
            activatedClients: 0,
            baseClients: 5,
            rate: 0,
            windowMinutes: 1440,
            label: "가입 후 24시간 내 …",
            everActivatedInWindow: 2,
          },
        }
      )}
    />
  );
  assert.match(html, /0\.0%/);
  assert.match(html, /2개 설치/);
  // 0% 를 "아무도 못 썼다" 로 읽지 말라는 문장이 실제로 있어야 한다.
  assert.match(html, /끝까지 못 썼다/);
});

test("★활성화율 0% 라도 창 안 실측이 0 이면 군더더기를 붙이지 않는다", () => {
  const html = renderToStaticMarkup(
    <P.OnboardingFunnelView
      funnel={funnelFixture(
        [
          funnelStep({
            key: "agent_spawned",
            event: "agent:spawned",
            label: "에이전트 스폰",
            clients: 2,
            coverage: "ok",
          }),
        ],
        {
          headline: {
            activatedClients: 0,
            baseClients: 5,
            rate: 0,
            windowMinutes: 1440,
            label: "가입 후 24시간 내 …",
            everActivatedInWindow: 0,
          },
        }
      )}
    />
  );
  assert.doesNotMatch(html, /끝까지 못 썼다/);
});

// ── ★운영자 제외 표기 ──────────────────────────────────────────────────────

test("★제외절이 걸릴 행이 0 이면 '제외됨' 이라고 말하지 않는다", () => {
  const html = renderToStaticMarkup(
    <P.FunnelAdminExclusionNote
      adminExcluded={{
        applied: true,
        uidFiltered: true,
        clientIdCount: 0,
        matchableRows: 0,
      }}
    />
  );
  assert.match(html, /운영자 제외가 실제로는 적용되지 않았습니다/);
  assert.match(html, /포함돼/);
});

test("★measurable 을 모르면(구버전 응답) 아무 단정도 하지 않는다", () => {
  assert.equal(
    renderToStaticMarkup(
      <P.FunnelAdminExclusionNote
        adminExcluded={{ uidFiltered: true, clientIdCount: 0 }}
      />
    ),
    ""
  );
  assert.equal(renderToStaticMarkup(<P.FunnelAdminExclusionNote />), "");
});

test("★걸릴 행이 남아 있어도 '최근 구간은 안 빠진다' 를 함께 말한다", () => {
  const html = renderToStaticMarkup(
    <P.FunnelAdminExclusionNote
      adminExcluded={{
        applied: true,
        uidFiltered: true,
        clientIdCount: 0,
        matchableRows: 51031,
      }}
    />
  );
  assert.match(html, /51,031<\/span>행/);
  assert.match(html, /제외되지 않습니다/);
});

test("★미배포 판정은 에러 코드가 아니라 서버 매니페스트로 한다", () => {
  // 미배포 콜러블의 404 는 CORS 에 막혀 브라우저에서 functions/internal 로
  // 도착한다 — 그래서 not-found 가드만 믿으면 영원히 빨간 오류가 뜬다.
  assert.equal(P.CALLABLE_MANIFEST, "getAdminCallableManifest");
});
