import { describe, expect, it } from "vitest";
import {
  findTaskWorktree,
  resolveActiveWorktreeId,
  resolveTaskAgentId,
  sameWorktreePath,
} from "../../src/lib/taskWorktree";
import type { Worktree } from "../../src/types/worktree";
import type { Agent } from "../../src/types/agent";
import type { Task } from "../../src/types/task";

function wt(partial: Partial<Worktree>): Worktree {
  return {
    id: "wt1",
    taskId: null,
    projectId: "p1",
    agentId: null,
    branch: "feature/x",
    baseRef: "main",
    path: "/repo/.marblo/worktrees/p1/task-A",
    repoRoot: "/repo",
    createdAt: null,
    ...partial,
  };
}

function agent(partial: Partial<Agent>): Agent {
  return {
    id: "a1",
    projectId: "p1",
    ownerId: "o1",
    name: "claude-1",
    model: "claude",
    role: "frontend",
    status: "working",
    currentTaskId: null,
    command: "claude",
    skillFile: "",
    createdAt: new Date(0),
    ...partial,
  } as Agent;
}

function task(partial: Partial<Task>): Task {
  return {
    id: "task-A",
    projectId: "p1",
    contextId: "",
    title: "t",
    description: "",
    status: "IN_PROGRESS",
    role: "frontend",
    priority: 3,
    dependsOn: [],
    dependsOnCompleted: true,
    claimedBy: null,
    claimedAt: null,
    scope: [],
    comment: "",
    prUrl: "",
    hasPmFeedback: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...partial,
  };
}

describe("sameWorktreePath", () => {
  it("is trailing-separator tolerant", () => {
    expect(sameWorktreePath("/a/b", "/a/b/")).toBe(true);
    expect(sameWorktreePath("/a/b/", "/a/b")).toBe(true);
  });
  it("rejects nullish and different paths", () => {
    expect(sameWorktreePath(null, "/a")).toBe(false);
    expect(sameWorktreePath("/a", undefined)).toBe(false);
    expect(sameWorktreePath("/a/b", "/a/c")).toBe(false);
  });
});

describe("findTaskWorktree", () => {
  it("matches by explicit taskId first", () => {
    const target = wt({ id: "byId", taskId: "task-A" });
    const decoy = wt({ id: "decoy", taskId: null, branch: "task-A-ish" });
    expect(findTaskWorktree([decoy, target], task({ id: "task-A" }))?.id).toBe(
      "byId",
    );
  });
  it("falls back to the task id embedded in the worktree path", () => {
    const byPath = wt({
      id: "byPath",
      taskId: null,
      path: "/repo/.marblo/worktrees/p1/task-A",
    });
    expect(findTaskWorktree([byPath], task({ id: "task-A" }))?.id).toBe(
      "byPath",
    );
  });
  it("falls back to a branch containing the task id", () => {
    const byBranch = wt({
      id: "byBranch",
      taskId: null,
      path: "/somewhere/else",
      branch: "marblo/frontend-task-A",
    });
    expect(findTaskWorktree([byBranch], task({ id: "task-A" }))?.id).toBe(
      "byBranch",
    );
  });
  it("returns null when nothing matches", () => {
    expect(
      findTaskWorktree(
        [wt({ taskId: "other", path: "/x", branch: "y" })],
        task({ id: "task-A" }),
      ),
    ).toBeNull();
  });
});

describe("resolveTaskAgentId", () => {
  it("matches claimedBy by agent id", () => {
    const agents = [agent({ id: "a1", name: "claude-1" })];
    expect(resolveTaskAgentId(agents, task({ claimedBy: "a1" }))).toBe("a1");
  });
  it("matches claimedBy by agent name (manual assign path)", () => {
    const agents = [agent({ id: "a1", name: "claude-1" })];
    expect(resolveTaskAgentId(agents, task({ claimedBy: "claude-1" }))).toBe(
      "a1",
    );
  });
  it("matches claimedBy case-insensitively by name", () => {
    const agents = [agent({ id: "a1", name: "Claude-1" })];
    expect(resolveTaskAgentId(agents, task({ claimedBy: "claude-1" }))).toBe(
      "a1",
    );
  });
  it("falls back to currentTaskId when claimedBy is unset", () => {
    const agents = [agent({ id: "a2", currentTaskId: "task-A" })];
    expect(
      resolveTaskAgentId(agents, task({ id: "task-A", claimedBy: null })),
    ).toBe("a2");
  });
  it("returns null when no agent resolves", () => {
    expect(resolveTaskAgentId([], task({ claimedBy: "ghost" }))).toBeNull();
  });
});

describe("resolveActiveWorktreeId", () => {
  it("returns the worktree id whose path equals rootPath", () => {
    const a = wt({ id: "A", path: "/w/a" });
    const b = wt({ id: "B", path: "/w/b" });
    expect(resolveActiveWorktreeId([a, b], "/w/b")).toBe("B");
  });
  it("is trailing-separator tolerant", () => {
    const a = wt({ id: "A", path: "/w/a" });
    expect(resolveActiveWorktreeId([a], "/w/a/")).toBe("A");
  });
  it("returns null for a null root or an unknown path", () => {
    const a = wt({ id: "A", path: "/w/a" });
    expect(resolveActiveWorktreeId([a], null)).toBeNull();
    expect(resolveActiveWorktreeId([a], "/some/folder")).toBeNull();
  });
});
