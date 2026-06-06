import { describe, expect, it } from "vitest";
import { isLaneTask } from "../../src/lib/laneContext";

describe("isLaneTask", () => {
  it("is false for the board context", () => {
    expect(isLaneTask("board")).toBe(false);
  });
  it("is false when contextId is missing/empty (treated as board)", () => {
    expect(isLaneTask(undefined)).toBe(false);
    expect(isLaneTask("")).toBe(false);
  });
  it("is true for a lane context", () => {
    expect(isLaneTask("lane:abc123")).toBe(true);
  });
  it("is true for a mission context", () => {
    expect(isLaneTask("mission-xyz")).toBe(true);
  });
});
