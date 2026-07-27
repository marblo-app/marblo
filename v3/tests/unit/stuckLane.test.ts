import { describe, expect, it } from "vitest";
import {
  STALE_THRESHOLD_MS,
  classifyStuck,
  findBoundAgent,
  isHiddenTask,
  lastProgressAt,
  partitionBoardTasks,
  type StuckAgentSnapshot,
  type StuckContext,
} from "../../src/lib/stuckLane";
import type { Task, TaskStatus } from "../../src/types/task";
import type { Agent } from "../../src/types/agent";

const NOW = Date.UTC(2026, 6, 27, 12, 0, 0);
const MINUTE = 60_000;

function task(overrides: Partial<Task> & { id: string }): Task {
  return {
    projectId: "p",
    contextId: "board",
    title: overrides.id,
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
    createdAt: new Date(NOW - 60 * MINUTE),
    updatedAt: new Date(NOW),
    ...overrides,
  } as Task;
}

function agent(
  overrides: Partial<StuckAgentSnapshot> & { id: string },
): StuckAgentSnapshot {
  return {
    name: overrides.id,
    status: "working" as Agent["status"],
    currentTaskId: null,
    ...overrides,
  };
}

function ctx(overrides: Partial<StuckContext> = {}): StuckContext {
  return {
    agents: [],
    agentsLoaded: true,
    now: NOW,
    ...overrides,
  };
}

describe("classifyStuck — 기존 status 는 그대로 읽어 그룹만 만든다", () => {
  it("BLOCKED/FAILED 는 status 그대로 각 그룹으로 간다", () => {
    expect(classifyStuck(task({ id: "b", status: "BLOCKED" }), ctx())).toEqual({
      kind: "BLOCKED",
    });
    expect(classifyStuck(task({ id: "f", status: "FAILED" }), ctx())).toEqual({
      kind: "FAILED",
    });
  });

  it("판정은 티켓 객체를 건드리지 않는다 (status 불변 — 원장 무손실)", () => {
    const blocked = task({ id: "b", status: "BLOCKED" });
    const stale = task({
      id: "s",
      status: "IN_PROGRESS",
      claimedBy: "dead-agent",
      updatedAt: new Date(NOW - 45 * MINUTE),
    });
    const snapshot = [
      JSON.stringify(blocked.status),
      JSON.stringify(stale.status),
    ];

    classifyStuck(blocked, ctx());
    classifyStuck(
      stale,
      ctx({ agents: [agent({ id: "dead-agent", status: "stopped" })] }),
    );

    expect(blocked.status).toBe("BLOCKED");
    expect(stale.status).toBe("IN_PROGRESS");
    expect([
      JSON.stringify(blocked.status),
      JSON.stringify(stale.status),
    ]).toEqual(snapshot);
    // "STUCK"/"STALE" 은 TaskStatus 가 아니다 — 타입이 아니라 값으로도 확인.
    const validStatuses: TaskStatus[] = [
      "TODO",
      "CLAIMED",
      "IN_PROGRESS",
      "REVIEW",
      "BLOCKED",
      "FAILED",
      "DONE",
    ];
    expect(validStatuses).toContain(blocked.status);
    expect(validStatuses).toContain(stale.status);
  });

  it("TODO/REVIEW/DONE 은 아무리 오래 묵어도 정체가 아니다", () => {
    const old = { updatedAt: new Date(NOW - 30 * 24 * 60 * MINUTE) };
    for (const status of ["TODO", "REVIEW", "DONE"] as TaskStatus[]) {
      expect(classifyStuck(task({ id: status, status, ...old }), ctx())).toBe(
        null,
      );
    }
  });
});

describe("STALE — 죽은 에이전트가 물고 있는 티켓", () => {
  const DEAD = "agent-dead-1";

  function stuckTicket(claimedAgo: number): Task {
    return task({
      id: "t-stale",
      status: "IN_PROGRESS",
      claimedBy: DEAD,
      claimedAt: new Date(NOW - claimedAgo),
      updatedAt: new Date(NOW - claimedAgo),
    });
  }

  it("★ 죽은(stopped) 에이전트가 물린 티켓은 30분 뒤 STALE 로 분류되고 status 는 IN_PROGRESS 그대로다", () => {
    const ticket = stuckTicket(30 * MINUTE + 1);
    const verdict = classifyStuck(
      ticket,
      ctx({ agents: [agent({ id: DEAD, status: "stopped" })] }),
    );

    expect(verdict).toMatchObject({ kind: "STALE", staleReason: "agent-dead" });
    expect(ticket.status).toBe("IN_PROGRESS"); // ★ 원장 불변
  });

  it("★ 에이전트 doc 이 통째로 사라진 티켓도 30분 뒤 STALE (status 불변)", () => {
    const ticket = stuckTicket(31 * MINUTE);
    const verdict = classifyStuck(
      ticket,
      // 목록엔 무관한 에이전트만 있다 = 이 티켓의 담당은 없어졌다.
      ctx({ agents: [agent({ id: "someone-else" })] }),
    );

    expect(verdict).toMatchObject({
      kind: "STALE",
      staleReason: "agent-missing",
    });
    expect(ticket.status).toBe("IN_PROGRESS");
  });

  it("error 상태 에이전트도 dead 로 본다", () => {
    expect(
      classifyStuck(
        stuckTicket(40 * MINUTE),
        ctx({ agents: [agent({ id: DEAD, status: "error" })] }),
      ),
    ).toMatchObject({ staleReason: "agent-dead" });
  });

  it("idle 은 dead 가 아니다 — 답을 기다리는 정상 상태이고, working/idle 판정 자체가 PTY 파생이라 오판이 잦다", () => {
    const justClaimed = stuckTicket(5 * MINUTE);
    expect(
      classifyStuck(
        justClaimed,
        ctx({ agents: [agent({ id: DEAD, status: "idle" })] }),
      ),
    ).toBe(null);
  });

  it("살아있는 에이전트 + 최근 활동이면 정체가 아니다", () => {
    expect(
      classifyStuck(
        stuckTicket(2 * MINUTE),
        ctx({ agents: [agent({ id: DEAD, status: "working" })] }),
      ),
    ).toBe(null);
  });

  it("claimedBy 가 agent.name 으로 저장된 경로(수동 배정)도 매칭된다", () => {
    const ticket = task({
      id: "t",
      status: "CLAIMED",
      claimedBy: "Frontend-1",
      claimedAt: new Date(NOW - MINUTE),
      updatedAt: new Date(NOW - MINUTE),
    });
    const agents = [agent({ id: "abc123", name: "Frontend-1" })];
    expect(findBoundAgent(agents, ticket)?.id).toBe("abc123");
    expect(classifyStuck(ticket, ctx({ agents }))).toBe(null);
  });
});

describe("STALE — 무진척 시계", () => {
  const live = [agent({ id: "a1", currentTaskId: "t" })];

  it("살아있는 에이전트라도 임계(30분)를 넘기면 STALE", () => {
    const ticket = task({
      id: "t",
      status: "IN_PROGRESS",
      claimedBy: "a1",
      updatedAt: new Date(NOW - STALE_THRESHOLD_MS - MINUTE),
    });
    expect(classifyStuck(ticket, ctx({ agents: live }))).toMatchObject({
      kind: "STALE",
      staleReason: "no-progress",
    });
  });

  it("임계 직전(29분)은 아직 정체가 아니다", () => {
    const ticket = task({
      id: "t",
      status: "IN_PROGRESS",
      claimedBy: "a1",
      updatedAt: new Date(NOW - 29 * MINUTE),
    });
    expect(classifyStuck(ticket, ctx({ agents: live }))).toBe(null);
  });

  it("projection.lastActivityAt(Firestore Timestamp) 이 updatedAt 보다 최근이면 그쪽을 믿는다", () => {
    const ticket = {
      ...task({
        id: "t",
        status: "IN_PROGRESS",
        claimedBy: "a1",
        updatedAt: new Date(NOW - 90 * MINUTE),
      }),
      projection: {
        lastActivityAt: { seconds: (NOW - 2 * MINUTE) / 1000, nanoseconds: 0 },
      },
    } as Task;
    expect(lastProgressAt(ticket)).toBe(NOW - 2 * MINUTE);
    expect(classifyStuck(ticket, ctx({ agents: live }))).toBe(null);
  });

  it("워크트리가 하루 넘게 무변경이면 활동 타임스탬프가 신선해도 STALE", () => {
    const ticket = task({
      id: "t",
      status: "IN_PROGRESS",
      claimedBy: "a1",
      updatedAt: new Date(NOW - MINUTE), // PM 편집 등으로 갓 갱신된 척
    });
    expect(
      classifyStuck(
        ticket,
        ctx({ agents: live, worktreeIdleDays: new Map([["t", 3]]) }),
      ),
    ).toMatchObject({ kind: "STALE", staleReason: "worktree-idle" });
  });
});

describe("콜드 부팅 오탐 가드", () => {
  it("에이전트 스냅샷 도착 전(agentsLoaded=false)에는 '에이전트 없음' 을 정체로 치지 않는다", () => {
    const ticket = task({
      id: "t",
      status: "IN_PROGRESS",
      claimedBy: "a1",
      updatedAt: new Date(NOW - MINUTE),
    });
    expect(
      classifyStuck(ticket, ctx({ agents: [], agentsLoaded: false })),
    ).toBe(null);
    expect(
      classifyStuck(ticket, ctx({ agents: [], agentsLoaded: true })),
    ).toMatchObject({ staleReason: "agent-missing" });
  });

  it("스냅샷 전이라도 무진척 시계는 그대로 돈다", () => {
    const ticket = task({
      id: "t",
      status: "IN_PROGRESS",
      claimedBy: "a1",
      updatedAt: new Date(NOW - 120 * MINUTE),
    });
    expect(
      classifyStuck(ticket, ctx({ agents: [], agentsLoaded: false })),
    ).toMatchObject({ staleReason: "no-progress" });
  });
});

describe("isHiddenTask / partitionBoardTasks", () => {
  it("archived·deleted 는 전 레인에서 숨는다 (정체여도)", () => {
    expect(isHiddenTask(task({ id: "a", archived: true }))).toBe(true);
    expect(isHiddenTask(task({ id: "d", deleted: true }))).toBe(true);
    expect(isHiddenTask(task({ id: "n" }))).toBe(false);

    const result = partitionBoardTasks(
      [
        task({ id: "archived-blocked", status: "BLOCKED", archived: true }),
        task({ id: "deleted-todo", status: "TODO", deleted: true }),
        task({ id: "live-todo", status: "TODO" }),
      ],
      ctx(),
    );
    expect(result.hidden.map((t) => t.id)).toEqual([
      "archived-blocked",
      "deleted-todo",
    ]);
    expect(result.stuck.total).toBe(0);
    expect(result.active.map((t) => t.id)).toEqual(["live-todo"]);
  });

  it("감춘 티켓의 status 도 보존된다 — 복구하면 원래 컬럼으로 돌아간다", () => {
    const archived = task({ id: "a", status: "BLOCKED", archived: true });
    const { hidden } = partitionBoardTasks([archived], ctx());
    expect(hidden[0].status).toBe("BLOCKED");

    // 복구(= 플래그만 내림)를 흉내내면 다시 정체 레인의 BLOCKED 로 잡힌다.
    const restored = { ...archived, archived: false };
    const after = partitionBoardTasks([restored], ctx());
    expect(after.hidden).toEqual([]);
    expect(after.stuck.blocked.map((t) => t.id)).toEqual(["a"]);
    expect(after.stuck.blocked[0].status).toBe("BLOCKED");
  });

  it("정체분은 활성 목록에서 빠지고 3그룹으로 갈린다", () => {
    const result = partitionBoardTasks(
      [
        task({ id: "todo", status: "TODO" }),
        task({ id: "running", status: "IN_PROGRESS", claimedBy: "a1" }),
        task({ id: "blocked", status: "BLOCKED" }),
        task({ id: "failed", status: "FAILED" }),
        task({
          id: "stale",
          status: "IN_PROGRESS",
          claimedBy: "gone",
          updatedAt: new Date(NOW - 60 * MINUTE),
        }),
        task({ id: "done", status: "DONE" }),
      ],
      ctx({ agents: [agent({ id: "a1" })] }),
    );

    expect(result.active.map((t) => t.id)).toEqual(["todo", "running", "done"]);
    expect(result.stuck.blocked.map((t) => t.id)).toEqual(["blocked"]);
    expect(result.stuck.failed.map((t) => t.id)).toEqual(["failed"]);
    expect(result.stuck.stale.map((t) => t.id)).toEqual(["stale"]);
    expect(result.stuck.total).toBe(3);
    expect(result.stuck.verdicts.get("stale")?.kind).toBe("STALE");
  });

  it("한 티켓은 활성과 정체 어느 한 쪽에만 있다 (중복·누락 없음)", () => {
    const tasks = [
      task({ id: "1", status: "TODO" }),
      task({ id: "2", status: "BLOCKED" }),
      task({ id: "3", status: "REVIEW" }),
      task({ id: "4", status: "FAILED" }),
      task({ id: "5", status: "IN_PROGRESS", claimedBy: "ghost" }),
    ];
    const r = partitionBoardTasks(tasks, ctx());
    const seen = [
      ...r.active,
      ...r.stuck.blocked,
      ...r.stuck.failed,
      ...r.stuck.stale,
    ].map((t) => t.id);
    expect(seen.sort()).toEqual(["1", "2", "3", "4", "5"]);
    expect(new Set(seen).size).toBe(seen.length);
  });
});
