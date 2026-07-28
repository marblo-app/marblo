import { useMemo } from "react";
import { useTranslation } from "../../lib/i18n";
import { vendorColor } from "../../lib/usageBreakdown";
import { formatRate } from "../../lib/modelFactFormat";
import {
  axisTicks,
  barPercent,
  chartRows,
  priceAxisMax,
  BENCH_AXIS_MAX,
  type ChartRow,
} from "../../lib/modelFactChart";

/**
 * 모델 **단가 + SWE-bench 한눈 비교** 막대차트 — 정보표 바로 위.
 *
 * ── 왜 표만으로 부족했나 ────────────────────────────────────────────────
 * 표는 19줄 × 5칸이라 "무엇이 비싸고 무엇이 잘하나" 를 눈으로 스캔해 머리에서
 * 정렬해야 한다. 막대는 그 정렬을 눈이 대신 한다. 대신 막대는 **길이가 곧 주장**
 * 이라 표보다 거짓말하기 쉬워서, 계산을 전부 `lib/modelFactChart.ts` 로 빼고
 * 거기서 세 가지를 강제한다(한 축에 한 변형 / 빈 칸은 0 이 아니다 / 단가와 점수는
 * 축을 공유하지 않는다).
 *
 * ── ★두 패널인 이유(한 그림에 두 축을 놓지 않는다) ──────────────────────
 * $/1M 과 %resolved 는 단위가 다르다. 한 플롯에 y축 두 개를 놓으면 두 축의 정렬은
 * 임의인데 독자는 거기서 상관을 읽는다 — 데이터에 없는 상관을 그림이 만들어 내는
 * 셈이다. 그래서 축을 공유하지 않는 두 패널로 나누고 **모델 행만 맞춘다**. 같은
 * 줄을 가로로 훑으면 "이 값에 이 성능" 이 읽히되, 그건 독자가 한 비교지 그림이
 * 주장한 상관이 아니다.
 *
 * ── ★자립(self-contained) ───────────────────────────────────────────────
 * 외부 차트 라이브러리도 CDN 도 쓰지 않는다. 막대는 그냥 div 의 `width: %` 이고
 * 격자선은 CSS gradient 다. 이유는 번들 크기보다 **패키지 환경**이다 — 이 앱은
 * 서명·공증된 Electron 번들이라, 런타임에 원격 자원을 읽는 조각이 하나라도 있으면
 * 오프라인/방화벽 환경에서 그 화면만 조용히 빈다.
 *
 * ── ★테마: **OS 가 아니라 앱 셸을 따라간다** ────────────────────────────
 * 처음엔 크롬(격자·축·글자)을 `@media (prefers-color-scheme: light)` 로 뒤집게
 * 짰다가, 실제로 렌더해 보고 그게 버그임을 확인했다 — 이 앱의 셸은 다크 고정인데
 * (Tailwind `gray-*` 하드코딩, 테마 토글 없음) OS 가 라이트면 차트만 라이트 잉크로
 * 갈아타 **다크 배경 위에 진회색 글자**가 됐다. 라이트 맥을 쓰는 사용자에게 모델
 * 이름이 안 보이는 상태다.
 *
 * 그래서 판정 기준을 뒤집었다: 기본은 **무조건 다크**(= 셸과 같음)이고, 라이트는
 * 앱이 명시적으로 선언했을 때만 켜진다.
 *   · `data-theme` 없음(현재)      → 다크. 셸과 일치한다.
 *   · `data-theme="light"`          → 라이트. 앱이 라이트 테마를 붙이면 따라간다.
 *   · `data-theme="auto"`           → 그때만 `prefers-color-scheme` 를 존중한다.
 * 즉 OS 선호는 **앱이 OS 를 따르겠다고 말했을 때만** 읽는다. 이게 "prefers-color-scheme
 * + 앱 테마" 를 둘 다 지원하면서도 오늘 화면을 깨뜨리지 않는 유일한 조합이다.
 *
 * 막대 색(벤더 팔레트)은 **양쪽 표면에서 검증된 값**이라 테마별로 갈지 않는다 —
 * 다크 #182030 / 라이트 #ffffff 둘 다 명도대역·채도하한·인접 CVD ΔE 8.4·일반시야
 * ΔE 19.3·대비 3:1 을 통과한다(팔레트 검증기 실행 결과).
 */

/**
 * 격자·축·잉크. ★다크가 무조건 기본이고, 라이트는 앱이 선언했을 때만 덮는다.
 * (`--mfc-surface` 는 막대 사이 간격을 표면색으로 뚫을 때 쓴다.)
 */
const CHART_CSS = `
.mfc {
  --mfc-grid: rgba(148, 163, 184, 0.16);
  --mfc-axis: rgba(148, 163, 184, 0.28);
  --mfc-ink: #e5e7eb;
  --mfc-ink-dim: #9ca3af;
  --mfc-ink-faint: #8b93a1;
  --mfc-track: rgba(148, 163, 184, 0.09);
  --mfc-surface: #182030;
  --mfc-card-bg: rgba(17, 24, 39, 0.3);
  --mfc-card-border: rgba(55, 65, 81, 0.7);
  background: var(--mfc-card-bg);
  border-color: var(--mfc-card-border);
  color: var(--mfc-ink);
}
:root[data-theme="light"] .mfc,
:root[data-theme="auto"] .mfc {
  color-scheme: light;
}
@media (prefers-color-scheme: light) {
  :root[data-theme="auto"] .mfc {
    --mfc-grid: rgba(71, 85, 105, 0.14);
    --mfc-axis: rgba(71, 85, 105, 0.26);
    --mfc-ink: #1f2937;
    --mfc-ink-dim: #4b5563;
    --mfc-ink-faint: #6b7280;
    --mfc-track: rgba(71, 85, 105, 0.07);
    --mfc-surface: #ffffff;
    --mfc-card-bg: #ffffff;
    --mfc-card-border: rgba(71, 85, 105, 0.22);
  }
}
:root[data-theme="light"] .mfc {
  --mfc-grid: rgba(71, 85, 105, 0.14);
  --mfc-axis: rgba(71, 85, 105, 0.26);
  --mfc-ink: #1f2937;
  --mfc-ink-dim: #4b5563;
  --mfc-ink-faint: #6b7280;
  --mfc-track: rgba(71, 85, 105, 0.07);
  --mfc-surface: #ffffff;
  --mfc-card-bg: #ffffff;
  --mfc-card-border: rgba(71, 85, 105, 0.22);
}
/* 플롯 칸 배경 = 눈금 격자. 요소를 따로 만들지 않아 DOM 이 행 수에 비례해
   부풀지 않는다(19행 × 5선 = 95개 div 를 안 만든다). */
.mfc-plot {
  background-image: repeating-linear-gradient(
    to right,
    var(--mfc-grid) 0 1px,
    transparent 1px 25%
  );
  background-color: var(--mfc-track);
}
/* 막대 끝만 둥글게 — 축(0)에 붙은 쪽은 각지게 두어 기준선이 흐려지지 않는다. */
.mfc-bar {
  border-radius: 0 3px 3px 0;
  transition: width 160ms ease-out;
}
@media (prefers-reduced-motion: reduce) {
  .mfc-bar { transition: none; }
}
/* 포커스/호버 히트영역은 막대가 아니라 **행 전체**다 — 짧은 막대(싼 모델)도
   같은 크기로 집힌다. */
.mfc-row:hover .mfc-plot, .mfc-row:focus-within .mfc-plot {
  background-color: rgba(148, 163, 184, 0.16);
}
.mfc-row:focus-visible {
  outline: 2px solid var(--mfc-axis);
  outline-offset: 1px;
  border-radius: 3px;
}
`;

export interface ModelFactChartProps {
  rows: ModelFactRow[];
  /** ★고정된 변형. 차트는 이 변형의 칸만 읽는다(다른 변형으로 fallback 없음). */
  benchmark: BenchmarkVariantId;
  /** 그 변형의 표시 이름(축 제목에 그대로 쓴다). */
  variantLabel: string;
}

export function ModelFactChart({
  rows,
  benchmark,
  variantLabel,
}: ModelFactChartProps) {
  const { t } = useTranslation();
  const data = useMemo(() => chartRows(rows, benchmark), [rows, benchmark]);
  const priceMax = useMemo(() => priceAxisMax(data), [data]);

  if (data.length === 0) return null;

  const scored = data.filter((d) => d.score !== null).length;

  return (
    <figure className="mfc m-0 rounded-md border p-3">
      <style>{CHART_CSS}</style>

      <figcaption className="mb-2">
        <div
          className="text-[11px] font-medium"
          style={{ color: "var(--mfc-ink)" }}
        >
          {t("usage.factSheet.chart.title")}
        </div>
        {/* ★차트가 무엇을 하고 있는지 글로도 말한다 — 정렬 기준과 축 고정은
            그림만 봐서는 알 수 없고, 이 차트에선 그 둘이 곧 정직성이다. */}
        <div
          className="mt-0.5 text-[10px] leading-snug"
          style={{ color: "var(--mfc-ink-dim)" }}
        >
          {t("usage.factSheet.chart.subtitle", {
            variant: variantLabel,
            n: scored,
            total: data.length,
          })}
        </div>
      </figcaption>

      <ChartLegend />

      {/* 반응형: 좁아지면 가로 스크롤. 최소폭을 두는 이유는 이 아래로 줄어들면
          막대가 라벨보다 짧아져 그림이 아니라 소음이 되기 때문이다. */}
      <div className="overflow-x-auto">
        <div className="min-w-[520px]">
          <div
            className="grid items-center gap-x-3"
            style={{
              gridTemplateColumns:
                "minmax(120px, 1.1fr) minmax(150px, 1fr) minmax(150px, 1fr)",
            }}
            role="presentation"
          >
            <div />
            <PanelHeader
              title={t("usage.factSheet.chart.priceAxis")}
              tip={t("usage.factSheet.chart.priceTip")}
            />
            <PanelHeader
              title={t("usage.factSheet.chart.benchAxis", {
                variant: variantLabel,
              })}
              tip={t("usage.factSheet.chart.benchTip")}
            />

            {data.map((row) => (
              <ChartRowCells
                key={row.modelId}
                row={row}
                priceMax={priceMax}
                variantLabel={variantLabel}
              />
            ))}

            <div />
            <AxisTicks
              max={priceMax}
              format={(v) => formatRate(v)}
              label={t("usage.factSheet.chart.priceAxis")}
            />
            <AxisTicks
              max={BENCH_AXIS_MAX}
              format={(v) => `${v}`}
              label={t("usage.factSheet.chart.benchAxis", {
                variant: variantLabel,
              })}
            />
          </div>
        </div>
      </div>
    </figure>
  );
}

/** 패널 제목 = 축 이름. 단위를 여기 한 번만 적고 막대엔 안 붙인다. */
function PanelHeader({ title, tip }: { title: string; tip: string }) {
  return (
    <div
      className="pb-1 text-[10px]"
      style={{ color: "var(--mfc-ink-dim)" }}
      title={tip}
    >
      {title}
    </div>
  );
}

/**
 * 범례. 단가 패널에만 계열이 둘(input/output)이라 범례가 **반드시** 있어야 한다.
 * SWE-bench 패널은 계열이 하나라 범례를 두지 않는다(축 제목이 이미 이름이다).
 *
 * ★두 계열을 밝기 차로만 구분하지 않는다 — 각 막대에 값이 직접 적혀 있고,
 * 범례에도 글자가 있다. 색각 이상이나 흑백 인쇄에서도 뜻이 남는다.
 */
function ChartLegend() {
  const { t } = useTranslation();
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
      <LegendSwatch
        opacity={0.5}
        label={t("usage.factSheet.chart.input")}
        tip={t("usage.factSheet.chart.inputTip")}
      />
      <LegendSwatch
        opacity={1}
        label={t("usage.factSheet.chart.output")}
        tip={t("usage.factSheet.chart.outputTip")}
      />
      <span
        className="text-[10px]"
        style={{ color: "var(--mfc-ink-faint)" }}
        title={t("usage.factSheet.chart.noScoreTip")}
      >
        {t("usage.factSheet.chart.noScoreLegend")}
      </span>
    </div>
  );
}

function LegendSwatch({
  opacity,
  label,
  tip,
}: {
  opacity: number;
  label: string;
  tip: string;
}) {
  return (
    <span
      className="flex items-center gap-1 text-[10px]"
      style={{ color: "var(--mfc-ink-dim)" }}
      title={tip}
    >
      {/* 범례 견본은 중립 회색이다 — 벤더 색을 쓰면 "input = 파랑" 처럼 읽혀
          벤더 정체성 채널과 충돌한다. 여기서 나르는 건 **밝기 차**뿐이다. */}
      <span
        aria-hidden
        className="inline-block h-2 w-4 rounded-sm"
        style={{ background: "var(--mfc-ink-dim)", opacity }}
      />
      {label}
    </span>
  );
}

/** 한 모델의 세 칸(라벨 · 단가 패널 · 벤치 패널). */
function ChartRowCells({
  row,
  priceMax,
  variantLabel,
}: {
  row: ChartRow;
  priceMax: number;
  variantLabel: string;
}) {
  const { t } = useTranslation();
  const color = vendorColor(row.vendor);

  const priceTip = t("usage.factSheet.chart.rowPriceTip", {
    model: row.label,
    input: formatRate(row.inputPer1M),
    output: formatRate(row.outputPer1M),
  });

  const benchTip =
    row.score === null
      ? (row.note ?? t("usage.factSheet.chart.noScoreTip"))
      : t("usage.factSheet.chart.rowBenchTip", {
          model: row.label,
          score: row.score.toFixed(1),
          variant: variantLabel,
          harness: row.harness ?? "—",
        });

  return (
    <>
      {/* 라벨 칸. 벤더 색 견본 + **글자**로 정체성을 두 번 나른다. */}
      <div
        className="mfc-row flex min-w-0 items-center gap-1.5 py-1"
        tabIndex={0}
      >
        <span
          aria-hidden
          className="inline-block h-2 w-2 shrink-0 rounded-sm"
          style={{ background: color }}
        />
        <span
          className="truncate text-[10px]"
          style={{ color: "var(--mfc-ink)" }}
          title={`${row.label} · ${row.vendorLabel}`}
        >
          {row.label}
        </span>
      </div>

      {/* 단가 패널 — 두 막대(input 위, output 아래). */}
      <div className="py-1" title={priceTip}>
        <div className="mfc-plot relative h-[18px] w-full overflow-hidden rounded-sm">
          <Bar
            pct={barPercent(row.inputPer1M, priceMax)}
            color={color}
            opacity={0.5}
            top="2px"
          />
          <Bar
            pct={barPercent(row.outputPer1M, priceMax)}
            color={color}
            opacity={1}
            top="9px"
          />
        </div>
        {/* ★값을 글자로도 적는다 — 툴팁이 값에 닿는 유일한 길이면 안 된다. */}
        <div
          className="mt-0.5 flex gap-1.5 text-[9px] tabular-nums"
          style={{ color: "var(--mfc-ink-faint)" }}
        >
          <span>{formatRate(row.inputPer1M)}</span>
          <span style={{ color: "var(--mfc-ink-dim)" }}>
            {formatRate(row.outputPer1M)}
          </span>
          {row.estimatedPricing && (
            <span title={t("usage.factSheet.estimatedTip")}>
              {t("usage.factSheet.estimated")}
            </span>
          )}
        </div>
      </div>

      {/* 벤치 패널 — 한 막대. ★점수가 없으면 길이 0 막대가 아니라 글자다. */}
      <div className="py-1" title={benchTip}>
        <div className="mfc-plot relative h-[18px] w-full overflow-hidden rounded-sm">
          {row.score !== null && (
            <Bar
              pct={barPercent(row.score, BENCH_AXIS_MAX)}
              color={color}
              opacity={1}
              top="5px"
            />
          )}
        </div>
        <div
          className="mt-0.5 text-[9px] tabular-nums"
          style={{
            color:
              row.score === null
                ? "var(--mfc-ink-faint)"
                : "var(--mfc-ink-dim)",
          }}
        >
          {row.score === null
            ? t("usage.factSheet.unknown")
            : `${row.score.toFixed(1)}%`}
        </div>
      </div>
    </>
  );
}

/** 막대 하나. 높이 7px(얇게) + 표면색 테두리 대신 **간격**으로 분리한다. */
function Bar({
  pct,
  color,
  opacity,
  top,
}: {
  pct: number;
  color: string;
  opacity: number;
  top: string;
}) {
  return (
    <div
      className="mfc-bar absolute left-0 h-[7px]"
      style={{ width: `${pct}%`, background: color, opacity, top }}
      aria-hidden
    />
  );
}

/**
 * 축 눈금. 격자선(플롯 칸 배경)과 **같은 위치**에 서야 해서 25% 간격을 공유한다.
 * 0 은 왼쪽 정렬, 마지막은 오른쪽 정렬 — 가운데 정렬하면 양끝이 칸 밖으로 샌다.
 */
function AxisTicks({
  max,
  format,
  label,
}: {
  max: number;
  format: (v: number) => string;
  label: string;
}) {
  const ticks = axisTicks(max);
  return (
    <div
      className="relative mt-0.5 h-3 border-t text-[9px] tabular-nums"
      style={{ borderColor: "var(--mfc-axis)", color: "var(--mfc-ink-faint)" }}
      aria-label={label}
    >
      {ticks.map((v, i) => (
        <span
          key={v}
          className="absolute top-0"
          style={{
            left: `${(i / (ticks.length - 1)) * 100}%`,
            transform:
              i === 0
                ? "none"
                : i === ticks.length - 1
                  ? "translateX(-100%)"
                  : "translateX(-50%)",
          }}
        >
          {format(v)}
        </span>
      ))}
    </div>
  );
}

export default ModelFactChart;
