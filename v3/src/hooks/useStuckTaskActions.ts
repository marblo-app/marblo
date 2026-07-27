import { useCallback, useState } from "react";
import type { Task } from "../types/task";
import { useAgentStore } from "../stores/agentStore";
import { canTransition } from "../services/stateMachine";
import {
  restoreTask,
  setTaskArchived,
  softDeleteTask,
  unclaimTask,
  updateTaskStatus,
} from "../services/taskService";
import { findBoundAgent } from "../lib/stuckLane";
import { t } from "../lib/i18n";

export type StuckAction = "retry" | "archive" | "delete" | "restore";

export interface StuckActionState {
  /** 지금 돌고 있는 (taskId, action). 버튼 비활성/스피너용. */
  busy: { taskId: string; action: StuckAction } | null;
  /** 마지막 실패 사유(있으면 레인 상단에 노출). */
  error: string | null;
  /** 마지막 성공 안내. */
  message: string | null;
  retry: (task: Task) => Promise<void>;
  archive: (task: Task) => Promise<void>;
  softDelete: (task: Task) => Promise<void>;
  /** 보관·삭제를 되돌려 보드로 복귀시킨다. */
  restore: (task: Task) => Promise<void>;
  clearFeedback: () => void;
}

function describe(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * 정체 카드의 원클릭 액션 — 재시도 / 보관 / 삭제.
 *
 * ★ 세 액션 모두 status enum 을 늘리지 않는다. 보관·삭제는 status 와 직교인
 * 플래그를 쓰고, 재시도만 **이미 상태기계가 허용하는** 전이를 탄다
 * (services/stateMachine.ts — MCP 서버의 표와 같은 값이다. 렌더러 쪽만 표를
 * 넓히면 UI 로는 되고 에이전트가 하면 거부되는 비대칭이 생긴다).
 */
export function useStuckTaskActions(): StuckActionState {
  const [busy, setBusy] = useState<StuckActionState["busy"]>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const run = useCallback(
    async (task: Task, action: StuckAction, fn: () => Promise<string>) => {
      setBusy({ taskId: task.id, action });
      setError(null);
      setMessage(null);
      try {
        setMessage(await fn());
      } catch (err) {
        setError(describe(err, t("board.stuck.error.generic")));
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  /**
   * 재시도 — 두 갈래.
   *
   * 1. **reuse**: 이 티켓을 문 에이전트 doc 이 아직 있으면 그 CLI 를 재기동한다.
   *    워크트리·브랜치·세션이 그대로 남으므로 하던 일을 이어서 한다
   *    (agentStore.restartAgent 는 메모리에 없는 에이전트도 Firestore doc 으로
   *    재실행하는 경로를 이미 갖고 있다 — 앱 재시작 뒤에도 동작).
   * 2. **redispatch**: 에이전트 doc 자체가 사라졌으면 되살릴 대상이 없다.
   *    담당을 회수하고 TODO 로 되돌려 오케스트레이터가 다시 배정하게 한다.
   *    IN_PROGRESS 는 상태기계상 TODO 직행이 막혀 있어 FAILED 를 거치는데,
   *    이건 우회가 아니라 사실 기록이다 — 그 시도는 에이전트가 사라져서 실제로
   *    끝났다. (표를 렌더러에서만 넓히지 않는 이유는 위 주석 참고.)
   */
  const retry = useCallback(
    (task: Task) =>
      run(task, "retry", async () => {
        const { agents, restartAgent } = useAgentStore.getState();
        const agent = findBoundAgent(agents, task);

        if (agent) {
          await restartAgent(agent.id);
          if (canTransition(task.status, "IN_PROGRESS")) {
            await updateTaskStatus(task.id, "IN_PROGRESS");
          }
          window.electronAPI.bridge
            .injectMessage({
              targetAgent: task.claimedBy ?? agent.id,
              tag: "Task Retry",
              message: t("board.stuck.retryInjection"),
              taskId: task.id,
              taskTitle: task.title,
            })
            .catch(() => {});
          return t("board.stuck.msg.reused", { agent: agent.name });
        }

        if (!canTransition(task.status, "TODO")) {
          await updateTaskStatus(task.id, "FAILED");
        }
        await unclaimTask(task.id);
        return t("board.stuck.msg.redispatched");
      }),
    [run],
  );

  const archive = useCallback(
    (task: Task) =>
      run(task, "archive", async () => {
        await setTaskArchived(task.id, true);
        return t("board.stuck.msg.archived", { title: task.title });
      }),
    [run],
  );

  const softDelete = useCallback(
    (task: Task) =>
      run(task, "delete", async () => {
        await softDeleteTask(task.id, { reason: "stuck-lane" });
        return t("board.stuck.msg.deleted", { title: task.title });
      }),
    [run],
  );

  const restore = useCallback(
    (task: Task) =>
      run(task, "restore", async () => {
        await restoreTask(task.id);
        return t("board.stuck.msg.restored", { title: task.title });
      }),
    [run],
  );

  const clearFeedback = useCallback(() => {
    setError(null);
    setMessage(null);
  }, []);

  return {
    busy,
    error,
    message,
    retry,
    archive,
    softDelete,
    restore,
    clearFeedback,
  };
}
