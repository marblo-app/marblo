/**
 * 차트의 바깥 껍데기 — 바탕(테마) 스코프 + 접근성 + **안 그리는 상태들**.
 *
 * ★이 파일이 하는 일 중 제일 중요한 건 "그리지 않기" 다.
 *   빈 구간을 0 으로 그리면 화면의 신뢰도 표기가 통째로 거짓말이 된다. 그래서
 *   `empty`/`pending` 은 축도 0 선도 없이 사유만 낸다.
 *
 * ★visx 는 마크만 준다 — role/제목/설명/표 보기는 전부 우리 몫이다. 그래서
 *   접근성을 컴포넌트마다 다시 짜지 않도록 **여기 한 곳에** 모았다.
 *   (recharts 의 accessibilityLayer 같은 기본 제공이 없다는 게 visx 를 고를 때
 *    유일하게 값을 치른 지점이고, 그 값을 여기서 갚는다.)
 */
import type { ReactNode } from "react";
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
          {children}
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
