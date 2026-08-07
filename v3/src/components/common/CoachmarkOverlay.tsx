import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  placeCoachmarkCard,
  resolveSteps,
  spotlightRect,
  type CoachmarkStep,
  type Rect,
} from "../../lib/coachmark";

/**
 * 재사용 코치마크 오버레이 — 대상 하나를 밝히고 그 옆에 설명 카드를 띄우는 것을
 * 스텝 수만큼 반복한다. 비기너 첫 실행 투어가 첫 소비자지만, 어드밴스드 쪽 기능
 * 투어도 `steps` 만 갈아 끼우면 그대로 쓴다.
 *
 * ★외부 투어 라이브러리를 쓰지 않는다(티켓 제약): 대부분이 런타임에 style/script
 * 를 주입해 우리 CSP 와 싸우고, 번들도 우리가 쓰는 기능 대비 과하다. 필요한 건
 * "사각형 하나 밝히고 카드 하나 띄우기" 뿐이라 자체 구현이 더 작다.
 *
 * 구현 메모:
 *  - 구멍은 SVG mask 가 아니라 **거대 box-shadow** 로 판다(`0 0 0 9999px`). 리페인트
 *    한 번이면 되고, 대상 위에 아무것도 덮지 않아 하이라이트된 요소를 그대로
 *    클릭할 수 있다(`pointer-events: none`).
 *  - 좌표는 매 스텝 `getBoundingClientRect()` 로 다시 잰다. 셸이 스트립을 접거나
 *    창이 리사이즈되면 낡은 좌표는 그냥 엉뚱한 곳을 밝힌다.
 *  - 배치·구멍 계산은 전부 `lib/coachmark` 의 순수함수 — 여기서 산수하지 않는다.
 */

/** 스포트라이트가 대상 바깥으로 부풀 여백(px). */
const SPOTLIGHT_PAD = 6;
/** 설명 카드 폭(px). 고정 폭이라야 배치를 첫 프레임에 확정할 수 있다. */
const CARD_WIDTH = 320;
/** 카드 높이 추정치 — 실측 전 첫 프레임용. 마운트 직후 실측으로 대체된다. */
const CARD_HEIGHT_FALLBACK = 160;

export interface CoachmarkOverlayProps {
  steps: readonly CoachmarkStep[];
  /** 마지막 스텝까지 본 뒤 '시작하기'. */
  onFinish: (total: number) => void;
  /** 건너뛰기 — `permanent` 면 '다시 보지 않기'. */
  onSkip: (permanent: boolean, stepIndex: number, total: number) => void;
  /** 스텝이 바뀔 때마다(계측용). `total` 은 앵커 필터를 통과한 실제 스텝 수다. */
  onStep?: (stepIndex: number, stepId: string, total: number) => void;
  labels: {
    next: string;
    back: string;
    done: string;
    skip: string;
    never: string;
    /**
     * 진행 표시. 앵커가 없는 스텝은 걸러지므로 `total` 은 넘긴 steps 길이보다
     * 작을 수 있다 — 문자열이 아니라 함수로 받는 이유다.
     */
    progress: (current: number, total: number) => string;
  };
  testId?: string;
}

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export function CoachmarkOverlay({
  steps,
  onFinish,
  onSkip,
  onStep,
  labels,
  testId = "coachmark-overlay",
}: CoachmarkOverlayProps) {
  // 앵커가 실제로 있는 스텝만 남긴다. 셸이 카드 하나를 접어 버려도 투어는
  // 남은 스텝으로 계속 간다(빈 사각형을 밝히지 않는다).
  const [live] = useState(() =>
    resolveSteps(steps, (sel) => !!document.querySelector(sel)),
  );

  const [index, setIndex] = useState(0);
  const [target, setTarget] = useState<Rect | null>(null);
  const [card, setCard] = useState({ top: 0, left: 0 });
  const cardRef = useRef<HTMLDivElement>(null);

  const step = live[index];
  const total = live.length;

  // 좌표 실측 — 스텝 전환·리사이즈·스크롤마다. 카드 크기는 실측(없으면 추정)이라
  // 첫 프레임부터 화면 밖으로 나가지 않는다.
  const measure = useCallback(() => {
    if (!step) return;
    const el = step.anchor
      ? (document.querySelector(step.anchor) as HTMLElement | null)
      : null;
    const t = el ? rectOf(el) : null;
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
    };
    const size = {
      width: CARD_WIDTH,
      height: cardRef.current?.offsetHeight || CARD_HEIGHT_FALLBACK,
    };
    const placed = placeCoachmarkCard(
      t,
      size,
      viewport,
      step.placement ?? "bottom",
    );
    setTarget(t);
    setCard({ top: placed.top, left: placed.left });
  }, [step]);

  useLayoutEffect(() => {
    measure();
    // 카드가 실제 높이를 얻은 뒤 한 번 더 — 추정 높이로 잡힌 자리를 보정한다.
    const raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [measure]);

  useEffect(() => {
    window.addEventListener("resize", measure);
    // capture: 스크롤은 버블링하지 않는 내부 컨테이너에서도 일어난다.
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [measure]);

  useEffect(() => {
    if (step) onStep?.(index, step.id, total);
  }, [index, step, total, onStep]);

  const next = useCallback(() => {
    setIndex((i) => {
      if (i + 1 >= total) {
        onFinish(total);
        return i;
      }
      return i + 1;
    });
  }, [total, onFinish]);

  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  // 키보드: Esc = 건너뛰기, →/Enter = 다음, ← = 이전. 투어 중엔 키가 아래 화면으로
  // 새지 않게 막는다(오케챗 입력에 화살표가 흘러 들어가면 그게 더 이상하다).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onSkip(false, index, total);
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [next, back, onSkip, index, total]);

  useEffect(() => {
    cardRef.current?.focus();
  }, [index]);

  if (!step) return null;

  const hole = target
    ? spotlightRect(target, SPOTLIGHT_PAD, {
        width: window.innerWidth,
        height: window.innerHeight,
      })
    : null;
  const isLast = index + 1 >= total;

  return (
    <div
      data-testid={testId}
      data-step={step.id}
      data-step-index={index}
      className="pointer-events-none fixed inset-0 z-[70]"
    >
      {hole ? (
        <div
          aria-hidden
          data-testid={`${testId}-spotlight`}
          className="absolute rounded-lg ring-2 ring-[#89b4fa] transition-all duration-200"
          style={{
            top: hole.top,
            left: hole.left,
            width: hole.width,
            height: hole.height,
            boxShadow: "0 0 0 9999px rgba(17, 17, 27, 0.72)",
          }}
        />
      ) : (
        // 앵커 없는 스텝 — 전면을 고르게 덮는다.
        <div aria-hidden className="absolute inset-0 bg-[#11111b]/72" />
      )}

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${testId}-title`}
        tabIndex={-1}
        data-testid={`${testId}-card`}
        className="pointer-events-auto absolute rounded-xl border border-[#45475a] bg-[#181825] p-4 shadow-2xl outline-none"
        style={{ top: card.top, left: card.left, width: CARD_WIDTH }}
      >
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#89b4fa]">
          {labels.progress(index + 1, total)}
        </p>
        <h2
          id={`${testId}-title`}
          className="mt-1.5 text-sm font-semibold text-[#cdd6f4]"
        >
          {step.title}
        </h2>
        <p className="mt-1.5 text-[13px] leading-6 text-[#a6adc8]">
          {step.body}
        </p>

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            data-testid={`${testId}-skip`}
            onClick={() => onSkip(false, index, total)}
            className="rounded-md px-2 py-1.5 text-xs text-[#7f849c] transition-colors hover:bg-[#313244] hover:text-[#cdd6f4]"
          >
            {labels.skip}
          </button>
          <div className="flex-1" />
          {index > 0 && (
            <button
              type="button"
              data-testid={`${testId}-back`}
              onClick={back}
              className="rounded-md border border-[#45475a] px-2.5 py-1.5 text-xs text-[#cdd6f4] transition-colors hover:bg-[#313244]"
            >
              {labels.back}
            </button>
          )}
          <button
            type="button"
            data-testid={`${testId}-next`}
            onClick={next}
            className="rounded-md bg-[#89b4fa] px-3 py-1.5 text-xs font-semibold text-[#1e1e2e] transition-colors hover:bg-[#74c7ec]"
          >
            {isLast ? labels.done : labels.next}
          </button>
        </div>

        <button
          type="button"
          data-testid={`${testId}-never`}
          onClick={() => onSkip(true, index, total)}
          className="mt-2 w-full rounded-md px-2 py-1 text-[11px] text-[#585b70] transition-colors hover:text-[#a6adc8]"
        >
          {labels.never}
        </button>
      </div>
    </div>
  );
}

export default CoachmarkOverlay;
