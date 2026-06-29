/**
 * English — `lanes.*` namespace. Typed `Record<keyof typeof koLanes, string>`
 * so a key present in ko but missing here (or vice-versa) is a compile error
 * for this namespace alone.
 */
import type { lanes as koLanes } from "../ko/lanes";

export const lanes: Record<keyof typeof koLanes, string> = {
  // LaneTerminalButton
  "lanes.terminal.view": "View terminal",
  "lanes.terminal.connect": "Connect to session",
  "lanes.terminal.noSession": "No running session",
  "lanes.terminal.label": "Terminal",
  "lanes.terminal.connectBadge": "(connect)",

  // Header
  "lanes.header.subtitle":
    "Parallel to your main work — knock out improvements fast in an isolated worktree",
  "lanes.newButton": "＋ Quick task",

  // Empty state
  "lanes.empty.title": "No quick tasks in progress.",
  "lanes.empty.hint":
    "Use “＋ Quick task” to start an improvement in an isolated worktree.",
  "lanes.noProjectPlaceholder": "Select a project to start quick tasks.",

  // Status pills (laneStatusPill — terminal task states + idle)
  "lanes.pill.done": "Done",
  "lanes.pill.review": "Review",
  "lanes.pill.failed": "Failed",
  "lanes.pill.idle": "Preparing",

  // Row
  "lanes.row.worktreePreparing": "Preparing worktree…",
  "lanes.row.restartTip": "Restart a conflicted/failed lane item",
  "lanes.row.restarting": "Restarting…",
  "lanes.row.restart": "Restart",
  "lanes.row.deleteTip": "Delete a done/stopped/conflicted/failed lane item",
  "lanes.row.deleting": "Deleting…",
  "lanes.row.delete": "Delete",

  // Launch / limit errors
  "lanes.error.noProject": "Select a project first.",
  "lanes.error.noRepoRoot":
    "No project folder path, so an isolated worktree can't be created. Open the project folder from the sidebar first.",
  "lanes.error.agentLimit": "Reached the concurrent agent limit.",

  // Delete flow (multi-step, banners)
  "lanes.delete.fatalStep":
    'Lane deletion stopped at the "{step}" step: {error}',
  "lanes.delete.completedSteps": "Completed steps: {steps}",
  "lanes.delete.warningsLine": "Warnings: {warnings}",
  "lanes.delete.retryHint":
    "The item remains in the list, so you can retry with 'Delete' after resolving the issue.",
  "lanes.delete.step.stopAgent": "Stop agent",
  "lanes.delete.warn.stopAgent":
    "Failed to stop agent (may already be terminated): {error}",
  "lanes.delete.step.removeWorktree": "Remove worktree/branch",
  "lanes.delete.warn.removeAgentProc":
    "Failed to clean up agent process: {error}",
  "lanes.delete.step.deleteAgent": "Delete agent record",
  "lanes.delete.step.deleteTask": "Delete task record",
  "lanes.msg.deleted": 'Deleted the "{title}" lane item.',
  "lanes.msg.deletedWithWarnings": "Warning (deletion completed): {warnings}",

  // Restart
  "lanes.error.noAgentToRestart": "No agent to restart.",
  "lanes.msg.restarted": 'Restarted the "{title}" lane item.',
  "lanes.error.restartFailed": "Failed to restart lane item",

  // LaneCreateModal
  "lanes.create.title": "＋ Quick task",
  "lanes.create.whatLabel": "What do you want to do?",
  "lanes.create.placeholder": "e.g. Improve the login error message",
  "lanes.create.agentLabel": "Agent",
  "lanes.create.cancel": "Cancel",
  "lanes.create.starting": "Starting…",
  "lanes.create.start": "Start",

  // LaneDeleteConfirmModal
  "lanes.confirm.title": "Delete lane item",
  "lanes.confirm.bodyPre": "Delete the ",
  "lanes.confirm.bodyPost": " lane item?",
  "lanes.confirm.warnHeader":
    "This action cannot be undone, and the following are removed together:",
  "lanes.confirm.itemAgent": "Agent process and records",
  "lanes.confirm.itemTask": "Task records",
  "lanes.confirm.itemWorktree": "Isolated worktree and branch",
  "lanes.confirm.cancel": "Cancel",
  "lanes.confirm.delete": "Delete",
};
