/**
 * ★같은 차트 컴포넌트가 두 바탕에서 다 산다.
 *
 * 어드민은 어두운 화면이고 조직 대시보드는 화이트+블루다. 이 티켓이 라이브러리를
 * 고를 때 테마 연동에 가중치를 크게 준 이유가 이것이다 — 색을 하드코딩으로 받는
 * 라이브러리는 여기서 짐이 된다.
 *
 * 그래서 여기서 못박는 것은 "예쁘다" 가 아니라 **검증 가능한 두 가지**다:
 *   1. 마크에 헥사값이 한 개도 없다 (전부 `var(--viz-*)`)
 *   2. 두 바탕의 마크업이 `data-viz-surface` 한 글자만 빼고 완전히 같다
 *      — 즉 바탕을 바꾸는 데 컴포넌트를 갈아끼울 필요가 없다
 *
 * 2번이 없으면 1번은 반쪽이다. 변수를 쓰더라도 바탕마다 다른 컴포넌트를
 * 쓴다면 차트 시스템은 결국 둘로 갈린다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { TimeSeriesChart } from "./TimeSeriesChart";
import { ChartFrame } from "./ChartFrame";

const DATA = [
  { date: "2026-08-01", value: 12 },
  { date: "2026-08-02", value: 47 },
  { date: "2026-08-03", value: 31 },
];

const CHART_DIR = path.join(process.cwd(), "src/components/charts");

test("★마크에 헥사값이 없다 — 색은 전부 CSS 변수로 받는다", () => {
  const html = renderToStaticMarkup(
    <TimeSeriesChart data={DATA} title="테마" surface="dark" marker={{ date: "2026-08-02", label: "경계" }} />
  );
  const hexes = html.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
  assert.deepEqual(
    hexes.filter((h) => !h.startsWith("#viz-")),
    [],
    `렌더 결과에 하드코딩 색이 남았다: ${hexes.join(", ")}`
  );
  assert.ok(html.includes("var(--viz-series-1)"), "계열색이 CSS 변수가 아니다");
  assert.ok(html.includes("var(--viz-grid)"), "그리드가 CSS 변수가 아니다");
  assert.ok(html.includes("var(--viz-marker)"), "마커가 CSS 변수가 아니다");
});

test("★두 바탕의 마크업은 data-viz-surface 하나만 다르다", () => {
  const dark = renderToStaticMarkup(
    <TimeSeriesChart data={DATA} title="테마" surface="dark" />
  );
  const light = renderToStaticMarkup(
    <TimeSeriesChart data={DATA} title="테마" surface="light" />
  );
  assert.notEqual(dark, light, "surface 를 바꿨는데 마크업이 완전히 같다");
  assert.equal(
    dark.replace('data-viz-surface="dark"', "@"),
    light.replace('data-viz-surface="light"', "@"),
    "바탕을 바꾸는 데 그 속성 말고 다른 것이 바뀌었다"
  );
});

test("차트 컴포넌트 소스에 색 헥사값이 없다 — 새 차트가 실수로 색을 박는 것을 막는다", () => {
  for (const f of ["TimeSeriesChart.tsx", "ChartFrame.tsx", "types.ts"]) {
    const src = readFileSync(path.join(CHART_DIR, f), "utf8");
    const code = src
      .split("\n")
      // 주석은 검사하지 않는다 — 근거로 헥사를 인용하는 자리다.
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    const hexes = code.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
    assert.deepEqual(hexes, [], `${f} 에 하드코딩 색이 있다: ${hexes.join(", ")}`);
  }
});

test("tokens.css 가 두 바탕 모두에 계열 슬롯 7개를 정의한다", () => {
  const css = readFileSync(path.join(CHART_DIR, "tokens.css"), "utf8");
  const light = css.slice(0, css.indexOf('[data-viz-surface="dark"]'));
  const dark = css.slice(css.indexOf('[data-viz-surface="dark"]'));
  for (let i = 1; i <= 7; i++) {
    assert.ok(
      light.includes(`--viz-series-${i}:`),
      `밝은 바탕에 --viz-series-${i} 가 없다`
    );
    assert.ok(
      dark.includes(`--viz-series-${i}:`),
      `어두운 바탕에 --viz-series-${i} 가 없다`
    );
  }
  // 상태색은 테마를 타면 안 된다 — 어두운 블록에서 재정의하지 않는다.
  const darkBlock = css.slice(css.indexOf('[data-viz-surface="dark"]'));
  const darkRule = darkBlock.slice(0, darkBlock.indexOf("}"));
  assert.ok(
    !darkRule.includes("--viz-status-"),
    "상태색이 바탕에 따라 바뀐다 — 상태 팔레트는 고정이어야 한다"
  );
});

test("★어두운 바탕의 계열 1은 어드민이 지금 쓰는 색 그대로다 — 옮겨도 화면이 안 바뀐다", () => {
  const css = readFileSync(path.join(CHART_DIR, "tokens.css"), "utf8");
  const dark = css.slice(css.indexOf('[data-viz-surface="dark"]'));
  assert.match(
    dark,
    /--viz-series-1:\s*#3987e5/,
    "어드민의 SERIES(#3987e5) 와 어긋나면 대표 차트 이전이 눈에 보이는 변화가 된다"
  );
  assert.match(dark, /--viz-grid:\s*#2c2c2a/, "어드민 그리드색과 어긋난다");
});

test("★적재 전은 상태색을 쓰되 색만으로 말하지 않는다 — 문구가 함께 나온다", () => {
  const html = renderToStaticMarkup(
    <ChartFrame title="t" state="pending" surface="dark">
      <span>plot</span>
    </ChartFrame>
  );
  assert.ok(html.includes("var(--viz-status-warn)"), "상태색을 안 썼다");
  assert.ok(html.includes("적재 전"), "색 옆에 라벨이 없다");
  assert.ok(!html.includes("plot"), "적재 전인데 본문을 그렸다");
});
