import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  BoardPanSession,
  isPanCandidatePointer,
  isPanIgnoredTarget,
} from "../lib/boardPan";

/**
 * 가로 스크롤 컨테이너에 "빈 배경을 끌어 좌우 이동" 을 붙인다.
 *
 * 반환한 props 를 `overflow-x-auto` 컨테이너에 펼친다. 판단 규칙은
 * `lib/boardPan.ts` 에 있다 — 요지는 **카드 드래그앤드롭을 절대 가로채지 않는다**:
 * 카드(role=button)·버튼·입력칸·링크 위에서 시작한 포인터는 여기서 손을 뗀다.
 *
 * 배선만 이 훅이 한다:
 *   - pointerdown(컨테이너) → 후보면 세션 시작 + window 에 move/up 리스너.
 *     window 에 거는 이유는 빠르게 끌면 포인터가 컨테이너를 벗어나기 때문.
 *   - pointermove(window) → 임계값 넘으면 scrollLeft 직접 대입. 애니메이션·관성
 *     없음(포인터와 1:1) 이라 prefers-reduced-motion 에서 줄일 움직임이 없다.
 *   - pointerup/cancel(window) → 세션 종료. 실제로 끌었으면 다음 click 한 번을
 *     capture 단계에서 삼킨다(배경에서 시작해 카드 위에서 뗀 경우 대비).
 *   - wheel 은 건드리지 않는다 → 터치패드 두 손가락 가로 스크롤 그대로.
 *   - 터치 포인터는 네이티브 스크롤에 맡긴다(lib 의 isPanCandidatePointer).
 */
export interface BoardPanHandlers {
  /** pan 중이면 true — 호출자가 cursor-grabbing/select-none 을 붙인다. */
  isPanning: boolean;
  containerProps: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onClickCapture: (event: ReactMouseEvent<HTMLElement>) => void;
    "data-board-panning": "true" | undefined;
  };
}

export function useBoardPan(enabled = true): BoardPanHandlers {
  const [isPanning, setIsPanning] = useState(false);
  const sessionRef = useRef<BoardPanSession | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);
  const suppressClickRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  const teardown = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    sessionRef.current = null;
    containerRef.current = null;
    setIsPanning(false);
  }, []);

  // 언마운트 중에 window 리스너가 남지 않게.
  useEffect(() => () => cleanupRef.current?.(), []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled) return;
      if (sessionRef.current) return; // 이미 진행 중인 세션이 있으면 무시
      const container = event.currentTarget;
      const native = event.nativeEvent as Partial<PointerEvent> & MouseEvent;
      if (
        !isPanCandidatePointer({
          button: native.button,
          pointerType: native.pointerType,
        })
      ) {
        return;
      }
      // ★카드·버튼·입력칸 위 → 기존 동작(dnd-kit 등)에 맡기고 여기서 끝.
      if (isPanIgnoredTarget(event.target, container)) return;

      // 가로로 넘칠 게 없으면 pan 할 것도 없다 — 세션을 열지 않아 클릭이 그대로 산다.
      if (container.scrollWidth <= container.clientWidth) return;

      const session = new BoardPanSession(native.clientX, container.scrollLeft);
      sessionRef.current = session;
      containerRef.current = container;

      const onMove = (e: PointerEvent | MouseEvent) => {
        const current = sessionRef.current;
        const el = containerRef.current;
        if (!current || !el) return;
        const next = current.move(e.clientX);
        if (next === null) return;
        if (!current.isPanning) return;
        // 임계값을 막 넘긴 첫 move 에서만 상태가 바뀐다 — 이후 setState 는 no-op.
        setIsPanning(true);
        el.scrollLeft = next;
        // 끄는 동안 텍스트 선택이 따라 잡히지 않게.
        if (e.cancelable) e.preventDefault();
      };
      const onUp = () => {
        const current = sessionRef.current;
        const panned = current ? current.end() : false;
        if (panned) suppressClickRef.current = true;
        teardown();
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      cleanupRef.current = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
    },
    [enabled, teardown],
  );

  const onClickCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return {
    isPanning,
    containerProps: {
      onPointerDown,
      onClickCapture,
      "data-board-panning": isPanning ? "true" : undefined,
    },
  };
}
