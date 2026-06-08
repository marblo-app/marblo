import { describe, expect, it } from "vitest";
import {
  executeStep,
  WAIT_PENDING,
} from "../../electron/mission-engine/step-executor";
import type { ExecutorDeps } from "../../electron/mission-engine/step-executor";
import type { Mission, MissionStep } from "../../electron/mission-engine/types";
import type {
  FixRunner,
  SkillRunner,
  TaskDispatcher,
  TaskStatusLite,
} from "../../electron/mission-engine/ports";

// step-executor 의 wait step(runWait) 분기 단위 테스트.
// 핵심 회귀 방지: [N1] 대기 중인 task 가 BLOCKED 같은 비완료 터미널 상태가 되면
// engine 이 영구 sleeping(WAIT_PENDING) 으로 데드락 하지 않고 실패(escalate) 경로로
// 빠져야 한다. (engine 은 error===WAIT_PENDING 일 때만 sleeping 으로 전환한다.)

const WAIT_STEP: MissionStep = { index: 0, type: "wait", status: "running" };

function makeWaitMission(taskIds: string[]): Mission {
  const now = new Date();
  return {
    id: "m-test",
    projectId: "p-test",
    goal: "test goal",
    templateId: "quick-fix",
    status: "active",
    ownerOrchestratorSessionId: "orch-1",
    steps: [WAIT_STEP],
    currentStepIndex: 0,
    taskIds,
    contextLog: [],
    launchedAt: now,
    lastActivityAt: now,
    completedAt: null,
  };
}

function makeDeps(statuses: Record<string, TaskStatusLite>): ExecutorDeps {
  const dispatcher: TaskDispatcher = {
    async dispatchTasks() {
      return [];
    },
    async getTaskStatuses(taskIds) {
      const out: Record<string, TaskStatusLite> = {};
      for (const id of taskIds) {
        if (statuses[id]) out[id] = statuses[id];
      }
      return out;
    },
    async killAgentsForTasks() {},
  };
  // wait step 은 skillRunner / fixRunner 를 건드리면 안 된다 — 호출되면 throw 로 잡는다.
  const skillRunner: SkillRunner = {
    async runSkill() {
      throw new Error("skillRunner should not be called for wait step");
    },
  };
  const fixRunner: FixRunner = {
    async runFix() {
      throw new Error("fixRunner should not be called for wait step");
    },
  };
  return { skillRunner, dispatcher, fixRunner };
}

describe("step-executor — wait step(runWait)", () => {
  it("taskIds 가 비어있으면 즉시 성공", async () => {
    const r = await executeStep(makeWaitMission([]), WAIT_STEP, makeDeps({}));
    expect(r.success).toBe(true);
  });

  it("모든 task 가 DONE → 성공", async () => {
    const r = await executeStep(
      makeWaitMission(["t1", "t2"]),
      WAIT_STEP,
      makeDeps({ t1: "DONE", t2: "DONE" }),
    );
    expect(r.success).toBe(true);
  });

  it("진행 중(IN_PROGRESS) task 가 남아있으면 WAIT_PENDING(sleeping)", async () => {
    const r = await executeStep(
      makeWaitMission(["t1", "t2"]),
      WAIT_STEP,
      makeDeps({ t1: "DONE", t2: "IN_PROGRESS" }),
    );
    expect(r.success).toBe(false);
    expect(r.error).toBe(WAIT_PENDING);
  });

  it("REVIEW(리뷰 대기) 는 비완료 진행상태 → WAIT_PENDING (escalate 아님)", async () => {
    const r = await executeStep(
      makeWaitMission(["t1"]),
      WAIT_STEP,
      makeDeps({ t1: "REVIEW" }),
    );
    expect(r.success).toBe(false);
    expect(r.error).toBe(WAIT_PENDING);
  });

  it("일부 FAILED + 나머지 DONE → 실패(escalate), WAIT_PENDING 아님", async () => {
    const r = await executeStep(
      makeWaitMission(["t1", "t2"]),
      WAIT_STEP,
      makeDeps({ t1: "DONE", t2: "FAILED" }),
    );
    expect(r.success).toBe(false);
    expect(r.error).not.toBe(WAIT_PENDING);
    expect(r.error).toBeTruthy();
  });

  // ── [N1] 핵심 회귀: BLOCKED 영구 대기 데드락 방지 ──
  it("대기 중 task 가 BLOCKED 로 전이 → 진행중 sibling 이 남아있어도 영구대기(WAIT_PENDING) 하지 않고 실패로 escalate", async () => {
    const r = await executeStep(
      makeWaitMission(["t1", "t2"]),
      WAIT_STEP,
      // t1 은 아직 진행 중이지만 t2 가 BLOCKED — 자력 완료 불가.
      makeDeps({ t1: "IN_PROGRESS", t2: "BLOCKED" }),
    );
    expect(r.success).toBe(false);
    // 핵심: sleeping 경로(WAIT_PENDING)로 빠지면 영구 데드락 → 반드시 아니어야 한다.
    expect(r.error).not.toBe(WAIT_PENDING);
    expect(r.error).toBeTruthy();
  });

  it("BLOCKED + 나머지 DONE → 성공 아님, 실패로 escalate", async () => {
    const r = await executeStep(
      makeWaitMission(["t1", "t2"]),
      WAIT_STEP,
      makeDeps({ t1: "DONE", t2: "BLOCKED" }),
    );
    expect(r.success).toBe(false);
    expect(r.error).not.toBe(WAIT_PENDING);
  });

  it("BLOCKED task id 를 output 에 노출 → 에스컬레이션 컨텍스트 제공", async () => {
    const r = await executeStep(
      makeWaitMission(["t1", "t2"]),
      WAIT_STEP,
      makeDeps({ t1: "IN_PROGRESS", t2: "BLOCKED" }),
    );
    const output = r.output as { blockedTaskIds?: string[] } | undefined;
    expect(output?.blockedTaskIds).toContain("t2");
  });
});
