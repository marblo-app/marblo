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

  // Audit log (human actions — owner/admin only)
  "project.audit.heading": "Audit log",
  "project.audit.sourceNote": "In-app member actions, newest first",
  "project.audit.filterActor": "Filter by member",
  "project.audit.filterActorAll": "All members",
  "project.audit.filterType": "Filter by type",
  "project.audit.filterTypeAll": "All types",
  "project.audit.count": "{count} events",
  // An empty panel must say *why* it's empty. A bare "no records" reads as a
  // broken feature — which is exactly how this got reported.
  "project.audit.emptyTitle": "No records yet",
  "project.audit.emptyDesc":
    "The audit log starts collecting from version {version}. Anything that happened before then was never recorded.",
  "project.audit.emptyAgentNote":
    "Tickets moved by agents appear in the activity stream, not here. This table records only what members do in the app themselves — sending chat, changing a ticket's status, and spawning an agent.",
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
