/**
 * 로딩 골격 — 앱 전체의 단 하나.
 *
 * 지금 `Skeleton` 컴포넌트는 0개이고 `animate-pulse` 를 각자 다른 모양으로 쓰는
 * 파일이 13개다(`CostWidget` 의 `h-4 w-32`, `FlowsTab` 의 글자 깜빡임, `LanesTab`
 * 의 카드 테두리 …). 정본 §3-4 금지 ⑤: **로딩에서 레이아웃이 튀면 그건 로딩이
 * 아니라 깜빡임이다.** 그래서 이 컴포넌트는 `height` 를 **필수**로 받는다 —
 * "최종 높이와 같은 골격" 을 호출부가 답하지 않으면 컴파일되지 않는다.
 *
 * - 색: `surface-hover` 토큰(#313244) 하나. 파일마다 `bg-gray-700` / `bg-[#313244]`
 *   를 고르지 않는다.
 * - 움직임: `animate-pulse` + `motion-reduce:animate-none` — `prefers-reduced-motion`
 *   이면 정지한 채로 자리만 지킨다.
 * - 접근성: `role="status"` + `aria-busy` + sr-only 라벨. 스크린리더에는 "로딩 중" 한
 *   번만 읽히고 개별 골격 조각은 `aria-hidden`.
 */
import { useTranslation } from "../../lib/i18n";

type CssLength = number | string;

function toCss(v: CssLength | undefined): string | undefined {
  if (v === undefined) return undefined;
  return typeof v === "number" ? `${v}px` : v;
}

const SHAPE_CLASS = {
  /** 카드/패널 자리 — radius-panel. */
  panel: "rounded-lg",
  /** 컨트롤/글줄 자리 — radius-control. */
  control: "rounded-md",
  /** 글자 한 줄. */
  text: "rounded",
  /** 아바타·상태 점. */
  circle: "rounded-full",
} as const;

export type SkeletonShape = keyof typeof SHAPE_CLASS;

export interface SkeletonProps {
  /** ★최종 렌더의 높이. 필수 — 이 값이 레이아웃을 지킨다. */
  height: CssLength;
  /** 기본 100%. 숫자 칸이면 `ch` 단위로(예: `"6ch"`). */
  width?: CssLength;
  shape?: SkeletonShape;
  /** 같은 높이 안에 줄을 몇 개 그릴지(목록 골격). 1이면 덩어리 하나. */
  lines?: number;
  /** 수치 한 칸처럼 글줄 안에 끼울 때(`inline-flex`). */
  inline?: boolean;
  className?: string;
  /** 스크린리더 라벨. 기본 `common.loading`. */
  label?: string;
}

/**
 * 골격 한 덩어리(또는 같은 높이를 `lines` 줄로 나눈 목록).
 *
 * 높이 계약: 바깥 박스가 정확히 `height` 다(`lines` 가 몇이든). 줄 사이 간격은 박스
 * 안에서 나눠 갖는다 — 그래서 목록 골격이 최종 목록과 같은 높이를 유지한다.
 */
export function Skeleton({
  height,
  width,
  shape = "control",
  lines = 1,
  inline = false,
  className = "",
  label,
}: SkeletonProps) {
  const { t } = useTranslation();
  const h = toCss(height);
  const w = toCss(width) ?? "100%";
  const pieceClass = `${SHAPE_CLASS[shape]} bg-surface-hover animate-pulse motion-reduce:animate-none`;
  const count = Math.max(1, Math.floor(lines));

  return (
    <div
      role="status"
      aria-busy="true"
      data-skeleton=""
      className={`${inline ? "inline-flex align-middle" : "flex"} flex-col justify-between ${className}`}
      style={{ height: h, minHeight: h, width: w }}
    >
      <span className="sr-only">{label ?? t("common.loading")}</span>
      {count === 1 ? (
        <div aria-hidden="true" className={`h-full w-full ${pieceClass}`} />
      ) : (
        Array.from({ length: count }, (_, i) => (
          <div
            key={i}
            aria-hidden="true"
            className={pieceClass}
            // 줄 높이 = (전체 - 8px 간격들) / 줄 수 — 합이 정확히 `height` 다.
            style={{ height: `calc((${h} - ${(count - 1) * 8}px) / ${count})` }}
          />
        ))
      )}
    </div>
  );
}
