/**
 * ★"끄면 자동으로 수집이 빠진다" 는 법적 약속이다 — 그 왕복을 여기서 고정한다.
 * (ticket tTtuwzkhL64CdPtoGaGN · 사장님 지시 2026-08-30)
 *
 * 방침 문면(v3/src/components/legal/privacyContent.tsx · 항목 "변경 권리"):
 *   "Settings → Privacy 토글에서 언제든 변경 (PIPA 제22조)"
 * 그리고 PrivacySettings.tsx 머리주석: "effects immediate (no delay)".
 *
 * ── ★기존 테스트가 못 잡던 자리 ─────────────────────────────────────────────
 * telemetry-local-only.test.ts 는 **끄고 나서 넣은** 이벤트만 검사한다. 그런데
 * `logTelemetry` 의 게이트(telemetryService.ts)는 **큐에 넣는 것**만 막았고,
 * 이미 큐에 들어간 배치와 무장된 타이머(이벤트 10초 · 하트비트 30초)는 그대로
 * 남아 있었다. 즉 끈 직후에도 마지막 배치가 나갔고, 그 요청을 받은 서버는
 * `logTelemetryBatch` 안에서 events 적재 + **사람키 각인**(personAxisStamp) +
 * **링크표 MERGE**(analytics_user_install)를 전부 수행했다 — 서버 축 구멍의
 * 실제 입구가 여기였다.
 *
 * 그래서 이 파일이 고정하는 것은 "끄면 호출 0" 을 **큐가 이미 차 있는 상태에서**
 * 요구하는 것이다. 그리고 반대 방향(켜면 재개)도 같이 고정한다 — 한쪽만 고정하면
 * "그냥 전부 막아버린" 회귀를 통과시킨다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const callableSpy = vi.fn(() => Promise.resolve({ data: {} }));

vi.mock("firebase/functions", () => ({
  httpsCallable: () => callableSpy,
}));

// auth.currentUser 가 있는 상태 — flush 를 막는 것이 오직 동의 게이트뿐이게 한다.
// (미로그인 경로를 보는 케이스만 beforeEach 에서 currentUser 를 null 로 바꾼다.)
const SIGNED_IN = { functions: {}, auth: { currentUser: { uid: "test-uid" } }, db: {} };
const SIGNED_OUT = { functions: {}, auth: { currentUser: null }, db: {} };
let firebaseStub: typeof SIGNED_IN | typeof SIGNED_OUT = SIGNED_IN;

vi.mock("../../src/lib/firebase", () => firebaseStub);

describe("텔레메트리 옵트아웃 왕복 (끄면 0 · 켜면 재개)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    callableSpy.mockClear();
    // ★기본은 로그인 상태로 되돌린다. 케이스 하나가 미로그인으로 바꾸므로,
    //   되돌리지 않으면 그 다음 케이스가 조용히 다른 경로를 검사하게 된다.
    firebaseStub = SIGNED_IN;
    vi.resetModules();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("★이미 큐에 든 이벤트도 끄는 순간 나가지 않는다 (타이머 만료까지 기다려도 0)", async () => {
    const { telemetry, setTelemetryEnabled } = await import(
      "../../src/services/telemetryService"
    );

    // 켜진 상태에서 큐를 채운다 — 아직 flush 타이머(10초)는 만료 전이다.
    telemetry.tokenUsage("a1", "claude", 10, 20, 0.5, "p1");
    telemetry.taskCompleted("t1", 1000, "a1");
    expect(callableSpy).not.toHaveBeenCalled();

    // 사용자가 Settings → Privacy 에서 끈다.
    setTelemetryEnabled(false);

    // 타이머가 만료돼도, 명시적 flush 를 불러도 한 건도 나가면 안 된다.
    vi.advanceTimersByTime(60_000);
    await telemetry.flush();
    await Promise.resolve();

    expect(callableSpy).not.toHaveBeenCalled();
  });

  it("★이미 큐에 든 하트비트도 나가지 않는다", async () => {
    const { logTelemetry, setTelemetryEnabled } = await import(
      "../../src/services/telemetryService"
    );

    // 하트비트는 별도 큐 + 30초 타이머다(events 와 다른 경로).
    for (let i = 0; i < 3; i += 1) {
      logTelemetry({ event: "agent:heartbeat", agentId: `a${i}`, status: "running" });
    }
    expect(callableSpy).not.toHaveBeenCalled();

    setTelemetryEnabled(false);
    vi.advanceTimersByTime(120_000);
    await Promise.resolve();

    expect(callableSpy).not.toHaveBeenCalled();
  });

  it("★앱 종료(pagehide) flush 도 끈 뒤에는 나가지 않는다", async () => {
    const { telemetry, setTelemetryEnabled } = await import(
      "../../src/services/telemetryService"
    );
    const { shouldFlushTelemetryOnLifecycle } = await import(
      "../../src/services/telemetryLifecycle"
    );

    telemetry.tokenUsage("a1", "claude", 10, 20, 0.5, "p1");
    setTelemetryEnabled(false);

    // 라이프사이클 훅은 게이트를 모르고 그냥 flush 를 부른다 — 그래서 flush 쪽에
    // 게이트가 서 있어야 한다(호출부가 아니라 송신부가 마지막 방어선이다).
    expect(shouldFlushTelemetryOnLifecycle("pagehide")).toBe(true);
    await telemetry.flush();
    await Promise.resolve();

    expect(callableSpy).not.toHaveBeenCalled();
  });

  it("★미로그인(익명 배치) 경로도 끈 뒤에는 나가지 않는다", async () => {
    firebaseStub = SIGNED_OUT;
    vi.resetModules();
    const { logTelemetry, telemetry, setTelemetryEnabled } = await import(
      "../../src/services/telemetryService"
    );

    // 익명 허용목록에 있는 이벤트라야 익명 배치 경로를 탄다.
    logTelemetry({ event: "app:first_run", success: true });
    setTelemetryEnabled(false);
    vi.advanceTimersByTime(60_000);
    await telemetry.flush();
    await Promise.resolve();

    expect(callableSpy).not.toHaveBeenCalled();
  });

  it("★다시 켜면 재개된다 — 끈 동안의 것은 살아 돌아오지 않는다", async () => {
    const { telemetry, setTelemetryEnabled } = await import(
      "../../src/services/telemetryService"
    );

    // 1) 켜짐 → 큐에 하나. 2) 끔 → 그 하나는 버려진다.
    telemetry.tokenUsage("a1", "claude", 10, 20, 0.5, "p1");
    setTelemetryEnabled(false);
    vi.advanceTimersByTime(60_000);
    await telemetry.flush();
    expect(callableSpy).not.toHaveBeenCalled();

    // 3) 다시 켬 → 새 이벤트는 정상적으로 나간다(게이트가 죽은 길이 아님).
    setTelemetryEnabled(true);
    telemetry.taskCompleted("t2", 2000, "a2");
    await telemetry.flush();

    expect(callableSpy).toHaveBeenCalledTimes(1);
    const sent = callableSpy.mock.calls[0][0] as {
      events: Array<Record<string, unknown>>;
    };
    // ★끈 동안 큐에 있던 것이 되살아나면 안 된다 — 정확히 1건, 재개 후의 것만.
    expect(sent.events).toHaveLength(1);
    expect(sent.events[0].taskId).toBe("t2");
  });
});
