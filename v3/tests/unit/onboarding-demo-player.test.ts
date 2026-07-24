/**
 * 데모 재생 엔진 — 일시정지/재개/수동진행/막 건너뛰기 (ticket ATLPpGxY).
 *
 * fake timers 로 "예약된 setTimeout 이 실제로 멈추는가" 를 실측한다. 기존 구현은
 * 마운트 시 모든 step 을 누적 지연으로 한꺼번에 예약해서, 정지시켜도 뒤늦게
 * step 이 튀는 구조였다 — 그 회귀를 여기서 잡는다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DemoPlayer } from "../../src/components/onboarding/demoPlayer";
import {
  DEMO_ACTS,
  delaysForAct,
} from "../../src/components/onboarding/demoScript";

function makeHost() {
  const steps: number[] = [];
  const finishes: string[] = [];
  return {
    steps,
    finishes,
    host: {
      onStep: (s: number) => steps.push(s),
      onActFinished: (r: "played" | "skipped") => finishes.push(r),
    },
  };
}

describe("DemoPlayer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("지연표대로 순차 재생하고 마지막 step 에서 완주로 끝난다", () => {
    const { steps, finishes, host } = makeHost();
    const player = new DemoPlayer([1000, 2000, 500], host);

    player.start();
    expect(steps).toEqual([0]);

    vi.advanceTimersByTime(999);
    expect(steps).toEqual([0]);
    vi.advanceTimersByTime(1);
    expect(steps).toEqual([0, 1]);

    vi.advanceTimersByTime(2000);
    expect(steps).toEqual([0, 1, 2]);
    expect(finishes).toEqual([]);

    vi.advanceTimersByTime(500);
    expect(steps).toEqual([0, 1, 2, 3]);
    expect(player.finished).toBe(true);
    expect(finishes).toEqual(["played"]);

    // 완주 후에는 타이머가 더 남아 있지 않다.
    vi.advanceTimersByTime(10_000);
    expect(steps).toEqual([0, 1, 2, 3]);
  });

  it("★일시정지 중에는 step 이 진행되지 않는다(예약된 타이머가 실제로 끊긴다)", () => {
    const { steps, host } = makeHost();
    const player = new DemoPlayer([1000, 1000, 1000], host);
    player.start();

    vi.advanceTimersByTime(400);
    player.pause();
    expect(player.paused).toBe(true);

    // 원래 지연을 한참 넘겨도 아무 일도 없어야 한다 — 뒤늦게 튀면 실패.
    vi.advanceTimersByTime(60_000);
    expect(steps).toEqual([0]);
  });

  it("★재개하면 끊긴 지점부터 이어진다(처음부터 다시 세지 않는다)", () => {
    const { steps, host } = makeHost();
    const player = new DemoPlayer([1000, 1000], host);
    player.start();

    vi.advanceTimersByTime(700); // 남은 300ms
    player.pause();
    vi.advanceTimersByTime(5_000); // 정지 중 경과는 무시
    player.resume();
    expect(player.paused).toBe(false);

    vi.advanceTimersByTime(299);
    expect(steps).toEqual([0]); // 아직 300ms 를 못 채웠다
    vi.advanceTimersByTime(1);
    expect(steps).toEqual([0, 1]); // 정확히 잔량만큼만 더 기다렸다
  });

  it("여러 번 정지/재개해도 잔량이 누적 소모된다", () => {
    const { steps, host } = makeHost();
    const player = new DemoPlayer([1000], host);
    player.start();

    vi.advanceTimersByTime(300);
    player.pause();
    player.resume();
    vi.advanceTimersByTime(300);
    player.pause();
    player.resume();
    vi.advanceTimersByTime(399);
    expect(steps).toEqual([0]);
    vi.advanceTimersByTime(1);
    expect(steps).toEqual([0, 1]);
  });

  it("중복 pause/resume 은 무시된다", () => {
    const { steps, host } = makeHost();
    const player = new DemoPlayer([1000], host);
    player.start();
    player.resume(); // 정지 상태가 아님 → no-op
    vi.advanceTimersByTime(500);
    player.pause();
    player.pause(); // 두 번째 pause 가 잔량을 또 깎으면 안 된다
    player.resume();
    vi.advanceTimersByTime(499);
    expect(steps).toEqual([0]);
    vi.advanceTimersByTime(1);
    expect(steps).toEqual([0, 1]);
  });

  it("수동 '다음 단계' 는 즉시 넘어가고 이후 자동 재생을 이어간다", () => {
    const { steps, host } = makeHost();
    const player = new DemoPlayer([5000, 5000], host);
    player.start();

    player.next();
    expect(steps).toEqual([0, 1]);

    // 넘어간 step 의 타이머는 새로 걸린다 — 옛 5초가 남아 튀면 안 된다.
    vi.advanceTimersByTime(4999);
    expect(steps).toEqual([0, 1]);
    vi.advanceTimersByTime(1);
    expect(steps).toEqual([0, 1, 2]);
    expect(player.finished).toBe(true);
  });

  it("정지 중 '다음 단계' 는 한 칸만 넘어가고 정지 상태를 유지한다", () => {
    const { steps, host } = makeHost();
    const player = new DemoPlayer([1000, 1000, 1000], host);
    player.start();
    player.pause();

    player.next();
    expect(steps).toEqual([0, 1]);
    expect(player.paused).toBe(true);

    vi.advanceTimersByTime(60_000);
    expect(steps).toEqual([0, 1]); // 여전히 정지 중

    player.resume();
    vi.advanceTimersByTime(1000);
    expect(steps).toEqual([0, 1, 2]);
  });

  it("막 건너뛰기는 마지막 step 으로 점프하고 skipped 로 보고한다", () => {
    const { steps, finishes, host } = makeHost();
    const player = new DemoPlayer([1000, 1000, 1000], host);
    player.start();

    player.skipToEnd();
    expect(steps).toEqual([0, 3]);
    expect(finishes).toEqual(["skipped"]);
    expect(player.finished).toBe(true);

    // 건너뛴 뒤 남은 타이머가 되살아나면 안 된다.
    vi.advanceTimersByTime(60_000);
    expect(steps).toEqual([0, 3]);
  });

  it("완주한 뒤 건너뛰기를 눌러도 중복 보고하지 않는다", () => {
    const { finishes, host } = makeHost();
    const player = new DemoPlayer([100], host);
    player.start();
    vi.advanceTimersByTime(100);
    player.skipToEnd();
    expect(finishes).toEqual(["played"]);
  });

  it("dispose 후에는 어떤 타이머도 남지 않는다(언마운트 누수 방지)", () => {
    const { steps, host } = makeHost();
    const player = new DemoPlayer([1000], host);
    player.start();
    vi.advanceTimersByTime(500);
    player.dispose();
    vi.advanceTimersByTime(60_000);
    expect(steps).toEqual([0]);

    // dispose 후 조작은 전부 무시.
    player.start();
    player.next();
    player.skipToEnd();
    expect(steps).toEqual([0]);
  });

  it("start(delays) 로 새 막을 걸면 step 0 부터 다시 시작한다", () => {
    const { steps, finishes, host } = makeHost();
    const player = new DemoPlayer([100], host);
    player.start();
    vi.advanceTimersByTime(100);
    expect(finishes).toEqual(["played"]);

    steps.length = 0;
    player.start([200, 200]);
    expect(player.finished).toBe(false);
    expect(steps).toEqual([0]);
    vi.advanceTimersByTime(400);
    expect(steps).toEqual([0, 1, 2]);
    expect(finishes).toEqual(["played", "played"]);
  });
});

describe("DemoPlayer × 실제 대본", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("두 막을 이어 재생하면 계산된 총 재생시간 안에 끝난다", () => {
    const seen: Array<{ act: string; step: number }> = [];
    let finished = 0;
    let elapsed = 0;

    for (const act of DEMO_ACTS) {
      const delays = delaysForAct(act);
      const player = new DemoPlayer(delays, {
        onStep: (step) => seen.push({ act: act.id, step }),
        onActFinished: () => {
          finished += 1;
        },
      });
      player.start();
      const actMs = delays.reduce((a, b) => a + b, 0);
      vi.advanceTimersByTime(actMs);
      elapsed += actMs;
      expect(player.finished, `${act.id} 미완주`).toBe(true);
      player.dispose();
    }

    expect(finished).toBe(DEMO_ACTS.length);
    // 각 막의 모든 step 이 정확히 한 번씩 보였다.
    for (const act of DEMO_ACTS) {
      const actSteps = seen.filter((s) => s.act === act.id).map((s) => s.step);
      expect(actSteps).toEqual(
        Array.from({ length: act.finalStep + 1 }, (_, i) => i),
      );
    }
    expect(elapsed).toBeGreaterThan(0);
  });
});
