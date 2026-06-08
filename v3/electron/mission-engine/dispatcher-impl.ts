import { type FirebaseApp } from "firebase/app";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  addDoc,
  Timestamp,
  type Firestore,
} from "firebase/firestore";
import type { TaskDispatcher, TaskStatusLite } from "./ports";
import type { TaskDecomposer } from "../orchestrator/task-decomposer";
import type { DecomposedTask } from "../orchestrator/dag-generator";
import type {
  DispatchTaskRequest,
  DispatchTaskResponse,
} from "../bridge-server";
import type { AgentManager } from "../agent-manager";
import {
  composeTaskBody,
  taskBodyStorageFields,
} from "../mcp-server/task-body.js";

// 미션 goal 을 decompose → tasks 컬렉션에 write → bridgeServer 의 dispatchTask 로
// 에이전트 spawn/reuse. orchestrator MCP create_tasks_bulk + dispatch_task 가
// 하던 일을 main process 안에서 직접 수행한다.

const TASK_NNN_RE = /^TASK-(\d+)$/i;

export interface TaskDispatcherDeps {
  app: FirebaseApp;
  authReady?: Promise<void>;
  // Lazy — TaskDecomposer 생성자가 LLM 키 없으면 throw 하므로 dispatch 시점까지
  // 지연. 키 없을 때는 호출 자체가 throw → 아래 catch 가 single-task fallback.
  decomposer: () => TaskDecomposer;
  agentManager: AgentManager;
  dispatchOne: (params: DispatchTaskRequest) => DispatchTaskResponse;
  logger?: (msg: string, meta?: Record<string, unknown>) => void;
}

function resolveDeps(
  rawDeps: string[] | undefined,
  indexToId: Record<number, string>,
  selfIndex: number,
): string[] {
  if (!rawDeps?.length) return [];
  const out: string[] = [];
  for (const d of rawDeps) {
    const m = TASK_NNN_RE.exec(d);
    if (!m) continue;
    const idx = parseInt(m[1], 10) - 1;
    if (idx === selfIndex) continue;
    const id = indexToId[idx];
    if (id) out.push(id);
  }
  return out;
}

export function createTaskDispatcher(deps: TaskDispatcherDeps): TaskDispatcher {
  const db: Firestore = getFirestore(deps.app);
  const ready = deps.authReady ?? Promise.resolve();
  const log =
    deps.logger ??
    ((m, meta) => console.log(`[MissionDispatcher] ${m}`, meta ?? ""));

  async function dispatchTasks(input: {
    missionId: string;
    projectId: string;
    goal: string;
    priorContext?: string;
  }): Promise<string[]> {
    await ready;

    // priorContext (e.g. /plan-eng-review) 가 있으면 decomposer 의 goal 에 합쳐
    // 더 풍부한 task 분해 + 각 task description 에도 컨텍스트가 반영되도록.
    const enrichedGoal = input.priorContext
      ? `${input.goal}\n\n--- Prior planning / context ---\n${input.priorContext}\n--- end ---`
      : input.goal;

    // 1) Decompose
    let tasks: DecomposedTask[];
    try {
      const decomposed = await deps.decomposer().decompose(enrichedGoal);
      tasks = decomposed.tasks;
    } catch (e) {
      log("decompose failed — falling back to single task", { err: String(e) });
      tasks = [
        {
          title: input.goal.slice(0, 80),
          description: enrichedGoal,
          role: "backend",
          priority: 3,
          depends_on: [],
          scope: [],
          estimatedHours: 1,
        },
      ];
    }

    if (tasks.length === 0) {
      throw new Error("Decomposition produced 0 tasks");
    }

    // 2) Create Firestore task docs in DAG order so dependsOn IDs are resolvable.
    const indexToId: Record<number, string> = {};
    const orderedTaskIds: string[] = [];
    const now = Timestamp.now();

    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      const resolvedDeps = resolveDeps(t.depends_on, indexToId, i);
      const docPayload = {
        title: t.title,
        ...taskBodyStorageFields(t),
        role: t.role,
        priority: t.priority,
        status: "TODO",
        dependsOn: resolvedDeps,
        dependsOnCompleted: resolvedDeps.length === 0,
        claimedBy: null,
        claimedAt: null,
        scope: t.scope ?? [],
        comment: `Mission ${input.missionId}`,
        prUrl: "",
        hasPmFeedback: false,
        projectId: input.projectId,
        missionId: input.missionId,
        contextId: input.missionId,
        createdAt: now,
        updatedAt: now,
      };
      const ref = await addDoc(collection(db, "tasks"), docPayload);
      indexToId[i] = ref.id;
      orderedTaskIds.push(ref.id);
    }

    // 3) Dispatch only tasks with no dependencies (initial layer). Downstream
    //    tasks become dispatchable when their deps complete — wait-step logic
    //    in MissionEngine + downstream orchestrator agent picks them up.
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      if ((t.depends_on?.length ?? 0) > 0) continue;
      const taskId = indexToId[i];
      try {
        const result = deps.dispatchOne({
          role: t.role,
          instruction: composeTaskBody(t),
          taskId,
          complexity: "standard",
          projectId: input.projectId,
          tags: t.scope ?? [],
        });
        if (!result.success) {
          log("dispatch failed", { taskId, error: result.error });
        } else {
          log("dispatched", {
            taskId,
            action: result.action,
            agentId: result.agentId,
          });
        }
      } catch (e) {
        log("dispatch threw", { taskId, err: String(e) });
      }
    }

    return orderedTaskIds;
  }

  async function getTaskStatuses(
    taskIds: string[],
  ): Promise<Record<string, TaskStatusLite>> {
    await ready;
    const out: Record<string, TaskStatusLite> = {};
    // Parallel fetch — list is typically small (≤ 20). For larger missions
    // batch with `where(documentId(), 'in', ids)` (max 30 per batch).
    await Promise.all(
      taskIds.map(async (id) => {
        try {
          const snap = await getDoc(doc(db, "tasks", id));
          if (!snap.exists()) return;
          const data = snap.data() as { status?: TaskStatusLite } | undefined;
          if (data?.status) out[id] = data.status;
        } catch (e) {
          log("getTaskStatus failed", { taskId: id, err: String(e) });
        }
      }),
    );
    return out;
  }

  // 미션에 이미 생성된 (비종료) task id 들. 앱 재시작 후 dispatch step 이 다시
  // 돌 때, 새로 만들지 않고 이걸로 재연결해 중복 dispatch 를 막는다. missionId 는
  // dispatch/fix 가 task 에 태깅하므로 단일 필드 쿼리(복합 인덱스 불필요).
  async function findMissionTaskIds(missionId: string): Promise<string[]> {
    await ready;
    try {
      const snap = await getDocs(
        query(collection(db, "tasks"), where("missionId", "==", missionId)),
      );
      return snap.docs
        .filter((d) => {
          const s = (d.data() as { status?: string } | undefined)?.status;
          return s !== "DONE" && s !== "FAILED";
        })
        .map((d) => d.id);
    } catch (e) {
      log("findMissionTaskIds failed", { missionId, err: String(e) });
      return [];
    }
  }

  async function killAgentsForTasks(taskIds: string[]): Promise<void> {
    await ready;
    const seen = new Set<string>();
    for (const id of taskIds) {
      try {
        const snap = await getDoc(doc(db, "tasks", id));
        if (!snap.exists()) continue;
        const data = snap.data() as { claimedBy?: string | null } | undefined;
        const agentId = data?.claimedBy ?? null;
        if (!agentId || seen.has(agentId)) continue;
        seen.add(agentId);
        try {
          deps.agentManager.stop(agentId);
        } catch (e) {
          log("agentManager.stop failed", { agentId, err: String(e) });
        }
      } catch (e) {
        log("killAgent lookup failed", { taskId: id, err: String(e) });
      }
    }
  }

  return {
    dispatchTasks,
    getTaskStatuses,
    findMissionTaskIds,
    killAgentsForTasks,
  };
}
