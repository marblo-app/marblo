/**
 * English — `missions.*` namespace. Typed `Record<keyof typeof koMissions,
 * string>` so a key present in ko but missing here (or vice-versa) is a
 * compile error for this namespace alone.
 */
import type { missions as koMissions } from "../ko/missions";

export const missions: Record<keyof typeof koMissions, string> = {
  // shared confirms / actions
  "missions.cancel": "Cancel",
  "missions.confirmAbandon":
    "End this mission? Any in-progress tasks / agents will be cleaned up.",
  "missions.confirmDeleteTerminal":
    "Permanently delete this mission record? This cannot be undone.",
  "missions.confirmDeleteActive":
    "This mission is still active. Permanent deletion removes the record, and in-progress tasks/agents may not be cleaned up automatically (🛑 Abandon first is recommended). Delete anyway?",

  // template descriptions
  "missions.template.quick-fix.desc":
    "Fix one bug fast — from root-cause tracing through fix, review, and ship",
  "missions.template.polish.desc":
    "Make an existing screen cleaner — design review, then ship",
  "missions.template.feature.desc":
    "Build a planned feature — design review, then build, QA, and ship",
  "missions.template.full-feature.desc":
    "From idea to ship, end to end — through planning, design, and design review",
  "missions.template.research.desc":
    "Direction only, no code changes — dig into requirements and shape the plan & strategy",

  // launch dialog
  "missions.launch.subtitle":
    "Pick a one-line goal and a template — the orchestrator drives it all the way through.",
  "missions.launch.goalLabel": "Goal (one line)",
  "missions.launch.goalPlaceholder": 'e.g. "Build a login page"',
  "missions.launch.templateLabel": "Template",
  "missions.launch.noConnectionHint":
    "With no connected repo, only the mission is created.",
  "missions.launch.goalRequired": "Write your mission goal in one line.",
  "missions.launch.submitting": "Starting...",

  // list
  "missions.list.emptyTitle": "No missions in progress yet.",
  "missions.list.emptyHint":
    "Pick a template below to start your first mission.",
  "missions.list.abandonTitle": "Abandon mission (stop and archive)",
  "missions.list.deleteTitle": "Delete mission (permanent)",

  // tab (MissionsTab shell)
  "missions.tab.noProject": "Select a project to start a mission.",
  "missions.tab.clearArchiveTitle": "Permanently delete all archived missions",
  "missions.tab.clearArchive": "🗑️ Delete all",
  "missions.tab.clearArchiveConfirm":
    "Permanently delete all {count} archived missions? This can't be undone.",
  "missions.tab.noSelection": "No mission selected.",
  "missions.tab.noSelectionHint":
    "Pick a template below to start a new mission.",
  "missions.tab.newMissionHeading": "Start a new mission",
  "missions.tab.newMissionHint":
    "Tap a template to open the one-line goal screen.",

  // relative time (list)
  "missions.time.justNow": "just now",
  "missions.time.secondsAgo": "{count}s ago",
  "missions.time.minutesAgo": "{count}m ago",
  "missions.time.hoursAgo": "{count}h ago",
  "missions.time.daysAgo": "{count}d ago",

  // detail
  "missions.detail.startedAt": "Started {date}",
  "missions.detail.completedAt": "Completed {date}",
  "missions.detail.restart": "🔄 Restart",
  "missions.detail.restartTitle":
    "Start a new mission with the same goal + template",
  "missions.detail.delete": "🗑️ Delete",
  "missions.detail.deleteTitle": "Delete mission permanently",
  "missions.detail.needInput": "🙋 Your input is needed.",
  "missions.detail.needAttention": "Attention needed.",
  "missions.detail.stepStalled":
    "Step {step} ({skill}) is stuck — answer directly in the mission Orchestrator PTY and press Resume.",
  "missions.detail.stepFailed": "Step {step} ({skill}) failed · {error}",
  "missions.detail.checkLastStep":
    "Review the last step result and choose Resume or Abandon.",
  "missions.detail.tasksHeading": "Tasks",
  "missions.detail.noTasks":
    "No tasks dispatched yet. Once a dispatch step runs, mission tasks (🎯) appear here and on the kanban board.",
  "missions.detail.unassigned": "Unassigned",
  "missions.detail.agentPty": "🖥️ Agent PTY",
  "missions.detail.connect": "(connect)",
  "missions.detail.ptyView": "View this task's agent PTY",
  "missions.detail.ptyConnect": "Connect to the agent session",
  "missions.detail.ptyNoSession": "No running PTY session",
  "missions.detail.ptyNoAgent": "No agent assigned yet",
  "missions.detail.timelineEmpty": "The orchestrator will start shortly.",
  "missions.detail.resultCompleted": "📋 Mission result",
  "missions.detail.resultWaiting": "⚠️ Progress so far",
  "missions.detail.resultAbandoned": "🛑 Abandoned mission — results so far",
  "missions.detail.synthesis": "Synthesis report",
  "missions.detail.expand": "Expand",
  "missions.detail.collapse": "Collapse",
  "missions.detail.noStepOutput": "No step has saved output.",
  "missions.detail.outputChars": "output ({count} chars)",
  "missions.detail.awaitingOutput": "Awaiting output... (refreshes every 2s)",
  "missions.detail.noOutput": "No output.",
  "missions.detail.minuteSuffix": "m",
  "missions.detail.secondSuffix": "s",

  // orchestrator panel
  "missions.orch.awaitingInput": "🙋 Awaiting input",
  "missions.orch.preloadStale": "Old preload version (restart needed)",
  "missions.orch.restartTitle":
    "Stop the session and start fresh (use when the PTY is empty)",
  "missions.orch.restarting": "Restarting...",
  "missions.orch.hide": "Hide",
  "missions.orch.show": "Show PTY",
  "missions.orch.starting": "Mission orchestrator starting...",
  "missions.orch.ptyPreparing": "Preparing PTY...",
  "missions.orch.stuckHintPrefix": "If progress seems stuck, type ",
  "missions.orch.stuckHintQuote": "go on to the next step",
  "missions.orch.stuckHintSuffix":
    " in the box above to nudge the orchestrator.",

  // timeline
  "missions.timeline.empty": "No activity yet.",
  "missions.timeline.attempt": "attempt {attempt}",
  "missions.timeline.willRetry": "will retry",
};
