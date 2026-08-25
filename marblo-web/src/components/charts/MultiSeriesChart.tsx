"use client";
/**
 * 다계열 시계열 — 대시보드의 주력 차트.
 *
 * #1210(bakeoff)의 `RechartsMultiSeriesChart` 를 이어받아 **제품 차트로** 만든
 * 것이다. 비교용으로 켜 두었던 것들 중 남긴 것과 새로 넣은 것을 구분해 적는다.
 *
 * 남긴 것(bakeoff 에서 옴): 그라데이션 채움 · 진입 애니메이션 · 범례 토글 ·
 * 계열 하이라이트 dim · 경계선(ReferenceLine) · `connectNulls={false}`.
 *
 * 새로 넣은 것(이 티켓):
 *   1. **Y축 도메인 명시** — 자동 스케일을 끈다. 축 상한이 코드에 안 보이는 채로
 *      정해지면 그 최댓값이 눈금으로 새어나간다(org-access §3.4-10). 게다가
 *      **범례로 끈 계열은 축에서도 빠진다** — 안 보이는 것이 축을 밀어 올리면
 *      그것도 뺄셈이다(§3.4-9).
 *   2. **클릭 드릴다운 + 권한 경계** — 계열에 `drillScopeKey` 가 안 붙어 오면
 *      그 계열은 클릭이 **아예 안 붙는다.** 차트가 드릴 대상을 지어낼 수 없다.
 *   3. **전 기간 대비** — 같은 축 위에 점선 고스트로 겹치고, 툴팁에 증감을 낸다.
 *   4. **스켈레톤** — recharts 는 서버 HTML 에 마크를 0개 보낸다. 같은 높이의
 *      뼈대가 먼저 서서 빈 칸도, 레이아웃 이동도 안 만든다.
 *
 * ★호버는 한 점이 아니라 **그 시점의 전 계열 단면**을 낸다. 좋은 분석 대시보드와
 *   그냥 그래프의 차이가 대개 여기서 갈린다 — 사람은 "그날 무슨 일이 있었나"를
 *   묻지 "이 선의 그날 값"을 묻지 않는다.
 */
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartFrame } from "./ChartFrame";
import { useHydrated, useReducedMotion } from "./ChartSkeleton";
import {
  ChartLegend,
  SeriesTable,
  TooltipCard,
  compareKey,
  formatDayKo,
  formatIntKo,
  toRows,
} from "./primitives";
import { renderTooltipRows, type TooltipPayloadEntry } from "./tooltipRows";
import {
  isDrillAllowed,
  markerIndexOf,
  resolveChartState,
  resolveYDomain,
  seriesColorVar,
  unionDates,
  yDomainCoversData,
  type MultiSeriesChartProps,
} from "./types";

const H = 240;
const ANIM_MS = 900;

export function MultiSeriesChart({
  series,
  title,
  description,
  surface = "light",
  state,
  sampleSize,
  emptyLabel,
  pendingLabel,
  format = formatIntKo,
  animationKey,
  marker,
  yDomain,
  onDrill,
  visibleScopes,
  animate = true,
}: MultiSeriesChartProps) {
  const hydrated = useHydrated();
  // ★훅은 조건 없이 부른다. `animate && !useReducedMotion()` 로 쓰면 단축
  //   평가 때문에 훅이 조건부로 불려 렌더 순서가 흔들린다.
  const reducedMotion = useReducedMotion();
  const animated = animate && !reducedMotion;
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [highlighted, setHighlighted] = useState<string | null>(null);

  const resolved = resolveChartState(series, state);
  const dates = useMemo(() => unionDates(series), [series]);
  const rows = useMemo(() => toRows(series, dates), [series, dates]);

  // ★축은 **그려진 것만** 본다. 끈 계열은 축에서도 빠진다.
  const [, max] = resolveYDomain(series, hidden, yDomain);
  const covers = yDomainCoversData(series, hidden, yDomain);

  if (resolved === "empty" || resolved === "pending" || dates.length === 0) {
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

  const toggle = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const mIdx = markerIndexOf(dates, marker);

  /**
   * ★클릭이 사는 계열들. 조건은 **한 줄**이다 — 두 군데에 두면 한 곳만 고쳐진다.
   *
   *   클릭 가능 = onDrill 있음
   *             AND 계열에 drillScopeKey 가 붙어 있음
   *             AND (visibleScopes 를 안 받았거나, 그 키가 목록에 있음)
   *
   * `visibleScopes` 는 "이 화면은 스코프가 걸린 화면이다" 라는 호출부의 선언이다.
   * 어드민(전수를 보는 사람)은 안 넘기고, **조직 대시보드는 반드시 넘긴다.**
   * 이건 1차 방어가 아니라 마지막 관문이다 — 1차는 서버 봉투다(org-access §3.2).
   */
  const drillable = series.filter(
    (s) =>
      onDrill != null &&
      s.drillScopeKey != null &&
      (visibleScopes == null || isDrillAllowed(s.drillScopeKey, visibleScopes)) &&
      !hidden.has(s.key)
  );

  /**
   * 날짜 단면 클릭의 스코프. ★드릴 가능한 계열들이 **같은 스코프일 때만** 산다.
   *
   * 왜: 그림 아무 데나 누른 클릭은 계열을 특정하지 못한다. 계열마다 스코프가
   * 다른 차트(팀별 계열 같은 것)에서 그런 클릭에 아무 스코프나 실어 보내면,
   * 그게 정확히 남의 팀으로 들어가는 문이 된다. 그래서 애매하면 **안 붙인다.**
   * 계열이 특정되는 클릭(활성 점)은 그 계열의 스코프로 따로 살아 있다.
   */
  const commonScope =
    drillable.length > 0 &&
    drillable.every((s) => s.drillScopeKey === drillable[0].drillScopeKey)
      ? drillable[0].drillScopeKey!
      : null;

  const emitDate = (activeLabel: string | number | undefined) => {
    if (!onDrill || commonScope == null || activeLabel == null) return;
    onDrill({ scopeKey: commonScope, date: String(activeLabel) });
  };

  const emitPoint = (key: string, date: string) => {
    const s = drillable.find((q) => q.key === key);
    if (!onDrill || !s) return;
    const p = s.points.find((q) => q.date === date);
    onDrill({
      scopeKey: s.drillScopeKey!,
      seriesKey: s.key,
      date,
      // ★값이 없는 날은 0 이 아니라 null 로 넘긴다. 받는 쪽이 0 을 보고
      //   "그날은 0이었구나" 라고 읽으면 안 된다.
      value: p && isFinite(p.value) ? p.value : null,
    });
  };

  return (
    <ChartFrame
      title={title}
      description={description}
      state={resolved}
      surface={surface}
      sampleSize={sampleSize}
      loading={!hydrated}
      plotHeight={H}
      toolbar={
        <ChartLegend
          items={series.map((s) => ({
            key: s.key,
            label: s.label,
            slot: s.slot,
            tone: s.tone,
          }))}
          hidden={hidden}
          highlighted={highlighted}
          onToggle={toggle}
          onHighlight={setHighlighted}
        />
      }
      footer={
        <>
          <span>
            범위 최대 {format(max)}
            {/* ★못박은 상한이 값을 못 덮으면 조용히 자르지 않는다. 잘린 그림은
                같은 데이터로 다른 이야기를 만든다. */}
            {!covers && (
              <span style={{ color: "var(--viz-status-warn)" }}>
                {" "}
                ⚠ 축 상한을 넘는 값이 있습니다
              </span>
            )}
          </span>
          <span>
            {dates.length}일
            {commonScope != null
              ? " · 클릭하면 그날로 들어갑니다"
              : drillable.length > 0
                ? " · 점을 클릭하면 그 계열로 들어갑니다"
                : ""}
          </span>
        </>
      }
      tableView={<SeriesTable series={series} dates={dates} format={format} />}
    >
      <div style={{ height: H }}>
        {/* key 를 바꿔 기간 전환마다 진입 애니메이션을 다시 태운다. */}
        <ResponsiveContainer
          width="100%"
          height="100%"
          key={String(animationKey ?? "")}
        >
          <AreaChart
            data={rows}
            margin={{ top: 14, right: 10, left: 2, bottom: 2 }}
            accessibilityLayer
            onClick={
              commonScope != null
                ? (s: { activeLabel?: string | number }) => emitDate(s?.activeLabel)
                : undefined
            }
            style={commonScope != null ? { cursor: "pointer" } : undefined}
          >
            <defs>
              {series.map((s) => (
                <linearGradient
                  key={s.key}
                  id={`viz-grad-${s.key}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="0%"
                    stopColor={seriesColorVar(s.slot, s.tone)}
                    stopOpacity={0.34}
                  />
                  <stop
                    offset="100%"
                    stopColor={seriesColorVar(s.slot, s.tone)}
                    stopOpacity={0}
                  />
                </linearGradient>
              ))}
            </defs>

            <CartesianGrid
              vertical={false}
              stroke="var(--viz-grid)"
              strokeDasharray="0"
            />
            <XAxis
              dataKey="date"
              tickFormatter={formatDayKo}
              tick={{ fill: "var(--viz-ink-muted)", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "var(--viz-axis)" }}
              minTickGap={28}
            />
            {/* ★숫자로 확정한 도메인. "auto" 를 넘기지 않는 것이 이 줄의 전부다. */}
            <YAxis
              width={44}
              domain={[0, max]}
              // ★★이 한 줄이 없으면 위의 domain 은 **무시된다.**
              //   recharts 는 `allowDataOverflow` 가 false(기본)일 때 도메인을
              //   데이터에 맞게 **늘린다.** 즉 못박은 상한을 넘는 값이 오면 그
              //   값이 그대로 축 눈금에 인쇄된다 — 우리가 막으려던 바로 그 누출이다
              //   (org-access §3.4-10). 실제로 [0,100] 을 주고 900 을 넣었더니
              //   축에 900 이 찍혔다. 그래서 명시적으로 켠다.
              allowDataOverflow
              tickFormatter={(v: number) => format(v)}
              tick={{ fill: "var(--viz-ink-muted)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              cursor={{
                stroke: "var(--viz-axis)",
                strokeWidth: 1,
                strokeDasharray: "3 3",
              }}
              isAnimationActive={false}
              content={({ active, label, payload }) => {
                if (!active || !payload || payload.length === 0) return null;
                const entries = payload as ReadonlyArray<TooltipPayloadEntry>;
                // ★한 점이 아니라 그 시점의 **전 계열 단면**. 규칙은 순수
                //   함수로 떼어 두고 테스트가 거기를 직접 친다(tooltipRows.ts).
                const rowsOut = renderTooltipRows(series, hidden, entries);
                return <TooltipCard date={String(label)} rows={rowsOut} />;
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

            {/* 비교선을 **먼저** 그린다 — 지금 구간이 위에 와야 읽힌다. */}
            {series
              .filter((s) => s.compare)
              .map((s) => (
                <Area
                  key={compareKey(s.key)}
                  type="monotone"
                  dataKey={compareKey(s.key)}
                  name={`${s.label} (${s.compare!.label})`}
                  hide={hidden.has(s.key)}
                  connectNulls={false}
                  stroke={seriesColorVar(s.slot, s.tone)}
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  strokeOpacity={
                    highlighted && highlighted !== s.key ? 0.16 : 0.45
                  }
                  fill="none"
                  isAnimationActive={false}
                  dot={false}
                  activeDot={false}
                />
              ))}

            {series.map((s) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                hide={hidden.has(s.key)}
                // ★값이 없는 날을 이어 붙이지 않는다. 이으면 없는 관측을
                //   있었던 것처럼 그리게 된다.
                connectNulls={false}
                stroke={seriesColorVar(s.slot, s.tone)}
                strokeWidth={highlighted === s.key ? 3 : 2}
                strokeOpacity={highlighted && highlighted !== s.key ? 0.28 : 1}
                fill={`url(#viz-grad-${s.key})`}
                fillOpacity={highlighted && highlighted !== s.key ? 0.2 : 1}
                isAnimationActive={animated}
                animationDuration={ANIM_MS}
                animationEasing="ease-out"
                dot={false}
                // ★계열이 특정되는 클릭. 그 계열의 스코프로만 나간다.
                activeDot={{
                  r: 4,
                  stroke: "var(--viz-surface)",
                  strokeWidth: 2,
                  fill: seriesColorVar(s.slot, s.tone),
                  ...(drillable.some((d) => d.key === s.key)
                    ? {
                        cursor: "pointer",
                        onClick: (p: unknown, e: unknown) => {
                          // 날짜 단면 클릭이 뒤따라 또 터지지 않게 막는다 —
                          // 계열이 특정된 클릭이 더 정확한 의도다.
                          (e as { stopPropagation?: () => void } | undefined)?.stopPropagation?.();
                          const d = (p as { payload?: { date?: unknown } } | undefined)
                            ?.payload?.date;
                          if (typeof d === "string") emitPoint(s.key, d);
                        },
                      }
                    : {}),
                }}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}
