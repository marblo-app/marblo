/**
 * End-to-end wiring proof for the turn-boundary status model (2026-07-19
 * incident: 11 of 13 agents stranded, 12-core box at load average 44).
 *
 * The pure decision functions are covered in agent-status-reconcile.test.ts and
 * agent-reap.test.ts. What THIS file proves is that AgentManager is actually
 * wired to them — that real PTY traffic through a real PtyManager produces the
 * intended status transitions. The original bug was not a wrong predicate; it
 * was the *plumbing* (output promoting status, a completion report erasing the
 * reaper's evidence), so the plumbing is what needs a regression test.
 *
 * Two failure directions, both reproduced here:
 *   A. A finished agent kept looking `working` (prompt repaint re-promoted it)
 *      AND lost its task binding, so nothing could ever reap it.
 *   B. A reasoning agent — PTY-silent by nature — got demoted to `idle`, so the
 *      orchestrator treated live work as a free slot.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
    emitData(d: string) {
      for (const cb of [...this.dataCbs]) cb(d);
    }
  }
  return {
    spawned: [] as FakePty[],
    FakePty,
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
import { ABANDONED_TURN_MS } from "../../electron/agent-status-reconcile";
import { evaluateTerminalTaskReap } from "../../electron/mcp-server/agent-reap";
import fs from "fs";
import os from "os";
import path from "path";

const TEST_CWD = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-turn-test-"));
const HEARTBEAT_INTERVAL_MS = 30_000;
type FakePtyInst = InstanceType<typeof FakePty>;

/** The prompt repaint a finished CLI emits forever: spinner frame + cursor. */
const REPAINT = "\x1b[2K\r⠋ \x1b[?25h";

function launchBound(am: AgentManager, id = "ag1", taskId = "task-1") {
  return am.launch({
    id,
    name: id,
    model: "claude",
    role: "backend",
    command: "claude",
    cwd: TEST_CWD,
    currentTaskId: taskId,
  });
}

beforeEach(() => {
  spawned.length = 0;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("turn lifecycle — a completed agent becomes reapable and STAYS idle", () => {
  it("completion report retains lastTaskId, and later repaint never re-promotes", () => {
    const am = new AgentManager(new PtyManager());
    launchBound(am);
    const pty = spawned[0] as FakePtyInst;

    // Turn is live: output promotes to working.
    pty.emitData("thinking...");
    expect(am.getAgent("ag1")?.status).toBe("working");

    // Worker reports its task terminal (submit_for_review → /set-agent-status
    // idle → markTurnComplete).
    am.markTurnComplete("ag1");
    const agent = am.getAgent("ag1")!;
    expect(agent.status).toBe("idle");
    // The binding is released (the agent is free)...
    expect(agent.currentTaskId).toBeNull();
    // ...but the EVIDENCE survives. This single field is the load-44 fix:
    // without it the reaper's gate could never match a clean completion.
    expect(agent.lastTaskId).toBe("task-1");
    expect(agent.turnCompletedAt).not.toBeNull();

    // The finished CLI now repaints its prompt forever. Previously the first
    // chunk after the 12s settle window pinned it back at [working].
    for (let i = 0; i < 50; i++) {
      vi.advanceTimersByTime(60_000);
      pty.emitData(REPAINT);
    }
    expect(am.getAgent("ag1")?.status).toBe("idle");
    // Completion stamp must survive forever-repaint — otherwise waiting-notif
    // spam and unreapable "working, never bound" zombies return.
    expect(am.getAgent("ag1")?.turnCompletedAt).not.toBeNull();
  });

  it("markTurnComplete immediately retracts a standing input-wait notification", () => {
    const waits: Array<{ waiting: boolean; reason: string | null }> = [];
    // onInputWait is the 6th constructor arg (after optional crash/restart hooks).
    const am = new AgentManager(
      new PtyManager(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (e) => waits.push({ waiting: e.waiting, reason: e.reason }),
    );
    launchBound(am);
    const pty = spawned[spawned.length - 1] as FakePtyInst;

    // Park at the ready prompt long enough for the waiting badge to rise.
    // Claude's verified idle-at-prompt marker (agent-status-reconcile.ts).
    const prompt = "? for shortcuts";
    pty.emitData(prompt);
    vi.advanceTimersByTime(25_000);
    pty.emitData(prompt); // frame path re-evaluates after grace
    // Heartbeat also re-checks.
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);

    const rose = waits.some((w) => w.waiting && w.reason === "prompt");
    expect(rose).toBe(true);

    am.markTurnComplete("ag1");
    const last = waits[waits.length - 1];
    expect(last).toMatchObject({ waiting: false, reason: null });
    expect(am.getAgent("ag1")?.inputWaitReason).toBeNull();
  });

  it("the retained binding makes cleanup_agents' gate fire (the actual incident)", () => {
    const am = new AgentManager(new PtyManager());
    launchBound(am, "ag1", "task-done");
    const pty = spawned[0] as FakePtyInst;
    pty.emitData("working");
    am.markTurnComplete("ag1");

    const agent = am.getAgent("ag1")!;
    const now = Date.now() + 10 * 60 * 1000; // 10 min later, PTY quiet

    // Exactly what cleanup_agents Pass 2 evaluates, fed from the live instance.
    const decision = evaluateTerminalTaskReap({
      role: agent.role,
      currentTaskId: agent.currentTaskId,
      lastTaskId: agent.lastTaskId,
      taskStatus: "DONE", // board says the task is done
      lastPtyActivity: agent.lastPtyActivity,
      now,
    });
    expect(decision.reap).toBe(true);

    // Regression guard: with lastTaskId dropped (the old behavior), the very
    // same finished agent is unreapable — "no reapable agents found".
    const oldBehavior = evaluateTerminalTaskReap({
      role: agent.role,
      currentTaskId: agent.currentTaskId,
      lastTaskId: null,
      taskStatus: "DONE",
      lastPtyActivity: agent.lastPtyActivity,
      now,
    });
    expect(oldBehavior.reap).toBe(false);
  });

  it("a NEW instruction reopens the turn — follow-up work is never suppressed", () => {
    const pm = new PtyManager();
    const am = new AgentManager(pm);
    launchBound(am);
    const pty = spawned[spawned.length - 1] as FakePtyInst;

    pty.emitData("first turn");
    am.markTurnComplete("ag1");
    expect(am.getAgent("ag1")?.status).toBe("idle");

    // Orchestrator sends a follow-up. writeAndSubmit fires onSubmit →
    // noteTurnStart clears the completed-turn marker.
    void pm.writeAndSubmit("agent-ag1", "next task please");
    expect(am.getAgent("ag1")?.turnCompletedAt).toBeNull();

    // Now output legitimately promotes again.
    pty.emitData("on it");
    expect(am.getAgent("ag1")?.status).toBe("working");
  });

  it("a HUMAN pressing Enter in the terminal tab also reopens the turn", () => {
    // Without an input-side signal, manual terminal use after a completion
    // report would leave a genuinely working agent pinned at idle.
    const pm = new PtyManager();
    const am = new AgentManager(pm);
    launchBound(am);
    const pty = spawned[spawned.length - 1] as FakePtyInst;

    am.markTurnComplete("ag1");
    expect(am.getAgent("ag1")?.turnCompletedAt).not.toBeNull();

    // Typing individual characters is mid-composition — not yet a turn.
    pm.write("agent-ag1", "h");
    pm.write("agent-ag1", "i");
    expect(am.getAgent("ag1")?.turnCompletedAt).not.toBeNull();

    // Enter submits it → new turn.
    pm.write("agent-ag1", "\r");
    expect(am.getAgent("ag1")?.turnCompletedAt).toBeNull();

    pty.emitData("responding");
    expect(am.getAgent("ag1")?.status).toBe("working");
  });
});

describe("★ turn lifecycle — a reasoning agent is never reported idle", () => {
  it("stays working through long PTY silence while its turn is open", () => {
    // THE over-reap guard at the wiring level. An agent doing long inference
    // emits nothing; the old heartbeat rule demoted it after 5 minutes, and a
    // reaper gated on idleness would then kill live work.
    const am = new AgentManager(new PtyManager());
    launchBound(am);
    const pty = spawned[0] as FakePtyInst;

    pty.emitData("let me think about this");
    expect(am.getAgent("ag1")?.status).toBe("working");

    // 40 minutes of complete silence — well past the old 5-minute threshold.
    for (let i = 0; i < 80; i++) {
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    }
    expect(am.getAgent("ag1")?.status).toBe("working");
    expect(am.getAgent("ag1")?.currentTaskId).toBe("task-1");
  });

  it("demotes only past the wedged-turn backstop", () => {
    const am = new AgentManager(new PtyManager());
    launchBound(am);
    const pty = spawned[0] as FakePtyInst;
    pty.emitData("start");
    expect(am.getAgent("ag1")?.status).toBe("working");

    vi.advanceTimersByTime(ABANDONED_TURN_MS + HEARTBEAT_INTERVAL_MS);
    expect(am.getAgent("ag1")?.status).toBe("idle");
  });
});
