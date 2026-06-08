import type { AgentManager } from "../agent-manager";
import type {
  DispatchTaskRequest,
  DispatchTaskResponse,
} from "../bridge-server";
import type { OrchestratorManager } from "../orchestrator-manager";
import type { PtyManager } from "../pty-manager";
import type { TaskDecomposer } from "../orchestrator/task-decomposer";
import { MissionEngine, InProcessMissionEventBus } from "./index";
import type { MissionNotifier } from "./ports";
import { getMissionFirebaseApp } from "./firebase-app";
import { createMissionStore } from "./store-impl";
import { createTaskDispatcher } from "./dispatcher-impl";
import { createSkillRunner } from "./skill-runner-impl";
import { createPtySkillRunner } from "./pty-skill-runner-impl";
import { createFixRunner } from "./fix-runner-impl";
import { createOrchestratorRegistry } from "./orch-registry-impl";
import { MissionEventForwarder } from "./event-forwarder";

// MissionEngine 팩토리 — main.ts wiring 진입점.
//
// 호출자 (main.ts) 는 이 한 함수만 호출하고 반환된 engine / forwarder /
// pickupPlanningMissions 만 사용하면 된다. ports 구현체들은 wire 내부에서
// 조립.

export interface BuildMissionEngineDeps {
  agentManager: AgentManager;
  // Lazy 게터 — dispatch 시점에 호출되어 키 없이도 앱이 시작될 수 있게 한다.
  // (TaskDecomposer 생성자는 LLM 키가 없으면 throw.)
  taskDecomposer: () => TaskDecomposer;
  orchestrators: Map<string, OrchestratorManager>;
  createOrchestratorInstance: (projectId: string) => OrchestratorManager;
  // main.ts 가 제공하는 미션 오케스트레이터 단일 launch 경로 — forwarding(PTY
  // 출력 → renderer) + kind 별 resume + rootPath 해석을 포함한다. 미션 엔진의
  // ensureSession 이 이걸 통해 launch 해야 PTY 패널에 출력이 흐르고 재시작 후
  // 세션이 이어진다. 미지정 시 registry 가 자체 launch(테스트 fallback).
  ensureOrchestratorLaunched?: (projectId: string) => OrchestratorManager;
  // 미션이 사용자 개입을 요구할 때 OS 알림 / 인앱으로 surface. 미지정 시 no-op.
  notifier?: MissionNotifier;
  ptyManager: PtyManager;
  bridgePort: () => number;
  dispatchOne: (params: DispatchTaskRequest) => DispatchTaskResponse;
}

export interface BuiltMissionEngine {
  engine: MissionEngine;
  eventBus: InProcessMissionEventBus;
  forwarder: MissionEventForwarder;
  /**
   * app.whenReady 이후 호출 — status='planning' 미션을 engine 에 픽업시킨다.
   * 초기 1회 startup 조회 + 이후 Firestore 구독으로 런타임 신규 planning 미션도 자동 픽업.
   */
  pickupPlanningMissions: () => Promise<void>;
  /** AgentManager.onStatusChange 안에서 호출 — agent 상태 변화를 미션으로 forward. */
  forwardAgentStatus: (agentId: string, status: string) => void;
  /** app shutdown 시 호출. */
  dispose: () => void;
}

export function buildMissionEngine(
  deps: BuildMissionEngineDeps,
): BuiltMissionEngine {
  const { app, authReady } = getMissionFirebaseApp();
  const eventBus = new InProcessMissionEventBus();

  const store = createMissionStore({ app, authReady });
  const dispatcher = createTaskDispatcher({
    app,
    authReady,
    decomposer: deps.taskDecomposer,
    agentManager: deps.agentManager,
    dispatchOne: deps.dispatchOne,
  });
  const fixRunner = createFixRunner({
    app,
    authReady,
    dispatchOne: deps.dispatchOne,
  });
  const orchRegistry = createOrchestratorRegistry({
    orchestrators: deps.orchestrators,
    createInstance: deps.createOrchestratorInstance,
    ensureLaunched: deps.ensureOrchestratorLaunched,
    ptyManager: deps.ptyManager,
    bridgePort: deps.bridgePort,
  });
  // SkillRunner: env flag 로 PTY routing 또는 legacy headless spawn 선택.
  // 기본은 PTY (사용자 가시성 + 빌링 안전).
  const useHeadlessSkillRunner = process.env.MARBLO_SKILL_RUNNER === "headless";
  const skillRunner = useHeadlessSkillRunner
    ? createSkillRunner({})
    : createPtySkillRunner({
        orchestrators: orchRegistry,
        ptyManager: deps.ptyManager,
      });
  console.log(
    `[MissionEngine] skill runner mode: ${
      useHeadlessSkillRunner ? "headless" : "pty"
    }`,
  );

  const engine = new MissionEngine({
    store,
    dispatcher,
    skillRunner,
    fixRunner,
    eventBus,
    orchestrators: orchRegistry,
    notifier: deps.notifier,
  });

  const forwarder = new MissionEventForwarder({ app, authReady, eventBus });

  // Planning 미션 픽업 — UI 가 status='planning' 으로 만들어 둔 미션을 engine.resume
  // 으로 이어 받는다. 1회 startup 조회 후 onSnapshot 으로 런타임 신규 mission 도 자동 픽업.
  // resume 은 inFlight set 으로 중복 호출 방지하므로 (initial getDocs + onSnapshot
  // added 이벤트가 동일 doc 으로 두 번 들어와도) 안전.
  let planningUnsub: (() => void) | null = null;
  const pickedUp = new Set<string>();

  async function pickupPlanningMissions(): Promise<void> {
    await authReady;
    if (planningUnsub) return; // idempotent — 두 번 호출돼도 한 번만 구독
    try {
      const { getFirestore, collection, query, where, onSnapshot, getDocs } =
        await import("firebase/firestore");
      const db = getFirestore(app);

      // 1회성 in-flight 복구 — 앱이 꺼질 때 active/sleeping 이던 미션을 이어서
      // 진행한다. recoverInFlight 가 step type 별로 안전 처리(gstack 재실행 /
      // wait 폴링 / fix·dispatch 는 중복 생성 방지 위해 사용자 확인). planning 은
      // 아래 구독이 처리하므로 제외, waiting_for_human 은 사용자 답 대기라 제외.
      for (const status of ["active", "sleeping"] as const) {
        try {
          const snap = await getDocs(
            query(collection(db, "missions"), where("status", "==", status)),
          );
          for (const d of snap.docs) {
            if (pickedUp.has(d.id)) continue;
            pickedUp.add(d.id);
            console.log(
              `[MissionEngine] recovering in-flight mission ${d.id} (status=${status})`,
            );
            engine.recoverInFlight(d.id).catch((err) => {
              pickedUp.delete(d.id);
              console.error(
                "[MissionEngine] in-flight recovery failed",
                d.id,
                err,
              );
            });
          }
        } catch (err) {
          console.warn(
            `[MissionEngine] in-flight (${status}) recovery query failed:`,
            err,
          );
        }
      }

      const q = query(
        collection(db, "missions"),
        where("status", "==", "planning"),
      );
      planningUnsub = onSnapshot(
        q,
        (snap) => {
          console.log(
            `[MissionEngine] planning snapshot: size=${snap.size} changes=${
              snap.docChanges().length
            }`,
          );
          for (const change of snap.docChanges()) {
            if (change.type === "removed") {
              pickedUp.delete(change.doc.id);
              continue;
            }
            const id = change.doc.id;
            if (pickedUp.has(id)) continue;
            pickedUp.add(id);
            console.log(
              `[MissionEngine] picking up planning mission ${id} (change=${change.type})`,
            );
            engine.resume(id).catch((err) => {
              pickedUp.delete(id); // 실패 시 다음 트리거에서 재시도 가능
              console.error("[MissionEngine] planning pickup failed", id, err);
            });
          }
        },
        (err) => console.warn("[MissionEngine] planning subscribe error:", err),
      );
      console.log("[MissionEngine] planning subscription started");
    } catch (err) {
      console.warn("[MissionEngine] planning pickup setup failed:", err);
    }
  }

  // Agent status → mission event 변환. agent 가 idle/stopped 로 전이하면 해당
  // 에이전트가 작업 중이던 task 가 끝났을 가능성이 높음 → 활성 미션에 신호.
  // 정확한 (taskId, missionId) 매핑은 forwarder 의 Firestore 구독이 잡지만
  // 같은 머신 안에서는 이 즉시 신호로 wait → active 전이가 더 빨라진다.
  function forwardAgentStatus(agentId: string, status: string): void {
    if (status !== "idle" && status !== "stopped") return;
    // 모든 활성 미션에 broadcast — engine.onEvent 가 mission 조회 후
    // sleeping 이면 active 로 깨움. 비활성/terminal 은 자체 가드로 무시.
    for (const missionId of forwarder.getActiveMissionIds()) {
      eventBus.emit({
        type: "agent.completed",
        missionId,
        payload: { agentId, status },
      });
    }
  }

  function dispose(): void {
    if (planningUnsub) {
      planningUnsub();
      planningUnsub = null;
    }
    forwarder.stop();
    engine.dispose();
  }

  return {
    engine,
    eventBus,
    forwarder,
    pickupPlanningMissions,
    forwardAgentStatus,
    dispose,
  };
}
