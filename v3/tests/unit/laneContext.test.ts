import { describe, expect, it } from "vitest";
import {
  buildLaneContextId,
  getMissionId,
  isLaneContext,
  isLaneTask,
  isMissionTask,
  parseLaneContextId,
} from "../../src/lib/laneContext";

describe("buildLaneContextId", () => {
  it('prefixes the laneId with "lane:" per the contextId 규약', () => {
    expect(buildLaneContextId("abc123")).toBe("lane:abc123");
  });
  it("round-trips through parseLaneContextId", () => {
    const laneId = "550e8400-e29b-41d4-a716-446655440000";
    expect(parseLaneContextId(buildLaneContextId(laneId))).toBe(laneId);
  });
  it("produces a context that isLaneContext recognizes", () => {
    expect(isLaneContext(buildLaneContextId("x"))).toBe(true);
  });
});

describe("isLaneContext", () => {
  it('is true for a "lane:" prefixed context', () => {
    expect(isLaneContext("lane:abc")).toBe(true);
  });
  it("is true for a bare lane: prefix (empty laneId)", () => {
    expect(isLaneContext("lane:")).toBe(true);
  });
  it("is false for board / mission / empty / null / undefined", () => {
    expect(isLaneContext("board")).toBe(false);
    expect(isLaneContext("mission-xyz")).toBe(false);
    expect(isLaneContext("")).toBe(false);
    expect(isLaneContext(null)).toBe(false);
    expect(isLaneContext(undefined)).toBe(false);
  });
  it('is false for the legacy bare "lane" literal (B1 — no longer a lane)', () => {
    // 옛 버그: contextId="lane" 단일 리터럴. 규약은 "lane:<id>" 뿐이다.
    expect(isLaneContext("lane")).toBe(false);
  });
});

describe("parseLaneContextId", () => {
  it("extracts the laneId from a lane context", () => {
    expect(parseLaneContextId("lane:abc123")).toBe("abc123");
  });
  it("returns an empty string for a bare lane: prefix", () => {
    expect(parseLaneContextId("lane:")).toBe("");
  });
  it("returns null for non-lane contexts", () => {
    expect(parseLaneContextId("board")).toBeNull();
    expect(parseLaneContextId("mission-xyz")).toBeNull();
    expect(parseLaneContextId("lane")).toBeNull();
    expect(parseLaneContextId("")).toBeNull();
    expect(parseLaneContextId(undefined)).toBeNull();
  });
});

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
  it("is true for a bare lane: prefix (empty laneId)", () => {
    expect(isLaneTask("lane:")).toBe(true);
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
  it("returns null for an empty string", () => {
    expect(getMissionId("")).toBeNull();
  });
});
