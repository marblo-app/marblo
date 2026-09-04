/**
 * W9 — 오래 조용한 IN_PROGRESS 티켓 감시 (티켓 nzkdcE7W6P2uGYqCa3rU, 진단 §5.4).
 *
 * 진단이 남긴 구멍: 미션 스텝에는 240초 nudge 가 있는데 **보드 티켓에는 대응물이
 * 없다**. 그래서 IN_PROGRESS 인 채로 8~9시간 무산출이 알림 없이 지나갔다.
 *
 * ★그리고 기존 감시로는 못 잡는다: detectOrphanedInProgressStall 은
 *   `ownerMissing`(이 인스턴스 메모리에 담당 에이전트가 없음)이 전제인데, 실제
 *   사고에서 담당 에이전트는 문서상 계속 `working` 이었고 메모리에도 있었다.
 *
 * ★판정 기준은 "working 표시"가 아니라 **마지막 실제 산출 시각**이다.
 *   (2026-09-04 직접 관측: 한 에이전트가 51분간 커밋이 없었고 pending instruction 은
 *   undelivered 였으며 PTY 직접 지시를 두 번 보내도 반응이 없었는데, 상태는 계속
 *   working 이었다. 상태 표시가 PTY 바이트에서 파생되기 때문에 양방향 오판이 난다.)
 *
 * ★이 축은 아무것도 회수하지 않는다 — 드러내기만 한다. 그래서 오탐의 대가가
 *   알림 하나다. 그럼에도 반대방향(정상 작업 중인 티켓은 건드리지 않는다)을 고정한다.
 */
import { describe, expect, it, vi } from "vitest";
import {
  AgentWatchdog,
  DEFAULT_WATCHDOG_CONFIG,
  detectSilentInProgressTicket,
  resolveWatchdogConfig,
  selectSilentInProgressTickets,
  type RecoveryPhase,
  type WatchdogAgentHealth,
  type WatchdogConfig,
  type WatchdogDeps,
  type WatchdogTicket,
} from "../../electron/agent-watchdog";

const MIN = 60_000;
const NOW = 1_800_000_000_000;
const THRESHOLD = DEFAULT_WATCHDOG_CONFIG.silentInProgressMs;

function ticket(over: Partial<WatchdogTicket> = {}): WatchdogTicket {
  return {
    taskId: "VCGuLWmNTlhoRvwGAKJA",
    projectId: "GFB8JnJrrX6AgahqmGB3",
    status: "IN_PROGRESS",
    role: "backend",
    agentId: "d7419238-dead-agent",
    lastActivityAtMs: NOW - 9 * 60 * MIN, // 실측 사례: 9시간 무산출
    title: "[P1] powerSaveBlocker 서스펜션",
    ...over,
  };
}

describe("detectSilentInProgressTicket — 판정 기준은 마지막 실제 산출", () => {
  it("임계를 넘겨 산출이 끊긴 IN_PROGRESS 티켓을 사유와 함께 드러낸다", () => {
    const v = detectSilentInProgressTicket(ticket(), {
      now: NOW,
      thresholdMs: THRESHOLD,
    });
    expect(v.silent).toBe(true);
    expect(v.lastOutputAtMs).toBe(NOW - 9 * 60 * MIN);
    expect(v.quietMs).toBe(9 * 60 * MIN);
    // 사유가 "무엇을 근거로 판정했는지"를 말한다 — 표시 상태가 아니라 산출 시각.
    expect(v.detail).toContain("마지막 실제 산출");
    expect(v.detail).toContain("540분");
  });

  it("★담당자가 살아 보이는지는 판정에 들어가지 않는다 (관측 5)", () => {
    // agentId 가 있든 없든, 어떤 표시 상태든 결과는 산출 시각으로만 갈린다.
    const withAgent = detectSilentInProgressTicket(
      ticket({ agentId: "looks-perfectly-alive" }),
      { now: NOW, thresholdMs: THRESHOLD },
    );
    const withoutAgent = detectSilentInProgressTicket(
      ticket({ agentId: null }),
      { now: NOW, thresholdMs: THRESHOLD },
    );
    expect(withAgent.silent).toBe(true);
    expect(withoutAgent.silent).toBe(true);
  });

  it("첫 활동 전이면 배정 시작 시각을 산출 기준으로 쓴다", () => {
    const v = detectSilentInProgressTicket(
      ticket({
        lastActivityAtMs: null,
        activeSinceMs: NOW - (THRESHOLD + MIN),
      }),
      { now: NOW, thresholdMs: THRESHOLD },
    );
    expect(v.silent).toBe(true);
  });

  describe("★반대방향 — 살아서 산출 중인 작업은 건드리지 않는다", () => {
    it("최근 활동이 있으면 조용하지 않다", () => {
      const v = detectSilentInProgressTicket(
        ticket({ lastActivityAtMs: NOW - 3 * MIN }),
        { now: NOW, thresholdMs: THRESHOLD },
      );
      expect(v.silent).toBe(false);
      expect(v.detail).toBe("");
    });

    it("임계 직전(1ms 차)에는 아직 울리지 않는다", () => {
      const v = detectSilentInProgressTicket(
        ticket({ lastActivityAtMs: NOW - (THRESHOLD - 1) }),
        { now: NOW, thresholdMs: THRESHOLD },
      );
      expect(v.silent).toBe(false);
    });

    it("정상 장시간 작업(board-quiet 45분 임계 부근)은 걸리지 않는다", () => {
      // 기존 board-quiet 신호(45분)와 겹치지 않게 넉넉히 잡았다는 것을 고정한다.
      const v = detectSilentInProgressTicket(
        ticket({ lastActivityAtMs: NOW - 50 * MIN }),
        { now: NOW, thresholdMs: THRESHOLD },
      );
      expect(v.silent).toBe(false);
      expect(THRESHOLD).toBeGreaterThan(45 * MIN);
    });

    it("IN_PROGRESS 가 아닌 티켓은 대상이 아니다", () => {
      for (const status of ["CLAIMED", "REVIEW", "DONE", "BLOCKED"] as const) {
        const v = detectSilentInProgressTicket(
          ticket({ status: status as WatchdogTicket["status"] }),
          { now: NOW, thresholdMs: THRESHOLD },
        );
        expect(v.silent).toBe(false);
      }
    });

    it("산출 흔적이 아예 없으면 판정하지 않는다 (증거의 부재 ≠ 부재의 증거)", () => {
      const v = detectSilentInProgressTicket(
        ticket({ lastActivityAtMs: null, activeSinceMs: null }),
        { now: NOW, thresholdMs: THRESHOLD },
      );
      expect(v.silent).toBe(false);
      expect(v.lastOutputAtMs).toBeNull();
    });
  });
});

describe("selectSilentInProgressTickets — 순수 필터", () => {
  it("조용한 것만 고르고 나머지는 그대로 둔다", () => {
    const quiet = ticket({ taskId: "quiet" });
    const busy = ticket({ taskId: "busy", lastActivityAtMs: NOW - MIN });
    const claimed = ticket({ taskId: "claimed", status: "CLAIMED" });
    const picked = selectSilentInProgressTickets(
      [quiet, busy, claimed],
      NOW,
      THRESHOLD,
    );
    expect(picked.map((p) => p.ticket.taskId)).toEqual(["quiet"]);
  });
});

describe("resolveWatchdogConfig — 임계 환경변수", () => {
  it("MARBLO_WATCHDOG_SILENT_IN_PROGRESS_MS 로 덮어쓸 수 있다", () => {
    const cfg = resolveWatchdogConfig({
      MARBLO_WATCHDOG_SILENT_IN_PROGRESS_MS: "600000",
    } as NodeJS.ProcessEnv);
    expect(cfg.silentInProgressMs).toBe(600_000);
  });

  it("미설정이면 기본 90분", () => {
    const cfg = resolveWatchdogConfig({} as NodeJS.ProcessEnv);
    expect(cfg.silentInProgressMs).toBe(90 * MIN);
  });
});

// ── 스윕 통합 ──────────────────────────────────────────────────────────────

interface Harness {
  wd: AgentWatchdog;
  clock: { ms: number };
  tickets: WatchdogTicket[];
  health: Map<string, WatchdogAgentHealth | null>;
  surfaced: Array<{ taskId: string; detail: string }>;
  records: Array<{ taskId: string; phase: RecoveryPhase; detail: string }>;
  resets: string[];
  respawns: string[];
}

/** 살아 있고 PTY 도 바쁜 척하는 에이전트 — "working 표시"의 재현. */
function livelyHealth(now: number): WatchdogAgentHealth {
  return {
    status: "working",
    lastPtyActivityMs: now - 1_000,
    lastWorkOutputMs: now - 1_000,
    promptIdleSinceMs: null,
    currentTaskId: "VCGuLWmNTlhoRvwGAKJA",
    agentName: "backend-1",
    concreteModel: "claude-opus-5",
    lastMcpCallMs: now - 1_000,
  } as WatchdogAgentHealth;
}

function makeHarness(cfgOver: Partial<WatchdogConfig> = {}): Harness {
  const clock = { ms: NOW };
  const tickets: WatchdogTicket[] = [ticket()];
  const health = new Map<string, WatchdogAgentHealth | null>();
  const surfaced: Harness["surfaced"] = [];
  const records: Harness["records"] = [];
  const resets: string[] = [];
  const respawns: string[] = [];
  const deps: WatchdogDeps = {
    listActiveTickets: async () => tickets,
    getAgentHealth: (id) => health.get(id) ?? null,
    nudgeAgent: vi.fn(() => true),
    respawnForTicket: vi.fn(async (t: WatchdogTicket) => {
      respawns.push(t.taskId);
      return true;
    }),
    resetStalledInProgress: async (t) => {
      resets.push(t.taskId);
      return true;
    },
    escalateStalledInProgress: (t, detail) =>
      surfaced.push({ taskId: t.taskId, detail }),
    recordRecovery: (t, phase, detail) =>
      records.push({ taskId: t.taskId, phase, detail }),
    now: () => clock.ms,
    logger: () => {},
  };
  const cfg: WatchdogConfig = {
    ...DEFAULT_WATCHDOG_CONFIG,
    intervalMs: 1_000,
    ...cfgOver,
  };
  return {
    wd: new AgentWatchdog(deps, cfg),
    clock,
    tickets,
    health,
    surfaced,
    records,
    resets,
    respawns,
  };
}

describe("W9 스윕 — 이번 사고 모양이 실제로 드러난다", () => {
  it("담당 에이전트가 'working' 으로 살아 보여도 9시간 무산출이면 드러난다", async () => {
    const h = makeHarness();
    // ★이것이 기존 감시가 못 잡던 조건이다: health 가 있으니 ownerMissing=false.
    h.health.set("d7419238-dead-agent", livelyHealth(h.clock.ms));

    await h.wd.tickOnce();

    expect(h.surfaced).toHaveLength(1);
    expect(h.surfaced[0].taskId).toBe("VCGuLWmNTlhoRvwGAKJA");
    expect(h.surfaced[0].detail).toContain("마지막 실제 산출");
    expect(
      h.records.some((r) => r.phase === "in-progress-silent"),
    ).toBe(true);
  });

  it("★드러내기만 한다 — 리셋도 재배치도 하지 않는다", async () => {
    const h = makeHarness();
    h.health.set("d7419238-dead-agent", livelyHealth(h.clock.ms));

    await h.wd.tickOnce();

    // 회수·강탈 경로는 전혀 건드리지 않는다.
    expect(h.resets).toHaveLength(0);
    expect(h.records.some((r) => r.phase === "in-progress-reset")).toBe(false);
    expect(h.tickets[0].status).toBe("IN_PROGRESS");
  });

  it("같은 티켓은 임계 간격마다 한 번씩만 다시 드러낸다", async () => {
    const h = makeHarness();
    h.health.set("d7419238-dead-agent", livelyHealth(h.clock.ms));

    await h.wd.tickOnce();
    expect(h.surfaced).toHaveLength(1);

    // 바로 다음 틱에는 다시 울리지 않는다.
    h.clock.ms += MIN;
    await h.wd.tickOnce();
    expect(h.surfaced).toHaveLength(1);

    // 임계가 한 번 더 지나면 다시 드러낸다.
    h.clock.ms += THRESHOLD;
    await h.wd.tickOnce();
    expect(h.surfaced).toHaveLength(2);
  });

  it("★반대방향: 산출을 내고 있는 티켓은 어떤 틱에서도 드러나지 않는다", async () => {
    const h = makeHarness();
    h.health.set("d7419238-dead-agent", livelyHealth(h.clock.ms));
    h.tickets[0] = ticket({ lastActivityAtMs: h.clock.ms - 2 * MIN });

    for (let i = 0; i < 5; i++) {
      h.clock.ms += MIN;
      // 매 틱마다 활동이 갱신되는 정상 작업.
      h.tickets[0] = ticket({ lastActivityAtMs: h.clock.ms - MIN });
      h.health.set("d7419238-dead-agent", livelyHealth(h.clock.ms));
      await h.wd.tickOnce();
    }

    expect(h.surfaced).toHaveLength(0);
    expect(h.records.some((r) => r.phase === "in-progress-silent")).toBe(false);
  });

  it("활성 집합을 떠났다 돌아오면 rate-limit 기억 없이 즉시 다시 드러낸다", async () => {
    const h = makeHarness();
    h.health.set("d7419238-dead-agent", livelyHealth(h.clock.ms));

    await h.wd.tickOnce();
    expect(h.surfaced).toHaveLength(1);

    // 티켓이 활성 목록에서 사라졌다(제출/재배정).
    h.tickets.length = 0;
    h.clock.ms += MIN;
    await h.wd.tickOnce();

    // 다시 IN_PROGRESS 로 돌아왔고 여전히 조용하다.
    h.tickets.push(ticket());
    h.clock.ms += MIN;
    await h.wd.tickOnce();
    expect(h.surfaced).toHaveLength(2);
  });
});
