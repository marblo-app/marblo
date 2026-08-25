import { describe, expect, it } from "vitest";

import { evaluateTerminalCjkMetrics } from "../../src/lib/terminalCjkHealth";

describe("terminal CJK visual health", () => {
  it("fails stale xterm DOM letter-spacing even when the font ratio is correct", () => {
    const health = evaluateTerminalCjkMetrics({
      fontLoaded: true,
      asciiWidth: 6.5,
      hangulWidth: 13,
      screenCellWidth: 6.5,
      rowsLetterSpacingPx: 2.65,
      maxAbsSpanLetterSpacingPx: 2.65,
    });

    expect(health.ok).toBe(false);
    expect(health.failures.join("\n")).toContain("letter-spacing");
  });

  it("passes when Hangul occupies two ASCII cells and visible spacing is zero", () => {
    const health = evaluateTerminalCjkMetrics({
      fontLoaded: true,
      asciiWidth: 6.5,
      hangulWidth: 13,
      screenCellWidth: 6.5,
      rowsLetterSpacingPx: 0,
      maxAbsSpanLetterSpacingPx: 0,
    });

    expect(health).toMatchObject({
      ok: true,
      hangulToAsciiRatio: 2,
      hangulToScreenCellRatio: 2,
      failures: [],
    });
  });

  it("fails fallback-baked cell metrics before users need to see it", () => {
    const health = evaluateTerminalCjkMetrics({
      fontLoaded: true,
      asciiWidth: 7.827,
      hangulWidth: 13,
      screenCellWidth: 7.827,
      rowsLetterSpacingPx: 0,
      maxAbsSpanLetterSpacingPx: 0,
    });

    expect(health.ok).toBe(false);
    expect(health.failures.join("\n")).toContain("Hangul/ASCII");
  });
});
