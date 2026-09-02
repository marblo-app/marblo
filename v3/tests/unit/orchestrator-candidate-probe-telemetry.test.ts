import { describe, expect, it, vi } from "vitest";
import { mainTelemetry } from "../../electron/telemetry";

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
}));

function fakeWindow() {
  const send = vi.fn();
  return {
    isDestroyed: () => false,
    webContents: { send },
    send,
  };
}

describe("orchestrator candidate probe telemetry", () => {
  it("emits a separate non-user-facing probe event instead of spawn_blocked", () => {
    const win = fakeWindow();

    mainTelemetry.orchestratorCandidateProbe(win as never, {
      model: "codex",
      outcome: "blocked",
      reason: "not-installed",
      installed: false,
    });

    expect(win.send).toHaveBeenCalledWith("telemetry:event", {
      event: "onboarding:orchestrator_candidate_probe",
      model: "codex",
      success: false,
      outcome: "blocked",
      errorCategory: "not-installed",
      metadata: {
        surface: "orchestrator_auto_select",
        userFacing: false,
        outcome: "blocked",
        reason: "no_cli",
        installed: false,
      },
    });
  });
});
