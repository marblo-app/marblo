import { describe, expect, it } from "vitest";
import { isAwaitingInput } from "../../src/lib/attentionDetect";

describe("isAwaitingInput", () => {
  it("detects [y/N] prompt at line end", () => {
    expect(isAwaitingInput(["Proceed? [y/N]"])).toBe(true);
  });

  it("detects (y/n) variant", () => {
    expect(isAwaitingInput(["Continue install? (y/n)"])).toBe(true);
  });

  it("detects 'Press Enter' line", () => {
    expect(isAwaitingInput(["Press Enter to continue"])).toBe(true);
  });

  it("detects Continue? with trailing whitespace", () => {
    expect(isAwaitingInput(["Continue?  "])).toBe(true);
  });

  it("detects trailing prompt arrow ›", () => {
    expect(isAwaitingInput(["›"])).toBe(true);
  });

  it("returns false for plain log lines (no false positive)", () => {
    expect(
      isAwaitingInput([
        "compiling src/foo.ts",
        "warning: variable unused",
        "✓ tests passed",
      ]),
    ).toBe(false);
  });

  it("returns false when '?' appears mid-line (e.g. URL query)", () => {
    expect(
      isAwaitingInput(["fetched https://api.example.com/x?q=1 successfully"]),
    ).toBe(false);
  });

  it("uses last non-empty line as authoritative", () => {
    expect(isAwaitingInput(["log line", "Continue? [y/N]", "", ""])).toBe(true);
  });

  it("returns false for empty buffer", () => {
    expect(isAwaitingInput([])).toBe(false);
    expect(isAwaitingInput(undefined)).toBe(false);
  });

  it("ignores ANSI sequences when matching", () => {
    expect(isAwaitingInput(["\x1b[33mContinue?\x1b[0m"])).toBe(true);
  });
});
