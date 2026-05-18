import type {
  MissionEngineEvent,
  MissionEventBus,
  MissionEventHandler,
} from "./ports";

// 단순 in-process pub/sub. Step 5 main.ts wiring 시 agent-manager /
// orchestrator-manager 의 이벤트를 이 bus 로 forwarding 하게 된다.
// 멀티-프로세스 환경이 필요하면 같은 인터페이스로 IPC bus 로 교체 가능.

export class InProcessMissionEventBus implements MissionEventBus {
  private handlers: Set<MissionEventHandler> = new Set();

  on(handler: MissionEventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  emit(event: MissionEngineEvent): void {
    // 핸들러 throw 가 다른 핸들러를 막지 않도록 격리.
    for (const handler of [...this.handlers]) {
      try {
        const r = handler(event);
        if (r instanceof Promise) {
          r.catch((err) =>
            console.error(
              "[MissionEventBus] async handler error",
              { type: event.type, missionId: event.missionId },
              err,
            ),
          );
        }
      } catch (err) {
        console.error(
          "[MissionEventBus] handler error",
          { type: event.type, missionId: event.missionId },
          err,
        );
      }
    }
  }

  // 테스트 보조
  size(): number {
    return this.handlers.size;
  }
}
