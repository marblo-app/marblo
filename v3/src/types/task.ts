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

  // ── Per-task rollups (services/taskRollups.ts) ────────────────────────
  // Accumulated from the cost:update and agent-restart streams while the task
  // is open, because those signals are gone by completion time. Dual-use:
  // "what did this ticket cost / how many retries did it take" for audit, and
  // the ML labels for task_outcomes. Absent on tasks created before this
  // shipped, hence optional.
  costTotal?: number;
  costInputTokens?: number;
  costOutputTokens?: number;
  retriesCount?: number;

  // Idempotency marker for outcome reporting — the terminal status already
  // sent to BigQuery. Claimed in a transaction so concurrent windows can't
  // double-report. See services/taskOutcomeReporter.ts.
  outcomeReportedStatus?: TaskStatus;
  outcomeReportedAt?: Date;
}
