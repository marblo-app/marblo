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

const COLLECTION = "tasks";
const DATE_FIELDS = ["claimedAt", "createdAt", "updatedAt"];

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
  await updateDocument(COLLECTION, taskId, payload);
}

export async function deleteTask(taskId: string): Promise<void> {
  await deleteDocument(COLLECTION, taskId);
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
  await updateTask(taskId, { status });

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

  // NOTE: the task_outcomes ML row is NOT written here. It used to be, which
  // meant only UI-driven completions were ever labelled — agents report status
  // through the MCP server, which writes Firestore directly and never reaches
  // this function. Reporting now hangs off the tasks subscription so every
  // writer is covered exactly once; see services/taskOutcomeReporter.ts.

  // 태스크 상태 전이(REVIEW/DONE) 는 audit_logs → 우측 ActivityStreamPanel
  // 로만 노출한다. 팀 채팅(messages) 컬렉션에는 푸시하지 않는다 — 채팅은
  // 사람 간 대화 전용.
}
