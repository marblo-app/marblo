import { describe, expect, it } from "vitest";
import { createDeferredSnapshotScheduler } from "../../src/services/firestoreScheduler";

function deferredHarness() {
  let nextHandle = 1;
  const queued = new Map<number, () => void>();
  return {
    scheduler: {
      scheduleIdle(callback: () => void): number {
        const handle = nextHandle;
        nextHandle += 1;
        queued.set(handle, callback);
        return handle;
      },
      cancelIdle(handle: number): void {
        queued.delete(handle);
      },
    },
    flush(handle: number): void {
      queued.get(handle)?.();
    },
    flushAll(): void {
      for (const callback of [...queued.values()]) callback();
    },
    queuedHandles(): number[] {
      return [...queued.keys()];
    },
  };
}

describe("createDeferredSnapshotScheduler", () => {
  it("applies only the latest queued snapshot", () => {
    const harness = deferredHarness();
    const scheduler = createDeferredSnapshotScheduler(harness.scheduler);
    const applied: string[] = [];

    scheduler.schedule(() => applied.push("stale"));
    scheduler.schedule(() => applied.push("fresh"));
    harness.flushAll();

    expect(applied).toEqual(["fresh"]);
  });

  it("drops pending snapshots after unsubscribe cancellation", () => {
    const harness = deferredHarness();
    const scheduler = createDeferredSnapshotScheduler(harness.scheduler);
    const applied: string[] = [];

    scheduler.schedule(() => applied.push("old-project"));
    expect(harness.queuedHandles()).toHaveLength(1);

    scheduler.cancel();
    harness.flushAll();

    expect(applied).toEqual([]);
    expect(harness.queuedHandles()).toHaveLength(0);
  });
});
