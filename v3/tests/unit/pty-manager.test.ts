import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { FakePty, spawned } = vi.hoisted(() => {
  class FakePty {
    written: string[] = [];
    dataCbs: Array<(data: string) => void> = [];
    // node-pty's real IPty exposes the forked child pid; the group-kill path
    // reads it. Default to a safe, valid pid so unrelated tests don't trip the
    // scope guard; the reaping tests override it per case.
    pid = 4242;
    killed: (string | undefined)[] = [];

    write(data: string): void {
      this.written.push(data);
    }

    resize(): void {}

    kill(signal?: string): void {
      this.killed.push(signal);
    }

    onData(cb: (data: string) => void): { dispose: () => void } {
      this.dataCbs.push(cb);
      return {
        dispose: () => {
          this.dataCbs = this.dataCbs.filter((registered) => registered !== cb);
        },
      };
    }

    onExit(): { dispose: () => void } {
      return { dispose: () => {} };
    }

    emitData(data: string): void {
      for (const cb of [...this.dataCbs]) cb(data);
    }
  }

  return {
    FakePty,
    spawned: [] as FakePty[],
  };
});

vi.mock("node-pty", () => ({
  spawn: () => {
    const proc = new FakePty();
    spawned.push(proc);
    return proc;
  },
}));

import { PtyManager } from "../../electron/pty-manager";

const DELAY_MS = 10;
const VERIFY_MS = 600;
const SUBMIT_SIGNAL = "esc to interrupt";

type FakePtyInst = InstanceType<typeof FakePty>;

describe("PtyManager.writeAndSubmit serialization", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    spawned.length = 0;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  async function flushQueuedWrites(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  it("serializes concurrent writeAndSubmit calls for the same PTY", async () => {
    const pm = new PtyManager();
    pm.create("pty-1", "agent-1");
    const proc = spawned[0] as FakePtyInst;

    pm.writeAndSubmit("pty-1", "first", DELAY_MS);
    pm.writeAndSubmit("pty-1", "second", DELAY_MS);
    await flushQueuedWrites();

    expect(proc.written).toEqual(["\x1b[200~first\x1b[201~"]);

    await vi.advanceTimersByTimeAsync(DELAY_MS);
    expect(proc.written).toEqual(["\x1b[200~first\x1b[201~", "\r"]);

    proc.emitData(SUBMIT_SIGNAL);
    await vi.advanceTimersByTimeAsync(VERIFY_MS);
    await flushQueuedWrites();

    expect(proc.written).toEqual([
      "\x1b[200~first\x1b[201~",
      "\r",
      "\x1b[200~second\x1b[201~",
    ]);

    await vi.advanceTimersByTimeAsync(DELAY_MS);
    expect(proc.written).toEqual([
      "\x1b[200~first\x1b[201~",
      "\r",
      "\x1b[200~second\x1b[201~",
      "\r",
    ]);

    proc.emitData(SUBMIT_SIGNAL);
    await vi.advanceTimersByTimeAsync(VERIFY_MS);
  });

  it("keeps writeAndSubmit calls for different PTYs parallel", async () => {
    const pm = new PtyManager();
    pm.create("pty-a", "agent-a");
    pm.create("pty-b", "agent-b");
    const procA = spawned[0] as FakePtyInst;
    const procB = spawned[1] as FakePtyInst;

    pm.writeAndSubmit("pty-a", "alpha", DELAY_MS);
    pm.writeAndSubmit("pty-b", "beta", DELAY_MS);
    await flushQueuedWrites();

    expect(procA.written).toEqual(["\x1b[200~alpha\x1b[201~"]);
    expect(procB.written).toEqual(["\x1b[200~beta\x1b[201~"]);

    await vi.advanceTimersByTimeAsync(DELAY_MS);

    expect(procA.written).toEqual(["\x1b[200~alpha\x1b[201~", "\r"]);
    expect(procB.written).toEqual(["\x1b[200~beta\x1b[201~", "\r"]);

    procA.emitData(SUBMIT_SIGNAL);
    procB.emitData(SUBMIT_SIGNAL);
    await vi.advanceTimersByTimeAsync(VERIFY_MS);
  });
});

describe("PtyManager.kill — process-group tree reaping", () => {
  // Root cause (Telegram channel handoff, ticket EDcb8mflwAUMcJDrv5EV):
  // node-pty's own .kill() only signals the single child pid (SIGHUP), so a
  // grandchild the child spawned — the Telegram poller `bun server.ts`, an MCP
  // stdio server in the child's process group — can outlive an orchestrator
  // stop/restart as an orphan and keep holding Telegram's single-consumer
  // getUpdates slot → the next orchestrator's poller 409s and inbound breaks.
  // kill() must take down the whole PTY process GROUP (child + descendants).
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    spawned.length = 0;
    // Never actually signal anything from the test — record calls instead.
    killSpy = vi
      .spyOn(process, "kill")
      .mockImplementation(() => true as unknown as boolean);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    killSpy.mockRestore();
  });

  it("SIGTERMs the child's whole process group (negative pid), then SIGKILL-sweeps survivors", async () => {
    const pm = new PtyManager();
    pm.create("orch-1", "Orchestrator");
    const proc = spawned[0] as FakePtyInst;
    proc.pid = 4242;

    pm.kill("orch-1");

    // Graceful group SIGTERM, scoped to the child's own group (-pid) so the
    // poller runs its own shutdown (drops the getUpdates long-poll) fast.
    expect(killSpy).toHaveBeenCalledWith(-4242, "SIGTERM");
    // node-pty's own single-pid cleanup still runs (closes the master fd).
    expect(proc.killed.length).toBe(1);
    // Escalation is deferred — no SIGKILL yet.
    expect(killSpy).not.toHaveBeenCalledWith(-4242, "SIGKILL");

    await vi.advanceTimersByTimeAsync(2500);
    // Anything still in the group after the poller's ~2s grace gets SIGKILL.
    expect(killSpy).toHaveBeenCalledWith(-4242, "SIGKILL");

    // Session is evicted so a later write is a no-op.
    expect(pm.listSessions()).toEqual([]);
  });

  it("never signals process group 0/1 or a non-integer pid (guards Electron + all other agents)", () => {
    const pm = new PtyManager();
    for (const badPid of [0, 1, -5, Number.NaN]) {
      spawned.length = 0;
      const id = `x-${String(badPid)}`;
      pm.create(id, "x");
      (spawned[0] as FakePtyInst).pid = badPid as number;
      pm.kill(id);
    }
    // No group signal (negative-pid) may target 0, 1, or NaN — process.kill(-0)
    // would blast the Electron main's OWN group (every agent), -1 the system.
    for (const call of killSpy.mock.calls) {
      const target = call[0] as number;
      expect(Object.is(target, -0)).toBe(false);
      expect(target).not.toBe(0);
      expect(target).not.toBe(-1);
      expect(Number.isNaN(target)).toBe(false);
    }
  });

  it("kill on an unknown id does not signal any group", () => {
    const pm = new PtyManager();
    pm.kill("nope");
    expect(killSpy).not.toHaveBeenCalled();
  });
});
