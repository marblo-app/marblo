"use client";
/**
 * 단일 시리즈 시계열 (영역 + 선). **recharts 위에 얹은** 마블로 표준 차트.
 *
 * 사장님 결정(2026-08-25): recharts. 근거는 bakeoff 가 제시한 기준 그대로다 —
 * 차트 종류를 많이 늘릴 계획이면 recharts 가 유리하고, 클릭 인터랙션이 기본으로
 * 온다. 실측 대가(+110.3KB gzip · 서버 HTML 에 path 0개)는 아시고 고르셨다.
 * → `docs/CHART-LIBRARY-DECISION-2026-08-24.md`
 *
 * ★"차트는 그리기만 한다" — 이 파일에 집계가 없다. 합계·평균·비율·필터는 전부
 *   밖에서 끝내고 들어온다. 라이브러리를 넣는 건 보기 좋게 만드는 일이지 숫자를
 *   바꾸는 일이 아니다.
 *
 * ★색이 이 파일에 없다. 전부 `var(--viz-*)` 다 (tokens.css). recharts 는 색을
 *   SVG 속성으로 넘기므로 CSS 변수가 그대로 통과한다.
 *
 * ★★recharts 기본값 셋을 **명시적으로 끈다.** 기본값이 우리 규율과 반대다:
 *   1. `connectNulls` — 기본 false 지만 **명시한다.** 값이 없는 날을 이으면
 *      없던 관측을 있었던 것처럼 그린다. 명시하지 않으면 다음 사람이 "선이
 *      끊겨 보인다"며 켤 것이다. 그래서 코드에 적고 테스트로 못박는다.
 *   2. `domain` — 기본은 자동 스케일이다. 축 상한이 코드에 안 보이는 채로
 *      정해지면 그 최댓값이 축 눈금으로 새어나간다(org-access §3.4-10).
 *      **숫자로 확정해서 넘긴다.**
 *   3. 결측을 0 으로 채우기 — 이건 recharts 가 아니라 **데이터를 만드는 쪽**이
 *      흔히 하는 실수다. `toRow` 가 `null` 을 넣는다. 0 을 넣으면 바닥을 찍은
 *      날처럼 그려진다.
 *
 * ★서버에서는 안 그려진다 — recharts 는 서버 HTML 에 마크를 0개 보낸다.
 *   그래서 하이드레이션 전까지 `ChartFrame` 이 **같은 높이의 스켈레톤**을
 *   세운다. 이게 recharts 를 고른 대가를 갚는 자리다.
 */
import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartFrame } from "./ChartFrame";
import { useHydrated, useReducedMotion } from "./ChartSkeleton";
import { TooltipCard, formatIntKo } from "./primitives";
import {
  isDrillAllowed,
  markerIndexOf,
  resolveYDomain,
  seriesVar,
  type ChartDataState,
  type ChartMarkerSpec,
  type SeriesPoint,
  type SeriesSlot,
  type VizSurface,
  type YDomainSpec,
} from "./types";

/* ── 지오메트리 (기존 손 SVG·visx 판과 같은 값. 옮겨도 그림이 안 흔들리게) ── */
const H = 180;
const MARGIN = { top: 20, right: 10, bottom: 2, left: 2 } as const;
const ANIM_MS = 800;

/** ISO 날짜 → MM/DD. */
export function formatDay(d: string): string {
  const parts = d.split("-");
  if (parts.length >= 3) return `${parts[1]}/${parts[2]}`;
  const dt = new Date(d);
  if (!isNaN(dt.getTime())) return `${dt.getMonth() + 1}/${dt.getDate()}`;
  return d;
}

/**
 * 값 라벨을 붙일 인덱스. 포인트가 적으면 전부, 많으면 최대/최소/끝점만 —
 * 라벨이 서로 밟으면 안 붙이느니만 못하다.
 *
 * ★recharts 에도 `<LabelList>` 가 있지만 **전부 아니면 전무**다. 선택적
 *   직접 라벨은 우리 규칙이라 `content` 로 우리가 고른다.
 */
export function pickValueLabelIndices(values: number[]): Set<number> {
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

export type TimeSeriesChartProps = {
  data: SeriesPoint[];
  /** 스크린리더가 부를 이름. */
  title: string;
  description?: string;
  slot?: SeriesSlot;
  /**
   * 슬롯 대신 색을 직접 줄 때. **CSS 변수를 넣어라** — 헥사를 박으면 밝은
   * 바탕으로 옮겨 갈 때 그 차트만 죽는다. (기존 어드민 호출부 호환용 통로다.)
   */
  color?: string;
  surface?: VizSurface;
  format?: (n: number) => string;
  emptyLabel?: string;
  pendingLabel?: string;
  /**
   * ★부르는 쪽이 정한다. 안 주면 `data` 로 `ready`/`empty` 만 가른다 —
   * '적재 전'과 '표본 부족'은 차트가 알 수 없는 사실이라 절대 추론하지 않는다.
   */
  state?: ChartDataState;
  sampleSize?: number;
  marker?: ChartMarkerSpec;
  /** ★자동 스케일 금지. 안 주면 그려진 값의 최대로 확정한다. */
  yDomain?: YDomainSpec;
  /** 주면 각 시점이 클릭 가능해진다. 아래 `drillScopeKey`/`visibleScopes` 를 함께 읽어라. */
  onPointClick?: (date: string) => void;
  /**
   * 이 차트가 대표하는 스코프. 단일 계열이므로 **차트 전체가 하나의 스코프**다.
   * `visibleScopes` 를 넘긴 화면에서는 이 키가 그 목록에 있어야 클릭이 산다.
   */
  drillScopeKey?: string;
  /**
   * 이 사용자에게 실리는 스코프 키 집합. **스코프가 걸린 화면(조직 대시보드)은
   * 반드시 넘긴다.** 안 넘기면 게이트가 없다(어드민 = 전수를 보는 사람).
   * 이건 1차 방어가 아니라 마지막 관문이다 — 1차는 서버 봉투다(org-access §3.2).
   */
  visibleScopes?: ReadonlySet<string>;
  /**
   * 진입 애니메이션. 기본 켜짐이되 `prefers-reduced-motion` 이면 자동으로 꺼진다.
   * ★테스트에서 `false` 로 준다 — 애니메이션 중에는 recharts 가 값 라벨을 아직
   *   안 그리는데, 그걸 "라벨이 없다"로 읽으면 검사가 거짓말을 한다.
   */
  animate?: boolean;
};

type Row = { date: string; value: number | null };

/** 결측을 **버리지 않고 `null` 로 남긴다.** 버리면 x축이 당겨져 날짜가 거짓말한다. */
function toRow(d: SeriesPoint): Row {
  return { date: d.date, value: d && isFinite(d.value) ? d.value : null };
}

export function TimeSeriesChart({
  data,
  title,
  description,
  slot = 1,
  color,
  surface = "light",
  format = formatIntKo,
  emptyLabel,
  pendingLabel,
  state,
  sampleSize,
  marker,
  yDomain,
  onPointClick,
  drillScopeKey,
  visibleScopes,
  animate = true,
}: TimeSeriesChartProps) {
  const hydrated = useHydrated();
  // ★훅은 조건 없이 부른다. `animate && !useReducedMotion()` 로 쓰면 단축
  //   평가 때문에 훅이 조건부로 불려 렌더 순서가 흔들린다.
  const reducedMotion = useReducedMotion();
  const animated = animate && !reducedMotion;

  const rows = useMemo(() => data.map(toRow), [data]);
  const values = useMemo(
    () =>
      rows.filter((r): r is { date: string; value: number } => r.value != null),
    [rows]
  );

  // ★빈 것을 0 으로 그리지 않는다. 상태를 명시로 받았으면 그걸 존중하고,
  //   안 받았으면 "그릴 값이 아예 없다" 만 empty 로 접는다.
  const allZero = values.length > 0 && values.every((d) => d.value === 0);
  const resolved: ChartDataState =
    state ?? (values.length === 0 || allZero ? "empty" : "ready");

  const stroke = color ?? seriesVar(slot);
  const n = rows.length;
  const [, max] = resolveYDomain(
    [{ key: "value", label: title, slot, points: values }],
    undefined,
    yDomain
  );

  if (resolved === "empty" || resolved === "pending" || n === 0) {
    return (
      <ChartFrame
        title={title}
        description={description}
        state={resolved === "ready" ? "empty" : resolved}
        surface={surface}
        emptyLabel={emptyLabel}
        pendingLabel={pendingLabel}
      >
        {null}
      </ChartFrame>
    );
  }

  const labelIndices = pickValueLabelIndices(values.map((d) => d.value));
  const dates = rows.map((r) => r.date);
  const axisIdx = n === 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1];
  const mIdx = markerIndexOf(dates, marker);

  // ★클릭이 사는 조건은 **한 줄**이다. 두 군데에 두면 한 곳만 고쳐진다.
  const canDrill =
    onPointClick != null &&
    (visibleScopes == null || isDrillAllowed(drillScopeKey, visibleScopes));

  const gradientId = `viz-area-${slot}`;

  return (
    <ChartFrame
      title={title}
      description={description}
      state={resolved}
      surface={surface}
      sampleSize={sampleSize}
      loading={!hydrated}
      plotHeight={H}
      footer={
        <>
          <span>범위 최대 {format(max)}</span>
          <span>{n}일</span>
        </>
      }
      tableView={
        <table className="w-full text-xs">
          <caption className="sr-only">{title} 값 표</caption>
          <thead>
            <tr style={{ color: "var(--viz-ink-muted)" }}>
              <th scope="col" className="text-left font-normal">
                날짜
              </th>
              <th scope="col" className="text-right font-normal">
                값
              </th>
            </tr>
          </thead>
          <tbody style={{ color: "var(--viz-ink-secondary)" }}>
            {rows.map((d) => (
              <tr key={d.date}>
                <th scope="row" className="text-left font-normal">
                  {d.date}
                </th>
                {/* 값이 없는 날은 0 이 아니라 '—' 다. 표는 그림보다 더 자주 인용된다. */}
                <td className="text-right tabular-nums">
                  {d.value == null ? "—" : format(d.value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div style={{ height: H }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={rows}
            margin={{ ...MARGIN }}
            // recharts 가 기본 제공하는 방향키 탐색. visx 에는 없어서 못 갚았던 몫이다.
            accessibilityLayer
            onClick={
              canDrill
                ? (s: { activeLabel?: string | number }) => {
                    if (s?.activeLabel != null)
                      onPointClick!(String(s.activeLabel));
                  }
                : undefined
            }
            style={canDrill ? { cursor: "pointer" } : undefined}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
                <stop offset="100%" stopColor={stroke} stopOpacity={0} />
              </linearGradient>
            </defs>

            <CartesianGrid
              vertical={false}
              stroke="var(--viz-grid)"
              strokeDasharray="0"
            />

            <XAxis
              dataKey="date"
              // ★눈금을 우리가 고른다. 라벨이 서로 밟으면 안 붙이느니만 못하다.
              ticks={axisIdx.map((i) => dates[i])}
              interval={0}
              tickLine={false}
              axisLine={false}
              height={20}
              tick={(props: {
                x?: number | string;
                y?: number | string;
                payload?: { value?: unknown };
              }) => {
                const v = String(props.payload?.value ?? "");
                const ty = Number(props.y ?? 0);
                const i = dates.indexOf(v);
                return (
                  <text
                    x={props.x}
                    y={ty + 10}
                    fontSize={11}
                    fill="var(--viz-ink-muted)"
                    textAnchor={
                      i === 0 ? "start" : i === n - 1 ? "end" : "middle"
                    }
                  >
                    {formatDay(v)}
                  </text>
                );
              }}
            />
            {/* ★축은 숫자로 확정해서 넘긴다. "auto"/"dataMax" 를 넘기는 순간
                축이 라이브러리 것이 되고, 그 최댓값이 코드에 안 보이는 채로
                눈금에 인쇄된다(org-access §3.4-10). */}
            {/* ★`allowDataOverflow` 없이는 domain 이 무시된다 — recharts 가
                도메인을 데이터에 맞게 늘려서 못박은 상한이 안 지켜진다.
                (MultiSeriesChart 의 같은 자리에 근거를 적어 뒀다.) */}
            <YAxis domain={[0, max]} allowDataOverflow hide />

            <Tooltip
              cursor={{
                stroke: "var(--viz-axis)",
                strokeWidth: 1,
                strokeDasharray: "3 3",
              }}
              isAnimationActive={false}
              content={({ active, label, payload }) => {
                if (!active || !payload || payload.length === 0) return null;
                const raw = (payload[0] as { value?: unknown }).value;
                return (
                  <TooltipCard
                    date={String(label)}
                    rows={[
                      {
                        key: "value",
                        label: title,
                        slot,
                        value: typeof raw === "number" ? raw : null,
                      },
                    ]}
                  />
                );
              }}
            />

            {mIdx != null && marker && (
              <ReferenceLine
                x={dates[mIdx]}
                stroke="var(--viz-marker)"
                strokeDasharray="4 3"
                label={{
                  value: marker.label,
                  position: "insideTopRight",
                  fill: "var(--viz-marker)",
                  fontSize: 9,
                  fontWeight: 600,
                }}
              />
            )}

            <Area
              dataKey="value"
              type="linear"
              // ★값이 없는 날을 잇지 않는다. 이으면 없는 관측을 있었던 것처럼 그린다.
              connectNulls={false}
              stroke={stroke}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              fill={`url(#${gradientId})`}
              fillOpacity={1}
              isAnimationActive={animated}
              animationDuration={ANIM_MS}
              animationEasing="ease-out"
              dot={n <= 45 ? { r: 2.5, fill: stroke, stroke: "none" } : false}
              activeDot={{
                r: 4,
                stroke: "var(--viz-surface)",
                strokeWidth: 2,
                fill: stroke,
              }}
            >
              {/* ★값을 직접 쓴다. 색·툴팁에만 기대지 않는다 — 밝은 바탕에서
                  일부 슬롯이 3:1 미만이라 이건 취향이 아니라 relief 의무다. */}
              <LabelList
                dataKey="value"
                content={(props: {
                  x?: number | string;
                  y?: number | string;
                  index?: number;
                  value?: unknown;
                }) => {
                  const i = props.index ?? -1;
                  if (typeof props.value !== "number") return null;
                  const valueIdx = values.findIndex(
                    (v) => v.date === rows[i]?.date
                  );
                  if (!labelIndices.has(valueIdx)) return null;
                  return (
                    <text
                      x={Number(props.x)}
                      y={Number(props.y) - 7}
                      fontSize={10}
                      fontWeight={600}
                      fill="var(--viz-ink-secondary)"
                      textAnchor={
                        i === 0 ? "start" : i === n - 1 ? "end" : "middle"
                      }
                    >
                      {format(props.value)}
                    </text>
                  );
                }}
              />
            </Area>
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}
