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
  /**
   * DONE 으로 **처음** 전이한 시각. 완료 컬럼의 "최근 완료순" 정렬 축.
   *
   * ★updatedAt 은 축이 못 된다 — 완료 뒤 코멘트 하나만 달아도 갱신돼서 오래된
   * 완료 티켓이 맨 위로 튀어 오른다. 그래서 쓰는 쪽(렌더러 taskService.
   * updateTaskStatus · MCP applyProjection · flow-engine kanban-bridge)이 DONE
   * 전이 시점에 한 번 기록한다. 이미 DONE 인 문서를 force 로 다시 DONE 해도
   * 덮어쓰지 않는다.
   *
   * 이 필드가 생기기 전에 완료된 티켓에는 없다(백필하지 않는다) — 읽는 쪽은
   * `lib/boardSort.completedAtOf` 로 updatedAt 폴백을 탄다. 시간이 지나면 저절로
   * 정확해진다.
   */
  completedAt?: Date | null;

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

  // ── L0 온램프 데모 출처 (v3/docs/onramp-ladder-design-2026-08-09.md §4-E) ──
  // ★이 티켓들은 **진짜**다: 실제 `tasks` 컬렉션에 쓰이고, 계정을 연결하면 그대로
  // 실행된다(불변식 I3 — 아래층에서 만든 것이 위층에서 살아남아야 사다리다).
  // 그래도 출처는 남긴다. 두 가지가 필요해서다:
  //   (1) 계측이 "데모 티켓 vs 진짜 요청 티켓" 을 갈라야 퍼널이 읽힌다.
  //   (2) 나중에 일괄 정리 UI 가 대상을 알아야 한다(리스크 R2 — 실행 못 하는
  //       카드가 보드에 쌓이는 것).
  // 이 필드가 없는 티켓(=지금까지의 모든 티켓)이 정상이므로 전부 optional 이다.
  /** 어디서 만들어졌나. 현재 유일한 값은 "onramp_demo". */
  origin?: string;
  /** 어떤 분해 규칙이 걸렸나(`DecomposeResult.matchedRule`). */
  originRule?: string;
  /** 규칙이 확신 못 해 일반 골격으로 떨어졌는가. */
  originFallback?: boolean;

  // Idempotency marker for outcome reporting — the terminal status already
  // sent to BigQuery. Claimed in a transaction so concurrent windows can't
  // double-report. See services/taskOutcomeReporter.ts.
  outcomeReportedStatus?: TaskStatus;
  outcomeReportedAt?: Date;
}
