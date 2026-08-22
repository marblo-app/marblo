/**
 * W8 — 워치독 "조용하다" 신호(티켓 Lfy6jvpil57eYf896km5).
 *
 * 2026-08-22 실사례: P0 배포를 문 devops 에이전트가 80분간 activity 0건. 프로세스는
 * 살아 있었고(PTY 스피너) 보드는 working. 기존 워치독은 PTY work-output 을 생존으로
 * 쳐서 한 번도 안 울렸다. 이 테스트가 고정하는 것:
 *
 *   1. 살아 있으나(PTY busy) 보드가 임계 이상 조용하면 → 신호 1회. nudge/respawn 0회.
 *   2. 임계 전(정상 장시간 작업) → 아무 신호도 없다. 일반 티어는 45분까지 침묵 허용.
 *   3. 같은 조용함 구간은 repeatMs(30분) 마다만 다시 올린다.
 *   4. 보드 활동이 재개되면 clearQuiet + "quiet-cleared" 기록.
 *   5. 이 인스턴스에 없는(missing) 에이전트 / 죽은 에이전트엔 이 신호를 올리지 않는다.
 *   6. 신호에는 모델이 실린다(모델별 완주 실패율을 쌓기 위한 데이터).
 *   7. ★워치독은 판정하지 않는다 — 신호만 올린다. 여러 틱이 지나도 kill/respawn 0회.
 */
import { describe, expect, it, vi } from "vitest";
import {
  AgentWatchdog,
  DEFAULT_WATCHDOG_CONFIG,
  type RecoveryPhase,
  type WatchdogAgentHealth,
  type WatchdogConfig,
  type WatchdogDeps,
  type WatchdogTicket,
} from "../../electron/agent-watchdog";
import {
  DEFAULT_STALL_POLICY,
  type StallSignal,
} from "../../electron/agent-stall-policy";

const MIN = 60_000;
const TASK = "tHTkcSA6QRdcNjYC72hC";
const AGENT = "deploy-githubapp-fns";

function ticket(over: Partial<WatchdogTicket> = {}): WatchdogTicket {
  return {
    taskId: TASK,
    projectId: "proj-1",
    status: "IN_PROGRESS",
    role: "devops",
    agentId: AGENT,
    lastActivityAtMs: 0,
    title: "P0 프로덕션 배포",
    priority: 5,
    ...over,
  };
}

interface Harness {
  wd: AgentWatchdog;
  clock: { ms: number };
  tickets: WatchdogTicket[];
  health: Map<string, WatchdogAgentHealth | null>;
  nudge: ReturnType<typeof vi.fn>;
  respawn: ReturnType<typeof vi.fn>;
  signals: Array<{
    ticket: WatchdogTicket;
    signal: StallSignal;
    detail: string;
  }>;
  cleared: string[];
  records: Array<{ taskId: string; phase: RecoveryPhase; detail: string }>;
}

function makeHarness(
  cfgOver: Partial<WatchdogConfig> = {},
  opts: { w8?: boolean } = {},
): Harness {
  const w8 = opts.w8 ?? true;
  const clock = { ms: 100 * MIN };
  const tickets: WatchdogTicket[] = [ticket()];
  const health = new Map<string, WatchdogAgentHealth | null>();
  const nudge = vi.fn(() => true);
  const respawn = vi.fn(async () => true);
  const signals: Harness["signals"] = [];
  const cleared: string[] = [];
  const records: Harness["records"] = [];
  const deps: WatchdogDeps = {
    listActiveTickets: async () => tickets,
    getAgentHealth: (id) => health.get(id) ?? null,
    nudgeAgent: nudge,
    respawnForTicket: respawn,
    recordRecovery: (t, phase, detail) =>
      records.push({ taskId: t.taskId, phase, detail }),
    ...(w8
      ? {
          signalQuiet: (
            t: WatchdogTicket,
            signal: StallSignal,
            detail: string,
          ) => signals.push({ ticket: t, signal, detail }),
          clearQuiet: (_t: WatchdogTicket, agentId: string) =>
            cleared.push(agentId),
        }
      : {}),
    now: () => clock.ms,
    logger: () => {},
  };
  const cfg: WatchdogConfig = {
    ...DEFAULT_WATCHDOG_CONFIG,
    intervalMs: 1_000,
    stall: DEFAULT_STALL_POLICY,
    ...cfgOver,
  };
  return {
    wd: new AgentWatchdog(deps, cfg),
    clock,
    tickets,
    health,
    nudge,
    respawn,
    signals,
    cleared,
    records,
  };
}

/** PTY 가 스피너를 계속 그리는(=work output 신선) 살아있는 에이전트. */
function busyHealth(
  now: number,
  over: Partial<WatchdogAgentHealth> = {},
): WatchdogAgentHealth {
  return {
    status: "working",
    lastPtyActivityMs: now - 5_000,
    lastWorkOutputMs: now - 5_000,
    promptIdleSinceMs: null,
    currentTaskId: TASK,
    agentName: AGENT,
    concreteModel: "claude-fable-5@high",
    inputWaitReason: null,
    ...over,
  };
}

describe("W8 quiet signal — alive but not progressing", () => {
  it("★80분 보드 무활동 + PTY busy (오늘의 케이스) → 신호 1회, nudge/respawn 0회, 모델 기록", async () => {
    const h = makeHarness();
    h.health.set(AGENT, busyHealth(h.clock.ms));
    h.tickets[0].lastActivityAtMs = h.clock.ms - 80 * MIN;
    await h.wd.tickOnce();

    expect(h.signals).toHaveLength(1);
    const { signal, detail } = h.signals[0];
    expect(signal).toMatchObject({
      taskId: TASK,
      tier: "urgent",
      quietMs: 80 * MIN,
      thresholdMs: 20 * MIN,
      pty: "busy",
      model: "claude-fable-5@high",
      repeat: 1,
    });
    expect(detail).toContain("80분");
    expect(detail).toContain("claude-fable-5@high");
    // The ladder did NOT act: the spinner keeps the legacy liveness clock fresh
    // (that is the old behavior this signal exists alongside), and the signal
    // itself never unlocks a rung.
    expect(h.nudge).not.toHaveBeenCalled();
    expect(h.respawn).not.toHaveBeenCalled();
    expect(h.records.some((r) => r.phase === "quiet")).toBe(true);
  });

  it("임계 전(P5 티켓 15분 조용) → 신호 없음 — 긴 추론/툴 실행을 오판하지 않는다", async () => {
    const h = makeHarness();
    h.health.set(AGENT, busyHealth(h.clock.ms));
    h.tickets[0].lastActivityAtMs = h.clock.ms - 15 * MIN;
    await h.wd.tickOnce();
    expect(h.signals).toHaveLength(0);
    expect(h.nudge).not.toHaveBeenCalled();
    expect(h.respawn).not.toHaveBeenCalled();
  });

  it("일반 티어(P3) 는 45분까지 침묵 — 30분 조용한 대규모 리팩터는 신호 없음, 46분엔 신호", async () => {
    const h = makeHarness();
    h.tickets[0] = ticket({ priority: 3, title: "대규모 리팩터" });
    h.health.set(AGENT, busyHealth(h.clock.ms));
    h.tickets[0].lastActivityAtMs = h.clock.ms - 30 * MIN;
    await h.wd.tickOnce();
    expect(h.signals).toHaveLength(0);

    h.clock.ms += 16 * MIN;
    await h.wd.tickOnce();
    expect(h.signals).toHaveLength(1);
    expect(h.signals[0].signal.tier).toBe("normal");
    expect(h.signals[0].signal.thresholdMs).toBe(45 * MIN);
  });

  it("같은 조용함 구간은 repeatMs 마다만 재알림(1분 틱이 30번 지나도 1회, 30분 뒤 2회째) — 그리고 ★신호는 사다리에 행동을 하나도 더하지 않는다(대조군과 nudge/respawn 횟수 동일)", async () => {
    // Same 31 ticks on two watchdogs: one with the W8 ports wired, one without.
    // The legacy ladder (born-dead rung etc.) may act on its own in this
    // harness — that is pre-existing behavior, guarded in production by W3 —
    // but the quiet signal must not change WHAT it does, only add a signal.
    const h = makeHarness();
    const control = makeHarness({}, { w8: false });
    for (const x of [h, control]) {
      x.health.set(AGENT, busyHealth(x.clock.ms));
      x.tickets[0].lastActivityAtMs = x.clock.ms - 25 * MIN;
    }
    for (let i = 0; i < 29; i++) {
      for (const x of [h, control]) {
        x.health.set(AGENT, busyHealth(x.clock.ms));
        await x.wd.tickOnce();
        x.clock.ms += MIN;
      }
    }
    expect(h.signals).toHaveLength(1);
    for (const x of [h, control]) {
      x.clock.ms += 2 * MIN; // past repeatMs (30m) since the first signal
      x.health.set(AGENT, busyHealth(x.clock.ms));
      await x.wd.tickOnce();
    }
    expect(h.signals).toHaveLength(2);
    expect(h.signals[1].signal.repeat).toBe(2);
    expect(h.signals[1].detail).toContain("2회째");
    expect(control.signals).toHaveLength(0);
    // ★The invariant this ticket is about: signalling changed nothing else.
    expect(h.nudge.mock.calls.length).toBe(control.nudge.mock.calls.length);
    expect(h.respawn.mock.calls.length).toBe(control.respawn.mock.calls.length);
    // And a PTY-busy agent is never nudged by the silence rung (legacy clock).
    expect(h.nudge).not.toHaveBeenCalled();
  });

  it("보드 활동이 재개되면 clearQuiet + quiet-cleared 기록, 이후 다시 조용해지면 새 구간으로 1회째 재알림", async () => {
    const h = makeHarness();
    h.health.set(AGENT, busyHealth(h.clock.ms));
    h.tickets[0].lastActivityAtMs = h.clock.ms - 25 * MIN;
    await h.wd.tickOnce();
    expect(h.signals).toHaveLength(1);

    // The worker posts add_activity.
    h.clock.ms += MIN;
    h.tickets[0].lastActivityAtMs = h.clock.ms;
    h.health.set(AGENT, busyHealth(h.clock.ms));
    await h.wd.tickOnce();
    expect(h.cleared).toEqual([AGENT]);
    expect(h.records.some((r) => r.phase === "quiet-cleared")).toBe(true);

    // Quiet again much later → a fresh stretch, repeat counter restarts.
    h.clock.ms += 25 * MIN;
    h.health.set(AGENT, busyHealth(h.clock.ms));
    await h.wd.tickOnce();
    expect(h.signals).toHaveLength(2);
    expect(h.signals[1].signal.repeat).toBe(1);
  });

  it("PTY 상태 설명: 입력 프롬프트에 서 있으면 parked, 사람 확인 대기면 awaiting-input, 출력 없으면 silent", async () => {
    const h = makeHarness();
    h.tickets[0].lastActivityAtMs = h.clock.ms - 25 * MIN;
    h.health.set(
      AGENT,
      busyHealth(h.clock.ms, { promptIdleSinceMs: h.clock.ms - 3 * MIN }),
    );
    await h.wd.tickOnce();
    expect(h.signals[0].signal.pty).toBe("parked");

    const h2 = makeHarness();
    h2.tickets[0].lastActivityAtMs = h2.clock.ms - 25 * MIN;
    h2.health.set(
      AGENT,
      busyHealth(h2.clock.ms, { inputWaitReason: "confirm" }),
    );
    await h2.wd.tickOnce();
    expect(h2.signals[0].signal.pty).toBe("awaiting-input");

    const h3 = makeHarness();
    h3.tickets[0].lastActivityAtMs = h3.clock.ms - 25 * MIN;
    h3.health.set(
      AGENT,
      busyHealth(h3.clock.ms, {
        lastWorkOutputMs: h3.clock.ms - 10 * MIN,
        lastPtyActivityMs: h3.clock.ms - 10 * MIN,
      }),
    );
    await h3.wd.tickOnce();
    expect(h3.signals[0].signal.pty).toBe("silent");
  });

  it("이 인스턴스에 없는(missing) 에이전트 / 죽은 에이전트에는 quiet 신호를 올리지 않는다", async () => {
    const h = makeHarness();
    h.health.set(AGENT, null);
    h.tickets[0].lastActivityAtMs = h.clock.ms - 80 * MIN;
    await h.wd.tickOnce();
    expect(h.signals).toHaveLength(0);

    const h2 = makeHarness();
    h2.health.set(AGENT, busyHealth(h2.clock.ms, { status: "stopped" }));
    h2.tickets[0].lastActivityAtMs = h2.clock.ms - 80 * MIN;
    await h2.wd.tickOnce();
    expect(h2.signals).toHaveLength(0);
    // …the dead one goes down the existing recovery ladder instead.
    expect(h2.respawn).toHaveBeenCalled();
  });

  it("티켓이 활성 집합을 떠나면(REVIEW/DONE) 마커를 걷는다", async () => {
    const h = makeHarness();
    h.health.set(AGENT, busyHealth(h.clock.ms));
    h.tickets[0].lastActivityAtMs = h.clock.ms - 25 * MIN;
    await h.wd.tickOnce();
    expect(h.signals).toHaveLength(1);
    h.tickets.length = 0; // submitted
    await h.wd.tickOnce();
    expect(h.cleared).toEqual([AGENT]);
  });

  it("signalQuiet 미배선 호스트는 종전과 완전히 같다(아무 것도 안 함)", async () => {
    const h = makeHarness();
    // Rebuild without the W8 ports.
    const deps: WatchdogDeps = {
      listActiveTickets: async () => h.tickets,
      getAgentHealth: (id) => h.health.get(id) ?? null,
      nudgeAgent: h.nudge,
      respawnForTicket: h.respawn,
      recordRecovery: (t, phase, detail) =>
        h.records.push({ taskId: t.taskId, phase, detail }),
      now: () => h.clock.ms,
      logger: () => {},
    };
    const wd = new AgentWatchdog(deps, {
      ...DEFAULT_WATCHDOG_CONFIG,
      stall: DEFAULT_STALL_POLICY,
    });
    h.health.set(AGENT, busyHealth(h.clock.ms));
    h.tickets[0].lastActivityAtMs = h.clock.ms - 80 * MIN;
    await wd.tickOnce();
    expect(h.records.some((r) => r.phase === "quiet")).toBe(false);
    expect(h.nudge).not.toHaveBeenCalled();
    expect(h.respawn).not.toHaveBeenCalled();
  });
});
