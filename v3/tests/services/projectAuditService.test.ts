import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

/**
 * 감사 캡처/조회 서비스 계약(src/services/projectAuditService.ts).
 *
 * lib/firebase 는 VITE_FIREBASE_* 가 없으면 모듈 로드 시점에 throw 하므로
 * 반드시 모킹한다. ./firestore 도 모킹해서 실제 쿼리 제약을 붙잡는다 — 이
 * 테스트의 핵심은 "필터가 **서버 사이드**로 나갔는가"이기 때문이다.
 */

const currentUser = vi.hoisted(() => ({
  value: null as { uid: string; displayName: string | null } | null,
}));

vi.mock("../../src/lib/firebase", () => ({
  get auth() {
    return { currentUser: currentUser.value };
  },
  db: {},
}));

const createDocument = vi.hoisted(() => vi.fn());
const queryDocuments = vi.hoisted(() => vi.fn());

vi.mock("../../src/services/firestore", () => ({
  createDocument: (...args: unknown[]) => createDocument(...args),
  queryDocuments: (...args: unknown[]) => queryDocuments(...args),
  toTimestamp: (d: Date) => ({ __ts: d.getTime() }),
  convertTimestamps: (raw: Record<string, unknown>) => raw,
}));

const {
  recordProjectAuditEvent,
  getProjectAuditLog,
  getProjectAuditActors,
  getProjectLedgerLog,
  getProjectLedgerActors,
  getProjectTaskTitles,
} = await import("../../src/services/projectAuditService");

const COLLECTION = "projectAuditLog";
const LEDGER_COLLECTION = "audit_logs";

type Constraint = {
  type: string;
  field?: string;
  op?: string;
  value?: unknown;
  count?: number;
};

/** 이번 호출에 실린 쿼리 제약들. */
function constraintsOfLastQuery(): Constraint[] {
  const call = queryDocuments.mock.calls.at(-1)!;
  return call.slice(1) as Constraint[];
}

function whereOn(field: string): Constraint | undefined {
  return constraintsOfLastQuery().find(
    (c) => c.type === "where" && c.field === field,
  );
}

beforeEach(() => {
  createDocument.mockReset().mockResolvedValue("evt-1");
  queryDocuments.mockReset().mockResolvedValue([]);
  currentUser.value = { uid: "u1", displayName: "John" };
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("recordProjectAuditEvent — 캡처", () => {
  it("로그인 사용자를 actor 로 귀속해 기록한다", async () => {
    recordProjectAuditEvent({
      projectId: "p1",
      type: "agent.spawned",
      targetId: "a1",
      metadata: { model: "claude" },
    });

    expect(createDocument).toHaveBeenCalledTimes(1);
    const [collection, payload] = createDocument.mock.calls[0];
    expect(collection).toBe(COLLECTION);
    expect(payload).toMatchObject({
      projectId: "p1",
      actorUid: "u1",
      actorName: "John",
      type: "agent.spawned",
      targetId: "a1",
      metadata: { model: "claude" },
    });
    expect(payload.createdAt).toBeDefined();
  });

  it("명시된 actorUid 가 로그인 사용자보다 우선한다", () => {
    // 채팅 캡처는 senderId(=작성자 uid)를 직접 넘긴다.
    recordProjectAuditEvent({
      projectId: "p1",
      actorUid: "u2",
      actorName: "Jane",
      type: "chat.message.sent",
    });

    expect(createDocument.mock.calls[0][1]).toMatchObject({
      actorUid: "u2",
      actorName: "Jane",
    });
  });

  it("미로그인이면 write 를 보내지 않고 warn 을 남긴다", () => {
    currentUser.value = null;

    recordProjectAuditEvent({ projectId: "p1", type: "agent.spawned" });

    expect(createDocument).not.toHaveBeenCalled();
    // 조용한 유실 금지 — 떨궜다는 사실이 드러나야 한다.
    expect(console.warn).toHaveBeenCalled();
  });

  it("★기록 실패가 원 행위를 깨뜨리지 않는다 (throw 하지 않음)", async () => {
    createDocument.mockRejectedValue(new Error("permission-denied"));

    expect(() =>
      recordProjectAuditEvent({ projectId: "p1", type: "task.claimed" }),
    ).not.toThrow();

    // 거부는 다음 마이크로태스크에서 처리된다. unhandled rejection 이 없어야 한다.
    await Promise.resolve();
    await Promise.resolve();
    expect(console.warn).toHaveBeenCalled();
  });

  it("fire-and-forget — 호출부가 await 하지 않아도 된다", () => {
    const returned = recordProjectAuditEvent({
      projectId: "p1",
      type: "task.claimed",
    });
    expect(returned).toBeUndefined();
  });
});

describe("getProjectAuditLog — 조회 필터", () => {
  it("필터 없으면 projectId 로만 스코프한다", async () => {
    await getProjectAuditLog("p1");

    expect(queryDocuments.mock.calls[0][0]).toBe(COLLECTION);
    expect(whereOn("projectId")).toMatchObject({ op: "==", value: "p1" });
    expect(whereOn("actorUid")).toBeUndefined();
    expect(whereOn("type")).toBeUndefined();
  });

  it("★actorUid 필터가 서버 사이드로 나간다", async () => {
    // 클라이언트에서 걸러선 안 된다: limit 로 자른 뒤 거르면 "이 구성원 로그"가
    // 최근 창 안의 몇 건으로 잘려 조용히 축소된다(기존 auditService 의 함정).
    await getProjectAuditLog("p1", { actorUid: "u2" });

    expect(whereOn("actorUid")).toMatchObject({ op: "==", value: "u2" });
  });

  it("type 필터도 서버 사이드로 나간다", async () => {
    await getProjectAuditLog("p1", { type: "chat.message.sent" });

    expect(whereOn("type")).toMatchObject({
      op: "==",
      value: "chat.message.sent",
    });
  });

  it("actorUid + type 을 함께 걸 수 있다", async () => {
    await getProjectAuditLog("p1", {
      actorUid: "u2",
      type: "task.status_changed",
    });

    expect(whereOn("actorUid")).toMatchObject({ value: "u2" });
    expect(whereOn("type")).toMatchObject({ value: "task.status_changed" });
  });

  it("★taskId 필터(티켓 상세)도 서버 사이드로 나간다", async () => {
    // 티켓 U6ITRR38Z3c4MGLyg2PU — 감사 로그 티켓 클릭 → 원장 상세.
    await getProjectAuditLog("p1", { taskId: "t1" });

    expect(whereOn("taskId")).toMatchObject({ op: "==", value: "t1" });
  });

  it("limit 을 정규화해서 싣는다", async () => {
    await getProjectAuditLog("p1", { limit: 10_000 });
    expect(
      constraintsOfLastQuery().find((c) => c.type === "limit"),
    ).toMatchObject({ count: 500 });

    await getProjectAuditLog("p1", { limit: 0 });
    expect(
      constraintsOfLastQuery().find((c) => c.type === "limit"),
    ).toMatchObject({ count: 100 });
  });

  it("결과를 최신순으로 돌려준다", async () => {
    queryDocuments.mockResolvedValue([
      { id: "a", actorUid: "u1", createdAt: new Date("2026-01-01") },
      { id: "c", actorUid: "u1", createdAt: new Date("2026-03-01") },
      { id: "b", actorUid: "u1", createdAt: new Date("2026-02-01") },
    ]);

    const events = await getProjectAuditLog("p1");
    expect(events.map((e) => e.id)).toEqual(["c", "b", "a"]);
  });

  it("★권한 거부를 빈 배열로 삼키지 않는다", async () => {
    // "권한 없음"과 "기록 없음"이 같은 값이면 감사 뷰가 거짓말을 한다.
    queryDocuments.mockRejectedValue(new Error("permission-denied"));

    await expect(getProjectAuditLog("p1")).rejects.toThrow("permission-denied");
  });
});

describe("getProjectAuditActors", () => {
  it("등장한 actor 를 건수 내림차순으로 집계한다", async () => {
    queryDocuments.mockResolvedValue([
      {
        id: "1",
        actorUid: "u1",
        actorName: "John",
        createdAt: new Date("2026-03-01"),
      },
      {
        id: "2",
        actorUid: "u2",
        actorName: "Jane",
        createdAt: new Date("2026-02-01"),
      },
      {
        id: "3",
        actorUid: "u1",
        actorName: "John",
        createdAt: new Date("2026-01-01"),
      },
    ]);

    expect(await getProjectAuditActors("p1")).toEqual([
      { actorUid: "u1", actorName: "John", count: 2 },
      { actorUid: "u2", actorName: "Jane", count: 1 },
    ]);
  });

  it("기록이 없는 구성원은 등장하지 않는다", async () => {
    // 프로젝트 멤버 전체로 그리면 기록 0건인 사람도 필터에 뜬다 — 그건 다른 질문.
    queryDocuments.mockResolvedValue([]);
    expect(await getProjectAuditActors("p1")).toEqual([]);
  });
});

// ── 원장(audit_logs) 읽기병합 ────────────────────────────────────

describe("getProjectLedgerLog — 원장 조회", () => {
  it("★원장 컬렉션을 읽는다 — 사람 컬렉션이 아니다", async () => {
    await getProjectLedgerLog("p1");

    expect(queryDocuments.mock.calls.at(-1)![0]).toBe(LEDGER_COLLECTION);
    expect(queryDocuments.mock.calls.at(-1)![0]).not.toBe(COLLECTION);
  });

  it("필터 없으면 projectId 로만 스코프한다", async () => {
    await getProjectLedgerLog("p1");

    expect(whereOn("projectId")).toMatchObject({ op: "==", value: "p1" });
    expect(whereOn("actorUid")).toBeUndefined();
    expect(whereOn("toolName")).toBeUndefined();
  });

  it("★actorUid(발주자) 필터가 서버 사이드로 나간다", async () => {
    // 기존 auditService.subscribeToAuditLogs 는 limit 로 자른 뒤 클라이언트에서
    // 거른다. 그 함정을 답습하면 "이 구성원이 발주한 행위"가 조용히 축소된다.
    await getProjectLedgerLog("p1", { actorUid: "u2" });

    expect(whereOn("actorUid")).toMatchObject({ op: "==", value: "u2" });
  });

  it("toolName 필터도 서버 사이드로 나간다", async () => {
    await getProjectLedgerLog("p1", { toolName: "update_task_status" });

    expect(whereOn("toolName")).toMatchObject({
      op: "==",
      value: "update_task_status",
    });
  });

  it("actorUid + toolName 을 함께 걸 수 있다", async () => {
    await getProjectLedgerLog("p1", {
      actorUid: "u2",
      toolName: "spawn_agent",
    });

    expect(whereOn("actorUid")).toMatchObject({ value: "u2" });
    expect(whereOn("toolName")).toMatchObject({ value: "spawn_agent" });
  });

  it("★taskId 필터(티켓 상세)도 서버 사이드로 나간다", async () => {
    await getProjectLedgerLog("p1", { taskId: "t1" });

    expect(whereOn("taskId")).toMatchObject({ op: "==", value: "t1" });
  });

  it("★`kind` 로는 절대 필터하지 않는다", async () => {
    // kind 는 원장 확장(§5) 이후 필드라 옛 문서엔 아예 없다. Firestore 는 없는
    // 필드를 equality 로 맞출 수 없어서 where(kind==…) 는 legacy 를 조용히
    // 누락시킨다 — 감사 뷰에서 가장 나쁜 실패.
    await getProjectLedgerLog("p1", { actorUid: "u2", toolName: "x" });

    expect(whereOn("kind")).toBeUndefined();
  });

  it("limit 을 사람 쪽과 같은 규칙으로 정규화한다", async () => {
    await getProjectLedgerLog("p1", { limit: 10_000 });
    expect(
      constraintsOfLastQuery().find((c) => c.type === "limit"),
    ).toMatchObject({ count: 500 });

    await getProjectLedgerLog("p1", { limit: -1 });
    expect(
      constraintsOfLastQuery().find((c) => c.type === "limit"),
    ).toMatchObject({ count: 100 });
  });

  it("결과를 최신순으로 돌려준다", async () => {
    queryDocuments.mockResolvedValue([
      { id: "a", toolName: "t", createdAt: new Date("2026-01-01") },
      { id: "c", toolName: "t", createdAt: new Date("2026-03-01") },
      { id: "b", toolName: "t", createdAt: new Date("2026-02-01") },
    ]);

    expect((await getProjectLedgerLog("p1")).map((e) => e.id)).toEqual([
      "c",
      "b",
      "a",
    ]);
  });

  it("★권한 거부를 빈 배열로 삼키지 않는다", async () => {
    queryDocuments.mockRejectedValue(new Error("permission-denied"));

    await expect(getProjectLedgerLog("p1")).rejects.toThrow(
      "permission-denied",
    );
  });
});

describe("getProjectLedgerActors — 필터 옵션", () => {
  beforeEach(() => {
    queryDocuments.mockResolvedValue([
      {
        id: "1",
        toolName: "update_task_status",
        actorUid: "u1",
        createdAt: new Date("2026-03-01"),
      },
      {
        id: "2",
        toolName: "spawn_agent",
        actorUid: "u2",
        createdAt: new Date("2026-02-01"),
      },
      {
        id: "3",
        toolName: "update_task_status",
        actorUid: "u1",
        createdAt: new Date("2026-01-01"),
      },
    ]);
  });

  it("발주자를 건수 내림차순으로 집계한다", async () => {
    const { actors } = await getProjectLedgerActors("p1");

    // 원장엔 표시용 이름이 없다(uid 만). 이름 메꿈은 호출부 몫.
    expect(actors).toEqual([
      { actorUid: "u1", actorName: null, count: 2 },
      { actorUid: "u2", actorName: null, count: 1 },
    ]);
  });

  it("등장한 툴 이름을 중복 없이 정렬해 돌려준다", async () => {
    const { toolNames } = await getProjectLedgerActors("p1");

    // 전체 툴 목록을 박아두면 고르는 족족 0건이라 필터가 고장난 것처럼 보인다.
    expect(toolNames).toEqual(["spawn_agent", "update_task_status"]);
  });

  it("★귀속 불가(actorUid 없음)는 필터 후보로 올리지 않는다", async () => {
    queryDocuments.mockResolvedValue([
      { id: "1", toolName: "get_task", createdAt: new Date("2026-03-01") },
      {
        id: "2",
        toolName: "get_task",
        actorUid: null,
        createdAt: new Date("2026-02-01"),
      },
    ]);

    const { actors, toolNames } = await getProjectLedgerActors("p1");

    // 고를 수 없는 값이라 옵션이 되면 0건만 돌려준다. 툴 이름은 그대로 남는다.
    expect(actors).toEqual([]);
    expect(toolNames).toEqual(["get_task"]);
  });
});

describe("getProjectTaskTitles — 티켓 제목 조인(뷰 전용, 읽기만)", () => {
  it("id → title 맵을 만든다", async () => {
    queryDocuments.mockResolvedValue([
      { id: "t1", title: "Foo", projectId: "p1" },
      { id: "t2", title: "Bar", projectId: "p1" },
    ]);

    expect(await getProjectTaskTitles("p1")).toEqual({
      t1: "Foo",
      t2: "Bar",
    });
  });

  it("projectId 로만 필터한다 — write 초크포인트는 여전히 taskService", async () => {
    queryDocuments.mockResolvedValue([]);
    await getProjectTaskTitles("p1");

    expect(whereOn("projectId")).toMatchObject({ op: "==", value: "p1" });
  });

  it("제목이 비었거나 문자열이 아니면 맵에서 뺀다 — fallback 이 해시로 안전하게 떨어진다", async () => {
    queryDocuments.mockResolvedValue([
      { id: "t1", title: "  ", projectId: "p1" },
      { id: "t2", title: 123, projectId: "p1" },
      { id: "t3", projectId: "p1" },
      { id: "t4", title: "Real title", projectId: "p1" },
    ]);

    expect(await getProjectTaskTitles("p1")).toEqual({ t4: "Real title" });
  });

  it("★소프트 삭제된 티켓도 문서가 남아 있으면 제목이 잡힌다", async () => {
    // softDeleteTask 는 deleted 플래그만 세우고 문서를 지우지 않는다.
    queryDocuments.mockResolvedValue([
      {
        id: "t1",
        title: "Deleted but snapshotted",
        projectId: "p1",
        deleted: true,
      },
    ]);

    expect(await getProjectTaskTitles("p1")).toEqual({
      t1: "Deleted but snapshotted",
    });
  });
});
