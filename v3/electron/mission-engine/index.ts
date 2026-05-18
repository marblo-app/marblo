import type {
  Mission,
  MissionStatus,
  MissionTemplateId,
  TimelineEvent,
  TimelineEventType,
} from "./types";
import type { MissionEngineDeps, MissionEngineEvent } from "./ports";
import { assertMissionTransition, isTerminalMission } from "./state-machine";
import { executeStep, WAIT_PENDING } from "./step-executor";
import { instantiateSteps, MISSION_TEMPLATES, getTemplate } from "./templates";

// MissionEngine — 미션 라이프사이클을 책임지는 코어.
// 명세: v3/docs/MISSIONS-SPEC.md §7.
//
// 의존성은 ports 인터페이스로만 받는다 (테스트 가능).
// 실제 wiring (Firestore missionService / OrchestratorManager / AgentManager /
// run_skill MCP) 은 Step 5 main.ts 에서.

const DEFAULT_MAX_RETRIES = 2; // D10: 1-2회 retry 후 알림 카드

export class MissionEngine {
  private readonly maxRetries: number;
  private readonly now: () => Date;
  private readonly log: (msg: string, meta?: Record<string, unknown>) => void;
  private readonly inFlight: Set<string> = new Set();
  private readonly unsubscribe: () => void;

  constructor(private readonly deps: MissionEngineDeps) {
    this.maxRetries = deps.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.now = deps.now ?? (() => new Date());
    this.log =
      deps.logger ??
      ((m, meta) => console.log(`[MissionEngine] ${m}`, meta ?? ""));
    this.unsubscribe = deps.eventBus.on((event) =>
      this.onEvent(event).catch((err) =>
        this.log("event handler error", { err: String(err), event }),
      ),
    );
  }

  // ──────────────────────────── public API ────────────────────────────

  async launch(input: {
    projectId: string;
    goal: string;
    templateId: MissionTemplateId;
  }): Promise<Mission> {
    const template = getTemplate(input.templateId);
    const orch = await this.deps.orchestrators.ensureSession({
      missionId: `pending-${this.now().getTime()}`,
      projectId: input.projectId,
    });

    const launchedAt = this.now();
    const missionId = await this.deps.store.createMission({
      projectId: input.projectId,
      goal: input.goal,
      templateId: input.templateId,
      status: "planning",
      ownerOrchestratorSessionId: orch.sessionId,
      steps: instantiateSteps(input.templateId),
      currentStepIndex: 0,
      taskIds: [],
      contextLog: [
        {
          ts: launchedAt,
          type: "supervisor.note",
          payload: {
            message: `Mission launched · template=${template.label}`,
            templateId: input.templateId,
            goal: input.goal,
          },
        },
      ],
    });

    const mission = await this.requireMission(missionId);
    await this.transition(mission, "active");
    this.scheduleAdvance(missionId);
    return mission;
  }

  async resume(missionId: string): Promise<void> {
    const mission = await this.requireMission(missionId);
    if (isTerminalMission(mission.status)) {
      throw new Error(
        `Cannot resume terminal mission ${missionId} (status=${mission.status})`,
      );
    }
    if (
      mission.status === "sleeping" ||
      mission.status === "waiting_for_human"
    ) {
      await this.transition(mission, "active");
      await this.deps.store.appendTimelineEvent(missionId, {
        ts: this.now(),
        type: "mission.resumed",
        payload: { from: mission.status },
      });
    }
    this.scheduleAdvance(missionId);
  }

  async abandon(missionId: string, reason?: string): Promise<void> {
    const mission = await this.requireMission(missionId);
    if (isTerminalMission(mission.status)) return;
    if (mission.taskIds.length > 0) {
      try {
        await this.deps.dispatcher.killAgentsForTasks(mission.taskIds);
      } catch (e) {
        this.log("killAgents on abandon failed", { err: String(e) });
      }
    }
    await this.transition(mission, "abandoned", {
      abandonedReason: reason ?? "user_abandoned",
    });
    await this.deps.store.appendTimelineEvent(missionId, {
      ts: this.now(),
      type: "mission.paused",
      payload: { kind: "abandoned", reason: reason ?? null },
    });
  }

  /** 미션을 명시적으로 sleeping 상태로. UI ⏸️ Pause 버튼이 이걸 호출. */
  async pause(missionId: string): Promise<void> {
    const mission = await this.requireMission(missionId);
    if (mission.status !== "active") return;
    await this.transition(mission, "sleeping");
    await this.deps.store.appendTimelineEvent(missionId, {
      ts: this.now(),
      type: "mission.paused",
      payload: { kind: "paused_by_user" },
    });
  }

  /** UI / wiring 종료 시 호출. event bus 구독 해제. */
  dispose(): void {
    this.unsubscribe();
  }

  // ──────────────────────────── internals ────────────────────────────

  private async onEvent(event: MissionEngineEvent): Promise<void> {
    const mission = await this.deps.store.getMission(event.missionId);
    if (!mission || isTerminalMission(mission.status)) return;

    await this.deps.store.appendTimelineEvent(event.missionId, {
      ts: this.now(),
      type: mapEventToTimeline(event.type),
      payload: event.payload,
    });

    if (
      mission.status === "sleeping" ||
      mission.status === "waiting_for_human"
    ) {
      await this.transition(mission, "active");
    }
    this.scheduleAdvance(event.missionId);
  }

  // 한 미션에 동시에 advance 1개만 돌도록 보호. event flood / resume 중복 호출
  // 시 race 방지.
  private scheduleAdvance(missionId: string): void {
    if (this.inFlight.has(missionId)) return;
    this.inFlight.add(missionId);
    this.runAdvanceLoop(missionId).finally(() => {
      this.inFlight.delete(missionId);
    });
  }

  private async runAdvanceLoop(missionId: string): Promise<void> {
    // 한 step 이 끝나면 다음 step 으로 즉시 진입 — 단 transition 결과가
    // active 가 아니면 (sleeping / waiting_for_human / terminal) 멈춘다.
    for (let safety = 0; safety < 100; safety += 1) {
      const mission = await this.deps.store.getMission(missionId);
      if (!mission) return;
      if (mission.status !== "active") return;
      const proceeded = await this.advanceStep(mission);
      if (!proceeded) return;
    }
    this.log("advance loop safety cap hit", { missionId });
  }

  /** 한 step 을 실행. true 면 다음 step 으로 계속, false 면 루프 종료. */
  private async advanceStep(mission: Mission): Promise<boolean> {
    if (mission.currentStepIndex >= mission.steps.length) {
      await this.completeMission(mission);
      return false;
    }

    const step = mission.steps[mission.currentStepIndex];
    if (step.status === "success" || step.status === "skipped") {
      await this.deps.store.updateMission(mission.id, {
        currentStepIndex: mission.currentStepIndex + 1,
      });
      return true;
    }

    const startedAt = this.now();
    await this.deps.store.updateMissionStep(mission.id, step.index, {
      status: "running",
      startedAt,
      error: undefined,
    });
    await this.deps.store.appendTimelineEvent(mission.id, {
      ts: startedAt,
      type: "step.started",
      payload: {
        index: step.index,
        type: step.type,
        skill: step.skill ?? null,
        attempt: (step.retryCount ?? 0) + 1,
      },
    });

    const result = await executeStep(mission, step, {
      skillRunner: this.deps.skillRunner,
      dispatcher: this.deps.dispatcher,
      fixRunner: this.deps.fixRunner,
    });

    // wait step pending → sleeping 전환 (retry 아님)
    if (
      step.type === "wait" &&
      !result.success &&
      result.error === WAIT_PENDING
    ) {
      await this.deps.store.updateMissionStep(mission.id, step.index, {
        status: "pending",
        startedAt: undefined,
      });
      await this.transition(mission, "sleeping");
      await this.deps.store.appendTimelineEvent(mission.id, {
        ts: this.now(),
        type: "mission.paused",
        payload: {
          kind: "sleeping",
          reason: "wait_for_tasks",
          statuses: (result.output as { statuses?: unknown })?.statuses ?? {},
        },
      });
      return false;
    }

    // dispatch 성공 → taskIds 누적
    if (step.type === "dispatch" && result.success) {
      const output = result.output as { taskIds?: string[] } | undefined;
      const newTaskIds = output?.taskIds ?? [];
      if (newTaskIds.length > 0) {
        const fresh = await this.requireMission(mission.id);
        await this.deps.store.updateMission(mission.id, {
          taskIds: [...fresh.taskIds, ...newTaskIds],
        });
        for (const taskId of newTaskIds) {
          await this.deps.store.appendTimelineEvent(mission.id, {
            ts: this.now(),
            type: "agent.dispatched",
            payload: { taskId },
          });
        }
      }
    }

    if (result.success) {
      return this.markSuccessAndAdvance(mission, step.index, result.output);
    }
    return this.handleFailure(mission, step.index, result.error);
  }

  private async markSuccessAndAdvance(
    mission: Mission,
    stepIndex: number,
    output: unknown,
  ): Promise<boolean> {
    const completedAt = this.now();
    const step = mission.steps[stepIndex];
    await this.deps.store.updateMissionStep(mission.id, stepIndex, {
      status: "success",
      output,
      completedAt,
      error: undefined,
    });
    await this.deps.store.appendTimelineEvent(mission.id, {
      ts: completedAt,
      type: "step.completed",
      payload: {
        index: stepIndex,
        type: step.type,
        skill: step.skill ?? null,
      },
    });
    const fresh = await this.requireMission(mission.id);
    if (fresh.currentStepIndex + 1 >= fresh.steps.length) {
      await this.deps.store.updateMission(mission.id, {
        currentStepIndex: fresh.currentStepIndex + 1,
      });
      await this.completeMission(fresh);
      return false;
    }
    await this.deps.store.updateMission(mission.id, {
      currentStepIndex: fresh.currentStepIndex + 1,
    });
    return true;
  }

  private async handleFailure(
    mission: Mission,
    stepIndex: number,
    error: string | undefined,
  ): Promise<boolean> {
    const step = mission.steps[stepIndex];
    const policy = step.onFailure ?? "retry";
    const currentRetries = step.retryCount ?? 0;
    const completedAt = this.now();

    // continue 정책 — 실패해도 skip 하고 다음 step
    if (policy === "continue") {
      await this.deps.store.updateMissionStep(mission.id, stepIndex, {
        status: "skipped",
        error,
        completedAt,
      });
      await this.deps.store.appendTimelineEvent(mission.id, {
        ts: completedAt,
        type: "step.failed",
        payload: { index: stepIndex, error, policy: "continue" },
      });
      const fresh = await this.requireMission(mission.id);
      await this.deps.store.updateMission(mission.id, {
        currentStepIndex: fresh.currentStepIndex + 1,
      });
      return true;
    }

    // retry 정책 — maxRetries 이내면 즉시 재시도
    if (policy === "retry" && currentRetries < this.maxRetries) {
      await this.deps.store.updateMissionStep(mission.id, stepIndex, {
        status: "pending",
        retryCount: currentRetries + 1,
        error,
        startedAt: undefined,
      });
      await this.deps.store.appendTimelineEvent(mission.id, {
        ts: completedAt,
        type: "step.failed",
        payload: {
          index: stepIndex,
          error,
          attempt: currentRetries + 1,
          willRetry: true,
        },
      });
      return true; // 즉시 다음 iteration 에서 재실행
    }

    // escalate (또는 retry exhausted) → waiting_for_human + 알림 카드 (UI Step 4)
    await this.deps.store.updateMissionStep(mission.id, stepIndex, {
      status: "failed",
      error,
      completedAt,
    });
    await this.deps.store.appendTimelineEvent(mission.id, {
      ts: completedAt,
      type: "step.failed",
      payload: {
        index: stepIndex,
        error,
        policy: policy === "retry" ? "retry_exhausted" : "escalate",
        notifyUser: true,
      },
    });
    await this.transition(mission, "waiting_for_human");
    return false;
  }

  private async completeMission(mission: Mission): Promise<void> {
    const completedAt = this.now();
    await this.transition(mission, "completed", { completedAt });
    await this.deps.store.appendTimelineEvent(mission.id, {
      ts: completedAt,
      type: "supervisor.note",
      payload: {
        message: "Mission completed",
        templateLabel: MISSION_TEMPLATES[mission.templateId]?.label,
      },
    });
  }

  private async transition(
    mission: Mission,
    next: MissionStatus,
    extras?: { completedAt?: Date; abandonedReason?: string },
  ): Promise<void> {
    if (mission.status === next) return;
    assertMissionTransition(mission.status, next);
    await this.deps.store.setMissionStatus(mission.id, next, extras);
  }

  private async requireMission(missionId: string): Promise<Mission> {
    const m = await this.deps.store.getMission(missionId);
    if (!m) throw new Error(`Mission not found: ${missionId}`);
    return m;
  }
}

function mapEventToTimeline(t: MissionEngineEvent["type"]): TimelineEventType {
  switch (t) {
    case "task.status_changed":
      return "agent.completed";
    case "agent.stuck":
      return "agent.stuck";
    case "agent.completed":
      return "agent.completed";
    case "user.input_received":
      return "user.input";
    case "mission.wakeup_request":
      return "mission.resumed";
    default:
      return "supervisor.note";
  }
}

// re-exports
export {
  MISSION_TEMPLATES,
  getTemplate,
  instantiateSteps,
  listTemplates,
} from "./templates";
export {
  assertMissionTransition,
  isValidMissionTransition,
  isTerminalMission,
  TERMINAL_STATUSES,
} from "./state-machine";
export { InProcessMissionEventBus } from "./event-handler";
export type {
  MissionEngineDeps,
  MissionEngineEvent,
  MissionEngineEventType,
  MissionStore,
  TaskDispatcher,
  TaskStatusLite,
  SkillRunner,
  SkillResult,
  FixRunner,
  OrchestratorRef,
  OrchestratorRegistry,
  MissionEventBus,
  MissionEventHandler,
} from "./ports";
export { ALLOWED_SKILLS, isAllowedSkill } from "./types";
export type {
  AllowedSkill,
  Mission,
  MissionStep,
  MissionStepFailurePolicy,
  MissionStepStatus,
  MissionStepType,
  MissionStatus,
  MissionTemplateId,
  TimelineEvent,
  TimelineEventType,
} from "./types";
export type { MissionTemplate } from "./templates";
export type { StepResult, ExecutorDeps } from "./step-executor";
export { WAIT_PENDING, executeStep } from "./step-executor";
