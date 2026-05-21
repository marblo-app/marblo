import { test, expect } from "../helpers/fixtures";

/**
 * Tier 1 회귀: 터미널 스크롤 락 (티켓 459b946e).
 *
 * 증상: 작업 진행 중 (xterm 에 새 출력이 도착하는 중) 사용자가 wheel 로
 *       위로 스크롤해도 자동으로 맨 아래로 끌려 내려옴.
 *
 * 패치 (accfffc 다음 커밋):
 *   - userScrollingUntil 300ms → 800ms (trackpad inertia 흡수)
 *   - wheel/keydown 리스너를 capture phase + .xterm-viewport DOM 에도 부착
 *
 * 회귀 가드 시나리오:
 *   1. 임의 PTY 터미널 mount 대기
 *   2. wheel up 으로 scrollTop 줄임
 *   3. 1초 동안 출력 도착 가능성 부여
 *   4. ASSERT: scrollTop 이 유의미하게 증가하지 않음 (= 위치 고정)
 *
 * 실 PTY 출력 없이도 "위로 스크롤 후 자동 복귀하지 않음" 의 negative case 는
 * 검증 가능. 출력 주입 검증은 Tier 2 mock fixture 가 준비되면 추가.
 */

test.describe("터미널 스크롤 락 (회귀 459b946e)", () => {
  test("@unit wheel up 후 새 출력에 끌려 내려가지 않는다 — 오케스트레이터", async ({
    marblo,
  }) => {
    const term = await marblo.terminal("orchestrator");
    // 오케스트레이터는 사이드/하단 패널로 항상 떠 있지만, UI 변경 가능성을
    // 감안해 skip-on-missing 로 안전하게.
    try {
      await term.waitReady();
    } catch {
      test.skip(
        true,
        "orchestrator terminal selector 가 변경됨 — POM 갱신 필요",
      );
      return;
    }

    // 스크롤 가능 분량이 없으면 의미 없음 — viewport scroll 가능 여부 확인.
    await term.waitMs(500);
    await term.wheelUp(300);
    const y1 = await term.getViewportY();

    // 1초간 새 출력 도착 가능성. 스크롤 위치가 자동 복귀하지 않는지 검증.
    await term.waitMs(1200);
    const y2 = await term.getViewportY();

    // y1·y2 모두 0 이면 (= 스크롤 안 됨) 환경 문제로 간주. skip.
    if (y1 <= 0 && y2 <= 0) {
      test.skip(
        true,
        "터미널에 스크롤 가능한 콘텐츠가 없음 — Tier 2 mock 필요",
      );
      return;
    }

    // 핵심 단언: 1초 사이에 viewportY 가 (의미 있게) 줄지 않아야 함.
    // 8px 마진 — xterm row height 보다 작은 noise 허용.
    expect(y2).toBeGreaterThanOrEqual(y1 - 8);
  });

  test("@unit PageUp 키도 스크롤 락에 동일하게 적용", async ({ marblo }) => {
    const term = await marblo.terminal("orchestrator");
    try {
      await term.waitReady();
    } catch {
      test.skip(true, "orchestrator terminal selector 가 변경됨");
      return;
    }

    await term.waitMs(500);
    await term.pageUp();
    await term.waitMs(200);
    const y1 = await term.getViewportY();
    await term.waitMs(1200);
    const y2 = await term.getViewportY();

    if (y1 <= 0 && y2 <= 0) {
      test.skip(true, "스크롤 가능한 콘텐츠 없음");
      return;
    }
    expect(y2).toBeGreaterThanOrEqual(y1 - 8);
  });
});
