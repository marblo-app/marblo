/**
 * English — `activity.*` namespace. Typed `Record<keyof typeof koActivity,
 * string>` so a key present in ko but missing here (or vice-versa) is a
 * compile error for this namespace alone.
 *
 * Only the static UI shell lives here. `{title}` / `{agent}` / `{body}` /
 * `{result}` placeholders carry runtime entry data (task titles, agent
 * messages, tool results, mission summaries) that the app does NOT translate
 * — it is interpolated verbatim.
 */
import type { activity as koActivity } from "../ko/activity";

export const activity: Record<keyof typeof koActivity, string> = {
  "activity.type.taskCreated": "Task created",
  "activity.type.taskClaimed": "Task claimed",
  "activity.type.taskProgress": "Task progress",
  "activity.type.taskCompleted": "Task done",
  "activity.type.taskBlocked": "Task blocked",
  "activity.type.agentSpawned": "Agent spawned",
  "activity.type.pmFeedback": "PM feedback",
  "activity.type.activityNote": "Activity note",
  "activity.type.missionStep": "Mission step",
  "activity.type.missionState": "Mission state",
  "activity.type.missionNote": "Mission note",
  "activity.type.error": "Error",
  "activity.type.other": "Other",

  "activity.headline.taskCreated": 'Task: created "{title}"',
  "activity.headline.taskClaimed": 'Task: claimed by {agent} — "{title}"',
  "activity.headline.taskProgress": 'Task: progress "{title}"',
  "activity.headline.taskCompleted": 'Task: completed "{title}"',
  "activity.headline.taskBlocked": 'Task: blocked "{title}" — {reason}',
  "activity.headline.agentSpawned": "Agent: spawned {name}",
  "activity.headline.agentSpawnedWithTask": 'Agent: spawned {name} → "{task}"',
  "activity.headline.mission": "Mission: {body}",
  "activity.headline.missionNotePrefix": "Mission: {agent} note",
  "activity.headline.notePrefix": "Note: {agent}",
  "activity.headline.pmFeedback": 'PM: feedback on "{title}"',
  "activity.headline.error": "Error: {tool} failed — {result}",

  "activity.label.title": "Title",
  "activity.label.role": "Role",
  "activity.label.description": "Description",
  "activity.label.agent": "Agent",
  "activity.label.task": "Task",
  "activity.label.status": "Status",
  "activity.label.reason": "Reason",
  "activity.label.name": "Name",
  "activity.label.agentId": "Agent ID",
  "activity.label.model": "Model",
  "activity.label.step": "Step",
  "activity.label.state": "State",
  "activity.label.mission": "Mission",
  "activity.label.note": "Note",
  "activity.label.message": "Message",
  "activity.label.comment": "Comment",
  "activity.label.tool": "Tool",

  "activity.fallback.title": "untitled",
  "activity.fallback.reason": "no reason",
  "activity.fallback.role": "agent",
  "activity.fallback.missionStep": "step",
  "activity.fallback.missionState": "state change",
  "activity.fallback.errorResult": "unknown",
  "activity.fallback.noteMessage": "(no message)",

  "activity.time.justNow": "just now",
  "activity.time.minutesAgo": "{n}m ago",
  "activity.time.hoursAgo": "{n}h ago",
  "activity.time.daysAgo": "{n}d ago",

  "activity.ui.openTask": "Open task",
  "activity.ui.viewAgent": "View agent",
  "activity.ui.emptyNoActivity":
    "No activity yet. It will show up here once an agent calls an MCP tool.",
  "activity.ui.emptyNoFilterMatch": "No items match this filter.",
  "activity.ui.footer": "Source: audit_logs · last {count} · ⌘⇧A to toggle",
  "activity.ui.macroNoAgents": "No active agents.",
  "activity.ui.macroNoRecent": "No recent activity.",
  "activity.ui.feedTitle": "Unified Activity Feed",
  "activity.ui.feedCount": "{count} activities",
  "activity.ui.feedAll": "All",
  "activity.ui.feedEmpty": "No activity",
  "activity.ui.feedEmptyShort": "No activity yet",
};
