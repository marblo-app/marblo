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
  ptyManager: PtyManager;
  bridgePort: () => number;
  // launch 시 cwd — Step 5b 단계에선 projectRoot env 만 활용. 정식 구현은
  // renderer 에서 받은 rootPath 를 전달.
  defaultRootPath?: string;
}

export function createOrchestratorRegistry(
  deps: OrchestratorRegistryDeps
): OrchestratorRegistry {
  function refFor(
    sessionId: string,
    manager: OrchestratorManager
  ): OrchestratorRef {
    return {
      sessionId,
      isAlive: () => manager.isRunning(),
      postMessage: async (message: string) => {
        const session = manager.getSession();
        if (!session) {
          throw new Error("orchestrator session not running");
        }
        deps.ptyManager.writeAndSubmit(session.ptySessionId, message);
      },
    };
  }

  function ensureSession(input: {
    missionId: string;
    projectId: string;
  }): Promise<OrchestratorRef> {
    let manager = deps.orchestrators.get(input.projectId);
    if (!manager) {
      manager = deps.createInstance(input.projectId);
      deps.orchestrators.set(input.projectId, manager);
    }

    let session = manager.getSession();
    if (!manager.isRunning() || !session) {
      // 살아있지 않으면 launch. rootPath 는 env 또는 default 사용.
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
