// v3/tests/unit/task-decomposer-validate.test.ts
import { describe, expect, it } from "vitest";
import { validateTask } from "../../electron/orchestrator/task-decomposer";

describe("validateTask carries structured fields", () => {
  it("passes goal/changes/acceptance/notes through", () => {
    const out = validateTask(
      {
        title: "T",
        goal: "do X",
        changes: ["c1"],
        acceptance: ["a1"],
        notes: ["n1"],
        role: "backend",
        priority: 3,
        depends_on: [],
        scope: [],
        estimatedHours: 1,
      } as Parameters<typeof validateTask>[0],
      0,
      1,
    );
    expect(out.goal).toBe("do X");
    expect(out.changes).toEqual(["c1"]);
    expect(out.acceptance).toEqual(["a1"]);
    expect(out.notes).toEqual(["n1"]);
  });

  it("defaults arrays to empty when omitted", () => {
    const out = validateTask(
      {
        title: "T",
        role: "backend",
        priority: 3,
        depends_on: [],
        scope: [],
        estimatedHours: 1,
      } as Parameters<typeof validateTask>[0],
      0,
      1,
    );
    expect(out.changes).toEqual([]);
    expect(out.acceptance).toEqual([]);
    expect(out.notes).toEqual([]);
  });
});
