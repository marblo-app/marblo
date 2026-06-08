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
    // planning: UI 에서 직접 doc 만 만든 미션을 engine 이 인계받는 경로.
    // sleeping / waiting_for_human: 일반 wake-up 경로.
    if (
      mission.status === "planning" ||
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

  /**
   * 앱 재시작 후 in-flight (active / sleeping) 미션을 안전하게 이어 진행한다.
   * 엔진은 부팅 시 in-memory 상태가 없으므로, Firestore 에 status="running" 으로
   * 남은 step 은 "직전 실행 중 크래시" 를 의미한다. step type 별로 다르게 처리:
   *   - gstack: 부수효과가 (대체로) 멱등 → "pending" 으로 되돌려 깨끗이 재실행.
   *   - wait: taskIds 폴링만 하므로 그대로 재개(안전).
   *   - fix / dispatch: 이미 task/agent 를 만들었을 수 있어 재실행 시 중복 생성
   *     (중복 PR/에이전트) 위험 → 자동 재구동하지 않고 waiting_for_human 으로
   *     멈춰 사용자가 확인 후 Resume 하게 한다.
   * 그 외(스텝 사이 sleeping 등) 는 일반 resume.
   */
  async recoverInFlight(missionId: string): Promise<void> {
    const mission = await this.requireMission(missionId);
    if (isTerminalMission(mission.status)) return;
    const idx = mission.currentStepIndex;
    const step = mission.steps[idx];
    if (step && step.status === "running") {
      if (step.type === "gstack") {
        await this.deps.store.updateMissionStep(mission.id, idx, {
          status: "pending",
          startedAt: undefined,
          liveOutput: undefined,
          error: undefined,
        });
        this.log("recover: reset running gstack step → pending", {
          missionId,
          stepIndex: idx,
          skill: step.skill ?? null,
        });
      } else if (step.type === "fix" || step.type === "dispatch") {
        await this.deps.store.appendTimelineEvent(mission.id, {
          ts: this.now(),
          type: "supervisor.note",
          payload: {
            message:
              "앱 재시작으로 이 단계가 중단되었습니다. 중복 실행(중복 PR/에이전트) 방지를 위해 진행 상황을 확인하고 Resume 하세요.",
            stepIndex: idx,
            stepType: step.type,
            notifyUser: true,
          },
        });
        if (mission.status !== "waiting_for_human") {
          await this.transition(mission, "waiting_for_human");
        }
        this.deps.notifier?.({
          missionId,
          projectId: mission.projectId,
          goal: mission.goal,
          kind: "escalate",
          question: "앱 재시작으로 단계가 중단됨 — 확인 후 Resume 하세요.",
          skill: step.skill ?? null,
        });
        this.log("recover: paused fix/dispatch step for human review", {
          missionId,
          stepIndex: idx,
          stepType: step.type,
        });
        return; // 자동 재구동 금지
      }
      // wait: 그대로 두고 resume → runWait 가 기존 taskIds 를 재폴링(안전).
    }
    await this.resume(missionId);
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

    // liveOutput write 는 step-executor 가 호출하는 throttle 된 콜백 안에서.
    // skill-runner 자체도 throttle 하지만 Firestore write 도 한 번 더 막아 cost 절감.
    const liveOutputThrottleMs = 1_500;
    let lastLiveWriteAt = 0;
    let lastLivePayload = "";
    const onProgress = (chunk: string) => {
      const now = Date.now();
      if (now - lastLiveWriteAt < liveOutputThrottleMs) return;
      if (chunk === lastLivePayload) return;
      lastLiveWriteAt = now;
      lastLivePayload = chunk;
      this.deps.store
        .updateMissionStep(mission.id, step.index, { liveOutput: chunk })
        .catch((err) =>
          this.log("liveOutput write failed", {
            err: String(err),
            missionId: mission.id,
            stepIndex: step.index,
          }),
        );
    };

    // 직전 success step (가까운 것부터) 의 output 을 컨텍스트로 활용.
    //   - gstack step: PTY 에 prelude 주입 → claude conversation 에 컨텍스트 연결
    //   - dispatch/fix step: 코딩 agent 의 task description / instruction 에 합쳐짐
    //   - wait step: 컨텍스트 의미 없음 (단순 polling)
    let chainPrelude: string | undefined;
    if (step.type !== "wait" && step.index > 0) {
      const prev = mission.steps
        .slice(0, step.index)
        .reverse()
        .find((s) => s.status === "success" && typeof s.output === "string");
      if (prev) {
        const outTail = (prev.output as string).slice(-2000);
        if (step.type === "gstack") {
          chainPrelude =
            `[Marblo Mission] 이전 step \`${
              prev.skill ?? prev.type
            }\` 결과 요약입니다.` +
            ` 다음 작업은 이 결과를 반영해서 진행해주세요. (긴 메시지는 한 줄로 ack 만 해도 OK.)\n\n` +
            `--- 직전 step 결과 (마지막 2000자) ---\n${outTail}\n--- end ---`;
        } else {
          // fix / dispatch — agent task description 에 임베드되므로 ack 요청 불필요.
          chainPrelude =
            `Previous step: ${prev.skill ?? prev.type}\n` + outTail;
        }
      }
    }

    const result = await executeStep(mission, step, {
      skillRunner: this.deps.skillRunner,
      dispatcher: this.deps.dispatcher,
      fixRunner: this.deps.fixRunner,
      onProgress,
      chainPrelude,
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
      return this.markSuccessAndAdvance(
        mission,
        step.index,
        result.output,
        result.userInputDetected,
      );
    }
    return this.handleFailure(mission, step.index, result.error);
  }

  private async markSuccessAndAdvance(
    mission: Mission,
    stepIndex: number,
    output: unknown,
    userInputDetected?: string,
  ): Promise<boolean> {
    const completedAt = this.now();
    const step = mission.steps[stepIndex];
    await this.deps.store.updateMissionStep(mission.id, stepIndex, {
      status: "success",
      output,
      completedAt,
      error: undefined,
      liveOutput: undefined,
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

    // PtySkillRunner 가 사용자 입력 요청 패턴을 감지한 경우:
    // step 은 success 로 마감하되, 다음 step 으로 advance 하지 않고 mission 을
    // waiting_for_human 으로 멈춤. 사용자가 PTY 에 직접 답하고 Resume 누르면
    // 다음 step 진행.
    if (userInputDetected) {
      await this.deps.store.appendTimelineEvent(mission.id, {
        ts: this.now(),
        type: "user.decision",
        payload: {
          kind: "pty_input_required",
          stepIndex,
          skill: step.skill ?? null,
          question: userInputDetected,
          notifyUser: true,
        },
      });
      // 능동 알림 — 사용자가 PTY 패널을 안 보고 있어도 미션이 답을 기다리는 걸 안다.
      this.deps.notifier?.({
        missionId: mission.id,
        projectId: mission.projectId,
        goal: mission.goal,
        kind: "pty_input_required",
        question: userInputDetected,
        skill: step.skill ?? null,
      });
      // currentStepIndex 는 advance 안 함 — Resume 후 같은 위치에서 시작.
      // 다음 step 으로 가야 하므로 advance 는 하되 mission 만 멈춤.
      const fresh = await this.requireMission(mission.id);
      const isLastStep = fresh.currentStepIndex + 1 >= fresh.steps.length;
      await this.deps.store.updateMission(mission.id, {
        currentStepIndex: fresh.currentStepIndex + 1,
      });
      if (isLastStep) {
        await this.completeMission(fresh);
      } else {
        await this.transition(fresh, "waiting_for_human");
      }
      return false;
    }

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
        liveOutput: undefined,
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
        liveOutput: undefined,
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
      liveOutput: undefined,
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
    // 능동 알림 — step 실패로 미션이 사용자 확인을 기다린다.
    this.deps.notifier?.({
      missionId: mission.id,
      projectId: mission.projectId,
      goal: mission.goal,
      kind: "escalate",
      question: error ? `단계 실패: ${error}` : undefined,
      skill: mission.steps[stepIndex]?.skill ?? null,
    });
    await this.transition(mission, "waiting_for_human");
    return false;
  }

  private async completeMission(mission: Mission): Promise<void> {
    // 최종 종합 보고서 생성 — completed 로 전이하기 전에. runRawMessage 가 가능한
    // skillRunner 일 때만 (PtySkillRunner). headless runner 는 skip.
    let synthesisNote: string | undefined;
    let synthesisPath: string | undefined;
    if (typeof this.deps.skillRunner.runRawMessage === "function") {
      try {
        // 미션 폴더 slug: 한글 / 영문 / 숫자 보존, 공백·특수문자는 - 로.
        const slug = mission.goal
          .replace(/[^\p{L}\p{N}\s-]/gu, "")
          .trim()
          .replace(/\s+/g, "-")
          .slice(0, 40)
          .replace(/-+$/, "");
        const folder = `docs/missions/${slug || "mission"}-${mission.id.slice(
          0,
          6,
        )}`;
        const summaryPath = `${folder}/SUMMARY.md`;
        const stepsSummary = mission.steps
          .filter((s) => s.status === "success" || s.status === "failed")
          .map((s) => {
            const idx = String(s.index + 1).padStart(2, "0");
            const skillSlug = (s.skill ?? s.type).replace(/^\//, "");
            const stepPath = `${folder}/${idx}-${skillSlug}.md`;
            return (
              `- Step ${s.index + 1} (${s.skill ?? s.type}): ${s.status}\n` +
              `  → 저장 경로: ${stepPath}\n` +
              (typeof s.output === "string"
                ? `  output (마지막 1200자):\n${(s.output as string).slice(
                    -1200,
                  )}\n`
                : "")
            );
          })
          .join("\n");
        const prompt =
          `[Marblo Mission Synthesis]\n` +
          `미션 "${mission.goal}" 의 모든 step 이 끝났습니다.\n` +
          `이제 단계별 결과 파일들과 종합 보고서를 작성해주세요.\n\n` +
          `폴더: ${folder}/\n` +
          `파일 구조:\n` +
          `  - 각 step 결과: {NN}-{skill}.md (e.g. 01-design-review.md)\n` +
          `  - 종합 보고서: SUMMARY.md\n\n` +
          `SUMMARY.md 에 포함할 내용:\n` +
          `- 미션 목표 / 템플릿\n` +
          `- 각 step 의 핵심 발견 요약 + 해당 step 파일 링크\n` +
          `- 통합 권고사항 / 액션 아이템\n` +
          `- (해당되면) 변경된 파일 / PR 링크\n\n` +
          `절차:\n` +
          `1. 폴더 생성 + 각 step 결과를 위 경로에 markdown 으로 저장 (아래 결과 활용)\n` +
          `2. SUMMARY.md 작성\n` +
          `3. 마지막 메시지로 정확히 "${summaryPath}" 한 줄만 출력\n\n` +
          `--- Step 결과 ---\n${stepsSummary}\n--- end ---`;

        const synth = await this.deps.skillRunner.runRawMessage({
          missionId: mission.id,
          projectId: mission.projectId,
          prompt,
          timeoutMs: 5 * 60 * 1000,
        });
        if (synth.success && typeof synth.output === "string") {
          synthesisNote = (synth.output as string).slice(-4000);
          // claude 가 마지막에 path 만 한 줄로 출력하도록 지시 → 가장 마지막 비어있지 않은
          // 줄에서 'docs/missions/' prefix 찾기.
          const lines = synthesisNote
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean);
          for (const l of [...lines].reverse()) {
            if (l.includes("docs/missions/")) {
              synthesisPath = l.replace(/[`"']/g, "").trim();
              break;
            }
          }
        }
      } catch (e) {
        this.log("synthesis failed", { err: String(e) });
      }
    }

    const completedAt = this.now();
    await this.transition(mission, "completed", { completedAt });
    await this.deps.store.appendTimelineEvent(mission.id, {
      ts: completedAt,
      type: "supervisor.note",
      payload: {
        message: synthesisPath
          ? `Mission completed · 종합 보고서: ${synthesisPath}`
          : synthesisNote
            ? "Mission completed · 종합 보고서 작성됨 (파일 경로 미확인)"
            : "Mission completed",
        templateLabel: MISSION_TEMPLATES[mission.templateId]?.label,
        synthesisPath: synthesisPath ?? null,
        // 파일 읽기 없이도 Firestore 만으로 보고서 미리보기 가능하도록 4000자 보관.
        synthesisExcerpt: synthesisNote ? synthesisNote.slice(-4000) : null,
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
  MissionNeedsInputNotice,
  MissionNotifier,
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
