import type { PendingInstructionSource } from "../types/pendingInstruction";
import { createDocument, toTimestamp } from "./firestore";

const COLLECTION = "pendingInstructions";

export interface AddPendingInstructionInput {
  projectId: string;
  /**
   * Owning task ID. `null` is allowed for free-form instructions that are
   * not tied to a specific task card (e.g. an orchestrator-level directive
   * sent via team chat).
   */
  taskId?: string | null;
  /** Agent whose PTY should receive the instruction. */
  targetAgentId: string;
  /** Instruction text to be written to the agent's PTY stdin. */
  message: string;
  /** Where the instruction originated. Defaults to `'other'`. */
  sourceType?: PendingInstructionSource;
  fromUserId?: string;
  fromUserName?: string;
}

/**
 * Enqueue a new-instruction for an agent that lives on a teammate's machine.
 * The marblo app hosting `targetAgentId` will pick this up via its
 * `pendingInstructionListener` (subscribed by agent id), atomically flip
 * `isDelivered` to `true`, and inject the message into the PTY.
 *
 * Returns the new doc ID so the caller can correlate UI feedback if needed.
 */
export async function addPendingInstruction(
  input: AddPendingInstructionInput,
): Promise<string> {
  return createDocument(COLLECTION, {
    projectId: input.projectId,
    taskId: input.taskId ?? null,
    targetAgentId: input.targetAgentId,
    message: input.message,
    sourceType: input.sourceType ?? "other",
    fromUserId: input.fromUserId ?? "",
    fromUserName: input.fromUserName ?? "",
    isDelivered: false,
    createdAt: toTimestamp(new Date()),
    deliveredAt: null,
  });
}
