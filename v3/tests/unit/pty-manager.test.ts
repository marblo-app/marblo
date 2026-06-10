import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { FakePty, spawned } = vi.hoisted(() => {
  class FakePty {
    written: string[] = [];
    dataCbs: Array<(data: string) => void> = [];

    write(data: string): void {
      this.written.push(data);
    }

    resize(): void {}

    kill(): void {}

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
