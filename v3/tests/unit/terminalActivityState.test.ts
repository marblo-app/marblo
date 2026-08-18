import { describe, expect, it } from "vitest";
import {
  isBusyTerminalActivityState,
  isSettledTerminalActivityState,
  isTerminalActivitySettlingTransition,
} from "../../src/components/terminal/activityState";

describe("terminal activity state transitions", () => {
  it("treats Grok generation states as busy", () => {
    for (const state of ["running", "working", "generating", "streaming"]) {
      expect(isBusyTerminalActivityState(state)).toBe(true);
    }
  });

  it("treats completion and idle states as settled", () => {
    for (const state of ["done", "complete", "completed", "idle"]) {
      expect(isSettledTerminalActivityState(state)).toBe(true);
    }
  });

  it("fires for generation completion transitions", () => {
    expect(isTerminalActivitySettlingTransition("generating", "done")).toBe(
      true,
    );
    expect(isTerminalActivitySettlingTransition("streaming", "idle")).toBe(
      true,
    );
    expect(isTerminalActivitySettlingTransition("working", "completed")).toBe(
      true,
    );
  });

  it("does not fire for startup, repeated, or idle-only transitions", () => {
    expect(isTerminalActivitySettlingTransition(undefined, "idle")).toBe(false);
    expect(isTerminalActivitySettlingTransition("idle", "running")).toBe(false);
    expect(isTerminalActivitySettlingTransition("running", "running")).toBe(
      false,
    );
    expect(isTerminalActivitySettlingTransition("idle", "done")).toBe(false);
  });
});
