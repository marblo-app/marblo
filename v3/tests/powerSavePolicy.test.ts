import { describe, expect, it } from "vitest";
import {
  normalizePowerSaveMode,
  powerSaveSources,
} from "../electron/power-save-policy";

describe("power save policy", () => {
  it("keeps the previous default as working-only when no new setting exists", () => {
    expect(normalizePowerSaveMode(undefined, undefined)).toBe("working");
    expect(normalizePowerSaveMode(undefined, false)).toBe("off");
  });

  it("holds an assertion while remotely waiting even with no active work", () => {
    expect(powerSaveSources("remote", [])).toEqual(["remote-wait"]);
  });

  it("does not claim an assertion source when the mode is off", () => {
    expect(powerSaveSources("off", ["agent", "telegram-poller"])).toEqual([]);
  });
});
