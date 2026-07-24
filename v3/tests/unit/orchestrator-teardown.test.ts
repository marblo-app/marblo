import { describe, it, expect } from "vitest";
import {
  orchestratorKey,
  orchestratorTeardownAction,
} from "../../src/lib/orchestratorTeardown";

/**
 * Regression tests for the renderer half of the "오케가 혼자 끊긴다" P0
 * (ticket hIq6m9Q6cHgtAoy3jUcB).
 *
 * useOrchestratorAutoLaunch's effect CLEANUP called
 * `orchestratorSession.stop()`. Cleanup runs on every unmount, and the renderer
 * defines zero `import.meta.hot.accept` handlers — so editing ANY module makes
 * Vite escalate to a full page reload, which unmounts everything and killed the
 * running orchestrator. React StrictMode's double-invoke and closing one of
 * several windows hit the same path.
 *
 * The rule these pin: only a genuine project switch may stop the orchestrator.
 */
describe("orchestratorTeardownAction", () => {
  const PROJ_A = "proj-a:/Users/me/repo-a";
  const PROJ_B = "proj-b:/Users/me/repo-b";

  describe("unmount (reload / HMR / StrictMode / window close)", () => {
    it("NEVER stops the orchestrator", () => {
      // The regression. Pre-fix this path issued stop() and the boss's live
      // session died on an unrelated file save.
      expect(orchestratorTeardownAction("unmount", PROJ_A, PROJ_A)).toEqual({
        stopOrchestrator: false,
        clearStore: true,
      });
    });

    it("does not stop even when there is no bound project", () => {
      expect(orchestratorTeardownAction("unmount", null, null)).toEqual({
        stopOrchestrator: false,
        clearStore: true,
      });
    });

    it("does not stop regardless of the keys involved", () => {
      // Unmount carries no switch intent, so key values are irrelevant here.
      expect(
        orchestratorTeardownAction("unmount", PROJ_A, PROJ_B).stopOrchestrator,
      ).toBe(false);
    });
  });

  describe("key-change (the only path allowed to stop)", () => {
    it("stops when switching to a different project", () => {
      expect(orchestratorTeardownAction("key-change", PROJ_A, PROJ_B)).toEqual({
        stopOrchestrator: true,
        clearStore: true,
      });
    });

    it("stops when the project's folder binding is removed", () => {
      expect(
        orchestratorTeardownAction("key-change", PROJ_A, null).stopOrchestrator,
      ).toBe(true);
    });

    it("does NOT stop on the first bind (nothing was running yet)", () => {
      expect(orchestratorTeardownAction("key-change", null, PROJ_A)).toEqual({
        stopOrchestrator: false,
        clearStore: false,
      });
    });

    it("does NOT stop when the key is unchanged (effect re-ran)", () => {
      // Dependencies can re-fire without any real switch — e.g. a new `clear`
      // identity. Stopping here would be the same bug by another route.
      expect(orchestratorTeardownAction("key-change", PROJ_A, PROJ_A)).toEqual({
        stopOrchestrator: false,
        clearStore: false,
      });
    });

    it("treats a same-project root change as a switch", () => {
      const movedRoot = "proj-a:/Users/me/repo-a-moved";
      expect(
        orchestratorTeardownAction("key-change", PROJ_A, movedRoot)
          .stopOrchestrator,
      ).toBe(true);
    });
  });
});

describe("orchestratorKey", () => {
  it("binds project id to the FIXED root", () => {
    expect(orchestratorKey("p1", "/repo")).toBe("p1:/repo");
  });

  it("is null without a project or without a folder", () => {
    // Keying off a missing root must not produce a key that looks switchable —
    // the orchestrator cannot run without a root.
    expect(orchestratorKey(undefined, "/repo")).toBeNull();
    expect(orchestratorKey("p1", null)).toBeNull();
    expect(orchestratorKey(null, null)).toBeNull();
  });

  it("distinguishes two projects sharing a root", () => {
    expect(orchestratorKey("p1", "/repo")).not.toBe(
      orchestratorKey("p2", "/repo"),
    );
  });
});
