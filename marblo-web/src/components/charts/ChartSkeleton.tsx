"use client";
/**
 * 하이드레이션 전 빈 칸을 덮는 자리 — **recharts 를 고른 대가를 갚는 곳이다.**
 *
 * ★사실관계부터(bakeoff 실측, docs/CHART-BAKEOFF-2026-08-24.md §3):
 *   recharts 는 **서버 HTML 에 `<path>` 를 0개** 보낸다. `ResponsiveContainer`
 *   는 0×0 자리표시자만 낸다. 즉 JS 가 붙기 전까지 그 자리는 빈칸이다.
 *   (visx 는 6개를 보냈다. 사장님은 이걸 아시고 recharts 를 고르셨다.)
 *
 * ★그래서 이 파일이 하는 일은 두 가지다.
 *   1. **높이를 먼저 잡는다.** 차트가 나중에 나타나면서 아래 내용을 밀지 않게
 *      한다 — 레이아웃 이동(CLS)은 사용자가 누르려던 버튼이 도망가는 일이다.
 *   2. **빈 칸을 안 보여준다.** 회색 뼈대가 차트 모양으로 먼저 서 있는다.
 *
 * ★★스켈레톤은 **계열색을 쓰지 않는다.** 중립 회색(`--viz-skeleton`)만 쓴다.
 *   여기서 파란 선을 그리면 그건 스켈레톤이 아니라 **가짜 데이터**다. 잠깐이라도
 *   값처럼 보이는 것을 그리면 "모르는 값을 0 으로 안 그린다"는 이 차트 시스템의
 *   규율을 스켈레톤이 뒤에서 깨는 셈이 된다.
 */
import { useSyncExternalStore } from "react";

/** 구독할 것이 없는 스토어. 하이드레이션은 한 번 일어나고 끝이라 변화가 없다. */
const noSubscribe = () => () => {};

/**
 * 하이드레이션이 끝났나.
 *
 * 서버 스냅샷은 `false`, 클라이언트 스냅샷은 `true` 다. React 가 서버 렌더와
 * 하이드레이션에서는 서버 값을 쓰고 그 뒤부터 클라이언트 값을 쓰므로,
 * **마크업 불일치 없이** "붙었다" 를 알 수 있다.
 *
 * ★`useEffect(() => setState(true))` 로 안 하는 이유: 그건 effect 안에서
 *   setState 를 부르는 것이라 렌더가 한 번 더 도는 패턴이고, 이 저장소의
 *   eslint 규칙(react-hooks/set-state-in-effect)이 막는다. `useSyncExternalStore`
 *   가 정확히 이 용도의 도구다.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false
  );
}

const REDUCE_MOTION = "(prefers-reduced-motion: reduce)";

function motionQuery(): MediaQueryList | null {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(REDUCE_MOTION)
    : null;
}

function subscribeMotion(onChange: () => void): () => void {
  const mq = motionQuery();
  if (!mq?.addEventListener) return () => {};
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * 모션을 줄여 달라고 한 사용자인가. ★진입 애니메이션은 장식이므로 이 요청이
 * 있으면 **끈다.** 애니메이션이 어지럼증의 원인이 되는 사람이 실제로 있다.
 * (`matchMedia` 가 없는 환경 — 서버·구형 — 에서는 "안 줄임"으로 본다.)
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeMotion,
    () => motionQuery()?.matches ?? false,
    () => false
  );
}

export type ChartSkeletonProps = {
  /** ★차트와 **같은 높이**여야 한다. 다르면 스켈레톤이 CLS 를 만든다. */
  height: number;
  /** 축 눈금 자리표시자 개수. 실제 차트의 x축 라벨 수와 맞춘다. */
  ticks?: number;
};

/** 실제 차트 모양의 뼈대 — 격자·영역 실루엣·축 눈금. */
export function ChartSkeleton({ height, ticks = 3 }: ChartSkeletonProps) {
  const W = 640;
  const H = Math.max(height, 60);
  const padT = 12;
  const padB = 20;
  const innerH = H - padT - padB;

  // 값이 아니라 **모양**이다. 고정 상수라 새로고침해도 안 움직인다 —
  // 움직이면 데이터처럼 읽힌다.
  const shape = [0.35, 0.52, 0.44, 0.68, 0.58, 0.79, 0.62, 0.86];
  const stepX = W / (shape.length - 1);
  const y = (r: number) => padT + innerH - r * innerH;
  const line = shape
    .map((r, i) => `${i === 0 ? "M" : "L"}${i * stepX},${y(r)}`)
    .join(" ");
  const area = `${line} L${W},${padT + innerH} L0,${padT + innerH} Z`;

  return (
    <div
      className="viz-skeleton w-full"
      style={{ height }}
      // 로딩 중인 영역이라고 보조기술에 말한다. 안에 있는 회색 모양은
      // 값이 아니므로 읽히면 안 된다.
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">차트를 불러오는 중입니다.</span>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-full w-full"
        aria-hidden
      >
        {[0, 0.5, 1].map((g) => (
          <line
            key={g}
            x1={0}
            x2={W}
            y1={padT + innerH - g * innerH}
            y2={padT + innerH - g * innerH}
            stroke="var(--viz-grid)"
            strokeWidth={1}
          />
        ))}
        <path d={area} fill="var(--viz-skeleton)" opacity={0.55} />
        <path
          d={line}
          fill="none"
          stroke="var(--viz-skeleton)"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        {Array.from({ length: ticks }, (_, i) => (
          <rect
            key={i}
            x={(i * (W - 36)) / Math.max(ticks - 1, 1)}
            y={H - 12}
            width={36}
            height={7}
            rx={3}
            fill="var(--viz-skeleton)"
          />
        ))}
      </svg>
    </div>
  );
}
