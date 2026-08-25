/**
 * 창이 숨거나 죽기 전에 텔레메트리 flush (ticket GCNpqvDYRrLhyLghPCF9).
 */
import { describe, expect, it, vi } from "vitest";
import {
  bindTelemetryLifecycleFlush,
  shouldFlushTelemetryOnLifecycle,
} from "../../src/services/telemetryLifecycle";

describe("shouldFlushTelemetryOnLifecycle", () => {
  it("pagehide 와 hidden 에서만 flush 한다", () => {
    expect(shouldFlushTelemetryOnLifecycle("pagehide")).toBe(true);
    expect(shouldFlushTelemetryOnLifecycle("visibilitychange", "hidden")).toBe(
      true,
    );
    expect(shouldFlushTelemetryOnLifecycle("visibilitychange", "visible")).toBe(
      false,
    );
    expect(shouldFlushTelemetryOnLifecycle("focus")).toBe(false);
  });
});

describe("bindTelemetryLifecycleFlush", () => {
  it("pagehide 와 visibility hidden 에서 flush 를 호출한다", () => {
    const flush = vi.fn();
    const listeners = new Map<string, () => void>();
    const docListeners = new Map<string, () => void>();
    const doc = {
      visibilityState: "visible" as string,
      addEventListener: (type: string, listener: () => void) => {
        docListeners.set(type, listener);
      },
    };
    const target = {
      addEventListener: (type: string, listener: () => void) => {
        listeners.set(type, listener);
      },
      document: doc,
    };
    bindTelemetryLifecycleFlush(flush, target);

    listeners.get("pagehide")?.();
    expect(flush).toHaveBeenCalledTimes(1);

    doc.visibilityState = "hidden";
    docListeners.get("visibilitychange")?.();
    expect(flush).toHaveBeenCalledTimes(2);

    doc.visibilityState = "visible";
    docListeners.get("visibilitychange")?.();
    expect(flush).toHaveBeenCalledTimes(2);
  });
});
