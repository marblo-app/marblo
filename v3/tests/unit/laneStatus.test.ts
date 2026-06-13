import { describe, expect, it } from "vitest";
import { laneStatusPill } from "../../src/lib/laneStatus";
import type { Task, TaskStatus } from "../../src/types/task";
import type { Worktree, WorktreeStatus } from "../../src/types/worktree";

/**
 * laneStatusPill 은 Lanes 탭 행의 상태 pill 을 결정하는 단일 진실의 원천이다.
 * 회귀 가드의 핵심: 연결된 task 가 끝났는데도(특히 DONE) worktree git 상태가
 * 기본 버킷이면 ⚪ "작업중"(idle)으로 남아 멈춘(stall) 것처럼 보이던 버그.
 */

function makeStatus(over: Partial<WorktreeStatus> = {}): WorktreeStatus {
  return {
    branch: "marblo/feat-abc12345",
    baseRef: "origin/main",
    ahead: 0,
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

function wt(over: Partial<Worktree> = {}): Worktree {
  return {
    id: "proj1:/wt/path",
    taskId: "task-1",
    projectId: "proj1",
    agentId: null,
    branch: "marblo/feat-abc12345",
    baseRef: "origin/main",
    path: "/wt/path",
    repoRoot: "/repo",
    createdAt: null,
    status: makeStatus(),
    ...over,
  };
}

const task = (status: TaskStatus): Pick<Task, "status"> => ({ status });

describe("laneStatusPill — 터미널 task 상태가 거짓 stall 을 덮어쓴다", () => {
  it("핵심 회귀: task DONE + git 기본(idle/작업중) → done (작업중 아님)", () => {
    const p = laneStatusPill(task("DONE"), wt({ status: makeStatus() }));
    expect(p.tone).toBe("done");
    expect(p.label).toBe("완료");
    expect(p.tone).not.toBe("idle");
  });

  it("task REVIEW → review", () => {
    const p = laneStatusPill(task("REVIEW"), wt());
    expect(p.tone).toBe("review");
  });

  it("task FAILED → failed", () => {
    const p = laneStatusPill(task("FAILED"), wt());
    expect(p.tone).toBe("failed");
  });

  it("task DONE 인데 git 이 ready(ahead>0) 여도 완료 표시가 우선", () => {
    const p = laneStatusPill(
      task("DONE"),
      wt({ status: makeStatus({ ahead: 3 }) }),
    );
    expect(p.tone).toBe("done");
  });

  it("worktree 없어도 task DONE → done", () => {
    const p = laneStatusPill(task("DONE"), null);
    expect(p.tone).toBe("done");
  });
});

describe("laneStatusPill — 충돌은 완료 이후에도 노출(진짜 차단 신호)", () => {
  it("task DONE + 충돌 → danger (완료보다 우선)", () => {
    const p = laneStatusPill(
      task("DONE"),
      wt({ status: makeStatus({ mergeable: false }) }),
    );
    expect(p.tone).toBe("danger");
  });

  it("task FAILED + conflicts → danger", () => {
    const p = laneStatusPill(
      task("FAILED"),
      wt({ status: makeStatus({ conflicts: ["a.ts"] }) }),
    );
    expect(p.tone).toBe("danger");
  });
});

describe("laneStatusPill — 진행 중(IN_PROGRESS)은 git 상태 보존(오탐만 제거)", () => {
  it("IN_PROGRESS + git 기본 → idle (작업중, 진짜 진행중 표시 유지)", () => {
    const p = laneStatusPill(task("IN_PROGRESS"), wt({ status: makeStatus() }));
    expect(p.tone).toBe("idle");
  });

  it("IN_PROGRESS + behind → behind", () => {
    const p = laneStatusPill(
      task("IN_PROGRESS"),
      wt({ status: makeStatus({ behind: 2 }) }),
    );
    expect(p.tone).toBe("behind");
  });

  it("IN_PROGRESS + ahead>0·mergeable → ready", () => {
    const p = laneStatusPill(
      task("IN_PROGRESS"),
      wt({ status: makeStatus({ ahead: 4 }) }),
    );
    expect(p.tone).toBe("ready");
  });

  it("IN_PROGRESS + worktree 없음 → idle (준비 중)", () => {
    const p = laneStatusPill(task("IN_PROGRESS"), null);
    expect(p.tone).toBe("idle");
    expect(p.label).toBe("준비 중");
  });

  it("TODO + git 기본 → idle (작업중)", () => {
    const p = laneStatusPill(task("TODO"), wt());
    expect(p.tone).toBe("idle");
  });
});
