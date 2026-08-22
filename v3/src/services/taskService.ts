import { where, type Unsubscribe } from "firebase/firestore";
import type { Task, TaskStatus } from "../types/task";
import telemetry from "./telemetryService";
import {
  getDocument,
  queryDocuments,
  createDocument,
  updateDocument,
  deleteDocument,
  subscribeToCollection,
  toTimestamp,
  convertTimestamps,
} from "./firestore";
import { assertTransition } from "./stateMachine";
import {
  observeTaskSnapshot,
  resetTaskOutcomeObserver,
} from "./taskOutcomeReporter";
import { recordProjectAuditEvent } from "./projectAuditService";
import { taskStatusAuditMetadata } from "../lib/projectAudit";

const COLLECTION = "tasks";
const DATE_FIELDS = [
  "claimedAt",
  "createdAt",
  "updatedAt",
  "completedAt",
  "archivedAt",
  "deletedAt",
];

function toTask(raw: Record<string, unknown>): Task {
  const task = convertTimestamps<Task>(raw, DATE_FIELDS);
  return {
    ...task,
    contextId: (raw.contextId as string) || "board",
  };
}

export async function getTasks(projectId: string): Promise<Task[]> {
  const docs = await queryDocuments<Record<string, unknown>>(
    COLLECTION,
    where("projectId", "==", projectId),
  );
  return docs.map(toTask).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

export async function getTask(taskId: string): Promise<Task | null> {
  const raw = await getDocument<Record<string, unknown>>(COLLECTION, taskId);
  return raw ? toTask(raw) : null;
}

/**
 * Routing-graph attribution subset of a task's `dispatchMeta`. Not part of the
 * public `Task` shape (it's an internal dispatch artifact), so it's read raw.
 * Used by the KG merge forwarder: the renderer (an authenticated project member)
 * resolves this and passes it to the anonymous main process, which can't read
 * member-scoped `tasks` itself (#406/L2).
 */
export interface TaskDispatchMeta {
  role: string | null;
  taskType: string | null;
  complexity: string | null;
  model: string | null;
  /** ★P2-2 — 실스폰 관측 model@effort 키(그래프 셀의 모델 축). 구 문서엔 없음. */
  spawnedModelKey: string | null;
}

export async function getTaskDispatchMeta(
  taskId: string,
): Promise<TaskDispatchMeta | null> {
  const raw = await getDocument<Record<string, unknown>>(COLLECTION, taskId);
  const meta = raw?.dispatchMeta as Record<string, unknown> | undefined;
  if (!meta || typeof meta !== "object") return null;
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v : null;
  return {
    role: str(meta.role),
    taskType: str(meta.taskType),
    complexity: str(meta.complexity),
    model: str(meta.model),
    spawnedModelKey: str(meta.spawnedModelKey),
  };
}

export async function createTask(
  data: Omit<Task, "id" | "createdAt" | "updatedAt">,
): Promise<string> {
  const now = new Date();
  const taskId = await createDocument(COLLECTION, {
    ...data,
    claimedAt: data.claimedAt ? toTimestamp(data.claimedAt) : null,
    createdAt: toTimestamp(now),
    updatedAt: toTimestamp(now),
  });

  telemetry.taskCreated(
    taskId,
    data.projectId || "",
    data.role || "",
    data.priority,
  );

  return taskId;
}

export async function updateTask(
  taskId: string,
  data: Partial<Omit<Task, "id" | "createdAt">>,
): Promise<void> {
  const payload: Record<string, unknown> = {
    ...data,
    updatedAt: toTimestamp(new Date()),
  };
  if (data.claimedAt) {
    payload.claimedAt = toTimestamp(data.claimedAt);
  }
  if (data.completedAt) {
    payload.completedAt = toTimestamp(data.completedAt);
  }
  await updateDocument(COLLECTION, taskId, payload);
}

export async function deleteTask(taskId: string): Promise<void> {
  await deleteDocument(COLLECTION, taskId);
}

/**
 * 보관(archive) 토글 — 티켓을 전 레인에서 숨기거나 되돌린다.
 *
 * ★ status 는 손대지 않는다. BLOCKED 였던 티켓을 보관해도 원장에는 BLOCKED
 * 로 남아 있어야 나중에 "왜 멈췄었나" 를 되짚을 수 있다. 보관은 가시성
 * 축이고 status 는 진행 축이다 — 두 축을 한 필드에 겹치는 순간 되돌릴 수
 * 없는 손실이 난다.
 */
export async function setTaskArchived(
  taskId: string,
  archived: boolean,
): Promise<void> {
  await updateTask(taskId, {
    archived,
    ...(archived ? { archivedAt: new Date() } : {}),
  });
}

/**
 * soft-delete — 되돌릴 수 있는 삭제. 문서는 그대로 두고 플래그만 세운다.
 *
 * MCP `delete_task(mode="soft")` 와 **같은 필드**(deleted / deletedAt /
 * deletedBy / deleteReason)를 쓴다. 규약을 갈라놓으면 UI 로 지운 티켓이 MCP
 * 쪽 목록에 계속 살아 있고 그 반대도 마찬가지가 된다.
 *
 * 물리 삭제는 별도의 의도적 조치({@link deleteTask})로 남겨 둔다.
 */
export async function softDeleteTask(
  taskId: string,
  options: { deletedBy?: string; reason?: string } = {},
): Promise<void> {
  await updateTask(taskId, {
    deleted: true,
    deletedAt: new Date(),
    deletedBy: options.deletedBy ?? "user",
    deleteReason: options.reason ?? "",
  });
}

/**
 * 보관·soft-delete 를 한 번에 되돌린다 — 티켓이 원래 status 그대로 보드에
 * 다시 뜬다.
 *
 * 두 플래그를 같이 내리는 이유: 사용자에게 "이 티켓 다시 보이게 해줘" 는 한
 * 가지 의도다. 어느 플래그로 숨겨졌는지 기억해서 짝을 맞추라고 요구하면,
 * 보관 후 삭제한 티켓이 복구 버튼을 눌러도 안 돌아오는 함정이 된다.
 * status 는 여기서도 손대지 않는다.
 */
export async function restoreTask(taskId: string): Promise<void> {
  await updateTask(taskId, { archived: false, deleted: false });
}

export function subscribeToTasks(
  projectId: string,
  callback: (tasks: Task[]) => void,
): Unsubscribe {
  const unsubscribe = subscribeToCollection<Record<string, unknown>>(
    COLLECTION,
    [where("projectId", "==", projectId)],
    (docs) => {
      const tasks = docs
        .map(toTask)
        .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
      // ML label choke point. Runs off the snapshot rather than the mutation
      // helpers below because agents change status through the MCP server,
      // which writes Firestore directly and never calls into this module —
      // that gap is why task_outcomes had 29 rows against 216 dispatches.
      // See services/taskOutcomeReporter.ts.
      observeTaskSnapshot(tasks);
      callback(tasks);
    },
  );
  return () => {
    resetTaskOutcomeObserver();
    unsubscribe();
  };
}

export async function claimTask(
  taskId: string,
  agentId: string,
): Promise<void> {
  const task = await getTask(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  assertTransition(task.status, "CLAIMED");

  const previousStatus = task.status;
  await updateTask(taskId, {
    status: "CLAIMED",
    claimedBy: agentId,
    claimedAt: new Date(),
  });

  telemetry.taskStatusChanged(taskId, previousStatus, "CLAIMED", agentId);
  recordProjectAuditEvent({
    projectId: task.projectId,
    type: "task.claimed",
    taskId,
    targetId: agentId,
    metadata: taskStatusAuditMetadata(previousStatus, "CLAIMED"),
  });
}

/**
 * Revert a CLAIMED task back to TODO and clear the claimant. Used when the
 * teammate hosting the claiming agent is offline (or otherwise unreachable)
 * and another member needs to pick the task up. Allowed by the state
 * machine as CLAIMED → TODO.
 */
export async function unclaimTask(taskId: string): Promise<void> {
  const task = await getTask(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  assertTransition(task.status, "TODO");

  const previousStatus = task.status;
  const previousClaimant = task.claimedBy;
  await updateTask(taskId, {
    status: "TODO",
    claimedBy: null,
    claimedAt: null,
  });

  telemetry.taskStatusChanged(
    taskId,
    previousStatus,
    "TODO",
    previousClaimant ?? undefined,
  );
}

export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
): Promise<void> {
  const task = await getTask(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  assertTransition(task.status, status);

  const currentStatus = task.status;
  // DONE 으로 **처음** 넘어가는 순간만 completedAt 을 찍는다(types/task.ts 주석).
  // 이 함수는 사람이 UI 로 옮긴 경로 전용이고, 에이전트 경로(MCP)는
  // electron/mcp-server/projection.ts 의 applyProjection 이 같은 규약으로 찍는다.
  await updateTask(
    taskId,
    status === "DONE" && currentStatus !== "DONE"
      ? { status, completedAt: new Date() }
      : { status },
  );

  telemetry.taskStatusChanged(
    taskId,
    currentStatus,
    status,
    task.claimedBy ?? undefined,
  );
  if (status === "DONE") {
    const durationMs = task.claimedAt
      ? Date.now() - new Date(task.claimedAt).getTime()
      : undefined;
    telemetry.taskCompleted(taskId, durationMs, task.claimedBy ?? undefined);
  }

  // 사람이 UI 로 옮긴 티켓의 감사 귀속. 이 함수는 **렌더러 경로 전용**이다 —
  // 에이전트는 MCP 서버로 상태를 바꾸고 그쪽은 Firestore 를 직접 write 하므로
  // 여기 오지 않는다(바로 아래 task_outcomes 노트가 설명하는 것과 같은 구조).
  // 그래서 여기서 잡는 것은 정확히 "사람이 한 이동"이고, 에이전트가 한 이동은
  // `audit_logs` 원장이 이미 actorUid 와 함께 잡는다 — 중복 기록이 아니다.
  recordProjectAuditEvent({
    projectId: task.projectId,
    type: "task.status_changed",
    taskId,
    targetId: taskId,
    metadata: taskStatusAuditMetadata(currentStatus, status),
  });

  // NOTE: the task_outcomes ML row is NOT written here. It used to be, which
  // meant only UI-driven completions were ever labelled — agents report status
  // through the MCP server, which writes Firestore directly and never reaches
  // this function. Reporting now hangs off the tasks subscription so every
  // writer is covered exactly once; see services/taskOutcomeReporter.ts.

  // 태스크 상태 전이(REVIEW/DONE) 는 audit_logs → 우측 ActivityStreamPanel
  // 로만 노출한다. 팀 채팅(messages) 컬렉션에는 푸시하지 않는다 — 채팅은
  // 사람 간 대화 전용.
}
