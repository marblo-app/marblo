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

  // ── 보드 가시성 플래그 (status 와 직교) ───────────────────────────────
  // ★ 정체 레인의 보관/삭제 액션이 쓰는 두 플래그. status enum 은 건드리지
  // 않는다 — 보관도 삭제도 "이 티켓이 어느 단계인가" 와는 다른 축이고,
  // status 에 섞으면 원장이 손실된다(BLOCKED 였다는 사실이 지워짐).
  //
  // archived: 사용자가 접어 둔 티켓. 전 레인에서 숨는다. 되돌릴 수 있다.
  // deleted:  soft-delete. MCP delete_task(mode="soft") 가 이미 쓰던 규약을
  //           그대로 재사용한다 — 필드 이름이 갈리면 한쪽에서 지운 티켓이
  //           다른 쪽에 계속 보인다.
  archived?: boolean;
  archivedAt?: Date;
  deleted?: boolean;
  deletedAt?: Date;
  deletedBy?: string;
  deleteReason?: string;

  // Idempotency marker for outcome reporting — the terminal status already
  // sent to BigQuery. Claimed in a transaction so concurrent windows can't
  // double-report. See services/taskOutcomeReporter.ts.
  outcomeReportedStatus?: TaskStatus;
  outcomeReportedAt?: Date;
}
