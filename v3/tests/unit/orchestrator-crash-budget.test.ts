import { describe, it, expect, vi } from "vitest";
import { OrchestratorManager } from "../../electron/orchestrator-manager";

/**
 * Regression tests for the crash-LOOP restart budget.
 *
 * Root cause (ticket KGZwXsBXzPFJVHxHeZe2): `restartCount` gated auto-restart
 * against ORCH_MAX_RESTARTS (3) but was reset ONLY in stop(). It was never reset
 * after a healthy run, so the counter was a LIFETIME budget, not a crash-loop
 * budget. A long-lived orchestrator that crashed independently a handful of
 * times over days would hit the cap on its 4th LIFETIME crash and go permanently
 * to "error" — auto-recovery silently dead — even though every crash had
 * recovered fine. "먹통 = 핵심 서사 반증."
 *
 * The fix: `registerCrashForRestart(now)` resets the budget when the current
 * crash is more than ORCH_CRASH_LOOP_WINDOW_MS (60s) after the previous one
 * (i.e. the session had been healthy in between), so only a genuine crash loop
 * — dying again within seconds of each restart — exhausts the budget.
 *
 * These drive the REAL private decision method (the exact code the crash handler
 * calls, reached via a typed cast the way orchestratorResumeLock.test.ts reaches
 * its private lock API) with an injected clock — no faked collaborators, so the
 * bug can actually manifest. The old code has no reset path at all and fails the
 * "independent crash" case below.
 */
describe("OrchestratorManager crash-loop restart budget", () => {
  const WINDOW = 60_000; // ORCH_CRASH_LOOP_WINDOW_MS

  type CrashApi = {
    registerCrashForRestart: (now: number) => number | null;
    restartCount: number;
    lastCrashAt: number | null;
  };
  function makeManager(): OrchestratorManager & CrashApi {
    const ptyManager = { onDanger: vi.fn(() => vi.fn()) };
    return new OrchestratorManager(
      ptyManager as never,
      {} as never,
      undefined,
      "board",
    ) as OrchestratorManager & CrashApi;
  }

  it("counts a rapid crash LOOP toward the budget and gives up after ORCH_MAX_RESTARTS", () => {
    const mgr = makeManager();
    const t0 = 1_000_000;
    // Three crashes seconds apart (each restart dies almost immediately) →
    // attempts 1, 2, 3 with the 2s/4s/8s backoff schedule intact upstream.
    expect(mgr.registerCrashForRestart(t0)).toBe(1);
    expect(mgr.registerCrashForRestart(t0 + 3_000)).toBe(2);
    expect(mgr.registerCrashForRestart(t0 + 9_000)).toBe(3);
    // 4th crash still inside the loop → budget exhausted → null (give up).
    expect(mgr.registerCrashForRestart(t0 + 12_000)).toBeNull();
  });

  it("resets the budget for an INDEPENDENT crash after a healthy run (the regression)", () => {
    const mgr = makeManager();
    const t0 = 1_000_000;
    // Burn the whole budget in a tight loop.
    mgr.registerCrashForRestart(t0);
    mgr.registerCrashForRestart(t0 + 2_000);
    mgr.registerCrashForRestart(t0 + 6_000);
    expect(mgr.registerCrashForRestart(t0 + 9_000)).toBeNull(); // gave up

    // Much later — well past the crash-loop window, i.e. the orchestrator ran
    // healthy for a long time — an independent crash MUST get a fresh budget.
    // Before the fix, restartCount stayed pinned at 3 forever and this returned
    // null: auto-recovery permanently dead.
    const later = t0 + 9_000 + WINDOW + 1;
    expect(mgr.registerCrashForRestart(later)).toBe(1);
    expect(mgr.registerCrashForRestart(later + 2_000)).toBe(2);
    expect(mgr.registerCrashForRestart(later + 5_000)).toBe(3);
    expect(mgr.registerCrashForRestart(later + 7_000)).toBeNull();
  });

  it("treats the window boundary correctly (> resets, == stays counted)", () => {
    const mgr = makeManager();
    const t0 = 1_000_000;
    expect(mgr.registerCrashForRestart(t0)).toBe(1);
    // Exactly at the window — NOT strictly greater → still part of the loop.
    expect(mgr.registerCrashForRestart(t0 + WINDOW)).toBe(2);
    // Just past the window → independent → reset to attempt 1.
    expect(mgr.registerCrashForRestart(t0 + WINDOW + (WINDOW + 1))).toBe(1);
  });

  it("first-ever crash is always in budget (lastCrashAt starts null)", () => {
    const mgr = makeManager();
    expect(mgr.lastCrashAt).toBeNull();
    expect(mgr.registerCrashForRestart(500_000)).toBe(1);
    expect(mgr.restartCount).toBe(1);
    expect(mgr.lastCrashAt).toBe(500_000);
  });

  it("a slow drip of independent crashes never exhausts the budget", () => {
    const mgr = makeManager();
    // 10 crashes, each an hour apart — every one is independent, so each is a
    // fresh attempt 1. The lifetime count is irrelevant; only loops matter.
    let t = 1_000_000;
    for (let i = 0; i < 10; i += 1) {
      expect(mgr.registerCrashForRestart(t)).toBe(1);
      t += 60 * 60 * 1000;
    }
  });
});
