import { addPendingInstruction } from "./pendingInstructionService";

/**
 * Route a free-form instruction to the project orchestrator:
 *
 *  1. Fast path — the orchestrator for THIS projectId is running in this app's
 *     main process → deliver in-process via `orchestrator.injectMessage`, the
 *     same guard-free, boot-gated path `/notify-orchestrator` and
 *     `OrchestratorManager.injectMessage` already use. This returns a REAL ack:
 *     we only report `"local"` when the message was actually committed.
 *  2. Fallback — no local orchestrator, it isn't running, or the injection
 *     couldn't be committed → enqueue into Firestore `pendingInstructions` at key
 *     `orch-${projectId}`; the machine hosting the orchestrator has a listener
 *     there that flips delivery and injects the PTY.
 *
 * The previous fast path did a global `pty.list()`, grabbed the first PTY whose
 * name contained "orchestrator" (across ALL windows), fired-and-forgot a
 * `pty.writeAndSubmit`, and unconditionally returned `"local"`. From a detached
 * pop-out or a second window — a non-owner of that PTY — the main-process
 * `pty:writeAndSubmit` handler silently dropped the write via `isPtyCallerOwner`,
 * yet the UI still showed a success toast AND the durable queue fallback never
 * ran, so the instruction was lost. Resolving by projectId in main and awaiting
 * an ack fixes both: honest UI + guaranteed fall-through to the durable queue.
 */
export interface RouteOrchestratorInput {
  projectId: string;
  message: string;
  fromUserId?: string;
  fromUserName?: string;
  /** Optional task the comment belongs to (kept null for free-form). */
  taskId?: string | null;
}

export type RouteResult = "local" | "queued" | "failed";

export async function routeInstructionToOrchestrator(
  input: RouteOrchestratorInput,
): Promise<RouteResult> {
  const { projectId, message } = input;

  // 1) Local orchestrator for THIS project — in-process, project-resolved,
  //    guard-free delivery with a real ack. Only claim "local" on a committed
  //    delivery; any miss (no local orch / not running / not committed) falls
  //    through to the durable queue below.
  try {
    const inject = window.electronAPI.orchestrator?.injectMessage;
    if (inject) {
      const ack = await inject(projectId, message);
      if (ack?.delivered) {
        return "local";
      }
      console.warn(
        `[orchestratorInstruction] local inject not committed (${
          ack?.reason ?? "unknown"
        }) — falling back to durable queue`,
      );
    }
  } catch (err) {
    console.warn(
      "[orchestratorInstruction] local inject failed — falling back to queue",
      err,
    );
  }

  // 2) Cross-machine fallback.
  try {
    await addPendingInstruction({
      projectId,
      taskId: input.taskId ?? null,
      targetAgentId: `orch-${projectId}`,
      message,
      sourceType: "orchestrator",
      fromUserId: input.fromUserId,
      fromUserName: input.fromUserName,
    });
    return "queued";
  } catch (err) {
    console.error(
      "[orchestratorInstruction] failed to enqueue pending instruction",
      err,
    );
    return "failed";
  }
}
