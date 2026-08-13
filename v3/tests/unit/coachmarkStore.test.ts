import { beforeEach, describe, expect, it } from "vitest";
import {
  ADVANCED_TOUR_ID,
  BEGINNER_TOUR_ID,
  shouldStartTour,
} from "../../src/lib/coachmark";
import { selectTour, useCoachmarkStore } from "../../src/stores/coachmarkStore";

/**
 * 스토어의 계약만 본다(재노출 표 자체는 coachmark.test.ts 가 덮는다):
 *  - 시작 카운트가 실제로 누적되는가 — 이게 안 늘면 "그냥 닫기" 가 영원히 다시 뜬다
 *  - 완주/다시보지않기가 기록되는가
 *  - 리셋이 처음 상태로 되돌리는가(설정의 '안내 다시 보기')
 *
 * 노드 환경엔 localStorage 가 없어 영속은 조용히 no-op 된다 — 인메모리로 동작해야
 * 한다는 것 자체가 프라이빗 모드 계약이다.
 */
describe("coachmarkStore", () => {
  beforeEach(() => useCoachmarkStore.setState({ tours: {} }));

  it("markStarted 는 권한 횟수를 누적한다", () => {
    const { markStarted } = useCoachmarkStore.getState();
    markStarted(BEGINNER_TOUR_ID);
    markStarted(BEGINNER_TOUR_ID);
    expect(
      selectTour(useCoachmarkStore.getState(), BEGINNER_TOUR_ID).startedCount,
    ).toBe(2);
  });

  it("★markCompleted 뒤엔 규칙이 더 이상 띄우지 않는다", () => {
    const s = useCoachmarkStore.getState();
    s.markStarted(BEGINNER_TOUR_ID);
    s.markCompleted(BEGINNER_TOUR_ID);
    const rec = selectTour(useCoachmarkStore.getState(), BEGINNER_TOUR_ID);
    expect(rec.completedAt).toBeGreaterThan(0);
    expect(shouldStartTour(rec, { anchorsReady: true })).toBe(false);
  });

  it("★markDismissed('다시 보지 않기') 도 마찬가지로 끝이다", () => {
    useCoachmarkStore.getState().markDismissed(BEGINNER_TOUR_ID);
    const rec = selectTour(useCoachmarkStore.getState(), BEGINNER_TOUR_ID);
    expect(rec.dismissedAt).toBeGreaterThan(0);
    expect(shouldStartTour(rec, { anchorsReady: true })).toBe(false);
  });

  it("resetTour 는 다시 볼 수 있게 되돌린다", () => {
    const s = useCoachmarkStore.getState();
    s.markStarted(BEGINNER_TOUR_ID);
    s.markCompleted(BEGINNER_TOUR_ID);
    s.resetTour(BEGINNER_TOUR_ID);
    const rec = selectTour(useCoachmarkStore.getState(), BEGINNER_TOUR_ID);
    expect(rec).toEqual({ startedCount: 0, completedAt: 0, dismissedAt: 0 });
    expect(shouldStartTour(rec, { anchorsReady: true })).toBe(true);
  });

  it("투어끼리 기록이 섞이지 않는다", () => {
    const s = useCoachmarkStore.getState();
    s.markCompleted(BEGINNER_TOUR_ID);
    expect(
      selectTour(useCoachmarkStore.getState(), "other_tour").completedAt,
    ).toBe(0);
  });

  it("비기너 투어와 어드밴스 투어는 서로 독립이다", () => {
    const s = useCoachmarkStore.getState();
    s.markCompleted(BEGINNER_TOUR_ID);
    expect(
      shouldStartTour(selectTour(useCoachmarkStore.getState(), ADVANCED_TOUR_ID), {
        anchorsReady: true,
      }),
    ).toBe(true);
    s.markDismissed(ADVANCED_TOUR_ID);
    expect(
      shouldStartTour(selectTour(useCoachmarkStore.getState(), BEGINNER_TOUR_ID), {
        anchorsReady: true,
      }),
    ).toBe(false);
    expect(
      shouldStartTour(selectTour(useCoachmarkStore.getState(), ADVANCED_TOUR_ID), {
        anchorsReady: true,
      }),
    ).toBe(false);
  });
});
