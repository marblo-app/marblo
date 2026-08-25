/**
 * 차트의 바깥 껍데기 — 바탕(테마) 스코프 + 접근성 + **안 그리는 상태들**.
 *
 * ★이 파일이 하는 일 중 제일 중요한 건 "그리지 않기" 다.
 *   빈 구간을 0 으로 그리면 화면의 신뢰도 표기가 통째로 거짓말이 된다. 그래서
 *   `empty`/`pending` 은 축도 0 선도 없이 사유만 낸다.
 *
 * ★이 프레임은 **라이브러리를 모른다.** 그래서 #1208(visx)에서 #1210·이 티켓
 *   (recharts)으로 라이브러리를 갈아탈 때 이 파일의 규율은 한 줄도 안 흔들렸다.
 *   그게 애초에 프레임을 만든 이유다.
 *
 * ★두 번째로 중요한 건 "**먼저 자리를 잡기**" 다(`loading`).
 *   recharts 는 서버 HTML 에 마크를 0개 보낸다(bakeoff §3.1 실측). 그 빈 칸을
 *   그대로 두면 하이드레이션 후에 차트가 튀어나오면서 아래 내용을 밀어낸다.
 *   그래서 같은 높이의 스켈레톤을 먼저 세운다 — 이게 recharts 를 고른 대가를
 *   갚는 자리다.
 *
 * ★recharts 는 `accessibilityLayer` 로 방향키 탐색을 기본 제공한다(visx 에는
 *   없었다). 그래도 role·이름·설명·표 보기는 여전히 여기 한 곳에 모아 둔다 —
 *   라이브러리가 주는 것 위에 얹되, 라이브러리가 안 주는 날에도 안 무너지게.
 */
import type { ReactNode } from "react";
import { ChartSkeleton } from "./ChartSkeleton";
import type { ChartDataState, VizSurface } from "./types";

export type ChartFrameProps = {
  /** 접근 가능한 이름. 스크린리더가 이 차트를 뭐라고 부를지. 필수다. */
  title: string;
  /** 추세를 한 문장으로. 색·모양을 못 보는 사람에게는 이게 차트 본문이다. */
  description?: string;
  state: ChartDataState;
  surface?: VizSurface;
  /** `empty` 일 때 낼 문구. "데이터가 없다"가 아니라 **왜 없는지**를 적어라. */
  emptyLabel?: string;
  /** `pending` 일 때 낼 문구. 기본값은 화면 규약과 같은 '적재 전'. */
  pendingLabel?: string;
  /** `insufficient` 일 때 표본 수. 몇 건인지 안 적으면 경고가 아니라 장식이다. */
  sampleSize?: number;
  /** 값을 표로도 볼 수 있게 하는 자리(밝은 바탕 대비 relief 의무를 갚는 통로). */
  tableView?: ReactNode;
  footer?: ReactNode;
  /**
   * 그림 **위**에 늘 붙어 있는 줄(범례·세그먼트 토글). 스켈레톤일 때도 그대로
   * 있는다 — 차트가 나타나면서 범례가 뒤늦게 끼어들면 그것도 레이아웃 이동이다.
   */
  toolbar?: ReactNode;
  /**
   * ★그림이 아직 못 그려졌나(하이드레이션 전 / 데이터 요청 중).
   * `true` 면 `children` 대신 **같은 높이**의 스켈레톤을 세운다.
   */
  loading?: boolean;
  /** 스켈레톤 높이. ★차트 높이와 같아야 한다 — 다르면 스켈레톤이 CLS 를 만든다. */
  plotHeight?: number;
  children: ReactNode;
};

function NonPlot({
  tone,
  heading,
  body,
}: {
  tone: "empty" | "pending";
  heading: string;
  body: string;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed py-8 text-center"
      style={{ borderColor: "var(--viz-grid)" }}
    >
      <span
        aria-hidden
        className="inline-block h-2 w-2 rounded-full"
        style={{
          background:
            tone === "pending"
              ? "var(--viz-status-warn)"
              : "var(--viz-ink-muted)",
        }}
      />
      <p
        className="text-xs font-semibold"
        style={{ color: "var(--viz-ink-secondary)" }}
      >
        {heading}
      </p>
      <p className="text-xs" style={{ color: "var(--viz-ink-muted)" }}>
        {body}
      </p>
    </div>
  );
}

export function ChartFrame({
  title,
  description,
  state,
  surface = "light",
  emptyLabel,
  pendingLabel,
  sampleSize,
  tableView,
  footer,
  toolbar,
  loading = false,
  plotHeight = 200,
  children,
}: ChartFrameProps) {
  return (
    <figure
      className="viz-root w-full"
      data-viz-surface={surface}
      data-chart-state={state}
    >
      <figcaption className="sr-only">
        {title}
        {description ? ` — ${description}` : ""}
      </figcaption>

      {state === "pending" ? (
        <NonPlot
          tone="pending"
          heading="적재 전"
          body={
            pendingLabel ??
            "이 값을 만드는 파생표가 아직 없습니다. 에러가 아니라 아직 안 실린 것입니다."
          }
        />
      ) : state === "empty" ? (
        <NonPlot
          tone="empty"
          heading="이 구간에 값이 없습니다"
          body={
            emptyLabel ??
            "측정은 되고 있는데 조회 구간에 기록이 없습니다. 0 이 아니라 '없음' 입니다."
          }
        />
      ) : (
        <>
          {state === "insufficient" && (
            <p
              className="mb-1 text-xs font-semibold"
              style={{ color: "var(--viz-status-warn)" }}
            >
              ⚠ 표본 {sampleSize ?? "?"}건 — 추세로 읽지 마세요
            </p>
          )}
          {toolbar}
          {loading ? <ChartSkeleton height={plotHeight} /> : children}
        </>
      )}

      {footer && (
        <div
          className="mt-1 flex justify-between text-xs"
          style={{ color: "var(--viz-ink-muted)" }}
        >
          {footer}
        </div>
      )}

      {/* ★표 보기는 스켈레톤일 때도 낸다 — 값은 서버에서 이미 왔고, 그림만
          아직인 것이다. 밝은 바탕의 relief 의무를 한 프레임도 안 비운다. */}
      {tableView && state !== "pending" && state !== "empty" && (
        <details className="mt-2">
          <summary
            className="cursor-pointer text-xs"
            style={{ color: "var(--viz-ink-muted)" }}
          >
            값을 표로 보기
          </summary>
          {tableView}
        </details>
      )}
    </figure>
  );
}
