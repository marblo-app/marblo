import { useEffect, useMemo, useState } from "react";
import type { Task } from "../types/task";
import { useAgentStore } from "../stores/agentStore";
import { useProjectStore } from "../stores/projectStore";
import { useWorktreeStore } from "../stores/worktreeStore";
import { partitionBoardTasks, type BoardPartition } from "../lib/stuckLane";
import { agentActivityMap, observeAgentTokens } from "../lib/agentProgress";

/**
 * 정체 판정 재평가 주기.
 *
 * ★ 정체는 시간이 지나면 **아무 write 없이도** 성립한다 — 30분 무진척 티켓은
 * Firestore 스냅샷이 한 번도 안 와도 30분째에 정체가 된다. 스토어 구독만
 * 믿으면 그 순간 화면이 안 바뀌고, 사용자가 탭을 다시 열어야 반영된다.
 * 1분 틱이면 임계(30분) 대비 오차 3% 안쪽이고 비용은 setState 한 번이다.
 */
const RECLASSIFY_INTERVAL_MS = 60_000;

/**
 * 보드 한 판을 활성/정체/감춤으로 가른 결과. 컬럼 렌더링과 정체 레인이 **같은
 * 한 번의 판정**을 공유하도록 여기서 한 번만 계산한다.
 */
export function useStuckLane(tasks: readonly Task[]): BoardPartition {
  const agents = useAgentStore((s) => s.agents);
  const agentsHydrated = useAgentStore((s) => s.hydrated);
  const agentsProjectId = useAgentStore((s) => s.agentsProjectId);
  const boardProjectId = useProjectStore((s) => s.currentProject?.id ?? null);
  const worktrees = useWorktreeStore((s) => s.worktrees);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), RECLASSIFY_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  /**
   * 이 보드의 프로젝트 에이전트만.
   *
   * ★agentStore 는 슬롯이 하나인데 구독자는 여럿이고(AgentsTab ·
   * TeamDashboard · AgentListPanel · UsagePage · MacroView · MissionDetail),
   * MissionDetail 은 `mission.projectId` 로 구독한다. 다른 프로젝트 미션을 한
   * 번 열면 이 슬롯이 통째로 그 프로젝트 목록으로 바뀐다 — 그 목록으로 우리
   * 티켓의 담당을 찾으면 당연히 못 찾고, 진행 중 티켓 **전부**가
   * agent-missing → STALE 로 접힌 레인에 빨려 들어간다. 실제로 보고된 증상이
   * 이것이다(MCP 는 정상 반환, 화면에서만 사라짐).
   *
   * 그래서 두 겹으로 막는다. (1) 목록을 프로젝트로 거르고, (2) 아래
   * `agentsLoaded` 로 "다른 프로젝트 스냅샷" 을 아예 로드 전으로 취급한다.
   * (1)만으로는 부족하다 — 걸러서 빈 배열이 된 것과 진짜로 에이전트가 없는
   * 것을 구분하지 못하기 때문이다.
   */
  const projectAgents = useMemo(() => {
    if (!boardProjectId) return agents;
    return agents.filter((a) => a.projectId === boardProjectId);
  }, [agents, boardProjectId]);

  /**
   * "에이전트 없음" 을 정체 근거로 믿어도 되는가.
   *
   * 스냅샷을 한 번은 받았고(hydrated), 그 스냅샷이 **이 보드의 프로젝트 것**
   * 이어야 한다. 어느 쪽이든 아니면 agent-missing arm 만 침묵하고 무진척
   * 시계는 그대로 돈다 — 진짜 정체는 어차피 그쪽에서 잡힌다.
   */
  const agentsLoaded =
    agentsHydrated &&
    (boardProjectId === null || agentsProjectId === boardProjectId);

  // agentId → 마지막 "일한 관측"(과금 토큰 카운터 증가). lib/agentProgress 참조.
  // agents 스냅샷이 바뀔 때만 접는다 — 같은 스냅샷을 두 번 접어도 결과가 같은
  // 순수 fold 라 StrictMode 이중 호출에도 시각이 흔들리지 않는다.
  const agentActivityAt = useMemo(
    () => agentActivityMap(observeAgentTokens(projectAgents, Date.now())),
    [projectAgents],
  );

  // taskId → idleDays. 워크트리 목록 한 패스 — 카드마다 조회하지 않는다.
  const worktreeIdleDays = useMemo(() => {
    const map = new Map<string, number>();
    for (const worktree of worktrees) {
      const idleDays = worktree.staleInfo?.idleDays;
      if (worktree.taskId == null || idleDays === undefined) continue;
      const prev = map.get(worktree.taskId);
      // 같은 티켓에 워크트리가 여럿 잡히면 **가장 최근에 만진 쪽**을 믿는다.
      map.set(
        worktree.taskId,
        prev === undefined ? idleDays : Math.min(prev, idleDays),
      );
    }
    return map;
  }, [worktrees]);

  return useMemo(
    () =>
      partitionBoardTasks(tasks, {
        agents: projectAgents,
        agentsLoaded,
        now,
        worktreeIdleDays,
        agentActivityAt,
      }),
    [
      tasks,
      projectAgents,
      agentsLoaded,
      now,
      worktreeIdleDays,
      agentActivityAt,
    ],
  );
}
