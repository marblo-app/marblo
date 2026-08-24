import { describe, expect, it } from "vitest";
import {
  STALE_THRESHOLD_MS,
  classifyStuck,
  findBoundAgent,
  isHiddenTask,
  lastProgressAt,
  partitionBoardTasks,
  staleThresholdFor,
  type StuckAgentSnapshot,
  type StuckContext,
} from "../../src/lib/stuckLane";
import {
  STALL_QUIET_NORMAL_MS,
  STALL_QUIET_URGENT_MS,
} from "../../electron/agent-stall-policy";
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

  it("임계는 우선순위별이다 — P4+ 는 20분, 그 외 45분(워치독·dispatch 와 같은 상수)", () => {
    expect(staleThresholdFor({ priority: 5 })).toBe(STALL_QUIET_URGENT_MS);
    expect(staleThresholdFor({ priority: 4 })).toBe(STALL_QUIET_URGENT_MS);
    expect(staleThresholdFor({ priority: 3 })).toBe(STALL_QUIET_NORMAL_MS);
    expect(STALE_THRESHOLD_MS).toBe(STALL_QUIET_NORMAL_MS);
  });

  it("★P5 티켓은 25분 무진척이면 STALE, 같은 25분이라도 P3 은 아직 아니다", () => {
    const urgent = task({
      id: "t",
      status: "IN_PROGRESS",
      priority: 5,
      claimedBy: "a1",
      updatedAt: new Date(NOW - 25 * MINUTE),
    });
    expect(classifyStuck(urgent, ctx({ agents: live }))).toMatchObject({
      kind: "STALE",
      staleReason: "no-progress",
    });
    const normal = task({
      id: "t",
      status: "IN_PROGRESS",
      priority: 3,
      claimedBy: "a1",
      updatedAt: new Date(NOW - 25 * MINUTE),
    });
    expect(classifyStuck(normal, ctx({ agents: live }))).toBe(null);
  });

  it("살아있는 에이전트라도 임계(일반 45분)를 넘기면 STALE", () => {
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

describe("★일하는 티켓은 사라지지 않는다 — 에이전트 진척 관측 축 (회귀: AYJyHabfdG1DqeUvun9H)", () => {
  // 리포트의 본체: 한 시간짜리 일을 성실히 하는 에이전트가 그동안 add_activity
  // 를 안 남기면 임계(P4+ 20분)에서 no-progress 로 찍혀 활성 컬럼에서 빠졌다.
  // 열심히 일할수록 보드에서 사라지는 구조. 진척 관측(lib/agentProgress)이
  // 그 구멍을 막는다.
  const WORKER = "agent-working";
  const live = [agent({ id: WORKER, status: "working" })];

  /** P5(20분 임계) 티켓 — 보드 write 는 60분째 없음. */
  function quietTicket(): Task {
    return task({
      id: "t-quiet",
      status: "IN_PROGRESS",
      priority: 5,
      claimedBy: WORKER,
      claimedAt: new Date(NOW - 60 * MINUTE),
      updatedAt: new Date(NOW - 60 * MINUTE),
    });
  }

  it("★관측이 없으면 종전대로 STALE — 이 축은 없어도 동작이 나빠지지 않는다", () => {
    expect(classifyStuck(quietTicket(), ctx({ agents: live }))).toMatchObject({
      kind: "STALE",
      staleReason: "no-progress",
    });
  });

  it("★담당 에이전트가 5분 전까지 실제로 일한 게 관측되면 20분이 지나도 정체가 아니다", () => {
    expect(
      classifyStuck(
        quietTicket(),
        ctx({
          agents: live,
          agentActivityAt: new Map([[WORKER, NOW - 5 * MINUTE]]),
        }),
      ),
    ).toBe(null);
  });

  it("관측도 임계를 넘겨 낡았으면 정체가 맞다 — 무한 면제가 아니다", () => {
    expect(
      classifyStuck(
        quietTicket(),
        ctx({
          agents: live,
          agentActivityAt: new Map([[WORKER, NOW - 40 * MINUTE]]),
        }),
      ),
    ).toMatchObject({ kind: "STALE", staleReason: "no-progress" });
  });

  it("★다른 에이전트의 활동으로는 면제되지 않는다 — 바인딩된 담당의 관측만 본다", () => {
    expect(
      classifyStuck(
        quietTicket(),
        ctx({
          agents: live,
          agentActivityAt: new Map([["someone-else", NOW]]),
        }),
      ),
    ).toMatchObject({ kind: "STALE", staleReason: "no-progress" });
  });

  it("담당을 못 찾은 티켓(agent-missing)은 관측 축이 구해주지 않는다", () => {
    // 관측은 agentId 로 걸린다 — 바인딩이 없으면 조회할 키 자체가 없다.
    const orphan = task({
      id: "t-orphan",
      status: "IN_PROGRESS",
      claimedBy: "ghost",
      updatedAt: new Date(NOW - 60 * MINUTE),
    });
    expect(
      classifyStuck(
        orphan,
        ctx({ agents: live, agentActivityAt: new Map([[WORKER, NOW]]) }),
      ),
    ).toMatchObject({ kind: "STALE", staleReason: "agent-missing" });
  });

  it("lastProgressAt 은 인자를 안 주면 종전과 완전히 동일하다", () => {
    const ticket = quietTicket();
    expect(lastProgressAt(ticket)).toBe(NOW - 60 * MINUTE);
    expect(lastProgressAt(ticket, new Map([[WORKER, NOW]]), WORKER)).toBe(NOW);
    // 키가 없으면 후보가 안 늘어난다.
    expect(lastProgressAt(ticket, new Map([[WORKER, NOW]]), "other")).toBe(
      NOW - 60 * MINUTE,
    );
  });
});

describe("★상태별 가시성 표 — 일곱 status 가 전부 어딘가에 보인다 (회귀)", () => {
  // 외부 리포트의 O/X 표: TODO O · CLAIMED X · IN_PROGRESS X · REVIEW O ·
  // BLOCKED O · DONE O · FAILED 미관측. X 두 칸의 정체가 "살아 일하는 담당"
  // 이었다는 것이 이 티켓의 사실관계다. 수정 후 전부 O 가 되어야 한다.
  const WORKER = "a-live";

  function boardOfEveryStatus(): Task[] {
    const statuses: TaskStatus[] = [
      "TODO",
      "CLAIMED",
      "IN_PROGRESS",
      "REVIEW",
      "BLOCKED",
      "FAILED",
      "DONE",
    ];
    return statuses.map((status) =>
      task({
        id: status,
        status,
        priority: 5, // 가장 빡빡한 20분 임계로 검증한다.
        claimedBy: status === "TODO" ? null : WORKER,
        claimedAt: new Date(NOW - 60 * MINUTE),
        updatedAt: new Date(NOW - 60 * MINUTE),
      }),
    );
  }

  it("살아 일하는 담당이 붙은 CLAIMED/IN_PROGRESS 는 활성 컬럼에 남는다", () => {
    const result = partitionBoardTasks(
      boardOfEveryStatus(),
      ctx({
        agents: [agent({ id: WORKER, status: "working" })],
        agentActivityAt: new Map([[WORKER, NOW - MINUTE]]),
      }),
    );

    expect(result.active.map((t) => t.id).sort()).toEqual([
      "CLAIMED",
      "DONE",
      "IN_PROGRESS",
      "REVIEW",
      "TODO",
    ]);
    // 나머지 둘은 사라진 게 아니라 정체 레인에서 **보인다**.
    expect(result.stuck.blocked.map((t) => t.id)).toEqual(["BLOCKED"]);
    expect(result.stuck.failed.map((t) => t.id)).toEqual(["FAILED"]);
    expect(result.stuck.total).toBe(2);
    // 일곱 개 전부 어딘가에 있고, 어디에도 중복되지 않는다.
    const seen = [
      ...result.active,
      ...result.stuck.blocked,
      ...result.stuck.failed,
      ...result.stuck.stale,
    ].map((t) => t.id);
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
  });

  it("★정체로 빠진 티켓은 원래 컬럼에 건수 흔적을 남긴다 (stuckByStatus)", () => {
    const result = partitionBoardTasks(
      [
        task({ id: "todo", status: "TODO" }),
        task({
          id: "claimed-stale",
          status: "CLAIMED",
          claimedBy: "ghost",
          updatedAt: new Date(NOW - 90 * MINUTE),
        }),
        task({
          id: "running-stale-1",
          status: "IN_PROGRESS",
          claimedBy: "ghost",
          updatedAt: new Date(NOW - 90 * MINUTE),
        }),
        task({
          id: "running-stale-2",
          status: "IN_PROGRESS",
          claimedBy: "ghost",
          updatedAt: new Date(NOW - 90 * MINUTE),
        }),
        task({ id: "blocked", status: "BLOCKED" }),
        task({ id: "failed", status: "FAILED" }),
      ],
      ctx(),
    );

    expect(result.stuckByStatus.get("CLAIMED")).toBe(1);
    expect(result.stuckByStatus.get("IN_PROGRESS")).toBe(2);
    // 활성 컬럼이 아닌 status 도 세어 두지만 컬럼은 자기 키만 본다.
    expect(result.stuckByStatus.get("BLOCKED")).toBe(1);
    expect(result.stuckByStatus.get("FAILED")).toBe(1);
    // 정체가 하나도 없는 컬럼은 키 자체가 없다 → 흔적을 안 그린다.
    expect(result.stuckByStatus.get("TODO")).toBeUndefined();
    expect(result.stuckByStatus.get("REVIEW")).toBeUndefined();
    expect(result.stuckByStatus.get("DONE")).toBeUndefined();

    // 합은 언제나 정체 총계와 같다 — 흔적의 합이 레인 배지와 어긋나면 사람이
    // 티켓을 세다 잃어버린다.
    const traced = [...result.stuckByStatus.values()].reduce(
      (a, b) => a + b,
      0,
    );
    expect(traced).toBe(result.stuck.total);
  });

  it("감춘(보관·삭제) 티켓은 흔적에도 안 잡힌다 — 복구 서랍이 따로 담당한다", () => {
    const result = partitionBoardTasks(
      [
        task({
          id: "archived",
          status: "IN_PROGRESS",
          claimedBy: "ghost",
          archived: true,
        }),
      ],
      ctx(),
    );
    expect(result.stuckByStatus.size).toBe(0);
    expect(result.hidden.map((t) => t.id)).toEqual(["archived"]);
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
