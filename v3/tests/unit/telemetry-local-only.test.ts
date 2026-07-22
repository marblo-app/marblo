/**
 * First-party telemetry gate contract (production ON — CEO-approved 2026-07-17,
 * de-identified 1st-party aggregate; gate default flipped ON in PR#397).
 *
 * Proves:
 *  - the gate is ON by default (no flags) so real-user metrics flow,
 *  - the hard kill-switch (VITE_DISABLE_TELEMETRY=1) forces OFF,
 *  - a runtime opt-out (setTelemetryEnabled(false)) stops external sends,
 *  - default-on sends are de-identified (anonymous clientId, no uid/PII) and
 *    carry the installed appVersion instead of the old server "3.0.0" fallback.
 *
 * The two-direction check (opt-out stops the send, opt-in resumes it) keeps this
 * a real gate rather than a dead path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// One spy stands in for every httpsCallable handle (logTelemetryBatch,
// logHeartbeat, …).
const callableSpy = vi.fn(() => Promise.resolve({ data: {} }));

vi.mock("firebase/functions", () => ({
  httpsCallable: () => callableSpy,
}));

// Mock lib/firebase so importing telemetryService never boots real Firebase
// (auth/functions/firestore) in the node test env. auth.currentUser is present
// so flush() is NOT gated by auth — the ONLY thing that should stop a send is
// the telemetry gate itself.
vi.mock("../../src/lib/firebase", () => ({
  functions: {},
  auth: { currentUser: { uid: "test-uid" } },
  db: {},
}));

describe("firstPartyTelemetryDefaultEnabled (gate)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("is ON by default when no flags are set (production real-users)", async () => {
    const { firstPartyTelemetryDefaultEnabled } =
      await import("../../src/lib/telemetry/firstPartyGate");
    expect(firstPartyTelemetryDefaultEnabled()).toBe(true);
  });

  it("kill-switch (VITE_DISABLE_TELEMETRY=1) forces OFF", async () => {
    vi.stubEnv("VITE_DISABLE_TELEMETRY", "1");
    const { firstPartyTelemetryDefaultEnabled } =
      await import("../../src/lib/telemetry/firstPartyGate");
    expect(firstPartyTelemetryDefaultEnabled()).toBe(false);
  });
});

describe("telemetryService external send", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    callableSpy.mockClear();
    vi.resetModules();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sends de-identified events by default and stamps appVersion", async () => {
    // __APP_VERSION__ is a Vite build-time define; stub it for the node env so we
    // can assert it reaches the payload (real builds inline package.json version).
    vi.stubGlobal("__APP_VERSION__", "9.9.9");
    const { telemetry } = await import("../../src/services/telemetryService");

    telemetry.tokenUsage("a1", "claude", 10, 20, 0.5, "p1");
    await telemetry.flush();

    expect(callableSpy).toHaveBeenCalledTimes(1);
    const sent = callableSpy.mock.calls[0][0] as {
      events: Array<Record<string, unknown>>;
    };
    const ev = sent.events[0];
    // De-identified: anonymous clientId stands in for any account identifier,
    // and no Firebase uid / email leaks into the row.
    expect(ev.clientId).toBeDefined();
    expect(ev.uid).toBeUndefined();
    expect(ev.email).toBeUndefined();
    // Real installed version, not the retired server "3.0.0" fallback.
    expect(ev.appVersion).toBe("9.9.9");
  });

  it("folds lifecycle outcome labels into metadata for BigQuery", async () => {
    const { logTelemetry, telemetry } = await import(
      "../../src/services/telemetryService"
    );

    logTelemetry({
      event: "agent:went_stale",
      taskId: "task-1",
      agentId: "agent-1",
      model: "antigravity",
      role: "backend",
      outcome: "stale",
      dispatchReason: "Scored 3 model(s) -> antigravity. Spawned new agent.",
    });
    await telemetry.flush();

    const sent = callableSpy.mock.calls[0][0] as {
      events: Array<Record<string, unknown>>;
    };
    expect(sent.events[0]).toMatchObject({
      taskId: "task-1",
      model: "antigravity",
      metadata: {
        outcome: "stale",
        dispatchReason:
          "Scored 3 model(s) -> antigravity. Spawned new agent.",
      },
    });
  });

  it("sends 0 external events after a runtime opt-out", async () => {
    const { telemetry, setTelemetryEnabled } =
      await import("../../src/services/telemetryService");

    setTelemetryEnabled(false);
    telemetry.tokenUsage("a1", "claude", 10, 20, 0.5, "p1");
    telemetry.taskCompleted("t1", 1000, "a1");
    await telemetry.flush();
    vi.advanceTimersByTime(60_000);
    await Promise.resolve();

    expect(callableSpy).not.toHaveBeenCalled();
  });
});
