/**
 * W7 — mid-task idle detection.
 *
 * Two failures are in tension here and this file pins BOTH ends:
 *
 *   1. The miss (why this exists): an agent that fell back to its input prompt
 *      mid-task was never recovered. Not late — never. Its PTY was alive, and
 *      the prompt's own repaint kept bumping the liveness clock, so `silent`
 *      could not become true no matter how long it sat there.
 *   2. The false kill (why it must stay narrow): a reasoning agent is PTY-silent
 *      for long stretches. Killing it is the expensive mistake — the
 *      2026-07-18 watchdog-false-death storm. Silence must NEVER be the trigger.
 *
 * The tests below alternate deliberately: catch, then don't-catch.
 */
import { describe, it, expect, vi } from "vitest";
import {
  AgentWatchdog,
  DEFAULT_WATCHDOG_CONFIG,
  resolveWatchdogConfig,
  evaluatePromptIdleStall,
  evaluateRespawnGuard,
  type WatchdogConfig,
  type WatchdogTicket,
  type WatchdogAgentHealth,
  type WatchdogDeps,
  type RecoveryPhase,
} from "../../electron/agent-watchdog";

const TASK = "task-1";
const AGENT = "agent-1";

interface Harness {
  wd: AgentWatchdog;
  clock: { ms: number };
  ticket: WatchdogTicket;
  health: WatchdogAgentHealth;
  nudge: ReturnType<typeof vi.fn>;
  respawn: ReturnType<typeof vi.fn>;
  records: Array<{ phase: RecoveryPhase; detail: string }>;
  advance: (ms: number) => void;
}

function makeHarness(
  over: {
    cfg?: Partial<WatchdogConfig>;
    health?: Partial<WatchdogAgentHealth>;
    deps?: Partial<WatchdogDeps>;
  } = {},
): Harness {
  const clock = { ms: 1_000_000 };
  const ticket: WatchdogTicket = {
    taskId: TASK,
    projectId: "proj-1",
    status: "IN_PROGRESS",
    role: "backend",
    agentId: AGENT,
    lastActivityAtMs: clock.ms,
    title: "do the thing",
  };
  const health: WatchdogAgentHealth = {
    status: "working",
    // ★The trap: raw PTY bytes keep flowing while the agent sits at its prompt.
    // Every test keeps this pinned to "now" so nothing can pass by accident.
    lastPtyActivityMs: clock.ms,
    lastWorkOutputMs: clock.ms,
    promptIdleSinceMs: null,
    currentTaskId: TASK,
    ...over.health,
  };
  const nudge = vi.fn(() => true);
  const respawn = vi.fn(async () => true);
  const records: Harness["records"] = [];

  const deps: WatchdogDeps = {
    listActiveTickets: async () => [ticket],
    getAgentHealth: (id) => (id === AGENT ? health : null),
    nudgeAgent: nudge,
    respawnForTicket: respawn,
    recordRecovery: (_t, phase, detail) => records.push({ phase, detail }),
    now: () => clock.ms,
    logger: () => {},
    ...over.deps,
  };

  const cfg: WatchdogConfig = {
    ...DEFAULT_WATCHDOG_CONFIG,
    intervalMs: 60_000,
    ...over.cfg,
  };

  return {
    wd: new AgentWatchdog(deps, cfg),
    clock,
    ticket,
    health,
    nudge,
    respawn,
    records,
    advance: (ms) => {
      clock.ms += ms;
      // The prompt repaints the whole time — raw PTY activity never goes stale.
      health.lastPtyActivityMs = clock.ms;
    },
  };
}

/** Get past the born-dead window: the worker posts one activity after the
 * watchdog's first observation, which is what that window waits for. */
async function settleFirstActivity(h: Harness): Promise<void> {
  await h.wd.tickOnce();
  h.advance(1_000);
  h.ticket.lastActivityAtMs = h.clock.ms;
  h.health.lastWorkOutputMs = h.clock.ms;
  await h.wd.tickOnce();
  h.nudge.mockClear();
  h.respawn.mockClear();
  h.records.length = 0;
}

/** Park the agent at its input prompt as of now. */
function park(h: Harness): void {
  h.health.promptIdleSinceMs = h.clock.ms;
  // lastWorkOutputMs stops advancing from here — prompt repaint is not work.
}

describe("W7 — catching the agent that stopped", () => {
  it("★parked at the prompt past promptIdleGrace → nudged, well before graceMs", async () => {
    const h = makeHarness();
    await settleFirstActivity(h);
    park(h);

    h.advance(100_000); // > promptIdleGrace (90s), far under graceMs (300s)
    await h.wd.tickOnce();

    expect(h.nudge).toHaveBeenCalledTimes(1);
    expect(h.respawn).not.toHaveBeenCalled();
    expect(h.records[0].phase).toBe("nudge");
    expect(h.records[0].detail).toContain("idle-at-prompt");
  });

  it("stays quiet before the window elapses", async () => {
    const h = makeHarness();
    await settleFirstActivity(h);
    park(h);

    h.advance(60_000); // < 90s
    await h.wd.tickOnce();

    expect(h.nudge).not.toHaveBeenCalled();
    expect(h.respawn).not.toHaveBeenCalled();
  });

  it("a worker still posting to the board is working, whatever its terminal paints", async () => {
    const h = makeHarness();
    await settleFirstActivity(h);
    park(h);

    h.advance(100_000);
    h.ticket.lastActivityAtMs = h.clock.ms - 10_000; // just reported progress
    await h.wd.tickOnce();

    expect(h.nudge).not.toHaveBeenCalled();
    expect(h.respawn).not.toHaveBeenCalled();
  });

  it("★prompt-idle NEVER respawns on its own — nudge budget must be spent first", async () => {
    const h = makeHarness();
    await settleFirstActivity(h);
    park(h);

    // Nudge 1.
    h.advance(100_000);
    await h.wd.tickOnce();
    expect(h.nudge).toHaveBeenCalledTimes(1);
    expect(h.respawn).not.toHaveBeenCalled();

    // Nudge 2 (after the nudge cooldown). The agent is still parked and still
    // silent on the board — i.e. it was asked to continue and did not.
    h.advance(130_000);
    await h.wd.tickOnce();
    expect(h.nudge).toHaveBeenCalledTimes(2);
    expect(h.respawn).not.toHaveBeenCalled();

    // Only now, with the budget spent, does the ladder escalate.
    h.advance(130_000);
    await h.wd.tickOnce();
    expect(h.respawn).toHaveBeenCalledTimes(1);
    const respawnRecord = h.records.find((r) => r.phase === "respawn");
    expect(respawnRecord?.detail).toContain("idle at prompt");
  });

  it("the ladder is the EXISTING one — a recovered agent resets its budget", async () => {
    const h = makeHarness();
    await settleFirstActivity(h);
    park(h);

    h.advance(100_000);
    await h.wd.tickOnce();
    expect(h.nudge).toHaveBeenCalledTimes(1);

    // The nudge landed: the agent un-parks and reports progress.
    h.advance(5_000);
    h.health.promptIdleSinceMs = null;
    h.health.lastWorkOutputMs = h.clock.ms;
    h.ticket.lastActivityAtMs = h.clock.ms;
    await h.wd.tickOnce();

    expect(h.records.some((r) => r.phase === "recovered")).toBe(true);
    expect(h.respawn).not.toHaveBeenCalled();
  });

  it("discounting prompt repaint also un-breaks the plain silence path", async () => {
    // No idle marker for this harness (grok/local) — so no acceleration — but
    // the work clock still ignores the composer repaint, so the ordinary
    // graceMs rung finally fires instead of being held off forever.
    const h = makeHarness();
    await settleFirstActivity(h);
    const frozen = h.health.lastWorkOutputMs;

    h.advance(310_000); // > graceMs; raw PTY activity is still "now"
    expect(h.health.lastPtyActivityMs).toBe(h.clock.ms);
    expect(h.health.lastWorkOutputMs).toBe(frozen);
    await h.wd.tickOnce();

    expect(h.nudge).toHaveBeenCalledTimes(1);
    expect(h.records[0].detail).toContain("silent");
  });
});

describe("W7 — false-kill regression (추론 중 조용한 에이전트 보호)", () => {
  it("★a reasoning agent (PTY totally silent, never parked) is untouched inside graceMs", async () => {
    const h = makeHarness();
    await settleFirstActivity(h);
    // Deep inference: no bytes at all. Not parked — silence produces no frame,
    // so promptIdleSince stays null.
    h.health.promptIdleSinceMs = null;

    for (const step of [90_000, 60_000, 60_000, 60_000]) {
      h.advance(step);
      h.health.lastPtyActivityMs = h.health.lastWorkOutputMs as number; // truly mute
      await h.wd.tickOnce();
    }
    // 270s of total silence — past the 90s prompt-idle window three times over.
    expect(h.nudge).not.toHaveBeenCalled();
    expect(h.respawn).not.toHaveBeenCalled();
  });

  it("past graceMs a silent agent is still only NUDGED, on the old slow path", async () => {
    const h = makeHarness();
    await settleFirstActivity(h);
    h.health.promptIdleSinceMs = null;

    h.advance(310_000);
    h.health.lastPtyActivityMs = h.health.lastWorkOutputMs as number;
    await h.wd.tickOnce();

    expect(h.nudge).toHaveBeenCalledTimes(1);
    expect(h.respawn).not.toHaveBeenCalled();
    expect(h.records[0].detail).not.toContain("idle-at-prompt");
  });

  it("a harness with no verified idle marker never accelerates (host reports null)", async () => {
    const h = makeHarness({ health: { promptIdleSinceMs: null } });
    await settleFirstActivity(h);
    h.advance(200_000);
    await h.wd.tickOnce();
    expect(h.nudge).not.toHaveBeenCalled();
  });

  it("a legacy host that reports no classified clocks behaves exactly as before", async () => {
    // lastWorkOutputMs/promptIdleSinceMs absent → fall back to raw PTY bytes.
    const h = makeHarness({
      health: { lastWorkOutputMs: undefined, promptIdleSinceMs: undefined },
    });
    await settleFirstActivity(h);
    h.health.lastWorkOutputMs = undefined; // settle() re-stamped it; clear again
    h.advance(600_000); // 10 min of repaint
    await h.wd.tickOnce();
    expect(h.nudge).not.toHaveBeenCalled();
    expect(h.respawn).not.toHaveBeenCalled();
  });

  it("a locally-dead/missing agent is never judged by this signal", async () => {
    const stale = evaluatePromptIdleStall({
      promptIdleSinceMs: 1_000,
      lastBoardActivityMs: 1_000,
      now: 1_000_000,
      graceMs: 90_000,
      agentLocallyLive: false,
    });
    expect(stale.stalled).toBe(false);
  });
});

describe("W7 — interaction with the W3 stand-down guards", () => {
  it("a terminal ticket still stands down, parked or not", () => {
    const g = evaluateRespawnGuard({
      stillRecoverable: false,
      promptIdleProven: true,
    });
    expect(g.standDown).toBe(true);
  });

  it("a live worker bound elsewhere still forbids a duplicate, parked or not", () => {
    const g = evaluateRespawnGuard({
      liveWorkerBound: true,
      promptIdleProven: true,
    });
    expect(g.standDown).toBe(true);
  });

  it("worktree freshness still stands down when the stall is only inferred from silence", () => {
    const g = evaluateRespawnGuard({
      fresh: true,
      freshReason: "worktree touched 40s ago",
    });
    expect(g.standDown).toBe(true);
  });

  it("★but a ready input prompt beats a fresh mtime — the agent stalled right after its last write", async () => {
    const h = makeHarness({
      deps: {
        probeFreshness: async () => ({
          fresh: true,
          reason: "worktree touched 40s ago",
        }),
      },
    });
    await settleFirstActivity(h);
    park(h);
    h.advance(100_000);
    await h.wd.tickOnce();

    expect(h.records.some((r) => r.phase === "stand-down")).toBe(false);
    expect(h.nudge).toHaveBeenCalledTimes(1);
  });
});

describe("W7 — config", () => {
  it("defaults: the prompt-idle window is far shorter than the silence grace", () => {
    expect(DEFAULT_WATCHDOG_CONFIG.promptIdleGraceMs).toBe(90_000);
    expect(DEFAULT_WATCHDOG_CONFIG.promptIdleGraceMs).toBeLessThan(
      DEFAULT_WATCHDOG_CONFIG.graceMs,
    );
  });

  it("env override is honored", () => {
    const cfg = resolveWatchdogConfig({
      MARBLO_WATCHDOG_PROMPT_IDLE_MS: "45000",
    } as NodeJS.ProcessEnv);
    expect(cfg.promptIdleGraceMs).toBe(45_000);
  });

  it("garbage env falls back to the default", () => {
    const cfg = resolveWatchdogConfig({
      MARBLO_WATCHDOG_PROMPT_IDLE_MS: "-1",
    } as NodeJS.ProcessEnv);
    expect(cfg.promptIdleGraceMs).toBe(
      DEFAULT_WATCHDOG_CONFIG.promptIdleGraceMs,
    );
  });
});
