import { describe, expect, it } from "vitest";
import { browserPaneBoundsFromContainerRect } from "../../electron/browser-pane-bounds";

describe("browserPaneBoundsFromContainerRect", () => {
  it("moves a visual-viewport rect into BrowserWindow content coordinates", () => {
    expect(
      browserPaneBoundsFromContainerRect(
        { x: 420.2, y: 71.6, width: 640.4, height: 480.4 },
        { x: 8, y: 24 },
        1,
      ),
    ).toEqual({ x: 428, y: 96, width: 640, height: 480 });
  });

  it("converts CSS pixels to DIP at Electron page zoom", () => {
    expect(
      browserPaneBoundsFromContainerRect(
        { x: 560, y: 80, width: 800, height: 600 },
        { x: 0, y: 0 },
        1.25,
      ),
    ).toEqual({ x: 700, y: 100, width: 1000, height: 750 });
  });

  it("uses the unzoomed scale for an invalid zoom factor", () => {
    expect(
      browserPaneBoundsFromContainerRect(
        { x: 20, y: 60, width: 800, height: 600 },
        { x: 0, y: 0 },
        Number.NaN,
      ),
    ).toEqual({ x: 20, y: 60, width: 800, height: 600 });
  });
});
