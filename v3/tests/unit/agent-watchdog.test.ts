import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AgentWatchdog,
  resolveWatchdogConfig,
  DEFAULT_WATCHDOG_CONFIG,
  type WatchdogConfig,
  type WatchdogTicket,
  type WatchdogAgentHealth,
  type WatchdogDeps,
  type RecoveryPhase,
} from "../../electron/agent-watchdog";

// ── Harness ──────────────────────────────────────────────────────────────
// A controllable clock + injectable ports, mirroring how the production
// watchdog is wired (listActiveTickets from Firestore, getAgentHealth from
// AgentManager, nudge via PtyManager, respawn via bridge dispatchTask).

const TASK = "task-1";
const AGENT = "agent-1";

function ticket(over: Partial<WatchdogTicket> = {}): WatchdogTicket {
  return {
    taskId: TASK,
    projectId: "proj-1",
    status: "IN_PROGRESS",
    role: "backend",
    agentId: AGENT,
    lastActivityAtMs: 0,
    title: "do the thing",
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
  records: Array<{ taskId: string; phase: RecoveryPhase; detail: string }>;
}

function makeHarness(cfgOver: Partial<WatchdogConfig> = {}): Harness {
  const clock = { ms: 1_000_000 };
  const tickets: WatchdogTicket[] = [ticket()];
  const health = new Map<string, WatchdogAgentHealth | null>();
  const nudge = vi.fn(() => true);
  const respawn = vi.fn(async () => true);
  const records: Harness["records"] = [];

  const deps: WatchdogDeps = {
    listActiveTickets: async () => tickets,
    getAgentHealth: (id) => health.get(id) ?? null,
    nudgeAgent: nudge,
    respawnForTicket: respawn,
    recordRecovery: (t, phase, detail) =>
      records.push({ taskId: t.taskId, phase, detail }),
    now: () => clock.ms,
    logger: () => {},
  };

  const cfg: WatchdogConfig = {
    ...DEFAULT_WATCHDOG_CONFIG,
    intervalMs: 1_000,
    graceMs: 10_000,
    nudgeIntervalMs: 5_000,
    maxNudges: 2,
    maxRespawns: 3,
    backoffBaseMs: 1_000,
    backoffMaxMs: 8_000,
    ...cfgOver,
  };

  return {
    wd: new AgentWatchdog(deps, cfg),
    clock,
    tickets,
    health,
    nudge,
    respawn,
    records,
  };
}

describe("resolveWatchdogConfig", () => {
  it("defaults are sane and enabled", () => {
    const c = resolveWatchdogConfig({} as NodeJS.ProcessEnv);
    expect(c.enabled).toBe(true);
    expect(c.intervalMs).toBe(DEFAULT_WATCHDOG_CONFIG.intervalMs);
    expect(c.graceMs).toBe(DEFAULT_WATCHDOG_CONFIG.graceMs);
  });

  it("env overrides interval/grace/enable", () => {
    const c = resolveWatchdogConfig({
      MARBLO_WATCHDOG_ENABLED: "false",
      MARBLO_WATCHDOG_INTERVAL_MS: "30000",
      MARBLO_WATCHDOG_GRACE_MS: "90000",
      MARBLO_WATCHDOG_MAX_NUDGES: "5",
    } as unknown as NodeJS.ProcessEnv);
    expect(c.enabled).toBe(false);
    expect(c.intervalMs).toBe(30000);
    expect(c.graceMs).toBe(90000);
    expect(c.maxNudges).toBe(5);
  });

  it("ignores non-positive / garbage env values", () => {
    const c = resolveWatchdogConfig({
      MARBLO_WATCHDOG_INTERVAL_MS: "-5",
      MARBLO_WATCHDOG_GRACE_MS: "abc",
    } as unknown as NodeJS.ProcessEnv);
    expect(c.intervalMs).toBe(DEFAULT_WATCHDOG_CONFIG.intervalMs);
    expect(c.graceMs).toBe(DEFAULT_WATCHDOG_CONFIG.graceMs);
  });
});

describe("AgentWatchdog — detection", () => {
  it("does nothing for a healthy, recently-active agent", async () => {
    const h = makeHarness();
    h.health.set(AGENT, {
      status: "working",
      lastPtyActivityMs: h.clock.ms, // fresh
      currentTaskId: TASK,
    });
    await h.wd.tickOnce();
    expect(h.nudge).not.toHaveBeenCalled();
    expect(h.respawn).not.toHaveBeenCalled();
  });

  it("dead agent (PTY exited → stopped) is respawned immediately, no nudge", async () => {
    const h = makeHarness();
    h.health.set(AGENT, {
      status: "stopped",
      lastPtyActivityMs: h.clock.ms,
      currentTaskId: TASK,
    });
    await h.wd.tickOnce();
    expect(h.nudge).not.toHaveBeenCalled();
    expect(h.respawn).toHaveBeenCalledTimes(1);
    expect(h.respawn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: TASK, agentId: AGENT }),
    );
    expect(h.records.some((r) => r.phase === "respawn")).toBe(true);
  });

  it("agent removed entirely (health null) is treated as dead → respawn", async () => {
    const h = makeHarness();
    h.health.set(AGENT, null);
    await h.wd.tickOnce();
    expect(h.respawn).toHaveBeenCalledTimes(1);
  });

  it("error status (auto-restart gave up) → respawn", async () => {
    const h = makeHarness();
    h.health.set(AGENT, {
      status: "error",
      lastPtyActivityMs: h.clock.ms,
      currentTaskId: TASK,
    });
    await h.wd.tickOnce();
    expect(h.respawn).toHaveBeenCalledTimes(1);
  });

  it("alive-but-silent agent (past grace) is nudged first, not respawned", async () => {
    const h = makeHarness();
    h.health.set(AGENT, {
      status: "working",
      lastPtyActivityMs: h.clock.ms - 20_000, // 20s silent, grace=10s
      currentTaskId: TASK,
    });
    h.tickets[0].lastActivityAtMs = h.clock.ms - 20_000;
    await h.wd.tickOnce();
    expect(h.nudge).toHaveBeenCalledTimes(1);
    expect(h.respawn).not.toHaveBeenCalled();
  });

  it("recent board activity keeps a silent PTY from being flagged", async () => {
    const h = makeHarness();
    // PTY quiet but the agent logged board activity 1s ago → not stuck.
    h.health.set(AGENT, {
      status: "working",
      lastPtyActivityMs: h.clock.ms - 60_000,
      currentTaskId: TASK,
    });
    h.tickets[0].lastActivityAtMs = h.clock.ms - 1_000;
    await h.wd.tickOnce();
    expect(h.nudge).not.toHaveBeenCalled();
    expect(h.respawn).not.toHaveBeenCalled();
  });
});

describe("AgentWatchdog — recovery-only guard", () => {
  it("NEVER touches a ticket with no assigned agent (no auto-claim)", async () => {
    const h = makeHarness();
    h.tickets[0] = ticket({ agentId: null, status: "CLAIMED" });
    await h.wd.tickOnce();
    expect(h.nudge).not.toHaveBeenCalled();
    expect(h.respawn).not.toHaveBeenCalled();
  });

  it("only sees CLAIMED/IN_PROGRESS — TODO never reaches the sweep", async () => {
    // listActiveTickets is the recovery-only filter; a TODO would simply not
    // appear. Verify an empty active set performs no recovery action.
    const h = makeHarness();
    h.tickets.length = 0;
    await h.wd.tickOnce();
    expect(h.nudge).not.toHaveBeenCalled();
    expect(h.respawn).not.toHaveBeenCalled();
  });
});

describe("AgentWatchdog — escalation, backoff & caps", () => {
  it("nudges up to maxNudges, then escalates to respawn", async () => {
    const h = makeHarness({ maxNudges: 2, nudgeIntervalMs: 5_000 });
    const silent = () =>
      h.health.set(AGENT, {
        status: "working",
        lastPtyActivityMs: 0, // permanently silent
        currentTaskId: TASK,
      });
    silent();

    // tick 1: nudge #1
    await h.wd.tickOnce();
    expect(h.nudge).toHaveBeenCalledTimes(1);

    // immediate re-tick: inside nudge cooldown → no action
    await h.wd.tickOnce();
    expect(h.nudge).toHaveBeenCalledTimes(1);

    // advance past nudge interval: nudge #2
    h.clock.ms += 5_001;
    await h.wd.tickOnce();
    expect(h.nudge).toHaveBeenCalledTimes(2);

    // advance again: nudge budget spent → respawn
    h.clock.ms += 5_001;
    await h.wd.tickOnce();
    expect(h.nudge).toHaveBeenCalledTimes(2);
    expect(h.respawn).toHaveBeenCalledTimes(1);
  });

  it("respawn uses exponential backoff and stops at maxRespawns", async () => {
    const h = makeHarness({
      maxRespawns: 3,
      backoffBaseMs: 1_000,
      backoffMaxMs: 8_000,
    });
    h.health.set(AGENT, {
      status: "stopped", // dead → straight to respawn
      lastPtyActivityMs: 0,
      currentTaskId: TASK,
    });

    // respawn #1
    await h.wd.tickOnce();
    expect(h.respawn).toHaveBeenCalledTimes(1);

    // within backoff (1s) → no action
    h.clock.ms += 500;
    await h.wd.tickOnce();
    expect(h.respawn).toHaveBeenCalledTimes(1);

    // past backoff #1 (1s) → respawn #2 (backoff now 2s)
    h.clock.ms += 600;
    await h.wd.tickOnce();
    expect(h.respawn).toHaveBeenCalledTimes(2);

    // past backoff #2 (2s) → respawn #3
    h.clock.ms += 2_001;
    await h.wd.tickOnce();
    expect(h.respawn).toHaveBeenCalledTimes(3);

    // budget spent → exhausted, never respawns again even far in the future
    h.clock.ms += 100_000;
    await h.wd.tickOnce();
    expect(h.respawn).toHaveBeenCalledTimes(3);
    expect(h.records.some((r) => r.phase === "exhausted")).toBe(true);
  });
});

describe("AgentWatchdog — recovery resets state", () => {
  it("records stuck→recovered and resets budget when activity resumes", async () => {
    const h = makeHarness();
    h.health.set(AGENT, {
      status: "stopped",
      lastPtyActivityMs: 0,
      currentTaskId: TASK,
    });

    // respawn #1
    await h.wd.tickOnce();
    expect(h.respawn).toHaveBeenCalledTimes(1);

    // respawned worker comes alive and emits activity
    h.clock.ms += 3_000;
    h.health.set(AGENT, {
      status: "working",
      lastPtyActivityMs: h.clock.ms,
      currentTaskId: TASK,
    });
    h.tickets[0].lastActivityAtMs = h.clock.ms;
    await h.wd.tickOnce();
    expect(h.records.some((r) => r.phase === "recovered")).toBe(true);

    // dies again later → budget was reset, so it respawns fresh (not exhausted)
    h.clock.ms += 50_000;
    h.health.set(AGENT, {
      status: "stopped",
      lastPtyActivityMs: h.clock.ms - 60_000,
      currentTaskId: TASK,
    });
    await h.wd.tickOnce();
    expect(h.respawn).toHaveBeenCalledTimes(2);
  });

  it("prunes per-ticket state when the ticket leaves the active set", async () => {
    const h = makeHarness();
    h.health.set(AGENT, {
      status: "stopped",
      lastPtyActivityMs: 0,
      currentTaskId: TASK,
    });
    await h.wd.tickOnce();
    expect(h.respawn).toHaveBeenCalledTimes(1);

    // Ticket submitted/closed → drops out of the active list.
    h.tickets.length = 0;
    await h.wd.tickOnce();

    // Comes back stuck much later: a pruned state means a fresh budget, so it
    // acts immediately (no leftover cooldown blocking it).
    h.tickets.push(ticket());
    h.clock.ms += 100; // well within the old backoff window
    await h.wd.tickOnce();
    expect(h.respawn).toHaveBeenCalledTimes(2);
  });
});

describe("AgentWatchdog — lifecycle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("disabled config never starts a timer", () => {
    const setInt = vi.spyOn(global, "setInterval");
    const wd = new AgentWatchdog(
      {
        listActiveTickets: async () => [],
        getAgentHealth: () => null,
        nudgeAgent: () => true,
        respawnForTicket: async () => true,
      },
      { ...DEFAULT_WATCHDOG_CONFIG, enabled: false },
    );
    wd.start();
    expect(setInt).not.toHaveBeenCalled();
    wd.stop();
  });

  it("start() schedules sweeps; stop() clears the timer", async () => {
    const list = vi.fn(async () => []);
    const wd = new AgentWatchdog(
      {
        listActiveTickets: list,
        getAgentHealth: () => null,
        nudgeAgent: () => true,
        respawnForTicket: async () => true,
      },
      { ...DEFAULT_WATCHDOG_CONFIG, enabled: true, intervalMs: 1_000 },
    );
    wd.start();
    // Async advance flushes the awaited sweep between ticks so the coalescing
    // `sweeping` guard releases before the next interval fires.
    await vi.advanceTimersByTimeAsync(3_500);
    expect(list).toHaveBeenCalledTimes(3);
    wd.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(list).toHaveBeenCalledTimes(3); // no more sweeps after stop
  });
});
