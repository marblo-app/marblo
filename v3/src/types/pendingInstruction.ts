export type PendingInstructionSource =
  | "kanban"
  | "chat"
  | "orchestrator"
  | "other";

export interface PendingInstruction {
  id: string;
  projectId: string;
  taskId: string;
  targetAgentId: string;
  message: string;
  fromUserId: string;
  fromUserName: string;
  sourceType: PendingInstructionSource;
  isDelivered: boolean;
  createdAt: Date;
  deliveredAt: Date | null;
}
