import { describe, expect, it } from "vitest";
import {
  getMissionId,
  isLaneTask,
  isMissionTask,
} from "../../src/lib/laneContext";

describe("isLaneTask", () => {
  it("is false for the board context", () => {
    expect(isLaneTask("board")).toBe(false);
  });
  it("is false when contextId is missing/empty (treated as board)", () => {
    expect(isLaneTask(undefined)).toBe(false);
    expect(isLaneTask("")).toBe(false);
  });
  it("is true only for a lane: prefixed context", () => {
    expect(isLaneTask("lane:abc123")).toBe(true);
  });
  it("is false for a mission context (raw missionId, no prefix)", () => {
    // 회귀: 예전엔 board 아니면 전부 lane 으로 판정해 미션을 lane 으로 오판했다.
    expect(isLaneTask("mission-xyz")).toBe(false);
  });
});

describe("isMissionTask", () => {
  it("is true for a raw missionId context", () => {
    expect(isMissionTask("mission-xyz")).toBe(true);
    expect(isMissionTask("aB3-uuid-1234")).toBe(true);
  });
  it("is false for board / empty / undefined", () => {
    expect(isMissionTask("board")).toBe(false);
    expect(isMissionTask("")).toBe(false);
    expect(isMissionTask(undefined)).toBe(false);
  });
  it("is false for a lane context", () => {
    expect(isMissionTask("lane:abc123")).toBe(false);
  });
});

describe("getMissionId", () => {
  it("returns the missionId for a mission context", () => {
    expect(getMissionId("mission-xyz")).toBe("mission-xyz");
  });
  it("returns null for board / lane / empty", () => {
    expect(getMissionId("board")).toBeNull();
    expect(getMissionId("lane:abc")).toBeNull();
    expect(getMissionId(undefined)).toBeNull();
  });
});
