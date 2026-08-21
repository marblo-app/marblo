/**
 * English — `orchestrator.*` namespace. Typed
 * `Record<keyof typeof koOrchestrator, string>` so a key present in ko but
 * missing here (or vice-versa) is a compile error for this namespace alone.
 */
import type { orchestrator as koOrchestrator } from "../ko/orchestrator";

export const orchestrator: Record<keyof typeof koOrchestrator, string> = {
  // Command panel chrome
  "orchestrator.title": "Orchestrator",
  "orchestrator.notRunning": "Orchestrator is not running",
  "orchestrator.sending": "Sending…",
  "orchestrator.board": "Board",
  "orchestrator.aiDecompose": "AI task breakdown",
  "orchestrator.addTask": "Add task",
  "orchestrator.sessionPicker": "Select session",
  "orchestrator.autoStartHint": "(starts automatically when you open a folder)",
  // Spawn blocked by MCP availability, not by login (#639 grok gate).
  "orchestrator.blocked.mcpTitle":
    "Could not start the {model} orchestrator — Marblo MCP tools did not attach",
  "orchestrator.blocked.mcpHint":
    "This is not a login problem. The CLI refuses to start local MCP servers in an untrusted folder, so trust this project folder in that CLI once and start again. An orchestrator without MCP cannot touch the board or dispatch anything.",
  // Spawn blocked by login/install. Shown even when the setup wizard suppresses
  // itself (a user whose Claude is ready but who picked grok as orchestrator).
  "orchestrator.blocked.authTitle":
    "Could not start the {model} orchestrator — this CLI needs to be signed in",
  "orchestrator.blocked.authHint":
    "Another CLI being signed in is not enough: the CLI you picked as orchestrator has its own sign-in. Run the action below, then start again.",
  // Spawn blocked by vendor credentials / prepaid balance (7HthjBEf, DeepSeek).
  // The concrete fix (top up / add key / replace key / check network) comes
  // from main's `action` line; this hint is the shared context above it.
  "orchestrator.blocked.vendorTitle":
    "Could not start the {model} orchestrator — vendor credential / balance problem",
  "orchestrator.blocked.vendorHint":
    "This is not a sign-in problem. This model runs on prepaid vendor credit rather than a subscription, so a zero balance or a missing key stops it even when the CLI is signed in. Do the action above, then refresh (⟳) under Usage → Vendor credits to confirm the balance and start again. We deliberately do not fall back to the default model here: silently running a different backend than the one you picked is far worse.",
  "orchestrator.blocked.login": "Sign in to {model}",
  "orchestrator.blocked.dismiss": "Dismiss",
  // Category labels
  "orchestrator.cat.project": "Start project",
  "orchestrator.cat.project-step": "Step-by-step start",
  "orchestrator.cat.agent": "Agents",
  "orchestrator.cat.work": "Work",
  "orchestrator.cat.pause": "Pause / resume",
  "orchestrator.cat.review": "Review",
  "orchestrator.cat.deploy": "Deploy",
  "orchestrator.cat.sync": "Cleanup",
  "orchestrator.cat.repeat": "Repeat",
  "orchestrator.cat.util": "Utility",
  // Slash command descriptions (display labels — the command id stays English)
  "orchestrator.cmd.tf-plan.desc": "Analyze requirements + plan tasks",
  "orchestrator.cmd.tf-start.desc": "Bulk-create tasks + spawn agents",
  "orchestrator.cmd.tf-analyze.desc": "Analyze requirements",
  "orchestrator.cmd.tf-create-tasks.desc": "Create tasks from analysis",
  "orchestrator.cmd.tf-spawn-agents.desc": "Line up + spawn agents",
  "orchestrator.cmd.tf-spawn.desc": "Spawn a physical agent (terminal tab)",
  "orchestrator.cmd.tf-agent.desc": "Logical subagent (quick research)",
  "orchestrator.cmd.tf-work.desc": "Claim a task + code",
  "orchestrator.cmd.tf-status.desc": "Status dashboard",
  "orchestrator.cmd.tf-add.desc": "Add / edit tasks",
  "orchestrator.cmd.tf-flow.desc": "Design a flow pipeline",
  "orchestrator.cmd.tf-hold.desc": "Pause work + summarize status",
  "orchestrator.cmd.tf-resume.desc": "Resume paused work",
  "orchestrator.cmd.tf-review.desc": "PM code review",
  "orchestrator.cmd.tf-feedback.desc": "Check + answer PM feedback",
  "orchestrator.cmd.tf-fix.desc": "Recover FAILED/BLOCKED",
  "orchestrator.cmd.tf-handoff.desc": "Agent failed → take over directly",
  "orchestrator.cmd.tf-deploy.desc": "Deploy to GCP Cloud Run",
  "orchestrator.cmd.tf-sync.desc": "Sync code ↔ tickets",
  "orchestrator.cmd.tf-done.desc": "Finish project + archive",
  "orchestrator.cmd.tf-ralph.desc": "Batch the same task N times",
  "orchestrator.cmd.tf-guide.desc": "Command guide",

  // OrchestratorChat (AI task-breakdown dialog) — UI shell only; projectName /
  // error.message are runtime data passed in as placeholders.
  "orchestrator.chat.decomposed":
    'Broke "{project}" into {count} tasks. They can run in parallel across {layers} layers.',
  "orchestrator.chat.error": "An error occurred: {error}. Please try again.",
  "orchestrator.chat.unknownError": "Unknown error",
  "orchestrator.chat.created": "Created {count} tasks on the kanban board!",
  "orchestrator.chat.createError": "Error while creating tasks: {error}",
  "orchestrator.chat.emptyTitle":
    "Describe your project requirements in plain language",
  "orchestrator.chat.emptySubtitle":
    "AI breaks them into tasks and builds a dependency graph",
  "orchestrator.chat.decomposing": "Breaking down tasks...",
  "orchestrator.chat.inputPlaceholder":
    "Describe your project requirements... (Shift+Enter for a new line)",

  // DecompositionResult — summary stat labels
  "orchestrator.decomp.title": "Breakdown",
  "orchestrator.decomp.tasks": "Tasks",
  "orchestrator.decomp.layers": "Layers",
  "orchestrator.decomp.dependencies": "Dependencies",
  "orchestrator.decomp.estHours": "Est. time",

  // TaskPreview — editable preview chrome (task title/description are data)
  "orchestrator.preview.newTaskTitle": "New task",
  "orchestrator.preview.execLayers": "Execution layers (DAG)",
  "orchestrator.preview.descPlaceholder": "Description...",
  "orchestrator.preview.done": "Done",
  "orchestrator.preview.edit": "Edit",
  "orchestrator.preview.delete": "Delete",
  "orchestrator.preview.addTask": "+ Add task",
  "orchestrator.preview.taskCount": "{count} tasks",
  "orchestrator.preview.creating": "Creating...",
  "orchestrator.preview.createOnBoard": "Create on board",
};
