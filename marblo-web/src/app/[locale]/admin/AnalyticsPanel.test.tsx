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
import type { RetentionCohorts } from "./AnalyticsPanel";

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
    <P.AxisLimitNote notes={[P.EVENTS_ACCOUNT_AXIS_LIMIT, null, undefined, ""]} />
  );
  assert.match(html, /2026-08-06~08-10/);
  assert.match(html, /측정되지 않았다/);
});

test("축 한계 고지는 실을 문장이 없으면 아무것도 안 그린다", () => {
  assert.equal(renderToStaticMarkup(<P.AxisLimitNote notes={[null, ""]} />), "");
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
  assert.match(html, /aria-selected="true"[^>]*aria-controls="analytics-panel-retention"/);
  assert.match(html, /남아서 계속 쓰나/);
});

// ── 리텐션/활성화 뷰 ────────────────────────────────────────────────────────

function cohortsFixture(over: Partial<RetentionCohorts> = {}): RetentionCohorts {
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
