import { addPendingInstruction } from "./pendingInstructionService";

/**
 * Route a free-form instruction to the project orchestrator, reusing the exact
 * local-first / cross-machine-fallback pattern already proven in ProjectChat's
 * `@orchestrator` handler (see components/chat/ProjectChat.tsx):
 *
 *  1. Fast path — the orchestrator PTY lives on THIS machine → write straight
 *     to its stdin via `pty.writeAndSubmit` (verify-and-retry CR, avoids the
 *     paste-buffer race that plain `write + '\r'` hits under main-loop load).
 *  2. Fallback — no local orchestrator PTY → enqueue into Firestore
 *     `pendingInstructions` at key `orch-${projectId}`; the machine hosting the
 *     orchestrator has a listener there that flips delivery and injects the PTY.
 *
 * No new IPC channel is introduced — this is the routing the Workspace shell's
 * diff-A inline comments use to send review comments to the orchestrator.
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
  input: RouteOrchestratorInput
): Promise<RouteResult> {
  const { projectId, message } = input;

  // 1) Local orchestrator PTY?
  try {
    const sessions = await window.electronAPI.pty.list();
    const orch = sessions.find((s: { id: string; name: string }) =>
      s.name.toLowerCase().includes("orchestrator")
    );
    if (orch) {
      await window.electronAPI.pty.writeAndSubmit(orch.id, message);
      return "local";
    }
  } catch (err) {
    console.warn(
      "[orchestratorInstruction] local PTY write failed — falling back to queue",
      err
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
      err
    );
    return "failed";
  }
}
