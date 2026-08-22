/**
 * 보드 가로 드래그 이동(drag-to-pan)의 판단 로직 — DOM 이벤트 배선은
 * `hooks/useBoardPan.ts` 가 하고, 여기는 "이 포인터를 pan 으로 볼 것인가" 와
 * "얼마나 움직였나" 만 다룬다. 둘을 가른 이유는 이 판단이 **카드 드래그앤드롭과
 * 충돌하지 않는다** 는 걸 DOM 없이도 고정해 두기 위해서다.
 *
 * ★규칙(티켓 MThqQ62n):
 *   - 카드·버튼·입력칸·링크 위에서 시작한 포인터는 절대 가로채지 않는다. dnd-kit
 *     의 useDraggable 은 카드 루트에 role="button" 을 붙이므로 `[role=button]`
 *     하나로 카드가 걸리고, 나머지 상호작용 요소는 태그로 잡는다. 예외가 더
 *     필요하면 요소에 `data-board-pan-ignore` 를 단다.
 *   - 빈 배경(컨테이너·컬럼 여백·정체 레인 여백)에서 시작한 것만 pan 후보.
 *   - 임계값 미만 이동은 pan 이 아니라 클릭이다.
 *   - 터치는 네이티브 가로 스크롤이 있으므로 손대지 않는다(마우스·펜만).
 */

/** 이 픽셀을 넘게 가로로 움직여야 pan 이다. dnd-kit PointerSensor 의 5 와 같다. */
export const PAN_THRESHOLD_PX = 5;

const IGNORE_SELECTOR = [
  "[data-board-pan-ignore]",
  "button",
  "a[href]",
  "input",
  "textarea",
  "select",
  "label",
  "[role='button']",
  "[contenteditable='true']",
  "[contenteditable='']",
].join(",");

/**
 * 이 타깃에서 시작한 포인터는 pan 으로 잡으면 안 되는가.
 * `root` 바깥으로 올라가지 않는다 — 컨테이너 조상에 붙은 button 때문에 보드 전체가
 * pan 불가가 되는 일이 없게.
 */
export function isPanIgnoredTarget(
  target: EventTarget | null,
  root: Element,
): boolean {
  if (!(target instanceof Element)) return false;
  let node: Element | null = target;
  while (node && node !== root) {
    if (node.matches(IGNORE_SELECTOR)) return true;
    node = node.parentElement;
  }
  return false;
}

export interface PanPointerLike {
  /** 0 = 주 버튼. 오른쪽/가운데 버튼은 pan 이 아니다. */
  button: number;
  /** "mouse" | "pen" | "touch" | undefined(jsdom 등 미지원 환경 → 마우스로 본다). */
  pointerType?: string;
}

/** 포인터 종류·버튼만으로 pan 후보인가. 타깃 판정은 `isPanIgnoredTarget` 이 한다. */
export function isPanCandidatePointer(pointer: PanPointerLike): boolean {
  if (pointer.button !== 0) return false;
  if (pointer.pointerType === "touch") return false;
  return true;
}

/**
 * 한 번의 pan 세션. pointerdown 에서 만들고 move 마다 `move()`, up 에서 `end()`.
 * 순수 상태기계라 테스트는 숫자만 넣으면 된다.
 */
export class BoardPanSession {
  private panning = false;

  constructor(
    private readonly startX: number,
    private readonly startScrollLeft: number,
    private readonly threshold: number = PAN_THRESHOLD_PX,
  ) {}

  /** 임계값을 넘은 뒤부터 true. 넘기 전엔 클릭 후보라 아무것도 건드리지 않는다. */
  get isPanning(): boolean {
    return this.panning;
  }

  /**
   * 포인터가 x 로 움직였다. pan 중이면 컨테이너가 가야 할 scrollLeft 를 돌려주고,
   * 아직 임계값 미만이면 null(= 손대지 말 것).
   */
  move(x: number): number | null {
    const dx = x - this.startX;
    if (!this.panning) {
      if (Math.abs(dx) < this.threshold) return null;
      this.panning = true;
    }
    // 포인터가 오른쪽으로 가면 내용이 따라오고(scrollLeft 감소) — 손으로 종이를
    // 끄는 방향. 음수는 브라우저가 0 으로 자른다.
    return Math.max(0, this.startScrollLeft - dx);
  }

  /** 세션 종료. pan 이 실제로 일어났으면 true — 호출자는 뒤따르는 click 을 한 번 삼킨다. */
  end(): boolean {
    const panned = this.panning;
    this.panning = false;
    return panned;
  }
}
