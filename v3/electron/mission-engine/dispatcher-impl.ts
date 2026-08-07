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
  updateDoc,
  Timestamp,
  type Firestore,
} from "firebase/firestore";
import type { MissionBoardPort, TaskDispatcher, TaskStatusLite } from "./ports";
import type { Mission } from "./types";
import { applyProjection } from "../mcp-server/projection.js";
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

async function appendMissionTaskIds(
  db: Firestore,
  missionId: string,
  taskIds: readonly string[],
): Promise<void> {
  if (taskIds.length === 0) return;
  const missionRef = doc(db, "missions", missionId);
  const snap = await getDoc(missionRef);
  if (!snap.exists()) {
    throw new Error(`Mission not found while attaching taskIds: ${missionId}`);
  }
  const data = snap.data() as { taskIds?: unknown };
  const existing = Array.isArray(data.taskIds)
    ? data.taskIds.filter((id): id is string => typeof id === "string")
    : [];
  const merged = Array.from(new Set([...existing, ...taskIds]));
  await updateDoc(missionRef, {
    taskIds: merged,
    lastActivityAt: Timestamp.now(),
  });
}

export function createTaskDispatcher(
  deps: TaskDispatcherDeps,
): TaskDispatcher & MissionBoardPort {
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

    // taskIds 는 Mission Replay 캡처의 조인 가드다. 상위 엔진도 dispatch 성공
    // 뒤 merge 하지만, 여기서 먼저 붙여 create→dispatch 사이/직후 크래시가
    // taskIds=0 미션을 남기지 않게 한다.
    await appendMissionTaskIds(db, input.missionId, orderedTaskIds);

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
  // 돌 때, 새로 만들지 않고 이걸로 재연결해 중복 dispatch 를 막는다.
  //
  // ★projectId 동등조건 필수 (티켓 4ov5wbQZ25XUXHZVhxdh): firestore.rules 의
  // tasks read 는 isProjectMember(resource.data.projectId) 이고 Firestore 는
  // list 를 쿼리 제약식으로 평가하므로, missionId 단독 쿼리는 항상
  // PERMISSION_DENIED 였다(catch 가 삼켜 "재연결이 안 되고 매번 새로 dispatch"
  // 로 나타난다). projectId 는 미션 문서에서 단건 get 으로 읽는다 — 포트
  // 시그니처(findMissionTaskIds(missionId))를 건드리지 않기 위해서다.
  // 두 조건 모두 동등비교라 복합 인덱스는 필요 없다.
  async function findMissionTaskIds(missionId: string): Promise<string[]> {
    await ready;
    try {
      const missionSnap = await getDoc(doc(db, "missions", missionId));
      const projectId = missionSnap.exists()
        ? String(
            (missionSnap.data() as { projectId?: unknown }).projectId ?? "",
          ).trim()
        : "";
      if (!projectId) {
        log("findMissionTaskIds skipped — mission has no projectId", {
          missionId,
        });
        return [];
      }
      const snap = await getDocs(
        query(
          collection(db, "tasks"),
          where("projectId", "==", projectId),
          where("missionId", "==", missionId),
        ),
      );
      return snap.docs
        .filter((d) => {
          const data = d.data() as
            | { status?: string; isMissionCard?: boolean }
            | undefined;
          // 대표 카드(isMissionCard)는 wait/dispatch 게이트의 "전부 DONE" 집합에
          // 들어가면 안 된다 — 카드는 미션이 끝나야 DONE 되므로, 게이트가 카드를
          // 보면 영영 통과 못 해 미션이 멈춘다. 여기서 제외한다.
          if (data?.isMissionCard) return false;
          const s = data?.status;
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

  // ── 미션 대표 보드 카드 (MissionBoardPort) ──────────────────────────
  // 지휘자(conductor)가 미션 시작 시 보드에 '미션 대표 카드'를 1개 만들고
  // (isMissionCard:true), 스텝 진행을 activity 로 쌓고, 상태를 동기화한다.
  // 기존 task 도큐 스키마를 미러해 보드 렌더링이 깨지지 않게 한다.

  async function createMissionCard(mission: Mission): Promise<string> {
    await ready;
    const now = Timestamp.now();
    const ref = await addDoc(collection(db, "tasks"), {
      title: `🎯 Mission: ${mission.goal}`,
      // 본문 필드 — 보드/상세 렌더러가 기대하는 구조화 본문 부분집합을 채운다.
      ...taskBodyStorageFields({
        description: `Mission ${mission.id} representative card`,
      }),
      role: "backend",
      priority: 3,
      status: "IN_PROGRESS",
      dependsOn: [],
      dependsOnCompleted: true,
      claimedBy: null,
      claimedAt: null,
      scope: [],
      comment: `Mission ${mission.id} representative card`,
      prUrl: "",
      hasPmFeedback: false,
      projectId: mission.projectId,
      missionId: mission.id,
      contextId: mission.id,
      isMissionCard: true,
      createdAt: now,
      updatedAt: now,
    });
    return ref.id;
  }

  async function addCardActivity(
    taskId: string,
    message: string,
  ): Promise<void> {
    await ready;
    // tools.ts 의 add_activity 와 동일 방식 — applyProjection 으로 activities/{auto}
    // set + task/mission projection 갱신을 한 트랜잭션에서. best-effort.
    try {
      await applyProjection(db, taskId, {
        lastAgentId: "mission-conductor",
        lastActivitySummary: message,
        activityPayload: { agentId: "mission-conductor", message },
      });
    } catch (e) {
      log("addCardActivity failed", { taskId, err: String(e) });
    }
  }

  async function setCardStatus(taskId: string, status: string): Promise<void> {
    await ready;
    try {
      await updateDoc(doc(db, "tasks", taskId), {
        status,
        updatedAt: Timestamp.now(),
      });
    } catch (e) {
      log("setCardStatus failed", { taskId, status, err: String(e) });
    }
  }

  return {
    dispatchTasks,
    getTaskStatuses,
    findMissionTaskIds,
    killAgentsForTasks,
    createMissionCard,
    addCardActivity,
    setCardStatus,
  };
}
