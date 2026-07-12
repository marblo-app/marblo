import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";

const { FakePty, spawned, spawnControl } = vi.hoisted(() => {
  class FakePty {
    written: string[] = [];
    dataCbs: Array<(data: string) => void> = [];
    exitCbs: Array<(e: { exitCode: number; signal?: number }) => void> = [];
    // node-pty's real IPty exposes the forked child pid; the group-kill path
    // reads it. Default to a safe, valid pid so unrelated tests don't trip the
    // scope guard; the reaping tests override it per case.
    pid = 4242;
    killed: (string | undefined)[] = [];
    // node-pty's real UnixTerminal.destroy() is the ONLY method that closes the
    // read stream and frees the master fd (kill() merely signals). PtyManager
    // must route every teardown through destroy(); count invocations to prove
    // the fd is actually released (leak fix, ticket s8HmkKIPzpMohBdth1mT).
    destroyed = 0;

    write(data: string): void {
      this.written.push(data);
    }

    resize(): void {}

    kill(signal?: string): void {
      this.killed.push(signal);
    }

    destroy(): void {
      this.destroyed++;
    }

    onData(cb: (data: string) => void): { dispose: () => void } {
      this.dataCbs.push(cb);
      return {
        dispose: () => {
          this.dataCbs = this.dataCbs.filter((registered) => registered !== cb);
        },
      };
    }

    onExit(cb: (e: { exitCode: number; signal?: number }) => void): {
      dispose: () => void;
    } {
      this.exitCbs.push(cb);
      return {
        dispose: () => {
          this.exitCbs = this.exitCbs.filter((registered) => registered !== cb);
        },
      };
    }

    emitData(data: string): void {
      for (const cb of [...this.dataCbs]) cb(data);
    }

    emitExit(exitCode = 0): void {
      for (const cb of [...this.exitCbs]) cb({ exitCode });
    }
  }

  return {
    FakePty,
    spawned: [] as FakePty[],
    // Lets a single test force the next pty.spawn() to throw a chosen error
    // (e.g. ENXIO — the macOS pty-pool-exhausted signal). Cleared after firing.
    spawnControl: { nextError: null as NodeJS.ErrnoException | null },
  };
});

vi.mock("node-pty", () => ({
  spawn: () => {
    if (spawnControl.nextError) {
      const err = spawnControl.nextError;
      spawnControl.nextError = null;
      throw err;
    }
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

describe("PtyManager — per-session dangerous-command blocking (P3-3)", () => {
  // High-severity command from danger-command.ts. `rm -rf /tmp/x` matches
  // isRmRf; it must be DROPPED (never written) only for sessions opted into
  // blocking, and pass through (warn-only) everywhere else so worktree-isolated
  // workers aren't regressed.
  const DANGER = "rm -rf /tmp/x";
  const MEDIUM = "sudo apt-get update"; // medium severity — never blocked

  beforeEach(() => {
    vi.useFakeTimers();
    spawned.length = 0;
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  async function flush(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  it("warn-only by default: a dangerous command is still written (not blocked)", async () => {
    const pm = new PtyManager();
    pm.create("pty-1", "worker");
    const proc = spawned[0] as FakePtyInst;
    pm.writeAndSubmit("pty-1", DANGER, DELAY_MS);
    await flush();
    expect(proc.written).toEqual([`\x1b[200~${DANGER}\x1b[201~`]);
  });

  it("blocks a high-severity command for a session opted into blocking", async () => {
    const pm = new PtyManager();
    pm.create("orch-1", "Orchestrator");
    const proc = spawned[0] as FakePtyInst;
    pm.setBlockDangerousForSession("orch-1", true);
    pm.writeAndSubmit("orch-1", DANGER, DELAY_MS);
    await flush();
    expect(proc.written).toEqual([]); // dropped
  });

  it("does NOT block other sessions (scoped to the opted-in id only)", async () => {
    const pm = new PtyManager();
    pm.create("orch-1", "Orchestrator");
    pm.create("worker-1", "worker");
    const orch = spawned[0] as FakePtyInst;
    const worker = spawned[1] as FakePtyInst;
    pm.setBlockDangerousForSession("orch-1", true);
    pm.writeAndSubmit("orch-1", DANGER, DELAY_MS);
    pm.writeAndSubmit("worker-1", DANGER, DELAY_MS);
    await flush();
    expect(orch.written).toEqual([]); // blocked
    expect(worker.written).toEqual([`\x1b[200~${DANGER}\x1b[201~`]); // warn-only
  });

  it("blocks high but NOT medium severity even when the session is opted in", async () => {
    const pm = new PtyManager();
    pm.create("orch-1", "Orchestrator");
    const proc = spawned[0] as FakePtyInst;
    pm.setBlockDangerousForSession("orch-1", true);
    pm.writeAndSubmit("orch-1", MEDIUM, DELAY_MS);
    await flush();
    expect(proc.written).toEqual([`\x1b[200~${MEDIUM}\x1b[201~`]); // medium passes
  });

  it("clears the per-session opt-in on kill (no stale block leaks to a reused id)", async () => {
    const pm = new PtyManager();
    pm.create("orch-1", "Orchestrator");
    pm.setBlockDangerousForSession("orch-1", true);
    pm.kill("orch-1");
    // Reuse the same id for a fresh session that never opted in.
    pm.create("orch-1", "Orchestrator");
    const proc = spawned[spawned.length - 1] as FakePtyInst;
    pm.writeAndSubmit("orch-1", DANGER, DELAY_MS);
    await flush();
    expect(proc.written).toEqual([`\x1b[200~${DANGER}\x1b[201~`]); // not blocked
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
    // The MASTER FD is released via node-pty .destroy() — kill() only signals
    // and would leak the fd. (destroy() also SIGHUPs the direct child itself.)
    expect(proc.destroyed).toBe(1);
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

describe("PtyManager — master-fd leak guard (ticket s8HmkKIPzpMohBdth1mT)", () => {
  // Root cause: node-pty 1.1.0 .kill() only signals the child; the pty MASTER
  // fd is freed solely by .destroy(). Overwriting a live id, an exit that
  // leaves the map entry, or a paused stream all leak the master fd, which
  // accumulates against macOS kern.tty.ptmx_max (511) until openpty() returns
  // ENXIO and every new agent/terminal spawn dies with "posix_spawnp failed".
  beforeEach(() => {
    spawned.length = 0;
    spawnControl.nextError = null;
  });

  it("destroys the stale live PTY when create() reuses the same id (no fd leak on relaunch)", () => {
    const pm = new PtyManager();
    pm.create("agent-7", "worker");
    const first = spawned[0] as FakePtyInst;

    // Relaunch reuses the deterministic id; the old process is still live.
    pm.create("agent-7", "worker");
    const second = spawned[1] as FakePtyInst;

    // Old pty's fd released, new one live and owning the id.
    expect(first.destroyed).toBe(1);
    expect(second.destroyed).toBe(0);
    expect(pm.listSessions()).toEqual([{ id: "agent-7", name: "worker" }]);
  });

  it("releases the master fd on child self-exit and evicts the session", () => {
    const pm = new PtyManager();
    pm.create("agent-x", "worker");
    const proc = spawned[0] as FakePtyInst;
    const exits: number[] = [];
    pm.onExit("agent-x", (code) => exits.push(code));

    proc.emitExit(0);

    expect(exits).toEqual([0]); // caller callback still fires
    expect(proc.destroyed).toBe(1); // fd released, not left to node-pty's timeout
    expect(pm.listSessions()).toEqual([]); // map entry gone
  });

  it("a stale exit fires the callback but does NOT evict the replacement (destroys only the old pty)", () => {
    const pm = new PtyManager();
    pm.create("agent-r", "worker");
    const oldProc = spawned[0] as FakePtyInst;
    pm.onExit("agent-r", () => {});

    // Same id reclaimed by a fresh session (relaunch) — create() already
    // destroyed oldProc, and the NEW pty now owns the id.
    pm.create("agent-r", "worker");
    const newProc = spawned[1] as FakePtyInst;

    // The OLD pty's late exit must not touch the replacement.
    oldProc.emitExit(1);
    expect(newProc.destroyed).toBe(0);
    expect(pm.listSessions()).toEqual([{ id: "agent-r", name: "worker" }]);
  });

  it("reaper destroys sessions whose child pid is dead (ESRCH) and leaves live ones", () => {
    const pm = new PtyManager();
    pm.create("dead", "gone");
    pm.create("alive", "running");
    const deadProc = spawned[0] as FakePtyInst;
    const aliveProc = spawned[1] as FakePtyInst;
    deadProc.pid = 9001;
    aliveProc.pid = 9002;

    const killSpy = vi
      .spyOn(process, "kill")
      .mockImplementation((pid: number) => {
        // pid 0-probe: dead pid throws ESRCH, live pid returns.
        if (pid === 9001) {
          const e: NodeJS.ErrnoException = new Error("no such process");
          e.code = "ESRCH";
          throw e;
        }
        return true as unknown as boolean;
      });

    try {
      // Reaper is private; drive one sweep via the interval it schedules.
      vi.useFakeTimers();
      pm.startReaper();
      vi.advanceTimersByTime(60_000);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
      pm.stopReaper();
      killSpy.mockRestore();
    }

    expect(deadProc.destroyed).toBe(1);
    expect(aliveProc.destroyed).toBe(0);
    expect(pm.listSessions()).toEqual([{ id: "alive", name: "running" }]);
  });

  it("surfaces an exhausted pty pool (ENXIO) as a clear 'PTY exhausted' error", () => {
    const pm = new PtyManager();
    const enxio: NodeJS.ErrnoException = new Error("posix_spawnp failed");
    enxio.code = "ENXIO";
    spawnControl.nextError = enxio;

    expect(() => pm.create("boom", "worker")).toThrowError(/PTY exhausted/i);
  });
});

// The real leak is the ORPHAN /dev/ptmx master node-pty opens per spawn and
// never closes (ticket o1ozhfJtWVZemBPjQzZ2) — the earlier .destroy() fix was a
// no-op against it. releaseOrphanMasterFds is the reclaim path; these tests pin
// its SAFETY contract on a real character device (/dev/null) so a regression in
// the guards is caught in CI, without needing real node-pty. The full real-fd,
// zero-leak proof across every teardown path lives in the macOS/node22-only
// integration harness (tests/integration/pty-fd-leak.cjs, `npm run test:pty-leak`).
type OrphanFd = { fd: number; rdev: number };
type WithRelease = { releaseOrphanMasterFds(orphanFds?: OrphanFd[]): void };

// /dev/null is a character device on POSIX; on Windows there is no such fd, so
// this contract (and the leak it guards) is POSIX-only. Skip cleanly elsewhere.
const posix = process.platform !== "win32";

describe.runIf(posix)(
  "PtyManager — orphan master-fd reclaim contract (ticket o1ozhfJtWVZemBPjQzZ2)",
  () => {
    function openCharDev(): OrphanFd {
      const fd = fs.openSync("/dev/null", "r");
      return { fd, rdev: fs.fstatSync(fd).rdev };
    }
    const isOpen = (fd: number): boolean => {
      try {
        fs.fstatSync(fd);
        return true;
      } catch {
        return false;
      }
    };

    it("closes a captured orphan fd whose device still matches, reclaiming it", () => {
      const pm = new PtyManager() as unknown as WithRelease;
      const orphan = openCharDev();
      expect(isOpen(orphan.fd)).toBe(true);

      const list = [orphan];
      pm.releaseOrphanMasterFds(list);

      expect(isOpen(orphan.fd)).toBe(false); // fd reclaimed
      expect(list).toHaveLength(0); // list emptied so repeat calls no-op
    });

    it("does NOT close an fd whose device no longer matches (anti wrong-close after recycle)", () => {
      const pm = new PtyManager() as unknown as WithRelease;
      const held = openCharDev();
      try {
        // Same fd number, but a bogus rdev — models the fd being recycled by the
        // OS into a different device since capture. Must be left untouched.
        pm.releaseOrphanMasterFds([{ fd: held.fd, rdev: held.rdev + 12345 }]);
        expect(isOpen(held.fd)).toBe(true); // NOT closed
      } finally {
        fs.closeSync(held.fd);
      }
    });

    it("is idempotent: a second teardown on the same list is a harmless no-op", () => {
      const pm = new PtyManager() as unknown as WithRelease;
      const orphan = openCharDev();
      const list = [orphan];

      pm.releaseOrphanMasterFds(list);
      // Second call (e.g. kill() then a late onExit, or the reaper) must not
      // throw and must not close whatever now holds that recycled fd number.
      expect(() => pm.releaseOrphanMasterFds(list)).not.toThrow();
      expect(() => pm.releaseOrphanMasterFds(undefined)).not.toThrow();
      expect(() => pm.releaseOrphanMasterFds([])).not.toThrow();
    });
  },
);
