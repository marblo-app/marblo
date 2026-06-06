import { describe, expect, it } from "vitest";
import {
  resolveContext,
  resolveContextForWrite,
  contextReadFilter,
  contextForKind,
  computeContextIdBackfill,
} from "../../electron/mcp-server/context";

describe("resolveContext (read-scope)", () => {
  it("returns the MARBLO_CONTEXT value when set", () => {
    expect(resolveContext({ MARBLO_CONTEXT: "board" })).toBe("board");
    expect(resolveContext({ MARBLO_CONTEXT: "lane:abc123" })).toBe(
      "lane:abc123"
    );
  });
  it("returns empty string (unscoped) when unset", () => {
    expect(resolveContext({})).toBe("");
  });
});

describe("resolveContextForWrite (write-label)", () => {
  it("defaults to 'board' so every task is labeled", () => {
    expect(resolveContextForWrite({})).toBe("board");
  });
  it("uses the explicit context when set", () => {
    expect(resolveContextForWrite({ MARBLO_CONTEXT: "lane:x" })).toBe("lane:x");
  });
});

describe("contextReadFilter", () => {
  it("returns '' (no filter) when all_contexts is true", () => {
    expect(contextReadFilter(true, { MARBLO_CONTEXT: "board" })).toBe("");
  });
  it("returns the resolved context when all_contexts is false", () => {
    expect(contextReadFilter(false, { MARBLO_CONTEXT: "board" })).toBe("board");
  });
  it("returns '' (unscoped) when context unset and all_contexts false", () => {
    expect(contextReadFilter(false, {})).toBe("");
  });
});

describe("contextForKind", () => {
  it("maps board → 'board'", () => {
    expect(contextForKind("board")).toBe("board");
  });
  it("maps non-board kinds → '' (unscoped, no regression)", () => {
    expect(contextForKind("mission")).toBe("");
  });
});

describe("computeContextIdBackfill", () => {
  it("labels tasks missing contextId: missionId wins, else 'board'", () => {
    const out = computeContextIdBackfill([
      { id: "a" },
      { id: "b", missionId: "m1" },
      { id: "c", contextId: "lane:z" },
    ]);
    expect(out).toEqual([
      { id: "a", contextId: "board" },
      { id: "b", contextId: "m1" },
    ]);
  });
});
