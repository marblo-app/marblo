import { describe, it, expect } from "vitest";
import { pickMergeOutcomesToForward } from "../../src/services/mergeHistoryKgForwarder";
import type { MergeHistoryEntry } from "../../src/types/mergeHistory";

function entry(
  over: Partial<MergeHistoryEntry> & { id: string },
): MergeHistoryEntry {
  return {
    projectId: "p1",
    taskId: "T1",
    repoRoot: "/repo",
    branch: "b",
    baseRef: "main",
    headSha: "sha",
    mode: "manual",
    mergedAt: new Date("2026-07-01T00:00:00Z"),
    ...over,
  };
}

describe("pickMergeOutcomesToForward", () => {
  it("forwards each task-attributable merge exactly once across snapshots", () => {
    const forwarded = new Set<string>();
    const first = pickMergeOutcomesToForward(
      [entry({ id: "m1", taskId: "TA" }), entry({ id: "m2", taskId: "TB" })],
      forwarded,
    );
    expect(first.map((p) => p.taskId)).toEqual(["TA", "TB"]);

    // Next snapshot re-delivers m1/m2 (newest-first list) + a new m3.
    const second = pickMergeOutcomesToForward(
      [
        entry({ id: "m3", taskId: "TC" }),
        entry({ id: "m1", taskId: "TA" }),
        entry({ id: "m2", taskId: "TB" }),
      ],
      forwarded,
    );
    expect(second.map((p) => p.taskId)).toEqual(["TC"]);
  });

  it("skips merges with no taskId (unattributable → main would drop them)", () => {
    const out = pickMergeOutcomesToForward(
      [entry({ id: "m1", taskId: null }), entry({ id: "m2", taskId: "TB" })],
      new Set(),
    );
    expect(out.map((p) => p.taskId)).toEqual(["TB"]);
  });

  it("maps mergedAt Date → ms and passes changeType through (null-safe)", () => {
    const [p] = pickMergeOutcomesToForward(
      [
        entry({
          id: "m1",
          taskId: "TA",
          changeType: "feature",
          mergedAt: new Date("2026-07-02T03:04:05Z"),
        }),
      ],
      new Set(),
    );
    expect(p.changeType).toBe("feature");
    expect(p.mergedAtMs).toBe(Date.parse("2026-07-02T03:04:05Z"));
  });

  it("tolerates a missing/invalid mergedAt (→ null, not NaN)", () => {
    const [p] = pickMergeOutcomesToForward(
      [
        entry({
          id: "m1",
          taskId: "TA",
          // simulate a pre-existing row with no diff features / bad date
          mergedAt: new Date(Number.NaN),
          changeType: undefined,
        }),
      ],
      new Set(),
    );
    expect(p.mergedAtMs).toBeNull();
    expect(p.changeType).toBeNull();
  });
});
