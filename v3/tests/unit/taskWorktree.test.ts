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

  // 회귀 (2026-07-18, 티켓 ZHCW4yX6): "이 워크트리 보기" 버튼이 어디에도 안 뜸.
  // 원인은 매칭 로직이 아니라 *스테일 스냅샷* — 앱 시작 시 1회만 refresh 되던
  // worktreeStore 가 세션 중 생성된 워크트리를 영영 모르는 채로, findTaskWorktree
  // 가 그 빠진 목록을 검색해 null 을 돌려줬다. 여기서는 실측과 동일한 데이터
  // 모양으로 (1) 스냅샷에 없으면 null (증상), (2) 갱신된 목록에선 매칭됨(치유)을
  // 함께 고정한다. 갱신 정책 자체는 worktreeStore.test.ts 의 ensureFresh 테스트가 가드.
  it("regression: worktree created after a stale snapshot only matches once the refreshed list is searched", () => {
    const projectId = "GFB8JnJrrX6AgahqmGB3";
    const staleSnapshot = [
      wt({
        id: "done-task-wt",
        taskId: "dFoOMkZFjejrrUR6hThX",
        projectId,
        path: `/Users/u/.marblo/worktrees/${projectId}/dFoOMkZFjejrrUR6hThX`,
        branch: "marblo/frontend-claude-ol7x-dFoOMkZF",
      }),
    ];
    const openTask = task({ id: "ZHCW4yX6fzjo9WXKjciQ" });

    // 증상: 스냅샷엔 (이미 DONE 인) 남의 워크트리뿐 → null → 버튼 미렌더.
    expect(findTaskWorktree(staleSnapshot, openTask)).toBeNull();

    // 치유: 갱신된 목록에 세션 중 생성된 워크트리가 들어오면 즉시 매칭.
    const refreshed = [
      ...staleSnapshot,
      wt({
        id: "new-wt",
        taskId: "ZHCW4yX6fzjo9WXKjciQ",
        projectId,
        path: `/Users/u/.marblo/worktrees/${projectId}/ZHCW4yX6fzjo9WXKjciQ`,
        branch: "marblo/worktree-ux-missing-ZHCW4yX6",
      }),
    ];
    expect(findTaskWorktree(refreshed, openTask)?.id).toBe("new-wt");
  });

  // 실측에서 확인된 taskId=null 오염 케이스: 한 저장소를 두 프로젝트가 공유하면
  // inferTaskId(projectId, path) 가 실패해 taskId 가 null 로 들어온다. 그래도
  // 경로 세그먼트 폴백이 살아 있어야 버튼이 뜬다.
  it("regression: taskId=null (projectId not in path) still matches via the path-segment fallback", () => {
    const polluted = wt({
      id: "cross-project",
      taskId: null,
      projectId: "uVJL1vnoiCpqbCUbFxTd",
      path: "/Users/u/.marblo/worktrees/9jl1Axydz5QOxEHk8gdk/task-B",
      branch: "fix/whatever",
    });
    expect(findTaskWorktree([polluted], task({ id: "task-B" }))?.id).toBe(
      "cross-project",
    );
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
