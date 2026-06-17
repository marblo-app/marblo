/**
 * Local-only telemetry guarantee (PIPA, 6/23 build).
 *
 * Proves that with the first-party telemetry gate OFF (the default — no build
 * flag, no opt-in), NO external send fires: the Firebase callable that ships
 * events to BigQuery is never invoked. Flipping the gate on (build flag or
 * runtime opt-in) restores the send — so OFF is a real gate, not a dead path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// One spy stands in for every httpsCallable handle (logTelemetryBatch,
// logHeartbeat, …). If telemetry is OFF it must never be called.
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
  });

  it("is OFF when no flags are set (local-only default)", async () => {
    const { firstPartyTelemetryDefaultEnabled } =
      await import("../../src/lib/telemetry/firstPartyGate");
    expect(firstPartyTelemetryDefaultEnabled()).toBe(false);
  });

  it("is ON only with the explicit build flag", async () => {
    vi.stubEnv("VITE_FIRST_PARTY_TELEMETRY", "1");
    const { firstPartyTelemetryDefaultEnabled } =
      await import("../../src/lib/telemetry/firstPartyGate");
    expect(firstPartyTelemetryDefaultEnabled()).toBe(true);
  });

  it("kill-switch overrides the build flag", async () => {
    vi.stubEnv("VITE_FIRST_PARTY_TELEMETRY", "1");
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
  });

  it("sends 0 external events when the gate is OFF (default)", async () => {
    // No env flags → module initializes telemetryEnabled = false.
    const { telemetry } = await import("../../src/services/telemetryService");

    telemetry.agentSpawned("a1", "agent-1", "claude", "backend", "p1");
    telemetry.tokenUsage("a1", "claude", 10, 20, 0.5, "p1");
    telemetry.taskCompleted("t1", 1000, "a1");

    // Force every flush path: explicit flush + drain any queued timers.
    await telemetry.flush();
    vi.advanceTimersByTime(60_000);
    await Promise.resolve();

    expect(callableSpy).not.toHaveBeenCalled();
  });

  it("sends once opted in via setTelemetryEnabled (proves the gate is live)", async () => {
    const { telemetry, setTelemetryEnabled } =
      await import("../../src/services/telemetryService");

    setTelemetryEnabled(true);
    telemetry.tokenUsage("a1", "claude", 10, 20, 0.5, "p1");
    await telemetry.flush();

    expect(callableSpy).toHaveBeenCalledTimes(1);
  });
});
