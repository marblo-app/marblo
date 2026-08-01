import { describe, it, expect } from "vitest";
import {
  computeMemberWorkload,
  resolveClaimOwner,
  workloadTotals,
  type WorkloadInput,
} from "../../src/lib/memberWorkload";
import type { Agent } from "../../src/types/agent";
import type { Task, TaskStatus } from "../../src/types/task";
import type { MergeHistoryEntry } from "../../src/types/mergeHistory";
import type { User } from "../../src/types/user";
import type { InvitationRole } from "../../src/types/invitation";

const PROJECT = "p1";

function user(id: string, name = id): User {
  return {
    id,
    email: `${id}@example.com`,
    displayName: name,
    photoURL: "",
    createdAt: new Date("2026-01-01"),
  };
}

function agent(id: string, ownerId: string, over: Partial<Agent> = {}): Agent {
  return {
    id,
    projectId: PROJECT,
    ownerId,
    name: id,
    model: "claude",
    role: "frontend",
    status: "idle",
    currentTaskId: null,
    command: "claude",
    skillFile: "",
    createdAt: new Date("2026-02-01"),
    ...over,
  };
}

function task(
  id: string,
  status: TaskStatus,
  claimedBy: string | null,
  over: Partial<Task> = {},
): Task {
  return {
    id,
    projectId: PROJECT,
    contextId: "c1",
    title: id,
    description: "",
    status,
    role: "frontend",
    priority: 3,
    dependsOn: [],
    dependsOnCompleted: true,
    claimedBy,
    claimedAt: null,
    scope: [],
    comment: "",
    prUrl: "",
    hasPmFeedback: false,
    createdAt: new Date("2026-02-01"),
    updatedAt: new Date("2026-02-02"),
    ...over,
  };
}

function merge(id: string, taskId: string | null): MergeHistoryEntry {
  return {
    id,
    projectId: PROJECT,
    taskId,
    repoRoot: "/repo",
    branch: `b/${id}`,
    baseRef: "main",
    headSha: "deadbeef",
    mode: "manual",
    mergedAt: new Date("2026-02-03"),
  };
}

function input(over: Partial<WorkloadInput> = {}): WorkloadInput {
  return {
    members: [],
    memberRoles: {},
    agents: [],
    tasks: [],
    merges: [],
    ...over,
  };
}

const rowFor = (
  summary: ReturnType<typeof computeMemberWorkload>,
  id: string,
) => summary.rows.find((r) => r.userId === id)!;

describe("resolveClaimOwner — claimedBy 이중키", () => {
  const agents = [agent("agent-1", "alice", { name: "frontend-bot" })];

  it("MCP claim_task 경로(agent.id)로 소유자를 찾는다", () => {
    expect(resolveClaimOwner("agent-1", agents)).toBe("alice");
  });

  it("UI 수동할당 경로(agent.name)로도 소유자를 찾는다", () => {
    expect(resolveClaimOwner("frontend-bot", agents)).toBe("alice");
  });

  it("빈 값 / 모르는 값은 귀속하지 않는다", () => {
    expect(resolveClaimOwner(null, agents)).toBeNull();
    expect(resolveClaimOwner("", agents)).toBeNull();
    expect(resolveClaimOwner("ghost", agents)).toBeNull();
  });

  it("★서로 다른 소유자에게 동명 에이전트가 있으면 판정을 포기한다", () => {
    const colliding = [
      agent("a1", "alice", { name: "bot" }),
      agent("a2", "bob", { name: "bot" }),
    ];
    expect(resolveClaimOwner("bot", colliding)).toBeNull();
    // id 로 직접 맞으면 이름 충돌과 무관하게 확정된다.
    expect(resolveClaimOwner("a2", colliding)).toBe("bob");
  });

  it("같은 소유자의 동명 에이전트 여러 대는 모호하지 않다", () => {
    const dupes = [
      agent("a1", "alice", { name: "bot" }),
      agent("a2", "alice", { name: "bot" }),
    ];
    expect(resolveClaimOwner("bot", dupes)).toBe("alice");
  });
});

describe("computeMemberWorkload — 상태별 집계", () => {
  const members = [user("alice"), user("bob")];
  const memberRoles: Record<string, InvitationRole> = {
    alice: "owner",
    bob: "member",
  };
  const agents = [
    agent("a1", "alice", { status: "working", totalCost: 1.5 }),
    agent("a2", "alice", { totalCost: 0.5 }),
    agent("b1", "bob", { name: "bob-bot" }),
  ];

  it("티켓을 진행중/리뷰/완료/정체 칸으로 접는다", () => {
    const summary = computeMemberWorkload(
      input({
        members,
        memberRoles,
        agents,
        tasks: [
          task("t1", "IN_PROGRESS", "a1"),
          task("t2", "CLAIMED", "a2"),
          task("t3", "REVIEW", "a1"),
          task("t4", "DONE", "a1"),
          task("t5", "BLOCKED", "a1"),
          task("t6", "FAILED", "a2"),
        ],
      }),
    );

    const alice = rowFor(summary, "alice");
    expect(alice.tasks).toEqual({
      inProgress: 2, // IN_PROGRESS + CLAIMED
      review: 1,
      done: 1,
      stuck: 2, // BLOCKED + FAILED
      total: 6,
    });
  });

  it("TODO(미선점)는 어느 칸에도 들지 않는다", () => {
    const summary = computeMemberWorkload(
      input({
        members,
        memberRoles,
        agents,
        tasks: [task("t1", "TODO", null)],
      }),
    );
    expect(rowFor(summary, "alice").tasks.total).toBe(0);
    expect(summary.unattributed.tasks.total).toBe(0);
  });

  it("soft-delete 된 티켓은 세지 않고, archived 는 센다", () => {
    const summary = computeMemberWorkload(
      input({
        members,
        memberRoles,
        agents,
        tasks: [
          task("t1", "DONE", "a1", { deleted: true }),
          task("t2", "DONE", "a1", { archived: true }),
        ],
      }),
    );
    expect(rowFor(summary, "alice").tasks.done).toBe(1);
  });

  it("에이전트 수 · 가동중 수 · 누적 비용을 소유자에게 접는다", () => {
    const summary = computeMemberWorkload(
      input({ members, memberRoles, agents }),
    );
    const alice = rowFor(summary, "alice");
    expect(alice.agentCount).toBe(2);
    expect(alice.activeAgentCount).toBe(1);
    expect(alice.cost).toBeCloseTo(2.0);
    expect(rowFor(summary, "bob").agentCount).toBe(1);
  });

  it("머지는 taskId → 티켓 → 소유자 사슬로 귀속된다", () => {
    const summary = computeMemberWorkload(
      input({
        members,
        memberRoles,
        agents,
        tasks: [task("t1", "DONE", "a1"), task("t2", "DONE", "bob-bot")],
        merges: [merge("m1", "t1"), merge("m2", "t1"), merge("m3", "t2")],
      }),
    );
    expect(rowFor(summary, "alice").merges).toBe(2);
    expect(rowFor(summary, "bob").merges).toBe(1);
    expect(summary.unattributed.merges).toBe(0);
  });

  it("멤버 역할을 그대로 싣고, 역할 정보가 없으면 member 로 떨어진다", () => {
    const summary = computeMemberWorkload(
      input({ members, memberRoles: { alice: "admin" } }),
    );
    expect(rowFor(summary, "alice").role).toBe("admin");
    expect(rowFor(summary, "bob").role).toBe("member");
  });
});

describe("computeMemberWorkload — 미귀속 버킷", () => {
  const members = [user("alice")];

  it("선점자 없는 진행중 티켓은 미귀속으로 드러난다", () => {
    const summary = computeMemberWorkload(
      input({ members, tasks: [task("t1", "IN_PROGRESS", null)] }),
    );
    expect(summary.unattributed.tasks.inProgress).toBe(1);
    expect(rowFor(summary, "alice").tasks.total).toBe(0);
    expect(summary.hasData).toBe(true);
  });

  it("이미 나간 멤버의 에이전트/티켓/머지는 버려지지 않는다", () => {
    const agents = [agent("x1", "carol-who-left")];
    const summary = computeMemberWorkload(
      input({
        members,
        agents,
        tasks: [task("t1", "DONE", "x1")],
        merges: [merge("m1", "t1")],
      }),
    );
    expect(summary.unattributed.agentCount).toBe(1);
    expect(summary.unattributed.tasks.done).toBe(1);
    expect(summary.unattributed.merges).toBe(1);
    expect(rowFor(summary, "alice").hasData).toBe(false);
  });

  it("taskId 없는 머지(ad-hoc 워크트리)는 미귀속", () => {
    const summary = computeMemberWorkload(
      input({ members, merges: [merge("m1", null)] }),
    );
    expect(summary.unattributed.merges).toBe(1);
  });
});

describe("computeMemberWorkload — 데이터 없음 상태", () => {
  it("멤버만 있고 셀 것이 없으면 hasData=false", () => {
    const summary = computeMemberWorkload(
      input({ members: [user("alice"), user("bob")] }),
    );
    expect(summary.hasData).toBe(false);
    expect(summary.rows).toHaveLength(2);
    expect(summary.rows.every((r) => !r.hasData)).toBe(true);
  });

  it("아무 데이터도 없으면 빈 표", () => {
    const summary = computeMemberWorkload(input());
    expect(summary.rows).toHaveLength(0);
    expect(summary.hasData).toBe(false);
  });

  it("에이전트 한 대만 있어도 hasData=true", () => {
    const summary = computeMemberWorkload(
      input({ members: [user("alice")], agents: [agent("a1", "alice")] }),
    );
    expect(summary.hasData).toBe(true);
  });
});

describe("computeMemberWorkload — 정렬", () => {
  it("진행중 → 리뷰 → 완료 → 이름 순으로 내림차순 정렬한다", () => {
    const members = [user("zoe"), user("amy"), user("bob")];
    const agents = [agent("z", "zoe"), agent("a", "amy"), agent("b", "bob")];
    const summary = computeMemberWorkload(
      input({
        members,
        agents,
        tasks: [
          task("t1", "IN_PROGRESS", "b"), // bob: 진행중 1
          task("t2", "REVIEW", "z"), // zoe: 리뷰 1
          // amy: 아무것도 없음
        ],
      }),
    );
    expect(summary.rows.map((r) => r.userId)).toEqual(["bob", "zoe", "amy"]);
  });

  it("완전 동률이면 이름 오름차순", () => {
    const summary = computeMemberWorkload(
      input({ members: [user("zoe"), user("amy")] }),
    );
    expect(summary.rows.map((r) => r.userId)).toEqual(["amy", "zoe"]);
  });
});

describe("workloadTotals", () => {
  it("멤버 행 + 미귀속 버킷을 모두 합산한다 (숫자 증발 금지)", () => {
    const summary = computeMemberWorkload(
      input({
        members: [user("alice")],
        agents: [
          agent("a1", "alice", { totalCost: 2 }),
          agent("x1", "gone"), // 미귀속
        ],
        tasks: [
          task("t1", "IN_PROGRESS", "a1"),
          task("t2", "REVIEW", "x1"), // 미귀속
          task("t3", "DONE", "a1"),
        ],
        merges: [merge("m1", "t1"), merge("m2", "t2")],
      }),
    );
    const totals = workloadTotals(summary);
    expect(totals).toEqual({
      members: 1,
      agents: 2, // 1 귀속 + 1 미귀속
      inProgress: 1,
      review: 1, // 미귀속분
      done: 1,
      merges: 2, // 1 귀속 + 1 미귀속
      cost: 2,
    });
  });
});
