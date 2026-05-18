import type { Mission, MissionStep } from "./types";
import type { FixRunner, SkillRunner, TaskDispatcher } from "./ports";

// 각 MissionStepType 의 단일-실행 어댑터.
// engine 은 결과 { success, output?, error? } 로 retry/escalate/continue 분기.
//
// 특수 신호:
//   - wait step 이 아직 미완료면 success=false + error='wait.pending'.
//     engine 은 이걸 보고 retry 가 아니라 sleeping 으로 전환한다.

export interface StepResult {
  success: boolean;
  output?: unknown;
  error?: string;
}

export const WAIT_PENDING = "wait.pending";

export interface ExecutorDeps {
  skillRunner: SkillRunner;
  dispatcher: TaskDispatcher;
  fixRunner: FixRunner;
}

export async function executeStep(
  mission: Mission,
  step: MissionStep,
  deps: ExecutorDeps,
): Promise<StepResult> {
  switch (step.type) {
    case "gstack":
      return runGstack(mission, step, deps.skillRunner);
    case "dispatch":
      return runDispatch(mission, deps.dispatcher);
    case "wait":
      return runWait(mission, deps.dispatcher);
    case "fix":
      return runFix(mission, deps.fixRunner);
    default: {
      // exhaustiveness check
      const _exhaustive: never = step.type;
      return {
        success: false,
        error: `Unknown step type: ${String(_exhaustive)}`,
      };
    }
  }
}

async function runGstack(
  mission: Mission,
  step: MissionStep,
  runner: SkillRunner,
): Promise<StepResult> {
  if (!step.skill) {
    return { success: false, error: "gstack step missing skill" };
  }
  try {
    const result = await runner.runSkill({
      missionId: mission.id,
      skill: step.skill,
      args: step.args,
    });
    return {
      success: result.success,
      output: result.output,
      error: result.error,
    };
  } catch (e) {
    return { success: false, error: errMsg(e) };
  }
}

async function runDispatch(
  mission: Mission,
  dispatcher: TaskDispatcher,
): Promise<StepResult> {
  try {
    const taskIds = await dispatcher.dispatchTasks({
      missionId: mission.id,
      projectId: mission.projectId,
      goal: mission.goal,
    });
    return { success: true, output: { taskIds } };
  } catch (e) {
    return { success: false, error: errMsg(e) };
  }
}

async function runWait(
  mission: Mission,
  dispatcher: TaskDispatcher,
): Promise<StepResult> {
  try {
    if (mission.taskIds.length === 0) {
      // dispatch step 이 비어있으면 wait 도 즉시 성공.
      return { success: true, output: { statuses: {} } };
    }
    const statuses = await dispatcher.getTaskStatuses(mission.taskIds);
    const remaining = Object.entries(statuses).filter(
      ([, s]) => s !== "DONE" && s !== "FAILED",
    );
    const anyFailed = Object.values(statuses).some((s) => s === "FAILED");
    if (remaining.length === 0) {
      // FAILED 하나라도 있으면 wait step 도 실패로 본다 — onFailure 정책에 위임.
      return anyFailed
        ? {
            success: false,
            error: "one_or_more_tasks_failed",
            output: { statuses },
          }
        : { success: true, output: { statuses } };
    }
    // 아직 미완료 → sleeping
    return { success: false, error: WAIT_PENDING, output: { statuses } };
  } catch (e) {
    return { success: false, error: errMsg(e) };
  }
}

async function runFix(
  mission: Mission,
  fixRunner: FixRunner,
): Promise<StepResult> {
  try {
    const r = await fixRunner.runFix({
      missionId: mission.id,
      projectId: mission.projectId,
      goal: mission.goal,
    });
    return { success: r.success, error: r.error };
  } catch (e) {
    return { success: false, error: errMsg(e) };
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
