/**
 * 단일 시리즈 시계열 (영역 + 선). visx 위에 얹은 마블로 표준 차트.
 *
 * ★"차트는 그리기만 한다" — 이 파일에 집계가 없다는 것을 규칙으로 못박는다.
 *   여기서 계산하는 것은 **값 → 픽셀** 뿐이다(스케일). 합계·평균·비율·필터는
 *   전부 밖에서 끝내고 들어와야 한다. 라이브러리를 넣는 건 보기 좋게 만드는
 *   일이지 숫자를 바꾸는 일이 아니다.
 *
 * ★색이 이 파일에 없다. 전부 `var(--viz-*)` 다 (tokens.css). 그래서 같은
 *   컴포넌트가 어드민의 어두운 바탕과 조직 대시보드의 화이트 바탕에서 다 산다 —
 *   바뀌는 것은 `surface` 한 글자뿐이다.
 *
 * ★서버에서 그려진다. visx 는 DOM 을 재보지 않으므로 이 컴포넌트는 RSC 로도,
 *   클라이언트로도 렌더된다(첫 페인트에 이미 SVG 가 있다). `onPointClick` 을
 *   주지 않으면 핸들러가 하나도 없어서 서버 컴포넌트 트리에 그대로 들어간다.
 */
import { AreaClosed, LinePath } from "@visx/shape";
import { scaleLinear } from "@visx/scale";
import { ChartFrame } from "./ChartFrame";
import {
  markerIndexOf,
  seriesVar,
  type ChartDataState,
  type ChartMarkerSpec,
  type SeriesPoint,
  type SeriesSlot,
  type VizSurface,
} from "./types";

/* ── 지오메트리 (기존 손 SVG 와 같은 값. 옮겨도 그림이 안 흔들리게) ────────── */
const W = 640;
const H = 180;
const PAD_L = 8;
const PAD_R = 8;
const PAD_T = 20; // 값 라벨이 위로 안 잘리게
const PAD_B = 22;
const INNER_W = W - PAD_L - PAD_R;
const INNER_H = H - PAD_T - PAD_B;

/** ISO 날짜 → MM/DD. */
export function formatDay(d: string): string {
  const parts = d.split("-");
  if (parts.length >= 3) return `${parts[1]}/${parts[2]}`;
  const dt = new Date(d);
  if (!isNaN(dt.getTime())) return `${dt.getMonth() + 1}/${dt.getDate()}`;
  return d;
}

function formatIntKo(n: number): string {
  if (!isFinite(n)) return "0";
  return Math.round(n).toLocaleString("ko-KR");
}

/**
 * 값 라벨을 붙일 인덱스. 포인트가 적으면 전부, 많으면 최대/최소/끝점만 —
 * 라벨이 서로 밟으면 안 붙이느니만 못하다.
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
  /** 주면 각 포인트가 클릭 가능해진다(= 클라이언트 컴포넌트 트리에서만). */
  onPointClick?: (date: string) => void;
};

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
  onPointClick,
}: TimeSeriesChartProps) {
  const clean = data.filter((d) => d && isFinite(d.value));
  const allZero = clean.length > 0 && clean.every((d) => d.value === 0);

  // ★빈 것을 0 으로 그리지 않는다. 상태를 명시로 받았으면 그걸 존중하고,
  //   안 받았으면 "그릴 값이 아예 없다" 만 empty 로 접는다.
  const resolved: ChartDataState =
    state ?? (clean.length === 0 || allZero ? "empty" : "ready");

  const stroke = color ?? seriesVar(slot);
  const n = clean.length;
  const max = n > 0 ? Math.max(...clean.map((d) => d.value), 1) : 1;

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

  /* ── 값 → 픽셀. 여기가 visx 를 쓰는 유일한 이유이자 전부다. ─────────────── */
  const xScale = scaleLinear<number>({
    domain: [0, Math.max(n - 1, 1)],
    range: [PAD_L, PAD_L + INNER_W],
  });
  const yScale = scaleLinear<number>({
    domain: [0, max],
    range: [PAD_T + INNER_H, PAD_T],
  });
  // 점이 하나면 도메인이 무너지므로 가운데에 세운다(기존 손 SVG 와 동일).
  const px = (i: number) => (n === 1 ? PAD_L + INNER_W / 2 : xScale(i));
  const py = (v: number) => yScale(v);

  const labelIndices = pickValueLabelIndices(clean.map((d) => d.value));
  const axisIdx = n === 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1];
  const mIdx = markerIndexOf(
    clean.map((d) => d.date),
    marker
  );
  const gradientId = `viz-area-${slot}`;
  const bandW = INNER_W / n;

  return (
    <ChartFrame
      title={title}
      description={description}
      state={resolved}
      surface={surface}
      sampleSize={sampleSize}
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
            {clean.map((d) => (
              <tr key={d.date}>
                <th scope="row" className="text-left font-normal">
                  {d.date}
                </th>
                <td className="text-right tabular-nums">{format(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={description ? `${title} — ${description}` : title}
        preserveAspectRatio="xMidYMid meet"
        style={{ height: H }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* 가로 그리드 (0 / 50% / 100%) — 뒤로 물러나 있어야 한다. */}
        {[0, 0.5, 1].map((g) => (
          <line
            key={g}
            x1={PAD_L}
            x2={W - PAD_R}
            y1={PAD_T + INNER_H - g * INNER_H}
            y2={PAD_T + INNER_H - g * INNER_H}
            stroke="var(--viz-grid)"
            strokeWidth={1}
          />
        ))}

        {mIdx != null && marker && (
          <g>
            <line
              x1={px(mIdx)}
              x2={px(mIdx)}
              y1={PAD_T}
              y2={PAD_T + INNER_H}
              stroke="var(--viz-marker)"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
            <text
              x={px(mIdx) + 4}
              y={PAD_T + 9}
              fontSize={9}
              fontWeight={600}
              fill="var(--viz-marker)"
            >
              {marker.label}
            </text>
            <title>{marker.hint ?? marker.label}</title>
          </g>
        )}

        <AreaClosed<SeriesPoint>
          data={clean}
          x={(_d, i) => px(i)}
          y={(d) => py(d.value)}
          yScale={yScale}
          fill={`url(#${gradientId})`}
          stroke="none"
        />
        <LinePath<SeriesPoint>
          data={clean}
          x={(_d, i) => px(i)}
          y={(d) => py(d.value)}
          fill="none"
          stroke={stroke}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {clean.map((d, i) => (
          <g key={d.date}>
            {n <= 45 && <circle cx={px(i)} cy={py(d.value)} r={2.5} fill={stroke} />}
            {/* ★값을 직접 쓴다. 색·툴팁에만 기대지 않는다 — 밝은 바탕에서
                일부 슬롯이 3:1 미만이라 이건 취향이 아니라 relief 의무다. */}
            {labelIndices.has(i) && (
              <text
                x={px(i)}
                y={py(d.value) - 7}
                fontSize={10}
                fontWeight={600}
                fill="var(--viz-ink-secondary)"
                textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
              >
                {format(d.value)}
              </text>
            )}
            <rect
              x={px(i) - bandW / 2}
              y={PAD_T}
              width={bandW}
              height={INNER_H}
              fill="transparent"
              onClick={onPointClick ? () => onPointClick(d.date) : undefined}
              style={onPointClick ? { cursor: "pointer" } : undefined}
            >
              <title>{`${formatDay(d.date)} · ${format(d.value)}${
                onPointClick ? " (클릭: 상세 분해)" : ""
              }`}</title>
            </rect>
          </g>
        ))}

        {axisIdx.map((i) => (
          <text
            key={i}
            x={px(i)}
            y={H - 6}
            fontSize={11}
            fill="var(--viz-ink-muted)"
            textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
          >
            {formatDay(clean[i].date)}
          </text>
        ))}
      </svg>
    </ChartFrame>
  );
}
