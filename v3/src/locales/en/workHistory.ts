/**
 * English — `workHistory.*` namespace. Typed against the ko counterpart so key
 * drift is a compile-time error.
 */
import type { workHistory as koWorkHistory } from "../ko/workHistory";

export const workHistory: Record<keyof typeof koWorkHistory, string> = {
  // — relative time labels —
  "workHistory.time.justNow": "just now",
  "workHistory.time.minutesAgo": "{count}m ago",
  "workHistory.time.hoursAgo": "{count}h ago",
  "workHistory.time.daysAgo": "{count}d ago",

  // — provenance field labels —
  "workHistory.provenance.problem": "Problem",
  "workHistory.provenance.approach": "Approach",
  "workHistory.provenance.changes": "Changes",
  "workHistory.provenance.verification": "Verification",

  // — row —
  "workHistory.row.untitled": "(untitled)",
  "workHistory.badge.report": "Report",
  "workHistory.noReport":
    'This completed task has no structured "✅ Completion report".',
  "workHistory.openPr": "Open PR",
  "workHistory.openTicket": "View ticket",
  "workHistory.diff.view": "View diff",
  "workHistory.diff.loading": "Loading…",
  "workHistory.diff.loadFailed": "Failed to load diff",

  // — header —
  "workHistory.title": "Work History",
  "workHistory.doneCount": "{count} completed",
  "workHistory.recentAggregate": "· latest {count} aggregated",

  // — empty / select states —
  "workHistory.selectProject": "Select a project to see its work history.",
  "workHistory.empty.title": "No completed work yet.",
  "workHistory.empty.hint":
    "Once a task moves to DONE, it lands here with its provenance.",

  // — share card —
  "workHistory.share.subtitle":
    "{count} completed · tests-passed/risk are estimates from completion-report keywords",
  "workHistory.share.copyTitle": "Copy share markdown",
  "workHistory.share.copied": "Copied ✓",
  "workHistory.share.copy": "Copy markdown",
};
