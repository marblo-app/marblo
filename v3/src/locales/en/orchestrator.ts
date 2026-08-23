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

  // Halt reasons — the orchestrator stopped AFTER it was up (F-4/F-5).
  // Title says what happened; Hint MUST say what to do next. Label is the
  // one-line header form that replaces the bare "Error".
  "orchestrator.halt.restart": "Start again",

  "orchestrator.halt.needsAuthLabel": "Sign-in needed",
  "orchestrator.halt.needsAuthTitle":
    "{model} needs to be signed in — the orchestrator stopped",
  "orchestrator.halt.needsAuthHint":
    "This CLI's sign-in screen came up, so the boot was stopped (nothing was typed into that screen). Press Sign in below to open the login in a terminal tab, then press Start again.",

  "orchestrator.halt.firstRunDialogLabel": "A dialog is waiting",
  "orchestrator.halt.firstRunDialogTitle":
    "A first-run screen — folder trust or similar — is waiting, so the orchestrator stopped",
  "orchestrator.halt.firstRunDialogHint":
    "Answer the question in the terminal below yourself (arrow keys, then Enter). We do not press it for you: sending a key into a screen we cannot identify confirms whichever option happens to be highlighted. If it is still stuck after you answer, press Start again.",

  "orchestrator.halt.rootPathMissingLabel": "Folder missing",
  "orchestrator.halt.rootPathMissingTitle":
    "The working folder is gone, so the orchestrator stopped",
  "orchestrator.halt.rootPathMissingHint":
    "The folder this project pointed at was deleted or moved — common after cleaning up worktrees. Point the project at a path that still exists in the sidebar, then start it.",

  "orchestrator.halt.spawnFailedLabel": "Launch failed",
  "orchestrator.halt.spawnFailedTitle": "Could not launch the orchestrator",
  "orchestrator.halt.spawnFailedHint":
    "The terminal process could not be created. Check that the project folder really exists, then press Start again. If it keeps failing at the same point, check this harness under Settings → CLI connections.",

  "orchestrator.halt.crashLoopLabel": "Keeps exiting",
  "orchestrator.halt.crashLoopTitle":
    "The orchestrator kept exiting, so auto-restart gave up",
  "orchestrator.halt.crashLoopHint":
    "It was restarted three times and exited immediately each time. Press Start again for a fresh session, and if that repeats, start it on a different model.",

  "orchestrator.halt.unknownLabel": "Stopped",
  "orchestrator.halt.unknownTitle": "The orchestrator stopped",
  "orchestrator.halt.unknownHint":
    "We could not identify the reason. Check the last screen in the terminal below if it is still there, then press Start again.",
  // Price tag on the model selector. Only on rows billed per token (env-swap
  // vendors) — native rows run on a subscription, so $/1M is not the bill.
  // Keeps two rows of the same vendor that differ 3× (DeepSeek flash/pro) from
  // looking interchangeable. Rates are peak list price; the off-peak half-price
  // note lives in the Usage tab's model fact sheet.
  "orchestrator.modelPrice": "{in} in / {out} out per 1M",
  "orchestrator.modelPriceTip":
    "{in} input / {out} output per 1M tokens, billed per token against prepaid vendor balance rather than a subscription. Rates shown are peak list price; off-peak is half (see Usage → Model info).",
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
  // ── Work chain (ticket fQtXQ2NzyYs0MRpqByTS) — what the orchestrator does next ──
  "orchestrator.chain.title": "Up next",
  "orchestrator.chain.subtitle":
    "The orchestrator's work chain — completion is judged by board ticket status",
  "orchestrator.chain.toggleShow": "Show",
  "orchestrator.chain.toggleHide": "Hide",
  "orchestrator.chain.countOpen": "open {open}",
  "orchestrator.chain.countReady": "ready {ready}",
  "orchestrator.chain.state.ready": "Ready",
  "orchestrator.chain.state.waiting": "Waiting",
  "orchestrator.chain.state.done": "Done",
  "orchestrator.chain.state.doneSelf": "Done (self-reported)",
  "orchestrator.chain.state.dropped": "Dropped",
  "orchestrator.chain.next": "Next",
  "orchestrator.chain.why": "Why",
  "orchestrator.chain.evidence": "Evidence tickets",
  "orchestrator.chain.waitingOn": "Waiting on",
  "orchestrator.chain.missingTask": "Ticket missing from board",
  "orchestrator.chain.closedReason": "Reason",
  "orchestrator.chain.showClosed": "Show {count} closed",
  "orchestrator.chain.hideClosed": "Hide closed",
  "orchestrator.chain.empty.title": "Nothing queued up yet",
  "orchestrator.chain.empty.hint":
    "The orchestrator picks the next item here after finishing work. You can add one yourself.",
  "orchestrator.chain.empty.create": "Add item",
  "orchestrator.chain.add": "Add item",
  "orchestrator.chain.form.what": "What",
  "orchestrator.chain.form.whatPlaceholder": "e.g. Resume design 3/8",
  "orchestrator.chain.form.why": "Why",
  "orchestrator.chain.form.whyPlaceholder": "e.g. Paused for the urgent deploy — resume right after",
  "orchestrator.chain.form.submit": "Add",
  "orchestrator.chain.form.cancel": "Cancel",
  "orchestrator.chain.form.required": "Both what and why are required",
  "orchestrator.chain.drop": "Drop",
  "orchestrator.chain.dropPrompt": "Why is this no longer valid?",
  "orchestrator.chain.dropReasonRequired": "A reason is required to drop",
  "orchestrator.chain.failed.reason": "Could not load the work chain",
  "orchestrator.chain.failed.permission": "You don't have permission to read the work chain",
  "orchestrator.chain.writeFailed": "Could not save: {error}",
  "orchestrator.chain.noProject": "Open a project to see the chain",
};
