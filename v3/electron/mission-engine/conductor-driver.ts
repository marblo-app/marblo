import type { Mission, MissionStatus, MissionStep } from "./types";
import type {
  MissionEngineEvent,
  MissionEventBus,
  MissionNotifier,
  MissionStore,
  OrchestratorRegistry,
  TaskStatusLite,
} from "./ports";
import { assertMissionTransition, isTerminalMission } from "./state-machine";

// Conductor (지휘자) — B안(orchestrator-driven mission) 의 운전 위임 계층.
// 설계: v3/docs/MISSIONS-B-ORCHESTRATOR-DRIVEN.md §3.2 / §5.1 / §8.
//
// A안(현재·기본): MissionEngine 이 결정적 advance-loop 로 미션을 직접 운전한다.
// B안: 미션 오케스트레이터(Claude 세션)가 스텝 *안* 을 자율 운전하고, 얇은
//      지휘자(Conductor)는 스텝 *사이* 의 순서·품질 게이트만 보장한다
//      ("스텝 안은 오케의 자율, 스텝 사이는 지휘자의 결정성" — §3.2).
//
// ── Phase 2 (이 파일): 실제 운전 루프 ──
//   requestAdvance → grantStep(현재 스텝만 오케에 허가) → (오케가 작업 후
//   mission_step_done MCP 호출) → 'mission.step_reported' 이벤트 → onStepReport
//   → 게이트 검증(verifyStepGate) → pass 면 다음 스텝 허가, fail 면 retry/escalate.
//   진실원(missions/*)·상태머신은 지휘자가 계속 소유(A안 인프라 재사용).
//
// ★계약 (다른 에이전트가 만드는 파일과는 import/이벤트로만 연동):
//   - P2-B `gates.ts` : `verifyStepGate(step, { getTaskStatuses, mission })
//       => Promise<{pass, reason?}>`. 통합 시 ConductorDriverDeps.verifyStepGate
//       로 주입. 미주입이면 내장 deterministic 기본 게이트로 폴백한다(아래).
//   - P2-C `mcp-server/tools.ts` : `mission_step_done` MCP 가 MissionEventBus 로
//       `{ type: 'mission.step_reported', missionId, payload: {stepIndex, result} }`
//       를 emit. Conductor 는 그 이벤트를 구독해 onStepReport 로 처리한다.

/**
 * 미션 운전 주체.
 *   - `engine`       : A안 — MissionEngine advance-loop 가 운전 (기본). 6월 런칭 경로.
 *   - `orchestrator` : B안 — 미션 오케스트레이터가 운전 + Conductor 가 게이트 보장.
 */
export type MissionDriver = "engine" | "orchestrator";

const DEFAULT_DRIVER: MissionDriver = "engine";

/**
 * 환경변수에서 미션 드라이버를 읽는다. 기본은 `engine` (A안, 회귀 0).
 * `orchestrator` 로 **정확히** 일치할 때만 B안으로 전환 — 오타/미설정/빈 값은 모두
 * 안전하게 engine 으로 떨어진다. main 프로세스라 process.env 를 읽으며,
 * 렌더러 측 설정과의 호환을 위해 VITE_ prefix 도 fallback 으로 본다.
 */
export function getMissionDriver(): MissionDriver {
  const raw = (
    process.env.MISSION_DRIVER ??
    process.env.VITE_MISSION_DRIVER ??
    DEFAULT_DRIVER
  )
    .trim()
    .toLowerCase();
  return raw === "orchestrator" ? "orchestrator" : DEFAULT_DRIVER;
}

/** 오케스트레이터 → 지휘자 스텝완료 보고 (§8.4 보고 채널). */
export interface StepReport {
  missionId: string;
  stepIndex: number;
  /** 오케스트레이터가 보고한 스텝 결과. */
  status: "success" | "failed";
  /** 게이트 검증에 쓰일 산출물 요약 (예: PR URL, review 통과 여부). */
  output?: unknown;
  error?: string;
}

/** 게이트 검증 결과 — 결정적 코드로 평가 (§5.1). */
export interface GateResult {
  /** 게이트 통과 시 다음 스텝 진행 허가. */
  passed: boolean;
  /** 미통과/보류 사유 (타임라인·디버깅용). */
  reason?: string;
}

/** P2-B `gates.ts` 의 verifyStepGate 가 받는 컨텍스트 (§5.1). */
export interface StepGateContext {
  /**
   * 미션이 거느린 task 들의 상태 일괄 조회 — wait 게이트가 "전부 DONE" 판정에 사용.
   * 기존 dispatcher.getTaskStatuses 를 재사용해 주입한다.
   */
  getTaskStatuses: (
    taskIds: string[],
  ) => Promise<Record<string, TaskStatusLite>>;
  /** 게이트 평가 시점의 미션 스냅샷 (taskIds / 직전 step output 등). */
  mission: Mission;
}

/**
 * 스텝 게이트 검증 함수 — **P2-B `gates.ts` 와의 계약**.
 * `gates.ts` 가 `export async function verifyStepGate(step, ctx)` 형태로 구현하며,
 * 통합(오케) 시 ConductorDriverDeps.verifyStepGate 로 주입된다. 미주입 시 Conductor
 * 는 내장 deterministic 기본 게이트(defaultStepGate)로 폴백한다.
 *
 * 격리 워크트리에서는 `gates.ts` 가 아직 없으므로 정적 `import` 대신 이 타입 계약 +
 * 주입으로 연동한다(빌드/타입 회귀 0). 시그니처는 계약 그대로:
 *   verifyStepGate(step, { getTaskStatuses, mission }) => { pass, reason? }
 */
export type VerifyStepGate = (
  step: MissionStep,
  ctx: StepGateContext,
) => Promise<{ pass: boolean; reason?: string }>;

/**
 * 오케스트레이터 → 지휘자 스텝완료 보고를 실어 나르는 MissionEventBus 이벤트 타입.
 * P2-C `mcp-server/tools.ts` 의 `mission_step_done` MCP 가 이 type 으로 emit:
 *   { type: 'mission.step_reported', missionId, payload: { stepIndex, result } }
 * (result = { status, output?, error? }). MissionEngineEventType(ports.ts) 의
 * 별개 layer 라, Conductor 는 String 비교로 방어적으로 narrow 한다.
 */
export const MISSION_STEP_REPORTED_EVENT = "mission.step_reported";

/**
 * Conductor 가 의존하는 포트. 진실원(missions/*) 은 store, 오케스트레이터 세션
 * 제어(스텝 권한 주입)는 orchestrators, 보고/wakeup 수신은 eventBus 로 한다 —
 * A안 엔진과 동일 인프라 재사용.
 */
export interface ConductorDriverDeps {
  store: MissionStore;
  orchestrators: OrchestratorRegistry;
  /** 스텝완료 보고('mission.step_reported') + 외부 wakeup 이벤트 구독 채널. */
  eventBus: MissionEventBus;
  /** wait 게이트용 task 상태 조회 — dispatcher.getTaskStatuses 재사용해 주입. */
  getTaskStatuses: (
    taskIds: string[],
  ) => Promise<Record<string, TaskStatusLite>>;
  /**
   * P2-B `gates.ts` 의 게이트 검증기. 통합 시
   *   `import { verifyStepGate } from "./gates"` 로 주입.
   * 미주입 시 내장 deterministic 기본 게이트(defaultStepGate) 폴백.
   */
  verifyStepGate?: VerifyStepGate;
  /** 실패 정책 retry 한도 (engine 과 동일 default 2 — D10). */
  maxRetries?: number;
  /** escalate / 사용자 개입 필요 시 호출 (engine 과 동일 알림 채널). */
  notifier?: MissionNotifier;
  now?: () => Date;
  logger?: (msg: string, meta?: Record<string, unknown>) => void;
}

/**
 * 지휘자 인터페이스 (B안). MissionEngine 이 orchestrator 모드일 때 advance-loop
 * 대신 이 드라이버로 운전을 위임한다.
 */
export interface ConductorDriver {
  /**
   * 미션 운전 시작/재개 — 현재 스텝 진행을 오케스트레이터에 허가하는 진입점.
   * A안 `MissionEngine.scheduleAdvance` 의 B안 대응 (launch / resume 가 호출).
   */
  requestAdvance(missionId: string): void;

  /**
   * 현재 스텝 진행 권한을 오케스트레이터에 **한 번에 하나** 부여한다 (§3.2/§5.1).
   * 오케스트레이터는 이 스텝만 진행하고, 끝나면 onStepReport 로 보고한다.
   */
  grantStep(missionId: string, stepIndex: number): Promise<void>;

  /**
   * 오케스트레이터의 스텝완료 보고 처리 → 게이트 검증 후 다음 스텝 허가 또는 보류
   * (§8.4). 게이트 미통과면 보류하고 retry/escalate.
   */
  onStepReport(report: StepReport): Promise<void>;

  /**
   * 스텝 게이트 검증 — 결정적 (예: wait=task 전부 DONE, ship=PR URL 존재) (§5.1).
   * LLM 자율에 맡기지 않고 코드로 보장한다.
   */
  verifyGate(missionId: string, stepIndex: number): Promise<GateResult>;

  /**
   * 외부 이벤트(agent.completed 등) wakeup → 다음 게이트 평가 (§3 이벤트 wakeup).
   * A안에서 onEvent → scheduleAdvance 였던 경로의 B안 대응.
   */
  onEvent(event: MissionEngineEvent): Promise<void>;

  /** 구독/타이머 정리. MissionEngine.dispose 에서 호출. */
  dispose(): void;
}

const PR_URL_RE = /https?:\/\/\S+/;

/**
 * 내장 기본 게이트 — §5.1 결정적 예시. P2-B gates.ts 미주입 시 폴백한다.
 *   - wait  : mission.taskIds 가 전부 DONE 이어야 통과 (미완료 task 있으면 보류).
 *   - /ship : 스텝 output 에 PR URL 이 있어야 통과.
 *   - 그 외  : 오케스트레이터의 성공 보고를 신뢰(통과).
 */
const defaultStepGate: VerifyStepGate = async (step, ctx) => {
  if (step.type === "wait") {
    const ids = ctx.mission.taskIds ?? [];
    if (ids.length === 0) return { pass: true };
    const statuses = await ctx.getTaskStatuses(ids);
    const notDone = ids.filter((id) => statuses[id] !== "DONE");
    if (notDone.length > 0) {
      return {
        pass: false,
        reason: `wait gate: ${notDone.length}/${ids.length} task(s) not DONE`,
      };
    }
    return { pass: true };
  }
  if (step.type === "gstack" && step.skill === "/ship") {
    const out =
      typeof step.output === "string"
        ? step.output
        : step.output != null
          ? JSON.stringify(step.output)
          : "";
    if (PR_URL_RE.test(out)) return { pass: true };
    return {
      pass: false,
      reason: "ship gate: PR URL not found in step output",
    };
  }
  return { pass: true };
};

/**
 * Phase 2 Conductor — orchestrator-driven 운전 루프.
 * 기본 driver 가 engine 이라 명시적으로 orchestrator 를 켜야만 생성·호출된다.
 */
export function createConductorDriver(
  deps: ConductorDriverDeps,
): ConductorDriver {
  const log =
    deps.logger ??
    ((m: string, meta?: Record<string, unknown>) =>
      console.log(`[Conductor] ${m}`, meta ?? ""));
  const now = deps.now ?? (() => new Date());
  const maxRetries = deps.maxRetries ?? 2;
  const verify: VerifyStepGate = deps.verifyStepGate ?? defaultStepGate;

  // ── 미션별 작업 직렬화 ──
  // 이벤트 폭주(task.status_changed 버스트)나 launch + 이벤트 동시 도착 시
  // 동시 grant / 중복 advance race 를 막는다. engine 의 inFlight Set 과 같은 의도.
  const chains = new Map<string, Promise<unknown>>();
  function enqueue(missionId: string, fn: () => Promise<void>): Promise<void> {
    const prev = chains.get(missionId) ?? Promise.resolve();
    // then(fn, fn): 직전 작업이 성공/실패든 다음 작업을 실행(큐가 막히지 않게).
    const next = prev
      .then(fn, fn)
      .catch((err) =>
        log("mission chain error", { missionId, err: String(err) }),
      );
    chains.set(missionId, next);
    void next.finally(() => {
      if (chains.get(missionId) === next) chains.delete(missionId);
    });
    return next;
  }

  // ──────────────────────────── 운전 루프 ────────────────────────────

  // 현재 스텝 진행을 오케에 허가하는 진입점. 미션이 active 가 아니면(planning 외)
  // 진행하지 않는다 — paused/escalate(sleeping/waiting_for_human)는 resume 으로만 깨움.
  async function advance(missionId: string): Promise<void> {
    const mission = await deps.store.getMission(missionId);
    if (!mission || isTerminalMission(mission.status)) return;
    if (mission.status !== "active") {
      log("advance skipped — mission not active", {
        missionId,
        status: mission.status,
      });
      return;
    }
    if (mission.currentStepIndex >= mission.steps.length) {
      await completeMission(missionId);
      return;
    }
    await grantStep(missionId, mission.currentStepIndex);
  }

  async function grantStep(
    missionId: string,
    stepIndex: number,
  ): Promise<void> {
    const mission = await deps.store.getMission(missionId);
    if (!mission || isTerminalMission(mission.status)) return;
    const step = mission.steps[stepIndex];
    if (!step) {
      log("grantStep — step out of range", { missionId, stepIndex });
      return;
    }

    // running 마킹 + step.started 타임라인. 이미 running 이면(중복 grant) 같은 허가를
    // 오케에 두 번 주입하지 않는다 — 중복 grant 는 조용히 무시.
    if (step.status === "running") {
      log("grantStep — step already running, skip re-grant", {
        missionId,
        stepIndex,
      });
      return;
    }
    const startedAt = now();
    await deps.store.updateMissionStep(missionId, stepIndex, {
      status: "running",
      startedAt,
      error: undefined,
    });
    await deps.store.appendTimelineEvent(missionId, {
      ts: startedAt,
      type: "step.started",
      payload: {
        index: stepIndex,
        type: step.type,
        skill: step.skill ?? null,
        attempt: (step.retryCount ?? 0) + 1,
        driver: "orchestrator",
      },
    });

    // 미션 오케 PTY 에 '현재 스텝만' 허가 메시지 주입 (best-effort).
    const ref = deps.orchestrators.getSession(
      mission.ownerOrchestratorSessionId,
    );
    if (!ref || !ref.isAlive()) {
      log("grantStep — no live owner orchestrator session (best-effort skip)", {
        missionId,
        stepIndex,
        sessionId: mission.ownerOrchestratorSessionId,
      });
      return;
    }
    const label = step.skill ?? step.type;
    try {
      await ref.postMessage(
        `【Marblo Mission】 현재 스텝 ${stepIndex}: ${label} 만 진행하세요. 끝나면 mission_step_done 을 호출해 보고하세요. 다음 스텝으로 스스로 넘어가지 마세요.`,
      );
      log("grantStep — granted to orchestrator", {
        missionId,
        stepIndex,
        label,
      });
    } catch (err) {
      log("grantStep — postMessage failed (best-effort)", {
        missionId,
        stepIndex,
        err: String(err),
      });
    }
  }

  async function onStepReport(report: StepReport): Promise<void> {
    const mission = await deps.store.getMission(report.missionId);
    if (!mission || isTerminalMission(mission.status)) {
      log("onStepReport — mission missing/terminal, ignored", {
        missionId: report.missionId,
        stepIndex: report.stepIndex,
      });
      return;
    }
    // active 가 아니면(예: 사용자 pause → sleeping, escalate → waiting_for_human)
    // 뒤늦은/잘못된 보고이므로 무시. resume 이 운전을 다시 잡는다.
    if (mission.status !== "active") {
      log("onStepReport — mission not active, ignored", {
        missionId: report.missionId,
        status: mission.status,
        stepIndex: report.stepIndex,
      });
      return;
    }
    const idx = mission.currentStepIndex;
    // 한 번에 하나만 허가하므로 현재 스텝과 다른 보고는 stale/중복 → 무시.
    if (report.stepIndex !== idx) {
      log("onStepReport — stale step report ignored", {
        missionId: report.missionId,
        reported: report.stepIndex,
        current: idx,
      });
      return;
    }

    if (report.status === "failed") {
      await handleStepFailure(
        report.missionId,
        idx,
        report.error ?? "orchestrator reported step failure",
      );
      return;
    }

    // 성공 보고 → output 반영 후 게이트 검증 (게이트가 step.output 을 읽음).
    if (report.output !== undefined) {
      await deps.store.updateMissionStep(report.missionId, idx, {
        output: report.output,
      });
    }
    const gate = await verifyGateInternal(report.missionId, idx);
    if (!gate.passed) {
      await deps.store.appendTimelineEvent(report.missionId, {
        ts: now(),
        type: "supervisor.note",
        payload: {
          message: `gate held at step ${idx}: ${gate.reason ?? "(no reason)"}`,
          index: idx,
          kind: "gate_failed",
        },
      });
      // 게이트 미통과 = 보고는 성공이라 했지만 결정적 검증이 거부 → 실패와 동일하게
      // retry(재허가)/escalate. 다음 스텝으로 절대 넘기지 않는다(§5.1 핵심).
      await handleStepFailure(
        report.missionId,
        idx,
        `gate not passed: ${gate.reason ?? ""}`,
      );
      return;
    }

    await passStepAndAdvance(report.missionId, idx);
  }

  // 현재 스텝을 success 마킹하고 다음 스텝 허가(또는 미션 완료). gate pass 후 +
  // 외부 이벤트로 wait 게이트가 충족됐을 때 공유하는 단일 전진 지점.
  async function passStepAndAdvance(
    missionId: string,
    stepIndex: number,
  ): Promise<void> {
    await markStepSuccess(missionId, stepIndex);
    const fresh = await deps.store.getMission(missionId);
    if (!fresh) return;
    const nextIdx = stepIndex + 1;
    await deps.store.updateMission(missionId, { currentStepIndex: nextIdx });
    if (nextIdx >= fresh.steps.length) {
      await completeMission(missionId);
    } else {
      await grantStep(missionId, nextIdx);
    }
  }

  async function markStepSuccess(
    missionId: string,
    stepIndex: number,
  ): Promise<void> {
    const mission = await deps.store.getMission(missionId);
    const step = mission?.steps[stepIndex];
    const completedAt = now();
    await deps.store.updateMissionStep(missionId, stepIndex, {
      status: "success",
      completedAt,
      error: undefined,
      liveOutput: undefined,
    });
    await deps.store.appendTimelineEvent(missionId, {
      ts: completedAt,
      type: "step.completed",
      payload: {
        index: stepIndex,
        type: step?.type ?? null,
        skill: step?.skill ?? null,
        driver: "orchestrator",
      },
    });
  }

  // 실패(보고 실패 또는 게이트 미통과) 처리 — engine.handleFailure 정책 미러:
  //   continue → skip + 다음 스텝, retry(한도 내) → 같은 스텝 재허가,
  //   escalate/retry 소진 → waiting_for_human + 알림.
  async function handleStepFailure(
    missionId: string,
    stepIndex: number,
    error: string,
  ): Promise<void> {
    const mission = await deps.store.getMission(missionId);
    if (!mission || isTerminalMission(mission.status)) return;
    const step = mission.steps[stepIndex];
    if (!step) return;
    const policy = step.onFailure ?? "retry";
    const retries = step.retryCount ?? 0;
    const completedAt = now();

    if (policy === "continue") {
      await deps.store.updateMissionStep(missionId, stepIndex, {
        status: "skipped",
        error,
        completedAt,
        liveOutput: undefined,
      });
      await deps.store.appendTimelineEvent(missionId, {
        ts: completedAt,
        type: "step.failed",
        payload: {
          index: stepIndex,
          error,
          policy: "continue",
          driver: "orchestrator",
        },
      });
      const nextIdx = stepIndex + 1;
      await deps.store.updateMission(missionId, { currentStepIndex: nextIdx });
      if (nextIdx >= mission.steps.length) {
        await completeMission(missionId);
      } else {
        await grantStep(missionId, nextIdx);
      }
      return;
    }

    if (policy === "retry" && retries < maxRetries) {
      await deps.store.updateMissionStep(missionId, stepIndex, {
        status: "pending",
        retryCount: retries + 1,
        error,
        startedAt: undefined,
        liveOutput: undefined,
      });
      await deps.store.appendTimelineEvent(missionId, {
        ts: completedAt,
        type: "step.failed",
        payload: {
          index: stepIndex,
          error,
          attempt: retries + 1,
          willRetry: true,
          driver: "orchestrator",
        },
      });
      // 같은 스텝을 다시 허가 — 오케가 재시도(pending → grantStep 이 running 재마킹).
      await grantStep(missionId, stepIndex);
      return;
    }

    // escalate (또는 retry 소진) → waiting_for_human + 알림 카드.
    await deps.store.updateMissionStep(missionId, stepIndex, {
      status: "failed",
      error,
      completedAt,
      liveOutput: undefined,
    });
    await deps.store.appendTimelineEvent(missionId, {
      ts: completedAt,
      type: "step.failed",
      payload: {
        index: stepIndex,
        error,
        policy: policy === "retry" ? "retry_exhausted" : "escalate",
        notifyUser: true,
        driver: "orchestrator",
      },
    });
    deps.notifier?.({
      missionId,
      projectId: mission.projectId,
      goal: mission.goal,
      kind: "escalate",
      question: error ? `단계 실패: ${error}` : undefined,
      skill: step.skill ?? null,
    });
    await transition(missionId, mission.status, "waiting_for_human");
    notifyOrchestrator(
      mission,
      `⏸️ [Marblo Mission] 스텝 ${stepIndex} (${
        step.skill ?? step.type
      }) 에서 사용자 확인을 기다립니다: ${error}`,
    );
  }

  async function completeMission(missionId: string): Promise<void> {
    const mission = await deps.store.getMission(missionId);
    if (!mission || isTerminalMission(mission.status)) return;
    const completedAt = now();
    await transition(missionId, mission.status, "completed", { completedAt });
    await deps.store.appendTimelineEvent(missionId, {
      ts: completedAt,
      type: "supervisor.note",
      payload: {
        message: "Mission completed (orchestrator-driven)",
        driver: "orchestrator",
      },
    });
    notifyOrchestrator(
      mission,
      `✅ [Marblo Mission] 모든 스텝이 끝나 미션이 완료되었습니다.`,
    );
  }

  // best-effort 안내 주입 — 살아있는 owner 세션이 없거나 실패해도 상태 전이를 막지
  // 않는다. fire-and-forget (상태 전이 흐름을 blocking 하지 않음).
  function notifyOrchestrator(mission: Mission, message: string): void {
    const ref = deps.orchestrators.getSession(
      mission.ownerOrchestratorSessionId,
    );
    if (!ref || !ref.isAlive()) return;
    void ref.postMessage(message).catch((err) =>
      log("notifyOrchestrator failed (best-effort)", {
        missionId: mission.id,
        err: String(err),
      }),
    );
  }

  async function transition(
    missionId: string,
    fromStatus: MissionStatus,
    next: MissionStatus,
    extras?: { completedAt?: Date; abandonedReason?: string },
  ): Promise<void> {
    if (fromStatus === next) return;
    assertMissionTransition(fromStatus, next);
    await deps.store.setMissionStatus(missionId, next, extras);
  }

  async function verifyGateInternal(
    missionId: string,
    stepIndex: number,
  ): Promise<GateResult> {
    const mission = await deps.store.getMission(missionId);
    if (!mission) return { passed: false, reason: "mission not found" };
    const step = mission.steps[stepIndex];
    if (!step) return { passed: false, reason: "step out of range" };
    try {
      const r = await verify(step, {
        getTaskStatuses: deps.getTaskStatuses,
        mission,
      });
      return { passed: r.pass, reason: r.reason };
    } catch (err) {
      // 게이트가 throw 하면 통과시키지 않는다(결정성 우선) — 보류로 처리.
      return { passed: false, reason: `gate threw: ${String(err)}` };
    }
  }

  async function onEvent(event: MissionEngineEvent): Promise<void> {
    // 스텝완료 보고가 onEvent 로 직접 들어온 경우(방어적 라우팅) → onStepReport 위임.
    if (String(event.type) === MISSION_STEP_REPORTED_EVENT) {
      await onStepReport(parseStepReport(event));
      return;
    }
    // 외부 wakeup (agent.completed / task.status_changed 등): 현재 스텝이 wait 이고
    // running 이면 게이트를 재평가해, 오케의 명시 보고 없이도 task 완료로 진행될 수
    // 있게 한다 (§3 이벤트 wakeup). 그 외 스텝은 오케 보고(onStepReport)로만 전진.
    const mission = await deps.store.getMission(event.missionId);
    if (!mission || mission.status !== "active") return;
    const idx = mission.currentStepIndex;
    const step = mission.steps[idx];
    if (!step || step.type !== "wait" || step.status !== "running") return;
    const gate = await verifyGateInternal(event.missionId, idx);
    if (gate.passed) {
      log("onEvent — wait gate satisfied by external event, advancing", {
        missionId: event.missionId,
        stepIndex: idx,
        eventType: event.type,
      });
      await passStepAndAdvance(event.missionId, idx);
    }
  }

  function parseStepReport(event: MissionEngineEvent): StepReport {
    const payload = (event.payload ?? {}) as {
      stepIndex?: unknown;
      result?: { status?: unknown; output?: unknown; error?: unknown };
    };
    const result = payload.result ?? {};
    return {
      missionId: event.missionId,
      stepIndex: Number(payload.stepIndex ?? -1),
      status: result.status === "failed" ? "failed" : "success",
      output: result.output,
      error: typeof result.error === "string" ? result.error : undefined,
    };
  }

  // ── 보고/wakeup 수신: MissionEventBus 'mission.step_reported' 구독 (★계약) ──
  // 같은 버스를 엔진도 구독하지만, orchestrator 모드에선 엔진 onEvent 가 no-op 라
  // (index.ts) 이중 처리는 없다. enqueue 로 미션별 직렬화.
  const unsubscribe = deps.eventBus.on((event) =>
    enqueue(event.missionId, () =>
      String(event.type) === MISSION_STEP_REPORTED_EVENT
        ? onStepReport(parseStepReport(event))
        : onEvent(event),
    ),
  );

  log("created (Phase 2 — orchestrator-driven 운전 루프 활성)");

  return {
    requestAdvance(missionId: string): void {
      void enqueue(missionId, () => advance(missionId));
    },
    grantStep,
    onStepReport,
    async verifyGate(
      missionId: string,
      stepIndex: number,
    ): Promise<GateResult> {
      return verifyGateInternal(missionId, stepIndex);
    },
    onEvent,
    dispose(): void {
      unsubscribe();
      chains.clear();
      log("disposed");
    },
  };
}
