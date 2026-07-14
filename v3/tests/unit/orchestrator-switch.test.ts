import { describe, expect, it, vi } from "vitest";
import { buildOrchestratorHandoffSnapshot } from "../../electron/orchestrator-handoff";
import {
  OrchestratorSwitchStepTimeoutError,
  runOrchestratorSwitch,
} from "../../electron/orchestrator-switch";
import type {
  OrchestratorSwitchArgs,
  OrchestratorSwitchDeps,
} from "../../electron/orchestrator-switch";

function snapshot() {
  return buildOrchestratorHandoffSnapshot({
    projectId: "project-1",
    rootPath: "/repo",
    from: { ptySessionId: "pty-old" },
    targetModel: "gpt",
    resumeSessionId: "new",
    missions: [],
    tasks: [],
    now: 123,
  });
}

function args(): OrchestratorSwitchArgs {
  return {
    projectId: "project-1",
    rootPath: "/repo",
    targetModel: "gpt",
    mode: "wait",
    resume: "fresh",
  };
}

describe("runOrchestratorSwitch", () => {
  it("keeps the old orchestrator running when target auth gate fails", async () => {
    const detachPending = vi.fn();
    const stopCurrent = vi.fn();
    const launchNew = vi.fn();
    const result = await runOrchestratorSwitch(args(), {
      buildSnapshot: vi.fn(async () => snapshot()),
      checkAuth: vi.fn(async () => ({
        ok: false,
        model: "codex",
        installed: true,
        action: "codex login",
      })),
      detachPending,
      stopCurrent,
      launchNew,
      injectHandoff: vi.fn(),
      attachPending: vi.fn(),
    });

    expect(result.status).toBe("blocked");
    expect(result.needsAuth).toEqual({
      model: "codex",
      action: "codex login",
      installed: true,
    });
    expect(detachPending).not.toHaveBeenCalled();
    expect(stopCurrent).not.toHaveBeenCalled();
    expect(launchNew).not.toHaveBeenCalled();
  });

  it("orders detach, stop, launch, inject, attach for a successful switch", async () => {
    const calls: string[] = [];
    const deps: OrchestratorSwitchDeps = {
      buildSnapshot: vi.fn(async () => {
        calls.push("snapshot");
        return snapshot();
      }),
      checkAuth: vi.fn(async () => {
        calls.push("auth");
        return { ok: true, model: "codex", installed: true };
      }),
      detachPending: vi.fn(() => calls.push("detach")),
      stopCurrent: vi.fn(() => calls.push("stop")),
      launchNew: vi.fn(async () => {
        calls.push("launch");
        return {
          sessionId: "orch-project-1",
          ptySessionId: "pty-new",
          status: "starting",
        };
      }),
      injectHandoff: vi.fn(async () => {
        calls.push("inject");
      }),
      attachPending: vi.fn(() => calls.push("attach")),
    };

    const result = await runOrchestratorSwitch(args(), deps);

    expect(result.ptySessionId).toBe("pty-new");
    expect(calls).toEqual([
      "snapshot",
      "auth",
      "detach",
      "stop",
      "launch",
      "inject",
      "attach",
    ]);
  });

  it("times out snapshot before stopping the current orchestrator", async () => {
    vi.useFakeTimers();
    try {
      const stopCurrent = vi.fn();
      const launchNew = vi.fn();
      const switchPromise = runOrchestratorSwitch(args(), {
        buildSnapshot: vi.fn(() => new Promise(() => {})),
        checkAuth: vi.fn(),
        detachPending: vi.fn(),
        stopCurrent,
        launchNew,
        injectHandoff: vi.fn(),
        attachPending: vi.fn(),
        stepTimeoutMs: 1000,
      });
      const rejection = expect(switchPromise).rejects.toBeInstanceOf(
        OrchestratorSwitchStepTimeoutError,
      );

      await vi.advanceTimersByTimeAsync(1000);
      await rejection;

      expect(stopCurrent).not.toHaveBeenCalled();
      expect(launchNew).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not wedge a launched switch when handoff injection hangs", async () => {
    vi.useFakeTimers();
    try {
      const attachPending = vi.fn();
      const onWarning = vi.fn();
      const switchPromise = runOrchestratorSwitch(args(), {
        buildSnapshot: vi.fn(async () => snapshot()),
        checkAuth: vi.fn(async () => ({
          ok: true,
          model: "codex",
          installed: true,
        })),
        detachPending: vi.fn(),
        stopCurrent: vi.fn(),
        launchNew: vi.fn(async () => ({
          sessionId: "orch-project-1",
          ptySessionId: "pty-new",
          status: "starting",
        })),
        injectHandoff: vi.fn(() => new Promise(() => {})),
        attachPending,
        injectTimeoutMs: 1000,
        onWarning,
      });

      await vi.advanceTimersByTimeAsync(1000);
      const result = await switchPromise;

      expect(result.ptySessionId).toBe("pty-new");
      expect(attachPending).toHaveBeenCalledWith("project-1", "pty-new");
      expect(onWarning).toHaveBeenCalledWith(
        expect.stringContaining("handoff injection timed out"),
        expect.any(OrchestratorSwitchStepTimeoutError),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
