/**
 * ★대조 시험 — 손 SVG 와 recharts 가 **같은 숫자**를 낸다.
 *
 * 라이브러리를 넣는 건 보기 좋게 만드는 일이지 집계를 바꾸는 일이 아니다.
 * 그 말이 지켜졌는지는 눈으로 볼 수 없으므로 여기서 못박는다. 비교 대상은
 * 아래 `LegacyLineChart` — 어드민 AnalyticsPanel.tsx 가 #1208 전까지 쓰던
 * 손 SVG 구현을 **한 글자도 안 고치고** 얼려 둔 것이다(색만 그대로 hex).
 *
 * 이 파일이 얼려 둔 계약:
 *   1. 값 라벨로 찍히는 숫자 집합이 같다 (포맷까지 같다)
 *   2. x축 라벨이 같다
 *   3. ★스케일이 같다 — **0 을 바닥으로 한 선형**이고 상한이 같다
 *   4. 푸터("범위 최대 N", "N일")가 같다
 *   5. ★빈 구간·전부 0 을 **0 선으로 그리지 않는다**
 *
 * 3번이 핵심이다. 스케일이 틀리면 **숫자는 그대로인데 그림이 거짓말을 한다.**
 *
 * ★★#1208(visx) 때와 달라진 점을 숨기지 않고 적는다.
 *   visx 판은 서버에서 그려졌으므로 `renderToStaticMarkup` 산출물끼리 **꼭짓점
 *   좌표를 0.001px 까지** 맞대 볼 수 있었다. recharts 는 서버에서 아무것도 안
 *   그린다(bakeoff §3.1). 그래서 **그 형태의 대조는 잃었다.**
 *
 *   대신 마운트해서 나온 좌표로 **스케일의 성질**을 검사한다: 모든 꼭짓점이
 *   `y = yBase − (v/max)·(yBase − yTop)` 위에 있는가. 이건 손 SVG 가 좌표를
 *   만들던 식 그 자체다. 절대 픽셀은 recharts 의 여백 규칙을 타므로 비교하지
 *   않는다(jsdom 에는 레이아웃이 없어 상자 크기도 우리가 고정한 값이다).
 *   ★못 재는 것을 잰 척하지 않는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import "./testEnv";
import { renderToStaticMarkup } from "react-dom/server";
import type { SeriesPoint } from "./types";

/* ──────────────────────────────────────────────────────────────────────────
 * 얼려 둔 참조 구현 (AnalyticsPanel.tsx 의 LineChart, 이 티켓 이전 버전)
 * ────────────────────────────────────────────────────────────────────────── */
const LEGACY_SERIES = "#3987e5";
const LEGACY_INK_MUTED = "#898781";

function legacyFmtInt(n: number | undefined | null): string {
  if (n == null || !isFinite(n)) return "0";
  return Math.round(n).toLocaleString("ko-KR");
}
function legacyFmtDay(d: string): string {
  const parts = d.split("-");
  if (parts.length >= 3) return `${parts[1]}/${parts[2]}`;
  const dt = new Date(d);
  if (!isNaN(dt.getTime())) return `${dt.getMonth() + 1}/${dt.getDate()}`;
  return d;
}
function legacyPickLabelIndices(values: number[]): Set<number> {
  const n = values.length;
  if (n === 0) return new Set();
  if (n <= 12) return new Set(values.map((_, i) => i));
  let maxI = 0;
  let minI = 0;
  for (let i = 1; i < n; i++) {
    if (values[i] > values[maxI]) maxI = i;
    if (values[i] < values[minI]) minI = i;
  }
  const picked = new Set([maxI, n - 1]);
  const gap = Math.max(2, Math.floor(n / 12));
  if (Math.abs(minI - maxI) > gap && Math.abs(minI - (n - 1)) > gap) {
    picked.add(minI);
  }
  return picked;
}

function LegacyLineChart({
  data,
  color = LEGACY_SERIES,
  format = legacyFmtInt,
}: {
  data: { date: string; value: number }[];
  color?: string;
  format?: (n: number) => string;
}) {
  const clean = data.filter((d) => d && isFinite(d.value));
  const allZero = clean.every((d) => d.value === 0);
  if (clean.length === 0 || allZero)
    return <div data-legacy-empty="1">비었음</div>;

  const W = 640;
  const H = 180;
  const padL = 8;
  const padR = 8;
  const padT = 20;
  const padB = 22;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const max = Math.max(...clean.map((d) => d.value), 1);
  const n = clean.length;
  const x = (i: number) =>
    padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const labelIndices = legacyPickLabelIndices(clean.map((d) => d.value));
  const linePts = clean.map((d, i) => `${x(i)},${y(d.value)}`).join(" ");
  const labelIdx = n === 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1];

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} role="img">
        <polyline points={linePts} fill="none" stroke={color} strokeWidth={2} />
        {clean.map((d, i) => (
          <g key={i}>
            {labelIndices.has(i) && (
              <text x={x(i)} y={y(d.value) - 7} fontSize={10} fill="#d4d4d8">
                {format(d.value)}
              </text>
            )}
          </g>
        ))}
        {labelIdx.map((i) => (
          <text key={i} x={x(i)} y={H - 6} fontSize={11} fill={LEGACY_INK_MUTED}>
            {legacyFmtDay(clean[i].date)}
          </text>
        ))}
      </svg>
      <div>
        <span>범위 최대 {format(max)}</span>
        <span>{n}일</span>
      </div>
    </div>
  );
}

/* ── 마크업·DOM 에서 숫자·글자 뽑아내기 ────────────────────────────────── */

/** `<text>` 안의 글자를 등장 순서대로 (얼려 둔 손 SVG 는 문자열이다). */
function textNodes(html: string): string[] {
  return [...html.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
}

/** 손 SVG 의 `<polyline points>` → 좌표쌍. */
function polylineCoords(html: string): [number, number][] {
  const m = html.match(/<polyline[^>]*points="([^"]+)"/);
  if (!m) return [];
  return m[1]
    .trim()
    .split(/\s+/)
    .map((p) => {
      const [a, b] = p.split(",").map(Number);
      return [a, b] as [number, number];
    });
}

/** recharts 를 실제로 마운트한다 — 서버에서는 아무것도 안 그리므로. */
async function mountNext(node: React.ReactNode) {
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
    cleanup: () => {
      root.unmount();
      host.remove();
    },
  };
}

const texts = (host: HTMLElement, sel: string) =>
  [...host.querySelectorAll(sel)].map((t) => t.textContent ?? "");

/** 계열 선의 꼭짓점. */
function curveCoords(host: HTMLElement): [number, number][] {
  const d = host.querySelector(".recharts-area-curve")?.getAttribute("d") ?? "";
  const out: [number, number][] = [];
  for (const m of d.matchAll(/[ML]\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/g)) {
    out.push([Number(m[1]), Number(m[2])]);
  }
  return out;
}

/** 값 0 의 y 픽셀. 도메인 바닥이 0 이므로 제일 아래 그리드 줄이 그 자리다. */
function baselineY(host: HTMLElement): number {
  const lines = [...host.querySelectorAll(".recharts-cartesian-grid-horizontal line")];
  return Math.max(...lines.map((l) => Number(l.getAttribute("y1"))));
}

/**
 * ★스케일 대조. 손 SVG 가 쓰던 식과 **같은 성질**인지 본다:
 *   y(v) = yBase − (v / max) · (yBase − yTop),  yBase = y(0)
 * 절대 픽셀이 아니라 이 관계를 본다 — 여백 규칙이 라이브러리마다 다르기 때문이다.
 * 허용오차 0.01px 은 `d` 속성의 반올림 표기분이다. 이보다 키우면 스케일이
 * 어긋나도 통과하므로 올리지 말 것.
 */
function assertLinearFromZero(
  coords: [number, number][],
  values: number[],
  yBase: number
) {
  assert.equal(coords.length, values.length, "꼭짓점 개수가 값 개수와 다르다");
  const max = Math.max(...values, 1);
  const iMax = values.indexOf(max);
  assert.ok(iMax >= 0, "최댓값 점을 못 찾았다");
  const fullH = yBase - coords[iMax][1];
  assert.ok(fullH > 0, "최댓값이 바닥보다 아래에 그려졌다");

  coords.forEach(([, y], i) => {
    const expected = yBase - (values[i] / max) * fullH;
    assert.ok(
      Math.abs(y - expected) <= 0.01,
      `${i}번 점이 선형 스케일에서 벗어났다 — 값 ${values[i]}, y ${y}, 기대 ${expected}`
    );
  });
}

/* ── 고정 데이터 (난수 금지 — 실패가 재현돼야 한다) ─────────────────────── */
const SHORT = [
  { date: "2026-08-01", value: 12 },
  { date: "2026-08-02", value: 0 },
  { date: "2026-08-03", value: 47 },
  { date: "2026-08-04", value: 47 },
  { date: "2026-08-05", value: 3 },
];
const LONG = Array.from({ length: 30 }, (_, i) => ({
  date: `2026-08-${String(i + 1).padStart(2, "0")}`,
  value: [
    11, 42, 7, 88, 130, 64, 21, 9, 305, 77, 54, 61, 18, 2, 96, 140, 33, 27, 5,
    250, 71, 44, 12, 63, 89, 101, 6, 38, 74, 120,
  ][i],
}));

const CASES: [string, SeriesPoint[]][] = [
  ["짧은 구간(라벨 전부)", SHORT],
  ["긴 구간(라벨 선별)", LONG],
  ["점 하나", [{ date: "2026-08-09", value: 1234 }]],
];

for (const [name, data] of CASES) {
  test(`★대조 — ${name}: 손 SVG 와 recharts 가 같은 숫자를 낸다`, async () => {
    const { TimeSeriesChart } = await import("./TimeSeriesChart");
    const legacy = renderToStaticMarkup(<LegacyLineChart data={data} />);
    const { host, cleanup } = await mountNext(
      <TimeSeriesChart data={data} title="대조" surface="dark" animate={false} />
    );

    // 손 SVG 는 값 라벨을 먼저, x축 라벨을 나중에 낸다. 그 순서를 그대로 쓴다.
    const legacyTexts = textNodes(legacy);
    const n = data.length;
    const legacyAxis = legacyTexts.slice(-(n === 1 ? 1 : 3));
    const legacyValues = legacyTexts.slice(0, legacyTexts.length - legacyAxis.length);

    // 1. 값 라벨로 찍히는 숫자가 같다 — 포맷까지, 순서까지.
    assert.deepEqual(
      texts(host, ".recharts-label-list text"),
      legacyValues,
      "값 라벨로 찍히는 숫자가 달라졌다"
    );

    // 2. x축 라벨이 같다.
    assert.deepEqual(
      texts(host, ".recharts-xAxis-tick-labels text"),
      legacyAxis,
      "x축 라벨이 달라졌다"
    );

    // 3. 스케일이 같다 — 0 을 바닥으로 한 선형이고 상한이 같다.
    //    ★점이 하나면 검사할 스케일이 없다(선이 없다). 그 경우는 값 라벨과
    //      푸터만 대조한다 — 없는 검사를 억지로 만들지 않는다.
    if (n === 1) {
      cleanup();
      return;
    }
    assertLinearFromZero(
      curveCoords(host),
      data.map((d) => d.value),
      baselineY(host)
    );
    // 손 SVG 도 같은 성질이었다는 것을 같은 함수로 확인한다(참조가 표류하면 잡힌다).
    const legacyPts = polylineCoords(legacy);
    assertLinearFromZero(
      legacyPts,
      data.map((d) => d.value),
      20 + (180 - 20 - 22) // 얼려 둔 손 SVG 의 padT + innerH = y(0)
    );

    // 4. 푸터의 두 숫자가 같다.
    const max = Math.max(...data.map((d) => d.value), 1);
    for (const s of [`범위 최대 ${legacyFmtInt(max)}`, `${data.length}일`]) {
      assert.ok((host.textContent ?? "").includes(s), `푸터에 "${s}" 가 없다`);
      assert.ok(legacy.includes(s), `참조 푸터에 "${s}" 가 없다`);
    }
    cleanup();
  });
}

test("★빈 구간을 0 으로 그리지 않는다 — 손 SVG 와 같은 판단", async () => {
  const { TimeSeriesChart } = await import("./TimeSeriesChart");
  const EMPTY_CASES: SeriesPoint[][] = [[], [{ date: "2026-08-01", value: 0 }]];
  for (const data of EMPTY_CASES) {
    const legacy = renderToStaticMarkup(<LegacyLineChart data={data} />);
    const { host, cleanup } = await mountNext(
      <TimeSeriesChart data={data} title="빈 구간" surface="dark" animate={false} />
    );
    assert.ok(legacy.includes('data-legacy-empty="1"'), "참조가 비었다고 안 했다");
    assert.ok(
      host.querySelector('[data-chart-state="empty"]'),
      "recharts 쪽이 empty 상태로 안 접혔다"
    );
    assert.equal(
      host.querySelectorAll(".recharts-area-curve").length,
      0,
      "빈 구간에 선을 그었다"
    );
    assert.ok(
      (host.textContent ?? "").includes("0 이 아니라"),
      "빈 것과 0 을 구분하는 문구가 없다"
    );
    cleanup();
  }
});

test("★'적재 전'은 빈 구간과 다른 말을 쓴다 — 차트가 추론하지 않는다", async () => {
  const { TimeSeriesChart } = await import("./TimeSeriesChart");
  const { host, cleanup } = await mountNext(
    <TimeSeriesChart
      data={[{ date: "2026-08-01", value: 42 }]}
      title="적재 전"
      state="pending"
      animate={false}
    />
  );
  const text = host.textContent ?? "";
  assert.ok(text.includes("적재 전"), "'적재 전' 문구가 없다");
  assert.ok(!text.includes("42"), "적재 전인데 숫자를 그렸다");
  assert.equal(host.querySelectorAll(".recharts-area-curve").length, 0);
  cleanup();
});

test("★표본 부족은 그리되 표본 수를 같이 박는다", async () => {
  const { TimeSeriesChart } = await import("./TimeSeriesChart");
  const { host, cleanup } = await mountNext(
    <TimeSeriesChart
      data={SHORT}
      title="표본 부족"
      state="insufficient"
      sampleSize={4}
      animate={false}
    />
  );
  const text = host.textContent ?? "";
  assert.ok(text.includes("표본 4건"), "표본 수가 안 적혔다");
  assert.ok(text.includes("추세로 읽지 마세요"), "경고 문구가 없다");
  assert.ok(
    host.querySelectorAll(".recharts-area-curve").length > 0,
    "표본 부족이라고 선을 지웠다"
  );
  cleanup();
});
