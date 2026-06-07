import { type FirebaseApp } from "firebase/app";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  addDoc,
  Timestamp,
  type Firestore,
} from "firebase/firestore";
import type { FixRunner } from "./ports";
import type {
  DispatchTaskRequest,
  DispatchTaskResponse,
} from "../bridge-server";

// fix step (quick-fix template) — 단일 task 생성 + 에이전트 spawn + DONE/FAILED
// 까지 polling. dispatch+wait 패턴을 한 step 으로 내재화한 형태.
// 분리 이유: quick-fix 가 decompose 없이 goal 그대로 1 task → 1 agent 매핑이라
// dispatcher.dispatchTasks (LLM 호출 포함) 를 거치지 않는 게 비용/지연 측면에서
// 합리적. 여러 task 가 필요해지면 feature 템플릿의 dispatch+wait 로 옮긴다.

const POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 30 * 60_000; // 30 min

export interface FixRunnerDeps {
  app: FirebaseApp;
  authReady?: Promise<void>;
  dispatchOne: (params: DispatchTaskRequest) => DispatchTaskResponse;
  timeoutMs?: number;
  pollIntervalMs?: number;
  logger?: (msg: string, meta?: Record<string, unknown>) => void;
}

const TERMINAL: Record<string, boolean> = {
  DONE: true,
  FAILED: true,
};

export function createFixRunner(deps: FixRunnerDeps): FixRunner {
  const db: Firestore = getFirestore(deps.app);
  const ready = deps.authReady ?? Promise.resolve();
  const log =
    deps.logger ??
    ((m, meta) => console.log(`[MissionFixRunner] ${m}`, meta ?? ""));
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = deps.pollIntervalMs ?? POLL_INTERVAL_MS;

  async function runFix(input: {
    missionId: string;
    projectId: string;
    goal: string;
    priorContext?: string;
  }): Promise<{ success: boolean; error?: string }> {
    await ready;

    // priorContext (e.g. /investigate 결과) 가 있으면 description / instruction 에
    // 같이 실어 코딩 agent 가 그대로 반영해서 작업하도록.
    const description = input.priorContext
      ? `${input.goal}\n\n--- Prior investigation / context ---\n${input.priorContext}\n--- end ---`
      : input.goal;
    const instruction = description;

    const now = Timestamp.now();
    const taskRef = await addDoc(collection(db, "tasks"), {
      title: input.goal.slice(0, 80),
      description,
      role: "backend",
      priority: 3,
      status: "TODO",
      dependsOn: [],
      dependsOnCompleted: true,
      claimedBy: null,
      claimedAt: null,
      scope: [],
      comment: `Mission ${input.missionId} (quick-fix)`,
      prUrl: "",
      hasPmFeedback: false,
      projectId: input.projectId,
      missionId: input.missionId,
      // contextId = missionId(접두사 없음) 로 기록해야 칸반 카드가 isMissionTask 로
      // 미션 task 를 인식해 🎯 Mission 뱃지를 렌더한다. dispatcher-impl 과 동일 규약.
      contextId: input.missionId,
      createdAt: now,
      updatedAt: now,
    });
    const taskId = taskRef.id;

    // dispatchOne is synchronous (returns immediately after agent spawn/reuse).
    const dispatchResult = deps.dispatchOne({
      role: "backend",
      instruction,
      taskId,
      complexity: "standard",
      projectId: input.projectId,
    });
    if (!dispatchResult.success) {
      log("dispatch failed", { taskId, error: dispatchResult.error });
      return {
        success: false,
        error: dispatchResult.error ?? "dispatch failed",
      };
    }

    // Poll until terminal or timeout. Wait-step polling lives in MissionEngine,
    // but fix is short-lived single-task so we keep the loop here.
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await sleep(pollMs);
      try {
        const snap = await getDoc(doc(db, "tasks", taskId));
        if (!snap.exists()) {
          return { success: false, error: "task disappeared" };
        }
        const status = (snap.data() as { status?: string }).status;
        if (status && TERMINAL[status]) {
          log("fix terminal", { taskId, status });
          return status === "DONE"
            ? { success: true }
            : { success: false, error: `task ${status.toLowerCase()}` };
        }
      } catch (e) {
        log("poll failed", { taskId, err: String(e) });
      }
    }

    return { success: false, error: "fix step timeout" };
  }

  return { runFix };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
