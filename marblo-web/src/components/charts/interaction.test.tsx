/**
 * 인터랙션이 **실제로 동작한다**는 것을 고정한다.
 *
 * ★사장님이 명시하신 요구가 "차트 클릭하면 인터랙션도 되어야 한다" 였다. 그
 *   요구는 스크린샷으로 증명되지 않는다 — 눌러 보고 DOM 이 바뀌는지를 봐야 한다.
 *   "범례를 눌렀는데 계열이 안 사라진다" 같은 회귀는 그림이 아니라 DOM 으로 잡는다.
 *
 * ★jsdom 은 브라우저 GUI 가 아니라 DOM 구현체다. Playwright·Electron 은 안 띄운다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import "./testEnv";
import type { NamedSeries } from "./types";

const SERIES: NamedSeries[] = [
  {
    key: "new",
    label: "성장",
    slot: 1,
    points: [
      { date: "2026-08-01", value: 12 },
      { date: "2026-08-02", value: 18 },
      { date: "2026-08-03", value: 9 },
    ],
    compare: {
      label: "이전 3일",
      points: [
        { date: "2026-07-29", value: 10 },
        { date: "2026-07-30", value: 10 },
        { date: "2026-07-31", value: 12 },
      ],
    },
  },
  {
    key: "churn",
    label: "이탈",
    slot: 2,
    points: [
      { date: "2026-08-01", value: 3 },
      // 8/02 는 값이 없다 — 0 이 아니다.
      { date: "2026-08-03", value: 5 },
    ],
  },
];

async function mount(extra: Record<string, unknown> = {}) {
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { MultiSeriesChart } = await import("./MultiSeriesChart");
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <MultiSeriesChart
        series={SERIES}
        title="성장/이탈"
        animate={false}
        {...extra}
      />
    );
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

test("진입하면 계열이 다 그려진다 — 범례도 그림 위에 이미 서 있다", async () => {
  const { host, cleanup } = await mount();
  assert.equal(host.querySelectorAll("button[aria-pressed]").length, 2);
  assert.ok(
    host.querySelectorAll(".recharts-area-curve").length >= 2,
    "계열 선이 모자라다"
  );
  cleanup();
});

test("★범례 토글 — 누르면 그 계열이 실제로 사라지고 다시 누르면 돌아온다", async () => {
  const { host, act, cleanup } = await mount();
  const before = host.querySelectorAll(".recharts-area-curve").length;
  const chip = host.querySelector("button[aria-pressed]") as HTMLButtonElement;
  assert.equal(chip.getAttribute("aria-pressed"), "true");

  await act(async () => {
    chip.click();
  });
  assert.equal(
    chip.getAttribute("aria-pressed"),
    "false",
    "aria-pressed 가 안 바뀌었다"
  );
  const after = host.querySelectorAll(".recharts-area-curve").length;
  assert.ok(
    after < before,
    `계열을 껐는데 마크 수가 그대로다 (${before} → ${after})`
  );

  await act(async () => {
    chip.click();
  });
  assert.equal(chip.getAttribute("aria-pressed"), "true");
  assert.equal(host.querySelectorAll(".recharts-area-curve").length, before);
  cleanup();
});

test("범례는 키보드로 조작 가능하다 — <button> 이다", async () => {
  const { host, cleanup } = await mount();
  for (const chip of host.querySelectorAll("button[aria-pressed]")) {
    assert.equal(
      chip.tagName,
      "BUTTON",
      "div 에 onClick 을 달면 키보드로 못 끈다"
    );
  }
  cleanup();
});

test("★recharts 의 방향키 탐색(accessibilityLayer)이 켜져 있다", async () => {
  const { host, cleanup } = await mount();
  const svg = host.querySelector(".recharts-surface");
  assert.equal(
    svg?.getAttribute("tabindex"),
    "0",
    "차트에 키보드 포커스가 안 간다"
  );
  assert.equal(svg?.getAttribute("role"), "application");
  cleanup();
});

test("★호버는 한 점이 아니라 그 시점의 전 계열 단면을 낸다", async () => {
  const { renderTooltipRows } = await import("./tooltipRows");
  const rows = renderTooltipRows(SERIES, new Set(), [
    { dataKey: "new", value: 18 },
    { dataKey: "new__prev", value: 10 },
    // 'churn' 은 그날 값이 없다 — payload 에 안 실려 온다.
  ]);
  assert.equal(rows.length, 2, "값이 없는 계열이 툴팁에서 통째로 빠졌다");
  assert.equal(rows[0].value, 18);
  assert.equal(rows[1].value, null, "값 없는 계열이 0 으로 채워졌다");
  // 전 기간 대비가 기본으로 보인다.
  assert.equal(rows[0].compare?.label, "이전 3일");
  assert.equal(rows[0].compare?.delta, 0.8);
});

test("툴팁 카드가 값 없는 계열을 '—' 로 쓴다 — 0 으로 지어내지 않는다", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { TooltipCard } = await import("./primitives");
  const html = renderToStaticMarkup(
    <TooltipCard
      date="2026-08-02"
      rows={[
        { key: "a", label: "가", slot: 1, value: 18 },
        { key: "b", label: "나", slot: 2, value: null },
      ]}
    />
  );
  assert.ok(html.includes("—"), "값 없는 계열이 '—' 가 아니다");
  assert.ok(!/>0</.test(html), "0 을 지어냈다");
});

test("★비교선이 같은 축 위에 점선으로 겹친다 — 그리고 표에도 나온다", async () => {
  const { host, cleanup } = await mount();
  const dashed = [...host.querySelectorAll(".recharts-area-curve")].filter(
    (el) => el.getAttribute("stroke-dasharray")
  );
  assert.equal(dashed.length, 1, "비교선이 점선으로 안 그려졌다");
  const headers = [...host.querySelectorAll("details table thead th")].map(
    (t) => t.textContent
  );
  assert.ok(
    headers.includes("성장 (이전 3일)"),
    `그린 것이 표에 없다: ${headers.join(", ")}`
  );
  cleanup();
});
