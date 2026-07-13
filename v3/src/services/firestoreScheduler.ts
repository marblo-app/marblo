type IdleCallbackHandle = number;

interface IdleDeadlineLike {
  didTimeout: boolean;
  timeRemaining(): number;
}

type ScheduleIdleCallback = (
  callback: (deadline: IdleDeadlineLike) => void,
) => IdleCallbackHandle;

type CancelIdleCallback = (handle: IdleCallbackHandle) => void;

export interface DeferredSnapshotScheduler {
  schedule(callback: () => void): void;
  cancel(): void;
}

function createDefaultIdleScheduler(): {
  scheduleIdle: ScheduleIdleCallback;
  cancelIdle: CancelIdleCallback;
} {
  if (typeof requestIdleCallback !== "undefined") {
    return {
      scheduleIdle: (callback) => requestIdleCallback(callback),
      cancelIdle:
        typeof cancelIdleCallback !== "undefined"
          ? (handle) => cancelIdleCallback(handle)
          : (handle) => clearTimeout(handle),
    };
  }

  return {
    scheduleIdle: (callback) =>
      window.setTimeout(
        () => callback({ didTimeout: false, timeRemaining: () => 0 }),
        0,
      ),
    cancelIdle: (handle) => clearTimeout(handle),
  };
}

export function createDeferredSnapshotScheduler(
  scheduler: {
    scheduleIdle: ScheduleIdleCallback;
    cancelIdle: CancelIdleCallback;
  } = createDefaultIdleScheduler(),
): DeferredSnapshotScheduler {
  let active = true;
  let version = 0;
  let pendingHandle: IdleCallbackHandle | null = null;

  return {
    schedule(callback) {
      if (!active) return;
      version += 1;
      const scheduledVersion = version;

      if (pendingHandle !== null) {
        scheduler.cancelIdle(pendingHandle);
        pendingHandle = null;
      }

      pendingHandle = scheduler.scheduleIdle(() => {
        pendingHandle = null;
        if (!active || scheduledVersion !== version) return;
        callback();
      });
    },

    cancel() {
      active = false;
      version += 1;
      if (pendingHandle !== null) {
        scheduler.cancelIdle(pendingHandle);
        pendingHandle = null;
      }
    },
  };
}
