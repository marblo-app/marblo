/**
 * 온보딩 데모의 재생 엔진 (ticket ATLPpGxY).
 *
 * 기존 구현은 마운트 시 모든 step 을 **누적 지연으로 한꺼번에 예약**했다
 * (setTimeout × N). 그러면 일시정지를 만들 수가 없다 — 타이머를 지우면 남은
 * 시간을 알 수 없고, 안 지우면 정지 중에도 step 이 뒤늦게 튄다. 그래서 여기서는
 * **항상 다음 step 하나만** 예약하고 남은 시간을 직접 들고 있는다:
 *   pause  → clearTimeout + remaining -= (now - startedAt)
 *   resume → setTimeout(remaining)   ← 끊긴 지점부터 이어짐
 *
 * React 를 모른다(순수 클래스). 그래야 jsdom 없는 node 환경에서 fake timers 로
 * 실측 검증할 수 있다 — tests/unit/onboarding-demo-player.test.ts.
 * 타이머는 전역 setTimeout/clearTimeout/Date.now 를 쓴다(테스트에서 vi.useFakeTimers
 * 가 셋 다 가로챈다). 네트워크·electronAPI 접근 없음.
 */

export interface DemoPlayerHost {
  /** step 이 바뀔 때마다(수동 진행·건너뛰기 포함) 호출. */
  onStep: (step: number) => void;
  /** 현재 막의 마지막 step 에 도달했을 때 1회 호출. */
  onActFinished: (reason: "played" | "skipped") => void;
}

export class DemoPlayer {
  private delays: number[];
  private readonly host: DemoPlayerHost;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** 현재 step 의 타이머를 건 시각. */
  private startedAt = 0;
  /** 현재 step 에 남은 시간(ms). pause 가 여기에 잔량을 적어 둔다. */
  private remaining = 0;
  private currentStep = 0;
  private isPaused = false;
  private isFinished = false;
  private disposed = false;

  constructor(delays: number[], host: DemoPlayerHost) {
    this.delays = [...delays];
    this.host = host;
  }

  get step(): number {
    return this.currentStep;
  }

  get paused(): boolean {
    return this.isPaused;
  }

  get finished(): boolean {
    return this.isFinished;
  }

  /** 이 막의 마지막 step 인덱스. delays.length 개의 전이가 있으므로 곧 그 길이. */
  get finalStep(): number {
    return this.delays.length;
  }

  /**
   * step 0 부터 재생 시작(또는 새 지연표로 재시작). 이미 걸린 타이머는 버린다.
   */
  start(delays?: number[]): void {
    if (this.disposed) return;
    if (delays) this.delays = [...delays];
    this.clearTimer();
    this.currentStep = 0;
    this.isPaused = false;
    this.isFinished = false;
    this.host.onStep(0);
    if (this.delays.length === 0) {
      this.isFinished = true;
      this.host.onActFinished("played");
      return;
    }
    this.schedule(this.delays[0]);
  }

  /**
   * 예약된 타이머를 실제로 끊는다 — 정지 중에는 step 이 진행되지 않는다.
   * 남은 시간은 보존된다.
   */
  pause(): void {
    if (this.isPaused || this.isFinished || this.disposed) return;
    this.isPaused = true;
    if (this.timer !== null) {
      const elapsed = Date.now() - this.startedAt;
      this.remaining = Math.max(0, this.remaining - elapsed);
      this.clearTimer();
    }
  }

  /** 끊긴 지점부터 이어서 재생. */
  resume(): void {
    if (!this.isPaused || this.isFinished || this.disposed) return;
    this.isPaused = false;
    this.schedule(this.remaining);
  }

  /**
   * 수동으로 다음 step 으로. 정지 중이었다면 정지 상태를 유지한 채 한 칸만
   * 넘어간다(스텝 단위로 읽고 싶은 사용자를 위해).
   */
  next(): void {
    if (this.isFinished || this.disposed) return;
    this.clearTimer();
    this.advance();
  }

  /** 이 막의 끝으로 점프. 남은 step 의 화면 상태는 마지막 step 이 흡수한다. */
  skipToEnd(): void {
    if (this.disposed) return;
    this.clearTimer();
    if (this.isFinished) return;
    this.currentStep = this.finalStep;
    this.isFinished = true;
    this.isPaused = false;
    this.host.onStep(this.currentStep);
    this.host.onActFinished("skipped");
  }

  /** 언마운트 정리 — 이후 모든 조작은 무시된다. */
  dispose(): void {
    this.clearTimer();
    this.disposed = true;
  }

  private advance(): void {
    this.currentStep += 1;
    this.host.onStep(this.currentStep);
    if (this.currentStep >= this.finalStep) {
      this.isFinished = true;
      this.host.onActFinished("played");
      return;
    }
    const nextDelay = this.delays[this.currentStep];
    if (this.isPaused) {
      // 정지 중 수동 진행 — 타이머는 걸지 않고 잔량만 새 step 것으로 채운다.
      this.remaining = nextDelay;
      return;
    }
    this.schedule(nextDelay);
  }

  private schedule(ms: number): void {
    this.remaining = ms;
    this.startedAt = Date.now();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.advance();
    }, ms);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
