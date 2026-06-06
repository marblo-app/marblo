export type TaskStatus =
  | "TODO"
  | "CLAIMED"
  | "IN_PROGRESS"
  | "REVIEW"
  | "BLOCKED"
  | "FAILED"
  | "DONE";
export type AgentRole = "backend" | "frontend" | "test" | "devops";

export interface Task {
  id: string;
  projectId: string;
  contextId: string;
  title: string;
  description: string;
  goal?: string;
  changes?: string[];
  acceptance?: string[];
  notes?: string[];
  status: TaskStatus;
  role: AgentRole;
  priority: number; // 1~5
  dependsOn: string[]; // taskId 배열
  dependsOnCompleted: boolean;
  claimedBy: string | null;
  claimedAt: Date | null;
  scope: string[];
  comment: string;
  prUrl: string;
  hasPmFeedback: boolean;
  flowId?: string;
  flowNodeId?: string;
  createdAt: Date;
  updatedAt: Date;
}
