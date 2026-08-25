"use client";
/**
 * 차트가 공통으로 쓰는 표현 조각들 — 범례·툴팁 카드·표·포맷.
 *
 * ★왜 라이브러리 기본 컴포넌트(`<Legend>` / `<Tooltip>` 기본 렌더)를 안 쓰나:
 *   recharts 는 둘 다 기본으로 준다. 그래도 여기서 우리 것을 쓰는 이유는 두 개다.
 *   1. **디자인이 우리 것이어야 한다** — 범례 칩·툴팁 카드는 화면에서 제일 자주
 *      인용되는 자리다. 라이브러리 기본형은 우리 토큰·간격·타이포를 안 따른다.
 *   2. **규율이 여기 산다** — 값이 없는 계열을 툴팁에서 `0` 으로 쓰지 않고 `—`
 *      로 쓴다. 툴팁은 그림보다 더 자주 인용되므로 여기서 0 을 지어내면 차트보다
 *      크게 거짓말이 된다.
 *   recharts 가 여전히 공짜로 해 주는 것(호버 감지·활성 인덱스·툴팁 위치 계산)은
 *   그대로 받는다 — 우리는 그 안에 들어갈 **카드 내용**만 그린다.
 *
 * ★색은 여기에도 없다. 전부 `var(--viz-*)` 다(tokens.css).
 */
import { Fragment, type CSSProperties } from "react";
import { seriesColorVar, type NamedSeries } from "./types";

export function formatIntKo(n: number): string {
  if (!isFinite(n)) return "—";
  return Math.round(n).toLocaleString("ko-KR");
}

export function formatDayKo(iso: string): string {
  const p = iso.split("-");
  return p.length >= 3 ? `${Number(p[1])}/${Number(p[2])}` : iso;
}

export function formatDayLongKo(iso: string): string {
  const p = iso.split("-");
  return p.length >= 3 ? `${Number(p[1])}월 ${Number(p[2])}일` : iso;
}

/* ── 범례 ──────────────────────────────────────────────────────────────────
 * 토글 가능한 칩. 껐다 켜는 것은 <button> 이다 — div 에 onClick 을 달면
 * 키보드로 못 끈다. 상태는 aria-pressed 로도 말한다(색만으로 말하지 않기).
 */
export type LegendItem = {
  key: string;
  label: string;
  slot: NamedSeries["slot"];
  tone?: NamedSeries["tone"];
};

export function ChartLegend({
  items,
  hidden,
  highlighted,
  onToggle,
  onHighlight,
}: {
  items: LegendItem[];
  hidden: ReadonlySet<string>;
  highlighted: string | null;
  onToggle: (key: string) => void;
  onHighlight: (key: string | null) => void;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5">
      {items.map((it) => {
        const off = hidden.has(it.key);
        const dim = highlighted != null && highlighted !== it.key;
        return (
          <button
            key={it.key}
            type="button"
            aria-pressed={!off}
            onClick={() => onToggle(it.key)}
            onMouseEnter={() => onHighlight(it.key)}
            onMouseLeave={() => onHighlight(null)}
            onFocus={() => onHighlight(it.key)}
            onBlur={() => onHighlight(null)}
            className="viz-legend-chip inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
            style={{
              borderColor: "var(--viz-grid)",
              color: off ? "var(--viz-ink-muted)" : "var(--viz-ink-secondary)",
              opacity: dim ? 0.45 : 1,
              textDecoration: off ? "line-through" : "none",
            }}
          >
            <span
              aria-hidden
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{
                background: off ? "transparent" : seriesColorVar(it.slot, it.tone),
                boxShadow: off ? `inset 0 0 0 1.5px var(--viz-ink-muted)` : "none",
              }}
            />
            {it.label}
            <span className="sr-only">{off ? " (숨김)" : " (표시 중)"}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── 툴팁 카드 ─────────────────────────────────────────────────────────────
 * ★값이 없는 계열은 0 으로 쓰지 않고 '—' 로 쓴다. 툴팁은 차트보다 더 자주
 *   인용되는 자리라 여기서 0 을 지어내면 그림보다 더 크게 거짓말이 된다.
 */
export type TooltipRow = {
  key: string;
  label: string;
  slot: NamedSeries["slot"];
  tone?: NamedSeries["tone"];
  value: number | null;
  /** 전 기간 대비. 있으면 값 아래 작은 줄로 같이 낸다. */
  compare?: { label: string; value: number | null; delta: number | null };
};

/** 증감. 이전이 없거나 0 이면 비율을 만들지 않는다 — 0 나누기는 이야기가 아니다. */
export function deltaOf(now: number | null, prev: number | null): number | null {
  if (now == null || prev == null || !isFinite(now) || !isFinite(prev)) return null;
  if (prev === 0) return null;
  return (now - prev) / prev;
}

export function formatDeltaKo(d: number | null): string {
  if (d == null) return "—";
  const pct = Math.round(d * 1000) / 10;
  return `${pct > 0 ? "+" : ""}${pct.toLocaleString("ko-KR")}%`;
}

export function TooltipCard({
  date,
  rows,
  style,
}: {
  date: string;
  rows: TooltipRow[];
  style?: CSSProperties;
}) {
  return (
    <div
      className="viz-tooltip pointer-events-none rounded-lg border px-2.5 py-2 text-xs shadow-lg"
      style={{
        background: "var(--viz-surface)",
        borderColor: "var(--viz-axis)",
        color: "var(--viz-ink)",
        minWidth: 132,
        ...style,
      }}
    >
      <div className="mb-1 font-semibold" style={{ color: "var(--viz-ink)" }}>
        {formatDayLongKo(date)}
      </div>
      {/* ★무엇과 비교한 %인지 안 적으면 그 숫자는 읽는 사람이 지어내게 된다. */}
      {rows.some((r) => r.compare) && (
        <div className="mb-1 text-[10px]" style={{ color: "var(--viz-ink-muted)" }}>
          {rows.find((r) => r.compare)!.compare!.label} 대비
        </div>
      )}
      <table className="w-full">
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="py-px pr-3">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ background: seriesColorVar(r.slot, r.tone) }}
                  />
                  <span style={{ color: "var(--viz-ink-secondary)" }}>{r.label}</span>
                </span>
              </td>
              <td
                className="py-px text-right font-semibold tabular-nums"
                style={{ color: r.value == null ? "var(--viz-ink-muted)" : "var(--viz-ink)" }}
              >
                {r.value == null ? "—" : formatIntKo(r.value)}
                {r.compare && (
                  <span
                    className="ml-1.5 font-normal tabular-nums"
                    style={{ color: "var(--viz-ink-muted)" }}
                  >
                    {formatDeltaKo(r.compare.delta)}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 비교선 계열의 dataKey. 한 곳에서만 만든다 — 문자열 조립이 흩어지면 어긋난다. */
export function compareKey(key: string): string {
  return `${key}__prev`;
}

/**
 * 계열들을 행으로 접는다 — recharts 가 요구하는 모양.
 *
 * ★없는 값을 0 으로 채우지 않는다. `null` 을 넣으면 recharts 가
 *   `connectNulls={false}` 와 함께 **선을 끊는다.** 0 을 넣으면 없던 관측이
 *   바닥을 찍은 것처럼 그려진다 — 이 한 줄이 그 차이다.
 *
 * ★비교선은 **인덱스로** 겹친다(8/1 자리에 7/25 값). 날짜가 다르므로 이전
 *   구간의 날짜는 `__prevDate` 로 따로 실어 툴팁에서만 쓴다.
 */
export function toRows(
  series: NamedSeries[],
  dates: string[]
): Array<Record<string, string | number | null>> {
  return dates.map((d, i) => {
    const row: Record<string, string | number | null> = { date: d };
    for (const s of series) {
      const p = s.points.find((q) => q.date === d);
      row[s.key] = p && isFinite(p.value) ? p.value : null;
      if (s.compare) {
        const q = s.compare.points[i];
        row[compareKey(s.key)] = q && isFinite(q.value) ? q.value : null;
        row[`${compareKey(s.key)}Date`] = q ? q.date : null;
      }
    }
    return row;
  });
}

/* ── 표 보기 ──────────────────────────────────────────────────────────────
 * 밝은 바탕에서 일부 슬롯이 3:1 미만이라 relief 의무가 있다(tokens.css §검증).
 * ★그려지는 것은 표에도 있어야 한다 — 비교선을 그렸으면 표에도 낸다.
 */
export function SeriesTable({
  series,
  dates,
  format = formatIntKo,
}: {
  series: NamedSeries[];
  dates: string[];
  format?: (n: number) => string;
}) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr style={{ color: "var(--viz-ink-muted)" }}>
          <th scope="col" className="text-left font-normal">날짜</th>
          {series.map((s) => (
            <Fragment key={s.key}>
              <th scope="col" className="text-right font-normal">
                {s.label}
              </th>
              {s.compare && (
                <th scope="col" className="text-right font-normal">
                  {s.label} ({s.compare.label})
                </th>
              )}
            </Fragment>
          ))}
        </tr>
      </thead>
      <tbody style={{ color: "var(--viz-ink-secondary)" }}>
        {dates.map((d, i) => (
          <tr key={d}>
            <th scope="row" className="text-left font-normal">{d}</th>
            {series.map((s) => {
              const p = s.points.find((q) => q.date === d);
              const c = s.compare?.points[i];
              return (
                <Fragment key={s.key}>
                  <td className="text-right tabular-nums">
                    {p && isFinite(p.value) ? format(p.value) : "—"}
                  </td>
                  {s.compare && (
                    <td className="text-right tabular-nums">
                      {c && isFinite(c.value) ? format(c.value) : "—"}
                    </td>
                  )}
                </Fragment>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** x축에 라벨을 붙일 인덱스(처음·가운데·끝). 라벨끼리 밟으면 안 붙이느니만 못하다. */
export function axisIndices(n: number): number[] {
  if (n <= 1) return [0];
  if (n <= 8) return Array.from({ length: n }, (_, i) => i);
  return [0, Math.floor((n - 1) / 2), n - 1];
}
