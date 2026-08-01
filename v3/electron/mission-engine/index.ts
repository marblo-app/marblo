import type {
  Mission,
  MissionLaunchTemplateId,
  MissionStatus,
  MissionTemplateId,
  TimelineEventType,
} from "./types";
import type { MissionEngineDeps, MissionEngineEvent } from "./ports";
import { assertMissionTransition, isTerminalMission } from "./state-machine";
import { executeStep, WAIT_PENDING } from "./step-executor";
import {
  findTemplate,
  instantiateSteps,
  MISSION_TEMPLATES,
  getTemplate,
} from "./templates";
import { verifyStepGate } from "./gates";
import {
  createConductorDriver,
  getMissionDriver,
  type ConductorDriver,
  type MissionDriver,
} from "./conductor-driver";

// MissionEngine — 미션 라이프사이클을 책임지는 코어.
// 명세: v3/docs/MISSIONS-SPEC.md §7.
//
// 의존성은 ports 인터페이스로만 받는다 (테스트 가능).
// 실제 wiring (Firestore missionService / OrchestratorManager / AgentManager /
// run_skill MCP) 은 Step 5 main.ts 에서.

const DEFAULT_MAX_RETRIES = 2; // D10: 1-2회 retry 후 알림 카드

/**
 * MissionEngine 생성 옵션 — B안(orchestrator-driven) 운전 토글.
 * 미지정 시 driver 는 env(getMissionDriver) 에서 읽고 기본 'engine' (A안 불변).
 * conductor 미지정 + driver='orchestrator' 면 엔진이 deps 로 스텁을 자체 조립한다.
 */
export interface MissionEngineOptions {
  driver?: MissionDriver;
  conductor?: ConductorDriver;
}

export class MissionEngine {
  private readonly maxRetries: number;
  private readonly now: () => Date;
  private readonly log: (msg: string, meta?: Record<string, unknown>) => void;
  private readonly inFlight: Set<string> = new Set();
  private readonly unsubscribe: () => void;
  // B안 운전 토글. 'engine'(기본) = 아래 advance-loop 가 운전(A안). 'orchestrator'
  // = 미션 오케스트레이터가 운전 + conductor 가 게이트 보장(B안). Phase 1 에선
  // conductor 가 스텁이라 orchestrator 모드는 실제 진행을 하지 않는다(의도).
  private readonly missionDriver: MissionDriver;
  private readonly conductor: ConductorDriver | null;

  constructor(
    private readonly deps: MissionEngineDeps,
    options?: MissionEngineOptions
  ) {
    this.maxRetries = deps.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.now = deps.now ?? (() => new Date());
    this.log =
      deps.logger ??
      ((m, meta) => console.log(`[MissionEngine] ${m}`, meta ?? ""));
    // driver 결정 — 명시 옵션 > env > 기본 'engine'. orchestrator 인데 conductor
    // 가 주입 안 됐으면 엔진이 스텁을 자체 조립(테스트/직접생성 경로 대비).
    this.missionDriver = options?.driver ?? getMissionDriver();
    this.conductor =
      options?.conductor ??
      (this.missionDriver === "orchestrator"
        ? createConductorDriver({
            store: deps.store,
            orchestrators: deps.orchestrators,
            eventBus: deps.eventBus,
            // wait 게이트용 task 상태 조회 — dispatcher 헬퍼 재사용.
            getTaskStatuses: (taskIds) =>
              deps.dispatcher.getTaskStatuses(taskIds),
            maxRetries: this.maxRetries,
            notifier: deps.notifier,
            now: this.now,
            logger: this.log,
            // 통합(P2-B): gates.ts 의 결정적 게이트 주입.
            verifyStepGate,
          })
        : null);
    if (this.missionDriver !== "engine") {
      this.log(
        `driver=${this.missionDriver} (B안 orchestrator-driven — Phase 1 스텁, 실제 미진행)`
      );
    }
    this.unsubscribe = deps.eventBus.on((event) =>
      this.onEvent(event).catch((err) =>
        this.log("event handler error", { err: String(err), event })
      )
    );
  }

  // ──────────────────────────── public API ────────────────────────────

  async launch(input: {
    projectId: string;
    goal: string;
    templateId: MissionLaunchTemplateId;
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
        `Cannot resume terminal mission ${missionId} (status=${mission.status})`
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
   * 앱 재시작 후 in-flight (active / sleeping) 미션을 끊김없이 이어 진행한다.
   * 엔진은 부팅 시 in-memory 상태가 없으므로, Firestore 에 status="running" 으로
   * 남은 step 은 "직전 실행 중 크래시" 를 의미한다. 멈추지 않고 이어가되, 이미 만든
   * task 가 있으면 재연결해 중복 생성을 막는다(멱등 복구). step type 별:
   *   - gstack: 오케스트레이터 세션은 resume 으로 컨텍스트가 이어지므로 "pending"
   *     으로 되돌려 같은 세션에서 재실행.
   *   - dispatch: 이미 만든 task 가 있으면(findMissionTaskIds) taskIds 에 재연결 +
   *     step 을 success 로 마감(중복 dispatch 방지). 없으면 깨끗이 재실행.
   *   - fix: fix-runner 자체가 멱등(기존 task 재연결)이라 그대로 재실행 → 재연결.
   *   - wait: taskIds 폴링만 하므로 그대로 재개(안전).
   * 정말로 한 곳에서 멈추면 미션은 active 로 남아, 사용자가 PTY 패널에서 직접
   * 이어가거나 Resume 으로 개입할 수 있다(human-in-the-loop fallback 유지).
   */
  // 사용자가 명시적으로 ⏸️Pause 한 미션과 wait-step 대기(sleeping) 를 구분한다.
  // 둘 다 status="sleeping" 으로 저장되므로(pause()/wait 모두 transition→"sleeping"),
  // 마지막 paused/resumed timeline 이벤트의 kind 로 판별한다. paused_by_user 면
  // 앱 재시작 시 자동 복구하지 않는다(유저 의도 보존).
  private isPausedByUser(mission: Mission): boolean {
    for (let i = mission.contextLog.length - 1; i >= 0; i--) {
      const ev = mission.contextLog[i];
      if (ev.type === "mission.resumed") return false;
      if (ev.type === "mission.paused") {
        return ev.payload?.kind === "paused_by_user";
      }
    }
    return false;
  }

  async recoverInFlight(missionId: string): Promise<void> {
    const mission = await this.requireMission(missionId);
    if (isTerminalMission(mission.status)) return;
    // 유저가 일시정지한 미션은 자동 재개 금지 — wait-step sleeping 만 복구한다.
    if (mission.status === "sleeping" && this.isPausedByUser(mission)) {
      this.log("recover: skipping user-paused mission", { missionId });
      return;
    }
    const idx = mission.currentStepIndex;
    const step = mission.steps[idx];
    if (step && step.status === "running") {
      if (step.type === "dispatch") {
        // 이미 dispatch 된 task 가 있으면 재연결 (중복 dispatch 방지).
        const reconnected = await this.reconnectDispatchStepToExistingTasks(
          mission.id,
          idx
        );
        if (!reconnected) {
          await this.deps.store.updateMissionStep(mission.id, idx, {
            status: "pending",
            startedAt: undefined,
            error: undefined,
          });
        }
      } else {
        // gstack / fix: pending 으로 되돌려 재실행. fix-runner 는 멱등 재연결,
        // gstack 은 resume 된 오케스트레이터 세션에서 같은 컨텍스트로 재실행.
        await this.deps.store.updateMissionStep(mission.id, idx, {
          status: "pending",
          startedAt: undefined,
          liveOutput: undefined,
          error: undefined,
        });
        this.log("recover: reset running step → pending (idempotent re-run)", {
          missionId,
          stepIndex: idx,
          stepType: step.type,
          skill: step.skill ?? null,
        });
      }
      // wait: 그대로 두고 resume → runWait 가 기존 taskIds 를 재폴링(안전).
    }
    await this.resume(missionId);
  }

  /**
   * "running" 으로 남은 dispatch step 을 이미 만들어진 task 에 멱등 재연결한다.
   * recover(부팅) 경로와 live advanceStep 의 running 가드가 공유하는 단일 중복-
   * dispatch 차단 지점. dispatch 는 부작용(task 생성)이 있어 무턱대고 재실행하면
   * 6-7 중복이 되므로, findMissionTaskIds 로 이미 만든 비종료 task 가 있으면
   * taskIds 에 병합(Set dedup) + step 을 success 로 마감하고 true 를 반환한다.
   * 만들어진 task 가 없으면(=실제로 아무것도 dispatch 안 됨) false 를 반환해
   * caller 가 깨끗이 재실행하게 둔다.
   */
  private async reconnectDispatchStepToExistingTasks(
    missionId: string,
    stepIndex: number
  ): Promise<boolean> {
    const existing = await this.deps.dispatcher.findMissionTaskIds(missionId);
    if (existing.length === 0) return false;
    const fresh = await this.requireMission(missionId);
    const merged = Array.from(new Set([...fresh.taskIds, ...existing]));
    await this.deps.store.updateMission(missionId, { taskIds: merged });
    await this.deps.store.updateMissionStep(missionId, stepIndex, {
      status: "success",
      completedAt: this.now(),
      liveOutput: undefined,
      error: undefined,
    });
    await this.deps.store.appendTimelineEvent(missionId, {
      ts: this.now(),
      type: "mission.resumed",
      payload: {
        message: `reconnected to ${existing.length} dispatched task(s) (dup-dispatch guard)`,
        stepIndex,
      },
    });
    this.log("reconnected dispatch step to existing tasks", {
      missionId,
      stepIndex,
      taskCount: existing.length,
    });
    return true;
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
    await this.notifyOrchestratorMissionStopped(mission, "abandoned", reason);
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
    await this.notifyOrchestratorMissionStopped(mission, "paused");
  }

  /**
   * pause/abandon 시 미션 owner orchestrator(미션 PTY)에게 안내 메시지를 주입한다.
   * 진행 중이던 gstack step 의 Claude 세션이 미션이 멈췄음을 알고 현재 작업을 멈추게
   * 한다. 메시지는 여러 줄(상태 + 안내)이라, raw write 로 보내면 첫 줄바꿈에서
   * 조기 제출돼 composer 에 깨져 들어간다(줄마다 별도 입력으로 쪼개짐). 그래서
   * OrchestratorRef.postMessage 로 보낸다 — 내부적으로 PtyManager.writeAndSubmit 이
   * bracketed-paste(ESC[200~ … ESC[201~)로 감싸 한 덩어리로 붙여넣고 끝에 단일 CR 로
   * 제출하므로 멀티라인이 그대로 한 메시지로 들어간다.
   *
   * best-effort: 살아있는 owner 세션이 없거나 주입이 실패해도 미션 상태 전이를
   * 막지 않는다. ensureSession(launch 유발) 대신 getSession 으로 기존 세션만 본다.
   */
  private async notifyOrchestratorMissionStopped(
    mission: Mission,
    kind: "paused" | "abandoned",
    reason?: string
  ): Promise<void> {
    try {
      const ref = this.deps.orchestrators.getSession(
        mission.ownerOrchestratorSessionId
      );
      if (!ref || !ref.isAlive()) return;
      const header =
        kind === "abandoned"
          ? `🛑 [Marblo Mission] 이 미션이 중단되었습니다${
              reason ? ` (사유: ${reason})` : ""
            }.`
          : `⏸️ [Marblo Mission] 이 미션이 일시정지되었습니다.`;
      const body =
        kind === "abandoned"
          ? `미션 "${mission.goal}" 은(는) 더 이상 진행되지 않습니다. 진행 중이던 작업이 있다면 중단하고 마무리해 주세요. (재개하려면 사용자가 새 미션을 시작합니다.)`
          : `미션 "${mission.goal}" 의 자동 진행이 멈췄습니다. 진행 중이던 작업이 있다면 중단해 주세요. 사용자가 Resume 을 누르면 다음 단계부터 다시 진행됩니다.`;
      await ref.postMessage(`${header}\n${body}`);
    } catch (e) {
      this.log("notifyOrchestratorMissionStopped failed", {
        missionId: mission.id,
        kind,
        err: String(e),
      });
    }
  }

  /** UI / wiring 종료 시 호출. event bus 구독 해제. */
  dispose(): void {
    this.unsubscribe();
    this.conductor?.dispose();
  }

  // ──────────────────────────── internals ────────────────────────────

  private async onEvent(event: MissionEngineEvent): Promise<void> {
    const mission = await this.deps.store.getMission(event.missionId);
    if (!mission || isTerminalMission(mission.status)) return;

    // 유저가 ⏸️ Pause 한 미션은 task.status_changed / agent idle 같은 이벤트로
    // 자동 재개하지 않는다. recoverInFlight(부팅 복구)엔 동일 가드가 있었지만
    // 런타임 event 경로(onEvent)엔 없어, paused_by_user 미션도 event-forwarder /
    // forwardAgentStatus 신호가 오면 active 로 깨어나 버렸다. 같은 가드를 여기에도
    // 적용해 일시정지 의도를 보존한다. (명시적 재개는 resume() — onEvent 우회.)
    // append 보다 먼저 return 해 paused 미션 timeline 에 무시할 이벤트를 남기지 않고,
    // mission.resumed 로 매핑되는 이벤트가 isPausedByUser 판정을 흐리는 것도 막는다.
    if (mission.status === "sleeping" && this.isPausedByUser(mission)) {
      this.log("onEvent: skipping user-paused mission", {
        missionId: event.missionId,
        eventType: event.type,
      });
      return;
    }

    // B안(orchestrator-driven): 외부 이벤트(스텝완료 보고 'mission.step_reported'
    // 포함)는 지휘자가 **자체 버스 구독**으로 직접 처리한다(createConductorDriver 가
    // deps.eventBus 를 구독). 엔진의 이 핸들러는 orchestrator 모드에서 no-op —
    // 같은 이벤트를 conductor 로 이중 전달하지 않는다(같은 버스를 둘 다 구독하므로).
    // 기본 driver='engine' 이면 이 분기를 타지 않아 A안 경로가 불변.
    if (this.missionDriver === "orchestrator") {
      return;
    }

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
    // B안(orchestrator-driven): 엔진 advance-loop 대신 지휘자(Conductor)에 운전을
    // 위임한다. launch / resume / onEvent 의 운전 트리거가 모두 여기로 모이므로
    // 분기점이 하나로 충분하다. Phase 1 에선 conductor 가 스텁(no-op + log)이라
    // 실제 진행은 아직 일어나지 않는다(의도). 기본 driver='engine'(아래 경로 불변).
    if (this.missionDriver === "orchestrator") {
      this.conductor?.requestAdvance(missionId);
      return;
    }
    if (this.inFlight.has(missionId)) return;
    this.inFlight.add(missionId);
    // advance 루프가 reject 하면(예: dispatch 성공 후 taskIds/timeline write 중
    // throw) step 이 "running"으로 남고 inFlight 만 풀린다. .finally 만 있으면
    // unhandled rejection 으로 조용히 묻혀 stall 지점을 못 짚는다. .catch 로
    // 로깅해 가시화한다 — 재진입 시엔 advanceStep 의 running 가드가 멱등 처리.
    this.runAdvanceLoop(missionId)
      .catch((err) =>
        this.log("advance loop error", { missionId, err: String(err) })
      )
      .finally(() => {
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

    // 멱등 가드: step 이 "running" 인데 advance 루프가 (inFlight 로 직렬화돼) 새로
    // 진입했다는 건, 직전 실행이 success 마킹에 도달하기 전에 끊겼다는 뜻이다 —
    // 예: dispatch 성공 후 taskIds 누적/timeline write 중 throw, 혹은 앱 크래시 직후.
    // 가드가 없으면 아래에서 step 을 다시 "running" 으로 쓰고 executeStep 을 재실행 →
    // dispatch 가 task 를 또 만들어 6-7 중복 + 영구 stall 이 된다(이 버그의 근본원인).
    // recover(부팅) 경로와 동일한 멱등 처리로 막는다.
    if (step.status === "running") {
      if (step.type === "dispatch") {
        const reconnected = await this.reconnectDispatchStepToExistingTasks(
          mission.id,
          step.index
        );
        // 재연결됨 → success 마킹됨. 다음 iteration 의 success 가드가 인덱스를
        // 전진시켜 wait step 으로 넘어간다(중복 dispatch 없이).
        if (reconnected) return true;
        // 만들어진 task 가 없다 → 깨끗이 재실행해도 중복이 아니다(아래 reset 으로 낙하).
      }
      // dispatch(빈) / gstack / fix / wait — pending 으로 되돌려 다음 iteration 에서
      // 재실행. gstack=resume 세션 재실행, fix=fix-runner 멱등 재연결, wait=폴링이라
      // 안전. (라이브 재진입 시점의 "running" 은 항상 직전 실행이 끊긴 것이지,
      // 동시 실행이 아니다 — inFlight 가 advance 루프를 직렬화하기 때문.)
      await this.deps.store.updateMissionStep(mission.id, step.index, {
        status: "pending",
        startedAt: undefined,
        liveOutput: undefined,
        error: undefined,
      });
      this.log("advance: reset orphaned running step → pending", {
        missionId: mission.id,
        stepIndex: step.index,
        stepType: step.type,
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
          })
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

    // dispatch 성공 → taskIds 누적 (Set dedup — runDispatch 가 멱등 재사용으로
    // 기존 taskIds 를 그대로 돌려줄 수 있어, 이미 들어있는 id 가 중복되지 않게 한다).
    if (step.type === "dispatch" && result.success) {
      const output = result.output as { taskIds?: string[] } | undefined;
      const newTaskIds = output?.taskIds ?? [];
      if (newTaskIds.length > 0) {
        const fresh = await this.requireMission(mission.id);
        const existingSet = new Set(fresh.taskIds);
        const merged = Array.from(new Set([...fresh.taskIds, ...newTaskIds]));
        await this.deps.store.updateMission(mission.id, { taskIds: merged });
        for (const taskId of newTaskIds) {
          if (existingSet.has(taskId)) continue; // 이미 기록된 dispatch 는 재기록 안 함
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
        result.userInputDetected
      );
    }
    return this.handleFailure(mission, step.index, result.error);
  }

  private async markSuccessAndAdvance(
    mission: Mission,
    stepIndex: number,
    output: unknown,
    userInputDetected?: string
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
    error: string | undefined
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
          6
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
                    -1200
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
        templateLabel: findTemplate(mission.templateId)?.label,
        synthesisPath: synthesisPath ?? null,
        // 파일 읽기 없이도 Firestore 만으로 보고서 미리보기 가능하도록 4000자 보관.
        synthesisExcerpt: synthesisNote ? synthesisNote.slice(-4000) : null,
      },
    });
  }

  private async transition(
    mission: Mission,
    next: MissionStatus,
    extras?: { completedAt?: Date; abandonedReason?: string }
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
export {
  createConductorDriver,
  getMissionDriver,
  MISSION_STEP_REPORTED_EVENT,
} from "./conductor-driver";
export type {
  ConductorDriver,
  ConductorDriverDeps,
  GateResult,
  MissionDriver,
  StepGateContext,
  StepReport,
  VerifyStepGate,
} from "./conductor-driver";
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
