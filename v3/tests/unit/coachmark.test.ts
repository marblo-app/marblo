import { describe, expect, it } from "vitest";
import {
  MAX_TOUR_OFFERS,
  EMPTY_TOUR_RECORD,
  parseCoachmarkStore,
  placeCoachmarkCard,
  resolveSteps,
  serializeCoachmarkStore,
  shouldStartTour,
  spotlightRect,
  tourRecord,
  type CoachmarkStep,
} from "../../src/lib/coachmark";

/**
 * 코치마크 투어의 순수 규칙만 본다(오버레이 렌더는 node 환경 테스트 대상이 아니다):
 *  - ★재노출 규칙 — 완주/다시보지않기는 끝, 그냥 닫으면 3회까지. 여기가 깨지면
 *    첫 화면이 매 실행 안내로 덮이거나(nagware), 아예 안 뜬다.
 *  - 앵커 없는 스텝 걸러내기 — 셸이 카드를 접으면 빈 사각형을 밝히게 된다.
 *  - 배치·구멍 계산 — 화면 밖으로 나간 카드는 유저에겐 그냥 고장난 화면이다.
 */

const VIEWPORT = { width: 1200, height: 800 };
const CARD = { width: 320, height: 160 };

describe("coachmark — 재노출 규칙", () => {
  const ready = { anchorsReady: true };

  it("아직 한 번도 안 봤으면 띄운다", () => {
    expect(shouldStartTour(EMPTY_TOUR_RECORD, ready)).toBe(true);
  });

  it("앵커가 아직 없으면(연결·폴더 게이트) 띄우지 않는다", () => {
    expect(shouldStartTour(EMPTY_TOUR_RECORD, { anchorsReady: false })).toBe(
      false,
    );
  });

  it("다른 오버레이(승격 모달·데모)가 떠 있으면 겹쳐 띄우지 않는다", () => {
    expect(
      shouldStartTour(EMPTY_TOUR_RECORD, {
        anchorsReady: true,
        blockedByOtherOverlay: true,
      }),
    ).toBe(false);
  });

  it("★완주했으면 다시는 안 띄운다", () => {
    expect(
      shouldStartTour(
        { ...EMPTY_TOUR_RECORD, startedCount: 1, completedAt: 1_000 },
        ready,
      ),
    ).toBe(false);
  });

  it("★'다시 보지 않기' 는 그 즉시 끝이다", () => {
    expect(
      shouldStartTour(
        { ...EMPTY_TOUR_RECORD, startedCount: 1, dismissedAt: 1_000 },
        ready,
      ),
    ).toBe(false);
  });

  it("그냥 건너뛰었으면 MAX_TOUR_OFFERS 번까지만 다시 권한다", () => {
    for (let n = 1; n < MAX_TOUR_OFFERS; n++) {
      expect(
        shouldStartTour({ ...EMPTY_TOUR_RECORD, startedCount: n }, ready),
      ).toBe(true);
    }
    // 세 번 띄웠으면 스스로 조용해진다 — 조르지 않는다.
    expect(
      shouldStartTour(
        { ...EMPTY_TOUR_RECORD, startedCount: MAX_TOUR_OFFERS },
        ready,
      ),
    ).toBe(false);
  });
});

describe("coachmark — 기록 파싱", () => {
  it("왕복(serialize → parse)이 값을 보존한다", () => {
    const store = {
      tours: { t1: { startedCount: 2, completedAt: 5, dismissedAt: 0 } },
    };
    expect(parseCoachmarkStore(serializeCoachmarkStore(store))).toEqual(store);
  });

  it("★깨진 값은 빈 기록으로 degrade 한다(최악이 '안내를 한 번 더 봄')", () => {
    expect(parseCoachmarkStore("not json")).toEqual({ tours: {} });
    expect(parseCoachmarkStore(null)).toEqual({ tours: {} });
    expect(parseCoachmarkStore("[]")).toEqual({ tours: {} });
    expect(parseCoachmarkStore('{"tours":123}')).toEqual({ tours: {} });
  });

  it("음수·NaN·문자열 타임스탬프는 0 으로 정규화된다", () => {
    const parsed = parseCoachmarkStore(
      '{"tours":{"t1":{"startedCount":-3,"completedAt":"어제","dismissedAt":null}}}',
    );
    expect(parsed.tours.t1).toEqual({
      startedCount: 0,
      completedAt: 0,
      dismissedAt: 0,
    });
  });

  it("모르는 투어 id 는 빈 기록을 돌려준다", () => {
    expect(tourRecord({ tours: {} }, "nope")).toEqual(EMPTY_TOUR_RECORD);
  });
});

describe("coachmark — 스텝 필터", () => {
  const steps: CoachmarkStep[] = [
    { id: "a", anchor: "#a", title: "", body: "" },
    { id: "b", anchor: "#b", title: "", body: "" },
    { id: "c", title: "", body: "" },
  ];

  it("앵커가 없는(사라진) 스텝은 뺀다", () => {
    const live = resolveSteps(steps, (sel) => sel === "#a");
    expect(live.map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("anchor 미지정 스텝은 항상 남는다(가리킬 대상이 없는 게 정상)", () => {
    const live = resolveSteps(steps, () => false);
    expect(live.map((s) => s.id)).toEqual(["c"]);
  });
});

describe("coachmark — 스포트라이트 구멍", () => {
  it("대상을 pad 만큼 부풀린다", () => {
    const hole = spotlightRect(
      { top: 100, left: 200, width: 300, height: 50 },
      6,
      VIEWPORT,
    );
    expect(hole).toEqual({ top: 94, left: 194, width: 312, height: 62 });
  });

  it("화면 밖으로 나간 대상은 잘라 내되 음수 크기를 만들지 않는다", () => {
    const hole = spotlightRect(
      { top: -80, left: -80, width: 40, height: 40 },
      6,
      VIEWPORT,
    );
    expect(hole.top).toBe(0);
    expect(hole.left).toBe(0);
    expect(hole.width).toBeGreaterThanOrEqual(0);
    expect(hole.height).toBeGreaterThanOrEqual(0);
  });
});

describe("coachmark — 카드 배치", () => {
  const target = { top: 300, left: 400, width: 200, height: 100 };

  it("선호 방향에 들어가면 그대로 쓴다(bottom = 대상 아래, 가로 중앙정렬)", () => {
    const placed = placeCoachmarkCard(target, CARD, VIEWPORT, "bottom", {
      gap: 12,
    });
    expect(placed.placement).toBe("bottom");
    expect(placed.top).toBe(412);
    // 400 + 100 - 160 = 340
    expect(placed.left).toBe(340);
  });

  it("★아래가 좁으면 반대편(top)으로 뒤집는다", () => {
    const low = { top: 700, left: 400, width: 200, height: 60 };
    const placed = placeCoachmarkCard(low, CARD, VIEWPORT, "bottom");
    expect(placed.placement).toBe("top");
    expect(placed.top).toBeLessThan(low.top);
  });

  it("위아래 둘 다 좁으면 좌우로 간다", () => {
    const tall = { top: 10, left: 400, width: 200, height: 780 };
    const placed = placeCoachmarkCard(tall, CARD, VIEWPORT, "bottom");
    expect(["left", "right"]).toContain(placed.placement);
  });

  it("★어느 방향으로도 못 넣으면 뷰포트 안으로 clamp 한다(잘린 카드 금지)", () => {
    const tiny = { width: 360, height: 200 };
    const covering = { top: 0, left: 0, width: 360, height: 200 };
    const placed = placeCoachmarkCard(covering, CARD, tiny, "bottom");
    expect(placed.top).toBeGreaterThanOrEqual(0);
    expect(placed.left).toBeGreaterThanOrEqual(0);
    expect(placed.top + CARD.height).toBeLessThanOrEqual(tiny.height + 12);
    expect(placed.left + CARD.width).toBeLessThanOrEqual(tiny.width);
  });

  it("가로 중앙정렬이 화면 밖으로 나가면 가장자리로 붙인다", () => {
    const edge = { top: 100, left: 1150, width: 40, height: 40 };
    const placed = placeCoachmarkCard(edge, CARD, VIEWPORT, "bottom", {
      margin: 12,
    });
    expect(placed.left + CARD.width).toBeLessThanOrEqual(VIEWPORT.width - 12);
  });

  it("대상이 없으면 화면 가운데(모달처럼)", () => {
    const placed = placeCoachmarkCard(null, CARD, VIEWPORT);
    expect(placed.placement).toBe("center");
    expect(placed.left).toBe(VIEWPORT.width / 2 - CARD.width / 2);
    expect(placed.top).toBe(VIEWPORT.height / 2 - CARD.height / 2);
  });
});
