/**
 * ★대조 시험 — 손 SVG 와 visx 가 **같은 숫자**를 낸다.
 *
 * 라이브러리를 넣는 건 보기 좋게 만드는 일이지 집계를 바꾸는 일이 아니다.
 * 그 말이 지켜졌는지는 눈으로 볼 수 없으므로 여기서 못박는다. 비교 대상은
 * 아래 `LegacyLineChart` — 어드민 AnalyticsPanel.tsx 가 이 티켓 전까지 쓰던
 * 손 SVG 구현을 **한 글자도 안 고치고** 얼려 둔 것이다(색만 그대로 hex).
 *
 * 이 파일이 얼려 둔 계약:
 *   1. 값 라벨로 찍히는 숫자 집합이 같다 (포맷까지 같다)
 *   2. x축 라벨이 같다
 *   3. 꼭짓점 좌표가 같다 — 스케일 계산이 어긋나지 않았다
 *   4. 푸터("범위 최대 N", "N일")가 같다
 *   5. ★빈 구간·전부 0 을 **0 선으로 그리지 않는다**
 *
 * 3번이 핵심이다. visx 로 옮기면서 우리가 산 것은 스케일이고, 스케일이
 * 틀리면 숫자는 그대로인데 그림이 거짓말을 한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { TimeSeriesChart } from "./TimeSeriesChart";
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

/* ── 마크업에서 숫자·글자 뽑아내기 ─────────────────────────────────────── */

/** `<text>` 안의 글자를 등장 순서대로. */
function textNodes(html: string): string[] {
  return [...html.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
}

/** 손 SVG 는 `<polyline points>`, visx 는 `<path d>` — 둘 다 좌표쌍으로. */
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

function linePathCoords(html: string): [number, number][] {
  // LinePath 는 class="visx-linepath" 를 달고 나온다 (AreaClosed 는 visx-area-closed).
  const m = html.match(/<path[^>]*class="visx-linepath"[^>]*d="([^"]+)"/);
  if (!m) return [];
  const nums = m[1].match(/-?\d+(?:\.\d+)?/g) ?? [];
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    out.push([Number(nums[i]), Number(nums[i + 1])]);
  }
  return out;
}

/**
 * 허용오차 0.001px.
 *
 * 손 SVG 는 좌표를 배정밀도 그대로 문자열에 박았고, visx 가 쓰는 d3-path 는
 * `d` 속성을 소수 셋째 자리에서 반올림한다. 그래서 두 값은 640px 폭 기준
 * **1/1000 픽셀** 까지만 같다. 이건 숫자가 바뀐 게 아니라 경로 문자열의
 * 표기 정밀도이며, 화면에 찍히는 숫자(값 라벨)는 위에서 완전 일치로 따로
 * 못박는다. 오차를 이보다 키우면 스케일이 어긋나도 통과하므로 올리지 말 것.
 */
const COORD_EPSILON = 1e-3;

function assertCoordsEqual(
  a: [number, number][],
  b: [number, number][],
  what: string
) {
  assert.equal(a.length, b.length, `${what}: 점 개수가 다르다`);
  a.forEach(([ax, ay], i) => {
    const [bx, by] = b[i];
    assert.ok(
      Math.abs(ax - bx) <= COORD_EPSILON && Math.abs(ay - by) <= COORD_EPSILON,
      `${what}: ${i}번 점이 다르다 — 손SVG(${ax},${ay}) vs visx(${bx},${by})`
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
  test(`★대조 — ${name}: 손 SVG 와 visx 가 같은 숫자를 낸다`, () => {
    const legacy = renderToStaticMarkup(<LegacyLineChart data={data} />);
    const next = renderToStaticMarkup(
      <TimeSeriesChart data={data} title="대조" surface="dark" />
    );

    // 1+2. 글자(값 라벨 + x축 라벨)가 순서까지 같다.
    assert.deepEqual(
      textNodes(next),
      textNodes(legacy),
      "차트에 찍히는 글자가 달라졌다"
    );

    // 3. 꼭짓점 좌표가 같다 — 스케일이 어긋나지 않았다.
    assertCoordsEqual(
      polylineCoords(legacy),
      linePathCoords(next),
      "꼭짓점"
    );

    // 4. 푸터의 두 숫자가 같다.
    const max = Math.max(...data.map((d) => d.value), 1);
    for (const s of [`범위 최대 ${legacyFmtInt(max)}`, `${data.length}일`]) {
      assert.ok(next.includes(s), `푸터에 "${s}" 가 없다`);
      assert.ok(legacy.includes(s), `참조 푸터에 "${s}" 가 없다`);
    }
  });
}

test("★빈 구간을 0 으로 그리지 않는다 — 손 SVG 와 같은 판단", () => {
  const EMPTY_CASES: SeriesPoint[][] = [[], [{ date: "2026-08-01", value: 0 }]];
  for (const data of EMPTY_CASES) {
    const legacy = renderToStaticMarkup(<LegacyLineChart data={data} />);
    const next = renderToStaticMarkup(
      <TimeSeriesChart data={data} title="빈 구간" surface="dark" />
    );
    assert.ok(legacy.includes('data-legacy-empty="1"'), "참조가 비었다고 안 했다");
    assert.ok(
      next.includes('data-chart-state="empty"'),
      "visx 쪽이 empty 상태로 접히지 않았다"
    );
    assert.ok(!/<polyline|visx-linepath/.test(next), "빈 구간에 선을 그었다");
    assert.ok(
      next.includes("0 이 아니라"),
      "빈 것과 0 을 구분하는 문구가 없다"
    );
  }
});

test("★'적재 전'은 빈 구간과 다른 말을 쓴다 — 차트가 추론하지 않는다", () => {
  const withData = [{ date: "2026-08-01", value: 42 }];
  const pending = renderToStaticMarkup(
    <TimeSeriesChart data={withData} title="적재 전" state="pending" />
  );
  assert.ok(pending.includes("적재 전"), "'적재 전' 문구가 없다");
  assert.ok(!pending.includes("42"), "적재 전인데 숫자를 그렸다");
  assert.ok(!/visx-linepath/.test(pending), "적재 전인데 선을 그었다");
});

test("★표본 부족은 그리되 표본 수를 같이 박는다", () => {
  const html = renderToStaticMarkup(
    <TimeSeriesChart
      data={SHORT}
      title="표본 부족"
      state="insufficient"
      sampleSize={4}
    />
  );
  assert.ok(html.includes("표본 4건"), "표본 수가 안 적혔다");
  assert.ok(html.includes("추세로 읽지 마세요"), "경고 문구가 없다");
  assert.ok(/visx-linepath/.test(html), "표본 부족이라고 선을 지웠다");
});
