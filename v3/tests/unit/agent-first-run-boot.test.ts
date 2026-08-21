/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WORKER FIRST-RUN BOOT — the instruction must never be typed into a dialog
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `tests/unit/orchestrator-first-run-boot.test.ts` proves the same property for
 * the ORCHESTRATOR. This file exists because that gate was wired to the
 * orchestrator only, and the worker path — every dispatched task, every fresh
 * worktree — kept the original behaviour. A live run measured what that costs
 * (ticket ymRo9BtilQnb48Y5ol68, scenario A, claude 2.1.238):
 *
 *     381 ms  "Do you trust this folder?"
 *   10068 ms  the blind fallback types a 6,447-char instruction INTO it
 *             → the trailing \r confirms `❯ 1. Yes, I trust this folder`
 *   →         composer empty, instruction gone, agent promoted to `working`
 *
 * ★The damage is not the death. Nothing died: the select list swallowed the
 * text, the default option was "Yes", and the CLI carried on. The damage is
 * that the board said `working` about an agent that had been told nothing.
 *
 * So there are two properties here, and the second is the one the incident was
 * actually about:
 *   1. nothing is typed while a first-run dialog is on screen, and
 *   2. an agent whose instruction never arrived never reads as `working`.
 *
 * The frames are a verbatim recording (tests/fixtures/pty/claude-folder-trust
 * .json) — captured from a real pty in a directory claude had never seen, with
 * nothing typed into it. Hand-written TUI screens are how this bug survived
 * review twice: the assumptions read fine and the real bytes disagreed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

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
      modelTierResolved: vi.fn(),
      topModelFallback: vi.fn(),
      agentNeedsAuth: vi.fn(),
      agentAuthResolved: vi.fn(),
    },
  };
});

/** What a dispatched worker is actually handed — the live run measured 6,447. */
const INSTRUCTION = `[Role Skill] ${"x".repeat(6400)}`;

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
// The CLI-auth probe is the only part of harness-manager that touches the real
// machine; the login backstop itself is REAL because it is half of the gate
// under test.
vi.mock("../../electron/harness-manager", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../electron/harness-manager")>()),
  probeCliAuth: vi.fn(async () => ({ authenticated: true, action: "" })),
}));
vi.mock("../../electron/agent-config", () => ({
  FALLBACK_TOP_CLAUDE_MODEL: "claude-opus-5",
  grokSessionsDir: () => "/tmp/grok-sessions",
  isLocalToolProfile: () => false,
  AgentConfigGenerator: class {
    getLaunchConfig() {
      return {
        model: "claude",
        command: "claude",
        args: ["--dangerously-skip-permissions"],
        env: { MARBLO_PROJECT: "" },
        initialPrompt: INSTRUCTION,
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
import { FIRST_RUN_DIALOG_GIVE_UP_MS } from "../../electron/agent-input-wait";
import { stripFrameAnsi } from "../../electron/agent-status-reconcile";

const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "pty",
);

function frames(name: string): Array<{ t: number; chunk: string }> {
  const raw = JSON.parse(
    fs.readFileSync(path.join(FIXTURE_DIR, `${name}.json`), "utf8"),
  ) as { frames: Array<{ t: number; b64: string }> };
  return raw.frames.map((f) => ({
    t: f.t,
    chunk: Buffer.from(f.b64, "base64").toString("utf8"),
  }));
}

const TEST_CWD = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-firstrun-"));
type FakePtyInst = InstanceType<typeof FakePty>;

/** Replay a recording at its recorded timings against a fake clock. */
async function replayInto(
  pty: FakePtyInst,
  name: string,
  offset = 0,
): Promise<number> {
  let clock = offset;
  for (const f of frames(name)) {
    const at = offset + f.t;
    if (at > clock) {
      // ★Async advance: PtyManager.writeAndSubmit queues through a promise
      // chain, so a synchronous advance would never let a real send land and
      // every "nothing was typed" assertion would pass for the wrong reason.
      await vi.advanceTimersByTimeAsync(at - clock);
      clock = at;
    }
    pty.emitData(f.chunk);
  }
  return clock;
}

function launchWorker(am: AgentManager, id = "worker-1") {
  return am.launch({
    id,
    name: id,
    model: "claude",
    role: "backend",
    command: "claude",
    cwd: TEST_CWD,
    resumeSessionId: "new",
    currentTaskId: "task-1",
  });
}

beforeEach(() => {
  spawned.length = 0;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("worker boot: the folder-trust dialog", () => {
  it("the recorded screen IS the dialog, and its default is Yes", async () => {
    // Provenance check, not a tautology: if a claude release ever moves the
    // highlight or reworded the screen, the premise of the whole gate changed
    // and this file should be the first thing to say so.
    // Stripped with the PRODUCT's stripper — claude paints these screens with
    // cursor-forward escapes rather than spaces, and a second stripper here
    // would be a second thing to keep in sync.
    const text = stripFrameAnsi(
      frames("claude-folder-trust")
        .map((f) => f.chunk)
        .join(""),
    );
    expect(/trust\s*this\s*folder/i.test(text)).toBe(true);
    expect(/Enter\s*to\s*confirm/i.test(text)).toBe(true);
    // ★The stale agent-manager comment claimed the default was "No" (→ "it
    // would just exit, so typing into it is survivable"). It is not.
    expect(/❯\s*1\.\s*Yes,\s*I\s*trust\s*this\s*folder/i.test(text)).toBe(true);
  });

  it("types NOTHING into it — not on readiness, not on the 10s blind fallback", async () => {
    const am = new AgentManager(new PtyManager());
    launchWorker(am);
    const pty = spawned[0] as FakePtyInst;

    await replayInto(pty, "claude-folder-trust");
    // Well past the blind fallback (10s), which is the write the live run
    // recorded at 10068ms.
    await vi.advanceTimersByTimeAsync(15_000);

    expect(pty.written).toEqual([]);
  });

  it("never reads as `working` while the instruction is undelivered", async () => {
    // ★The bug's real payload. The trust dialog repaints; every repaint is PTY
    // output; output used to promote idle→working unconditionally. So the board
    // showed a busy agent that had been told nothing, the dispatcher kept its
    // slot, and nobody looked at the screen asking a question.
    const seen: string[] = [];
    const am = new AgentManager(new PtyManager(), (_id, status) =>
      seen.push(status),
    );
    launchWorker(am);
    const pty = spawned[0] as FakePtyInst;

    await replayInto(pty, "claude-folder-trust");
    await vi.advanceTimersByTimeAsync(15_000);

    expect(seen).not.toContain("working");
    expect(am.getAgent("worker-1")?.status).toBe("idle");
  });

  it("gives up loudly: after the hold window the agent goes to error, still having typed nothing", async () => {
    const am = new AgentManager(new PtyManager());
    launchWorker(am);
    const pty = spawned[0] as FakePtyInst;

    await replayInto(pty, "claude-folder-trust");
    // ★The window is counted from SPAWN, not from the moment the hold engaged —
    // the same basis the orchestrator uses. Counting from the hold would add
    // each harness's blind fallback (claude 10 s) on top, so the shared 60 s
    // constant would mean 70 s here and 60 s there. Stop just short of it:
    // still holding, still quiet, still not an error — the dialog may yet be
    // answered (the auto-accept, a human in the terminal tab).
    await vi.advanceTimersByTimeAsync(FIRST_RUN_DIALOG_GIVE_UP_MS - 5_000);
    expect(am.getAgent("worker-1")?.status).toBe("idle");

    // Past it: nobody is coming. Say so rather than sitting silent forever.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(am.getAgent("worker-1")?.status).toBe("error");
    expect(pty.written).toEqual([]);
  });

  it("withdraws the error if the screen is answered after we gave up", async () => {
    // A human eventually walks over and answers the dialog. The instruction is
    // still owed, so it goes out — and the red badge has to come back off, or
    // the board lies in the other direction: an agent doing work, shown failed.
    const am = new AgentManager(new PtyManager());
    launchWorker(am);
    const pty = spawned[0] as FakePtyInst;

    const at = await replayInto(pty, "claude-folder-trust");
    await vi.advanceTimersByTimeAsync(FIRST_RUN_DIALOG_GIVE_UP_MS + 5_000);
    expect(am.getAgent("worker-1")?.status).toBe("error");

    await replayInto(
      pty,
      "claude-composer-after-consent",
      at + FIRST_RUN_DIALOG_GIVE_UP_MS + 5_000,
    );
    await vi.advanceTimersByTimeAsync(4_000);

    expect(pty.written.join("")).toContain(INSTRUCTION);
    // Off the error, and back on the normal live path — the frames that follow
    // delivery are real work now, so `working` is a correct destination too.
    const status = am.getAgent("worker-1")?.status;
    expect(status).not.toBe("error");
    expect(["idle", "working"]).toContain(status);
  });

  it("sends as soon as the screen becomes a real composer (no regression)", async () => {
    // The gate must DEFER, not cancel. A held send has to go out on the first
    // frame after the dialog clears — waiting for another readiness match would
    // strand the agent, since the dialog's replacement IS the composer.
    const am = new AgentManager(new PtyManager());
    launchWorker(am);
    const pty = spawned[0] as FakePtyInst;

    const at = await replayInto(pty, "claude-folder-trust");
    await vi.advanceTimersByTimeAsync(12_000); // blind fallback fires, and holds
    expect(pty.written).toEqual([]);

    // Someone/something answered it; claude paints its composer.
    await replayInto(pty, "claude-composer-after-consent", at + 12_000);
    await vi.advanceTimersByTimeAsync(4_000);

    expect(pty.written.join("")).toContain(INSTRUCTION);
  });

  it("a normal boot — composer from the start — is untouched by the gate", async () => {
    const am = new AgentManager(new PtyManager());
    launchWorker(am);
    const pty = spawned[0] as FakePtyInst;

    await replayInto(pty, "claude-composer-after-consent");
    await vi.advanceTimersByTimeAsync(4_000);

    expect(pty.written.join("")).toContain(INSTRUCTION);
    // And once the instruction is delivered, output means work again.
    pty.emitData("thinking...");
    expect(am.getAgent("worker-1")?.status).toBe("working");
  });
});

describe("worker boot: the bypass-permissions consent screen", () => {
  it("holds the instruction there too, and delivers it once the screen clears", async () => {
    // Same class of screen, different question. The auto-accept answers this
    // one (orchestrator-first-run-boot.test.ts covers that decision); what is
    // asserted here is only that the instruction is not what answers it.
    const am = new AgentManager(new PtyManager());
    launchWorker(am);
    const pty = spawned[0] as FakePtyInst;

    const at = await replayInto(pty, "claude-first-run-consent");
    await vi.advanceTimersByTimeAsync(12_000);
    // The auto-accept may have typed its own `2` + CR — that is deliberate and
    // is not the instruction. The instruction itself must not be there.
    expect(pty.written.join("")).not.toContain(INSTRUCTION);

    await replayInto(pty, "claude-composer-after-consent", at + 12_000);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(pty.written.join("")).toContain(INSTRUCTION);
  });
});
