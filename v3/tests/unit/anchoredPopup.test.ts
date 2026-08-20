import { describe, it, expect } from "vitest";
import {
  placeAnchoredPopup,
  VIEWPORT_MARGIN,
  type AnchorRect,
} from "../../src/lib/anchoredPopup";

const VIEWPORT = { width: 1440, height: 900 };
const WIDTH = 288;
const EST_HEIGHT = 300;

function rect(partial: Partial<AnchorRect>): AnchorRect {
  return { top: 100, bottom: 120, left: 200, right: 260, ...partial };
}

describe("placeAnchoredPopup", () => {
  // The regression this module exists for: in the Workspace split shell the
  // orchestrator header sits at the TOP of the left column, so an
  // unconditionally-upward popup rendered off the top of its clipped ancestor
  // and the session picker looked like it had vanished.
  it("opens downward when the trigger is near the top of the viewport", () => {
    const p = placeAnchoredPopup(
      rect({ top: 100, bottom: 120 }),
      VIEWPORT,
      WIDTH,
      EST_HEIGHT,
      "left",
    );
    expect(p.top).toBe(124);
    expect(p.bottom).toBeUndefined();
  });

  it("flips upward only when there is no room below and more room above", () => {
    const p = placeAnchoredPopup(
      rect({ top: 800, bottom: 820 }),
      VIEWPORT,
      WIDTH,
      EST_HEIGHT,
      "left",
    );
    expect(p.bottom).toBe(VIEWPORT.height - 800 + 4);
    expect(p.top).toBeUndefined();
  });

  it("stays downward when space is tight both ways but below is larger", () => {
    const p = placeAnchoredPopup(
      rect({ top: 200, bottom: 220 }),
      { width: 1440, height: 500 },
      WIDTH,
      EST_HEIGHT,
      "left",
    );
    // 280 below vs 200 above — neither fits estHeight, so it must not flip.
    expect(p.top).toBe(224);
    expect(p.bottom).toBeUndefined();
  });

  it("caps maxHeight to the space actually available so long lists scroll", () => {
    const p = placeAnchoredPopup(
      rect({ top: 100, bottom: 120 }),
      { width: 1440, height: 300 },
      WIDTH,
      EST_HEIGHT,
      "left",
    );
    expect(p.maxHeight).toBe(300 - 120 - VIEWPORT_MARGIN - 4);
    expect(p.maxHeight).toBeGreaterThan(0);
  });

  it("never returns a negative maxHeight", () => {
    const p = placeAnchoredPopup(
      rect({ top: 295, bottom: 299 }),
      { width: 1440, height: 300 },
      WIDTH,
      EST_HEIGHT,
      "left",
    );
    expect(p.maxHeight).toBeGreaterThanOrEqual(0);
  });

  // prefer:"up" — the first-spawn guide rail sits directly on top of the live
  // orchestrator terminal, so falling downward would cover the very window the
  // panel is telling you to type into. Upward is the preference, not a
  // guarantee: it still flips rather than rendering off screen.
  it("opens upward on prefer:up even when there is room below", () => {
    const p = placeAnchoredPopup(
      rect({ top: 600, bottom: 620 }),
      VIEWPORT,
      WIDTH,
      EST_HEIGHT,
      "left",
      "up",
    );
    expect(p.bottom).toBe(VIEWPORT.height - 600 + 4);
    expect(p.top).toBeUndefined();
  });

  it("flips downward on prefer:up when the trigger is pinned near the top", () => {
    const p = placeAnchoredPopup(
      rect({ top: 40, bottom: 60 }),
      VIEWPORT,
      WIDTH,
      EST_HEIGHT,
      "left",
      "up",
    );
    expect(p.top).toBe(64);
    expect(p.bottom).toBeUndefined();
    expect(p.maxHeight).toBeGreaterThan(0);
  });

  // The discriminating case: room on BOTH sides. The default must still fall
  // downward (every existing caller depends on it) while prefer:"up" rises.
  it("keeps the historical downward default when prefer is omitted", () => {
    const roomy = { width: 1440, height: 1200 };
    const anchor = rect({ top: 600, bottom: 620 });

    const withDefault = placeAnchoredPopup(
      anchor,
      roomy,
      WIDTH,
      EST_HEIGHT,
      "left",
    );
    expect(withDefault.top).toBe(624);
    expect(withDefault.bottom).toBeUndefined();

    const preferUp = placeAnchoredPopup(
      anchor,
      roomy,
      WIDTH,
      EST_HEIGHT,
      "left",
      "up",
    );
    expect(preferUp.bottom).toBe(roomy.height - 600 + 4);
    expect(preferUp.top).toBeUndefined();
  });

  it("left-aligns to the trigger's left edge", () => {
    const p = placeAnchoredPopup(
      rect({ left: 200, right: 260 }),
      VIEWPORT,
      WIDTH,
      EST_HEIGHT,
      "left",
    );
    expect(p.left).toBe(200);
  });

  it("right-aligns the popup's right edge to the trigger's", () => {
    const p = placeAnchoredPopup(
      rect({ left: 600, right: 660 }),
      VIEWPORT,
      WIDTH,
      EST_HEIGHT,
      "right",
    );
    expect(p.left).toBe(660 - WIDTH);
  });

  it("clamps a popup that would overflow the right edge", () => {
    const p = placeAnchoredPopup(
      rect({ left: 1400, right: 1430 }),
      VIEWPORT,
      WIDTH,
      EST_HEIGHT,
      "left",
    );
    expect(p.left).toBe(VIEWPORT.width - WIDTH - VIEWPORT_MARGIN);
    expect(p.left + WIDTH).toBeLessThanOrEqual(VIEWPORT.width);
  });

  it("clamps a popup that would overflow the left edge", () => {
    const p = placeAnchoredPopup(
      rect({ left: 4, right: 30 }),
      VIEWPORT,
      WIDTH,
      EST_HEIGHT,
      "right",
    );
    expect(p.left).toBe(VIEWPORT_MARGIN);
  });

  it("keeps a narrow viewport on screen rather than going negative", () => {
    const p = placeAnchoredPopup(
      rect({ left: 10, right: 40 }),
      { width: 200, height: 900 },
      WIDTH,
      EST_HEIGHT,
      "left",
    );
    expect(p.left).toBe(VIEWPORT_MARGIN);
  });
});
