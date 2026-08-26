import { describe, expect, it } from "vitest";
import { laneWorktreeLabel } from "../../src/lib/laneWorktreeLabel";
import type { TaskStatus } from "../../src/types/task";

const task = (status: TaskStatus) => ({ status });

describe("laneWorktreeLabel", () => {
  it("uses the branch when a worktree exists", () => {
    expect(
      laneWorktreeLabel(task("DONE"), { branch: "marblo/task-123" }),
    ).toEqual({ kind: "branch", branch: "marblo/task-123" });
  });

  it("does not call a DONE lane without a worktree preparing", () => {
    expect(laneWorktreeLabel(task("DONE"), null)).toEqual({
      kind: "label",
      labelKey: "lanes.row.worktreeCompleted",
      tone: "complete",
    });
  });

  it("keeps not-yet-created active lanes in preparing state", () => {
    for (const status of ["TODO", "CLAIMED", "IN_PROGRESS"] as const) {
      expect(laneWorktreeLabel(task(status), null)).toEqual({
        kind: "label",
        labelKey: "lanes.row.worktreePreparing",
        tone: "muted",
      });
    }
  });
});
