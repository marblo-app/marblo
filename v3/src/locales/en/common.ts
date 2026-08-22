/**
 * English — `common.*` namespace. Typed `Record<keyof typeof koCommon, string>`
 * so a key present in ko but missing here (or vice-versa) is a compile error
 * for this namespace alone. See ko/common.ts for the key layout.
 */
import type { common as koCommon } from "../ko/common";

export const common: Record<keyof typeof koCommon, string> = {
  // — generic shared words —
  "common.confirm": "Confirm",
  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.loading": "Loading...",
  "common.loadingProjects": "Loading projects…",
  "common.restoringSession": "Restoring session…",
  "common.selectFolderPrompt": "Select a project folder to get started",
  "common.close": "Close",
  "common.unknown": "Unknown",
  "common.loginRequired": "You must be logged in.",

  // — period selector (components/common/PeriodSelector: Usage + Work history) —
  "common.period.label": "Period",
  "common.period.7d": "7 days",
  "common.period.30d": "30 days",
  "common.period.all": "All",

  // — agent runtime guard —
  "common.agentLimitReached":
    "You've reached your plan's concurrent agent limit.",

  // — team / invitations —
  "common.team.duplicateInvite": "There's already a pending invitation.",
  "common.team.inviteNotFound": "Invitation not found.",
  "common.team.inviteAlreadyHandled":
    "This invitation has already been handled.",
  "common.team.inviteExpired": "This invitation has expired.",
  "common.team.inviteMalformed":
    "This invitation is malformed. Ask the inviter to send a new one.",
  "common.team.loadMembersFailed": "Failed to load members",
  "common.team.inviteFailed": "Failed to send invitation",
  "common.team.acceptFailed": "Failed to accept invitation",
  "common.team.rejectFailed": "Failed to reject invitation",
  "common.team.cancelInviteFailed": "Failed to cancel invitation",
  "common.team.updateRoleFailed": "Failed to change role",
  "common.team.removeMemberFailed": "Failed to remove member",

  // — payment —
  "common.payment.sdkLoadFailed": "Failed to load Paddle SDK",
  "common.payment.checkoutCanceled": "Payment canceled",

  // — agent notifications —
  "common.notification.agentSpawned": 'Agent "{name}" ({role}) has started.',
  "common.notification.taskCompleted": 'Completed task: "{taskTitle}"',
  "common.notification.submittedForReview":
    'Submitted task for review: "{taskTitle}"',
  "common.notification.agentError": 'Agent "{name}" error: {error}',
  "common.notification.agentRestarted": 'Agent "{name}" has restarted.',

  // — worktree status pills —
  "common.worktree.conflict": "Conflict",
  "common.worktree.behind": "Behind",
  "common.worktree.mergeable": "Mergeable",
  "common.worktree.idle": "Working",

  // — collaboration conflict banner —
  "common.conflict.editing": "{names} is editing this file",

  // — failure vocabulary (components/common/StateBlock · loadState) —
  "common.state.loading.still": "Still trying…",
  "common.state.empty.title": "Nothing here yet",
  "common.state.failed.title": "Couldn't load",
  "common.state.failed.label": "Couldn't load",
  "common.state.failed.detail": "Details",
  "common.state.denied.title":
    "No permission to read this — it's unknown, not 0",
  "common.state.denied.ask": "Ask {whom}",
  "common.state.notReady.label": "Not collected yet",
  "common.state.partial.title": "Showing {shown}/{total}",
  // ★the one retry label — "Retry" (49 of 55 English occurrences today)
  "common.state.action.retry": "Retry",
  "common.state.action.create": "Create the first one",
  "common.state.action.askOwner": "Ask {whom}",
  "common.state.action.showMore": "Show more",
  "common.state.reason.network": "Check your network connection.",
  "common.state.reason.server": "The server did not respond.",
  "common.state.reason.unknown": "The cause is unknown.",
  "common.state.reason.ownerOnly": "Only the team owner can see this.",
  "common.state.reason.notCollected": "This metric has not started collecting yet.",
};
