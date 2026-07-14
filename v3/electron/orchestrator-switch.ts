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

export interface OrchestratorSwitchSession {
  sessionId: string;
  ptySessionId: string;
  status: string;
  needsAuth?: { model: string; action: string; installed: boolean };
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
