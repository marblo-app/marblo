/**
 * English — `board.*` namespace. Typed `Record<keyof typeof koBoard, string>`
 * so a key present in ko but missing here (or vice-versa) is a compile error
 * for this namespace alone.
 */
import type { board as koBoard } from "../ko/board";

export const board: Record<keyof typeof koBoard, string> = {
  // KanbanBoard
  "board.aiBreakdown": "AI Breakdown",

  // KanbanBoard — no-project empty state (clickable CTA → folder select)
  "board.noProjects.title": "No projects",
  "board.noProjects.desc": "Open a project to start using the board.",
  "board.noProjects.cta": "Open folder · Create project",

  // KanbanColumn — empty column
  "board.column.noTasks": "No tasks",
  "board.column.dropHere": "Drop here",
  "board.column.todoHint": "+ Start with New Task",

  // TaskCard — presence + assignee
  "board.presence.online": "Online",
  "board.presence.idle": "Idle",
  "board.presence.offline": "Offline",
  "board.taskCard.switchCodeRoot": "Switch Code tab root to {path}",
  "board.taskCard.assignee": "Assignee {status}",
  "board.taskCard.unassigned": "Unassigned",

  // TaskBodySections — section headings
  "board.section.goal": "Goal",
  "board.section.changes": "Changes & Approach",
  "board.section.acceptance": "Acceptance",
  "board.section.notes": "Notes & Constraints",

  // TaskDetailModal
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

  // DiffViewer
  "board.diff.loading": "Loading diff...",
  "board.diff.retry": "Retry",
  "board.diff.empty": "No diff to display.",
  "board.diff.fileCount": "{count} files",
};
