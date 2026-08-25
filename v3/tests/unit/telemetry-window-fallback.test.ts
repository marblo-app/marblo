/**
 * 텔레메트리 IPC 창 폴백 (ticket GCNpqvDYRrLhyLghPCF9).
 *
 * sendTelemetry 가 죽은 창을 조용히 버리면 agent:stopped 가 스폰의 26% 만
 * 남는다. 다른 창이 살아 있으면 그리로 보낸다.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ BrowserWindow: class {} }));

import { resolveTelemetryWindow } from "../../electron/telemetry";

function fakeWin(alive: boolean) {
  return {
    isDestroyed: () => !alive,
    webContents: { send: vi.fn() },
  };
}

describe("resolveTelemetryWindow", () => {
  it("선호 창이 살아 있으면 그걸 쓴다", () => {
    const preferred = fakeWin(true);
    const other = fakeWin(true);
    expect(resolveTelemetryWindow(preferred, [other])).toBe(preferred);
  });

  it("선호 창이 죽으면 살아 있는 다른 창으로 폴백한다", () => {
    const preferred = fakeWin(false);
    const other = fakeWin(true);
    expect(resolveTelemetryWindow(preferred, [preferred, other])).toBe(other);
  });

  it("창이 전부 죽었으면 null — 없는 창으로 보내지 않는다", () => {
    const preferred = fakeWin(false);
    expect(resolveTelemetryWindow(preferred, [preferred])).toBeNull();
    expect(resolveTelemetryWindow(null, [])).toBeNull();
  });
});
