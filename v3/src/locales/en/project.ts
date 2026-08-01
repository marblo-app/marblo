/**
 * English — `project.*` namespace. Typed against the ko counterpart so key
 * drift is a compile-time error.
 */
import type { project as koProject } from "../ko/project";

export const project: Record<keyof typeof koProject, string> = {
  "project.title": "Project",
  "project.subtitle": "Members, roles, and workload in one place",
  "project.memberCount": "{count} members",
  "project.myRole": "My role",

  // No project selected
  "project.noProject.title": "No project selected",
  "project.noProject.desc":
    "Open a project folder first to invite members and see workload.",
  "project.noProject.cta": "Open a project",

  // Workload
  "project.workload.heading": "Workload by member",
  "project.workload.sourceNote": "From agents, tickets, and merge history",
  "project.workload.emptyTitle": "No workload data to show yet",
  "project.workload.emptyDesc":
    "Spawn an agent or claim a ticket and it starts accruing here, per member.",
  "project.workload.rowEmpty": "No activity",
  "project.workload.totalAgents": "Agents",
  "project.workload.colMember": "Member",
  "project.workload.colAgents": "Agents",
  "project.workload.colInProgress": "In progress",
  "project.workload.colReview": "Review",
  "project.workload.colDone": "Done",
  "project.workload.colStuck": "Stuck",
  "project.workload.colMerges": "Merges",
  "project.workload.colLastActive": "Last active",
  "project.workload.unattributed": "Unattributed",
  "project.workload.unattributedHint":
    "Items with no claimant, owned by an agent whose member has left, or whose owner can't be determined because agent names collide.",

  // Audit log (human + orchestrator actions, merged — owner/admin only)
  "project.audit.heading": "Audit log",
  "project.audit.sourceNote": "Member and agent actions, newest first",
  "project.audit.filterActor": "Filter by member",
  "project.audit.filterActorAll": "All members",
  "project.audit.filterType": "Filter by type",
  "project.audit.filterTypeAll": "All types",
  "project.audit.filterTypeHumanGroup": "Member actions",
  "project.audit.filterTypeAgentGroup": "Agent actions (MCP tools)",
  "project.audit.count": "{count} events",
  // Human vs agent. Blur the two and "she moved 40 tickets" reads as her doing
  // it by hand, when an agent she dispatched did the moving.
  "project.audit.actor.human": "Person",
  "project.audit.actor.agentHint":
    "Done by an agent. The name next to it is the member who dispatched that agent.",
  "project.audit.actor.agentModelUnknown": "model unknown",
  "project.audit.actor.unknown": "Unattributed",
  "project.audit.failed": "failed",
  // Per-source partial failure — denial and breakage get different wording.
  "project.audit.notice.humanDenied":
    "Member action records are missing: you can't view them. The list below has agent actions only.",
  "project.audit.notice.agentDenied":
    "Agent action records are missing: you can't view them. The list below has member actions only.",
  "project.audit.notice.humanError":
    "Couldn't load member action records. They're missing from the list below.",
  "project.audit.notice.agentError":
    "Couldn't load agent action records. They're missing from the list below.",
  // An empty panel must say *why* it's empty. A bare "no records" reads as a
  // broken feature — which is exactly how this got reported.
  "project.audit.emptyTitle": "No records yet",
  "project.audit.emptyDesc":
    "The audit log starts collecting from version {version}. Anything that happened before then was never recorded.",
  "project.audit.emptyAgentNote":
    "This table records both what members do in the app themselves — sending chat, changing a ticket's status, spawning an agent — and what agents do through MCP tools. Work done outside the app, or file edits that never went through an MCP tool, is not recorded here.",
  "project.audit.emptyFilteredTitle": "No records match",
  "project.audit.emptyFilteredDesc":
    'Nothing matches the selected member and type. Reset the filters to "All" to see every record that exists.',
  "project.audit.denied": "You can't view the audit log",
  "project.audit.deniedDesc":
    "Member action records are visible to owners and admins only.",
  "project.audit.error": "Couldn't load the audit log",
  "project.audit.retry": "Retry",
  "project.audit.type.chatMessageSent": "Chat sent",
  "project.audit.type.agentSpawned": "Agent spawned",
  "project.audit.type.taskClaimed": "Ticket claimed",
  "project.audit.type.taskStatusChanged": "Status changed",
  "project.audit.type.unknown": "Unknown",

  // Presence
  "project.presence.online": "Online",
  "project.presence.idle": "Idle",
  "project.presence.offline": "Offline",

  // Relative time
  "project.time.justNow": "just now",
  "project.time.minsAgo": "{count}m ago",
  "project.time.hoursAgo": "{count}h ago",
  "project.time.daysAgo": "{count}d ago",
};
