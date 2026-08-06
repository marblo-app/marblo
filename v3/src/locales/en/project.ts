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
  // Manual re-open entry point (ticket r8vg9pMWCRtdnUzR3KyX). Members who
  // dismissed the auto-modal or were auto-registered to an empty folder
  // can re-open the connect-repo modal from here.
  "project.repoConnectCta": "Connect repository",

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
  // Low-signal (Telegram sends, memos) default-hidden toggle. Capture is
  // untouched — this only affects display.
  "project.audit.lowSignalToggle": "Include Telegram/memos",
  "project.audit.lowSignalHiddenCount": " ({count} hidden)",
  "project.audit.lowSignalOnlyEmpty":
    "No high-signal events — {count} Telegram/memo events are hidden. Click to show.",
  // Human vs agent. Blur the two and "she moved 40 tickets" reads as her doing
  // it by hand, when an agent she dispatched did the moving.
  "project.audit.actor.human": "Person",
  "project.audit.actor.agentHint":
    "Done by an agent. The name next to it is the member who dispatched that agent.",
  "project.audit.actor.agentModelUnknown": "model unknown",
  // The orchestrator calling an MCP tool directly, with no spawned agent.
  // Kept distinct from "model unknown" (which reads as an error) — this is a
  // normal, expected category.
  "project.audit.actor.orchestrator": "Orchestrator action",
  "project.audit.actor.orchestratorHint":
    "Done by the orchestrator directly calling an MCP tool, with no spawned agent (no model).",
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

  // Agent (tool) labels — the raw toolName used to print verbatim in the audit
  // view; this translates it into something a person can read (owner
  // dogfooding feedback). The raw toolName isn't hidden — it moves to the
  // badge's title (hover) for anyone who needs to cross-reference it.
  "project.audit.tool.acknowledgeFeedback": "Acknowledged feedback",
  "project.audit.tool.addActivity": "Note",
  "project.audit.tool.addPendingInstruction": "Queued instruction",
  "project.audit.tool.answerQuestion": "Answered question",
  "project.audit.tool.askOrchestrator": "Asked orchestrator",
  "project.audit.tool.checkFeedback": "Checked feedback",
  "project.audit.tool.claimTask": "Claimed task",
  "project.audit.tool.cleanupAgents": "Cleaned up agents",
  "project.audit.tool.createFlow": "Created flow",
  "project.audit.tool.createTask": "Created task",
  "project.audit.tool.createTasksBulk": "Bulk-created tasks",
  "project.audit.tool.deleteTask": "Deleted task",
  "project.audit.tool.dispatchTask": "Dispatched task",
  "project.audit.tool.escalateToOwner": "Escalated to owner",
  "project.audit.tool.getAgentSkill": "Read agent skill",
  "project.audit.tool.getAgents": "Listed agents",
  "project.audit.tool.getAllTasks": "Listed tasks",
  "project.audit.tool.getAvailableTasks": "Listed available tasks",
  "project.audit.tool.getFlows": "Listed flows",
  "project.audit.tool.getLedgerSpoolStatus": "Checked ledger spool status",
  "project.audit.tool.getModelGuidance": "Read model guidance",
  "project.audit.tool.getOpenQuestions": "Listed open questions",
  "project.audit.tool.getPendingInstructions": "Listed pending instructions",
  "project.audit.tool.getProjection": "Read projection",
  "project.audit.tool.getRoutingEffectiveness": "Read routing effectiveness",
  "project.audit.tool.getTaskActivities": "Listed task activity",
  "project.audit.tool.getTaskDependencies": "Listed task dependencies",
  "project.audit.tool.getTask": "Read task",
  "project.audit.tool.getWorktreeAudit": "Read worktree audit",
  "project.audit.tool.killAgent": "Killed agent",
  "project.audit.tool.listWorktreeAudit": "Listed worktree audit",
  "project.audit.tool.markInstructionDelivered": "Marked instruction delivered",
  "project.audit.tool.mergeAndClose": "Merged and closed",
  "project.audit.tool.missionStepDone": "Completed mission step",
  "project.audit.tool.requestModelEscalation": "Requested model escalation",
  "project.audit.tool.resolveModelEscalation": "Resolved model escalation",
  "project.audit.tool.reuseAgent": "Reused agent",
  "project.audit.tool.runSkill": "Ran skill",
  "project.audit.tool.searchTasks": "Searched tasks",
  "project.audit.tool.sendTelegramMessage": "Sent Telegram message",
  "project.audit.tool.spawnAgent": "Spawned agent",
  "project.audit.tool.submitForReview": "Submitted for review",
  "project.audit.tool.updateFlow": "Updated flow",
  "project.audit.tool.updateTaskStatus": "Changed status",

  // Noise folding — consecutive add_activity on the same ticket collapses
  // into one group. Capture is untouched (the ledger is immutable);
  // expanding shows every original row again.
  "project.audit.group.badge": "Note bundle",
  "project.audit.group.count": "{count} events",
  "project.audit.group.expand": "Expand",
  "project.audit.group.collapse": "Collapse",
  "project.audit.worktreeArchived": "Archived",
  "project.audit.worktreeArchivedTip":
    "The ledger records worktreeId ({worktreeId}), but the current worktree list has no live match. It may have been removed after merge/prune, so this button stays disabled.",

  // Operator view — problems first, mission/ticket grouping, link cluster.
  "project.audit.admin.attentionTitle": "{count} need attention",
  "project.audit.admin.attentionNone": "Nothing needs a human right now",
  "project.audit.admin.attentionScopeNote":
    "Across everything loaded, filters ignored",
  "project.audit.admin.attentionMore": "+{count} more",
  "project.audit.admin.reason.taskFailed": "Ended in failure",
  "project.audit.admin.reason.taskBlocked": "Blocked",
  "project.audit.admin.reason.failedActions": "{count} failed calls",
  "project.audit.admin.reason.orphanedClaim": "Orphaned claim",
  "project.audit.admin.reason.orphanedClaimTip":
    "The agent that claimed this ticket ({agentId}) is not in the list of running agents.",
  "project.audit.admin.reason.stalled": "No change for {hours}h",
  "project.audit.admin.reassign": "Reassign on board",
  "project.audit.admin.review": "Review history",

  "project.audit.admin.workloadTitle": "Actions per member",
  "project.audit.admin.workloadNote": "Project-wide tally · click to filter",
  "project.audit.admin.workloadAll": "All",
  "project.audit.admin.workloadUnattributed": "Unattributed",
  "project.audit.admin.workloadUnattributedTip":
    "Records with no actor uid (written before the ledger extension). No server-side filter is possible, so this filters within the loaded window only.",
  "project.audit.admin.workloadTile": "{actions} actions",
  "project.audit.admin.workloadWindowScopeTip":
    "This count comes from the loaded records only, not the project-wide tally.",

  "project.audit.admin.filterActorKind": "Actor axis",
  "project.audit.admin.filterActorKindAll": "Human + orchestrator + agent",
  "project.audit.admin.filterActorKindHuman": "Humans only",
  "project.audit.admin.filterActorKindOrchestrator": "Orchestrator only",
  "project.audit.admin.filterActorKindAgent": "Agents only",
  "project.audit.admin.filterStatus": "Ticket status",
  "project.audit.admin.filterStatusAll": "All statuses",
  "project.audit.admin.filterMission": "Mission",
  "project.audit.admin.filterMissionAll": "All missions",
  "project.audit.admin.filterHidden": "{count} hidden by filters",
  "project.audit.admin.filterReset": "Reset filters",

  "project.audit.admin.boardSection": "Board",
  "project.audit.admin.boardSectionNote": "Tickets not tied to a mission",
  "project.audit.admin.missionProgress": "{done}/{total} done",
  "project.audit.admin.missionProgressUnknown": " ({count} unknown)",
  "project.audit.admin.missionSummary": "{tickets} tickets · {actions} actions",

  "project.audit.admin.ticketSummary": "{actions} actions · {actors} actors",
  "project.audit.admin.noTicketTitle": "Records with no ticket",
  "project.audit.admin.noTicketNote": "Chat, lookups and other untied records",
  "project.audit.admin.statusUnknown": "Status unknown",
  "project.audit.admin.linkTicket": "Ticket detail",
  "project.audit.admin.linkPr": "PR",
  "project.audit.admin.expand": "Expand history",
  "project.audit.admin.collapse": "Collapse history",
  "project.audit.admin.emptySection": "No tickets match these filters",
  "project.audit.detail.toggle": "Show saved params and result",
  "project.audit.detail.ticketToggle": "What changed and how",
  "project.audit.detail.params": "Tool params",
  "project.audit.detail.prompt": "Prompt",
  "project.audit.detail.result": "Tool result",
  "project.audit.detail.lastActivity": "Last activity",
  "project.audit.detail.resolution": "Resolution summary",
  "project.audit.detail.links": "PR and worktree diff",

  // Ticket ledger detail (click a ticket in the audit log) — ticket
  // U6ITRR38Z3c4MGLyg2PU.
  "project.audit.ticket.subtitle": "This ticket's full history, newest first",
  "project.audit.ticket.partialNotice":
    "Some sources are missing due to permissions or an error — check the notices in the main list.",
  "project.audit.ticket.empty": "No records for this ticket.",
  "project.audit.ticket.sealHint":
    "Chain sealing (seq/prevHash/hash) isn't wired up yet — every row is unsealed.",
  "project.audit.ticket.sealed": "Sealed",
  "project.audit.ticket.unsealed": "Unsealed",
  // "No pretending to be certain" — old records missing the field entirely
  // get different wording than ones where the field exists but is
  // unresolved.
  "project.audit.ticket.worktreePreLedger": "Predates ledger extension",
  "project.audit.ticket.worktreeOutOfConvention": "Outside worktree convention",
  "project.audit.ticket.viewCode": "View code",
  "project.audit.ticket.viewReplay": "View replay",

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
