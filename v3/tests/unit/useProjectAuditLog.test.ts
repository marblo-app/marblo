import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * 감사 로그 로딩 계약(src/hooks/useProjectAuditLog.ts).
 *
 * repo 에 React Testing Library 가 없어서 컴포넌트 렌더로는 검증할 수 없다.
 * 그래서 훅이 쓰는 로딩 로직을 순수 async 함수로 뽑아 뒀고, 여기서 그것을
 * 직접 때린다 — 권한 분기와 graceful 동작은 이 프로젝트의 실제 계약이라
 * "렌더 테스트가 없다"를 이유로 미검증으로 남길 수 없다.
 *
 * 서비스 계층을 모킹한다: 실제 모듈은 lib/firebase 를 타서 VITE_FIREBASE_*
 * 없이는 모듈 로드 시점에 throw 한다.
 */

const getProjectAuditLog = vi.hoisted(() => vi.fn());
const getProjectAuditActors = vi.hoisted(() => vi.fn());
const getProjectLedgerLog = vi.hoisted(() => vi.fn());
const getProjectLedgerActors = vi.hoisted(() => vi.fn());
const getProjectTaskTitles = vi.hoisted(() => vi.fn());

vi.mock("../../src/services/projectAuditService", () => ({
  getProjectAuditLog: (...args: unknown[]) => getProjectAuditLog(...args),
  getProjectAuditActors: (...args: unknown[]) => getProjectAuditActors(...args),
  getProjectLedgerLog: (...args: unknown[]) => getProjectLedgerLog(...args),
  getProjectLedgerActors: (...args: unknown[]) =>
    getProjectLedgerActors(...args),
  getProjectTaskTitles: (...args: unknown[]) => getProjectTaskTitles(...args),
}));

const {
  fetchAuditLogState,
  fetchAuditActors,
  fetchLedgerLogState,
  fetchProjectTaskTitles,
  fetchUnifiedAuditSources,
  fetchUnifiedAuditOptions,
} = await import("../../src/hooks/useProjectAuditLog");

beforeEach(() => {
  getProjectAuditLog.mockReset().mockResolvedValue([]);
  getProjectAuditActors.mockReset().mockResolvedValue([]);
  getProjectLedgerLog.mockReset().mockResolvedValue([]);
  getProjectLedgerActors
    .mockReset()
    .mockResolvedValue({ actors: [], toolNames: [] });
  getProjectTaskTitles.mockReset().mockResolvedValue({});
});

describe("fetchAuditLogState — 조회", () => {
  it("조회 API 만 부른다(원장 직접 read 금지)", async () => {
    await fetchAuditLogState("p1", { actorUid: "u1", type: "agent.spawned" });

    expect(getProjectAuditLog).toHaveBeenCalledWith("p1", {
      actorUid: "u1",
      type: "agent.spawned",
    });
  });

  it("성공하면 이벤트를 그대로 실어 ready 로 접는다", async () => {
    const events = [
      {
        id: "e1",
        projectId: "p1",
        actorUid: "u1",
        actorName: "John",
        type: "chat.message.sent",
        taskId: null,
        targetId: "m1",
        metadata: {},
        createdAt: new Date("2026-08-01T00:00:00Z"),
      },
    ];
    getProjectAuditLog.mockResolvedValue(events);

    const state = await fetchAuditLogState("p1");

    expect(state).toEqual({ status: "ready", events });
  });

  it("기록이 없으면 ready + 빈 목록 — 에러가 아니다", async () => {
    expect(await fetchAuditLogState("p1")).toEqual({
      status: "ready",
      events: [],
    });
  });
});

describe("fetchAuditLogState — 권한 분기", () => {
  it("★permission-denied 는 denied 로 (빈 목록으로 위장하지 않는다)", async () => {
    getProjectAuditLog.mockRejectedValue({ code: "permission-denied" });

    const state = await fetchAuditLogState("p1");

    expect(state).toEqual({ status: "denied" });
  });

  it("권한 외 실패는 error 로 — 원인을 '권한 없음' 으로 가리지 않는다", async () => {
    getProjectAuditLog.mockRejectedValue(
      Object.assign(new Error("The query requires an index."), {
        code: "failed-precondition",
      }),
    );

    const state = await fetchAuditLogState("p1");

    expect(state.status).toBe("error");
    expect(state).toMatchObject({ message: "The query requires an index." });
  });

  it("★어떤 실패에도 throw 하지 않는다 — 감사 섹션이 프로젝트 탭을 못 깨뜨린다", async () => {
    getProjectAuditLog.mockRejectedValue(new Error("boom"));

    await expect(fetchAuditLogState("p1")).resolves.toMatchObject({
      status: "error",
    });
  });
});

describe("fetchAuditActors — 부가 정보라 실패를 삼킨다", () => {
  it("성공하면 목록을 그대로 돌려준다", async () => {
    const actors = [{ actorUid: "u1", actorName: "John", count: 3 }];
    getProjectAuditActors.mockResolvedValue(actors);

    expect(await fetchAuditActors("p1")).toEqual(actors);
  });

  it("실패하면 빈 목록 — 필터 하나 때문에 화면 전체가 에러가 되지 않는다", async () => {
    // 진짜 권한 문제면 이벤트 조회가 denied 를 돌려주므로 안내는 그쪽에서 나온다.
    getProjectAuditActors.mockRejectedValue({ code: "permission-denied" });

    await expect(fetchAuditActors("p1")).resolves.toEqual([]);
  });
});

// ── 두 소스 병합 로딩 ────────────────────────────────────────────

const LEDGER_ROW = {
  id: "a1",
  projectId: "p1",
  agentId: "agent-1",
  toolName: "update_task_status",
  params: {},
  result: "ok",
  duration: 1,
  success: true,
  actorUid: "u1",
  model: "claude",
  taskId: "t1",
  createdAt: new Date("2026-08-01T11:00:00Z"),
};

const HUMAN_ROW = {
  id: "h1",
  projectId: "p1",
  actorUid: "u1",
  actorName: "John",
  type: "chat.message.sent",
  taskId: null,
  targetId: "m1",
  metadata: {},
  createdAt: new Date("2026-08-01T10:00:00Z"),
};

describe("fetchLedgerLogState — 원장 조회", () => {
  it("성공하면 ready + 건수", async () => {
    getProjectLedgerLog.mockResolvedValue([LEDGER_ROW]);

    const result = await fetchLedgerLogState("p1");

    expect(result.state).toEqual({ status: "ready", count: 1 });
    expect(result.events).toEqual([LEDGER_ROW]);
  });

  it("★permission-denied 를 빈 목록으로 위장하지 않는다", async () => {
    getProjectLedgerLog.mockRejectedValue({ code: "permission-denied" });

    expect((await fetchLedgerLogState("p1")).state).toEqual({
      status: "denied",
    });
  });

  it("★어떤 실패에도 throw 하지 않는다", async () => {
    getProjectLedgerLog.mockRejectedValue(new Error("boom"));

    await expect(fetchLedgerLogState("p1")).resolves.toMatchObject({
      state: { status: "error" },
    });
  });
});

describe("fetchUnifiedAuditSources — 두 소스 병렬", () => {
  it("필터 없으면 두 소스를 모두 읽는다", async () => {
    getProjectAuditLog.mockResolvedValue([HUMAN_ROW]);
    getProjectLedgerLog.mockResolvedValue([LEDGER_ROW]);

    const result = await fetchUnifiedAuditSources("p1");

    expect(getProjectAuditLog).toHaveBeenCalled();
    expect(getProjectLedgerLog).toHaveBeenCalled();
    expect(result.human).toEqual([HUMAN_ROW]);
    expect(result.agent).toEqual([LEDGER_ROW]);
    expect(result.sources).toEqual({
      human: { status: "ready", count: 1 },
      agent: { status: "ready", count: 1 },
    });
  });

  it("★구성원 필터는 두 소스에 같이 걸린다", async () => {
    // 원장 actorUid = 발주한 사람의 uid. 축이 같아서 병합이 성립한다.
    await fetchUnifiedAuditSources("p1", { actorUid: "u2" });

    expect(getProjectAuditLog).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ actorUid: "u2" }),
    );
    expect(getProjectLedgerLog).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ actorUid: "u2" }),
    );
  });

  it("★taskId 필터(티켓 상세)도 두 소스에 같이 걸린다", async () => {
    await fetchUnifiedAuditSources("p1", { taskId: "t1" });

    expect(getProjectAuditLog).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ taskId: "t1" }),
    );
    expect(getProjectLedgerLog).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ taskId: "t1" }),
    );
  });

  it("사람 종류를 고르면 원장은 조회조차 하지 않고 skipped", async () => {
    const result = await fetchUnifiedAuditSources("p1", {
      typeFilter: "agent.spawned",
    });

    expect(getProjectAuditLog).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ type: "agent.spawned" }),
    );
    expect(getProjectLedgerLog).not.toHaveBeenCalled();
    // ★ready(0) 이 아니다 — 조회 안 한 소스를 "0건"이라 말하면 거짓이 된다.
    expect(result.sources.agent).toEqual({ status: "skipped" });
  });

  it("툴 이름을 고르면 사람 쪽은 조회조차 하지 않고 skipped", async () => {
    const result = await fetchUnifiedAuditSources("p1", {
      typeFilter: "tool:spawn_agent",
    });

    expect(getProjectLedgerLog).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ toolName: "spawn_agent" }),
    );
    expect(getProjectAuditLog).not.toHaveBeenCalled();
    expect(result.sources.human).toEqual({ status: "skipped" });
  });

  it("★사람 소스가 거부돼도 원장은 그대로 살아 있다", async () => {
    // 원장은 멤버 전원 read 다. 사람 쪽 거부 하나로 통째로 가리면 볼 수 있는
    // 것을 못 보게 만드는 회귀(#406/#428 계열).
    getProjectAuditLog.mockRejectedValue({ code: "permission-denied" });
    getProjectLedgerLog.mockResolvedValue([LEDGER_ROW]);

    const result = await fetchUnifiedAuditSources("p1");

    expect(result.sources.human).toEqual({ status: "denied" });
    expect(result.sources.agent).toEqual({ status: "ready", count: 1 });
    expect(result.agent).toEqual([LEDGER_ROW]);
  });

  it("★원장이 거부돼도 사람 쪽은 그대로 살아 있다", async () => {
    getProjectLedgerLog.mockRejectedValue({ code: "permission-denied" });
    getProjectAuditLog.mockResolvedValue([HUMAN_ROW]);

    const result = await fetchUnifiedAuditSources("p1");

    expect(result.sources.agent).toEqual({ status: "denied" });
    expect(result.human).toEqual([HUMAN_ROW]);
  });

  it("★한 소스가 throw 해도 다른 소스가 시도조차 못 하는 일이 없다", async () => {
    // 직렬로 읽으면 앞 소스의 throw 가 뒤 소스를 통째로 막는다.
    getProjectAuditLog.mockRejectedValue(new Error("boom"));
    getProjectLedgerLog.mockResolvedValue([LEDGER_ROW]);

    const result = await fetchUnifiedAuditSources("p1");

    expect(getProjectLedgerLog).toHaveBeenCalled();
    expect(result.sources.human).toMatchObject({ status: "error" });
    expect(result.agent).toHaveLength(1);
  });

  it("둘 다 거부면 둘 다 denied(빈 목록 위장 없음)", async () => {
    getProjectAuditLog.mockRejectedValue({ code: "permission-denied" });
    getProjectLedgerLog.mockRejectedValue({ code: "permission-denied" });

    const result = await fetchUnifiedAuditSources("p1");

    expect(result.sources).toEqual({
      human: { status: "denied" },
      agent: { status: "denied" },
    });
  });
});

describe("fetchProjectTaskTitles — 티켓 제목 조인용, 부가 정보라 실패를 삼킨다", () => {
  it("성공하면 맵을 그대로 돌려준다", async () => {
    getProjectTaskTitles.mockResolvedValue({ t1: "Foo" });

    expect(await fetchProjectTaskTitles("p1")).toEqual({ t1: "Foo" });
  });

  it("실패하면 빈 맵 — 제목을 못 가져와도 타임라인 자체는 그대로 보여야 한다", async () => {
    getProjectTaskTitles.mockRejectedValue(new Error("boom"));

    await expect(fetchProjectTaskTitles("p1")).resolves.toEqual({});
  });
});

describe("fetchUnifiedAuditOptions — 필터 옵션 병합", () => {
  it("두 소스의 행위자를 uid 로 합산한다", async () => {
    getProjectAuditActors.mockResolvedValue([
      { actorUid: "u1", actorName: "John", count: 3 },
    ]);
    getProjectLedgerActors.mockResolvedValue({
      actors: [{ actorUid: "u1", actorName: null, count: 40 }],
      toolNames: ["spawn_agent"],
    });

    const options = await fetchUnifiedAuditOptions("p1");

    expect(options.actors).toEqual([
      { actorUid: "u1", actorName: "John", count: 43 },
    ]);
    expect(options.toolNames).toEqual(["spawn_agent"]);
  });

  it("티켓 제목 맵도 같이 실어 온다", async () => {
    getProjectTaskTitles.mockResolvedValue({ t1: "Foo", t2: "Bar" });

    const options = await fetchUnifiedAuditOptions("p1");

    expect(options.taskTitleById).toEqual({ t1: "Foo", t2: "Bar" });
  });

  it("원장 옵션이 실패해도 사람 쪽 옵션은 남는다", async () => {
    getProjectAuditActors.mockResolvedValue([
      { actorUid: "u1", actorName: "John", count: 3 },
    ]);
    getProjectLedgerActors.mockRejectedValue({ code: "permission-denied" });

    const options = await fetchUnifiedAuditOptions("p1");

    expect(options.actors).toHaveLength(1);
    expect(options.toolNames).toEqual([]);
  });

  it("★부가 정보라 실패해도 throw 하지 않는다", async () => {
    getProjectAuditActors.mockRejectedValue(new Error("boom"));
    getProjectLedgerActors.mockRejectedValue(new Error("boom"));
    getProjectTaskTitles.mockRejectedValue(new Error("boom"));

    await expect(fetchUnifiedAuditOptions("p1")).resolves.toEqual({
      actors: [],
      toolNames: [],
      taskTitleById: {},
    });
  });
});
