/**
 * Pure rules for the coachmark tour — the sequential spotlight overlay a first
 * run gets on top of the beginner shell (ticket m7mpxqSw, 상위 qpOpVJCt/#854).
 *
 * The overlay itself is DOM-heavy (measuring anchors, painting a cutout), but
 * every decision it makes is a pure function of numbers and lives here:
 *
 *  1. {@link shouldStartTour} — WHETHER the tour runs at all. The activation
 *     cost of getting this wrong is asymmetric: a tour that never shows costs a
 *     newcomer one hint, a tour that shows every launch is nagware on top of the
 *     screen the user is trying to work in. So it errs toward silence.
 *  2. {@link resolveSteps} — WHICH steps survive. Anchors come and go with the
 *     shell's own state (the first-ask card folds itself away once delivered),
 *     and a step pointing at nothing would spotlight the void.
 *  3. {@link placeCoachmarkCard} / {@link spotlightRect} — WHERE the card and
 *     the cutout land, always inside the viewport. A tooltip that renders off
 *     screen is indistinguishable from a broken tour.
 *
 * No DOM, no storage, no clock — the store (`coachmarkStore`) wires
 * localStorage + Date.now() into these, exactly like `beginnerMode.ts` does.
 */

// ── 영속 레코드 ─────────────────────────────────────────────────────────────

/** localStorage key holding the serialized {@link CoachmarkStore}. */
export const COACHMARK_KEY = "marblo.coachmark";

/** 비기너 셸 첫 실행 투어의 id. 투어가 늘면 여기에 형제를 추가한다. */
export const BEGINNER_TOUR_ID = "beginner_first_run";

/**
 * 마블로 모드 첫 진입 투어 — 우측 WorkTabs 탭(보드·코드·에이전트·하네스·사용량·설정)을
 * 순서대로 짚는다. 비기너→마블로 모드 전환 직후, 또는 마블로 모드를 처음 여는 설치에서 1회.
 */
export const ADVANCED_TOUR_ID = "advanced_first_entry";

export interface CoachmarkTourRecord {
  /** 투어를 실제로 화면에 띄운 횟수. */
  startedCount: number;
  /** 끝까지 본 시각(ms epoch). 0 = 아직. */
  completedAt: number;
  /** '다시 보지 않기' 를 누른 시각(ms epoch). 0 = 아직. */
  dismissedAt: number;
}

/** tourId → 그 투어의 기록. */
export interface CoachmarkStore {
  tours: Record<string, CoachmarkTourRecord>;
}

export const EMPTY_TOUR_RECORD: CoachmarkTourRecord = {
  startedCount: 0,
  completedAt: 0,
  dismissedAt: 0,
};

/**
 * 완주도 '다시 보지 않기' 도 없이 그냥 닫은(건너뛴) 유저에게 다시 권할 최대 횟수.
 *
 * 건너뛰기와 '다시 보지 않기' 를 구분하는 이유: 첫 실행에서 투어를 닫는 건 대개
 * "지금은 바쁘다" 지 "영원히 싫다" 가 아니다. 그렇다고 무한히 다시 띄우면 조르는
 * 것이므로, 세 번째 실행까지만 권하고 그 뒤로는 스스로 조용해진다.
 */
export const MAX_TOUR_OFFERS = 3;

function finiteAt(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

function finiteCount(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0
    ? Math.floor(v)
    : 0;
}

/**
 * 저장된 기록을 읽는다. 깨져 있으면 **빈 기록**(=아직 안 봄)으로 degrade 한다.
 *
 * beginnerMode 의 파싱과 방향이 반대인 점에 주의: 거기선 깨진 값이 "보드를 뺏는"
 * 쪽이라 보수적으로 advanced 를 골랐지만, 여기선 최악이 "안내를 한 번 더 본다"
 * 이므로 빈 기록이 안전한 기본값이다.
 */
export function parseCoachmarkStore(
  raw: string | null | undefined,
): CoachmarkStore {
  if (!raw) return { tours: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { tours: {} };
  }
  if (!parsed || typeof parsed !== "object") return { tours: {} };
  const tours = (parsed as Record<string, unknown>).tours;
  if (!tours || typeof tours !== "object") return { tours: {} };

  const out: Record<string, CoachmarkTourRecord> = {};
  for (const [id, value] of Object.entries(tours as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const o = value as Record<string, unknown>;
    out[id] = {
      startedCount: finiteCount(o.startedCount),
      completedAt: finiteAt(o.completedAt),
      dismissedAt: finiteAt(o.dismissedAt),
    };
  }
  return { tours: out };
}

export function serializeCoachmarkStore(store: CoachmarkStore): string {
  return JSON.stringify(store);
}

export function tourRecord(
  store: CoachmarkStore,
  tourId: string,
): CoachmarkTourRecord {
  return store.tours[tourId] ?? EMPTY_TOUR_RECORD;
}

export interface TourStartConditions {
  /**
   * 스포트라이트를 걸 대상이 화면에 실제로 있는가. 연결/폴더 게이트에 서 있는
   * 동안 투어를 띄우면 아직 존재하지도 않는 챗을 가리키게 된다.
   */
  anchorsReady: boolean;
  /** 다른 모달(승격/데모 등)이 떠 있는가 — 겹쳐 띄우지 않는다. */
  blockedByOtherOverlay?: boolean;
}

/**
 * 투어를 지금 띄울 것인가.
 *
 * 완주했거나 '다시 보지 않기' 를 눌렀으면 끝이다. 그냥 닫았을 뿐이면
 * {@link MAX_TOUR_OFFERS} 번까지만 다시 권한다.
 */
export function shouldStartTour(
  record: CoachmarkTourRecord,
  conditions: TourStartConditions,
): boolean {
  if (!conditions.anchorsReady) return false;
  if (conditions.blockedByOtherOverlay) return false;
  if (record.completedAt > 0 || record.dismissedAt > 0) return false;
  return record.startedCount < MAX_TOUR_OFFERS;
}

// ── 스텝 ────────────────────────────────────────────────────────────────────

export type CoachmarkPlacement = "top" | "bottom" | "left" | "right" | "center";

export interface CoachmarkStep {
  id: string;
  /**
   * 스포트라이트 대상의 CSS 셀렉터. 없으면 화면 가운데 카드만 띄운다(인트로/아웃트로).
   */
  anchor?: string;
  title: string;
  body: string;
  /** 선호 방향. 안 들어가면 반대편 → 나머지 순으로 자동 재배치된다. */
  placement?: CoachmarkPlacement;
}

/**
 * 앵커가 실제로 존재하는 스텝만 남긴다.
 *
 * 앵커 없는 스텝(anchor 미지정)은 항상 남는다 — 가리킬 대상이 없는 게 정상이라서다.
 */
export function resolveSteps(
  steps: readonly CoachmarkStep[],
  exists: (selector: string) => boolean,
): CoachmarkStep[] {
  return steps.filter((s) => !s.anchor || exists(s.anchor));
}

// ── 기하 ────────────────────────────────────────────────────────────────────

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

function clamp(v: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(v, min), max);
}

/**
 * 스포트라이트 구멍 — 대상 사각형을 `pad` 만큼 부풀리고 뷰포트 안으로 자른다.
 * 화면 밖으로 삐져나간 대상은 잘린 만큼만 밝아진다(음수 크기는 만들지 않는다).
 */
export function spotlightRect(target: Rect, pad: number, viewport: Size): Rect {
  const top = clamp(target.top - pad, 0, viewport.height);
  const left = clamp(target.left - pad, 0, viewport.width);
  const bottom = clamp(target.top + target.height + pad, 0, viewport.height);
  const right = clamp(target.left + target.width + pad, 0, viewport.width);
  return {
    top,
    left,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

export interface PlacementResult {
  top: number;
  left: number;
  placement: CoachmarkPlacement;
}

const OPPOSITE: Record<
  Exclude<CoachmarkPlacement, "center">,
  Exclude<CoachmarkPlacement, "center">
> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

const ORDER: Exclude<CoachmarkPlacement, "center">[] = [
  "bottom",
  "top",
  "right",
  "left",
];

function coordsFor(
  placement: Exclude<CoachmarkPlacement, "center">,
  t: Rect,
  card: Size,
  gap: number,
): { top: number; left: number } {
  switch (placement) {
    case "bottom":
      return {
        top: t.top + t.height + gap,
        left: t.left + t.width / 2 - card.width / 2,
      };
    case "top":
      return {
        top: t.top - gap - card.height,
        left: t.left + t.width / 2 - card.width / 2,
      };
    case "right":
      return {
        top: t.top + t.height / 2 - card.height / 2,
        left: t.left + t.width + gap,
      };
    case "left":
      return {
        top: t.top + t.height / 2 - card.height / 2,
        left: t.left - gap - card.width,
      };
  }
}

/** 주축(카드가 대상에서 밀려나는 방향)만 본다. 교차축은 어차피 clamp 로 살린다. */
function fitsPrimaryAxis(
  placement: Exclude<CoachmarkPlacement, "center">,
  coords: { top: number; left: number },
  card: Size,
  viewport: Size,
  margin: number,
): boolean {
  if (placement === "bottom" || placement === "top") {
    return (
      coords.top >= margin &&
      coords.top + card.height <= viewport.height - margin
    );
  }
  return (
    coords.left >= margin && coords.left + card.width <= viewport.width - margin
  );
}

/**
 * 설명 카드의 좌표. 선호 방향 → 반대편 → 나머지 순으로 들어가는 자리를 찾고,
 * 어디에도 안 들어가면 선호 방향에서 뷰포트 안으로 밀어 넣는다.
 *
 * 대상이 null 이면 화면 가운데(=모달처럼). 안 들어갈 때 그냥 잘라 내지 않고 항상
 * clamp 하는 이유는, 반쯤 잘린 카드는 유저에겐 그냥 고장난 화면이기 때문이다.
 */
export function placeCoachmarkCard(
  target: Rect | null,
  card: Size,
  viewport: Size,
  preferred: CoachmarkPlacement = "bottom",
  opts: { gap?: number; margin?: number } = {},
): PlacementResult {
  const gap = opts.gap ?? 12;
  const margin = opts.margin ?? 12;

  const center = (): PlacementResult => ({
    top: clamp(
      viewport.height / 2 - card.height / 2,
      margin,
      viewport.height - card.height - margin,
    ),
    left: clamp(
      viewport.width / 2 - card.width / 2,
      margin,
      viewport.width - card.width - margin,
    ),
    placement: "center",
  });

  if (!target || preferred === "center") return center();

  const tried = new Set<CoachmarkPlacement>();
  const candidates: Exclude<CoachmarkPlacement, "center">[] = [];
  const push = (p: Exclude<CoachmarkPlacement, "center">) => {
    if (tried.has(p)) return;
    tried.add(p);
    candidates.push(p);
  };
  push(preferred);
  push(OPPOSITE[preferred]);
  ORDER.forEach(push);

  for (const placement of candidates) {
    const coords = coordsFor(placement, target, card, gap);
    if (!fitsPrimaryAxis(placement, coords, card, viewport, margin)) continue;
    return {
      top: clamp(coords.top, margin, viewport.height - card.height - margin),
      left: clamp(coords.left, margin, viewport.width - card.width - margin),
      placement,
    };
  }

  const fallback = coordsFor(preferred, target, card, gap);
  return {
    top: clamp(fallback.top, margin, viewport.height - card.height - margin),
    left: clamp(fallback.left, margin, viewport.width - card.width - margin),
    placement: preferred,
  };
}
