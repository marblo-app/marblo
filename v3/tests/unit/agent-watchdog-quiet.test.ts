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
  /** 프로브 축 테스트가 optional 포트(probeProcess)를 런타임에 꽂기 위해 노출. */
  deps: WatchdogDeps;
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
    deps,
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

  it("이 인스턴스에 없는(missing) 에이전트에는 quiet 신호를 올리지 않는다 — 다른 호스트 소관", async () => {
    const h = makeHarness();
    h.health.set(AGENT, null);
    h.tickets[0].lastActivityAtMs = h.clock.ms - 80 * MIN;
    await h.wd.tickOnce();
    expect(h.signals).toHaveLength(0);
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

/**
 * W8 보강(2026-08-23, 티켓 O1OQKukSSCmMaJCoGHGP) — "스폰 직후 무산출" 을 못 잡던
 * 구멍. 2026-08-23 실사례: CEO리뷰 티켓(P5)에 스폰한 MiniMax-M3 에이전트가
 * activity 0건으로 멈췄는데, get_agents 는 죽일 때까지 [working]이었고 워치독은
 * 20분 임계 전이라 아무 신호도 안 올렸다.
 */
describe("W8 quiet signal — exit axis (사망은 즉시, 무활동 임계 대기 없음)", () => {
  it("★프로세스 종료가 로컬에서 확정되면 무활동 10분이어도(20분 임계 전) 즉시 exit 신호 — exitCode·경과분 포함, 사다리(respawn)는 그대로 동작", async () => {
    const h = makeHarness();
    h.tickets[0].lastActivityAtMs = h.clock.ms - 10 * MIN;
    h.health.set(
      AGENT,
      busyHealth(h.clock.ms, {
        status: "stopped",
        lastExitCode: 1,
        terminalSinceMs: h.clock.ms,
      }),
    );
    await h.wd.tickOnce();

    expect(h.signals).toHaveLength(1);
    const { signal, detail } = h.signals[0];
    expect(signal).toMatchObject({
      taskId: TASK,
      axis: "exit",
      thresholdMs: 0,
      exitCode: 1,
      quietMs: 0, // just confirmed dead
      boardIdleMs: 10 * MIN,
    });
    expect(detail).toContain("exit 1");
    expect(detail).toContain("즉시");
    // The signal changes nothing about the pre-existing ladder: a locally
    // confirmed-dead agent past graceMs still gets respawned, same as before
    // this ticket.
    expect(h.respawn).toHaveBeenCalled();
  });

  it("exitCode 를 모르면 '?' 로 표시하되 그래도 즉시 신호한다", async () => {
    const h = makeHarness();
    h.tickets[0].lastActivityAtMs = h.clock.ms;
    h.health.set(
      AGENT,
      busyHealth(h.clock.ms, {
        status: "error",
        lastExitCode: null,
        terminalSinceMs: h.clock.ms,
      }),
    );
    await h.wd.tickOnce();
    expect(h.signals).toHaveLength(1);
    expect(h.signals[0].signal.exitCode).toBeNull();
    expect(h.signals[0].detail).toContain("exit ?");
  });

  it("같은 사망은 repeatMs(30분) 마다만 재알림", async () => {
    const h = makeHarness();
    h.tickets[0].lastActivityAtMs = h.clock.ms - 10 * MIN; // never moves — the agent is dead
    h.health.set(
      AGENT,
      busyHealth(h.clock.ms, {
        status: "stopped",
        lastExitCode: 137,
        terminalSinceMs: h.clock.ms,
      }),
    );
    await h.wd.tickOnce();
    expect(h.signals).toHaveLength(1);

    h.clock.ms += MIN;
    h.health.set(
      AGENT,
      busyHealth(h.clock.ms, {
        status: "stopped",
        lastExitCode: 137,
        terminalSinceMs: h.clock.ms - MIN,
      }),
    );
    await h.wd.tickOnce();
    expect(h.signals).toHaveLength(1); // still within repeatMs

    h.clock.ms += 30 * MIN;
    h.health.set(
      AGENT,
      busyHealth(h.clock.ms, {
        status: "stopped",
        lastExitCode: 137,
        terminalSinceMs: h.clock.ms - 31 * MIN,
      }),
    );
    await h.wd.tickOnce();
    expect(h.signals).toHaveLength(2);
    expect(h.signals[1].signal.repeat).toBe(2);
  });
});

describe("W8 quiet signal — first-activity axis (스폰 직후 무산출)", () => {
  it("★스폰 이후 첫 활동이 아예 없으면(5분 임계) 20/45분 무활동 임계를 기다리지 않고 신호, nudge/respawn 0회", async () => {
    const h = makeHarness();
    h.tickets[0] = ticket({
      lastActivityAtMs: null,
      activeSinceMs: 100 * MIN - 6 * MIN,
    });
    h.health.set(AGENT, busyHealth(h.clock.ms));
    await h.wd.tickOnce();

    expect(h.signals).toHaveLength(1);
    const { signal, detail } = h.signals[0];
    expect(signal).toMatchObject({
      taskId: TASK,
      axis: "first-activity",
      thresholdMs: 5 * MIN,
      exitCode: null,
    });
    expect(signal.quietMs).toBe(6 * MIN);
    expect(detail).toContain("첫 활동 임계 5분");
    expect(h.nudge).not.toHaveBeenCalled();
    expect(h.respawn).not.toHaveBeenCalled();
  });

  it("첫 활동 임계 전(4분)이면 아직 신호 없음 — 정상 스폰 초기 구간을 오판하지 않는다", async () => {
    const h = makeHarness();
    h.tickets[0] = ticket({
      lastActivityAtMs: null,
      activeSinceMs: 100 * MIN - 4 * MIN,
    });
    h.health.set(AGENT, busyHealth(h.clock.ms));
    await h.wd.tickOnce();
    expect(h.signals).toHaveLength(0);
  });

  it("★대조군 — 정상적으로 첫 보고를 마친 에이전트(스폰 4분 뒤 활동)는 first-activity 신호도 board-quiet 신호도 없다", async () => {
    const h = makeHarness();
    h.tickets[0] = ticket({
      lastActivityAtMs: 100 * MIN - 4 * MIN,
      activeSinceMs: 100 * MIN - 4 * MIN,
    });
    h.health.set(AGENT, busyHealth(h.clock.ms));
    await h.wd.tickOnce();
    expect(h.signals).toHaveLength(0);
    expect(h.nudge).not.toHaveBeenCalled();
    expect(h.respawn).not.toHaveBeenCalled();
  });
});

/**
 * ★능동 프로브 축(2026-08-23, 티켓 DQYoyas3ESx33zXJOCOa).
 *
 * 사장님 요구: "워치독이 **찔러봐서** 실제 죽은 건지 작업 중인지 판단". 위 세 축은
 * 전부 관측이 도착하기를 기다린다. 이 축은 가서 확인한다 — 단 **PTY 에 단 1바이트도
 * 쓰지 않고**.
 *
 * 이 describe 가 고정하는 것(완료 기준 그대로):
 *   1. ★방해 안 함 — 프로브가 도는 어떤 경로에서도 nudgeAgent(=PTY write) 0회.
 *   2. ★3분기 — 응답함 / 무응답 / 프로브 불가가 서로 다른 결과를 낸다.
 *   3. ★오탐 1건 — 보드는 30분째 조용하지만 MCP 로 왕복 중인 멀쩡한 에이전트를
 *      '멈춤' 으로 신고하지 않는다(그리고 board-quiet 안전망은 그대로 산다).
 *   4. ★프로브 불가를 '멈춤' 으로 뚝치지 않는다 — 신호 0건, board-quiet 이 받는다.
 *   5. ★워치독은 여전히 죽이지 않는다 — probe 축에서 kill/respawn 0회.
 */
describe("★능동 프로브 축 — 찔러보되 방해하지 않는다", () => {
  /** PTY 는 조용하고(긴 추론/서브프로세스) 프로세스는 살아 있는 에이전트. */
  function silentHealth(
    now: number,
    over: Partial<WatchdogAgentHealth> = {},
  ): WatchdogAgentHealth {
    return busyHealth(now, {
      status: "working",
      // work-output 이 STALL_PTY_BUSY_RECENT_MS(2분)보다 오래됐다 → silent.
      lastPtyActivityMs: now - 20 * MIN,
      lastWorkOutputMs: now - 20 * MIN,
      promptIdleSinceMs: null,
      ptyPid: 4242,
      ...over,
    });
  }

  it("★오탐 사례: 보드 30분 무활동이어도 MCP 호출이 2분 전이면 신호 0건 (일하는 에이전트를 죽은 걸로 판정하지 않는다)", async () => {
    const h = makeHarness();
    // 일반 티어(P2) — board-quiet 임계는 45분이라 아직 멀었다.
    h.tickets[0] = ticket({
      priority: 2,
      lastActivityAtMs: h.clock.ms - 30 * MIN,
    });
    h.health.set(
      AGENT,
      // 벤치를 돌리는 중: PTY 는 조용하고 보드도 조용하지만 read-only MCP 호출
      // (check_feedback/get_task)은 계속 서버까지 왕복하고 있다.
      silentHealth(h.clock.ms, { lastMcpCallMs: h.clock.ms - 2 * MIN }),
    );
    await h.wd.tickOnce();

    expect(h.signals).toHaveLength(0);
    const probe = h.wd.getLastProbe(TASK);
    expect(probe?.outcome).toBe("responsive");
    expect(probe?.evidence).toBe("mcp-call");
  });

  it("★그 에이전트가 진짜로 멈추면(MCP 도 12분 침묵) probe 축이 board-quiet(45분)보다 훨씬 먼저 잡는다", async () => {
    const h = makeHarness();
    h.tickets[0] = ticket({
      priority: 2,
      lastActivityAtMs: h.clock.ms - 30 * MIN,
    });
    h.health.set(
      AGENT,
      silentHealth(h.clock.ms, { lastMcpCallMs: h.clock.ms - 13 * MIN }),
    );
    await h.wd.tickOnce();

    expect(h.signals).toHaveLength(1);
    const { signal, detail } = h.signals[0];
    expect(signal).toMatchObject({
      taskId: TASK,
      axis: "probe",
      thresholdMs: 12 * MIN,
      exitCode: null,
      boardIdleMs: 30 * MIN,
    });
    expect(signal.probe?.outcome).toBe("unresponsive");
    expect(signal.probe?.evidence).toBe("mcp-silent");
    expect(detail).toContain("능동 프로브 무응답");
    // ★방해 안 함이 신호 문구에 명시돼야 오케가 "찔렀다=건드렸다" 로 오독하지 않는다.
    expect(detail).toContain("PTY 에 아무것도 쓰지 않은");
    // ★워치독은 여전히 죽이지 않는다 — probe 는 respawn 을 파생시키지 않는다.
    expect(h.respawn).not.toHaveBeenCalled();
  });

  it("★프로브 불가(MCP 호출 이력 없음) → 신호 0건. board-quiet 안전망이 그대로 20분에 받는다", async () => {
    const h = makeHarness();
    // 긴급(P5) 티켓, 보드 15분 무활동 — probe 유예(12분)는 넘겼지만
    // board-quiet 임계(20분)는 아직.
    h.tickets[0].lastActivityAtMs = h.clock.ms - 15 * MIN;
    h.health.set(AGENT, silentHealth(h.clock.ms, { lastMcpCallMs: null }));
    await h.wd.tickOnce();

    // ★"관측할 수 없다" 를 "멈췄다" 로 뚝치지 않는다.
    expect(h.signals).toHaveLength(0);
    expect(h.wd.getLastProbe(TASK)?.outcome).toBe("indeterminate");
    expect(h.wd.getLastProbe(TASK)?.evidence).toBe("no-baseline");

    // 그리고 기존 안전망은 그대로 살아 있다 — 20분을 넘기면 board-quiet 이 운다.
    h.clock.ms += 6 * MIN;
    h.health.set(AGENT, silentHealth(h.clock.ms, { lastMcpCallMs: null }));
    await h.wd.tickOnce();
    expect(h.signals).toHaveLength(1);
    expect(h.signals[0].signal.axis).toBe("board-quiet");
  });

  it("PTY 가 busy(스피너/스트리밍)면 probe 는 의견을 내지 않는다 — 그 구간은 board-quiet 의 몫", async () => {
    const h = makeHarness();
    h.tickets[0] = ticket({
      priority: 2,
      lastActivityAtMs: h.clock.ms - 30 * MIN,
    });
    // 2026-08-22 케이스: 행(hang)에 빠진 CLI 가 스피너를 계속 그린다.
    h.health.set(
      AGENT,
      busyHealth(h.clock.ms, { lastMcpCallMs: h.clock.ms - 30 * MIN }),
    );
    await h.wd.tickOnce();
    expect(h.signals).toHaveLength(0);
    expect(h.wd.getLastProbe(TASK)?.evidence).toBe("not-applicable");
  });

  it("사람 확인 다이얼로그에 서 있으면 probe 신호 없음 — 막고 있는 건 에이전트가 아니라 사람", async () => {
    const h = makeHarness();
    h.tickets[0] = ticket({
      priority: 2,
      lastActivityAtMs: h.clock.ms - 30 * MIN,
    });
    h.health.set(
      AGENT,
      silentHealth(h.clock.ms, {
        inputWaitReason: "confirm",
        lastMcpCallMs: h.clock.ms - 30 * MIN,
      }),
    );
    await h.wd.tickOnce();
    expect(h.signals).toHaveLength(0);
  });

  it("★(a) OS 프로브: pid 가 사라졌으면 종료 이벤트가 안 왔어도 무응답으로 잡는다", async () => {
    const h = makeHarness();
    h.tickets[0] = ticket({
      priority: 2,
      lastActivityAtMs: h.clock.ms - 30 * MIN,
    });
    h.health.set(
      AGENT,
      silentHealth(h.clock.ms, { lastMcpCallMs: h.clock.ms - 20 * MIN }),
    );
    const probed: Array<number | null> = [];
    h.deps.probeProcess = async (_id, pid) => {
      probed.push(pid);
      return { alive: false, cpuMs: null, prevCpuMs: null };
    };
    await h.wd.tickOnce();

    expect(probed).toEqual([4242]); // getAgentHealth 의 ptyPid 가 그대로 흘렀다
    expect(h.signals).toHaveLength(1);
    expect(h.signals[0].signal.probe?.evidence).toBe("process-gone");
    // ★pid 가 사라졌다는 발견조차 신호일 뿐이다 — kill/respawn 을 안 만든다.
    expect(h.respawn).not.toHaveBeenCalled();
  });

  it("★(a) CPU 진행은 무응답을 '판정 불가' 로 강등만 시킨다 — 신호가 사라진다", async () => {
    const h = makeHarness();
    h.tickets[0] = ticket({
      priority: 2,
      lastActivityAtMs: h.clock.ms - 30 * MIN,
    });
    h.health.set(
      AGENT,
      silentHealth(h.clock.ms, { lastMcpCallMs: h.clock.ms - 20 * MIN }),
    );
    h.deps.probeProcess = async () => ({
      alive: true,
      cpuMs: 60_000,
      prevCpuMs: 30_000,
    });
    await h.wd.tickOnce();

    expect(h.signals).toHaveLength(0);
    expect(h.wd.getLastProbe(TASK)?.outcome).toBe("indeterminate");
    expect(h.wd.getLastProbe(TASK)?.evidence).toBe("cpu-advance");
  });

  it("★(a) 배선이 아예 없어도(신규 의존성 불허/비-macOS) (b) 만으로 정상 동작한다", async () => {
    const h = makeHarness(); // probeProcess 미배선
    h.tickets[0] = ticket({
      priority: 2,
      lastActivityAtMs: h.clock.ms - 30 * MIN,
    });
    h.health.set(
      AGENT,
      silentHealth(h.clock.ms, { lastMcpCallMs: h.clock.ms - 20 * MIN }),
    );
    await h.wd.tickOnce();
    expect(h.signals).toHaveLength(1);
    expect(h.signals[0].signal.axis).toBe("probe");
  });

  it("probeProcess 가 던져도 '멈춤' 이 되지 않는다 — 관측 실패는 그냥 (b) 결과로 간다", async () => {
    const h = makeHarness();
    h.tickets[0] = ticket({
      priority: 2,
      lastActivityAtMs: h.clock.ms - 5 * MIN, // 유예 안 → 원래 responsive
    });
    h.health.set(
      AGENT,
      silentHealth(h.clock.ms, { lastMcpCallMs: h.clock.ms - MIN }),
    );
    h.deps.probeProcess = async () => {
      throw new Error("ps exploded");
    };
    await h.wd.tickOnce();
    expect(h.signals).toHaveLength(0);
  });

  it("★상시 폴링 금지: 보드가 조용하지 않으면 OS 프로브를 아예 부르지 않는다", async () => {
    const h = makeHarness();
    h.tickets[0] = ticket({
      priority: 2,
      lastActivityAtMs: h.clock.ms - MIN,
    });
    h.health.set(
      AGENT,
      silentHealth(h.clock.ms, { lastMcpCallMs: h.clock.ms - MIN }),
    );
    const probeProcess = vi.fn(async () => null);
    h.deps.probeProcess = probeProcess;
    await h.wd.tickOnce();
    expect(probeProcess).not.toHaveBeenCalled();
    expect(h.signals).toHaveLength(0);
  });

  it("★불변식(대조군 행동 횟수 동일): probe 축을 켠 실행과 끈 실행의 nudge/respawn 횟수가 완전히 같다", async () => {
    // 이 티켓이 지켜야 할 핵심 불변식은 "probe 가 행동을 하나도 파생시키지
    // 않는다" 이다. 절대 횟수를 0 으로 못 박으면 안 된다 — 기존 사다리는 PTY
    // 침묵(graceMs)만으로도 정당하게 nudge 를 한 번 보내고, 그건 이 티켓 이전
    // 부터의 동작이다. 그래서 **같은 시나리오를 probe 켜고/끄고 두 번 돌려**
    // 행동 횟수가 동일한지를 본다. 다르면 probe 가 무언가를 파생시킨 것이다.
    async function run(probeOn: boolean): Promise<{
      nudges: number;
      respawns: number;
      phases: RecoveryPhase[];
      axes: string[];
    }> {
      const h = makeHarness(
        probeOn
          ? {}
          : {
              // 유예를 무한대로 두면 probe 는 절대 발동하지 않는다 = 이 티켓
              // 이전의 3축 워치독과 정확히 같은 상태.
              stall: {
                ...DEFAULT_STALL_POLICY,
                probeGraceMs: Number.MAX_SAFE_INTEGER,
              },
            },
      );
      h.tickets[0] = ticket({
        priority: 2,
        lastActivityAtMs: h.clock.ms - 30 * MIN,
      });
      if (probeOn) {
        h.deps.probeProcess = async () => ({
          alive: true,
          cpuMs: 0,
          prevCpuMs: 0,
        });
      }
      for (let i = 0; i < 10; i++) {
        h.health.set(
          AGENT,
          silentHealth(h.clock.ms, { lastMcpCallMs: h.clock.ms - 30 * MIN }),
        );
        await h.wd.tickOnce();
        h.clock.ms += 5 * MIN;
      }
      return {
        nudges: h.nudge.mock.calls.length,
        respawns: h.respawn.mock.calls.length,
        phases: h.records.map((r) => r.phase),
        axes: h.signals.map((s) => s.signal.axis),
      };
    }

    const on = await run(true);
    const off = await run(false);

    // ★대조군 동일 — probe 는 PTY 에도, 사다리에도 손대지 않는다.
    expect(on.nudges).toBe(off.nudges);
    expect(on.respawns).toBe(off.respawns);
    expect(on.phases.filter((p) => p !== "quiet")).toEqual(
      off.phases.filter((p) => p !== "quiet"),
    );
    // 달라지는 것은 **신호뿐**이고, 그것도 probe 축이 board-quiet 을 대체한 것.
    expect(on.axes).toContain("probe");
    expect(off.axes).not.toContain("probe");
    expect(off.axes).toContain("board-quiet");
  });

  it("MCP 호출이 다시 도착하면 유예가 재시작된다(응답함으로 되돌아감)", async () => {
    const h = makeHarness();
    h.tickets[0] = ticket({
      priority: 2,
      lastActivityAtMs: h.clock.ms - 30 * MIN,
    });
    h.health.set(
      AGENT,
      silentHealth(h.clock.ms, { lastMcpCallMs: h.clock.ms - 20 * MIN }),
    );
    await h.wd.tickOnce();
    expect(h.signals).toHaveLength(1);

    // 에이전트가 스스로 다음 MCP 호출을 했다 = 응답.
    h.clock.ms += MIN;
    h.health.set(
      AGENT,
      silentHealth(h.clock.ms, { lastMcpCallMs: h.clock.ms - 1_000 }),
    );
    await h.wd.tickOnce();
    expect(h.signals).toHaveLength(1); // 새 신호 없음
    expect(h.wd.getLastProbe(TASK)?.outcome).toBe("responsive");
  });

  it("다른 축(board-quiet)의 신호에도 프로브 결과가 함께 실린다", async () => {
    const h = makeHarness();
    // PTY busy → probe 는 not-applicable, board-quiet 이 25분에 운다.
    h.tickets[0].lastActivityAtMs = h.clock.ms - 25 * MIN;
    h.health.set(
      AGENT,
      busyHealth(h.clock.ms, { lastMcpCallMs: h.clock.ms - 25 * MIN }),
    );
    await h.wd.tickOnce();
    expect(h.signals).toHaveLength(1);
    expect(h.signals[0].signal.axis).toBe("board-quiet");
    expect(h.signals[0].signal.probe?.evidence).toBe("not-applicable");
    expect(h.signals[0].detail).toContain("프로브:");
  });
});
