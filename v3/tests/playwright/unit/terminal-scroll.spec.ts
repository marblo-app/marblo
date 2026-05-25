import { test, expect } from "../helpers/fixtures";

/**
 * Tier 1+2 회귀: 터미널 스크롤 락 (티켓 459b946e).
 *
 * 증상: 작업 진행 중 (xterm 에 새 출력이 도착하는 중) 사용자가 wheel 로
 *       위로 스크롤해도 자동으로 맨 아래로 끌려 내려옴.
 *
 * 패치 (accfffc + 후속 재설계):
 *   - userScrollingUntil 300ms → 800ms (trackpad inertia 흡수)
 *   - 더 견고한 wantBottomRef state machine (renderer-induced ydisp jump 무시)
 *   - wheel/keydown 리스너를 capture phase + .xterm-viewport DOM 에도 부착
 *
 * 회귀 가드 시나리오 (Tier 2 mock orchestrator):
 *   1. openMockOrchestrator() — claude 없이 sh seq 1 5000 PTY 띄움
 *   2. OrchestratorPanel 자동 mount + xterm 에 데이터 흐름
 *   3. wheel up 으로 scrollTop 줄임
 *   4. 1초 동안 새 출력 도착 가능성 부여 (sleep 60 으로 PTY 살아있음)
 *   5. ASSERT: scrollTop 이 유의미하게 증가하지 않음 (= 위치 고정)
 */

test.describe("터미널 스크롤 락 (회귀 459b946e)", () => {
  test("@mocked wheel up 후 새 출력에 끌려 내려가지 않는다 — 오케스트레이터", async ({
    marblo,
  }) => {
    // Tier 2 mock — claude 없이 dummy PTY 로 OrchestratorTerminal 활성화.
    await marblo.openMockOrchestrator();

    const term = await marblo.terminal("orchestrator");
    await term.waitReady();

    // PTY 가 충분히 출력해서 scroll 가능 상태가 될 때까지 대기.
    // seq 1 5000 은 sh 에서 ~수백 ms 안에 종료. 그 후 sleep 60 으로 유지.
    await term.waitMs(1500);

    // 일단 위로 스크롤. wheelUp 이 capture phase listener 까지 트리거.
    await term.wheelUp(400);
    await term.waitMs(200);
    const y1 = await term.getViewportY();

    // y1 이 0 이면 (= 스크롤 안 됨) 시나리오 의미 없음. 환경 문제로 fail.
    expect(
      y1,
      "wheel up 후 scrollTop 이 0보다 커야 함 (스크롤 가능 상태)",
    ).toBeGreaterThan(0);

    // 1.5초 동안 추가 출력 가능성 부여. wantBottomRef 가 false 면 위치 유지.
    await term.waitMs(1500);
    const y2 = await term.getViewportY();

    // 핵심 단언: scrollTop 이 유의미하게 줄지 않아야 함 (위치 고정).
    // 8px 마진 — xterm row height 보다 작은 noise 허용.
    expect(
      y2,
      `1.5초 후 viewportY 가 줄어든 채로 (= 위로 스크롤된 채로) 유지되어야 함. y1=${y1}, y2=${y2}`,
    ).toBeGreaterThanOrEqual(y1 - 8);
  });

  test("@mocked PageUp 키도 스크롤 락에 동일하게 적용", async ({ marblo }) => {
    await marblo.openMockOrchestrator();

    const term = await marblo.terminal("orchestrator");
    await term.waitReady();

    await term.waitMs(1500);
    await term.pageUp();
    await term.waitMs(300);
    const y1 = await term.getViewportY();

    expect(y1, "PageUp 후 scrollTop 이 0보다 커야 함").toBeGreaterThan(0);

    await term.waitMs(1500);
    const y2 = await term.getViewportY();

    expect(
      y2,
      `PageUp 후 1.5초 동안 위치 유지되어야 함. y1=${y1}, y2=${y2}`,
    ).toBeGreaterThanOrEqual(y1 - 8);
  });
});
