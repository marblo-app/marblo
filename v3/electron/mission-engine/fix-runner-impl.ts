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

  // 이 미션에 이미 만들어진 가장 최근 task 한 개. 멱등 재연결용 — 있으면 새로
  // 만들지 않고 그 task 를 폴링한다. missionId 단일 필드 쿼리(복합 인덱스 불필요).
  async function findExistingMissionTask(
    missionId: string
  ): Promise<{ id: string; status?: string } | null> {
    try {
      const snap = await getDocs(
        query(collection(db, "tasks"), where("missionId", "==", missionId))
      );
      if (snap.empty) return null;
      const docs = snap.docs.map((d) => {
        const data = d.data() as {
          status?: string;
          createdAt?: { toMillis?: () => number };
        };
        return {
          id: d.id,
          status: data.status,
          createdAtMs: data.createdAt?.toMillis?.() ?? 0,
        };
      });
      docs.sort((a, b) => b.createdAtMs - a.createdAtMs);
      const top = docs[0];
      return { id: top.id, status: top.status };
    } catch (e) {
      log("findExistingMissionTask failed", { missionId, err: String(e) });
      return null;
    }
  }

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

    // 멱등 재연결 — 앱 재시작으로 fix step 이 다시 실행돼도, 이 미션의 기존 task 가
    // 있으면 새로 만들지 않고 그걸 이어 폴링한다(중복 task/agent 방지). 오케스트레이터
    // 세션은 resume 으로 대화 컨텍스트가 이어지고, task 진실원은 Firestore 이므로
    // 둘이 합쳐져 "끊김없이 이어짐"이 된다.
    let taskId: string;
    const existing = await findExistingMissionTask(input.missionId);
    if (existing) {
      if (existing.status === "DONE") return { success: true };
      if (existing.status === "FAILED") {
        return { success: false, error: "task failed" };
      }
      taskId = existing.id;
      log("fix reconnect to existing task", {
        taskId,
        missionId: input.missionId,
        status: existing.status ?? null,
      });
    } else {
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
      taskId = taskRef.id;

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
const SPINNER_GLYPHS = "✢⏺·✶✻✽✦❀✺✳⠁-⣿";
const SPINNER_PREFIX_GLYPHS = "✢⏺✶✻✽✦❀✺✳⠁-⣿";
const SPINNER_GLYPH_REGEX = new RegExp(`[${SPINNER_GLYPHS}]`, "gu");
const SPINNER_ONLY_LINE_REGEX = new RegExp(`^\\s*[${SPINNER_GLYPHS}]+\\s*$`, "u");
const SPINNER_PREFIX_FRAGMENT_REGEX = new RegExp(
  `^\\s*[${SPINNER_PREFIX_GLYPHS}]+\\s*[\\p{L}\\p{N}_./:-]{0,18}[….]?\\s*$`,
  "u"
);
const SPINNER_FOLLOWER_FRAGMENT_REGEX = /^\s*[\p{L}\p{N}]{1,4}[….]?\s*$/u;
const SPINNER_STATUS_WORD_REGEX =
  /^\s*(?:Gitifying|Thinking|Baking|Sprouting|Crunching|Working|Loading|Running|Reading|Writing|Editing|Searching|Analyzing|Investigating|Summarizing|Processing)[….]*\s*$/i;

const CONTEXT_NOISE_PATTERNS: RegExp[] = [
  /bypass permissions on/i,
  /shift\s*\+?\s*tab to cycle/i,
  /\besc(ape)? to interrupt\b/i,
  /thinking with \S+ effort/i,
  /·\s*[↑↓]?\s*[\d.]+[km]?\s*tokens?/i,
  // bare /\d+ tokens/ 제거 — 위 스피너 패턴과 중복 + 정상 문구 과매칭(pty-skill-runner 와 동일).
  /\(\s*\d+s\s*·/i,
  /^\s*[✢⠁-⣿✶✻✽✦❀✺⏺]+\s*\w+(?:ing|ed)\b/i,
  /\bBaked for\b/i,
  /Control this session from the Claude mobile app/i,
  /claude\.com\/download/i,
  /\/remote-control\b/i,
  /^\s*⎿\s*Tip:/i,
  /^\s*─{6,}\s*$/,
  /^\s*>\s*$/,
  /^\s*\?\s*for shortcuts\s*$/i,
  /^\s*Type your message/i,
];

function applyCarriageReturnLineDiscipline(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => {
      const lastRedraw = line.lastIndexOf("\r");
      return lastRedraw === -1 ? line : line.slice(lastRedraw + 1);
    })
    .join("\n");
}

function isMostlySpinnerGlyphLine(line: string): boolean {
  const compact = line.trim();
  if (compact === "") return false;
  const glyphCount = compact.match(SPINNER_GLYPH_REGEX)?.length ?? 0;
  if (glyphCount === 0) return false;
  const nonGlyph = compact
    .replace(SPINNER_GLYPH_REGEX, "")
    .replace(/\s+/g, "");
  return glyphCount >= nonGlyph.length;
}

function isSpinnerNoiseLine(line: string): boolean {
  return (
    SPINNER_ONLY_LINE_REGEX.test(line) ||
    SPINNER_PREFIX_FRAGMENT_REGEX.test(line) ||
    SPINNER_STATUS_WORD_REGEX.test(line) ||
    isMostlySpinnerGlyphLine(line)
  );
}

function cleanContextForAgent(raw: string): string {
  const flattened = applyCarriageReturnLineDiscipline(raw);
  const out: string[] = [];
  let spinnerNoiseRun = 0;
  for (const line of flattened
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))) {
    if (line.trim() === "") continue;
    const isSpinnerNoise = isSpinnerNoiseLine(line);
    const isSpinnerFollowerFragment =
      spinnerNoiseRun > 0 && SPINNER_FOLLOWER_FRAGMENT_REGEX.test(line);
    if (
      isSpinnerNoise ||
      isSpinnerFollowerFragment ||
      CONTEXT_NOISE_PATTERNS.some((p) => p.test(line))
    ) {
      spinnerNoiseRun =
        isSpinnerNoise || isSpinnerFollowerFragment ? spinnerNoiseRun + 1 : 0;
      continue;
    }
    spinnerNoiseRun = 0;
    out.push(line);
  }
  const text = out.join("\n").trim();
  // instruction 컨텍스트는 마지막 2000자만 (조사 결론은 보통 끝부분).
  return text.length > 2000 ? text.slice(-2000) : text;
}
