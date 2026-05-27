import { where, type Unsubscribe } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import type { Task, TaskStatus } from "../types/task";
import telemetry from "./telemetryService";
import { functions } from "../lib/firebase";
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

/** Subset of agents/<id> doc we care about for task-outcome enrichment. */
interface AgentCostSnapshot {
  model?: string;
  detectedModelId?: string;
  totalCost?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
}

const logTaskOutcomeFn = httpsCallable(functions, "logTaskOutcome");

const COLLECTION = "tasks";
const DATE_FIELDS = ["claimedAt", "createdAt", "updatedAt"];

function toTask(raw: Record<string, unknown>): Task {
  return convertTimestamps<Task>(raw, DATE_FIELDS);
}

export async function getTasks(projectId: string): Promise<Task[]> {
  const docs = await queryDocuments<Record<string, unknown>>(
    COLLECTION,
    where("projectId", "==", projectId)
  );
  return docs.map(toTask).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

export async function getTask(taskId: string): Promise<Task | null> {
  const raw = await getDocument<Record<string, unknown>>(COLLECTION, taskId);
  return raw ? toTask(raw) : null;
}

export async function createTask(
  data: Omit<Task, "id" | "createdAt" | "updatedAt">
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
    data.priority
  );

  return taskId;
}

export async function updateTask(
  taskId: string,
  data: Partial<Omit<Task, "id" | "createdAt">>
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
  callback: (tasks: Task[]) => void
): Unsubscribe {
  return subscribeToCollection<Record<string, unknown>>(
    COLLECTION,
    [where("projectId", "==", projectId)],
    (docs) =>
      callback(
        docs.map(toTask).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
      )
  );
}

export async function claimTask(
  taskId: string,
  agentId: string
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
    previousClaimant ?? undefined
  );
}

export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus
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
    task.claimedBy ?? undefined
  );
  if (status === "DONE") {
    const durationMs = task.claimedAt
      ? Date.now() - new Date(task.claimedAt).getTime()
      : undefined;
    telemetry.taskCompleted(taskId, durationMs, task.claimedBy ?? undefined);

    // Pull model + cumulative cost from the agent doc so the outcome row
    // carries actual signal instead of nulls. This is best-effort; if the
    // agent doc is missing (e.g. orchestrator session) we still log with
    // nulls so the success / duration row lands.
    let agentSnap: AgentCostSnapshot | null = null;
    if (task.claimedBy) {
      try {
        agentSnap = await getDocument<AgentCostSnapshot>(
          "agents",
          task.claimedBy
        );
      } catch {
        agentSnap = null;
      }
    }
    // Prefer the cost-tracker-detected versioned id (e.g. "claude-opus-4-7")
    // over the family enum ("claude") for ML training fidelity.
    const outcomeModel = agentSnap?.detectedModelId ?? agentSnap?.model ?? null;

    // Log task outcome to BigQuery for ML training data
    logTaskOutcomeFn({
      outcome: {
        taskId,
        projectId: task.projectId,
        taskType: null, // TODO: derive from task metadata when available
        taskComplexity: task.priority, // use priority as proxy for now
        role: task.role,
        model: outcomeModel,
        scopeFileCount: task.scope?.length ?? 0,
        success: true,
        durationMs: durationMs ?? null,
        // Cumulative-at-completion. NOT per-task delta — for that, join
        // BigQuery cost_logs by taskId. Still useful as a noisy signal
        // ("agent in this state had spent N total when it finished").
        totalInputTokens: agentSnap?.totalInputTokens ?? null,
        totalOutputTokens: agentSnap?.totalOutputTokens ?? null,
        totalCost: agentSnap?.totalCost ?? null,
        retriesCount: 0,
        createdAt:
          task.createdAt instanceof Date
            ? task.createdAt.toISOString()
            : new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
    }).catch((err) => {
      console.warn("[TaskOutcome] Failed to log outcome:", err);
    });
  }

  // 태스크 상태 전이(REVIEW/DONE) 는 audit_logs → 우측 ActivityStreamPanel
  // 로만 노출한다. 팀 채팅(messages) 컬렉션에는 푸시하지 않는다 — 채팅은
  // 사람 간 대화 전용.
}
