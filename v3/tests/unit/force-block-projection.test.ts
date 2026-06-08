// Regression coverage for two MCP-server bugs fixed in
// electron/mcp-server/tools.ts + projection.ts:
//
//   [H1] update_task_status(force=true) must actually skip state-machine
//        validation. The handler now passes `validateFrom: undefined` when
//        force is set; applyProjection's in-txn TOCTOU guard must treat
//        undefined as "skip" so the documented escape hatch lives.
//
//   [M3] dispatch_task's BLOCKED mark must flow through applyProjection (not a
//        raw updateDoc) so tasks/{id}.projection.currentStatus AND the
//        mission's statusCounts move with the real status — otherwise
//        get_projection contradicts the actual BLOCKED status.
//
// Both contracts are enforced at the applyProjection layer, which is the
// same seam the existing projection.test.ts exercises. tools.ts itself cannot
// be imported here (it pulls in ./firebase.js → real firebase/auth), so we
// assert the exact call shapes the two fixed handlers now use.

import { describe, it, expect, beforeEach } from "vitest";
// `firebase/firestore` is aliased to the in-memory mock (vitest.config), so the
// same store backs applyProjection and these direct seed/read helpers.
import { doc, setDoc, getDoc, __resetStore } from "../mocks/firebase-firestore";
import {
  applyProjection,
  type TaskProjection,
  type MissionProjection,
} from "../../electron/mcp-server/projection";

const db = {} as never;

beforeEach(() => __resetStore());

describe("[H1] force escape hatch — validateFrom undefined skips in-txn re-check", () => {
  it("force 경로(validateFrom 미지정): 상태머신상 불가능한 전이도 통과한다", async () => {
    // TODO → DONE 은 상태머신상 불가능. force=true 면 핸들러가 validateFrom 을
    // 넘기지 않으므로 applyProjection 의 in-txn 가드가 꺼져 그대로 적용돼야 한다.
    await setDoc(doc(db, "tasks", "t1"), { status: "TODO" });

    await applyProjection(db, "t1", {
      newStatus: "DONE",
      lastAgentId: "agent-1",
      lastActivitySummary: "force-completed",
      // validateFrom 미지정 == update_task_status(force=true)
    });

    const t1 = (await getDoc(doc(db, "tasks", "t1"))).data() as {
      status: string;
      projection: TaskProjection;
    };
    expect(t1.status).toBe("DONE");
    expect(t1.projection.currentStatus).toBe("DONE");
  });

  it("non-force 경로(validateFrom 지정): 불가능한 전이는 throw + status 보존", async () => {
    // force 가 아니면 핸들러는 validateFrom=(s)=>canTransition(s,newStatus) 를
    // 넘긴다. TODO 에서 DONE 으로 가는 술어는 false → 트랜잭션 abort.
    await setDoc(doc(db, "tasks", "t1"), { status: "TODO" });

    await expect(
      applyProjection(db, "t1", {
        newStatus: "DONE",
        lastAgentId: "agent-1",
        // canTransition(TODO, DONE) === false 를 모사
        validateFrom: (s) => s === "IN_PROGRESS" || s === "CLAIMED",
      }),
    ).rejects.toThrow(/cannot transition/);

    const t1 = (await getDoc(doc(db, "tasks", "t1"))).data() as {
      status: string;
    };
    expect(t1.status).toBe("TODO"); // 거부 — 그대로
  });

  it("force 경로라도 가능한 전이는 동일하게 적용 (escape hatch 가 정상 경로를 깨지 않음)", async () => {
    await setDoc(doc(db, "tasks", "t1"), { status: "IN_PROGRESS" });
    await applyProjection(db, "t1", {
      newStatus: "DONE",
      lastAgentId: "agent-1",
    });
    const t1 = (await getDoc(doc(db, "tasks", "t1"))).data() as {
      status: string;
      projection: TaskProjection;
    };
    expect(t1.status).toBe("DONE");
    expect(t1.projection.currentStatus).toBe("DONE");
  });
});

describe("[M3] dispatch_task BLOCKED — projection 경로로 라우팅", () => {
  it("BLOCKED 마킹이 task.status + projection.currentStatus + blockerSummary 를 함께 갱신", async () => {
    await setDoc(doc(db, "tasks", "t1"), { status: "TODO", missionId: "m1" });
    await setDoc(doc(db, "missions", "m1"), { goal: "ship it" });

    // dispatch_task 가 선행 미완료 시 호출하는 형태 그대로 (validateFrom 없음 =
    // 현재 상태와 무관하게 강제 마킹).
    await applyProjection(db, "t1", {
      newStatus: "BLOCKED",
      lastAgentId: "agent-1",
      lastActivitySummary: "dispatch aborted: 선행 태스크 미완료 — BLOCKED",
      blockerSummary: "선행 태스크 미완료 (dependsOn 미충족)",
    });

    const t1 = (await getDoc(doc(db, "tasks", "t1"))).data() as {
      status: string;
      projection: TaskProjection;
    };
    expect(t1.status).toBe("BLOCKED");
    expect(t1.projection.currentStatus).toBe("BLOCKED");
    expect(t1.projection.blockerSummary).toBe(
      "선행 태스크 미완료 (dependsOn 미충족)",
    );
  });

  it("BLOCKED 마킹이 mission statusCounts 에 반영 (get_projection 이 실제 status 와 일치)", async () => {
    await setDoc(doc(db, "missions", "m1"), { goal: "ship it" });
    for (const t of ["t1", "t2", "t3"]) {
      await setDoc(doc(db, "tasks", t), { status: "TODO", missionId: "m1" });
    }

    await applyProjection(db, "t1", {
      newStatus: "BLOCKED",
      lastAgentId: "agent-1",
      blockerSummary: "dep 미충족",
    });

    const m = (await getDoc(doc(db, "missions", "m1"))).data() as {
      projection: MissionProjection;
    };
    // raw updateDoc 였다면 mission projection 은 seed 안 돼 stale.
    // projection 경로를 타므로 TODO 2 / BLOCKED 1 로 정확히 이동.
    expect(m.projection.statusCounts).toEqual({ TODO: 2, BLOCKED: 1 });
  });
});
