import type {
  MissionEngineEvent,
  MissionStore,
  OrchestratorRegistry,
} from "./ports";

// Conductor (지휘자) — B안(orchestrator-driven mission) 의 운전 위임 계층.
// 설계: v3/docs/MISSIONS-B-ORCHESTRATOR-DRIVEN.md §3.2 / §8.
//
// A안(현재·기본): MissionEngine 이 결정적 advance-loop 로 미션을 직접 운전한다.
// B안: 미션 오케스트레이터(Claude 세션)가 스텝 *안* 을 자율 운전하고, 얇은
//      지휘자(Conductor)는 스텝 *사이* 의 순서·품질 게이트만 보장한다
//      ("스텝 안은 오케의 자율, 스텝 사이는 지휘자의 결정성" — §3.2).
//
// 이 파일은 그 전환의 **Phase 1 안전 기반**이다:
//   1) MISSION_DRIVER 플래그 (engine | orchestrator) — 기본 engine 이라 A 동작 불변.
//   2) ConductorDriver 인터페이스 골격 (grantStep / verifyGate / onStepReport ...).
//   3) no-op + log 스텁 구현 (createConductorDriver).
// 실제 게이트 검증·스텝 권한 부여·타임라인 합성은 Phase 2~3 에서 채운다.

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

/**
 * Conductor 가 의존하는 포트. 진실원(missions/*) 은 store, 오케스트레이터 세션
 * 제어(스텝 권한 주입)는 orchestrators 로 한다 — A안 엔진과 동일 인프라 재사용.
 */
export interface ConductorDriverDeps {
  store: MissionStore;
  orchestrators: OrchestratorRegistry;
  logger?: (msg: string, meta?: Record<string, unknown>) => void;
}

/**
 * 지휘자 인터페이스 (B안). MissionEngine 이 orchestrator 모드일 때 advance-loop
 * 대신 이 드라이버로 운전을 위임한다. Phase 1 에선 모든 메서드가 스텁이다.
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
   * (§8.4). 게이트 미통과면 보류하고 사용자 개입을 요청할 수 있다.
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

/**
 * Phase 1 스텁 Conductor — 모든 메서드가 no-op + log.
 * orchestrator 모드여도 미션이 실제로 진행되지 않는다 (의도된 동작; 실제 운전은
 * Phase 2~3 에서 grantStep/verifyGate/onStepReport 를 채우며 활성화). 기본 driver
 * 가 engine 이라 이 스텁은 명시적으로 orchestrator 를 켜야만 생성·호출된다.
 */
export function createConductorDriver(
  deps: ConductorDriverDeps,
): ConductorDriver {
  const log =
    deps.logger ??
    ((m: string, meta?: Record<string, unknown>) =>
      console.log(`[Conductor] ${m}`, meta ?? ""));

  log("created (Phase 1 스텁 — no-op; 실제 게이트/운전은 Phase 2~3 에서 구현)");

  return {
    requestAdvance(missionId: string): void {
      log(
        "requestAdvance — stub no-op (Phase 2: grantStep 으로 현재 스텝 허가)",
        {
          missionId,
        },
      );
    },

    async grantStep(missionId: string, stepIndex: number): Promise<void> {
      log("grantStep — stub no-op", { missionId, stepIndex });
    },

    async onStepReport(report: StepReport): Promise<void> {
      log("onStepReport — stub no-op", {
        missionId: report.missionId,
        stepIndex: report.stepIndex,
        status: report.status,
      });
    },

    async verifyGate(
      missionId: string,
      stepIndex: number,
    ): Promise<GateResult> {
      log("verifyGate — stub (게이트 검증 미구현, 보류 반환)", {
        missionId,
        stepIndex,
      });
      return {
        passed: false,
        reason: "conductor stub — gate verification not implemented (Phase 2)",
      };
    },

    async onEvent(event: MissionEngineEvent): Promise<void> {
      log("onEvent — stub no-op", {
        type: event.type,
        missionId: event.missionId,
      });
    },

    dispose(): void {
      log("dispose — stub");
    },
  };
}
