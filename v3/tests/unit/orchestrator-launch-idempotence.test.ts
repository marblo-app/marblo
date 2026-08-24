import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { verdictFor } from "../../electron/composer-gate";
import fs from "fs";
import os from "os";
import path from "path";
import {
  OrchestratorManager,
  type OrchestratorPtyReadyInfo,
} from "../../electron/orchestrator-manager";

/**
 * Regression tests for the "오케스트레이터가 혼자 끊긴다" P0
 * (ticket hIq6m9Q6cHgtAoy3jUcB).
 *
 * Root cause: launch() opened with an unconditional
 *
 *     if (this.session) { this.stop(); }
 *
 * There was no attach path at all, and `orchestrators` holds ONE manager per
 * projectId shared by every window. So any second launch for the same project
 * killed the boss's live PTY and respawned it — losing the conversation. The
 * launches were not user actions: a Vite full-page reload (the renderer has
 * zero import.meta.hot.accept handlers, so ANY module edit escalates to a
 * reload), a React remount, a second window, or a reconnect all funnel here.
 *
 * These drive the REAL launch() with a fake PtyManager/AgentConfigGenerator —
 * the assertions are on actual PTY create/kill calls, so the old code
 * genuinely fails them (it called create twice and kill once).
 */

interface FakePty {
  create: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  hasSession: (id: string) => boolean;
  liveSessions: Set<string>;
}

function makeHarness() {
  const liveSessions = new Set<string>();

  const ptyManager = {
    onDanger: vi.fn(() => vi.fn()),
    create: vi.fn((id: string) => {
      liveSessions.add(id);
      return { id, name: "Orchestrator", shell: "claude" };
    }),
    kill: vi.fn((id: string) => {
      liveSessions.delete(id);
    }),
    hasSession: (id: string) => liveSessions.has(id),
    setBlockDangerousForSession: vi.fn(),
    onData: vi.fn(),
    onExit: vi.fn(),
    writeAndSubmit: vi.fn(async () => true),
    // 티켓 RtyOMpOArfI7a5JNSzsg — 부트 프롬프트도 컴포저 판정을 거친다.
    composerVerdict: vi.fn(() => verdictFor("indeterminate")),
    liveSessions,
  };

  const configGenerator = {
    getLaunchConfig: vi.fn(
      (agent: { model: string; command: string }, rootPath: string) => ({
        model: agent.model,
        command: agent.command,
        args: [] as string[],
        env: {} as Record<string, string>,
        mcpConfigPath: path.join(rootPath, "__no_such_mcp_config__.json"),
      }),
    ),
    cleanup: vi.fn(),
    hasSavedSession: vi.fn(() => false),
  };

  const manager = new OrchestratorManager(
    ptyManager as never,
    configGenerator as never,
    undefined,
    "board",
  );

  return {
    manager,
    ptyManager: ptyManager as unknown as FakePty,
    configGenerator,
  };
}

describe("OrchestratorManager.launch idempotence (attach instead of respawn)", () => {
  let root: string;
  let otherRoot: string;

  beforeEach(() => {
    // Real temp dirs: launch() stats rootPath and scans ~/.claude for resumable
    // sessions. Empty dirs make it take the deterministic "fresh session" path.
    root = fs.mkdtempSync(path.join(os.tmpdir(), "orch-idem-"));
    otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), "orch-idem-other-"));
    // Boot-prompt readiness uses timers; keep them off the real clock so no
    // stray writeAndSubmit fires after the test finishes.
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(otherRoot, { recursive: true, force: true });
  });

  function launch(
    manager: OrchestratorManager,
    opts: {
      projectId?: string;
      rootPath?: string;
      model?: "claude" | "antigravity";
      onPtyReady?: (sid: string, info: OrchestratorPtyReadyInfo) => void;
    } = {},
  ) {
    return manager.launch(
      opts.projectId ?? "proj-1",
      opts.rootPath ?? root,
      4242,
      opts.onPtyReady,
      "new",
      undefined,
      { modelOverride: opts.model ?? "claude" },
    );
  }

  it("returns the SAME live PTY for a repeat launch of the same project+root — no respawn", () => {
    const { manager, ptyManager } = makeHarness();

    const first = launch(manager);
    const second = launch(manager);

    // The core guarantee: one PTY, never killed, same ids handed back.
    expect(ptyManager.create).toHaveBeenCalledTimes(1);
    expect(ptyManager.kill).not.toHaveBeenCalled();
    expect(second.ptySessionId).toBe(first.ptySessionId);
    expect(second.sessionId).toBe(first.sessionId);
  });

  it("survives a burst of relaunches (reload storm / StrictMode / N windows)", () => {
    const { manager, ptyManager } = makeHarness();

    const first = launch(manager);
    for (let i = 0; i < 5; i += 1) {
      expect(launch(manager).ptySessionId).toBe(first.ptySessionId);
    }

    expect(ptyManager.create).toHaveBeenCalledTimes(1);
    expect(ptyManager.kill).not.toHaveBeenCalled();
  });

  it("tells the caller the PTY was REUSED so it does not re-wire forwarding", () => {
    // node-pty's onData ADDS a listener, so re-running setupPtyForwarding on a
    // live PTY duplicates every byte in the terminal. The flag is how main.ts
    // knows to skip it.
    const { manager } = makeHarness();
    const calls: Array<{ sid: string; reused: boolean }> = [];
    const record = (sid: string, info: OrchestratorPtyReadyInfo) =>
      calls.push({ sid, reused: info.reused });

    launch(manager, { onPtyReady: record });
    launch(manager, { onPtyReady: record });

    expect(calls).toHaveLength(2);
    expect(calls[0].reused).toBe(false); // fresh spawn — caller MUST wire
    expect(calls[1].reused).toBe(true); // attach — caller must NOT re-wire
    expect(calls[1].sid).toBe(calls[0].sid);
  });

  it("still notifies the attaching caller, so a second window gets the sid", () => {
    const { manager } = makeHarness();
    const first = launch(manager);
    const secondWindow = vi.fn();

    launch(manager, { onPtyReady: secondWindow });

    // Without this the new window would never learn which PTY to subscribe to.
    expect(secondWindow).toHaveBeenCalledWith(first.ptySessionId, {
      reused: true,
    });
  });

  // ── Regression guards: the cases that MUST still respawn ──────────────────

  it("REGRESSION: a genuine project switch still stops the old orchestrator", () => {
    const { manager, ptyManager } = makeHarness();

    const first = launch(manager, { projectId: "proj-1" });
    const second = launch(manager, { projectId: "proj-2" });

    // Different project → the old PTY must die; attaching would leave the new
    // project driving the previous project's session.
    expect(ptyManager.kill).toHaveBeenCalledWith(first.ptySessionId);
    expect(ptyManager.create).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
    expect(second.projectId).toBe("proj-2");
    expect(second.sessionId).not.toBe(first.sessionId);
  });

  it("REGRESSION: a changed rootPath still stops the old orchestrator", () => {
    const { manager, ptyManager } = makeHarness();

    const first = launch(manager, { rootPath: root });
    const second = launch(manager, { rootPath: otherRoot });

    expect(ptyManager.kill).toHaveBeenCalledWith(first.ptySessionId);
    expect(ptyManager.create).toHaveBeenCalledTimes(2);
    expect(second.rootPath).toBe(otherRoot);
  });

  it("REGRESSION: a model change still respawns (the switch path stays intact)", () => {
    const { manager, ptyManager } = makeHarness();

    const first = launch(manager, { model: "claude" });
    const second = launch(manager, { model: "antigravity" });

    expect(ptyManager.kill).toHaveBeenCalledWith(first.ptySessionId);
    expect(ptyManager.create).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
    expect(second.launchConfig?.model).toBe("antigravity");
  });

  it("respawns when the PTY died without the status catching up", () => {
    const { manager, ptyManager } = makeHarness();

    const first = launch(manager);
    // Process gone, but session/status still say "starting" — the exact race
    // where attaching would hand back a terminal that never emits again.
    ptyManager.liveSessions.delete(first.ptySessionId);

    const second = launch(manager);

    // NOTE: identity is asserted on the session OBJECT, not on ptySessionId —
    // that id embeds Date.now(), which fake timers freeze, so two respawns in
    // one test would coincidentally share a string.
    expect(ptyManager.create).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
  });

  it("respawns after an explicit stop() (Start button after Stop)", () => {
    const { manager, ptyManager } = makeHarness();

    const first = launch(manager);
    manager.stop();
    const second = launch(manager);

    expect(ptyManager.kill).toHaveBeenCalledWith(first.ptySessionId);
    expect(ptyManager.create).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
  });

  it("does not re-send the boot prompt when attaching", () => {
    // Re-sending would type the orchestrator onboarding prompt into the middle
    // of the user's live conversation.
    const { manager, ptyManager } = makeHarness();
    const pty = ptyManager as unknown as {
      writeAndSubmit: ReturnType<typeof vi.fn>;
    };

    launch(manager);
    vi.advanceTimersByTime(15_000); // let the fresh session's boot prompt land
    const afterFirst = pty.writeAndSubmit.mock.calls.length;

    launch(manager);
    vi.advanceTimersByTime(15_000);

    expect(pty.writeAndSubmit.mock.calls.length).toBe(afterFirst);
  });
});
