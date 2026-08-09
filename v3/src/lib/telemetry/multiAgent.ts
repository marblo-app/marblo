/**
 * ★"동시 2대+ 에서의 성공" 판정 (티켓 pWSnJeQN) — 렌더러측 순수 규칙.
 *
 * 사장님 최중요 KPI 는 "10분 안에 첫 multi-agent 성공 경험" 이다. 그 성공의
 * 트리거는 두 곳에 있고, 관측자가 서로 다르다:
 *
 *   · 머지        → 메인(electron/main.ts recordMergeHistory). 메인이 동시성을
 *                   직접 알고 있으므로 그 자리에서 판정한다.
 *   · 티켓 DONE   → 렌더러(보드 구독). 오케는 MCP(별도 stdio 프로세스)로
 *                   Firestore 를 직접 write 해 렌더러 taskService 를 우회하므로,
 *                   **보드 스냅샷 관측만이** 모든 작성 경로(사람·오케·워치독)를
 *                   한 번씩 잡는다(#895 first_ticket 과 같은 근거).
 *
 * 이 모듈은 그 렌더러측 판정의 순수 부분이다 — IPC·텔레메트리 부작용은
 * services/multiAgentKpi.ts 가 담당한다.
 */

/**
 * "멀티에이전트" 의 하한. ★메인의 `electron/agent-manager.ts`
 * `MULTI_AGENT_MIN_CONCURRENCY` 와 **같은 값이어야 한다** — 두 프로세스가 같은
 * 사실을 세는데 기준이 갈리면 머지 트리거와 완료 트리거의 수가 어긋난다.
 * 프로세스 경계라 import 로 묶을 수 없어 값을 복제하고, 테스트가 일치를 못박는다
 * (tests/unit/multi-agent-kpi.test.ts).
 */
export const MULTI_AGENT_MIN_CONCURRENCY = 2;

/** 지금이 "동시 2대+" 인가. 개수만 본다 — 어떤 에이전트인지는 알 필요가 없다. */
export function isMultiAgentConcurrency(live: number): boolean {
  return Number.isFinite(live) && live >= MULTI_AGENT_MIN_CONCURRENCY;
}

/**
 * 보드 스냅샷에서 관측된 상태 전이가 **성공** 인가.
 *
 * ★DONE 만이다. REVIEW 는 아직 결과가 아니고, FAILED/BLOCKED 는 성공이 아니다.
 * 여기를 넓히면 "여러 대를 굴렸더니 다 막혔다" 가 핵심 KPI 의 분자로 들어간다.
 */
export function isMultiAgentSuccessTransition(
  previousStatus: string | undefined,
  nextStatus: string,
): boolean {
  if (previousStatus === undefined) return false; // 첫 관측(시딩)은 전이가 아니다
  if (previousStatus === nextStatus) return false;
  return nextStatus === "DONE";
}
