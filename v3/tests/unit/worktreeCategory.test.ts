import { describe, expect, it } from "vitest";
import {
  isCleanupCandidate,
  isCleanupCategory,
  worktreeCategory,
} from "../../src/lib/worktreeCategory";
import type { ArchiveSignals } from "../../src/lib/worktreeHygiene";
import type { Task, TaskStatus } from "../../src/types/task";
import type { Worktree, WorktreeStatus } from "../../src/types/worktree";

function wt(overrides: Partial<Worktree> = {}): Worktree {
  return {
    id: "p:/wt/t1",
    taskId: "t1",
    projectId: "p",
    agentId: null,
    branch: "feat/x",
    baseRef: "main",
    path: "/wt/t1",
    repoRoot: "/repo",
    createdAt: null,
    ...overrides,
  };
}

function status(overrides: Partial<WorktreeStatus> = {}): WorktreeStatus {
  return {
    branch: "feat/x",
    baseRef: "main",
    ahead: 1,
    behind: 0,
    dirty: false,
    mergeable: true,
    conflicts: [],
    filesChanged: 1,
    insertions: 1,
    deletions: 0,
    ...overrides,
  };
}

function task(status: TaskStatus): Task {
  return { id: "t1", status } as Task;
}

describe("worktreeCategory", () => {
  it("DONE ticket, clean → cleanupMerged", () => {
    expect(worktreeCategory(wt(), task("DONE"))).toBe("cleanupMerged");
  });

  it("REVIEW ticket → mergeNeeded", () => {
    expect(worktreeCategory(wt(), task("REVIEW"))).toBe("mergeNeeded");
  });

  it("IN_PROGRESS / CLAIMED / TODO / BLOCKED / FAILED → developing", () => {
    for (const s of [
      "IN_PROGRESS",
      "CLAIMED",
      "TODO",
      "BLOCKED",
      "FAILED",
    ] as TaskStatus[]) {
      expect(worktreeCategory(wt(), task(s))).toBe("developing");
    }
  });

  it("no ticket (orphan) → cleanupStale", () => {
    expect(worktreeCategory(wt({ taskId: null }), null)).toBe("cleanupStale");
  });

  // ★ Protection: developing wins over every "finished" signal.
  it("dirty worktree stays developing even with a DONE ticket", () => {
    expect(
      worktreeCategory(wt({ status: status({ dirty: true }) }), task("DONE")),
    ).toBe("developing");
  });

  it("attached agent → developing even with a DONE ticket", () => {
    expect(worktreeCategory(wt({ agentId: "agent-1" }), task("DONE"))).toBe(
      "developing",
    );
  });

  it("busy ticket (agent working) → developing even when ticket is DONE", () => {
    const signals: ArchiveSignals = { busyTaskIds: new Set(["t1"]) };
    expect(worktreeCategory(wt(), task("DONE"), signals)).toBe("developing");
  });
});

describe("isCleanupCategory", () => {
  it("is true only for the two cleanup categories", () => {
    expect(isCleanupCategory("cleanupMerged")).toBe(true);
    expect(isCleanupCategory("cleanupStale")).toBe(true);
    expect(isCleanupCategory("developing")).toBe(false);
    expect(isCleanupCategory("mergeNeeded")).toBe(false);
  });
});

describe("isCleanupCandidate", () => {
  it("DONE + clean + pushed → candidate", () => {
    expect(isCleanupCandidate(wt({ status: status() }), task("DONE"))).toBe(
      true,
    );
  });

  it("orphan clean → candidate", () => {
    expect(
      isCleanupCandidate(wt({ taskId: null, status: status() }), null),
    ).toBe(true);
  });

  it("developing (open ticket) → NOT a candidate", () => {
    expect(isCleanupCandidate(wt(), task("IN_PROGRESS"))).toBe(false);
  });

  it("dirty → NOT a candidate (would lose uncommitted work)", () => {
    expect(
      isCleanupCandidate(wt({ status: status({ dirty: true }) }), task("DONE")),
    ).toBe(false);
  });

  it("unpushed → NOT a candidate (would lose local-only commits)", () => {
    expect(
      isCleanupCandidate(
        wt({
          status: status(),
          staleInfo: {
            merged: false,
            idleDays: 30,
            stale: true,
            unpushed: true,
          },
        }),
        task("DONE"),
      ),
    ).toBe(false);
  });
});
