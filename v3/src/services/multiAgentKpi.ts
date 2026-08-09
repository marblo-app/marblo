/**
 * ★"동시 2대+ 에서 티켓이 완료됐다" 의 렌더러측 관측 (티켓 pWSnJeQN).
 *
 * 보드 구독(taskOutcomeReporter.observeTaskSnapshot)이 티켓의 DONE 전이를 잡으면
 * 여기로 온다. 그 순간의 **동시성은 메인에게 묻는다** — 렌더러의 agents 스토어는
 * Firestore 문서 기반이라 선택된 프로젝트로 스코프되고 죽은 문서가 남을 수 있는
 * 반면, 살아 있는 PTY 의 진실은 메인의 AgentManager 뿐이고, KPI 가 묻는 것은
 * "이 사람이 2대를 동시에 굴렸나"(설치 축)라 프로젝트로 나누면 안 된다.
 *
 * 비식별: 오가는 값은 개수뿐이다(에이전트 id·이름·모델 없음).
 */

import telemetry from "./telemetryService";
import {
  isMultiAgentConcurrency,
  isMultiAgentSuccessTransition,
} from "../lib/telemetry/multiAgent";

type ConcurrencyReader = () => Promise<{ live: number; working: number }>;

function defaultConcurrencyReader(): ConcurrencyReader | null {
  // 노드 컨텍스트(단위테스트)엔 window 가 없다 — 여기서 던지면 계측이 티켓 완료
  // 관측 경로를 깨뜨린다. 없으면 판정하지 않는 게 맞는 동작이다.
  if (typeof window === "undefined") return null;
  const api = (
    window as unknown as {
      electronAPI?: { agent?: { concurrency?: ConcurrencyReader } };
    }
  ).electronAPI;
  return api?.agent?.concurrency ?? null;
}

/**
 * DONE 전이 1건을 판정해, 그 순간 동시 2대+ 였다면 성공 이벤트를 발신한다.
 *
 * best-effort 다 — IPC 가 없거나(웹 프리뷰·테스트) 실패하면 조용히 아무 것도 하지
 * 않는다. 계측이 티켓 완료 경로를 절대 깨서는 안 된다.
 *
 * `readConcurrency` 는 테스트 주입용. 프로덕션에서는 preload 의
 * `electronAPI.agent.concurrency` 를 쓴다.
 */
export async function noteTaskCompletionForMultiAgentKpi(
  previousStatus: string | undefined,
  nextStatus: string,
  readConcurrency: ConcurrencyReader | null = defaultConcurrencyReader(),
  taskId?: string,
): Promise<void> {
  if (!isMultiAgentSuccessTransition(previousStatus, nextStatus)) return;
  if (!readConcurrency) return;
  try {
    const { live, working } = await readConcurrency();
    if (!isMultiAgentConcurrency(live)) return;
    telemetry.multiAgentSuccessObserved(
      { trigger: "task_completed", concurrent: live, working },
      // ★창(window)이 여러 개면 같은 DONE 전이를 각 렌더러가 한 번씩 본다.
      // taskId 를 실어 두면 집계에서 COUNT(DISTINCT taskId) 로 접을 수 있다 —
      // 창 간 조율(Firestore 트랜잭션 클레임)을 표시용 카운터 하나 때문에
      // 들이지 않기 위한 값싼 대안이다. 고유 설치 수 축은 애초에 영향 없다.
      { taskId },
    );
  } catch {
    // 동시성을 못 읽으면 판정하지 않는다 — 모르는 것을 0 이나 2 로 지어내지 않는다.
  }
}
