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
  // PtySkillRunner 가 사용자 입력 요청 패턴을 감지한 경우 그 텍스트.
  // engine 이 이걸 보고 다음 step 진입 전 mission 을 waiting_for_human 으로 멈춤.
  userInputDetected?: string;
}

export const WAIT_PENDING = "wait.pending";

export interface ExecutorDeps {
  skillRunner: SkillRunner;
  dispatcher: TaskDispatcher;
  fixRunner: FixRunner;
  // gstack / fix step 실행 중 stdout tail 을 전달받는 콜백. engine 이 throttle 된
  // mission step.liveOutput write 로 변환한다.
  onProgress?: (chunk: string) => void;
  // 직전 step 결과 요약. gstack step 실행 전 PTY 로 주입되어 컨텍스트 연결.
  chainPrelude?: string;
}

export async function executeStep(
  mission: Mission,
  step: MissionStep,
  deps: ExecutorDeps,
): Promise<StepResult> {
  switch (step.type) {
    case "gstack":
      return runGstack(
        mission,
        step,
        deps.skillRunner,
        deps.onProgress,
        deps.chainPrelude,
      );
    case "dispatch":
      return runDispatch(mission, deps.dispatcher, deps.chainPrelude);
    case "wait":
      return runWait(mission, deps.dispatcher);
    case "fix":
      return runFix(mission, deps.fixRunner, deps.chainPrelude);
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
  onProgress?: (chunk: string) => void,
  chainPrelude?: string,
): Promise<StepResult> {
  if (!step.skill) {
    return { success: false, error: "gstack step missing skill" };
  }
  try {
    const result = await runner.runSkill({
      missionId: mission.id,
      projectId: mission.projectId,
      skill: step.skill,
      args: step.args,
      onProgress,
      chainPrelude,
    });
    return {
      success: result.success,
      output: result.output,
      error: result.error,
      userInputDetected: result.userInputDetected,
    };
  } catch (e) {
    return { success: false, error: errMsg(e) };
  }
}

async function runDispatch(
  mission: Mission,
  dispatcher: TaskDispatcher,
  priorContext?: string,
): Promise<StepResult> {
  try {
    const taskIds = await dispatcher.dispatchTasks({
      missionId: mission.id,
      projectId: mission.projectId,
      goal: mission.goal,
      priorContext,
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
    const entries = Object.entries(statuses);

    // [N1] BLOCKED 는 자력으로 DONE 에 도달할 수 없는 비완료 터미널 상태다.
    // remaining 에 그대로 두면 engine 이 영구 sleeping(WAIT_PENDING) 으로 데드락한다.
    // 진행 중인 sibling 이 남아있더라도 즉시 wait 를 중단하고 실패로 보고해
    // engine 의 onFailure(escalate) 경로로 위임한다 — sleeping 으로 전환하지 않는다.
    const blockedTaskIds = entries
      .filter(([, s]) => s === "BLOCKED")
      .map(([id]) => id);
    const failedTaskIds = entries
      .filter(([, s]) => s === "FAILED")
      .map(([id]) => id);
    if (blockedTaskIds.length > 0) {
      return {
        success: false,
        error: "one_or_more_tasks_blocked",
        output: { statuses, blockedTaskIds, failedTaskIds },
      };
    }

    const remaining = entries.filter(([, s]) => s !== "DONE" && s !== "FAILED");
    if (remaining.length === 0) {
      // FAILED 하나라도 있으면 wait step 도 실패로 본다 — onFailure 정책에 위임.
      return failedTaskIds.length > 0
        ? {
            success: false,
            error: "one_or_more_tasks_failed",
            output: { statuses, failedTaskIds },
          }
        : { success: true, output: { statuses } };
    }
    // 아직 미완료 (TODO/CLAIMED/IN_PROGRESS/REVIEW) → sleeping
    return { success: false, error: WAIT_PENDING, output: { statuses } };
  } catch (e) {
    return { success: false, error: errMsg(e) };
  }
}

async function runFix(
  mission: Mission,
  fixRunner: FixRunner,
  priorContext?: string,
): Promise<StepResult> {
  try {
    const r = await fixRunner.runFix({
      missionId: mission.id,
      projectId: mission.projectId,
      goal: mission.goal,
      priorContext,
    });
    return { success: r.success, error: r.error };
  } catch (e) {
    return { success: false, error: errMsg(e) };
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
