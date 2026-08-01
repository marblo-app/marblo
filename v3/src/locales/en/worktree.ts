/**
 * English — `worktree.*` namespace. Typed `Record<keyof typeof koWorktree,
 * string>` so a key present in ko but missing here (or vice-versa) is a
 * compile error for this namespace alone.
 */
import type { worktree as koWorktree } from "../ko/worktree";

export const worktree: Record<keyof typeof koWorktree, string> = {
  // Status filter dropdown
  "worktree.filter.all": "All statuses",
  "worktree.filter.ready": "🟢 Mergeable",
  "worktree.filter.behind": "🟡 Behind",
  "worktree.filter.warning": "⚠️ stale",
  "worktree.filter.danger": "🔴 Conflict",
  "worktree.filter.idle": "⚪ Working",

  // Conflict summary
  "worktree.conflict.rebaseNeeded": "rebase needed",
  "worktree.conflict.none": "no conflicts",

  // Row actions
  "worktree.action.resolveOnlyConflict":
    "Resolve is only available in a conflict state",
  "worktree.action.mergeAdminOnly":
    "Only project admins (owner/admin) can merge",
  "worktree.action.openInCode": "Open this worktree in the Code tab",
  "worktree.action.removeCleanup": "Remove worktree and clean up branch",
  "worktree.row.aheadTip": "ahead (commits ahead of base)",
  "worktree.row.behindTip": "behind (commits behind base)",

  // Relative time (merge history)
  "worktree.time.justNow": "just now",
  "worktree.time.minutesAgo": "{min}m ago",
  "worktree.time.hoursAgo": "{hr}h ago",
  "worktree.time.daysAgo": "{day}d ago",

  // Merge mode badge
  "worktree.merge.autoTip": "Orchestrator auto-merge",
  "worktree.merge.humanTip": "Merged by a human",
  "worktree.merge.auto": "🤖 Auto",
  "worktree.merge.human": "🙂 Human",

  // Merge history row
  "worktree.history.rowTip": "Click to see the merged diff (git show)",
  "worktree.history.shaTip": "{sha} — click for diff",
  "worktree.history.diffLoading": "Loading diff…",
  "worktree.diffLoadFailed": "Failed to load diff",

  // Header toolbar
  "worktree.exceptionsTip":
    "Only ones that can't auto-merge and need human review (conflict/unmergeable or stale)",
  "worktree.exceptionsLabel": "⚠️ Exceptions only",
  "worktree.historyToggleTip":
    "Audit history of merged-and-removed worktrees — click a sha for the diff",
  "worktree.historyToggleLabel": "📜 Merge history",
  "worktree.cleanupStaleTip":
    "Bulk-remove already-merged / long-idle worktrees (branch cleanup)",
  "worktree.cleaningStale": "Cleaning…",
  "worktree.cleanupStaleLabel": "⚠️ Bulk-clean stale ({count})",
  "worktree.refreshing": "Refreshing…",
  "worktree.refresh": "Refresh",

  // Error / empty states
  "worktree.error.loadFailed": "Failed to load worktrees: {error}",
  "worktree.error.actionFailed": "Worktree action failed: {error}",
  "worktree.history.loading": "Loading merge history…",
  "worktree.history.emptyTitle": "No completed merge history yet.",
  "worktree.history.emptyHint":
    "When worktrees are merged they accumulate here as audit history. (click a sha for the diff)",
  "worktree.loading": "Loading worktrees…",
  "worktree.emptyTitle": "No worktrees.",
  "worktree.emptyHint":
    "When an agent creates a worktree for a task, it shows up here.",
  "worktree.noMatches": "No worktrees match the filter.",

  // Action result banners / confirms
  "worktree.msg.opened": "Opened {branch} worktree in the Code tab.",
  "worktree.confirm.delete":
    "Remove {branch} worktree and clean up the branch too?",
  "worktree.msg.rebased": "{branch} rebased",
  "worktree.msg.merged": "{branch} squash-merged",
  "worktree.msg.resolveStarted": "{branch} resolve agent started",
  "worktree.msg.removed": "{branch} worktree removed",
  "worktree.confirm.cleanupStale":
    "Remove {count} stale worktree(s) and clean up their branches too?",
  "worktree.msg.cleanupPartial":
    "{removed} cleaned, {failed} failed — {detail}",
  "worktree.msg.cleanupDone": "{removed} stale worktree(s) cleaned",
  "worktree.error.cleanupFailed": "stale cleanup failed",

  // Archive (hide) / restore — default view shows active/ongoing only
  "worktree.archivedToggleLabel": "🗄 Archived ({count})",
  "worktree.archivedToggleTip":
    "Merged/stale (auto) or manually-archived worktrees — hidden from the default list. Restore them here",
  "worktree.action.archive":
    "Archive this worktree (hide from the default list)",
  "worktree.action.restore": "Restore from archive (show in the default list)",
  "worktree.archiveAction": "Archive",
  "worktree.restoreAction": "Restore",
  "worktree.msg.archived": "{branch} archived",
  "worktree.msg.restored": "{branch} restored",
  "worktree.archivedEmptyTitle": "No archived worktrees.",
  "worktree.archivedEmptyHint":
    "Merged or long-idle worktrees move here automatically.",
  "worktree.archivedReason.merged": "merged",
  "worktree.archivedReason.stale": "stale",
  "worktree.archivedReason.done": "done",
  "worktree.archivedReason.mergedTip":
    "Auto-archived — already merged into base",
  "worktree.archivedReason.staleTip": "Auto-archived — long idle",
  "worktree.archivedReason.doneTip": "Auto-archived — its ticket is DONE",

  // Audit lifecycle category (task-status based, squash-proof)
  "worktree.category.developing": "In development",
  "worktree.category.developingTip":
    "An agent is active, there are uncommitted changes, or the ticket is still open — never a bulk-cleanup target (protected)",
  "worktree.category.mergeNeeded": "Merge needed",
  "worktree.category.mergeNeededTip":
    "Ticket is in REVIEW — work is done, a human must decide merge/conflict-resolution",
  "worktree.category.cleanupMerged": "Cleanup · merged",
  "worktree.category.cleanupMergedTip":
    "Ticket is DONE — landed work. The worktree can be cleaned up",
  "worktree.category.cleanupStale": "Cleanup · stale",
  "worktree.category.cleanupStaleTip":
    "Orphan / ad-hoc branch with no linked ticket — a prune candidate",

  // GitHub / ticket / request-review buttons
  "worktree.action.github": "GitHub",
  "worktree.action.githubTip":
    "Open the PR (if any) or the branch comparison in the browser",
  "worktree.action.githubUnavailable": "No GitHub remote/branch to open",
  "worktree.action.ticket": "Ticket",
  "worktree.action.ticketTip": "Open this worktree's ticket on the board",
  "worktree.action.ticketUnavailable": "No linked board ticket",
  "worktree.action.review": "Review",
  "worktree.action.reviewSending": "Sending…",
  "worktree.action.reviewTip":
    "Ask the orchestrator to judge merge/conflict-resolution/cleanup for this worktree",

  // Request-review message / result
  "worktree.review.message":
    "Worktree review request — {label} (branch {branch}, status {status}). Please judge whether to merge, resolve conflicts, or clean up.",
  "worktree.review.statusConflict": "conflict",
  "worktree.review.statusDeveloping": "in development",
  "worktree.review.sentLocal":
    "Sent the review request for {branch} to the orchestrator.",
  "worktree.review.sentQueued":
    "Queued the review request for {branch} (the orchestrator's machine will pick it up).",
  "worktree.review.failed": "Failed to send review request",

  // Bulk cleanup (merged) — never touches developing/conflict/uncommitted
  "worktree.cleanupMergedTip":
    "Bulk-remove only 'Cleanup · merged' worktrees (developing/conflict/uncommitted excluded)",
  "worktree.cleanupMergedLabel": "🧹 Bulk-clean merged ({count})",
  "worktree.confirm.cleanupMerged":
    "Remove {count} merged (DONE) worktree(s) and clean up their branches? (developing/conflict/uncommitted are excluded)",

  // Legend
  "worktree.legend.toggleLabel": "ⓘ Legend",
  "worktree.legend.toggleTip":
    "Show/hide the status categories and button descriptions",
  "worktree.legend.statesTitle": "Status",
  "worktree.legend.buttonsTitle": "Buttons",
  "worktree.legend.developing":
    "agent active or uncommitted — never auto-cleaned (protected)",
  "worktree.legend.mergeNeeded":
    "REVIEW done — decide merge/conflict-resolution",
  "worktree.legend.cleanup":
    "merged (DONE) or orphan (stale) — bulk cleanup targets 'merged' only",
  "worktree.legend.btnRebase": "Rebase = replay onto latest base (main)",
  "worktree.legend.btnMerge": "Merge = squash-merge into base",
  "worktree.legend.btnGithub": "GitHub = open PR/branch comparison in browser",
  "worktree.legend.btnTicket": "Ticket = open the board ticket",
  "worktree.legend.btnReview": "Review = ask the orchestrator to judge",
  "worktree.legend.btnArchive":
    "Archive = hide from the default list (restorable)",
  "worktree.legend.btnDelete": "Delete = physically remove worktree + branch",
};
