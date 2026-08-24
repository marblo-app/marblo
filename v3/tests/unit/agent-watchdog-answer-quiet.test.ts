/**
 * post-answer-quiet 축의 워치독 배선 (티켓 igGI6QpXkEfrkkKN3rU0).
 *
 * 실사례: 2026-08-23 규칙배포 승인을 06:35Z 에 전달했는데 착수 활동이 07:30Z —
 * 55분 공백. 프로세스 생존, 보드 활동 있음 → exit/first-activity/board-quiet/probe
 * 어느 축에도 안 걸렸다. 이 축만 그 구간을 본다: 기준점이 스폰도 마지막 활동도
 * 아니라 **오케가 답을 전달한 시각**이기 때문이다.
 *
 * 고정하는 것:
 *   1. 답변 후 임계(12분) 무반응 → 신호 1회. ★kill/respawn/nudge 는 0회.
 *   2. ★대조군 — 답변 후 정상적으로 일하는 에이전트는 신호되지 않는다.
 *   3. 유예 안이면 신호 없음(조용한 게 아니라 이르다).
 *   4. 판정 불가(사람 대기)를 멈춤으로 뚝치지 않는다.
 *   5. 신호 문구가 "전달이 유실됐을 수 있다" 를 말한다 — 에이전트를 먼저 안 탓한다.
 *   6. 답변 맥락은 다른 축(board-quiet)의 신호에도 함께 실린다.
 *   7. lastAnswer 를 안 실어주는 호스트에선 축이 조용히 비활성이다(회귀 안전).
 */
import { describe, expect, it, vi } from "vitest";
import {
  AgentWatchdog,
  DEFAULT_WATCHDOG_CONFIG,
  type RecoveryPhase,
  type WatchdogAgentHealth,
  type WatchdogDeps,
  type WatchdogTicket,
} from "../../electron/agent-watchdog";
import {
  DEFAULT_STALL_POLICY,
  STALL_ANSWER_QUIET_MS,
  type StallSignal,
} from "../../electron/agent-stall-policy";

const MIN = 60_000;
const TASK = "igGI6QpXkEfrkkKN3rU0";
const AGENT = "backend-rules-deploy";
const QID = `${TASK}#q3`;

interface Harness {
  wd: AgentWatchdog;
  clock: { ms: number };
  tickets: WatchdogTicket[];
  health: Map<string, WatchdogAgentHealth | null>;
  nudge: ReturnType<typeof vi.fn>;
  respawn: ReturnType<typeof vi.fn>;
  signals: Array<{ signal: StallSignal; detail: string }>;
  records: Array<{ phase: RecoveryPhase; detail: string }>;
}

function makeHarness(ticketOver: Partial<WatchdogTicket> = {}): Harness {
  const clock = { ms: 100 * MIN };
  const tickets: WatchdogTicket[] = [
    {
      taskId: TASK,
      projectId: "proj-1",
      status: "IN_PROGRESS",
      role: "backend",
      agentId: AGENT,
      // 답변 시각보다 이른 활동 — 답에 대한 반응은 아니다.
      lastActivityAtMs: clock.ms - 70 * MIN,
      title: "규칙 배포",
      priority: 3,
      lastAnswer: {
        questionId: QID,
        answeredAt: clock.ms - 55 * MIN,
        delivery: "queued",
        blocking: false,
      },
      ...ticketOver,
    },
  ];
  const health = new Map<string, WatchdogAgentHealth | null>();
  const nudge = vi.fn(() => true);
  const respawn = vi.fn(async () => true);
  const signals: Harness["signals"] = [];
  const records: Harness["records"] = [];
  const deps: WatchdogDeps = {
    listActiveTickets: async () => tickets,
    getAgentHealth: (id) => health.get(id) ?? null,
    nudgeAgent: nudge,
    respawnForTicket: respawn,
    recordRecovery: (_t, phase, detail) => records.push({ phase, detail }),
    signalQuiet: (_t, signal, detail) => signals.push({ signal, detail }),
    clearQuiet: () => {},
    now: () => clock.ms,
    logger: () => {},
  };
  return {
    wd: new AgentWatchdog(deps, {
      ...DEFAULT_WATCHDOG_CONFIG,
      intervalMs: 1_000,
      stall: DEFAULT_STALL_POLICY,
    }),
    clock,
    tickets,
    health,
    nudge,
    respawn,
    signals,
    records,
  };
}

function health(
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
    lastMcpCallMs: null,
    ...over,
  };
}

describe("post-answer-quiet — 답을 전달했는데 반응이 없다", () => {
  it("★55분 실사례: 답변 후 무반응 → 신호 1회, kill/respawn/nudge 0회", async () => {
    const h = makeHarness();
    h.health.set(AGENT, health(h.clock.ms));
    await h.wd.tickOnce();

    expect(h.signals).toHaveLength(1);
    const { signal, detail } = h.signals[0];
    expect(signal.axis).toBe("post-answer-quiet");
    expect(signal.quietMs).toBe(55 * MIN);
    expect(signal.thresholdMs).toBe(STALL_ANSWER_QUIET_MS);
    expect(signal.answerQuiet?.outcome).toBe("quiet");
    expect(signal.answerQuiet?.questionId).toBe(QID);

    // ★워치독 불변식 — 신호만, 어떤 행동도 파생되지 않는다.
    expect(h.nudge).not.toHaveBeenCalled();
    expect(h.respawn).not.toHaveBeenCalled();
    expect(detail).toContain("죽이지 않습니다");
  });

  it("★신호 문구가 에이전트를 먼저 탓하지 않는다 — 전달 유실을 먼저 의심시킨다", async () => {
    const h = makeHarness();
    h.health.set(AGENT, health(h.clock.ms));
    await h.wd.tickOnce();

    const { detail } = h.signals[0];
    expect(detail).toContain("먼저 몰지 마라");
    expect(detail).toContain("에이전트가 봤다"); // queued ≠ 봤다
    expect(detail).toContain("answer-delivery-composer"); // 실측 근거 경로
  });

  it("전달 실패가 원장에 남아 있으면 책임을 전달로 돌린다", async () => {
    const h = makeHarness({
      lastAnswer: {
        questionId: QID,
        answeredAt: 100 * MIN - 55 * MIN,
        delivery: "failed",
        blocking: true,
      },
    });
    h.health.set(AGENT, health(h.clock.ms));
    await h.wd.tickOnce();

    expect(h.signals[0].signal.answerQuiet?.evidence).toBe("delivery-failed");
    expect(h.signals[0].detail).toContain("에이전트가 아니라 전달이다");
  });
});

describe("★대조군 — 오탐 금지", () => {
  it("답변 후 보드 활동이 있으면 신호 없음", async () => {
    const h = makeHarness();
    h.health.set(AGENT, health(h.clock.ms));
    // 답변(55분 전) 이후인 2분 전에 보고했다 = 정상적으로 일하는 중.
    h.tickets[0].lastActivityAtMs = h.clock.ms - 2 * MIN;
    await h.wd.tickOnce();

    expect(h.signals).toHaveLength(0);
    expect(h.nudge).not.toHaveBeenCalled();
    expect(h.respawn).not.toHaveBeenCalled();
  });

  it("보드는 조용해도 답변 이후 MCP 호출이 있으면 신호 없음", async () => {
    const h = makeHarness();
    // 읽기전용 MCP 호출은 보드를 안 올린다 — 그 구간을 침묵으로 오인하지 않는다.
    h.health.set(
      AGENT,
      health(h.clock.ms, { lastMcpCallMs: h.clock.ms - 3 * MIN }),
    );
    await h.wd.tickOnce();

    expect(
      h.signals.filter((s) => s.signal.axis === "post-answer-quiet"),
    ).toHaveLength(0);
  });

  it("유예(12분) 안이면 신호 없음 — 조용한 게 아니라 이르다", async () => {
    const h = makeHarness({
      lastAnswer: {
        questionId: QID,
        answeredAt: 100 * MIN - 5 * MIN,
        delivery: "queued",
        blocking: false,
      },
      lastActivityAtMs: 100 * MIN - 6 * MIN,
    });
    h.health.set(AGENT, health(h.clock.ms));
    await h.wd.tickOnce();

    expect(
      h.signals.filter((s) => s.signal.axis === "post-answer-quiet"),
    ).toHaveLength(0);
  });

  it("사람 확인 다이얼로그 대기 중이면 이 축은 판정하지 않는다", async () => {
    const h = makeHarness();
    h.health.set(
      AGENT,
      health(h.clock.ms, { inputWaitReason: "permission-prompt" }),
    );
    await h.wd.tickOnce();

    expect(
      h.signals.filter((s) => s.signal.axis === "post-answer-quiet"),
    ).toHaveLength(0);
  });

  it("★lastAnswer 를 안 싣는 호스트에선 이 축이 조용히 비활성이다", async () => {
    const h = makeHarness({ lastAnswer: undefined });
    h.health.set(AGENT, health(h.clock.ms));
    await h.wd.tickOnce();

    expect(
      h.signals.filter((s) => s.signal.axis === "post-answer-quiet"),
    ).toHaveLength(0);
  });
});

describe("다른 축과의 관계", () => {
  it("답변 맥락은 board-quiet 신호에도 함께 실린다", async () => {
    // 답변 이후 활동이 있어(=이 축은 acted) 자기 축은 안 울리지만, 그 활동
    // 자체가 오래돼 board-quiet 가 울리는 상황. 오케는 "이 침묵이 답을 전달한
    // 뒤의 침묵인가" 를 그 신호에서 바로 봐야 한다.
    const h = makeHarness({
      lastAnswer: {
        questionId: QID,
        answeredAt: 100 * MIN - 90 * MIN,
        delivery: "queued",
        blocking: false,
      },
      lastActivityAtMs: 100 * MIN - 50 * MIN,
      priority: 3,
    });
    h.health.set(AGENT, health(h.clock.ms));
    await h.wd.tickOnce();

    expect(h.signals).toHaveLength(1);
    const { signal } = h.signals[0];
    expect(signal.axis).toBe("board-quiet");
    expect(signal.answerQuiet?.outcome).toBe("acted");
    expect(signal.answerQuiet?.evidence).toBe("board-activity");
  });

  it("★여러 틱이 지나도 kill/respawn 은 0회 — 워치독 불변식", async () => {
    const h = makeHarness();
    h.health.set(AGENT, health(h.clock.ms));
    for (let i = 0; i < 5; i++) {
      await h.wd.tickOnce();
      // 시계를 옮기되 티켓의 나이는 **고정**한다. 그냥 시계만 밀면 보드 무활동
      // 나이가 무한히 자라 기존 복구 사다리(nudge/respawn)가 자기 사유로
      // 발동하고, 그러면 이 테스트는 "이 축이 사다리를 안 건드린다" 가 아니라
      // "사다리가 영원히 안 돈다" 를 재게 된다 — 그건 사실도 아니고 이 축의
      // 주장도 아니다. 여기서 고정하려는 것은 이 축이 어떤 행동도 파생시키지
      // 않는다는 것 하나다.
      h.clock.ms += 60 * MIN; // repeatMs(30분)를 넘겨 매번 다시 올릴 수 있게
      h.tickets[0].lastActivityAtMs = h.clock.ms - 70 * MIN;
      h.tickets[0].lastAnswer = {
        questionId: QID,
        answeredAt: h.clock.ms - 55 * MIN,
        delivery: "queued",
        blocking: false,
      };
      h.health.set(AGENT, health(h.clock.ms));
    }
    expect(h.signals.length).toBeGreaterThan(1);
    expect(h.nudge).not.toHaveBeenCalled();
    expect(h.respawn).not.toHaveBeenCalled();
    expect(h.signals.every((s) => s.signal.axis === "post-answer-quiet")).toBe(
      true,
    );
    // 기록에는 quiet 와 (기준선이 앞으로 밀릴 때의) quiet-cleared 만 남는다 —
    // 행동을 뜻하는 단계(nudge/respawn/reroute/escalated/exhausted)는 없다.
    const actionPhases: RecoveryPhase[] = [
      "nudge",
      "respawn",
      "reroute",
      "escalated",
      "exhausted",
    ];
    expect(
      h.records.filter((r) => actionPhases.includes(r.phase)),
    ).toHaveLength(0);
  });
});

describe("★오케 자신의 답변 기록이 축을 죽이지 않는다", () => {
  it("답 기록이 찍은 활동만 있으면 여전히 신호가 뜬다", async () => {
    const h = makeHarness();
    h.health.set(AGENT, health(h.clock.ms));
    // 실제 answer_question 이 만드는 상태: 답변 직후 projection.lastActivityAt
    // 이 갱신되고 요약은 "[답변] ..." 이다.
    h.tickets[0].lastActivityAtMs = h.clock.ms - 55 * MIN + 400;
    h.tickets[0].lastActivityByOrchestrator = true;
    await h.wd.tickOnce();

    const own = h.signals.filter((s) => s.signal.axis === "post-answer-quiet");
    expect(own).toHaveLength(1);
    expect(own[0].detail).toContain("오케 자신의 답변 기록");
  });

  it("그 뒤 에이전트가 실제로 보고하면(오케 기록 아님) 신호가 사라진다", async () => {
    const h = makeHarness();
    h.health.set(AGENT, health(h.clock.ms));
    h.tickets[0].lastActivityAtMs = h.clock.ms - 2 * MIN;
    h.tickets[0].lastActivityByOrchestrator = false;
    await h.wd.tickOnce();

    expect(
      h.signals.filter((s) => s.signal.axis === "post-answer-quiet"),
    ).toHaveLength(0);
  });
});
