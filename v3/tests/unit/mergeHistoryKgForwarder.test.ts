import { describe, it, expect } from "vitest";
import {
  pickMergeOutcomesToForward,
  pickMergedTaskCompletionCandidates,
  shouldMarkMergedTaskDone,
  enrichMergePayload,
  type MergeOutcomePayload,
} from "../../src/services/mergeHistoryKgForwarder";
import type { MergeHistoryEntry } from "../../src/types/mergeHistory";
import type { Task, TaskStatus } from "../../src/types/task";
import type { Worktree, WorktreeStatus } from "../../src/types/worktree";

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

function task(status: TaskStatus, over: Partial<Task> = {}): Task {
  return {
    id: "T1",
    projectId: "p1",
    contextId: "board",
    title: "Task",
    description: "",
    status,
    role: "frontend",
    priority: 1,
    dependsOn: [],
    dependsOnCompleted: true,
    claimedBy: null,
    claimedAt: null,
    scope: [],
    comment: "",
    prUrl: "",
    hasPmFeedback: false,
    createdAt: new Date("2026-07-01T00:00:00Z"),
    updatedAt: new Date("2026-07-01T00:00:00Z"),
    ...over,
  };
}

function status(over: Partial<WorktreeStatus> = {}): WorktreeStatus {
  return {
    branch: "feat",
    baseRef: "main",
    ahead: 1,
    behind: 0,
    dirty: false,
    mergeable: true,
    conflicts: [],
    filesChanged: 0,
    insertions: 0,
    deletions: 0,
    ...over,
  };
}

function worktree(over: Partial<Worktree> = {}): Worktree {
  return {
    id: "p1:/wt",
    taskId: "T1",
    projectId: "p1",
    agentId: null,
    branch: "feat",
    baseRef: "main",
    path: "/wt",
    repoRoot: "/repo",
    createdAt: null,
    status: status(),
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

describe("enrichMergePayload (recover dispatchMeta ctx for a forwarded merge)", () => {
  const base: MergeOutcomePayload = {
    taskId: "TA",
    changeType: "feature",
    mergedAtMs: 123,
  };

  it("folds dispatchMeta role/taskType/complexity/model onto the payload", () => {
    const out = enrichMergePayload(base, {
      role: "backend",
      taskType: "refactor",
      complexity: "complex",
      model: "antigravity",
    });
    expect(out.role).toBe("backend");
    expect(out.taskType).toBe("refactor"); // meta.taskType wins over changeType
    expect(out.complexity).toBe("complex");
    expect(out.model).toBe("antigravity");
    // Base fields are preserved.
    expect(out.taskId).toBe("TA");
    expect(out.mergedAtMs).toBe(123);
  });

  it("falls back taskType←changeType when dispatchMeta is absent", () => {
    // The exact seen-only regression: no dispatchMeta → previously null ctx →
    // empty cell keys. Now taskType is derived from the de-identified changeType
    // so the cell still learns a positive signal.
    const out = enrichMergePayload(base, null);
    expect(out.taskType).toBe("feature");
    expect(out.role).toBeNull();
    expect(out.complexity).toBeNull();
    expect(out.model).toBeNull();
  });

  it("leaves taskType null only when BOTH dispatchMeta and changeType are empty", () => {
    const out = enrichMergePayload(
      { taskId: "TA", changeType: null, mergedAtMs: null },
      { role: "  ", taskType: "", complexity: null, model: undefined },
    );
    expect(out.taskType).toBeNull();
    expect(out.role).toBeNull(); // whitespace-only is treated as empty
    expect(out.model).toBeNull();
  });
});

describe("pickMergedTaskCompletionCandidates", () => {
  it("selects task-attributable merge docs once per session", () => {
    const seen = new Set<string>();
    const first = pickMergedTaskCompletionCandidates(
      [
        entry({ id: "m1", taskId: "TA" }),
        entry({ id: "m2", taskId: null }),
        entry({ id: "m3", taskId: "TB" }),
      ],
      seen,
    );
    expect(first.map((p) => p.taskId)).toEqual(["TA", "TB"]);

    const second = pickMergedTaskCompletionCandidates(
      [entry({ id: "m1", taskId: "TA" }), entry({ id: "m4", taskId: "TC" })],
      seen,
    );
    expect(second.map((p) => p.taskId)).toEqual(["TC"]);
  });
});

describe("shouldMarkMergedTaskDone", () => {
  it("allows only REVIEW tasks to be reconciled to DONE", () => {
    expect(shouldMarkMergedTaskDone(task("REVIEW"))).toBe(true);
    expect(shouldMarkMergedTaskDone(task("DONE"))).toBe(false);
    expect(shouldMarkMergedTaskDone(task("IN_PROGRESS"))).toBe(false);
    expect(shouldMarkMergedTaskDone(task("TODO"))).toBe(false);
    expect(shouldMarkMergedTaskDone(null)).toBe(false);
  });

  it("blocks dirty, conflicting, unmergeable, and agent-held worktrees", () => {
    const reviewTask = task("REVIEW");
    expect(
      shouldMarkMergedTaskDone(reviewTask, {
        worktrees: [worktree({ status: status({ dirty: true }) })],
      }),
    ).toBe(false);
    expect(
      shouldMarkMergedTaskDone(reviewTask, {
        worktrees: [
          worktree({ status: status({ conflicts: ["src/App.ts"] }) }),
        ],
      }),
    ).toBe(false);
    expect(
      shouldMarkMergedTaskDone(reviewTask, {
        worktrees: [worktree({ status: status({ mergeable: false }) })],
      }),
    ).toBe(false);
    expect(
      shouldMarkMergedTaskDone(reviewTask, {
        worktrees: [worktree({ agentId: "agent-1" })],
      }),
    ).toBe(false);
  });

  it("blocks tasks currently held by a live agent", () => {
    expect(
      shouldMarkMergedTaskDone(task("REVIEW"), {
        busyTaskIds: new Set(["T1"]),
      }),
    ).toBe(false);
  });
});
