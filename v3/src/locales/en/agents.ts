/**
 * English — `agents.*` namespace. Typed against the ko counterpart so key
 * drift is a compile-time error.
 */
import type { agents as koAgents } from "../ko/agents";

export const agents: Record<keyof typeof koAgents, string> = {
  "agents.dashboard.title": "Agent Dashboard",
  "agents.dashboard.addAgent": "Add Agent",
  "agents.dashboard.cleanup": "Cleanup",
  "agents.dashboard.cleanupConfirm":
    "Delete {count} inactive agents?\n(working agents are kept)",
  "agents.dashboard.loading": "Loading agents...",

  // ── Usage Dashboard ─────────────────────────────────────────
  "agents.usage.note.claude":
    "Max plan: unlimited (5-min cooldown) / Pro: daily limits apply",
  "agents.usage.note.gpt": "ChatGPT subscription — rate-limit based",
  "agents.usage.note.gemini": "Free: 15 RPM, 1M TPM / Paid: unlimited",
  "agents.usage.empty": "Add an agent to see usage here.",
  "agents.usage.gauge.rateLimit": "Plan: {planLabel} · limit usage",
  "agents.usage.gauge.activity": "Plan: {planLabel} · activity",
  "agents.usage.level.idle": "Idle",
  "agents.usage.level.low": "Low",
  "agents.usage.level.medium": "Medium",
  "agents.usage.level.high": "High",
  "agents.usage.hiddenNotice":
    "Totals include every agent, including hidden rows.",
  "agents.usage.showOlder": "Show {count} older",
  "agents.usage.hideOlder": "Hide older",
  "agents.usage.noVisibleAgents":
    "No active agents or usage from the last 7 days.",
  "agents.usage.submodelAgentCount": "Summed across {n} agents",

  // ── Guide: CLI comparison table ─────────────────────────────
  "agents.guide.cliCompare.title": "AI CLI Comparison",
  "agents.guide.cliCompare.col.model": "Model",
  "agents.guide.cliCompare.col.free": "Free Usage",
  "agents.guide.cliCompare.col.strength": "Strengths",
  "agents.guide.cliCompare.col.install": "Install",
  "agents.guide.cliCompare.claude.free": "Included with Pro/Max plan",
  "agents.guide.cliCompare.claude.strength":
    "Code quality, architecture design, complex refactoring",
  "agents.guide.cliCompare.codex.free": "$5 credit for new users",
  "agents.guide.cliCompare.codex.strength":
    "Fast iteration, API integration, simple fixes",
  "agents.guide.cliCompare.gemini.free": "15 RPM free",
  "agents.guide.cliCompare.gemini.strength":
    "Long context (1M), large-scale code analysis",

  // ── Guide: which agent to use ───────────────────────────────
  "agents.guide.which.title": "Which agent should I use?",
  "agents.guide.which.claude.0": "Complex architecture design/refactoring",
  "agents.guide.which.claude.1": "Code review + security analysis",
  "agents.guide.which.claude.2": "Features requiring multi-file changes",
  "agents.guide.which.claude.3":
    "MCP tool integration (Marblo task management)",
  "agents.guide.which.codex.0": "Fast bug fixes + hotfixes",
  "agents.guide.which.codex.1": "Adding API endpoints",
  "agents.guide.which.codex.2": "Writing test code",
  "agents.guide.which.codex.3": "Simple CRUD implementation",
  "agents.guide.which.gemini.0": "Large codebase analysis (1M token context)",
  "agents.guide.which.gemini.1": "Documentation generation + code explanation",
  "agents.guide.which.gemini.2":
    "Understanding legacy code + migration planning",
  "agents.guide.which.gemini.3": "Repetitive tasks that need cost savings",

  // ── Guide: multi-agent strategy ─────────────────────────────
  "agents.guide.strategy.title": "Multi-Agent Strategy",
  "agents.guide.strategy.independent.title": "Independent Agents (Split)",
  "agents.guide.strategy.independent.when":
    "When working on different files/modules at the same time",
  "agents.guide.strategy.independent.example":
    "Run a frontend agent and a backend agent separately for parallel development",
  "agents.guide.strategy.independent.tip":
    "Clearly separate each agent's scope to avoid Git conflicts",
  "agents.guide.strategy.mixed.title": "Mixed-Model Strategy",
  "agents.guide.strategy.mixed.when":
    "When you need to balance cost optimization with quality",
  "agents.guide.strategy.mixed.example":
    "Design architecture with Claude → iterate with Codex → review code with Gemini",
  "agents.guide.strategy.mixed.tip":
    "Use Claude for complex work and Codex/Gemini for simple repetition to cut costs",
  "agents.guide.strategy.single.title": "Single Agent (Focused)",
  "agents.guide.strategy.single.when": "When focusing on one complex task",
  "agents.guide.strategy.single.example":
    "Large-scale refactoring, full implementation of a new feature",
  "agents.guide.strategy.single.tip":
    "For context-heavy work, it's more efficient to use a single agent",

  // ── Guide: setup instructions ───────────────────────────────
  "agents.guide.setup.title": "Setup Guide",
  "agents.guide.setup.step1.title": "Install CLI",
  "agents.guide.setup.step1.code":
    "curl -fsSL https://claude.ai/install.sh | bash        # Claude\ncurl -fsSL https://chatgpt.com/codex/install.sh | sh   # Codex\nnpm install -g @google/gemini-cli                      # Gemini",
  "agents.guide.setup.step2.title": "Configure Authentication",
  "agents.guide.setup.step2.code":
    "# Claude: ANTHROPIC_API_KEY env var or Pro/Max plan\n# Codex:  run codex, then OAuth browser sign-in\n# Gemini: get an API key from Google AI Studio",
  "agents.guide.setup.step3.title": "Add an Agent in Marblo",
  "agents.guide.setup.step3.code":
    "# 1. Click the 'Add Agent' button\n# 2. Pick a name, model, and role\n# 3. MCP connects automatically — task management ready to use",

  // ── Setup Guide (empty state) ───────────────────────────────
  "agents.setupGuide.empty": "No agents yet",
  "agents.setupGuide.addFirst": "+ Add your first agent",
  "agents.setupGuide.preInstall": "Pre-Install Guide",
  "agents.setupGuide.preInstallDesc":
    "To run an agent, the corresponding AI CLI must be installed on your system.",
  "agents.setupGuide.install": "Install",
  "agents.setupGuide.run": "Run",
  "agents.setupGuide.note.claude":
    "Anthropic API key required (ANTHROPIC_API_KEY)",
  "agents.setupGuide.note.codex": "OpenAI API key required (OPENAI_API_KEY)",
  "agents.setupGuide.note.gemini": "Google AI API key required",
  "agents.setupGuide.mcp.title": "MCP Connection (Optional)",
  "agents.setupGuide.mcp.desc":
    "Connect the CLI directly to MCP from your terminal to manage tickets without an agent.",
  "agents.setupGuide.mcp.codeComment": "Claude Code MCP setup (~/.claude.json)",
  "agents.setupGuide.mcp.pathPlaceholder": "{v3 path}",

  // ── Add Agent modal ─────────────────────────────────────────
  "agents.addModal.model.local": "Local Model (Ollama, etc.)",
  "agents.addModal.model.custom": "Custom (manual entry)",
  "agents.addModal.localHint":
    "Change the CLI command to match your setup (ollama / lms / llama, etc.)",
  "agents.addModal.localModel": "Local model (installed via ollama)",
  "agents.addModal.localModelHint":
    "(measured via ollama list — only installed models are selectable)",
  "agents.addModal.localModelNone":
    "No local models installed. Install one from Store → Local models.",
  "agents.addModal.localModelLoading": "Checking installed local models…",
  "agents.addModal.name": "Name",
  "agents.addModal.modelSelect": "Select Model",
  "agents.addModal.role": "Role",
  "agents.addModal.command": "CLI Command",
  "agents.addModal.commandHint": "(auto-set by model, manually editable)",
  "agents.addModal.cwd": "Working Directory",
  "agents.addModal.selectFolder": "Select folder",
  "agents.addModal.taskAssign": "Task Assignment",
  "agents.addModal.optional": "(optional)",
  "agents.addModal.noTask": "Start without a task (interactive)",
  "agents.addModal.noTasksAvail":
    "No assignable tasks. Create one on the board first.",
  "agents.addModal.initPrompt": "Initial Prompt",
  "agents.addModal.initPromptHint":
    "(optional, leave empty to start interactively)",
  "agents.addModal.promptPlaceholder": "Enter what you want the agent to do...",

  // ── Status labels ───────────────────────────────────────────
  "agents.status.working": "Active",
  "agents.status.idle": "Idle",
  "agents.status.error": "Error",
  "agents.status.stopped": "Stopped",

  // ── Shared stats ────────────────────────────────────────────
  "agents.stats.done": "Done",
  "agents.stats.inProgress": "In progress",

  // ── Relative / duration time ────────────────────────────────
  "agents.time.justNow": "just now",
  "agents.time.minsAgo": "{count}m ago",
  "agents.time.hoursAgo": "{count}h ago",
  "agents.time.daysAgo": "{count}d ago",
  "agents.time.minutes": "{count}m",
  "agents.time.hoursMinutes": "{hours}h {mins}m",

  // ── Agent status card ───────────────────────────────────────
  "agents.statusCard.deleteConfirm": 'Delete agent "{name}"?',
  "agents.statusCard.deleteTitle": "Delete agent",
  "agents.statusCard.currentTask": "Current task",

  // ── Member card ─────────────────────────────────────────────
  "agents.member.currentWork": "Current task",
  "agents.member.model": "Model",
  "agents.member.recentDone": "Recently completed",
  "agents.member.inProgressWork": "In progress",

  // ── Attention badge ─────────────────────────────────────────
  "agents.attention.awaiting": "Awaiting input",
  "agents.attention.awaitingTitle": "The agent is waiting for your input",

  // ── Input-wait notification (top right) ─────────────────────
  "agents.inputWait.title": "{name} is waiting for you",
  "agents.inputWait.confirmBody":
    "A confirmation prompt is up — nothing proceeds until it is answered.",
  "agents.inputWait.promptBody":
    "It has stopped at its prompt. Open the terminal to tell it what to do next.",
  "agents.inputWait.open": "Open terminal",
  "agents.inputWait.dismiss": "Dismiss",

  // ── Team dashboard ──────────────────────────────────────────
  "agents.team.title": "Team Dashboard",
  "agents.team.project": "Project",
  "agents.team.members": "{count} members",
  "agents.team.online": "{count} online",
  "agents.team.doneToday": "Done today",
  "agents.team.doneThisWeek": "Done this week",
  "agents.team.avgTime": "Avg. completion time",
  "agents.team.membersHeading": "Members",
  "agents.team.noAgents": "No agents registered",
  "agents.team.activity": "Activity",

  // ── Team summary ────────────────────────────────────────────
  "agents.summary.totalTasks": "Total tasks",
  "agents.summary.unit": "agents",
  "agents.summary.none": "No agents on the job yet",

  // ── Terminal fleet cell ─────────────────────────────────────
  "agents.terminalCell.closeConfirm": 'Close terminal "{name}"?',
  "agents.terminalCell.ariaLabel":
    "{name} terminal — press Enter or double-click for details",
  "agents.terminalCell.title":
    "{name} — single click = select, Enter/double-click = details below",
  "agents.terminalCell.closeTitle":
    "Close terminal (PTY kill + remove persisted entry)",
  "agents.terminalCell.closeAria": "Close {name} terminal",

  // ── Agent fleet cell ────────────────────────────────────────
  "agents.fleetCell.deleteConfirm": 'Delete agent "{name}"?',
  "agents.fleetCell.ariaLabel":
    "{name} — press Enter or double-click for details",
  "agents.fleetCell.title":
    "{name} — single click = select, Enter/double-click = details below",
  "agents.fleetCell.startTitle": "Start session (cold restart — new PTY)",
  "agents.fleetCell.startAria": "Start {name} session",
  "agents.fleetCell.start": "▶ Start",
  "agents.fleetCell.deleteTitle":
    "Delete agent (stop PTY + remove Firestore doc)",
  "agents.fleetCell.deleteAria": "Delete {name} agent",

  // ── Agent fleet grid ────────────────────────────────────────
  "agents.fleetGrid.addHint": "Add one with the Add Agent button above",
  "agents.fleetGrid.ariaLabel":
    "Agent grid — arrow keys to move, Enter for details",

  // ── Agent list panel ────────────────────────────────────────
  "agents.listPanel.noTerminal": "No terminal is connected to this agent.",
  "agents.listPanel.startNewSession": "Start a new session?",
  "agents.listPanel.newSessionTitle":
    "Kill the existing PTY and start a new CLI session (no resume)",
  "agents.listPanel.cliHint":
    "If no session appears, check whether the CLI is installed in your console (claude / codex / gemini).",
  "agents.listPanel.focusedAgent": "Focused Agent",
  "agents.listPanel.activeAgents": "Active Agents",
  "agents.listPanel.killAll": "Kill all",
  "agents.listPanel.killAllTitle": "Kill all active agents",
  "agents.listPanel.cleanupStopped": "Clean stopped",
  "agents.listPanel.cleanupStoppedTitle": "Remove stopped agents from the list",
  "agents.listPanel.spawnTerminal": "+ Terminal",
  "agents.listPanel.spawnTerminalTitle":
    "Spawn a shell terminal in the project folder",
  "agents.listPanel.confirmRemoveStopped": 'Remove stopped agent "{name}"?',
  "agents.listPanel.confirmKill": 'Kill agent "{name}"?',
  "agents.listPanel.confirmKillAll": "Kill {count} active agents?",
  "agents.listPanel.confirmCleanupStopped": "Remove {count} stopped agents?",

  // ── Agent row ───────────────────────────────────────────────
  "agents.row.agentTitle":
    "↑/↓: move · Enter / → / click: focus · double-click: Agents tab",
  "agents.row.terminalTitle": "↑/↓: move · Enter: focus terminal",
  "agents.row.removeStoppedTitle": "Remove this stopped agent",
  "agents.row.killSessionTitle": "Kill this agent session",
  "agents.row.cleanup": "Clean",
  "agents.row.kill": "Kill",

  // ── Close (X) — row / focus header ──────────────────────────
  "agents.close.rowAria": "Close {name}",
  "agents.close.rowAgentTitle": "Close — end the session and remove it here",
  "agents.close.rowTerminalTitle": "Close terminal (kills the PTY)",
  "agents.close.confirmTitle": "Close a working agent?",
  "agents.close.confirmBody":
    '"{name}" is working right now. Closing ends its session and removes it from the list.',
  "agents.close.confirmWarning": "Work in progress cannot be recovered.",
  "agents.close.confirm": "Close",
  "agents.close.cancel": "Cancel",

  // ── Focus view ──────────────────────────────────────────────
  "agents.focus.backTitle": "Back to list (← / Esc)",
  "agents.focus.renameTitle": "Rename (Ctrl+R)",
  "agents.focus.newSessionTitle":
    "Kill the current PTY and start a new CLI session",
  "agents.focus.prevTitle": "Previous agent",
  "agents.focus.nextTitle": "Next agent (→)",

  // ── Agents tab ──────────────────────────────────────────────
  "agents.tab.limitReached": "Agent limit reached",
  "agents.tab.activeCount": "Active agents {active} / {limit}",
  "agents.tab.plan": "plan",
  "agents.tab.atLimitHint": "Limit reached — upgrade or stop an existing agent",
  "agents.marbloBots.title": "Marblo Bots",
  "agents.marbloBots.subtitle":
    "Bots are specialist workers that the Orchestrator calls when needed. You can run one directly, but the default flow is to talk to the Orchestrator.",
  "agents.marbloBots.primer.line1": "Talk to the Orchestrator",
  "agents.marbloBots.primer.line2":
    "→ The Orchestrator calls a bot when needed",
  "agents.marbloBots.primer.line3": "→ The bot works in an isolated worktree",
  "agents.marbloBots.primer.details": "Details",
  "agents.marbloBots.primer.detail1":
    "You can save and run a bot directly, but the primary flow is to tell the Orchestrator the goal; the Orchestrator picks the right bot, creates a board ticket, and dispatches a physical agent.",
  "agents.marbloBots.primer.detail2":
    "Bot runs use the existing create_task / dispatch_task path and leave a source marker on the linked ticket.",
  "agents.marbloBots.knowledgeRoot": "Knowledge root_path",
  "agents.marbloBots.rootMissing": "Connect a project folder first",
  "agents.marbloBots.runMission": "Mission for this run",
  "agents.marbloBots.runPlaceholder":
    "Leave empty to run the bot's default Mission.",
  "agents.marbloBots.runnableSeeds": "Runnable seeds",
  "agents.marbloBots.storageScope": "Storage scope: per-project botDefinitions",
  "agents.marbloBots.saveAgain": "Save again",
  "agents.marbloBots.saveToProject": "Save to project",
  "agents.marbloBots.saveAndRun": "Save and run",
  "agents.marbloBots.savedBots": "Saved bots",
  "agents.marbloBots.savedEmpty": "No saved bots yet.",
  "agents.marbloBots.runSaved": "Assign this bot",
  "agents.marbloBots.newBot": "Save a new bot",
  "agents.marbloBots.name": "Name",
  "agents.marbloBots.model": "Model",
  "agents.marbloBots.role": "Role",
  "agents.marbloBots.knowledgeUse": "Use Knowledge",
  "agents.marbloBots.save": "Save",
  "agents.marbloBots.omitted": "Bots omitted in this phase",
  "agents.marbloBots.copy": "Copy",
  "agents.marbloBots.copied": "Copied",
  "agents.marbloBots.required": "Required",
  "agents.marbloBots.evidence": "MCP evidence",
  "agents.marbloBots.persona": "Persona",
  "agents.marbloBots.mission": "Mission",
  "agents.marbloBots.knowledgeBadge": "Knowledge",
  "agents.marbloBots.wikiQueryRoot": "wiki_query root_path",
  "agents.marbloBots.section.bots": "Bot gallery",
  "agents.marbloBots.section.agents": "Bot runs",
  "agents.marbloBots.section.triggers": "Triggers",
  "agents.marbloBots.tabAria": "Marblo Bots tab",
  "agents.marbloBots.loginRequired": "Sign in to save bot definitions.",
  "agents.marbloBots.triggersTitle": "Schedules and condition triggers",
  "agents.marbloBots.triggersBody":
    "The execution engine already exists; this screen will enable it in a follow-up ticket.",
  "agents.triggers.copy": "Copy",
  "agents.triggers.copyFailed": "Could not copy.",
  "agents.triggers.webhook.title": "Webhook condition",
  "agents.triggers.webhook.enable": "Detect external webhook events",
  "agents.triggers.webhook.pollMinutes": "pollMinutes",
  "agents.triggers.webhook.pollOutOfRange":
    "Webhook poll interval must be between 1 and 60 minutes.",
  "agents.triggers.webhook.url": "Receiver URL",
  "agents.triggers.webhook.notIssued": "Not issued yet.",
  "agents.triggers.webhook.issue": "Issue URL",
  "agents.triggers.webhook.rotate": "Rotate URL and secret",
  "agents.triggers.webhook.issued":
    "Issued the webhook URL and signing secret.",
  "agents.triggers.webhook.rotated":
    "Rotated the webhook URL and signing secret.",
  "agents.triggers.webhook.issueFailed": "Failed to issue webhook URL.",
  "agents.triggers.webhook.urlCopied": "Webhook URL copied.",
  "agents.triggers.webhook.secretCopied": "Webhook secret copied.",
  "agents.triggers.webhook.secretMasked": "Stored secret: {secret}",
  "agents.triggers.webhook.signatureHint":
    "Requests use POST JSON, and the x-marblo-signature header is ts=<unix>;h1=<HMAC-SHA256(secret, ts + ':' + rawBody)>. The raw secret is shown only immediately after issue or rotation. The Orchestrator receives only the sanitized event.",
  // ── Apps Script (Google Sheets new rows -> webhook). Zero-scope path. ──
  "agents.triggers.appsScript.title": "Google Sheets new rows (Apps Script)",
  "agents.triggers.appsScript.description":
    "Marblo does not read your sheet. Instead, the script below - pasted into your sheet - detects new rows and calls the webhook URL above. It needs no Google permission from us and works the same on Windows.",
  "agents.triggers.appsScript.stepCount":
    "One step here, five in Google - six in total. You only do this once.",
  "agents.triggers.appsScript.needsWebhook":
    "First press [Issue URL] above to create the receiver URL and secret.",
  "agents.triggers.appsScript.needsSecret":
    "The raw secret is shown only right after issue or rotation, so the script cannot be generated now. Press [Rotate URL and secret] to get a fresh secret and a script for it. Note: rotating makes a previously pasted script fail with 401, so you must replace it with the new one.",
  "agents.triggers.appsScript.sheetName": "Sheet name (optional)",
  "agents.triggers.appsScript.sheetNameHint":
    "Leave empty to watch the first sheet. Example: Form Responses 1",
  "agents.triggers.appsScript.interval": "How often the sheet is checked",
  "agents.triggers.appsScript.intervalOption": "every {minutes} minutes",
  "agents.triggers.appsScript.intervalHint":
    "Only values Apps Script time triggers accept are offered. Note: this interval lives in the pasted script, not in Marblo - to change it later, regenerate and re-paste the script, or edit MARBLO_INTERVAL_MINUTES in the Apps Script editor and run marbloInstall again. An onChange accelerator reports added rows within about a minute anyway, so 5 minutes is a good default.",
  "agents.triggers.appsScript.script": "Script to paste",
  "agents.triggers.appsScript.copy": "Copy script",
  "agents.triggers.appsScript.copied": "Script copied.",
  "agents.triggers.appsScript.secretWarning":
    "This script contains the raw webhook secret. Anyone who can edit the sheet can read it, so paste it only into a sheet whose editors you trust.",
  "agents.triggers.appsScript.stepsTitle": "Five steps inside Google",
  "agents.triggers.appsScript.step1":
    "In the sheet menu, open Extensions -> Apps Script.",
  "agents.triggers.appsScript.step2":
    "Delete the code already in the editor and paste the copied script.",
  "agents.triggers.appsScript.step3": "Save (Cmd/Ctrl + S).",
  "agents.triggers.appsScript.step4":
    "Pick marbloInstall in the function list at the top and press Run.",
  "agents.triggers.appsScript.step5":
    "In the authorization dialog, choose your Google account and allow (once).",
  "agents.triggers.appsScript.frictionTitle": "Where people get stuck",
  "agents.triggers.appsScript.friction1":
    "If marbloInstall is missing from the function list in step 4, the file is not saved yet. Do step 3 first.",
  "agents.triggers.appsScript.friction2":
    "Step 5 may warn that the app is not verified. It is your own script that you just pasted, so choose Advanced -> Go to (project name) and continue.",
  "agents.triggers.appsScript.friction3":
    "Silence right after installing is normal. The install records the current state as a baseline and reports only rows added after it. To check immediately, add a row and run marbloTestNow.",
  "agents.triggers.appsScript.troubleshootTitle":
    "If it fails (Apps Script execution log)",
  "agents.triggers.appsScript.troubleshoot401":
    "401 - the signature does not match. Usually the secret was rotated and the script was not updated. Copy the script here again and re-paste it.",
  "agents.triggers.appsScript.troubleshoot403":
    "403 - the Webhook condition is off for this project. Tick the checkbox above and save.",
  "agents.triggers.appsScript.troubleshoot429":
    "429 - calls piled up briefly. The script resends the same rows on its next run, so nothing is lost.",
  "agents.marbloBots.savedSeed": "Seed bot saved to this project.",
  "agents.marbloBots.savedCustom": "Bot definition saved to this project.",
  "agents.marbloBots.saveFailed": "Save failed",
  "agents.marbloBots.runFailed": "Run failed",
  "agents.marbloBots.dispatchFailed":
    "Failed to send the run instruction to the orchestrator.",
  "agents.marbloBots.dispatchLocal":
    "Sent to the orchestrator. It will create a board ticket and start a physical agent via dispatch_task.",
  "agents.marbloBots.dispatchQueued":
    "The orchestrator is stopped, so the run instruction was queued.",
  "agents.marbloBots.runningEmpty":
    "Only bot agents saved and run from the bot gallery appear here.",
  "agents.marbloBots.validation.missingProject": "Project binding is missing.",
  "agents.marbloBots.validation.missingOwner": "Owner is missing.",
  "agents.marbloBots.validation.missingName": "Bot name is empty.",
  "agents.marbloBots.validation.missingPersona": "Persona is empty.",
  "agents.marbloBots.validation.emptyMission": "Mission is empty.",
  "agents.marbloBots.validation.unknownModel": "Unknown model.",
  "agents.marbloBots.validation.knowledgeRootRequired":
    "Knowledge requires a wiki root_path.",
  "agents.marbloBots.validation.default":
    "This bot definition cannot be saved.",
  "agents.marbloBots.wiki.title":
    "Enable Knowledge first: Marblo wiki setup guide",
  "agents.marbloBots.wiki.ready": "docs/wiki found",
  "agents.marbloBots.wiki.needsSetup": "Setup needed",
  "agents.marbloBots.wiki.body":
    "Project knowledge is the differentiator. Ask the Orchestrator to use the existing wiki_ingest, wiki_query, wiki_lint MCP tools and wiki-init/wiki-note/wiki-ingest skills.",
  "agents.marbloBots.wiki.root": "Root",
  "agents.marbloBots.wiki.mcpTools":
    "MCP: wiki_ingest / wiki_query / wiki_lint",
  "agents.marbloBots.wiki.singleRoot": "Use one shared docs/wiki",
  "agents.marbloBots.wiki.copyTitle": "Request to copy to the Orchestrator",
  "agents.marbloBots.wiki.request1":
    "Set up the Marblo knowledge wiki for this project.",
  "agents.marbloBots.wiki.request2":
    "Use exactly one shared wiki root at docs/wiki, and use .claude/skills/wiki-init, wiki-note, wiki-ingest plus MCP wiki_ingest/wiki_query/wiki_lint.",
  "agents.marbloBots.wiki.request3":
    "Create the README and base taxonomy first, summarize the project docs/decisions bots will reuse with wiki-note, then run wiki-ingest and wiki-lint.",
  "agents.marbloBots.wiki.request4":
    'When another project queries it, document the form wiki_query({ root_path: "<absolute project path>/docs/wiki", query: "..." }).',
  // Gmail is send-only now, not read (ticket v5Phjv1WxndUpgFJyrIn).
  "agents.marbloBots.require.google":
    "Google account connected (Calendar lookups, sending mail)",
  "agents.marbloBots.require.outputChannel": "Slack or Telegram channel",
  "agents.marbloBots.seed.knowledge.name": "Knowledge Assistant",
  "agents.marbloBots.seed.knowledge.persona":
    "A practical assistant that checks the project wiki first and separates evidence from limits.",
  "agents.marbloBots.seed.knowledge.mission":
    "Answer user questions from the project knowledge wiki and list anything that needs follow-up.",
  "agents.marbloBots.seed.knowledge.evidence":
    "wiki_query is registered in the MCP server, and wiki-init/wiki-note/wiki-ingest skills exist.",
  "agents.marbloBots.seed.fullstack.name": "Full-stack Developer",
  "agents.marbloBots.seed.fullstack.persona":
    "A product development agent that reads existing patterns and ships focused, verified PRs.",
  "agents.marbloBots.seed.fullstack.mission":
    "Turn requirements into board tickets, dispatch workers through the existing path, and carry implementation through verification.",
  "agents.marbloBots.seed.fullstack.evidence":
    "create_task, dispatch_task, add_activity, and submit_for_review are registered in the MCP server.",
  "agents.marbloBots.seed.dailyBriefing.name": "Daily Briefing",
  "agents.marbloBots.seed.dailyBriefing.persona":
    "A scheduled assistant that checks the calendar and open work, then pushes a short Slack/Telegram brief.",
  "agents.marbloBots.seed.dailyBriefing.mission":
    "Review today's calendar and active tasks, then send a one-screen briefing to the selected channel.",
  "agents.marbloBots.seed.dailyBriefing.evidence":
    "calendar_list, send_slack_message, and send_telegram_message are registered in the MCP server. Summarizing new mail is not offered in this release — reading mail (gmail.readonly) is a restricted scope we do not request.",
  "agents.marbloBots.seed.mailCalendar.name": "Calendar Follow-up",
  "agents.marbloBots.seed.mailCalendar.persona":
    "A conditional assistant that reacts to upcoming calendar events and extracts priority plus next action.",
  "agents.marbloBots.seed.mailCalendar.mission":
    "Check upcoming events, then summarize prep items and candidate follow-up tasks.",
  "agents.marbloBots.seed.mailCalendar.evidence":
    "The assistant-triggers engine polls Calendar conditions and uses the same outbound MCP tools. New-mail conditions are not offered in this release.",
  "agents.marbloBots.seed.marketer.name": "Marketer",
  "agents.marbloBots.seed.marketer.persona":
    "A growth assistant that uses project knowledge and board context to split campaigns, copy, and experiments into tasks.",
  "agents.marbloBots.seed.marketer.mission":
    "Check product, customer, and channel context in the wiki, then draft messaging, execution tickets, and channel reports.",
  "agents.marbloBots.seed.marketer.evidence":
    "wiki_query, create_task, dispatch_task, send_slack_message, and send_telegram_message are registered in the MCP server.",
  "agents.marbloBots.seed.designer.name": "Designer",
  "agents.marbloBots.seed.designer.persona":
    "A product designer that reads existing UI patterns and tightens copy, layout, and states through small frontend changes.",
  "agents.marbloBots.seed.designer.mission":
    "Clarify the screen problem, improve components/copy/state within existing React UI patterns, and leave verification criteria.",
  "agents.marbloBots.seed.designer.evidence":
    "wiki_query, create_task, dispatch_task, and add_activity are registered, and Codex frontend agents perform React UI work.",
  "agents.marbloBots.seed.jarvis.name": "Jarvis",
  "agents.marbloBots.seed.jarvis.persona":
    "The Orchestrator's general aide, combining wiki, calendar, board, and output channels into concrete next actions.",
  "agents.marbloBots.seed.jarvis.mission":
    "Classify the request and use only the needed mix of wiki, Calendar, board tickets, and Slack/Telegram reporting. It never reads your mail; it shows you a draft and sends it once you confirm.",
  "agents.marbloBots.seed.jarvis.evidence":
    "wiki_query, create_task, dispatch_task, calendar_list, gmail_send, send_slack_message, and send_telegram_message are registered in the MCP server. Reading mail (gmail_search) is not offered in this release.",
  "agents.marbloBots.omitted.youtube.name": "YouTube Research",
  "agents.marbloBots.omitted.youtube.reason":
    "A YouTube-specific connector or verified browser/search MCP is not available in the current seed materials, so it would reduce first-screen run reliability.",
  "agents.marbloBots.omitted.web.name": "Web Research",
  "agents.marbloBots.omitted.web.reason":
    "A browser/search MCP is not confirmed on the current Marblo MCP surface.",

  // ── Assistant trigger settings panel ──────────────────────────
  "agents.triggers.title": "Schedule and Condition Triggers",
  "agents.triggers.description":
    "Settings are saved per project. The existing engine reads assistantTriggers from the projects document and injects scheduled or conditional messages into the assistant project's Orchestrator.",
  "agents.triggers.refreshConnectors": "Refresh connection status",
  "agents.triggers.connectorReady": "Ready",
  "agents.triggers.connectorNeedsConnection": "Connection required",
  "agents.triggers.enableLabel": "Use trigger engine",
  "agents.triggers.enableHint":
    "When off, assistantTriggers.enabled=false is saved.",
  "agents.triggers.tabsAria": "Trigger setting categories",
  "agents.triggers.tabs.schedule": "Schedule",
  "agents.triggers.tabs.conditions": "Conditions",
  "agents.triggers.tabs.outputs": "Output channels",
  "agents.triggers.engineNoticePrefix": "The engine polls only",
  "agents.triggers.engineNoticeSuffix": "projects. Current project kind:",
  "agents.triggers.engineNoticeEnabled": " — eligible after saving.",
  "agents.triggers.engineNoticeDisabled":
    " — settings can be saved, but polling will not run.",
  "agents.triggers.schedule.title": "Fixed Schedule",
  "agents.triggers.schedule.enable":
    "Run the daily briefing on matching minutes",
  "agents.triggers.calendar.title": "Calendar Condition",
  "agents.triggers.calendar.enable": "Detect upcoming events",
  "agents.triggers.gmail.title": "Gmail Condition (not in this release)",
  "agents.triggers.gmail.enable": "Detect mail conditions",
  "agents.triggers.sheets.title": "Google Sheets Condition",
  "agents.triggers.sheets.heldBadge": "On hold",
  "agents.triggers.sheets.heldNotice":
    "This condition no longer runs by polling. Nothing is disconnected - the mechanism changed: we no longer request the sheet read scope (spreadsheets.readonly), so the Apps Script under the Webhook condition above does this job now. The values below are kept, not erased.",
  "agents.triggers.sheets.enable": "Detect newly added rows",
  "agents.triggers.sheets.spreadsheet": "Spreadsheet ID or URL",
  "agents.triggers.sheets.spreadsheetHint":
    "Paste the URL from the sheet's address bar; it is reduced to the ID on save.",
  "agents.triggers.sheets.range": "Sheet and range",
  "agents.triggers.sheets.rangeHint":
    "Leave empty to watch A:Z of the first sheet. To target one sheet, write it like 'Form Responses 1!A:Z'.",
  "agents.triggers.sheets.pollMinutes": "pollMinutes",
  "agents.triggers.sheets.detectionHint":
    "The first poll only records the current state as a baseline and notifies nothing. After that, only rows that appear in a poll where the row count grew are reported. Editing cells or deleting rows does not notify.",
  "agents.triggers.outputs.title": "Output Channels",
  "agents.triggers.outputs.description":
    "The engine instructs the Orchestrator to call these MCP tools for the selected channels: {tools}.",
  "agents.triggers.outputs.none": "none selected",
  "agents.triggers.outputs.slackGuide": "Slack connection status and guide",
  "agents.triggers.outputs.telegramGuide":
    "Telegram connection status and guide",
  "agents.triggers.engineFields":
    "Existing engine fields: schedule, calendar, gmail, webhook, sheets, outputs",
  "agents.triggers.save": "Save",
  "agents.triggers.saved": "Project trigger settings saved.",
  "agents.triggers.saveFailed": "Save failed",
  "agents.triggers.errors.loadConnectorsFailed":
    "Could not load connector status.",
  "agents.triggers.errors.assistantProjectRequired":
    "The current engine polls only kind=assistant projects. Enable this from an assistant project.",
  "agents.triggers.validation.noTriggerEnabled": "No trigger is enabled.",
  "agents.triggers.validation.outputsRequired":
    "Select at least one output channel.",
  "agents.triggers.validation.slackOutputUnavailable":
    "The Slack channel connection is not ready.",
  "agents.triggers.validation.telegramOutputUnavailable":
    "The Telegram channel connection is not ready.",
  "agents.triggers.validation.invalidCron":
    "cron must use the 5-field format. Example: 0 9 * * 1-5",
  "agents.triggers.validation.calendarConnectorRequired":
    "Google Calendar scope is required to enable the Calendar trigger.",
  "agents.triggers.validation.gmailConnectorRequired":
    "The new-mail trigger is not offered in this release. Reading mail (gmail.readonly) is a restricted scope that would require a separate security assessment. Schedule, calendar, and spreadsheet conditions still work.",
  "agents.triggers.validation.calendarPollOutOfRange":
    "Calendar poll interval must be 1-60 minutes.",
  "agents.triggers.validation.gmailPollOutOfRange":
    "Gmail poll interval must be 1-60 minutes.",
  "agents.triggers.validation.sheetsTriggerWithheld":
    "Settings cannot be saved while the Sheets condition is on. New-row detection now runs through the Apps Script under the Webhook condition above - untick this box, generate the script there, and paste it into your sheet.",
  "agents.triggers.validation.sheetsConnectorRequired":
    "Google Sheets readonly scope is required to enable the Sheets trigger. Reconnect your Google account from the Harness tab.",
  "agents.triggers.validation.sheetsSpreadsheetRequired":
    "Enter a spreadsheet ID or URL.",
  "agents.triggers.validation.sheetsPollOutOfRange":
    "Sheets poll interval must be 1-60 minutes.",
  "agents.triggers.validation.calendarUpcomingOutOfRange":
    "Upcoming event window must be 1-1440 minutes.",
  "agents.triggers.validation.default": "Trigger settings cannot be saved.",

  // ── No-project empty state (agents tab reached with no project selected) ──
  "agents.noProject.title": "No project selected",
  "agents.noProject.desc":
    "Agents belong to a project. Open or create a project folder first.",
  "agents.noProject.cta": "Connect folder · Start",
};
