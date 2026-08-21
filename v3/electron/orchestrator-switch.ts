import type {
  HandoffSummary,
  OrchestratorHandoffSnapshot,
  OrchestratorSwitchMode,
  OrchestratorSwitchResumeMode,
} from "./orchestrator-handoff";
import { summarizeHandoff } from "./orchestrator-handoff";

export interface OrchestratorSwitchArgs {
  projectId: string;
  rootPath: string;
  targetModel: string;
  mode: OrchestratorSwitchMode;
  resume: OrchestratorSwitchResumeMode;
}

/**
 * 스폰 차단 사유가 **인증이 아닌** 경우의 표식.
 *
 * `needsAuth` 라는 필드명이 말하는 것과 달리, 오케 스폰에는 관문이 둘이다:
 * 인증(`checkSpawnAuthGate`)과 MCP 가용성(`checkOrchestratorMcpGate`, grok 한정).
 * 둘 다 같은 봉투로 렌더러에 돌아오는데, 렌더러는 종전에 그것을 전부 "로그인이
 * 필요하다" 로 읽어 CLI 설정 위저드를 열었다 — 로그인은 멀쩡한데 폴더 신뢰가
 * 없어서 막힌 grok 사용자는 "이미 로그인됨" 만 보이는 위저드 앞에서 끝난다.
 * 이 한 글자가 그 두 실패를 가른다(없으면 종전대로 인증으로 읽힌다 = 하위호환).
 */
export const ORCHESTRATOR_BLOCK_REASON_MCP = "mcp-unavailable";

/**
 * 스폰 차단 사유가 **벤더 크레덴셜/잔액** 인 경우의 표식(2026-08-21, 7HthjBEf).
 *
 * 관문이 셋이 됐다: 인증(`checkSpawnAuthGate`) · MCP 가용성
 * (`checkOrchestratorMcpGate`) · **벤더 게이트**(`checkOrchestratorVendorGate`).
 * 셋째는 DeepSeek 처럼 선불 잔액으로 도는 오케 후보에만 걸린다.
 *
 * ★이 표식이 없으면 렌더러는 종전대로 "auth" 로 읽어 **CLI 로그인 위저드**를 연다.
 * 그런데 잔액 0 인 사용자는 Codex CLI 로그인이 멀쩡하므로 위저드가 "연결됨" 만
 * 보여주고 끝난다 — MCP 축에서 이미 한 번 겪은 실패모드와 정확히 같은 모양이고
 * (`ORCHESTRATOR_BLOCK_REASON_MCP` 주석), 조치도 정반대다(로그인이 아니라 충전).
 * 표식이 없을 때 auth 로 떨어지는 하위호환은 그대로다.
 */
export const ORCHESTRATOR_BLOCK_REASON_VENDOR = "vendor-credential";

export interface OrchestratorSwitchSession {
  sessionId: string;
  ptySessionId: string;
  status: string;
  needsAuth?: {
    model: string;
    action: string;
    installed: boolean;
    reason?: string;
  };
}

export interface OrchestratorSwitchResult extends OrchestratorSwitchSession {
  handoffSummary: HandoffSummary;
}

export type OrchestratorSwitchStage =
  | "buildSnapshot"
  | "checkAuth"
  | "detachPending"
  | "stopCurrent"
  | "launchNew"
  | "injectHandoff"
  | "attachPending";

export class OrchestratorSwitchStepTimeoutError extends Error {
  readonly step: OrchestratorSwitchStage;
  readonly timeoutMs: number;

  constructor(step: OrchestratorSwitchStage, timeoutMs: number) {
    super(`orchestrator switch ${step} timed out after ${timeoutMs}ms`);
    this.name = "OrchestratorSwitchStepTimeoutError";
    this.step = step;
    this.timeoutMs = timeoutMs;
  }
}

export interface OrchestratorSwitchDeps {
  buildSnapshot: (
    args: OrchestratorSwitchArgs,
  ) => Promise<OrchestratorHandoffSnapshot>;
  checkAuth: (targetModel: string) => Promise<{
    ok: boolean;
    model: string | null;
    action?: string;
    installed: boolean;
    /** 인증이 아닌 사유로 막혔을 때의 표식(ORCHESTRATOR_BLOCK_REASON_MCP). */
    reason?: string;
  }>;
  detachPending: (projectId: string) => void;
  stopCurrent: (projectId: string) => void;
  launchNew: (
    args: OrchestratorSwitchArgs,
    snapshot: OrchestratorHandoffSnapshot,
  ) => Promise<OrchestratorSwitchSession>;
  injectHandoff: (
    session: OrchestratorSwitchSession,
    snapshot: OrchestratorHandoffSnapshot,
    mode: OrchestratorSwitchMode,
  ) => Promise<void>;
  attachPending: (projectId: string, ptySessionId: string) => void;
  stepTimeoutMs?: number;
  injectTimeoutMs?: number;
  onStage?: (stage: OrchestratorSwitchStage) => void;
  onWarning?: (message: string, error?: unknown) => void;
}

function isPositiveTimeout(timeoutMs: number | undefined): timeoutMs is number {
  return (
    typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0
  );
}

async function withSwitchStepTimeout<T>(
  step: OrchestratorSwitchStage,
  promise: Promise<T>,
  timeoutMs: number | undefined,
): Promise<T> {
  if (!isPositiveTimeout(timeoutMs)) return promise;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new OrchestratorSwitchStepTimeoutError(step, timeoutMs)),
          timeoutMs,
        );
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function markStage(
  deps: OrchestratorSwitchDeps,
  stage: OrchestratorSwitchStage,
): void {
  deps.onStage?.(stage);
}

export async function runOrchestratorSwitch(
  args: OrchestratorSwitchArgs,
  deps: OrchestratorSwitchDeps,
): Promise<OrchestratorSwitchResult> {
  markStage(deps, "buildSnapshot");
  const snapshot = await withSwitchStepTimeout(
    "buildSnapshot",
    deps.buildSnapshot(args),
    deps.stepTimeoutMs,
  );
  const handoffSummary = summarizeHandoff(snapshot);
  markStage(deps, "checkAuth");
  const gate = await withSwitchStepTimeout(
    "checkAuth",
    deps.checkAuth(args.targetModel),
    deps.stepTimeoutMs,
  );

  if (!gate.ok) {
    return {
      sessionId: "",
      ptySessionId: "",
      status: "blocked",
      needsAuth: {
        model: gate.model ?? args.targetModel,
        action: gate.action ?? `${args.targetModel} login`,
        installed: gate.installed,
        ...(gate.reason ? { reason: gate.reason } : {}),
      },
      handoffSummary,
    };
  }

  markStage(deps, "detachPending");
  deps.detachPending(args.projectId);
  markStage(deps, "stopCurrent");
  deps.stopCurrent(args.projectId);
  markStage(deps, "launchNew");
  const session = await withSwitchStepTimeout(
    "launchNew",
    deps.launchNew(args, snapshot),
    deps.stepTimeoutMs,
  );
  if (session.needsAuth) {
    return { ...session, handoffSummary };
  }

  markStage(deps, "injectHandoff");
  try {
    await withSwitchStepTimeout(
      "injectHandoff",
      deps.injectHandoff(session, snapshot, args.mode),
      deps.injectTimeoutMs ?? deps.stepTimeoutMs,
    );
  } catch (error) {
    if (!(error instanceof OrchestratorSwitchStepTimeoutError)) {
      throw error;
    }
    deps.onWarning?.(
      `orchestrator switch handoff injection timed out; continuing with launched session ${session.ptySessionId}`,
      error,
    );
  }
  markStage(deps, "attachPending");
  deps.attachPending(args.projectId, session.ptySessionId);

  return {
    ...session,
    handoffSummary,
  };
}
