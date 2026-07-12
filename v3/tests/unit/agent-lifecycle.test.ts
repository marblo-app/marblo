/**
 * Regression tests for two agent-lifecycle leaks:
 *
 *   N2 — heartbeat setInterval leaked on every PTY teardown path
 *        (clean exit / crash-restart) because AgentManager.launch()'s onExit
 *        handler never cleared `instance.heartbeatTimer`. A stopped/errored
 *        agent stays in the map, so the 30s interval (and its telemetry
 *        emissions) ran forever.
 *
 *   N3 — PTY ids are deterministic (`agent-<id>`) and reused verbatim on
 *        restart. PtyManager.onExit deleted the map entry by id string, so a
 *        killed OLD process firing its async onExit AFTER a fresh session had
 *        claimed the same id would evict the replacement → orphaned live
 *        process + every subsequent write() silently dropped.
 *
 * node-pty is a native module; we mock it with a controllable fake so exit
 * events can be fired deterministically without spawning real processes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- node-pty fake (hoisted so the vi.mock factory can use it) ---------------
const { spawned, FakePty, telemetry } = vi.hoisted(() => {
  class FakePty {
    written: string[] = [];
    killed = false;
    dataCbs: Array<(d: string) => void> = [];
    exitCbs: Array<(e: { exitCode: number }) => void> = [];
    write(d: string) {
      this.written.push(d);
    }
    resize() {}
    kill() {
      this.killed = true;
    }
    onData(cb: (d: string) => void) {
      this.dataCbs.push(cb);
      return {
        dispose: () => {
          this.dataCbs = this.dataCbs.filter((c) => c !== cb);
        },
      };
    }
    onExit(cb: (e: { exitCode: number }) => void) {
      this.exitCbs.push(cb);
      return { dispose: () => {} };
    }
    /** Simulate the (async, in real life) process exit. */
    emitExit(code: number) {
      for (const cb of [...this.exitCbs]) cb({ exitCode: code });
    }
    emitData(d: string) {
      for (const cb of [...this.dataCbs]) cb(d);
    }
  }
  return {
    spawned: [] as FakePty[],
    FakePty,
    // Spyable telemetry so we can assert the heartbeat stops firing
    // post-teardown. Lives in vi.hoisted so the (hoisted) vi.mock factory
    // below can reference it without hitting a temporal-dead-zone error.
    telemetry: {
      agentSpawned: vi.fn(),
      heartbeat: vi.fn(),
      agentStopped: vi.fn(),
      agentRestarted: vi.fn(),
      agentCrashed: vi.fn(),
    },
  };
});

vi.mock("node-pty", () => ({
  spawn: () => {
    const p = new FakePty();
    spawned.push(p);
    return p;
  },
}));

// electron's runtime API is unavailable outside the electron process; only the
// BrowserWindow *type* is referenced by agent-manager, and getMainWindow is
// never wired in these tests, so a stub class is enough.
vi.mock("electron", () => ({ BrowserWindow: class {} }));

vi.mock("../../electron/claude-paths", () => ({
  encodeClaudeProjectDir: (p: string) => p.replace(/\//g, "-"),
}));

vi.mock("../../electron/telemetry", () => ({ mainTelemetry: telemetry }));

vi.mock("../../electron/agent-config", () => ({
  AgentConfigGenerator: class {
    getLaunchConfig() {
      return {
        command: "claude",
        args: [],
        env: { MARBLO_PROJECT: "" },
        initialPrompt: undefined,
        skillContent: undefined,
        claudeSessionId: undefined,
      };
    }
    cleanup() {}
    cleanupAll() {}
    hasSavedSession() {
      return false;
    }
  },
}));

import { PtyManager } from "../../electron/pty-manager";
import { AgentManager } from "../../electron/agent-manager";

type FakePtyInst = InstanceType<typeof FakePty>;

const HEARTBEAT_INTERVAL_MS = 30_000;

beforeEach(() => {
  spawned.length = 0;
  telemetry.heartbeat.mockClear();
  telemetry.agentSpawned.mockClear();
  telemetry.agentStopped.mockClear();
});

// ───────────────────────── N3: PtyManager id reuse ─────────────────────────

describe("PtyManager — N3 deterministic PTY id reuse", () => {
  it("a late onExit from a killed OLD process must not evict the replacement session", () => {
    const pm = new PtyManager();

    // Original session under a deterministic id.
    const sessionA = pm.create("agent-X", "A");
    const oldProc = sessionA.process as unknown as FakePtyInst;
    // AgentManager registers onExit through PtyManager; mirror that.
    let exitCallbacks = 0;
    pm.onExit("agent-X", () => {
      exitCallbacks++;
    });

    // Manual restart: kill old, then spawn a NEW session reusing the SAME id.
    pm.kill("agent-X");
    const sessionB = pm.create("agent-X", "B");
    const newProc = sessionB.process as unknown as FakePtyInst;

    // The old process's exit lands LATER, after B already owns the id.
    oldProc.emitExit(0);

    // Replacement must still be tracked (not orphaned)...
    expect(pm.listSessions().some((s) => s.id === "agent-X")).toBe(true);
    // ...and writes must reach the NEW process, not vanish.
    pm.write("agent-X", "hello-new");
    expect(newProc.written).toContain("hello-new");
    expect(oldProc.written).not.toContain("hello-new");
    expect(exitCallbacks).toBe(1);
  });

  it("a process's own normal exit still evicts its session (happy path intact)", () => {
    const pm = new PtyManager();
    const session = pm.create("agent-Y", "Y");
    const proc = session.process as unknown as FakePtyInst;
    pm.onExit("agent-Y", () => {});

    proc.emitExit(0);

    expect(pm.listSessions().some((s) => s.id === "agent-Y")).toBe(false);
  });
});

// ─────────────────── N2: heartbeat timer release on teardown ───────────────

describe("AgentManager — N2 heartbeat timer release", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function launchOne(am: AgentManager, id = "ag1") {
    return am.launch({
      id,
      name: id,
      model: "claude",
      role: "backend",
      command: "claude",
      cwd: "/tmp/marblo-test",
      // no initialPrompt → skips the readiness watcher; only the heartbeat
      // interval is scheduled, keeping the timer assertions unambiguous.
    });
  }

  it("clean PTY exit (stopped branch) clears the heartbeat interval — no leak", () => {
    const am = new AgentManager(new PtyManager());
    launchOne(am);

    // Interval is live: one tick emits one heartbeat.
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(telemetry.heartbeat).toHaveBeenCalledTimes(1);

    // Process exits cleanly → onExit stopped branch. Agent stays in the map.
    const proc = spawned[0] as FakePtyInst;
    proc.emitExit(0);

    const agent = am.getAgent("ag1");
    expect(agent?.status).toBe("stopped");
    expect(agent?.heartbeatTimer).toBeNull();

    // Advancing past several more intervals must NOT emit any further heartbeat.
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 3);
    expect(telemetry.heartbeat).toHaveBeenCalledTimes(1);
  });

  it("crash exit that schedules auto-restart clears the OLD heartbeat immediately", () => {
    const am = new AgentManager(new PtyManager());
    launchOne(am);

    // Live past the fast-fail window but before graceful-completion so the exit
    // is classified as a crash → auto-restart is scheduled (agent kept in map).
    vi.advanceTimersByTime(5_000);
    const proc = spawned[0] as FakePtyInst;
    proc.emitExit(1);

    const agent = am.getAgent("ag1");
    expect(agent?.restartCount).toBe(1);
    // The crashed instance's heartbeat is released up-front, before the backoff
    // timer fires — so it can't outlive the process during the restart window.
    expect(agent?.heartbeatTimer).toBeNull();
  });

  it("stop() releases the heartbeat interval", () => {
    const am = new AgentManager(new PtyManager());
    launchOne(am);
    expect(am.getAgent("ag1")?.heartbeatTimer).not.toBeNull();

    am.stop("ag1");

    expect(am.getAgent("ag1")?.heartbeatTimer).toBeNull();
    const before = telemetry.heartbeat.mock.calls.length;
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 2);
    expect(telemetry.heartbeat.mock.calls.length).toBe(before);
  });
});

// ─────────────── P3-4: dead-entry pruning backstop (slow leak) ──────────────

describe("AgentManager — P3-4 dead-entry pruning backstop", () => {
  const TTL_MS = 30 * 60 * 1000;
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function launchOne(am: AgentManager, id = "ag1") {
    return am.launch({
      id,
      name: id,
      model: "claude",
      role: "backend",
      command: "claude",
      cwd: "/tmp/marblo-test",
    });
  }

  it("evicts a terminal (stopped) entry only after the TTL", () => {
    const am = new AgentManager(new PtyManager());
    launchOne(am);
    am.stop("ag1"); // → stopped, terminalSince stamped
    expect(am.getAgent("ag1")?.status).toBe("stopped");

    // Before the TTL a periodic sweep leaves it in place (still revivable).
    vi.advanceTimersByTime(TTL_MS - 60_000);
    expect(am.getAgent("ag1")).not.toBeNull();

    // Past the TTL the next sweep reclaims the map slot.
    vi.advanceTimersByTime(2 * 60_000);
    expect(am.getAgent("ag1")).toBeNull();

    am.stopAll();
  });

  it("never prunes a live agent no matter how long it runs", () => {
    const am = new AgentManager(new PtyManager());
    launchOne(am); // idle, terminalSince === null

    vi.advanceTimersByTime(2 * TTL_MS);
    expect(am.getAgent("ag1")).not.toBeNull();

    am.stopAll();
  });

  it("stopAll() clears the pruner interval so it can't fire post-quit", () => {
    const am = new AgentManager(new PtyManager());
    launchOne(am);
    am.stop("ag1");
    am.stopAll(); // clears the sweep interval

    // With the interval cleared, advancing well past the TTL is inert — no
    // throw, and the (already-stopped) entry stays exactly as stopAll left it.
    expect(() => vi.advanceTimersByTime(3 * TTL_MS)).not.toThrow();
  });
});
