/**
 * ★상태별 렌더링을 **목 데이터로** 못박는다.
 *
 * 왜 목이어야 하나 — 프로덕션에서는 이 상태들을 동시에 만들 수 없다. '적재 전'
 * 하나를 재현하려고 파생표를 지울 수는 없고, '비교 불가' 를 보려고 분모를
 * 망가뜨릴 수도 없다. 그래서 목 데이터가 **유일하게 정확한 검증 수단**이다.
 * 그리고 사람이 한 번 눈으로 보는 것보다 낫다 — 다음에 누가 고쳐도 안 깨진다.
 *
 * 이 파일이 못박는 상태 다섯 개(어드민 화면에서 실제로 나온 것들):
 *
 *   | 상태      | 뜻                          | 화면이 해야 할 일          |
 *   |-----------|-----------------------------|----------------------------|
 *   | 0         | 실측 0 — 정말 0이다          | 숫자 0 + 분모/기준          |
 *   | 미수집    | 수집 자체가 없다             | ★숫자를 안 그린다 + 사유    |
 *   | 적재 전   | 파생표·뷰가 아직 없다        | ★에러가 아니다 + 사유       |
 *   | 매핑 불가 | 측정은 됐는데 사람에 못 붙음 | ★'사람 없음' 과 다르게       |
 *   | 비교 불가 | 분자·분모 모집단이 다르다    | ★퍼센트를 안 낸다           |
 *
 * ★'미배선'(봉투에 축이 없다)은 **여섯 번째 상태가 아니다.** 아래 "규약 충돌"
 *   항목 참조 — 화면 상태로 세지 않고 '적재 전' 으로 접는다.
 *
 * 단언 셋이 핵심이다:
 *   1. 다섯이 **서로 다르게** 그려진다. 둘이 같으면 실패.
 *   2. 비수치 상태에서 **금액·숫자가 화면에 안 나온다.** 흐린 0도 안 된다 —
 *      흐려도 0 으로 읽힌다.
 *   3. **분자 > 분모면 렌더가 아니라 테스트가 먼저 깨진다.** `9/7 = 128.6%` 가
 *      화면까지 온 게 이번 실패다.
 *
 * ★이 파일은 처음에 **테스트만** 넣고 todo 7건을 남겼다(패널을 두 티켓이 동시에
 *   만지고 있었다). 그 7건을 티켓 NTQYPWMFCbvJgVLLcBfI 가 구현으로 받아 GREEN 으로
 *   만들었다 — **기대값은 하나도 낮추지 않았다.** 바뀐 것은 아래 두 곳뿐이고,
 *   둘 다 '통과시키려고 무르게 한 것' 이 아니라 **스펙 정정**이다:
 *     ① 미배선을 상태에서 뺐다(여섯 → 다섯). 아래 "규약 충돌" 항목이 그때
 *        열어 둔 판단을 오케스트레이터가 §10.4-6 유지로 닫았다.
 *     ② 128.6% 를 낸 카드 이름을 실측으로 바로잡았다(주 2회+ 사용 → 모델 연결
 *        도달 (앞단)). 근거는 그 테스트의 주석에 있다.
 *
 * ★목 데이터에 진짜 uid·이메일은 없다. 전부 더미값이다.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ★규약 충돌 — 해소됨 (미배선은 상태가 아니다)
 *
 * 패널 주석 §10.4-6 은 "커버리지 0/미배선에 **새 상태를 만들지 않는다** — 기존
 * '적재 전' 규약으로 접는다" 고 못박고 있었고, 이 파일의 첫 판(6상태)은 그와
 * 정반대로 '미배선' 을 독립 상태로 요구했다.
 *
 * ★가른 기준은 "원인이 다른가" 가 아니라 **"보는 사람이 할 일이 다른가"** 다.
 *   · 미배선  → 응답에 축이 안 실렸다. 할 일: **기다린다.**
 *   · 적재 전 → 파생표가 없다.        할 일: **기다린다.**  → 같다. 접는다.
 *   · 매핑 불가 → 소스는 있고 사람 링크만 없다. forward-only 라 각 설치가 다음
 *     인증 때 붙고 **잠자는 설치는 영원히 안 붙는다. 소급 백필로 앞당길 수 없다.**
 *     할 일이 다르다("기다리면 된다" 가 거짓이다). → 가른다.
 *
 * 그래서 상태는 **다섯**이다. 미배선은 '적재 전' 으로 접힌 채 두고, 기존
 * AnalyticsPanel.test.tsx 의 "커버리지 자체가 안 실려 오면(배선 전) 가짜 0 대신
 * '적재 전' 이다" 는 그대로 GREEN 이다. 대신 같은 파일의 "커버리지 0 이면 …
 * '적재 전' 규약을 쓴다 (§10.4-6)" 한 줄은 매핑 불가 자리라 함께 고쳤다 —
 * 한쪽만 고치면 두 테스트가 서로를 부순다던 그 한 줄이다.
 * ──────────────────────────────────────────────────────────────────────────
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  PersonAxisCoverage,
  RetentionCohorts,
  InstallRetentionSummary,
} from "./AnalyticsPanel";

type PanelModule = typeof import("./AnalyticsPanel");
let P: PanelModule;

before(async () => {
  // 패널은 모듈 로드 시 firebase 앱을 초기화한다(auth 가 apiKey 를 요구한다).
  // 그래서 정적 import 가 아니라 env 를 세운 뒤 동적 import 한다 — 대역을
  // 흉내내지 않고 **화면이 실제로 쓰는 컴포넌트**를 렌더하기 위해서다.
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY ??= "test-api-key";
  P = await import("./AnalyticsPanel");
});

// ── 화면에서 숫자를 찾아내는 자(尺) ────────────────────────────────────────
// "숫자가 안 나온다" 를 눈으로 확인하면 다음 사람이 흐린 0 을 다시 넣는다.
// 그래서 규약을 정규식으로 못박는다.

/** 한 엘리먼트의 **전체 텍스트가 0** 인 자리. 흐리게(opacity/dim) 칠해도 잡힌다 — 흐린 0 도 0 으로 읽힌다. */
const BARE_ZERO = />\s*[-−]?0(?:\.0+)?\s*</;
/** 화면에 찍힌 퍼센트 전부. */
const ANY_PERCENT = /(\d+(?:\.\d+)?)%/g;
/** 금액. 통화 기호 뒤에 숫자가 붙은 자리. */
const MONEY = /[₩$]\s*[\d,]/;
/** 이 패널은 모든 지표를 tabular-nums 로 그린다 — 비수치 상태엔 그 자리 자체가 없어야 한다. */
const METRIC_SLOT = /tabular-nums/;

/**
 * 화면에 **보이는 글자만** 남긴다 — 태그와 속성(title 툴팁 등)을 걷어낸다.
 *
 * 툴팁에 "0% 가 아니라 판단 불가입니다" 라고 **설명**하는 것과, 칸에 0% 를
 * **그리는** 것은 정반대다. 속성까지 같이 재면 정직한 설명이 결함으로 잡힌다.
 */
function textOf(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

/** 100% 를 넘는 퍼센트를 전부 걷어낸다. 하나라도 있으면 분자>분모가 화면까지 온 것이다. */
function impossiblePercents(html: string): string[] {
  return (html.match(ANY_PERCENT) ?? []).filter((s) => parseFloat(s) > 100);
}

/** 비수치 상태 한 칸이 지켜야 할 것 전부. 한 자리에 모아 여러 곳에서 같게 잰다. */
function assertDrawsNoNumber(label: string, html: string) {
  assert.doesNotMatch(html, BARE_ZERO, `${label}: 흐린 0 도 0 으로 읽힌다`);
  assert.doesNotMatch(html, MONEY, `${label}: 금액을 그리면 안 된다`);
  assert.doesNotMatch(
    html,
    /\d+(?:\.\d+)?%/,
    `${label}: 퍼센트를 그리면 안 된다`
  );
  assert.doesNotMatch(
    html,
    METRIC_SLOT,
    `${label}: 지표 자리(tabular-nums)를 세우면 안 된다 — 세우면 무언가 채워질 칸으로 읽힌다`
  );
}

// ── 목 데이터 — 상태 다섯 개를 만드는 봉투들 ───────────────────────────────
// ★전부 목이다. 프로덕션 값도, 진짜 uid·이메일도 없다.

function coverage(over: Partial<PersonAxisCoverage> = {}): PersonAxisCoverage {
  return {
    state: "pending",
    metric: "identity_linked_ratio",
    disabledReason: null,
    linkedInstalls: 0,
    totalInstalls: 40,
    identityLinkedInstalls: 0,
    identityTotalInstalls: 40,
    dailyActiveInstalls: 12,
    dailyLinkedActiveInstalls: 0,
    dailyJoinable: false,
    dailyJoinNote:
      "analytics_user_daily.install_key 는 원시 설치 ID 이고 analytics_identity/link install_key 는 HMAC 이라 아직 직접 조인할 수 없습니다.",
    linkedActiveInstalls: 0,
    activeInstalls: 12,
    excludedSharedInstalls: 0,
    effectiveFrom: "2026-04-01",
    basis: "since_link",
    lastLinkedAt: null,
    ...over,
  };
}

type PurchaseData = Parameters<typeof P.PurchaseSplitView>[0]["data"];

function purchaseIngestedZero(): PurchaseData {
  // 표는 있고 값이 0 이다. **이건 데이터다** — 0 을 그려야 한다.
  return {
    generatedAt: "2026-08-21T00:00:00.000Z",
    state: "ingested",
    reason: null,
    revenue: {
      externalKrw: 0,
      externalRows: 0,
      internalRows: 1,
      grantRows: 3,
      unclassifiedRows: 0,
      amountUnknownRows: 4,
      totalRows: 4,
    },
    basis:
      "전 기간 · analytics_purchase · account_class=external · amount_known=true",
    notes: [],
  };
}

/**
 * 다섯 상태 × (그 상태를 만드는 목 봉투 → 렌더) × (그 상태의 표식).
 *
 * ★표식 문구는 내가 지어낸 말이 아니라 **티켓 표에 적힌 상태명 그대로**다.
 *   '적재 전' 은 이미 화면이 그 말을 쓰고 있고, 나머지도 같은 사전을 쓴다.
 */
type StateCase = {
  key: string;
  /** 이 상태를 만드는 목 데이터로 화면 한 칸을 그린다. */
  render: () => string;
  /** 화면이 "이 칸은 이 상태다" 라고 알리는 표식. */
  marker: RegExp;
  /** 숫자를 그려도 되는 상태인가. 실측 0 만 그래도 된다. */
  numeric: boolean;
};

function stateCases(): StateCase[] {
  return [
    {
      key: "0 (실측 0)",
      // 표가 있고 값이 0 — 숨기면 측정값을 숨기는 것이다. 0 을 기준과 함께 그린다.
      render: () =>
        renderToStaticMarkup(<P.PurchaseSplitView data={purchaseIngestedZero()} />),
      marker: /₩0/,
      numeric: true,
    },
    {
      key: "미수집",
      // 수집 자체가 없던 구간. 숫자를 그리지 않고 **왜 없는지**만 말한다.
      render: () =>
        renderToStaticMarkup(
          <P.AxisLimitNote notes={[P.EVENTS_ACCOUNT_AXIS_LIMIT]} />
        ),
      marker: /측정되지 않았다/,
      numeric: false,
    },
    {
      key: "적재 전",
      // 파생표·뷰가 아직 없다. ★에러가 아니다.
      render: () =>
        renderToStaticMarkup(
          <P.PendingIngestion
            title="MRR · LTV"
            waitingOn="analytics_purchase 적재"
            willShow={["MRR", "코호트 LTV"]}
          />
        ),
      marker: />적재 전</,
      numeric: false,
    },
    {
      key: "매핑 불가",
      // 측정은 됐다(활동 설치 12대). 다만 forward-only 라 사람에 아직 못 붙었다.
      // ★'사람이 없다' 와 완전히 다른 말이다.
      render: () =>
        renderToStaticMarkup(
          <P.PersonAxisCoverageNote coverage={coverage({ state: "pending" })} />
        ),
      marker: />매핑 불가</,
      numeric: false,
    },
    {
      key: "비교 불가",
      // ★128.6% 를 낸 카드는 '모델 연결 도달 (앞단)' 이다(근거는 아래 RatioCard
      //   테스트 주석). 분자 9 는 하위호환 신호까지 합집합이라 조회 구간 밖에서
      //   이미 연결을 끝낸 설치를 포함하고, 분모 7 은 이 구간에 app:first_run 을
      //   찍은 설치만 센다 — 모집단도 관측창도 다르다. 나누면 안 되는 두 수다.
      render: () =>
        renderToStaticMarkup(
          <P.RatioCard
            label="모델 연결 도달 (앞단)"
            numerator={9}
            denominator={7}
            sub="최초 실행 기준 — 분자와 분모의 관측창이 다르다"
          />
        ),
      marker: /비교 불가/,
      numeric: false,
    },
  ];
}

// ── ★단언 1 — 여섯이 서로 다르게 그려진다 ──────────────────────────────────

test("★이미 갈라져 있는 세 상태는 서로의 표식을 쓰지 않는다 (회귀 방지)", () => {
  // 실측 0 · 미수집 · 적재 전 — 오늘 화면이 **이미 정직하게** 가르고 있는 셋.
  // 여기가 빨개지면 그건 새 결함이지 미완성이 아니다.
  const cases = stateCases().filter((c) =>
    ["0 (실측 0)", "미수집", "적재 전"].includes(c.key)
  );
  const html = new Map(cases.map((c) => [c.key, c.render()]));
  for (const c of cases) {
    assert.match(
      html.get(c.key)!,
      c.marker,
      `${c.key} 가 자기 표식을 안 그린다`
    );
    for (const other of cases) {
      if (other.key === c.key) continue;
      assert.doesNotMatch(
        html.get(c.key)!,
        other.marker,
        `${c.key} 가 ${other.key} 의 표식을 쓰고 있다 — 두 상태가 화면에서 같아진다`
      );
    }
  }
});

test("★다섯 상태가 각자 자기 이름을 그린다 (둘이 같으면 실패)", () => {
  for (const c of stateCases()) {
    assert.match(c.render(), c.marker, `${c.key} 가 자기 표식을 안 그린다`);
  }
});

test("★다섯 상태가 서로의 표식을 훔쳐 쓰지 않는다", () => {
  const cases = stateCases();
  const html = new Map(cases.map((c) => [c.key, c.render()]));
  for (const a of cases) {
    for (const b of cases) {
      if (a.key === b.key) continue;
      assert.doesNotMatch(
        html.get(a.key)!,
        b.marker,
        `${a.key} 가 ${b.key} 의 표식을 쓰고 있다 — 두 상태가 화면에서 같아진다`
      );
    }
  }
});

/**
 * ★미배선은 '적재 전' 으로 접히고, 매핑 불가는 갈라진다 — 그래서 **둘은 여전히
 * 서로 다른 그림**이다. 접었다고 같아지는 게 아니라, 접힌 쪽이 '적재 전' 이 되고
 * 갈라진 쪽이 '매핑 불가' 가 되면서 배지가 갈린다.
 *
 * 이 테스트가 지키는 진짜 한 줄: **매핑 불가 자리에 "소스가 없습니다" 라고 쓰지
 * 않는다.** 소스는 있다. 그 한 문장 때문에 다음 사람이 적재부터 다시 판다.
 */
test("★미배선과 매핑 불가는 같은 그림이 아니다 (할 일이 다르면 화면도 달라야 한다)", () => {
  const unwired = renderToStaticMarkup(
      <P.PersonAxisCoverageNote coverage={null} />
    );
    const unmapped = renderToStaticMarkup(
      <P.PersonAxisCoverageNote coverage={coverage({ state: "pending" })} />
    );
    // 매핑 불가는 소스가 **있다**. "소스가 없습니다" 는 그 자리에서 거짓말이다.
    assert.doesNotMatch(
      unmapped,
      /소스가 없습니다/,
      "매핑 불가 자리에 '소스가 없다' 고 쓰면 다음 사람이 적재부터 다시 판다"
    );
    // ★그리고 '사람이 없다'(실측 0) 와도 다른 말이어야 한다. 측정은 됐다.
    assert.match(unmapped, /아직 안 붙었다|매핑 불가/);
    assert.doesNotMatch(
      textOf(unmapped),
      /사람이 없다(?!.{0,20}가 아니라)/,
      "매핑 불가를 '사람 없음' 으로 읽히게 쓰면 모수가 0 인 것과 구별되지 않는다"
    );
    // 두 상태의 배지가 같으면 화면에서 가를 수 없다.
    const badge = (h: string) =>
      h.match(/<span[^>]*rounded-full[^>]*>([^<]*)<\/span>/)?.[1] ?? null;
    assert.notEqual(
      badge(unwired),
      badge(unmapped),
      `미배선/매핑 불가 배지가 둘 다 ${badge(unwired)} 다`
    );
  // ★접힌 쪽은 '적재 전' 그대로 — §10.4-6 을 깨지 않았다는 방어선.
  assert.equal(badge(unwired), "적재 전");
  assert.equal(badge(unmapped), "매핑 불가");
  // ★그리고 매핑 불가는 "기다리면 채워진다" 로 읽히면 안 된다. 그 말을 화면이
  //   직접 부정하는지 잰다 — 배지만 갈라 놓고 본문이 그대로면 반쪽이다.
  assert.match(unmapped, /기다린다고 채워지는 칸이 아닙니다/);
  assert.match(unmapped, /소급 백필/);
  assert.match(unmapped, /forward-only/);
});

// ── ★단언 2 — 비수치 상태에서 숫자·금액이 안 나온다 ────────────────────────

test("★미수집·적재 전은 숫자를 한 글자도 그리지 않는다 (흐린 0 포함)", () => {
  for (const c of stateCases()) {
    if (c.numeric) continue;
    if (c.key === "비교 불가") continue; // 비교 불가는 분수는 남기고 퍼센트만 막는다 — 아래 별도 단언.
    if (!["미수집", "적재 전"].includes(c.key)) continue;
    assertDrawsNoNumber(c.key, c.render());
  }
});

/**
 * ★미배선은 상태를 새로 만들지 않고 '적재 전' 으로 접는다(§10.4-6).
 *
 * 접었다고 규약이 느슨해지는 게 아니다 — 접힌 자리에서도 **가짜 0 은 그대로
 * 금지**다. 그래서 이 테스트는 "미배선이 자기 배지를 갖는가" 가 아니라 "접히면서
 * 0 을 흘리지 않았는가" 를 잰다. 상태를 다시 가르고 싶어지는 다음 사람은 이
 * 테스트가 아니라 파일 머리의 "규약 충돌 — 해소됨" 을 먼저 읽어야 한다.
 */
test("★미배선은 '적재 전' 으로 접히되 숫자를 그리지 않는다 (§10.4-6)", () => {
  const html = renderToStaticMarkup(
    <P.PersonAxisCoverageNote coverage={null} />
  );
  assertDrawsNoNumber("미배선", html);
  // 접힌 자리의 표식은 '적재 전' 이다 — 빈 칸을 두면 고장으로 읽힌다.
  assert.match(html, />적재 전</, "미배선: 숫자 대신 사유가 있어야 한다");
  // ★그리고 매핑 불가로 새지 않았는지. 둘을 한 번에 가른 변경이라 반대 방향
  //   회귀(미배선까지 같이 갈라 버리는 것)도 같이 막는다.
  assert.doesNotMatch(html, />매핑 불가</);
});

test("★매핑 불가는 금액·퍼센트를 내지 않는다 (사람에 못 붙은 측정값은 사람 축 비율이 아니다)", () => {
  const html = renderToStaticMarkup(
    <P.PersonAxisCoverageNote coverage={coverage({ state: "pending" })} />
  );
  assert.match(html, />매핑 불가</, "자기 이름을 그려야 한다");
  // 사람에 못 붙은 12대를 사람 축 분모로 쓰면 안 된다 → 퍼센트 금지.
  assert.doesNotMatch(textOf(html), /\d+(?:\.\d+)?%/, "사람 축 퍼센트를 내면 안 된다");
  assert.doesNotMatch(html, MONEY, "금액을 그리면 안 된다");
  assert.doesNotMatch(html, BARE_ZERO, "흐린 0 도 0 으로 읽힌다");
  // ★"측정은 됐다" 를 화면이 말하는가 — 이게 '미수집'/'적재 전' 과 갈리는 축이다.
  //   숫자를 아예 안 그리는 게 아니라 **사람 축 비율만** 안 낸다.
  assert.match(html, /측정은 됐습니다/);
  assert.match(html, /12대/, "센 것은 세었다고 말해야 한다");
});

test("★'적재 전' 은 에러가 아니다 — 고장 신호를 쓰지 않는다", () => {
  const html = renderToStaticMarkup(
    <P.PendingIngestion
      title="설치 단위 활성"
      waitingOn="analytics_install_profile 파생표"
      willShow={["설치 × 날짜 활동일"]}
    />
  );
  assert.match(html, />적재 전</);
  // 사장님이 빨간 박스를 고장으로 읽으셨다. 파생표가 없는 것은 고장이 아니다.
  assert.doesNotMatch(html, /text-red-|bg-red-|border-red-/);
  assert.doesNotMatch(html, /role="alert"/);
  assert.doesNotMatch(html, /오류|에러|실패했습니다/);
  // 대신 무엇을 기다리는지 말한다.
  assert.match(html, /기다리는 것/);
  assert.match(html, /analytics_install_profile 파생표/);
});

test("소스가 없는 것과 읽는 길이 없는 것도 서로 다르게 그린다", () => {
  const noSource = renderToStaticMarkup(
    <P.PendingIngestion title="T" waitingOn="W" willShow={["A"]} />
  );
  const noReadPath = renderToStaticMarkup(
    <P.PendingIngestion
      missing="read-path"
      title="T"
      waitingOn="W"
      willShow={["A"]}
    />
  );
  assert.match(noSource, />적재 전</);
  assert.match(noReadPath, />연결 전</);
  assert.doesNotMatch(noReadPath, />적재 전</);
  assert.notEqual(noSource, noReadPath, "제목이 같으면 상태도 같아 보인다");
  assertDrawsNoNumber("적재 전", noSource);
  assertDrawsNoNumber("연결 전", noReadPath);
});

test("게이트가 닫힌 것은 '적재 전' 과 다른 말을 쓴다", () => {
  const html = renderToStaticMarkup(
    <P.PersonAxisDisabled
      coverage={coverage({
        state: "disabled",
        disabledReason: "PERSON_AXIS_EFFECTIVE_FROM 미설정",
      })}
    />
  );
  assert.match(html, />아직 열지 않음</);
  assert.doesNotMatch(html, />적재 전</, "곧 채워진다는 거짓 기대가 생긴다");
  assertDrawsNoNumber("게이트 미개방", html);
});

// ── ★단언 3 — 분자 > 분모면 렌더가 아니라 테스트가 먼저 깨진다 ─────────────

test("★Ratio 는 분자 > 분모일 때 퍼센트를 내지 않는다 (9/7 = 128.6% 금지)", () => {
  const html = renderToStaticMarkup(<P.Ratio numerator={9} denominator={7} />);
  assert.deepEqual(
    impossiblePercents(html),
    [],
    "분자 > 분모인데 100% 넘는 퍼센트가 화면까지 왔다"
  );
  assert.match(html, /9\/7/, "분수는 남긴다 — 숨기면 측정값을 숨기는 것이다");
  assert.match(html, /비교 불가/, "왜 퍼센트가 없는지 화면이 말해야 한다");
});

/**
 * ★막는 자리가 **렌더 직전이 아니라 계산 지점**인지 잰다.
 *
 * 렌더에서 잘라내면 다음에 누가 새 카드를 만들 때 그 카드로 다시 샌다. 그래서
 * 나누기 자체를 소유하는 함수를 노출하고, 그 함수가 판정을 돌려주는지를 본다 —
 * 판정이 값(clamp 된 1.0)이 아니라 **종류**라는 게 요점이다.
 */
test("★분자 > 분모는 나누기 전에 갈린다 — 100% 로 눕히지 않는다", () => {
  assert.deepEqual(P.ratioVerdict(9, 7), { kind: "incomparable" });
  // ★clamp 금지. 128.6% 를 100% 로 만드는 것은 수치를 고치는 것이라 더 나쁘다.
  assert.notDeepEqual(P.ratioVerdict(9, 7), { kind: "ok", rate: 1 });
  // 경계(n === d)는 정상이다 — 과잉 방어가 정상 케이스를 먹으면 그것도 결함이다.
  assert.deepEqual(P.ratioVerdict(7, 7), { kind: "ok", rate: 1 });
  assert.deepEqual(P.ratioVerdict(1, 2), { kind: "ok", rate: 0.5 });
  // 분모 0 은 '비교 불가' 가 아니라 '판단할 표본이 없다' 다. 둘을 섞지 않는다.
  assert.deepEqual(P.ratioVerdict(0, 0), { kind: "no-denominator" });
  assert.deepEqual(P.ratioVerdict(3, 0), { kind: "no-denominator" });
  // 대체 표시는 빈칸이 아니다.
  assert.equal(P.fmtRatioVerdict(P.ratioVerdict(9, 7)), "비교 불가");
  assert.equal(P.fmtRatioVerdict(P.ratioVerdict(0, 0)), "—");
  assert.equal(P.fmtRatioVerdict(P.ratioVerdict(7, 7)), "100.0%");
});

/**
 * ★어느 카드가 128.6% 를 냈나 — **실측으로 바로잡았다.**
 *
 * 이 파일의 첫 판은 todo 사유에 "'주 2회+ 사용' 카드" 라고 적었다. 틀렸다.
 * 소스를 따라가면 그 카드는 **분자가 분모를 넘을 수 없다**:
 *   v3/functions/src/index.ts `weeklyTwicePlusQuery` 는 한 서브쿼리에서
 *   `COUNTIF(active_days >= 2)`(분자) 와 `COUNT(*)`(분모) 를 같이 세므로 분자 ≤ 분모가
 *   **구조적으로 보장**된다. 사장님 화면의 그 카드는 4/7 = 57.1% 였다.
 *
 * 128.6% 를 낼 수 있는 카드는 '모델 연결 도달 (앞단)'(`connectFunnel`) 뿐이다:
 *   · 분자 `d_model_connected` = 정본 앵커 + 하위호환 두 신호의 **합집합**이라
 *     조회 구간 밖에서 이미 연결을 끝낸 설치까지 센다(index.ts 주석이 그렇게 적는다).
 *   · 분모 `d_first_run_base` = 이 구간에 `app:first_run` 을 찍은 설치만 센다.
 *   서버도 이 역전을 알고 있다 — `buildZeroFrictionKpis` 가 앞단 이탈을
 *   `Math.max(0, firstRunBase - base)` 로 자르고, adminAnalytics.test.ts 의
 *   "연결 수가 최초 실행보다 크면 …" 테스트가 `modelConnectedClients: 9` 로 그
 *   경우를 고정해 두었다. **그런데 비율은 안 잘랐다.** 그 구멍이 이 결함이다.
 */
test("★RatioCard 도 분자 > 분모면 퍼센트를 내지 않는다 (모델 연결 도달 (앞단))", () => {
  const html = renderToStaticMarkup(
    <P.RatioCard
      label="모델 연결 도달 (앞단)"
      numerator={9}
      denominator={7}
      sub="최초 실행 기준 — 분자와 분모의 관측창이 다르다"
    />
  );
  assert.deepEqual(impossiblePercents(html), []);
  assert.match(html, /비교 불가/);
  // 분수는 남는다 — 지우면 측정값을 숨기는 것이다.
  assert.match(html, /9\/7/);
});

test("100% 이하에서는 지금대로 퍼센트를 낸다 (과잉 방어 금지)", () => {
  // 방어가 정상 케이스를 먹으면 그것도 결함이다. 경계(=100%)는 정상이다.
  const eq = renderToStaticMarkup(<P.Ratio numerator={7} denominator={7} />);
  assert.match(eq, /7\/7/);
  assert.match(eq, /100\.0%/);
  assert.deepEqual(impossiblePercents(eq), []);
  const half = renderToStaticMarkup(<P.Ratio numerator={1} denominator={2} />);
  assert.match(half, /1\/2/);
  assert.match(half, /50\.0%/);
});

test("★다섯 탭 어디에도 100% 를 넘는 퍼센트가 없다 (화면 전체 방어선)", () => {
  // 컴포넌트 단위 방어가 뚫려도 여기서 잡힌다. SSR 이라 콜러블 값은 없지만
  // 상수·기본값에서 만들어지는 퍼센트는 전부 지나간다.
  for (const tab of [
    "acquisition",
    "activation",
    "retention",
    "revenue",
    "operations",
  ] as const) {
    const html = renderToStaticMarkup(<P.default initialTab={tab} />);
    assert.deepEqual(
      impossiblePercents(html),
      [],
      `${tab} 탭에 100% 를 넘는 퍼센트가 있다`
    );
  }
});

// ── ★기준선 1 — 리텐션 코호트 (오늘 본 것 중 제일 정직한 패널) ─────────────
// 이 둘은 **먼저 통과해야 한다.** 나머지 패널이 못 미치는 걸 재는 자가 된다.

function cohorts(over: Partial<RetentionCohorts> = {}): RetentionCohorts {
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
          // ★D14·D30 은 관측창이 아직 안 왔다 → null. 0 이 아니다.
          rates: { d1: 0.5, d7: 0, d14: null, d30: null },
        },
      ],
      note: "운영자(is_admin) 제외 후 계정축 코호트 — 더미 목 데이터",
    },
    activationGate: { steps: [], maxDrop: null, note: "게이트 note" },
    ...over,
  };
}

test("기준선: 리텐션 코호트는 D30 관측창 미도달을 0% 가 아니라 — 로 그린다", () => {
  const html = renderToStaticMarkup(
    <P.RetentionCohortTableView data={cohorts()} />
  );
  // D1 = 1/2, D7 = 0/2 — ★실측 0 은 0 을 **그린다**. 분모와 함께라 읽을 수 있다.
  assert.match(html, /1\/2/);
  assert.match(html, /0\/2/);
  assert.match(html, /\(0\.0%\)/, "실측 0 은 0.0% 로 그려도 된다 — 분모가 옆에 있다");
  // ★D14·D30 은 관측창이 아직 안 왔다 → —. 여기에 0.0% 가 나오면 미관측이
  //   이탈로 읽힌다. 그래서 "0.0% 가 몇 번 나오나" 가 아니라 **미도달 칸에**
  //   퍼센트가 없는지를 잰다 — 실측 0 의 0.0% 를 같이 잡으면 자가 무뎌진다.
  const pendingCells = html.match(
    /<td[^>]*>\s*<span title="[^"]*판단 불가[^"]*">[^<]*<\/span>\s*<\/td>/g
  );
  assert.equal(
    pendingCells?.length,
    2,
    "D14·D30 두 칸이 관측창 미도달(—)로 그려져야 한다"
  );
  for (const cell of pendingCells ?? []) {
    // 보이는 글자는 — 하나뿐이어야 한다. 툴팁의 설명은 세지 않는다.
    assert.equal(textOf(cell).trim(), "—");
  }
  // 관측창 규약을 표 머리에서 먼저 말한다.
  assert.match(html, /관측창 미도달/);
  // 운영자 제외를 표기한다.
  assert.match(html, /운영자/);
  assert.match(html, /is_admin/);
  // 2명짜리 표본이면 퍼센트를 믿지 말라고 화면이 직접 말한다.
  assert.match(html, /2명/);
  assert.match(html, /퍼센트/);
});

test("기준선: 분모 0 은 0.0% 가 아니라 — 다 (0/0 → —)", () => {
  const html = renderToStaticMarkup(<P.Ratio numerator={0} denominator={0} />);
  assert.match(html, /0\/0/);
  assert.match(html, /\(—\)/);
  assert.doesNotMatch(html, /0\.0%/);
});

function installSummary(): InstallRetentionSummary {
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
      { key: "d7", days: 7, pending: 0, exact: rate(1, 6), window: rate(2, 6) },
      // ★D30 = 0/0 이고 관측창 미도달 2대 — 이 둘을 한 줄에서 같이 말해야 한다.
      { key: "d30", days: 30, pending: 2, exact: rate(0, 0), window: rate(0, 0) },
    ],
    activityDefinition: "활동 정의: status=working 또는 이벤트 1건 이상",
    presentOnlyDefinition: "present_only: 하트비트만 있고 working 이 0",
    horizonDefinitions: "exact = D+N 당일, window = 1~N일 중 하루라도",
    notes: [
      "이 축에는 is_admin 이 없다 — 익명축이라 운영자 자기제외가 구조적으로 불가능하다",
    ],
  };
}

test("기준선: D30 = 0/0 은 — 이고, 관측창 미도달 2대는 따로 세어 보인다", () => {
  const html = renderToStaticMarkup(
    <P.InstallRetentionSummaryView data={installSummary()} />
  );
  assert.match(html, /0\/0/);
  assert.match(html, /\(—\)/, "0/0 을 0.0% 로 그리면 미관측이 이탈로 읽힌다");
  assert.doesNotMatch(html, /\(0\.0%\)/);
  // ★관측창 미도달을 지우지 않고 **센다**. 지우면 분모가 왜 작은지 모른다.
  assert.match(html, /관측창 미도달/);
  assert.match(html, /2대 제외/);
  // ★운영자 제외가 이 축에서는 불가능하다는 사실을 화면이 직접 적는다.
  assert.match(html, /is_admin/);
  assert.match(html, /운영자/);
});

test("기준선: 익명 설치축은 '운영자 포함' 토글이 안 먹는다고 화면이 말한다", () => {
  assert.match(P.ANON_AXIS_ADMIN_TOGGLE_INERT, /운영자 포함/);
  assert.match(P.ANON_AXIS_ADMIN_TOGGLE_INERT, /동작하지 않습니다/);
  assert.match(P.ANON_AXIS_ADMIN_TOGGLE_INERT, /is_admin/);
  // 낙관 편향 방향까지 적어야 읽는 사람이 보정한다.
  assert.match(P.ANON_AXIS_ADMIN_TOGGLE_INERT, /낙관/);
});

// ── ★기준선 2 — 구독 각주 (원장 공백의 0) ──────────────────────────────────

test("기준선: 수익 탭은 Paddle 원장 공백의 0 을 '연속 결제 없음' 으로 읽지 말라고 적는다", () => {
  const html = renderToStaticMarkup(<P.default initialTab="revenue" />);
  assert.match(html, /id="analytics-panel-revenue"/);
  assert.match(html, /Paddle/);
  assert.match(html, /원장 공백/);
  // ★그 칸의 0 은 '연속 결제가 없다' 가 아니라 '이 원장에 없다' 다.
  assert.match(html, /이 원장에 없다/);
  assert.match(html, /Toss billingCharges/);
  assert.match(html, /적재 전/);
  assert.match(html, /진짜 0/);
  assert.match(html, /미상/);
  assert.match(html, /install_key_hmac/);
  assert.doesNotMatch(html, /MRR · LTV · 코호트별 회수/);
});

test("기준선: 표가 없으면 ₩0 을 그리지 않고 '적재 전' 으로 둔다", () => {
  const html = renderToStaticMarkup(
    <P.PurchaseSplitView
      data={{
        ...purchaseIngestedZero(),
        state: "not_ingested",
        reason: "analytics_purchase 테이블이 없다",
        revenue: null,
      }}
    />
  );
  assert.match(html, />적재 전</);
  assert.doesNotMatch(html, /₩0/, "소스가 없는데 0 을 그리면 두 겹으로 틀린다");
});

test("기준선: 표가 있고 값이 0 이면 ₩0 을 그린다 — 이건 데이터다", () => {
  const html = renderToStaticMarkup(
    <P.PurchaseSplitView data={purchaseIngestedZero()} />
  );
  assert.match(html, /₩0/, "측정된 0 을 숨기면 측정값을 숨기는 것이다");
  assert.doesNotMatch(html, />적재 전</, "0 옆에 '적재 전' 배지를 붙이면 거짓말이다");
  // 0 옆에 기준이 남는다 — 무엇을 세었는지 없으면 0 도 못 읽는다.
  assert.match(html, /기준/);
  assert.match(html, /account_class/);
});
