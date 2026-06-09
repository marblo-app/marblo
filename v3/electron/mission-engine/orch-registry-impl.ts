import type { OrchestratorManager } from "../orchestrator-manager";
import type { PtyManager } from "../pty-manager";
import type { OrchestratorRef, OrchestratorRegistry } from "./ports";

// 미션의 owner orchestrator 세션을 관리. 기존 main.ts 의 `orchestrators` Map +
// `createOrchestratorInstance` 를 ports 인터페이스 뒤에 두른다.
//
// ensureSession 의미:
//   - projectId 에 살아있는 orchestrator 가 있으면 reuse
//   - 없거나 죽었으면 createInstance(projectId) 호출
//   - 어느 쪽이든 OrchestratorRef 반환
//
// missionId 별 ownerOrchestratorSessionId 갱신은 caller (MissionEngine.launch)
// 책임. 여기서는 세션을 보장만 한다.

export interface OrchestratorRegistryDeps {
  orchestrators: Map<string, OrchestratorManager>;
  createInstance: (projectId: string) => OrchestratorManager;
  // main.ts 가 제공하는 단일 launch 경로. 있으면 ensureSession 은 직접 launch
  // 하지 않고 이걸 호출한다 — forwarding(PTY 출력 → renderer) + kind 별 resume +
  // rootPath 해석이 모두 여기에 모여 있어, 엔진이 패널보다 먼저 오케스트레이터를
  // 띄워도 PTY 패널이 빈 화면이 되지 않는다. 미지정 시 아래 자체 launch fallback
  // (forwarding 없음 — 주로 테스트용).
  ensureLaunched?: (
    projectId: string,
    missionId?: string,
  ) => OrchestratorManager;
  ptyManager: PtyManager;
  bridgePort: () => number;
  // launch 시 cwd — fallback 경로에서만 사용. 정식 구현은 ensureLaunched 가
  // renderer/appState 기반 rootPath 를 해석.
  defaultRootPath?: string;
}

export function createOrchestratorRegistry(
  deps: OrchestratorRegistryDeps,
): OrchestratorRegistry {
  function refFor(
    sessionId: string,
    manager: OrchestratorManager,
  ): OrchestratorRef {
    return {
      sessionId,
      get ptySessionId(): string | null {
        return manager.getSession()?.ptySessionId ?? null;
      },
      isAlive: () => manager.isRunning(),
      postMessage: async (message: string) => {
        const session = manager.getSession();
        if (!session) {
          throw new Error("orchestrator session not running");
        }
        // injectMessage 가 bootGate(부팅 제출 완료) 이후 + injectChain 직렬화로
        // 보낸다 — 부팅 프롬프트와 같은 PTY 동시 write(인터리브/Enter 유실) 방지.
        // 직접 writeAndSubmit 하면 첫 grant 가 부팅과 섞여 첫 스텝이 stall 한다.
        await manager.injectMessage(message);
      },
    };
  }

  function ensureSession(input: {
    missionId: string;
    projectId: string;
  }): Promise<OrchestratorRef> {
    // 정식 경로: main.ts 의 단일 launch 헬퍼. forwarding + resume + rootPath 를
    // 책임지고 살아있는 manager 를 반환한다.
    if (deps.ensureLaunched) {
      // missionId 를 함께 넘겨야 launch 가 "새 미션 = fresh, 같은 미션 = resume"
      // 를 결정할 수 있다 (없이 넘기면 직전 미션 세션을 무조건 resume 하는 옛 버그).
      const manager = deps.ensureLaunched(input.projectId, input.missionId);
      const session = manager.getSession();
      if (!session) {
        throw new Error(
          `mission orchestrator failed to launch (project=${input.projectId})`,
        );
      }
      return Promise.resolve(refFor(session.sessionId, manager));
    }

    // Fallback (테스트 / ensureLaunched 미주입): 직접 launch. forwarding 이 없어
    // PTY 출력이 renderer 로 가지 않지만, 엔진 로직 자체는 동작한다.
    let manager = deps.orchestrators.get(input.projectId);
    if (!manager) {
      manager = deps.createInstance(input.projectId);
      deps.orchestrators.set(input.projectId, manager);
    }

    let session = manager.getSession();
    if (!manager.isRunning() || !session) {
      const rootPath =
        deps.defaultRootPath ??
        process.env.MARBLO_PROJECT_ROOT ??
        process.cwd();
      session = manager.launch(input.projectId, rootPath, deps.bridgePort());
    }
    return Promise.resolve(refFor(session.sessionId, manager));
  }

  function getSession(sessionId: string): OrchestratorRef | null {
    for (const manager of deps.orchestrators.values()) {
      const s = manager.getSession();
      if (s?.sessionId === sessionId) return refFor(s.sessionId, manager);
    }
    return null;
  }

  return { ensureSession, getSession };
}
