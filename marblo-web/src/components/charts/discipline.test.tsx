/**
 * ★recharts 의 기본값이 우리 규율과 반대다. 이 파일이 그 걱정을 **닫는다.**
 *
 * #1206 이 차트 라이브러리 도입을 반대하며 든 근거가 정확히 이것이었다:
 *   "라이브러리는 결측을 선으로 잇고, 값이 없으면 0 으로 떨어뜨린다."
 * 사장님이 도입을 정하셨으므로, 그 걱정을 말로 반박하는 게 아니라 **코드로
 * 닫고 테스트로 고정**하는 것이 이 티켓의 일이다.
 *
 * 여기서 못박는 것:
 *   1. 값이 없는 날을 **선으로 잇지 않는다** (`connectNulls={false}`)
 *   2. 값이 없는 날을 **0 으로 안 떨어뜨린다** (row 에 `null`, 표에 '—')
 *   3. 적재 전·미수집·표본 부족이 **0 으로 안 보인다**
 *   4. Y축이 **자동 스케일이 아니다** — 도메인을 숫자로 확정해서 넘긴다
 *   5. 안 보이는 계열은 **축을 밀어 올리지 않는다**
 *   6. 스코프 키가 없는 계열은 **클릭이 아예 안 붙는다**
 *
 * ★왜 마운트해서 보나: recharts 는 서버에서 아무것도 안 그린다. 위 여섯 개는
 *   전부 **그려진 DOM** 에서만 검사할 수 있다. jsdom 은 브라우저 GUI 가 아니라
 *   DOM 구현체다 — Playwright·Electron 은 안 띄운다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import "./testEnv";
import { renderToStaticMarkup } from "react-dom/server";
import { ChartFrame } from "./ChartFrame";
import {
  isDrillAllowed,
  resolveYDomain,
  visibleMax,
  yDomainCoversData,
  type DrillTarget,
  type NamedSeries,
} from "./types";
import { toRows } from "./primitives";

/* ── 마운트 도구 ───────────────────────────────────────────────────────── */

async function mount(node: React.ReactNode) {
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(node);
  });
  return {
    host,
    act,
    cleanup: () => {
      root.unmount();
      host.remove();
    },
  };
}

/** 선 path 의 `d` 를 꼭짓점 배열로 푼다. `M` 이 두 번 나오면 선이 끊긴 것이다. */
function subpaths(d: string): Array<Array<[number, number]>> {
  const out: Array<Array<[number, number]>> = [];
  for (const seg of d.split(/(?=M)/)) {
    const pts: Array<[number, number]> = [];
    for (const m of seg.matchAll(/[ML]\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/g)) {
      pts.push([Number(m[1]), Number(m[2])]);
    }
    if (pts.length) out.push(pts);
  }
  return out;
}

/** 계열 선(영역 채움이 아닌 쪽)의 path. recharts 는 `recharts-area-curve` 로 낸다. */
function curveD(host: HTMLElement, nth = 0): string {
  const el = host.querySelectorAll(".recharts-area-curve")[nth];
  assert.ok(el, "계열 선이 안 그려졌다");
  return el.getAttribute("d") ?? "";
}

/* ── 표본 ─────────────────────────────────────────────────────────────── */

// 8/03 에 값이 **없다**. 측정이 안 된 날이지 0 인 날이 아니다.
const GAPPY = [
  { date: "2026-08-01", value: 10 },
  { date: "2026-08-02", value: 20 },
  { date: "2026-08-03", value: Number.NaN },
  { date: "2026-08-04", value: 40 },
];

const SERIES: NamedSeries[] = [
  {
    key: "a",
    label: "가",
    slot: 1,
    points: [
      { date: "2026-08-01", value: 10 },
      { date: "2026-08-02", value: 20 },
    ],
  },
  {
    key: "b",
    label: "나",
    slot: 2,
    points: [
      { date: "2026-08-01", value: 900 },
      { date: "2026-08-02", value: 800 },
    ],
  },
];

/* ── 1·2. 결측 ────────────────────────────────────────────────────────── */

test("★값이 없는 날을 선으로 잇지 않는다 — 선이 실제로 끊긴다", async () => {
  const { TimeSeriesChart } = await import("./TimeSeriesChart");
  const { host, cleanup } = await mount(
    <TimeSeriesChart data={GAPPY} title="결측" animate={false} />
  );
  const parts = subpaths(curveD(host));
  assert.equal(
    parts.length,
    2,
    "값 없는 날에서 선이 안 끊겼다 — connectNulls 가 켜졌거나 결측이 채워졌다"
  );
  cleanup();
});

test("★값이 없는 날을 0 으로 떨어뜨리지 않는다 — 바닥을 찍은 꼭짓점이 없다", async () => {
  const { TimeSeriesChart } = await import("./TimeSeriesChart");
  const { host, cleanup } = await mount(
    <TimeSeriesChart data={GAPPY} title="결측" animate={false} />
  );
  const pts = subpaths(curveD(host)).flat();
  // 그려진 꼭짓점은 3개(10·20·40)뿐이어야 한다. 4개면 결측이 0 으로 그려진 것이다.
  assert.equal(
    pts.length,
    3,
    `꼭짓점이 ${pts.length}개 — 결측이 값으로 그려졌다`
  );

  // 축 바닥(=0)의 y 를 그리드 마지막 줄에서 얻어, 거기 닿은 점이 없는지 본다.
  const grid = [
    ...host.querySelectorAll(".recharts-cartesian-grid-horizontal line"),
  ];
  const baseY = Math.max(...grid.map((l) => Number(l.getAttribute("y1"))));
  for (const [, y] of pts) {
    assert.ok(y < baseY - 1, `꼭짓점이 축 바닥(0)에 닿았다: y=${y}`);
  }
  cleanup();
});

test("★값이 없는 날은 표에서도 0 이 아니라 '—' 다", async () => {
  const { TimeSeriesChart } = await import("./TimeSeriesChart");
  const { host, cleanup } = await mount(
    <TimeSeriesChart data={GAPPY} title="결측" animate={false} />
  );
  const rows = [...host.querySelectorAll("details table tbody tr")];
  const gap = rows.find(
    (r) => r.querySelector("th")?.textContent === "2026-08-03"
  );
  assert.ok(
    gap,
    "결측일 행 자체가 사라졌다 — 행을 버리면 x축이 당겨져 날짜가 거짓말한다"
  );
  assert.equal(gap!.querySelector("td")?.textContent, "—");
  cleanup();
});

test("★`toRows` 가 결측을 null 로 남긴다 — 0 으로 채우면 이 한 줄이 거짓말이 된다", () => {
  const rows = toRows(
    [{ key: "a", label: "가", slot: 1, points: [{ date: "d1", value: 5 }] }],
    ["d1", "d2"]
  );
  assert.equal(rows[0].a, 5);
  assert.equal(rows[1].a, null, "값 없는 날이 0 으로 채워졌다");
});

/* ── 3. 안 그리는 상태들 ──────────────────────────────────────────────── */

test("★적재 전 / 값 없음 / 전부 0 — 어느 것도 0 선으로 안 그려진다", async () => {
  const { TimeSeriesChart } = await import("./TimeSeriesChart");
  for (const [label, node] of [
    [
      "적재 전",
      <TimeSeriesChart
        key="p"
        data={[]}
        title="t"
        state="pending"
        animate={false}
      />,
    ],
    [
      "값 없음",
      <TimeSeriesChart
        key="e"
        data={[{ date: "2026-08-01", value: 0 }]}
        title="t"
        animate={false}
      />,
    ],
  ] as const) {
    const { host, cleanup } = await mount(node);
    assert.equal(
      host.querySelectorAll(".recharts-area-curve").length,
      0,
      `${label} 인데 선을 그렸다`
    );
    assert.equal(host.querySelectorAll("svg .recharts-surface").length, 0);
    cleanup();
  }
});

test("표본 부족은 숨기지도 과장하지도 않는다 — 그리되 표본 수를 박는다", () => {
  const html = renderToStaticMarkup(
    <ChartFrame title="t" state="insufficient" sampleSize={4}>
      <span>plot</span>
    </ChartFrame>
  );
  assert.ok(html.includes("표본 4건"), "표본 수가 안 나온다");
  assert.ok(
    html.includes("plot"),
    "표본 부족인데 안 그렸다 — 숨기면 정보를 잃는다"
  );
});

/* ── 4·5. Y축 ─────────────────────────────────────────────────────────── */

test("★Y축이 자동이 아니다 — 도메인이 숫자로 확정돼 넘어간다", () => {
  assert.deepEqual(resolveYDomain(SERIES, undefined), [0, 900]);
  // 바닥은 언제나 0 이다. 잘린 축은 같은 데이터로 다른 이야기를 만든다.
  assert.equal(resolveYDomain(SERIES, undefined)[0], 0);
  // 값이 전부 0 이어도 축이 무너지지 않는다.
  assert.deepEqual(
    resolveYDomain([{ key: "z", label: "z", slot: 1, points: [] }], undefined),
    [0, 1]
  );
});

test("★안 보이는 계열은 축을 밀어 올리지 않는다 (org-access §3.4-10)", () => {
  const hidden = new Set(["b"]);
  assert.equal(visibleMax(SERIES, hidden), 20, "끈 계열이 축 상한에 남아 있다");
  assert.deepEqual(resolveYDomain(SERIES, hidden), [0, 20]);
});

test("★축 눈금에 도메인을 넘는 숫자가 안 찍힌다 — 축만 보고 새는 경로를 막는다", async () => {
  const { MultiSeriesChart } = await import("./MultiSeriesChart");
  const { host, cleanup } = await mount(
    <MultiSeriesChart
      series={SERIES}
      title="축"
      yDomain={{ kind: "fixed", max: 100 }}
      animate={false}
    />
  );
  const ticks = [...host.querySelectorAll(".recharts-yAxis-tick-labels text")]
    .map((t) => Number((t.textContent ?? "").replace(/[^\d.-]/g, "")))
    .filter((n) => isFinite(n));
  assert.ok(ticks.length > 0, "y축 눈금이 하나도 없다");
  for (const t of ticks) {
    // ★이 검사는 실제로 한 번 깨졌다. `allowDataOverflow` 를 안 켜면 recharts 가
    //   도메인을 데이터에 맞게 **늘려서** 900 을 축에 찍는다. 못박은 상한이
    //   조용히 무시되는 것이라, 축만 보고 새는 경로가 그대로 열려 있었다.
    assert.ok(t <= 100, `못박은 상한(100)을 넘는 눈금이 찍혔다: ${t}`);
  }
  cleanup();
});

test("★범례로 끈 계열의 최댓값이 축 눈금에 안 남는다", async () => {
  const { MultiSeriesChart } = await import("./MultiSeriesChart");
  const { host, act, cleanup } = await mount(
    <MultiSeriesChart series={SERIES} title="축" animate={false} />
  );
  const yTicks = () =>
    [...host.querySelectorAll(".recharts-yAxis-tick-labels text")].map(
      (t) => t.textContent ?? ""
    );
  assert.ok(yTicks().some((t) => t.includes("900")), "켜져 있는데 축이 900 을 안 쓴다");

  // '나'(900) 를 끈다.
  const chips = [...host.querySelectorAll("button[aria-pressed]")] as HTMLButtonElement[];
  const off = chips.find((c) => (c.textContent ?? "").includes("나"))!;
  await act(async () => {
    off.click();
  });

  assert.ok(
    !yTicks().some((t) => t.includes("900")),
    "끈 계열의 최댓값이 축 눈금에 남았다 — 안 보이는 것이 축으로 새어나간다"
  );
  cleanup();
});

test("★못박은 상한이 값을 못 덮으면 조용히 자르지 않고 눈에 보이게 말한다", async () => {
  const spec = { kind: "fixed", max: 100 } as const;
  assert.equal(yDomainCoversData(SERIES, undefined, spec), false);
  assert.equal(yDomainCoversData(SERIES, new Set(["b"]), spec), true);

  const { MultiSeriesChart } = await import("./MultiSeriesChart");
  const { host, cleanup } = await mount(
    <MultiSeriesChart
      series={SERIES}
      title="축"
      yDomain={spec}
      animate={false}
    />
  );
  assert.ok(
    (host.textContent ?? "").includes("축 상한을 넘는 값이 있습니다"),
    "잘렸는데 아무 말도 안 한다"
  );
  cleanup();
});

/* ── 6. 클릭 인터랙션과 권한 경계 ─────────────────────────────────────── */

test("★스코프 키가 없는 계열은 클릭이 아예 안 붙는다", async () => {
  const { MultiSeriesChart } = await import("./MultiSeriesChart");
  const seen: DrillTarget[] = [];
  const { host, act, cleanup } = await mount(
    <MultiSeriesChart
      series={SERIES /* drillScopeKey 없음 */}
      title="클릭"
      onDrill={(t) => seen.push(t)}
      animate={false}
    />
  );
  const surface = host.querySelector(".recharts-surface") as SVGElement;
  await act(async () => {
    surface.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
  assert.deepEqual(seen, [], "스코프 키를 안 줬는데 드릴다운이 나갔다");
  assert.ok(
    !(host.textContent ?? "").includes("클릭하면"),
    "클릭이 안 되는데 클릭하라고 안내한다"
  );
  cleanup();
});

test("★visibleScopes 에 없는 스코프는 클릭이 죽는다 — 남의 팀으로 못 들어간다", async () => {
  const { MultiSeriesChart } = await import("./MultiSeriesChart");
  const mine = SERIES.map((s, i) => ({
    ...s,
    drillScopeKey: i === 0 ? "team:mine" : "team:someone-else",
  }));
  const seen: DrillTarget[] = [];
  const { host, act, cleanup } = await mount(
    <MultiSeriesChart
      series={mine}
      title="클릭"
      onDrill={(t) => seen.push(t)}
      visibleScopes={new Set(["team:mine"])}
      animate={false}
    />
  );

  // 내 스코프만 남았으므로 날짜 단면 클릭이 산다 — 그리고 **내 스코프로만** 나간다.
  const surface = host.querySelector(".recharts-surface") as SVGElement;
  await act(async () => {
    surface.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
  for (const t of seen) {
    assert.equal(
      t.scopeKey,
      "team:mine",
      "허용되지 않은 스코프로 드릴다운이 나갔다"
    );
  }
  cleanup();
});

test("★계열마다 스코프가 다르면 '아무 데나 클릭'은 안 붙는다 — 애매하면 안 연다", async () => {
  const { MultiSeriesChart } = await import("./MultiSeriesChart");
  const seen: DrillTarget[] = [];
  const mixed = SERIES.map((s, i) => ({ ...s, drillScopeKey: `team:${i}` }));
  const { host, act, cleanup } = await mount(
    <MultiSeriesChart
      series={mixed}
      title="클릭"
      onDrill={(t) => seen.push(t)}
      visibleScopes={new Set(["team:0", "team:1"])}
      animate={false}
    />
  );
  const surface = host.querySelector(".recharts-surface") as SVGElement;
  await act(async () => {
    surface.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
  assert.deepEqual(
    seen,
    [],
    "계열이 특정 안 되는 클릭에 아무 스코프나 실어 보냈다"
  );
  assert.ok(
    (host.textContent ?? "").includes("점을 클릭하면"),
    "계열별 클릭 경로를 안내하지 않는다"
  );
  cleanup();
});

test("`isDrillAllowed` — 게이트 규칙 자체를 못박는다", () => {
  assert.equal(isDrillAllowed(undefined), false, "키가 없으면 언제나 불가");
  assert.equal(isDrillAllowed(undefined, new Set(["a"])), false);
  assert.equal(
    isDrillAllowed("a"),
    true,
    "스코프 목록을 안 준 화면은 게이트가 없다"
  );
  assert.equal(isDrillAllowed("a", new Set(["a"])), true);
  assert.equal(isDrillAllowed("a", new Set(["b"])), false);
  assert.equal(isDrillAllowed("a", new Set()), false, "빈 목록은 전부 막는다");
});

test("단일 계열 차트도 같은 게이트를 탄다", async () => {
  const { TimeSeriesChart } = await import("./TimeSeriesChart");
  const seen: string[] = [];
  const { host, act, cleanup } = await mount(
    <TimeSeriesChart
      data={GAPPY}
      title="클릭"
      onPointClick={(d) => seen.push(d)}
      drillScopeKey="team:other"
      visibleScopes={new Set(["team:mine"])}
      animate={false}
    />
  );
  const surface = host.querySelector(".recharts-surface") as SVGElement;
  await act(async () => {
    surface.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
  assert.deepEqual(seen, [], "내 스코프가 아닌데 클릭이 살았다");
  cleanup();
});

/* ── 스켈레톤 ─────────────────────────────────────────────────────────── */

test("★서버 HTML 이 빈 칸이 아니다 — 같은 높이의 스켈레톤이 먼저 선다", async () => {
  const { TimeSeriesChart } = await import("./TimeSeriesChart");
  const html = renderToStaticMarkup(
    <TimeSeriesChart data={GAPPY} title="스켈레톤" surface="dark" />
  );
  assert.ok(
    html.includes("viz-skeleton"),
    "서버 HTML 에 스켈레톤이 없다 — 빈 칸이 보인다"
  );
  assert.ok(
    html.includes("height:180px"),
    "차트 높이가 서버에서 안 잡혔다 — 레이아웃이 튄다"
  );
  assert.ok(
    html.includes('aria-busy="true"'),
    "로딩 중이라고 보조기술에 안 알린다"
  );
  // ★스켈레톤은 계열색을 쓰지 않는다. 쓰면 그건 스켈레톤이 아니라 가짜 데이터다.
  assert.ok(
    !html.includes("var(--viz-series-"),
    "스켈레톤이 계열색을 썼다 — 잠깐이라도 값처럼 보이면 안 된다"
  );
  // 값은 이미 왔으므로 표 보기는 스켈레톤일 때도 나온다.
  assert.ok(
    html.includes("값을 표로 보기"),
    "그림이 아직인 동안 값을 볼 길이 없다"
  );
});
