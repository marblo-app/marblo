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

vi.mock("../../src/services/projectAuditService", () => ({
  getProjectAuditLog: (...args: unknown[]) => getProjectAuditLog(...args),
  getProjectAuditActors: (...args: unknown[]) => getProjectAuditActors(...args),
}));

const { fetchAuditLogState, fetchAuditActors } =
  await import("../../src/hooks/useProjectAuditLog");

beforeEach(() => {
  getProjectAuditLog.mockReset().mockResolvedValue([]);
  getProjectAuditActors.mockReset().mockResolvedValue([]);
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
