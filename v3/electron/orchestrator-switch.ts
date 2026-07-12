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
}

export async function runOrchestratorSwitch(
  args: OrchestratorSwitchArgs,
  deps: OrchestratorSwitchDeps,
): Promise<OrchestratorSwitchResult> {
  const snapshot = await deps.buildSnapshot(args);
  const handoffSummary = summarizeHandoff(snapshot);
  const gate = await deps.checkAuth(args.targetModel);

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

  deps.detachPending(args.projectId);
  deps.stopCurrent(args.projectId);
  const session = await deps.launchNew(args, snapshot);
  if (session.needsAuth) {
    return { ...session, handoffSummary };
  }

  await deps.injectHandoff(session, snapshot, args.mode);
  deps.attachPending(args.projectId, session.ptySessionId);

  return {
    ...session,
    handoffSummary,
  };
}
