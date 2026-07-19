import { describe, expect, it } from "vitest";
import {
  buildBusyTaskIds,
  buildDoneTaskIds,
} from "../../src/lib/archiveSignals";
import type { Agent } from "../../src/types/agent";
import type { Task, TaskStatus } from "../../src/types/task";

function task(id: string, status: TaskStatus): Task {
  return {
    id,
    projectId: "p",
    contextId: "c",
    title: id,
    description: "",
    status,
    role: "frontend",
    priority: 3,
    dependsOn: [],
    dependsOnCompleted: true,
    claimedBy: null,
    claimedAt: null,
    scope: [],
    comment: "",
    prUrl: "",
  } as Task;
}

function agent(
  id: string,
  status: Agent["status"],
  currentTaskId: string | null,
): Agent {
  return {
    id,
    projectId: "p",
    ownerId: "o",
    name: id,
    model: "claude",
    role: "frontend",
    status,
    currentTaskId,
    command: "",
    skillFile: "",
    createdAt: new Date(0),
  };
}

describe("buildDoneTaskIds", () => {
  it("DONE 티켓만 모은다", () => {
    const ids = buildDoneTaskIds([
      task("a", "DONE"),
      task("b", "IN_PROGRESS"),
      task("c", "DONE"),
    ]);
    expect([...ids].sort()).toEqual(["a", "c"]);
  });

  /**
   * ★ FAILED/BLOCKED 는 '끝난 작업' 이 아니라 '누가 돌아와야 하는 작업' 이다.
   * 여기 포함시키면 막힌 티켓이 조용히 시야에서 사라져 방치된 티켓이 된다.
   */
  it("★FAILED/BLOCKED 는 DONE 이 아니다 — 숨기면 방치된다", () => {
    const ids = buildDoneTaskIds([
      task("f", "FAILED"),
      task("b", "BLOCKED"),
      task("r", "REVIEW"),
      task("t", "TODO"),
      task("c", "CLAIMED"),
    ]);
    expect(ids.size).toBe(0);
  });

  it("빈 목록은 빈 집합", () => {
    expect(buildDoneTaskIds([]).size).toBe(0);
  });
});

describe("buildBusyTaskIds", () => {
  it("working/idle 에이전트가 붙은 태스크를 모은다", () => {
    const ids = buildBusyTaskIds([
      agent("a1", "working", "T1"),
      agent("a2", "idle", "T2"),
    ]);
    expect([...ids].sort()).toEqual(["T1", "T2"]);
  });

  it("stopped/error 에이전트는 워크트리를 붙잡지 않는다", () => {
    const ids = buildBusyTaskIds([
      agent("a1", "stopped", "T1"),
      agent("a2", "error", "T2"),
    ]);
    expect(ids.size).toBe(0);
  });

  it("태스크에 바인딩되지 않은 에이전트는 무시한다", () => {
    expect(buildBusyTaskIds([agent("a1", "working", null)]).size).toBe(0);
  });

  it("같은 태스크에 여러 에이전트가 붙어도 한 번만 담긴다", () => {
    const ids = buildBusyTaskIds([
      agent("a1", "working", "T1"),
      agent("a2", "idle", "T1"),
    ]);
    expect([...ids]).toEqual(["T1"]);
  });
});
