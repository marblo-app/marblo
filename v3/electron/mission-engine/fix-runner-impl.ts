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

    // 티켓 본문(description)은 생성 시점의 불변 스펙 — goal 만 담는다(정형화).
    // 직전 조사 결과(priorContext)나 진행 상황을 본문에 덤프하면 PTY 잔해가 그대로
    // 새어들어 티켓이 지저분해진다(기존 add_activity-only 원칙, bridge-server 참고).
    // 컨텍스트는 본문이 아니라 에이전트 instruction(스폰 프롬프트)으로만 전달한다.
    const description = input.goal;
    const cleanedContext = input.priorContext
      ? cleanContextForAgent(input.priorContext)
      : "";
    const instruction = cleanedContext
      ? `${input.goal}\n\n--- 직전 조사 결과 (참고) ---\n${cleanedContext}\n--- end ---`
      : input.goal;

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

// 직전 step output 을 에이전트 instruction 에 싣기 전 최종 정리. skill runner 가
// 이미 cleanClaudeNoise 를 거치지만, footer/spinner/token 잔재가 남을 수 있어
// 한 번 더 거르고 길이를 제한한다(본문이 아닌 instruction 이므로 과하게 자르지 않음).
const CONTEXT_NOISE_PATTERNS: RegExp[] = [
  /bypass permissions on/i,
  /shift\s*\+?\s*tab to cycle/i,
  /\besc(ape)? to interrupt\b/i,
  /thinking with \S+ effort/i,
  /·\s*[↑↓]?\s*[\d.]+[km]?\s*tokens?/i,
  /\b\d+\s*tokens?\b/i,
  /Control this session from the Claude mobile app/i,
  /claude\.com\/download/i,
  /\/remote-control\b/i,
];

function cleanContextForAgent(raw: string): string {
  const kept = raw
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => {
      if (l.trim() === "") return false;
      return !CONTEXT_NOISE_PATTERNS.some((p) => p.test(l));
    });
  const text = kept.join("\n").trim();
  // instruction 컨텍스트는 마지막 2000자만 (조사 결론은 보통 끝부분).
  return text.length > 2000 ? text.slice(-2000) : text;
}
