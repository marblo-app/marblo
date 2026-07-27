import { useEffect, useMemo, useState } from "react";
import type { Task } from "../types/task";
import { useAgentStore } from "../stores/agentStore";
import { useWorktreeStore } from "../stores/worktreeStore";
import { partitionBoardTasks, type BoardPartition } from "../lib/stuckLane";

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
  const worktrees = useWorktreeStore((s) => s.worktrees);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), RECLASSIFY_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

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
        agents,
        agentsLoaded: agentsHydrated,
        now,
        worktreeIdleDays,
      }),
    [tasks, agents, agentsHydrated, now, worktreeIdleDays],
  );
}
