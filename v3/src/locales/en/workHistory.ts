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
  "workHistory.reportNotLoaded":
    "Completion reports are loaded for the {count} most recent tasks only — narrow by period, role, or search to include this one.",
  "workHistory.openPr": "Open PR",
  "workHistory.openTicket": "View ticket",
  "workHistory.diff.view": "View diff",
  "workHistory.diff.loading": "Loading…",
  "workHistory.diff.loadFailed": "Failed to load diff",

  // — header —
  "workHistory.title": "Work History",
  "workHistory.doneCount": "{count} completed",
  "workHistory.filteredCount": "{period} · {count} of {total} completed",
  "workHistory.reportWindow":
    "· completion reports loaded for the latest {count}",

  // — filter bar —
  "workHistory.filter.role": "Role",
  "workHistory.filter.roleAll": "All",
  "workHistory.filter.searchPlaceholder": "Search title / description",
  "workHistory.filter.reset": "Reset filters",

  // — empty / select states —
  "workHistory.selectProject": "Select a project to see its work history.",
  "workHistory.empty.title": "No completed work yet.",
  "workHistory.empty.hint":
    "Once a task moves to DONE, it lands here with its provenance.",
  "workHistory.empty.filtered.title": "No completed work matches this filter.",
  "workHistory.empty.filtered.hint":
    "Widen the period, or clear the role and search filters.",

  // — share card —
  "workHistory.share.subtitle":
    "{count} completed · tests-passed/risk are estimates from completion-report keywords",
  "workHistory.share.subtitleWindowed":
    "{count} completed · tests-passed/risk are keyword estimates over the {scanned} tasks whose reports were loaded",
  "workHistory.share.copyTitle": "Copy share markdown",
  "workHistory.share.copied": "Copied ✓",
  "workHistory.share.copy": "Copy markdown",
  // — view toggle —
  "workHistory.view.tasks": "Tasks",
  "workHistory.view.missions": "Mission Replay",

  // — first-mission → Replay/share nudge (one-time, chatReadWatermark pattern) —
  "workHistory.firstMissionNudge.message":
    "Your first mission is done! Watch the replay, and share it if you feel like it.",
  "workHistory.firstMissionNudge.cta": "View replay",
  "workHistory.firstMissionNudge.dismiss": "Dismiss",

  // — Mission Replay (Phase 1, in-app only) —
  "workHistory.replay.list.loading": "Loading completed missions…",
  "workHistory.replay.list.denied":
    "You don't have permission to read this project's missions. (Different from having no completed missions.)",
  "workHistory.replay.list.error": "Could not load missions — {message}",
  "workHistory.replay.list.retry": "Retry",
  "workHistory.replay.list.count": "{count} completed missions",
  "workHistory.replay.list.tasks": "{count} tasks",
  "workHistory.replay.list.untitled": "(no goal)",
  "workHistory.replay.list.empty.title": "No completed missions yet.",
  "workHistory.replay.list.empty.hint":
    "When a mission completes, its replay shows up here.",
  "workHistory.replay.list.empty.createHint":
    "Open the Missions tab and choose Quick Fix, Polish, or Feature to start the first mission.",
  "workHistory.replay.list.empty.cta": "Create first mission",
  "workHistory.replay.list.lightweight.title":
    "Showing a completed-work replay summary first.",
  "workHistory.replay.list.lightweight.hint":
    "Even before a completed mission document exists, DONE tasks and completion reports can be grouped into a lightweight replay.",

  "workHistory.replay.back": "← Missions",
  "workHistory.replay.reload": "Refresh",
  "workHistory.replay.loading": "Assembling replay…",
  "workHistory.replay.error": "Could not build the replay — {message}",
  "workHistory.replay.unavailable.notFound": "Mission not found.",
  "workHistory.replay.unavailable.notCompleted":
    "Only completed missions can be replayed.",
  "workHistory.replay.unavailable.denied":
    "You don't have permission to read this mission. (Different from it not existing.)",
  "workHistory.replay.privateNotice":
    "This replay stays inside the app — there is no share or export path.",

  "workHistory.replay.headline.template": "Template",
  "workHistory.replay.headline.launched": "Started",
  "workHistory.replay.headline.completed": "Completed",
  "workHistory.replay.headline.duration": "Duration",

  "workHistory.replay.duration.none": "—",
  "workHistory.replay.duration.days": "{count}d",
  "workHistory.replay.duration.hours": "{count}h",
  "workHistory.replay.duration.minutes": "{count}m",
  "workHistory.replay.duration.seconds": "{count}s",

  "workHistory.replay.provenance.title": "Data sources",
  "workHistory.replay.provenance.ok": "read",
  "workHistory.replay.provenance.empty": "no records",
  "workHistory.replay.provenance.denied": "no permission",
  "workHistory.replay.provenance.failed": "load failed",
  "workHistory.replay.provenance.deniedNote":
    "Some sources could not be read for permission reasons — they are missing from this view, which is not the same as nothing having happened.",
  "workHistory.replay.provenance.errorNote":
    "Some sources failed to load — those lanes are not 'no records'.",

  "workHistory.replay.stats.agents": "agents",
  "workHistory.replay.stats.tasks": "tasks (done/all)",
  "workHistory.replay.stats.merges": "merges",
  "workHistory.replay.stats.prs": "PRs",
  "workHistory.replay.stats.files": "files changed",
  "workHistory.replay.stats.lines": "lines +/-",
  "workHistory.replay.stats.tests": "tests passed",
  "workHistory.replay.stats.risk": "risk flags",
  "workHistory.replay.stats.retries": "retries",
  "workHistory.replay.stats.interventions": "human steps",
  "workHistory.replay.stats.interventionsHint":
    "Actions recorded by a person (spawn, claim, status change).",
  "workHistory.replay.stats.deniedHint":
    "This source could not be read for permission reasons — unknown, not zero.",
  "workHistory.replay.stats.reportsNote":
    "Tests/risk are keyword estimates from completion reports.",
  "workHistory.replay.stats.reportsNoteWindowed":
    "Tests/risk are keyword estimates over the {scanned}/{total} completion reports actually read.",

  "workHistory.replay.lane.all": "All",
  "workHistory.replay.lane.human": "Human",
  "workHistory.replay.lane.orchestrator": "Orchestrator",
  "workHistory.replay.lane.agent": "Agent",
  "workHistory.replay.lane.system": "System",

  "workHistory.replay.sensitivity.private": "private",
  "workHistory.replay.sensitivity.process": "process",
  "workHistory.replay.sensitivity.summary": "summary",
  "workHistory.replay.sensitivity.detail": "detail",
  "workHistory.replay.sensitivity.hint":
    "The visibility tier this item could be shared at later.",
  "workHistory.replay.sensitivity.privateHint":
    "Stays inside the app — it never leaves at any visibility tier.",

  "workHistory.replay.timeline.title": "Timeline",
  "workHistory.replay.timeline.showing": "{shown}/{total} beats",
  "workHistory.replay.timeline.more": "Show more ({count} left)",
  "workHistory.replay.timeline.empty": "Nothing recorded to show.",
  "workHistory.replay.timeline.laneDenied":
    "The '{lane}' lane could not be read for permission reasons — it is not empty.",

  "workHistory.replay.outcome.title": "Outcome",
  "workHistory.replay.outcome.tasksDone": "Tickets done",
  "workHistory.replay.outcome.files": "Files changed",
  "workHistory.replay.outcome.tests": "Tests",
  "workHistory.replay.outcome.testsValue":
    "{count} (over {scanned}/{total} reports)",
  "workHistory.replay.outcome.retries": "Retries",
  "workHistory.replay.outcome.interventions": "Human steps",
  "workHistory.replay.outcome.prs": "PRs",
  "workHistory.replay.outcome.noPrs": "No PR recorded.",

  "workHistory.replay.cast.title": "Per-agent contribution",
  "workHistory.replay.cast.empty": "No agent contribution recorded.",
  "workHistory.replay.cast.agent": "Agent",
  "workHistory.replay.cast.model": "Model",
  "workHistory.replay.cast.role": "Role",
  "workHistory.replay.cast.tasks": "Tasks done",
  "workHistory.replay.cast.beats": "Records",
};
