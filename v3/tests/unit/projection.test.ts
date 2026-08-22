// Spec: v3/docs/specs/2026-05-28-orch-live-awareness-design.md §13.3
// MCP 도구 4종 (claim_task / update_task_status / submit_for_review / add_activity)
// 이 projection 을 어떻게 갱신하는지를 pure function 으로 검증.
// 트랜잭션 wrapper (applyProjection) 의 Firestore 호출 자체는 통합 테스트 영역.

import { describe, it, expect, beforeEach } from "vitest";
import { Timestamp } from "firebase/firestore";
// `firebase/firestore` is aliased to the in-memory mock (vitest.config), so the
// same store backs applyProjection and these direct seed/read helpers.
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  __resetStore,
} from "../mocks/firebase-firestore";
import {
  computeTaskProjection,
  applyMissionStatusDelta,
  applyProjection,
  type TaskProjection,
} from "../../electron/mcp-server/projection";
import {
  formatClaimOwnershipError,
  getClaimOwnershipError,
} from "../../electron/mcp-server/task-ownership";

const PROJECT_ID = "proj-1";
const TID = "task-123";
const NOW = Timestamp.fromMillis(1_750_000_000_000);
const LATER = Timestamp.fromMillis(1_750_000_060_000);

describe("computeTaskProjection — MCP 도구 4종 시나리오", () => {
  it("claim_task: TODO 상태에서 호출되면 currentStatus=CLAIMED, lastAgentId 갱신", () => {
    const next = computeTaskProjection(undefined, "TODO", TID, NOW, {
      newStatus: "CLAIMED",
      lastAgentId: "backend-claude-3",
      lastActivitySummary: "claimed by backend-claude-3",
    });
    expect(next.currentStatus).toBe("CLAIMED");
    expect(next.lastAgentId).toBe("backend-claude-3");
    expect(next.lastActivityAt).toBe(NOW);
    expect(next.lastActivitySummary).toBe("claimed by backend-claude-3");
    expect(next.milestonesPassed).toEqual([]);
    expect(next.blockerSummary).toBeUndefined();
  });

  it("update_task_status → BLOCKED: blockerSummary 가 comment 로 set", () => {
    const prev: TaskProjection = {
      currentStatus: "IN_PROGRESS",
      lastAgentId: "backend-claude-3",
      lastActivityAt: NOW,
      lastActivitySummary: "started",
      milestonesPassed: [],
    };
    const next = computeTaskProjection(prev, "IN_PROGRESS", TID, LATER, {
      newStatus: "BLOCKED",
      lastAgentId: "backend-claude-3",
      lastActivitySummary: "DB migration conflict",
      blockerSummary: "DB migration conflict — 0042 slot already on main",
    });
    expect(next.currentStatus).toBe("BLOCKED");
    expect(next.blockerSummary).toBe(
      "DB migration conflict — 0042 slot already on main",
    );
    expect(next.lastActivityAt).toBe(LATER);
  });

  it("update_task_status: BLOCKED → IN_PROGRESS 전이 시 blockerSummary 가 빈 문자열로 clear", () => {
    const prev: TaskProjection = {
      currentStatus: "BLOCKED",
      lastAgentId: "backend-claude-3",
      lastActivityAt: NOW,
      lastActivitySummary: "blocked on migration",
      milestonesPassed: [],
      blockerSummary: "DB migration conflict",
    };
    const next = computeTaskProjection(prev, "BLOCKED", TID, LATER, {
      newStatus: "IN_PROGRESS",
      lastAgentId: "backend-claude-3",
      lastActivitySummary: "resumed",
    });
    expect(next.currentStatus).toBe("IN_PROGRESS");
    expect(next.blockerSummary).toBe("");
  });

  it("add_activity: status 유지, lastActivitySummary 200자 자름, milestonesPassed 보존", () => {
    const prev: TaskProjection = {
      currentStatus: "IN_PROGRESS",
      lastAgentId: "backend-claude-3",
      lastActivityAt: NOW,
      lastActivitySummary: "started",
      milestonesPassed: [],
    };
    const longMsg = "x".repeat(300);
    const next = computeTaskProjection(prev, "IN_PROGRESS", TID, LATER, {
      // newStatus 미지정 — add_activity 는 status 안 바꿈
      lastAgentId: "backend-claude-3",
      lastActivitySummary: longMsg,
    });
    expect(next.currentStatus).toBe("IN_PROGRESS"); // 유지
    expect(next.lastActivitySummary).toHaveLength(200);
    expect(next.lastActivitySummary).toBe("x".repeat(200));
    expect(next.lastActivityAt).toBe(LATER);
  });

  it("submit_for_review: currentStatus=REVIEW, milestonesPassed 에 taskId append (중복 방지)", () => {
    const prev: TaskProjection = {
      currentStatus: "IN_PROGRESS",
      lastAgentId: "backend-claude-3",
      lastActivityAt: NOW,
      lastActivitySummary: "implemented",
      milestonesPassed: [],
    };
    const next = computeTaskProjection(prev, "IN_PROGRESS", TID, LATER, {
      newStatus: "REVIEW",
      lastAgentId: "backend-claude-3",
      lastActivitySummary: "submitted PR #123",
      appendMilestone: true,
    });
    expect(next.currentStatus).toBe("REVIEW");
    expect(next.milestonesPassed).toEqual([TID]);

    // 두 번째 submit 호출은 중복 추가 안 함
    const again = computeTaskProjection(next, "REVIEW", TID, LATER, {
      newStatus: "REVIEW",
      lastAgentId: "backend-claude-3",
      appendMilestone: true,
    });
    expect(again.milestonesPassed).toEqual([TID]);
  });

  it("lastAgentId 가 빈 문자열이면 prev 값 유지 (덮어쓰기 X)", () => {
    const prev: TaskProjection = {
      currentStatus: "IN_PROGRESS",
      lastAgentId: "backend-claude-3",
      lastActivityAt: NOW,
      lastActivitySummary: "ongoing",
      milestonesPassed: [],
    };
    const next = computeTaskProjection(prev, "IN_PROGRESS", TID, LATER, {
      lastAgentId: "", // env 에 MARBLO_AGENT_ID 없을 때
      lastActivitySummary: "tick",
    });
    expect(next.lastAgentId).toBe("backend-claude-3");
  });
});

describe("applyMissionStatusDelta — mission statusCounts 점진 갱신", () => {
  it("TODO → CLAIMED: TODO 카운트 -1, CLAIMED +1", () => {
    const next = applyMissionStatusDelta(
      { TODO: 3, CLAIMED: 1, IN_PROGRESS: 2 },
      "TODO",
      "CLAIMED",
    );
    expect(next).toEqual({ TODO: 2, CLAIMED: 2, IN_PROGRESS: 2 });
  });

  // Raw pure fallback when neither prior counts nor a seed exist. In practice
  // applyProjection seeds the full count from sibling tasks before calling this
  // (see the integration test below), so a multi-task mission never lands here
  // with a wrong TODO total — that was bug_003.
  it("counts·seed 둘 다 없을 때 raw fallback: old=0(floor), new=1", () => {
    const next = applyMissionStatusDelta(undefined, "TODO", "CLAIMED");
    expect(next).toEqual({ TODO: 0, CLAIMED: 1 });
  });

  it("seed 후 delta: 5-task 미션 첫 claim 은 TODO 총원을 보존 (bug_003 계약)", () => {
    // recomputeMissionCounts 가 만든 권위 카운트(이 task 아직 TODO) 위에서 delta.
    const seeded = { TODO: 5 };
    const next = applyMissionStatusDelta(seeded, "TODO", "CLAIMED");
    expect(next).toEqual({ TODO: 4, CLAIMED: 1 });
  });

  it("같은 status (no-op): prev 사본 그대로", () => {
    const prev = { TODO: 3, CLAIMED: 1 };
    const next = applyMissionStatusDelta(prev, "TODO", "TODO");
    expect(next).toEqual(prev);
    expect(next).not.toBe(prev); // 새 객체
  });

  it("0 floor: 이미 0인 status 에서 빼도 음수 X", () => {
    const next = applyMissionStatusDelta(
      { CLAIMED: 0, IN_PROGRESS: 1 },
      "CLAIMED",
      "IN_PROGRESS",
    );
    expect(next.CLAIMED).toBe(0);
    expect(next.IN_PROGRESS).toBe(2);
  });
});

describe("applyProjection — completedAt (보드 완료 컬럼 '최근 완료순' 축)", () => {
  const db = {} as never;
  beforeEach(() => __resetStore());

  it("REVIEW → DONE 전이에 completedAt 이 같은 트랜잭션으로 찍힌다(update_task_status / merge_and_close 공통 경로)", async () => {
    await setDoc(doc(db, "tasks", "t1"), {
      status: "REVIEW",
      projectId: PROJECT_ID,
    });
    await applyProjection(db, "t1", {
      newStatus: "DONE",
      lastAgentId: "agent-1",
      validateFrom: (s) => s === "REVIEW",
    });
    const t1 = (await getDoc(doc(db, "tasks", "t1"))).data() as {
      status: string;
      completedAt?: Timestamp;
      updatedAt?: Timestamp;
    };
    expect(t1.status).toBe("DONE");
    expect(t1.completedAt).toBeInstanceOf(Timestamp);
    expect(t1.completedAt!.toMillis()).toBe(t1.updatedAt!.toMillis());
  });

  it("DONE 이 아닌 전이에는 completedAt 을 건드리지 않는다", async () => {
    await setDoc(doc(db, "tasks", "t1"), {
      status: "IN_PROGRESS",
      projectId: PROJECT_ID,
    });
    await applyProjection(db, "t1", {
      newStatus: "REVIEW",
      lastAgentId: "agent-1",
    });
    const t1 = (await getDoc(doc(db, "tasks", "t1"))).data() as {
      completedAt?: unknown;
    };
    expect(t1.completedAt).toBeUndefined();
  });

  it("이미 DONE 인 문서를 force 로 다시 DONE 해도 원래 completedAt 은 보존된다", async () => {
    const FIRST = Timestamp.fromMillis(1_700_000_000_000);
    await setDoc(doc(db, "tasks", "t1"), {
      status: "DONE",
      projectId: PROJECT_ID,
      completedAt: FIRST,
    });
    await applyProjection(db, "t1", {
      newStatus: "DONE",
      lastAgentId: "agent-1",
      // force=true 경로: validateFrom 없음
    });
    const t1 = (await getDoc(doc(db, "tasks", "t1"))).data() as {
      completedAt: Timestamp;
    };
    expect(t1.completedAt.toMillis()).toBe(FIRST.toMillis());
  });
});

describe("applyProjection — Firestore 통합 (seed self-heal + TOCTOU 가드)", () => {
  const db = {} as never;
  beforeEach(() => __resetStore());

  it("bug_003 seed: mission projection 미초기화 상태에서 첫 claim 시 sibling 전체를 재계산해 TODO 총원을 보존", async () => {
    await setDoc(doc(db, "missions", "m1"), { goal: "ship it" }); // projection 없음
    for (const t of ["t1", "t2", "t3", "t4", "t5"]) {
      await setDoc(doc(db, "tasks", t), {
        status: "TODO",
        missionId: "m1",
        projectId: PROJECT_ID,
      });
    }

    await applyProjection(db, "t1", {
      newStatus: "CLAIMED",
      lastAgentId: "agent-1",
      lastActivitySummary: "claimed by agent-1",
      validateFrom: (s) => s === "TODO",
    });

    const m = (await getDoc(doc(db, "missions", "m1"))).data() as {
      projection: { statusCounts: Record<string, number> };
    };
    // 버그였다면 {CLAIMED:1} (TODO 사라짐). seed 후엔 나머지 4개 TODO 보존.
    expect(m.projection.statusCounts).toEqual({ TODO: 4, CLAIMED: 1 });
    const t1 = (await getDoc(doc(db, "tasks", "t1"))).data() as {
      status: string;
    };
    expect(t1.status).toBe("CLAIMED");
  });

  // ★fail-open (티켓 4ov5wbQZ25XUXHZVhxdh): 미션 카운트 seed 는 부기이지 상태
  // 전이가 아니다. projectId 가 없어 스코프 쿼리를 만들 수 없는 손상 문서라도
  // 상태 write 는 반드시 커밋돼야 한다 — 여기서 막히면 task_outcomes 가 유실되고
  // 스폰모델 학습축이 손상된다(예전엔 이 경로가 통째로 throw 했다).
  it("projectId 없는 손상 태스크: seed 는 건너뛰되 상태 전이는 커밋된다", async () => {
    await setDoc(doc(db, "missions", "m1"), { goal: "ship it" });
    await setDoc(doc(db, "tasks", "t1"), { status: "TODO", missionId: "m1" });

    await applyProjection(db, "t1", {
      newStatus: "CLAIMED",
      lastAgentId: "agent-1",
      validateFrom: (s) => s === "TODO",
    });

    const t1 = (await getDoc(doc(db, "tasks", "t1"))).data() as {
      status: string;
    };
    expect(t1.status).toBe("CLAIMED");
  });

  it("seed 이후 두 번째 전이는 delta 경로로 정확히 갱신", async () => {
    await setDoc(doc(db, "missions", "m1"), { goal: "ship it" });
    for (const t of ["t1", "t2", "t3"]) {
      await setDoc(doc(db, "tasks", t), {
        status: "TODO",
        missionId: "m1",
        projectId: PROJECT_ID,
      });
    }
    await applyProjection(db, "t1", {
      newStatus: "CLAIMED",
      lastAgentId: "a",
      validateFrom: (s) => s === "TODO",
    });
    await applyProjection(db, "t2", {
      newStatus: "CLAIMED",
      lastAgentId: "a",
      validateFrom: (s) => s === "TODO",
    });
    const m = (await getDoc(doc(db, "missions", "m1"))).data() as {
      projection: { statusCounts: Record<string, number> };
    };
    expect(m.projection.statusCounts).toEqual({ TODO: 1, CLAIMED: 2 });
  });

  it("bug_005 가드: 이미 CLAIMED 인 task 재claim 은 throw + status/claimedBy 안 덮어씀", async () => {
    await setDoc(doc(db, "tasks", "t1"), {
      status: "CLAIMED",
      claimedBy: "agent-1",
    });

    await expect(
      applyProjection(db, "t1", {
        newStatus: "CLAIMED",
        lastAgentId: "agent-2",
        extraTaskFields: { claimedBy: "agent-2" },
        validateFrom: (s) => s === "TODO",
      }),
    ).rejects.toThrow(/cannot transition/);

    const t1 = (await getDoc(doc(db, "tasks", "t1"))).data() as {
      status: string;
      claimedBy: string;
    };
    expect(t1.status).toBe("CLAIMED");
    expect(t1.claimedBy).toBe("agent-1"); // 두 번째 claim 거부 — 그대로
  });

  it("TODO 상태라도 claimedBy 가 남아 있으면 claim precondition 으로 재클레임 방지", async () => {
    await setDoc(doc(db, "tasks", "t1"), {
      status: "TODO",
      claimedBy: "agent-1",
    });

    await expect(
      applyProjection(db, "t1", {
        newStatus: "CLAIMED",
        lastAgentId: "agent-2",
        extraTaskFields: { claimedBy: "agent-2" },
        validateFrom: (s) => s === "TODO",
        validateTask: (t) => t.claimedBy == null,
      }),
    ).rejects.toThrow(/precondition/);

    const t1 = (await getDoc(doc(db, "tasks", "t1"))).data() as {
      status: string;
      claimedBy: string;
    };
    expect(t1.status).toBe("TODO");
    expect(t1.claimedBy).toBe("agent-1");
  });

  it("validateFrom 통과하는 정상 전이는 그대로 진행", async () => {
    await setDoc(doc(db, "tasks", "t1"), { status: "TODO" });
    await applyProjection(db, "t1", {
      newStatus: "CLAIMED",
      lastAgentId: "agent-1",
      validateFrom: (s) => s === "TODO",
    });
    const t1 = (await getDoc(doc(db, "tasks", "t1"))).data() as {
      status: string;
      projection: { currentStatus: string };
    };
    expect(t1.status).toBe("CLAIMED");
    expect(t1.projection.currentStatus).toBe("CLAIMED");
  });

  it("claimedBy 소유권 가드: claim 에이전트가 아니면 명시 에러로 거부", async () => {
    await setDoc(doc(db, "tasks", "t1"), {
      status: "IN_PROGRESS",
      claimedBy: "agent-1",
    });

    await expect(
      applyProjection(db, "t1", {
        newStatus: "REVIEW",
        lastAgentId: "agent-2",
        validateTask: (t) =>
          getClaimOwnershipError({
            claimedBy: typeof t.claimedBy === "string" ? t.claimedBy : null,
            actorAgentId: "agent-2",
          }) === null,
        validateTaskError: formatClaimOwnershipError("agent-1"),
      }),
    ).rejects.toThrow(
      "Task is claimed by agent agent-1; only the claiming agent can update it",
    );

    const t1 = (await getDoc(doc(db, "tasks", "t1"))).data() as {
      status: string;
      claimedBy: string;
    };
    expect(t1.status).toBe("IN_PROGRESS");
    expect(t1.claimedBy).toBe("agent-1");
  });

  it("claimedBy 소유권 가드: force 경로처럼 validateTask를 생략하면 다른 에이전트도 통과", async () => {
    await setDoc(doc(db, "tasks", "t1"), {
      status: "IN_PROGRESS",
      claimedBy: "agent-1",
    });

    await applyProjection(db, "t1", {
      newStatus: "DONE",
      lastAgentId: "agent-2",
    });

    const t1 = (await getDoc(doc(db, "tasks", "t1"))).data() as {
      status: string;
      claimedBy: string;
    };
    expect(t1.status).toBe("DONE");
    expect(t1.claimedBy).toBe("agent-1");
  });
});

// ── claim override 감사 기록 (티켓 r2rrPsblZPlUOTCWzc3Z) ──────────
//
// ★핵심은 "기록이 남는다" 가 아니라 "상태 변경과 **원자적으로** 남는다" 다.
// 별도 write 로 빼면 상태는 바뀌었는데 근거만 유실되는 조합이 생기고, 그게 바로
// 이 티켓이 고치려는 그림이다 — 닫을 수는 있는데 왜 닫았는지 못 적는다.
describe("applyProjection — claim override 감사 기록", () => {
  const db = { type: "mock-firestore" } as unknown as Parameters<
    typeof applyProjection
  >[0];

  beforeEach(() => {
    __resetStore();
  });

  async function activityDocs() {
    const snap = await getDocs(collection(db, "activities") as never);
    return snap.docs.map((d) => d.data() as Record<string, unknown>);
  }

  it("override 감사 문서가 상태 변경과 같은 트랜잭션에서 함께 남는다", async () => {
    await setDoc(doc(db, "tasks", "t1"), {
      projectId: PROJECT_ID,
      status: "CLAIMED",
      claimedBy: "ghost-agent",
    });

    await applyProjection(db, "t1", {
      newStatus: "DONE",
      lastAgentId: "",
      lastActivitySummary: "PR 머지 완료",
      overrideAuditPayload: {
        agentId: "orchestrator-proj-1",
        message: "⚠️ claim override — 사유: PR 머지 완료",
        overrideGrant: "orchestrator",
        overriddenClaimBy: "ghost-agent",
      },
    });

    const t1 = (await getDoc(doc(db, "tasks", "t1"))).data() as {
      status: string;
    };
    expect(t1.status).toBe("DONE");

    const audits = await activityDocs();
    expect(audits).toHaveLength(1);
    expect(audits[0].taskId).toBe("t1");
    expect(audits[0].overrideGrant).toBe("orchestrator");
    expect(audits[0].overriddenClaimBy).toBe("ghost-agent");
    expect(audits[0].agentId).toBe("orchestrator-proj-1");
  });

  it("★상태 변경이 거부되면 감사 문서도 남지 않는다(원자성)", async () => {
    await setDoc(doc(db, "tasks", "t1"), {
      projectId: PROJECT_ID,
      status: "CLAIMED",
      // 판정 이후 **다른** 에이전트가 새로 claim 한 상황.
      claimedBy: "someone-else",
    });

    await expect(
      applyProjection(db, "t1", {
        newStatus: "DONE",
        lastAgentId: "",
        validateTask: (t) => t.claimedBy === "ghost-agent",
        validateTaskError: "claim holder changed",
        overrideAuditPayload: {
          agentId: "orchestrator-proj-1",
          message: "⚠️ claim override",
          overrideGrant: "orchestrator",
          overriddenClaimBy: "ghost-agent",
        },
      }),
    ).rejects.toThrow("claim holder changed");

    const t1 = (await getDoc(doc(db, "tasks", "t1"))).data() as {
      status: string;
    };
    expect(t1.status).toBe("CLAIMED");
    expect(await activityDocs()).toHaveLength(0);
  });

  it("add_activity 경로는 기록 문서 자체에 override 를 새긴다(피드 중복 없음)", async () => {
    await setDoc(doc(db, "tasks", "t1"), {
      projectId: PROJECT_ID,
      status: "IN_PROGRESS",
      claimedBy: "ghost-agent",
    });

    await applyProjection(db, "t1", {
      lastAgentId: "",
      lastActivitySummary: "직전 보고 정정",
      activityPayload: {
        agentId: "orchestrator-proj-1",
        message: "직전 보고 정정: 실제로는 REVIEW 가 아니라 FAILED 였다",
        overrideGrant: "orchestrator",
        overriddenClaimBy: "ghost-agent",
      },
    });

    const docs = await activityDocs();
    expect(docs).toHaveLength(1);
    expect(docs[0].overrideGrant).toBe("orchestrator");
    expect(docs[0].overriddenClaimBy).toBe("ghost-agent");
    expect(docs[0].agentId).toBe("orchestrator-proj-1");
  });

  it("override 가 아닌 평범한 activity 에는 override 필드가 붙지 않는다", async () => {
    await setDoc(doc(db, "tasks", "t1"), {
      projectId: PROJECT_ID,
      status: "IN_PROGRESS",
      claimedBy: "agent-1",
    });

    await applyProjection(db, "t1", {
      lastAgentId: "agent-1",
      activityPayload: { agentId: "agent-1", message: "진행 중" },
    });

    const docs = await activityDocs();
    expect(docs).toHaveLength(1);
    expect(docs[0].overrideGrant).toBeUndefined();
    expect(docs[0].overriddenClaimBy).toBeUndefined();
  });

  it("override 감사와 본 activity 는 별개 문서로 남는다", async () => {
    await setDoc(doc(db, "tasks", "t1"), {
      projectId: PROJECT_ID,
      status: "IN_PROGRESS",
      claimedBy: "ghost-agent",
    });

    await applyProjection(db, "t1", {
      lastAgentId: "",
      lastActivitySummary: "직전 보고 정정",
      activityPayload: {
        agentId: "orchestrator-proj-1",
        message: "직전 보고 정정",
      },
      overrideAuditPayload: {
        agentId: "orchestrator-proj-1",
        message: "⚠️ claim override — 사유: 직전 보고 정정",
        overrideGrant: "orchestrator",
        overriddenClaimBy: "ghost-agent",
      },
    });

    const docs = await activityDocs();
    expect(docs).toHaveLength(2);
    expect(docs.filter((d) => d.overrideGrant === "orchestrator")).toHaveLength(
      1,
    );
    expect(docs.filter((d) => d.overrideGrant === undefined)).toHaveLength(1);
  });
});
