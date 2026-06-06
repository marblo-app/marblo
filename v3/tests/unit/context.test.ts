import { describe, expect, it } from "vitest";
import {
  resolveContext,
  resolveContextForWrite,
  contextReadFilter,
  contextForKind,
  computeContextIdBackfill,
} from "../../electron/mcp-server/context";
// The one-off backfill script duplicates computeContextIdBackfill (it cannot
// import the TS source without a build step). Import that copy here so the
// parity test below catches any drift between the two implementations.
import { computeContextIdBackfill as backfillScriptImpl } from "../../scripts/backfill-context-id.mjs";

describe("resolveContext (read-scope)", () => {
  it("returns the MARBLO_CONTEXT value when set", () => {
    expect(resolveContext({ MARBLO_CONTEXT: "board" })).toBe("board");
    expect(resolveContext({ MARBLO_CONTEXT: "lane:abc123" })).toBe(
      "lane:abc123",
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

describe("computeContextIdBackfill parity (context.ts ↔ backfill-context-id.mjs)", () => {
  // The two implementations are byte-for-byte copies today; this guards against
  // future drift by asserting they agree across a range of input shapes.
  const cases: { id: string; contextId?: string; missionId?: string }[][] = [
    [],
    [{ id: "a" }],
    [{ id: "b", missionId: "m1" }],
    [{ id: "c", contextId: "lane:z" }],
    [{ id: "d", contextId: "" }], // empty string is falsy → still backfilled
    [{ id: "e", missionId: "m2", contextId: "x" }], // already labeled → skipped
    [
      { id: "a" },
      { id: "b", missionId: "m1" },
      { id: "c", contextId: "lane:z" },
      { id: "d", contextId: "" },
      { id: "e", missionId: "m2", contextId: "x" },
    ],
  ];
  cases.forEach((tasks, i) => {
    it(`case ${i}: script copy matches the context.ts source`, () => {
      expect(backfillScriptImpl(tasks)).toEqual(
        computeContextIdBackfill(tasks),
      );
    });
  });
});
