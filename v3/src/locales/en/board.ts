/**
 * English — `board.*` namespace. Typed `Record<keyof typeof koBoard, string>`
 * so a key present in ko but missing here (or vice-versa) is a compile error
 * for this namespace alone.
 */
import type { board as koBoard } from "../ko/board";

export const board: Record<keyof typeof koBoard, string> = {
  // KanbanBoard
  "board.aiBreakdown": "AI Breakdown",

  // KanbanBoard — no-project empty state (clickable CTA → folder select).
  // Framed as the onboarding entry point: connecting a folder auto-creates the
  // project and boots the orchestrator.
  "board.noProjects.title": "Connect a folder to begin",
  "board.noProjects.desc":
    "Connecting a folder auto-creates the project and opens the orchestrator's first chat.",
  "board.noProjects.cta": "Connect folder · Start",
  "board.noProjects.hint":
    "Connecting a folder is the first step of onboarding.",

  // KanbanColumn — empty column
  "board.column.noTasks": "No tasks",
  "board.column.dropHere": "Drop here",
  "board.column.todoHint": "+ Start with New Task",

  // KanbanBoard — kanban↔graph view toggle, TaskGraphView
  "board.view.kanban": "Kanban",
  "board.view.graph": "Graph",
  "board.view.kanbanTip": "Kanban view — columns by status",
  "board.view.graphTip": "Graph view — dependsOn DAG",
  "board.graph.empty": "No tasks to graph",
  "board.graph.summary": "{nodes} tasks · {edges} dependencies",
  "board.graph.hint": "Scroll to zoom · drag to pan · click a node for details",
  "board.graph.cycle": "Dependency cycle — dashed arrows",

  // TaskGraphView Phase 2 — ops layer (critical path, ready/waiting legend, hover card)
  "board.graph.critical": "Critical path",
  "board.graph.criticalTip":
    "Longest dependency chain — {count} remaining tasks set the finish date",
  "board.graph.criticalNone": "No dependency chain to highlight",
  "board.graph.fit": "Fit to view",
  "board.graph.nodeListLabel": "{count} dependency graph nodes",
  "board.graph.legend.ready": "Ready {count}",
  "board.graph.legend.waiting": "Waiting {count}",
  "board.graph.legend.active": "Active {count}",
  "board.graph.legend.stuck": "Stuck {count}",
  "board.graph.legend.done": "Done {count}",
  "board.graph.legend.critical": "Critical {count}",
  "board.graph.readiness.ready": "Ready to start — all dependencies are done",
  "board.graph.readiness.waiting": "Waiting on dependencies",
  "board.graph.readiness.active": "In flight",
  "board.graph.readiness.stuck": "Stuck — needs a human",
  "board.graph.readiness.done": "Done",
  "board.graph.tooltip.blocks": "{count} tasks waiting on this",

  // TaskGraphView Phase 3 — coordination layer (scope overlap, stuck blast, backlog field)
  "board.graph.conflict": "Conflict risk",
  "board.graph.conflictTip":
    "{count} open task pairs share scope · {clusters} conflict clusters — running them in parallel means merge conflicts",
  "board.graph.conflictNone": "No overlapping scope",
  "board.graph.conflictTruncated": "showing first {count} conflict pairs",
  "board.graph.legend.conflict": "Conflict risk {count}",
  "board.graph.legend.blast": "Stuck blast {count}",
  "board.graph.legend.isolated": "Isolated {count}",
  "board.graph.tooltip.conflicts":
    "{count} scope overlaps — conflicts if run together",
  "board.graph.tooltip.conflictPaths": "Overlapping paths: {paths}",
  "board.graph.tooltip.blast": "Blocked by a stuck task",
  "board.graph.tooltip.isolated": "No links — backlog",

  // TaskCard — presence + assignee
  "board.presence.online": "Online",
  "board.presence.idle": "Idle",
  "board.presence.offline": "Offline",
  "board.taskCard.switchCodeRoot": "Switch Code tab root to {path}",
  "board.taskCard.viewWorktreeTip":
    "View this worktree · switch the file tree + select its agent ({branch})",
  "board.taskCard.viewingWorktree": "Currently viewing this worktree",
  "board.taskCard.assignee": "Assignee {status}",
  "board.taskCard.unassigned": "Unassigned",
  "board.taskCard.stuck": "Stuck",

  // TaskBodySections — section headings
  "board.section.goal": "Goal",
  "board.section.changes": "Changes & Approach",
  "board.section.acceptance": "Acceptance",
  "board.section.notes": "Notes & Constraints",

  // TaskDetailModal
  "board.taskDetail.viewWorktree": "View this worktree",
  "board.taskDetail.viewingWorktree": "Currently viewing this worktree",
  "board.taskDetail.viewWorktreeTip":
    "Switch the left file tree to this worktree and select its agent ({branch})",
  "board.taskDetail.noWorktree": "No linked worktree",
  "board.taskDetail.noWorktreeTip":
    "No worktree matches this task id (not in any worktree's taskId, path, or branch). If it was just created, hit Re-find.",
  "board.taskDetail.worktreeSearching": "Checking worktrees...",
  "board.taskDetail.worktreeRefind": "Re-find",
  "board.taskDetail.worktreeStillMissing": "Re-checked — still none",
  "board.taskDetail.worktreeRefindFailed": "Worktree lookup failed",
  "board.taskDetail.viewTerminal": "View {name} terminal",
  "board.taskDetail.connect": "(connect)",
  "board.taskDetail.edit": "Edit",
  "board.taskDetail.titleLabel": "Title",
  "board.taskDetail.descriptionLabel": "Description",
  "board.taskDetail.descriptionPlaceholder":
    "Task description, detailed prompt for the agent...",
  "board.taskDetail.priorityLabel": "Priority",
  "board.taskDetail.priorityUrgent": "(Urgent)",
  "board.taskDetail.priorityLow": "(Low)",
  "board.taskDetail.deleting": "Deleting...",
  "board.taskDetail.deleteTask": "Delete Task",
  "board.taskDetail.cancel": "Cancel",
  "board.taskDetail.save": "Save",
  "board.taskDetail.addDescription": "+ Add description (click to edit)",
  "board.taskDetail.diffTab": "Diff",
  "board.taskDetail.lookingUpWorktree": "Looking up the linked worktree.",
  "board.taskDetail.refresh": "Refresh",
  "board.taskDetail.worktreeNotFound":
    "No worktree linked to this task was found.",
  "board.taskDetail.diffLoadFailed": "Failed to load diff",

  // StuckLane — virtual lane right of DONE. A view grouping, not a status.
  "board.stuck.title": "Stuck",
  "board.stuck.tooltip":
    "Tickets that stopped moving — BLOCKED/FAILED plus the derived STALE verdict. A ticket's status is never changed by this lane.",
  "board.stuck.empty": "Nothing is stuck.",
  "board.stuck.group.BLOCKED": "BLOCKED",
  "board.stuck.group.FAILED": "FAILED",
  "board.stuck.group.STALE": "STALE",
  "board.stuck.reason.agent-missing": "Bound agent is gone from the list",
  "board.stuck.reason.agent-dead": "Bound agent is stopped or errored",
  "board.stuck.reason.no-progress": "No progress for over 30 minutes",
  "board.stuck.reason.worktree-idle": "Worktree untouched for over a day",
  "board.stuck.idleFor": "{minutes}m and counting",
  "board.stuck.action.retry": "Retry",
  "board.stuck.action.archive": "Archive",
  "board.stuck.action.delete": "Delete",
  "board.stuck.action.restore": "Restore",
  "board.stuck.hiddenToggle": "🗄 Archived / deleted ({count})",
  "board.stuck.retryInjection":
    "A retry was requested from the Stuck lane. Please pick the work back up where it left off.",
  "board.stuck.msg.reused": "{agent} restarted — resuming where it left off.",
  "board.stuck.msg.redispatched":
    "Claim released and the ticket is back in TODO. The orchestrator will re-assign it.",
  "board.stuck.msg.archived": '"{title}" archived — hidden from the board.',
  "board.stuck.msg.deleted": '"{title}" deleted (recoverable).',
  "board.stuck.msg.restored": '"{title}" restored — back on the board.',
  "board.stuck.error.generic": "The action failed.",

  // DiffViewer
  "board.diff.loading": "Loading diff...",
  "board.diff.retry": "Retry",
  "board.diff.empty": "No diff to display.",
  "board.diff.fileCount": "{count} files",
};
