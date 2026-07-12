/**
 * W2–W6 — watchdog hardening. Covers the new pure gates plus their behavior
 * driven through tickOnce() with the optional deps wired.
 */
import { describe, it, expect, vi } from "vitest";
import {
  AgentWatchdog,
  evaluateRespawnGuard,
  isRecoverableWatchdogStatus,
  interpretScopeHostProbe,
  selectStaleReviews,
  selectStalePendingForFallback,
  DEFAULT_WATCHDOG_CONFIG,
  type WatchdogConfig,
  type WatchdogTicket,
  type WatchdogAgentHealth,
  type WatchdogDeps,
  type RecoveryPhase,
  type StaleReviewTicket,
  type PendingInstruction,
} from "../../electron/agent-watchdog";

// ── Pure helpers ───────────────────────────────────────────────────────────

describe("evaluateRespawnGuard (W3)", () => {
  it("stands down when the bound task is already terminal", () => {
    expect(evaluateRespawnGuard({ stillRecoverable: false }).standDown).toBe(
      true,
    );
  });
  it("stands down when a live worker is already bound", () => {
    expect(evaluateRespawnGuard({ liveWorkerBound: true }).standDown).toBe(
      true,
    );
  });
  it("stands down when the original worker is fresh", () => {
    const g = evaluateRespawnGuard({
      fresh: true,
      freshReason: "commit 3s ago",
    });
    expect(g.standDown).toBe(true);
    expect(g.reason).toMatch(/commit 3s ago/);
  });
  it("proceeds (no stand-down) when no signal fires", () => {
    expect(
      evaluateRespawnGuard({
        stillRecoverable: true,
        fresh: false,
        liveWorkerBound: false,
      }).standDown,
    ).toBe(false);
  });
});

describe("interpretScopeHostProbe (W6)", () => {
  it("proceeds on null / proceed", () => {
    expect(interpretScopeHostProbe(null).blockSpawn).toBe(false);
    expect(
      interpretScopeHostProbe({ action: "proceed", reason: "" }).blockSpawn,
    ).toBe(false);
  });
  it("blocks on redispatch / block", () => {
    expect(
      interpretScopeHostProbe({ action: "redispatch", reason: "win" })
        .blockSpawn,
    ).toBe(true);
    expect(
      interpretScopeHostProbe({ action: "block", reason: "noscope" })
        .blockSpawn,
    ).toBe(true);
  });
});

describe("selectStaleReviews (W5)", () => {
  const base: StaleReviewTicket = {
    taskId: "r1",
    projectId: "p",
    assigneeAgentId: "a1",
    assigneeDead: true,
    lastActivityAtMs: 0,
    awaitingHumanApproval: false,
  };
  it("keeps only dead-assignee reviews past the threshold", () => {
    const now = 100_000_000;
    const list: StaleReviewTicket[] = [
      { ...base, taskId: "stale", lastActivityAtMs: now - 20_000 },
      { ...base, taskId: "fresh", lastActivityAtMs: now - 1_000 },
      {
        ...base,
        taskId: "alive-assignee",
        assigneeDead: false,
        lastActivityAtMs: now - 20_000,
      },
    ];
    const out = selectStaleReviews(list, now, 10_000).map((r) => r.taskId);
    expect(out).toEqual(["stale"]);
  });

  it("excludes human-approval REVIEW tickets from stale handling", () => {
    const now = 100_000_000;
    const out = selectStaleReviews(
      [
        {
          ...base,
          taskId: "human-review",
          awaitingHumanApproval: true,
          lastActivityAtMs: now - 999_999,
        },
      ],
      now,
      10_000,
    );
    expect(out).toEqual([]);
  });
});

describe("isRecoverableWatchdogStatus", () => {
  it("only allows active work statuses", () => {
    expect(isRecoverableWatchdogStatus("CLAIMED")).toBe(true);
    expect(isRecoverableWatchdogStatus("IN_PROGRESS")).toBe(true);
    for (const status of ["REVIEW", "DONE", "FAILED", "BLOCKED", "TODO"]) {
      expect(isRecoverableWatchdogStatus(status)).toBe(false);
    }
  });
});

describe("selectStalePendingForFallback (W2)", () => {
  it("keeps only instructions older than the threshold", () => {
    const now = 100_000_000;
    const list: PendingInstruction[] = [
      {
        docId: "old",
        targetAgentId: "a",
        message: "m",
        createdAtMs: now - 60_000,
      },
      {
        docId: "new",
        targetAgentId: "a",
        message: "m",
        createdAtMs: now - 1_000,
      },
    ];
    expect(
      selectStalePendingForFallback(list, now, 45_000).map((p) => p.docId),
    ).toEqual(["old"]);
  });
});

// ── Integration through tickOnce() ─────────────────────────────────────────

const AGENT = "agent-x";
const TASK = "task-x";

function ticket(over: Partial<WatchdogTicket> = {}): WatchdogTicket {
  return {
    taskId: TASK,
    projectId: "proj",
    status: "IN_PROGRESS",
    role: "backend",
    agentId: AGENT,
    lastActivityAtMs: 0,
    title: "the task",
    ...over,
  };
}

interface HarnessOpts {
  cfg?: Partial<WatchdogConfig>;
  extraDeps?: Partial<WatchdogDeps>;
  deadAgent?: boolean;
}

function makeHarness(opts: HarnessOpts = {}) {
  const clock = { ms: 1_000_000 };
  const tickets: WatchdogTicket[] = [ticket()];
  const health = new Map<string, WatchdogAgentHealth | null>();
  // Default: the bound agent is DEAD so inspect() heads toward respawn.
  if (opts.deadAgent !== false) health.set(AGENT, null);
  const respawn = vi.fn(async () => true);
  const records: Array<{
    taskId: string;
    phase: RecoveryPhase;
    detail: string;
  }> = [];
  const deps: WatchdogDeps = {
    listActiveTickets: async () => tickets,
    getAgentHealth: (id) => health.get(id) ?? null,
    nudgeAgent: vi.fn(() => true),
    respawnForTicket: respawn,
    recordRecovery: (t, phase, detail) =>
      records.push({ taskId: t.taskId, phase, detail }),
    now: () => clock.ms,
    logger: () => {},
    ...opts.extraDeps,
  };
  const cfg: WatchdogConfig = {
    ...DEFAULT_WATCHDOG_CONFIG,
    intervalMs: 1_000,
    graceMs: 10_000,
    maxRespawns: 3,
    backoffBaseMs: 1_000,
    backoffMaxMs: 8_000,
    ...opts.cfg,
  };
  return { wd: new AgentWatchdog(deps, cfg), clock, tickets, respawn, records };
}

describe("W3 — false-positive respawn guard through tickOnce", () => {
  it("stands down (no respawn) when a live worker is bound to the task", async () => {
    const h = makeHarness({
      extraDeps: { hasLiveWorkerForTask: () => true },
    });
    await h.wd.tickOnce();
    expect(h.respawn).not.toHaveBeenCalled();
    expect(h.records.some((r) => r.phase === "stand-down")).toBe(true);
  });

  it("stands down when the bound task is already terminal", async () => {
    const h = makeHarness({
      extraDeps: { isTaskStillRecoverable: async () => false },
    });
    await h.wd.tickOnce();
    expect(h.respawn).not.toHaveBeenCalled();
    expect(h.records.some((r) => r.phase === "stand-down")).toBe(true);
  });

  it("stands down when the original worker is fresh", async () => {
    const h = makeHarness({
      extraDeps: {
        probeFreshness: async () => ({ fresh: true, reason: "mtime 2s" }),
      },
    });
    await h.wd.tickOnce();
    expect(h.respawn).not.toHaveBeenCalled();
    expect(h.records.some((r) => r.phase === "stand-down")).toBe(true);
  });

  it("still respawns a genuinely dead ticket when guards say 'not handled'", async () => {
    const h = makeHarness({
      extraDeps: {
        isTaskStillRecoverable: async () => true,
        hasLiveWorkerForTask: () => false,
        probeFreshness: async () => ({ fresh: false, reason: "stale" }),
      },
    });
    await h.wd.tickOnce();
    expect(h.respawn).toHaveBeenCalledTimes(1);
  });

  it("still NUDGES a silent-but-alive bound worker (guards say 'not handled')", async () => {
    const nudge = vi.fn(() => true);
    // Alive agent, silent past grace → nudge path (not respawn). Guards present
    // but all "not handled" must NOT suppress the nudge.
    const h = makeHarness({
      deadAgent: false,
      extraDeps: {
        nudgeAgent: nudge,
        getAgentHealth: () => ({
          status: "working",
          lastPtyActivityMs: 0, // silent since epoch → past grace
          currentTaskId: TASK,
        }),
        isTaskStillRecoverable: async () => true,
        hasLiveWorkerForTask: () => false,
        probeFreshness: async () => ({ fresh: false, reason: "idle 10m" }),
      },
    });
    await h.wd.tickOnce();
    expect(nudge).toHaveBeenCalledOnce();
    expect(h.respawn).not.toHaveBeenCalled();
    expect(h.records.some((r) => r.phase === "nudge")).toBe(true);
  });
});

describe("W6 — cross-host / scope guard", () => {
  it("blocks the spawn and redispatches to origin host on a misroute", async () => {
    const redispatch = vi.fn(async () => {});
    const h = makeHarness({
      extraDeps: {
        probeScopeHost: async () => ({
          action: "redispatch",
          reason: "no scope files here",
        }),
        redispatchToOriginHost: redispatch,
      },
    });
    await h.wd.tickOnce();
    expect(h.respawn).not.toHaveBeenCalled();
    expect(redispatch).toHaveBeenCalledOnce();
    expect(h.records.some((r) => r.phase === "misroute")).toBe(true);
  });
});

describe("W4 — exhausted escalation + reroute", () => {
  it("re-routes ONCE before escalating, then escalates to a human", async () => {
    const reroute = vi.fn(async () => true);
    const escalate = vi.fn();
    // maxRespawns=0 → the very first stuck inspection is already "budget spent".
    const h = makeHarness({
      cfg: { maxRespawns: 0 },
      extraDeps: { rerouteForTicket: reroute, escalate },
    });
    // Tick 1: budget spent, first time → reroute (not escalate yet).
    await h.wd.tickOnce();
    expect(reroute).toHaveBeenCalledOnce();
    expect(escalate).not.toHaveBeenCalled();
    expect(h.records.some((r) => r.phase === "reroute")).toBe(true);

    // Advance past the reroute cooldown; the reroute produced no new activity →
    // budget still spent AND already rerouted → escalate for real.
    h.clock.ms += DEFAULT_WATCHDOG_CONFIG.backoffMaxMs + 1;
    await h.wd.tickOnce();
    expect(reroute).toHaveBeenCalledOnce(); // never re-routes twice
    expect(escalate).toHaveBeenCalledOnce();
    expect(h.records.some((r) => r.phase === "exhausted")).toBe(true);
    expect(h.records.some((r) => r.phase === "escalated")).toBe(true);
  });
});

describe("W5 — stale REVIEW sweep", () => {
  it("surfaces dead-assignee stale reviews and rate-limits re-surfacing", async () => {
    const now = 5_000_000;
    const escalateStaleReview = vi.fn();
    const candidates: StaleReviewTicket[] = [
      {
        taskId: "rev-dead",
        projectId: "p",
        title: "old review",
        assigneeAgentId: "ghost",
        assigneeDead: true,
        awaitingHumanApproval: false,
        lastActivityAtMs: now - DEFAULT_WATCHDOG_CONFIG.reviewStaleMs - 1,
      },
      {
        taskId: "rev-live",
        projectId: "p",
        assigneeAgentId: "alive",
        assigneeDead: false,
        awaitingHumanApproval: false,
        lastActivityAtMs: now - DEFAULT_WATCHDOG_CONFIG.reviewStaleMs - 1,
      },
    ];
    const h = makeHarness({
      extraDeps: {
        now: () => now,
        listActiveTickets: async () => [],
        listStaleReviewCandidates: async () => candidates,
        escalateStaleReview,
      },
    });
    await h.wd.tickOnce();
    expect(escalateStaleReview).toHaveBeenCalledOnce();
    expect(escalateStaleReview.mock.calls[0][0].taskId).toBe("rev-dead");
    // Second sweep at the same clock → rate-limited, no re-surface.
    await h.wd.tickOnce();
    expect(escalateStaleReview).toHaveBeenCalledOnce();
  });

  it("does not respawn or notify when 10+ human-approval REVIEW tickets accumulate", async () => {
    const now = 5_000_000;
    const escalateStaleReview = vi.fn();
    const candidates: StaleReviewTicket[] = Array.from(
      { length: 12 },
      (_, i) => ({
        taskId: `review-${i}`,
        projectId: "p",
        title: `review ${i}`,
        assigneeAgentId: `ghost-${i}`,
        assigneeDead: true,
        awaitingHumanApproval: true,
        lastActivityAtMs: now - DEFAULT_WATCHDOG_CONFIG.reviewStaleMs - 1,
      }),
    );
    const reviewTickets = candidates.map((c) =>
      ticket({
        taskId: c.taskId,
        status: "REVIEW" as unknown as WatchdogTicket["status"],
        agentId: c.assigneeAgentId,
        lastActivityAtMs: c.lastActivityAtMs,
      }),
    );
    const h = makeHarness({
      extraDeps: {
        now: () => now,
        listActiveTickets: async () => reviewTickets,
        listStaleReviewCandidates: async () => candidates,
        escalateStaleReview,
      },
    });

    await h.wd.tickOnce();

    expect(h.respawn).not.toHaveBeenCalled();
    expect(escalateStaleReview).not.toHaveBeenCalled();
    expect(h.records).toEqual([]);
  });
});

describe("W2 — undelivered pending-instruction fallback", () => {
  it("force-delivers a stale undelivered instruction via direct PTY, once", async () => {
    const now = 9_000_000;
    const deliver = vi.fn(() => true);
    const mark = vi.fn(async () => {});
    const pending: PendingInstruction[] = [
      {
        docId: "pi-1",
        targetAgentId: AGENT,
        message: "continue please",
        createdAtMs: now - DEFAULT_WATCHDOG_CONFIG.pendingFallbackMs - 1,
      },
    ];
    const h = makeHarness({
      extraDeps: {
        now: () => now,
        listActiveTickets: async () => [],
        listUndeliveredInstructions: async () => pending,
        deliverInstructionDirect: deliver,
        markInstructionDelivered: mark,
      },
    });
    await h.wd.tickOnce();
    expect(deliver).toHaveBeenCalledWith(AGENT, "continue please");
    expect(mark).toHaveBeenCalledWith("pi-1");
    // Second sweep → already attempted, not re-delivered.
    await h.wd.tickOnce();
    expect(deliver).toHaveBeenCalledOnce();
  });

  it("does NOT mark delivered when the agent isn't hosted here", async () => {
    const now = 9_000_000;
    const deliver = vi.fn(() => false); // not local
    const mark = vi.fn(async () => {});
    const h = makeHarness({
      extraDeps: {
        now: () => now,
        listActiveTickets: async () => [],
        listUndeliveredInstructions: async () => [
          {
            docId: "pi-2",
            targetAgentId: "remote",
            message: "hi",
            createdAtMs: now - 999_999,
          },
        ],
        deliverInstructionDirect: deliver,
        markInstructionDelivered: mark,
      },
    });
    await h.wd.tickOnce();
    expect(deliver).toHaveBeenCalledOnce();
    expect(mark).not.toHaveBeenCalled();
  });
});
