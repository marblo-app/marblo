// v3/electron/mcp-server/task-delete.ts
//
// delete_task 안전가드 — 오삭제 방지를 위한 순수 검증 로직.
// Firestore 접근과 분리해 단위 테스트 가능하게 둔다. tools.ts 의 delete_task
// 핸들러가 이 함수로 먼저 가드를 통과시킨 뒤에만 실제 삭제(soft/hard)를 수행한다.

export type DeleteMode = "soft" | "hard";

export interface DeletableTask {
  id: string;
  title: string;
  status: string;
  claimedBy?: string | null;
  /** 이미 soft-delete 된 태스크인지. */
  deleted?: boolean;
}

export interface DeleteGuardInput {
  task: DeletableTask;
  mode: DeleteMode;
  /** 명시적 확인 플래그. 없으면 미리보기만 반환하고 삭제하지 않는다. */
  confirm: boolean;
  /** 호출 에이전트(MARBLO_AGENT_ID). 소유권 가드에 사용. */
  requesterAgentId?: string;
  /** 이 태스크를 dependsOn 으로 참조하는 (미완료) 태스크 수. */
  dependentCount: number;
  /** 소유권/의존성 가드를 의도적으로 우회. */
  force?: boolean;
}

/** 다른 에이전트가 "지금 작업 중"으로 볼 수 있는 상태. */
const ACTIVE_CLAIM_STATUSES = new Set(["CLAIMED", "IN_PROGRESS"]);

/**
 * delete_task 의 안전가드를 평가한다.
 * - error 가 있으면 호출자는 삭제를 중단하고 해당 메시지를 그대로 반환해야 한다.
 * - error 가 없으면 삭제를 진행해도 안전하다.
 */
export function evaluateDeleteGuards(input: DeleteGuardInput): {
  error?: string;
} {
  const { task, mode, confirm, requesterAgentId, dependentCount, force } =
    input;

  // 1. soft-delete 멱등성 — 이미 숨겨진 태스크를 또 soft-delete 하지 않는다.
  //    (hard 는 이미 soft 된 태스크의 영구 제거를 허용)
  if (mode === "soft" && task.deleted) {
    return {
      error: `Task '${task.title}' is already soft-deleted (id=${task.id}).`,
    };
  }

  // 2. 확인 가드 — confirm 없이는 절대 삭제하지 않는다(오삭제 방지).
  if (!confirm) {
    const verb =
      mode === "hard"
        ? "permanently remove"
        : "soft-delete (hide, recoverable)";
    return {
      error:
        `Refusing to ${verb} '${task.title}' (id=${task.id}) without confirmation. ` +
        `Re-call with confirm=true to proceed.`,
    };
  }

  // 3. 소유권 가드 — 다른 에이전트가 활발히 점유 중인 태스크는 막는다.
  if (
    !force &&
    task.claimedBy &&
    requesterAgentId &&
    task.claimedBy !== requesterAgentId &&
    ACTIVE_CLAIM_STATUSES.has(task.status)
  ) {
    return {
      error:
        `Task '${task.title}' (id=${task.id}) is actively claimed by '${task.claimedBy}' ` +
        `(status=${task.status}). Refusing to delete another agent's in-flight work. ` +
        `Pass force=true to override.`,
    };
  }

  // 4. 의존성 가드 — 이 태스크에 의존하는 미완료 태스크가 있으면 막는다(고아 방지).
  if (!force && dependentCount > 0) {
    return {
      error:
        `Task '${task.title}' (id=${task.id}) has ${dependentCount} unfinished dependent task(s) ` +
        `that would be stranded. Resolve or re-point them first, or pass force=true to override.`,
    };
  }

  return {};
}
