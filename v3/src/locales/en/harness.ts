/**
 * English — `harness.*` namespace. Typed `Record<keyof typeof koHarness, string>`
 * so a key present in ko but missing here (or vice-versa) is a compile error
 * for this namespace alone.
 */
import type { harness as koHarness } from "../ko/harness";

export const harness: Record<keyof typeof koHarness, string> = {
  // --- Connection status panel ---
  "harness.conn.title": "Repository (GitHub) connection",
  "harness.conn.noProject": "No project selected",
  "harness.conn.refreshTitle": "Refresh connection status",
  "harness.conn.resyncTitle":
    "Re-sync git metadata (repo URL · default branch)",
  "harness.conn.resync": "Re-sync",
  "harness.conn.check": "Check connection",
  "harness.conn.loading": "Checking connection status",
  "harness.conn.loadError": "Failed to load connection status.",
  "harness.conn.createError": "Failed to create connection.",
  "harness.conn.checkError": "Connection check failed.",
  "harness.conn.accessError": "Failed to apply access.",
  "harness.conn.removeError": "Failed to remove connection.",
  "harness.conn.removeConfirm": "Disconnect the repo from the current project?",
  "harness.conn.nodeBadge": "node won't run",
  "harness.conn.nodeError": "Could not run the node binary used for spawning.",
  "harness.conn.nodeHintBefore":
    "MCP / agent children may fail to spawn and drop (-32000). In a terminal, run",
  "harness.conn.nodeHintAfter": "then restart the app.",
  "harness.conn.noRepo": "No repo is connected.",
  "harness.conn.autoFillHint":
    "Creating a repository connection from the project's local path auto-fills the repo URL and default branch from git. Private repository access uses the GitHub account link below.",
  "harness.conn.connect": "Connect",
  "harness.conn.connecting": "Connecting",
  "harness.conn.noFolderPath":
    "This project has no local path (folderPath), so it can't be connected. Set a path in the project settings.",
  "harness.conn.selectProjectFirst": "Select a project first.",
  "harness.conn.unknown": "Unknown",
  "harness.conn.notConnected": "Not connected",
  "harness.conn.noActiveAgents": "No running agents",
  "harness.conn.noRecord": "No record",
  "harness.conn.currentMode": "Current mode: {mode}",
  "harness.conn.applyAccess": "Apply access",
  "harness.conn.disconnect": "Disconnect",
  "harness.conn.checkResult": "Connection check result",
  "harness.conn.ok": "OK",
  "harness.conn.needsCheck": "Needs attention",
  // Manual connect form
  "harness.conn.invalidUrl":
    "Invalid repo URL format. e.g. https://github.com/owner/repo or git@github.com:owner/repo.git",
  "harness.conn.manualError": "Manual connection failed.",
  "harness.conn.manualTitle": "Enter repo URL manually",
  "harness.conn.manualHint":
    "If there's no git remote or it can't be derived automatically, you can connect by entering the repo URL directly.",
  "harness.conn.branchPlaceholder": "Default branch (optional, e.g. main)",
  "harness.conn.manualConnect": "Connect manually",
  // After repo connect: per-ticket independent worktree notice (YTpcEK5Ow5LIldkJJzQc)
  "harness.conn.worktreeGuide.badge": "Independent worktrees",
  "harness.conn.worktreeGuide.title": "Per-ticket independent worktrees",
  "harness.conn.worktreeGuide.body":
    "Agents now work in an independent worktree per ticket, so they can run in parallel without colliding.",
  "harness.conn.worktreeGuide.popupTitle":
    "Work happens in independent worktrees",
  "harness.conn.worktreeGuide.popupBody":
    "Git repo connected. Agents now work in an independent worktree per ticket (parallel, without collisions).",
  "harness.conn.worktreeGuide.gotIt": "Got it",
  // Permission state labels (enum → display)
  "harness.perm.unknown": "Unknown",
  "harness.perm.pending": "Pending",
  "harness.perm.granted": "Granted",
  "harness.perm.denied": "Denied",
  // Connection-check item status labels
  "harness.checkStatus.pass": "Pass",
  "harness.checkStatus.warn": "Warn",
  "harness.checkStatus.fail": "Fail",
  // MCP status table
  "harness.mcp.available": "Available",
  "harness.mcp.denied": "Permission denied",
  "harness.mcp.pending": "Permission pending",
  "harness.mcp.unknown": "Unknown",
  "harness.mcp.colName": "MCP",
  "harness.mcp.colStatus": "Status",
  "harness.mcp.colPerm": "Access",
  "harness.mcp.colLastUsed": "Last used",
  "harness.mcp.empty": "No MCPs available.",
  // --- Harness store (package catalog) ---
  "harness.store.cat.all": "All",
  "harness.store.cat.required": "Required (auto-installed)",
  "harness.store.cat.recommended": "Recommended skills",
  "harness.store.cat.mcp": "Useful MCPs",
  "harness.store.cat.cli": "CLI",
  "harness.store.cat.envswap": "Env-swap vendors",
  // --- env-swap vendor section (a key to register, not a CLI to install) ---
  // No vendor or model id literals live here — the list is registry-derived and
  // these strings only carry the classification ("key, not install").
  "harness.store.envSwap.title": "Env-swap vendors",
  "harness.store.envSwap.subtitle":
    "These vendors run on the claude harness with just an API key — nothing to install; register the key and they turn on.",
  "harness.store.envSwap.summary": "{ready} of {total} ready",
  "harness.store.envSwap.loading": "Loading the vendor list…",
  "harness.store.envSwap.loadFailed": "Could not load the vendor list.",
  "harness.store.envSwap.retry": "Try again",
  "harness.store.envSwap.empty": "No env-swap vendors are registered.",
  "harness.store.status.installed": "Installed",
  "harness.store.status.not-installed": "Install",
  "harness.store.status.manual-required": "Manual install",
  "harness.store.status.unknown": "Checking",
  "harness.store.loadFail": "Failed to load",
  "harness.store.noManualGuide": "No manual install guide available.",
  "harness.store.installFail": "Install failed",
  "harness.store.installDone": "{name} installed.",
  "harness.store.uninstallConfirm": "Uninstall {name}?",
  "harness.store.uninstallFail": "Uninstall failed",
  "harness.store.uninstallDone": "{name} uninstalled.",
  // The Harness tab now holds only the connections this app REQUIRES — the
  // opt-in asset catalog moved out to the top-level Store tab.
  "harness.store.title": "Harness connections",
  "harness.store.subtitle": "Repositories, connectors and channels for Harness",
  "harness.store.emptyList": "No packages to show.",
  "harness.store.deprecated": "Deprecated soon",
  "harness.store.badge.installed": "Installed",
  "harness.store.badge.manual": "Manual",
  "harness.store.badge.notInstalled": "Not installed",
  "harness.store.auth.checking": "Checking auth…",
  "harness.store.auth.needed": "Auth required",
  "harness.store.auth.checkingShort": "Checking…",
  "harness.store.updatePending": "→ v{version} update pending",
  "harness.store.upToDate": "(up to date)",
  "harness.store.auth.loginHintBefore": "Login required. In a terminal, run",
  "harness.store.auth.loginHintAfter":
    "then click Re-check. (Spawning while unauthenticated stalls at the login prompt.)",
  "harness.store.pkg.cliClaude.desc":
    "CLI required to run the orchestrator and Claude agents. Installed with the official native installer; after installation, authenticate with OAuth or an API key on first launch.",
  "harness.store.pkg.cliCodex.desc":
    "CLI required to run Codex (gpt) agents. Installed with the official native installer; after installation, authenticate with `codex login`.",
  "harness.store.pkg.cliGrok.desc":
    "CLI required to run Grok Build agents. Installed with the official shell installer; the first launch or `grok login` opens browser authentication.",
  "harness.store.pkg.cliClaude.postInstall":
    "After installing, run `claude` once in a terminal to complete Anthropic account OAuth or API key authentication. Then restart Marblo.",
  "harness.store.pkg.cliCodex.postInstall":
    "After installing, run `codex login` in a terminal to complete OpenAI account authentication. The /goal feature is auto-enabled, so once authenticated you can use autonomous mode with `/goal <objective>` in a Codex session.",
  "harness.store.pkg.cliGrok.postInstall":
    "After installing, run `grok login` or `grok` in a terminal to complete browser authentication. Restart Marblo after authenticating.",
  "harness.store.pkg.marbloTfCommands.name": "TaskForce Slash Commands",
  "harness.store.pkg.marbloTfCommands.desc":
    "18 /tf-* slash commands for the Marblo workflow. Auto-installed with the app.",
  "harness.store.pkg.marbloMcp.name": "Marblo MCP Server",
  "harness.store.pkg.marbloMcp.desc":
    "MCP tool set for TaskForce / Kanban / agent management. Agents spawned inside the Marblo dashboard (Claude / Codex / Gemini) connect automatically with a per-agent isolated config. Not registered for external terminal CLI sessions — manage those separately with your own taskforce MCP setup.",
  "harness.store.pkg.cliGemini.desc":
    "⚠️ Being sunset (personal tier EOL 2026-06-18). Merging into the Antigravity (agy) CLI. New installs aren't recommended — the primary lineup is Claude Code / Codex / Antigravity. Only Enterprise Code Assist or paid API key users keep working.",
  "harness.store.pkg.cliGemini.postInstall":
    "⚠️ The Gemini CLI personal tier ends 2026-06-18. Use the Antigravity (agy) CLI instead of a new install. Existing users keep working only with Enterprise Code Assist or a paid API key.",
  "harness.store.pkg.cliAntigravity.desc":
    "The agy CLI for Antigravity 2.0 (announced at Google I/O 2026). Marblo's 4th 1st-class agent model. Auto-installed via curl shell installer. OAuth browser authentication on first launch.",
  "harness.store.pkg.cliAntigravity.postInstall":
    "After installing, run `agy` once in a terminal to complete OAuth browser authentication. The binary installs to `~/.local/bin/agy` and your shell rc's PATH is updated. Restart Marblo after authenticating. On the first agy worker spawn, a Marblo MCP entry is auto-merged into `~/.gemini/antigravity-cli/mcp_config.json` (existing MCP entries are preserved).",
  "harness.store.pkg.superpowers.desc":
    "Anthropic's Claude Code skill collection (TDD, debugging, brainstorming, code review, and more).",
  "harness.store.pkg.superpowers.instructions":
    "Install via the Claude Code plugin system. Full guide: https://github.com/anthropics/claude-code-plugins",
  "harness.store.pkg.gstack.desc":
    "A full-stack workflow skill set — design, QA, deploy, security, retros, and more.",
  "harness.store.pkg.context7.name": "context7 (library docs)",
  "harness.store.pkg.context7.desc":
    "MCP for looking up up-to-date library/API docs — React, Next.js, Tailwind, and more.",
  "harness.store.pkg.filesystem.name": "filesystem (file system)",
  "harness.store.pkg.filesystem.desc":
    "Official MCP that lets Claude read and write files in a directory you specify.",
  "harness.store.pkg.github.name": "github (issues / PRs / code search)",
  "harness.store.pkg.github.desc":
    "Official MCP for managing GitHub issues/PRs and searching repos, code, and users.",
  "harness.store.pkg.playwright.name": "playwright (browser automation)",
  "harness.store.pkg.playwright.desc":
    "Lets agents open pages, click, fill forms, screenshot, and capture console logs directly via headless Chromium. Covers ~90% of the need while the native IDE-embedded browser (P2-10) is deferred.",
  "harness.store.installing": "Installing...",
  "harness.store.viewGuide": "View guide",
  "harness.store.bundled": "Auto-installed",
  "harness.store.requiredInstall": "Required — install",
  "harness.store.processing": "Processing...",
  "harness.store.uninstall": "Uninstall",
  "harness.store.requiredNoRemove": "Required package — can't remove",
  "harness.store.deprecatedNoInstall":
    "Deprecated soon — install not recommended",
  "harness.store.docs": "Docs →",
  "harness.store.footerMcp":
    "Marblo MCP auto-connects only to agents spawned inside the dashboard (per-agent isolated config). Manage external terminal CLI sessions with your own setup, e.g. the taskforce MCP.",
  "harness.store.footerStoreMoved":
    "Installing skill / MCP assets moved to the “Store” tab above.",
  // --- Connections section header ---
  "harness.store.section.connections": "Connections",
  "harness.store.section.connectionsDesc":
    "Connect repositories (GitHub), connectors and Telegram / Slack channels in one place.",
  "harness.store.section.cli": "Orchestrator CLI",
  "harness.store.section.cliDesc":
    "Install Claude Code, Codex and Grok CLI, then verify their login state.",
  "harness.store.section.envSwapDesc":
    "Register API keys for vendors such as GLM, Kimi, MiniMax, Solar and DeepSeek that run through the claude harness.",
  "harness.store.section.localDesc":
    "Install local models through Ollama and track pull progress clearly.",
  // --- Telegram channel panel ---
  "harness.telegram.status.idle": "Idle",
  "harness.telegram.status.connected": "Connected",
  "harness.telegram.status.needsCheck": "Needs check",
  "harness.telegram.status.disconnected": "Disconnected",
  "harness.telegram.title": "Telegram channel connection",
  "harness.telegram.loadError": "Failed to load Telegram channel status.",
  "harness.telegram.needChatId": "Save a chatId before enabling.",
  "harness.telegram.saved": "Channel settings saved.",
  "harness.telegram.saveError": "Failed to save channel settings.",
  "harness.telegram.refreshTitle": "Refresh channel status",
  "harness.telegram.enableTitle": "Enable Telegram channel",
  "harness.telegram.enabled": "Active",
  "harness.telegram.disabled": "Inactive",
  "harness.telegram.loading": "Checking channel status",
  "harness.telegram.chatIdPlaceholder": "@channel or chatId",
  "harness.telegram.save": "Save",
  "harness.telegram.guide.toggle": "How do I connect?",
  "harness.telegram.guide.step1Before": "Create a bot with ",
  "harness.telegram.guide.step1After": " and copy the bot token.",
  "harness.telegram.guide.step2":
    "Add the bot to the channel or group you want to use.",
  "harness.telegram.guide.step3":
    "For a public channel you can use its @username. For a private channel/group, invite the bot, send one test message, then copy message.chat.id from the getUpdates response.",
  "harness.telegram.guide.step4":
    "Enter the bot token and chatId, save, then turn on the active toggle.",
  "harness.telegram.chatIdGuide.title":
    "Get the chatId for a private channel/group",
  "harness.telegram.chatIdGuide.before":
    "Add the bot to the channel/group, send one message there, then replace only <BOT_TOKEN> with the real bot token and run:",
  "harness.telegram.chatIdGuide.after":
    "Copy result[].message.chat.id or result[].channel_post.chat.id from the JSON response. Channel IDs usually start with -100. If result is empty, send a fresh message in Telegram and run it again.",
  "harness.telegram.plugin.title": "Telegram plugin required",
  "harness.telegram.plugin.descAfter":
    " requires the telegram plugin to be installed. Install it from the Harness store, or via the CLI using the same plugin name, then enable the channel.",

  // --- Slack channel panel (mirrors #936's IPC contract — secrets never reach the renderer) ---
  "harness.slack.status.idle": "Idle",
  "harness.slack.status.connected": "Connected",
  "harness.slack.status.needsCheck": "Needs check",
  "harness.slack.status.disconnected": "Disconnected",
  "harness.slack.title": "Slack channel connection",
  "harness.slack.loadError": "Failed to load Slack channel status.",
  "harness.slack.needChannelId": "Save a channel ID before enabling.",
  "harness.slack.saved": "Channel settings saved.",
  "harness.slack.saveError": "Failed to save channel settings.",
  "harness.slack.refreshTitle": "Refresh channel status",
  "harness.slack.enableTitle": "Enable Slack channel",
  "harness.slack.enabled": "Active",
  "harness.slack.disabled": "Inactive",
  "harness.slack.loading": "Checking channel status",
  "harness.slack.channelIdPlaceholder": "C0123456789",
  "harness.slack.save": "Save",
  "harness.slack.tokenSavedPlaceholder": "Saved — type to replace",
  "harness.slack.probe": "Probe",
  "harness.slack.probeTitle":
    "Check whether the saved credentials actually work",
  "harness.slack.probeOk": "Credentials verified.",
  "harness.slack.probeFailed": "Failed to verify credentials.",
  "harness.slack.probeResultOk": "Credentials OK",
  "harness.slack.probeResultFail": "Credential check failed",
  "harness.slack.probeTeam": "team {team} · bot {bot}",
  "harness.slack.probeAppTokenOk": "app token (Socket Mode) OK",
  "harness.slack.probeAppTokenSkipped":
    "app token not verified (missing or skipped)",
  "harness.slack.remove": "Remove channel",
  "harness.slack.removeConfirm":
    "Remove the Slack channel connection for the current project? Saved tokens will be deleted.",
  "harness.slack.removed": "Channel connection removed.",
  "harness.slack.removeError": "Failed to remove channel.",
  "harness.slack.secretsNotEncrypted":
    "Tokens are stored unencrypted on this machine (OS secret storage unavailable).",
  "harness.slack.healthError": "Last health check failed: {error}",
  // Connection guide (collapsible) — 7-step Slack app setup
  "harness.slack.guide.toggle": "How do I connect a Slack app?",
  "harness.slack.guide.step1Before": "Create a new app at ",
  "harness.slack.guide.step1After": " (Create New App).",
  "harness.slack.guide.step2":
    "Turn on Socket Mode and generate an App-Level Token (connections:write scope, starts with xapp-).",
  "harness.slack.guide.step3":
    "Add app_mentions:read, chat:write, channels:history to Bot Token Scopes, then run Install to Workspace to issue a Bot Token (xoxb-).",
  "harness.slack.guide.step4":
    "Turn on Event Subscriptions and subscribe to the app_mention event.",
  "harness.slack.guide.step5":
    "Invite the bot to the channel you want to use and note its channel ID. Copy the C/G-prefixed ID from channel details or from the last segment of Copy link.",
  "harness.slack.guide.step6":
    "Enter the Bot Token and App Token above, save, then verify with the Probe button.",
  "harness.slack.guide.step7":
    "Mention the bot in the channel and confirm the reply round-trips.",
  "harness.slack.channelIdGuide.title": "Find the channel ID",
  "harness.slack.channelIdGuide.body":
    "Use the channel ID, not the display name like #general. In Slack desktop, open the channel name and copy the Channel ID from the bottom of About/details, or copy the channel link and use the final path segment. Private channels may start with G, and the bot must be invited before Probe can pass.",

  // --- GitHub connection panel (leyZnPBHbHUl3H9sRTDF) — optional, not required onboarding ---
  "harness.github.title": "GitHub account connection",
  "harness.github.subtitle":
    "Optional link for private repo clones and collaboration. It appears only on the Harness tab, not in Start here.",
  "harness.github.optionalBadge": "Optional",
  "harness.github.status.connected": "Connected",
  "harness.github.status.disconnected": "Disconnected",
  "harness.github.account": "GitHub account",
  "harness.github.accountNone": "No account connected",
  "harness.github.accountConnected": "Device OAuth connected",
  "harness.github.waitingAuth": "Waiting for browser approval",
  "harness.github.connect": "Connect",
  "harness.github.connected":
    "GitHub is connected. You can clone private repositories.",
  "harness.github.connectFailed": "Could not start GitHub connection.",
  "harness.github.denied": "GitHub connection was cancelled.",
  "harness.github.expired":
    "The GitHub connection code expired. Please try again.",
  "harness.github.disconnect": "Disconnect",
  "harness.github.disconnectConfirm":
    "Disconnect GitHub on this device? Private clone/push may stop working.",
  "harness.github.disconnected": "GitHub disconnected.",
  "harness.github.disconnectFailed": "Failed to disconnect.",
  "harness.github.refreshTitle": "Refresh GitHub connection status",
  "harness.github.loadError": "Failed to load GitHub connection status.",
  "harness.github.needLogin": "Sign in to Marblo before connecting GitHub.",
  "harness.github.deviceCodeLabel": "Enter this code on GitHub:",
  "harness.github.deviceCodeHint":
    "After you enter the code and approve, this panel switches to connected automatically.",
  "harness.github.openGithub": "Open GitHub",
  "harness.github.guide.toggle": "GitHub repository access guide",
  "harness.github.guide.step1":
    "First use Connect in this section to save the current project's repo URL and default branch.",
  "harness.github.guide.step2Before": "Open ",
  "harness.github.guide.step2After": ", enter the code, and approve Marblo.",
  "harness.github.guide.step3":
    "If private repo clone or push is needed, click GitHub account connection above to start device OAuth and get a one-time code.",
  "harness.github.guide.step4":
    "After approval finishes, share and repo-connect collaboration flows reuse the same device OAuth link.",
  "harness.github.guide.step5":
    "When GitHub App install permissions open later, they inherit on the same identity — no second login.",
  "harness.github.guide.step6":
    "Disconnect anytime with the trash button on this panel (optional link).",
  "harness.github.guide.appTitle": "Device OAuth → GitHub App auto-inherit",
  "harness.github.guide.appBody":
    "The GitHub account link is an optional Harness-tab connection. It is not part of the required Start here onboarding. Device OAuth is the first path today; GitHub App install tokens are the endgame and inherit on the same account path.",

  // --- Google Drive wiki folder panel (MCTHALmNAWPpilTFwe8o) ---
  // Two axes in one panel: the account is connected once per user, the wiki
  // folder is chosen per project.
  "harness.drive.title": "Google Workspace",
  "harness.drive.subtitle":
    "Connect once for Drive wiki, Gmail, Calendar, and Contacts read-only context.",
  "harness.drive.status.disconnected": "Disconnected",
  "harness.drive.status.needsFolder": "Folder needed",
  "harness.drive.status.bound": "Connected",
  "harness.drive.account": "Google account",
  "harness.drive.accountNone": "No account connected",
  "harness.drive.connect": "Connect Google account",
  "harness.drive.reconnect": "Reconnect",
  "harness.drive.connecting": "Waiting for consent in your browser",
  "harness.drive.connected": "Google Workspace connected.",
  "harness.drive.connectFailed": "Failed to connect Google Workspace.",
  "harness.drive.disconnect": "Disconnect account",
  "harness.drive.disconnectConfirm":
    "Disconnect Google on this machine? Stored credentials are deleted and every project stops reading Drive, Gmail, Calendar, and Contacts.",
  "harness.drive.disconnected": "Google Workspace disconnected.",
  "harness.drive.disconnectFailed": "Failed to disconnect.",
  "harness.drive.gmail": "Gmail read-only",
  "harness.drive.calendar": "Calendar read-only",
  "harness.drive.contacts": "Contacts read-only",
  "harness.drive.scopeReady": "Ready",
  "harness.drive.scopeNeedsReconnect": "Reconnect",
  "harness.drive.folderSection": "This project's wiki folder",
  "harness.drive.folderNone": "No folder selected",
  "harness.drive.folderHint":
    "This project's agents read only the folder you pick here, including its subfolders.",
  "harness.drive.searchPlaceholder": "Search folders by name (empty = recent)",
  "harness.drive.searchFolders": "Find folders",
  "harness.drive.searching": "Searching folders",
  "harness.drive.noFolders": "No folders matched.",
  "harness.drive.select": "Use this folder",
  "harness.drive.bound": "Wiki folder set.",
  "harness.drive.bindFailed": "Failed to set the wiki folder.",
  "harness.drive.clearFolder": "Clear folder",
  "harness.drive.clearConfirm":
    "Clear this project's wiki folder? Its agents will no longer be able to read Drive documents.",
  "harness.drive.cleared": "Wiki folder cleared.",
  "harness.drive.clearFailed": "Failed to clear the wiki folder.",
  "harness.drive.preview": "Check scope",
  "harness.drive.previewTitle":
    "Query exactly what agents see and report how many documents are in scope",
  "harness.drive.previewOk": "{count} documents are visible in this folder.",
  "harness.drive.previewEmpty":
    "No documents are visible in this folder (it is empty, or content sits deeper).",
  "harness.drive.previewTruncated":
    "Too many subfolders — only part of the tree was searched (up to {count} folders).",
  "harness.drive.loadError": "Failed to load Drive status.",
  "harness.drive.needProject": "Select a project first.",
  "harness.drive.refreshTitle": "Refresh Drive status",
  "harness.drive.appliesImmediately":
    "Takes effect immediately, including for already-running agents.",

  // --- Notion wiki panel (gaUx2Cmsw6EN8ymjL2ks) ---
  "harness.notion.title": "Notion wiki",
  "harness.notion.subtitle":
    "Store the integration token once; pick a wiki database or page per project.",
  "harness.notion.status.disconnected": "Disconnected",
  "harness.notion.status.needsBinding": "Binding needed",
  "harness.notion.status.bound": "Connected",
  "harness.notion.account": "Notion workspace",
  "harness.notion.accountNone": "No workspace connected",
  "harness.notion.tokenPlaceholder": "Integration token",
  "harness.notion.workspacePlaceholder": "Workspace name (optional)",
  "harness.notion.connect": "Connect Notion",
  "harness.notion.reconnect": "Reconnect",
  "harness.notion.connected": "Notion connected.",
  "harness.notion.connectFailed": "Failed to connect Notion.",
  "harness.notion.disconnect": "Disconnect Notion",
  "harness.notion.disconnectConfirm":
    "Disconnect Notion on this machine? Stored credentials are deleted and every project stops reading Notion.",
  "harness.notion.disconnected": "Notion disconnected.",
  "harness.notion.disconnectFailed": "Failed to disconnect.",
  "harness.notion.bindingSection": "This project's wiki DB/page",
  "harness.notion.bindingNone": "No database or page selected",
  "harness.notion.bindingHint":
    "This project's agents read only the database or page you pick here.",
  "harness.notion.searchPlaceholder": "Search databases/pages by name",
  "harness.notion.search": "Find Notion",
  "harness.notion.searching": "Searching",
  "harness.notion.noResults": "No databases or pages matched.",
  "harness.notion.select": "Use this item",
  "harness.notion.bound": "Notion wiki set.",
  "harness.notion.bindFailed": "Failed to set the Notion wiki.",
  "harness.notion.clearBinding": "Clear Notion binding",
  "harness.notion.clearConfirm":
    "Clear this project's Notion wiki? Its agents will no longer be able to read Notion documents.",
  "harness.notion.cleared": "Notion wiki cleared.",
  "harness.notion.clearFailed": "Failed to clear the Notion wiki.",
  "harness.notion.preview": "Check scope",
  "harness.notion.previewTitle":
    "Query exactly what agents see and report how many pages are in scope",
  "harness.notion.previewOk": "{count} pages are visible in this Notion scope.",
  "harness.notion.previewEmpty": "No pages are visible in this Notion scope.",
  "harness.notion.loadError": "Failed to load Notion status.",
  "harness.notion.needProject": "Select a project first.",
  "harness.notion.refreshTitle": "Refresh Notion status",
  "harness.notion.appliesImmediately":
    "Takes effect immediately, including for already-running agents.",

  // HarnessVersionBadge — tooltip for an agent's installed CLI version
  "harness.installedCliVersion": "Installed CLI version v{version}",

  // --- Public registry store (marblo-app/marblo) ---
  // Top-level Store tab header
  "store.tab.title": "Store",
  "store.tab.subtitle": "Skill, MCP and agent catalog from the public registry",
  "harness.store.registry.title": "Public registry",
  "harness.store.registry.subtitle":
    "The full catalog of the public registry (marblo-app/marblo). Official and verified tiers install in one click; community tier is unreviewed and installs only after you acknowledge a warning. Tier and permissions are disclosures — they do not restrict what an item does once installed.",
  "harness.store.registry.category.all": "All",
  "harness.store.registry.skills": "Skills",
  "harness.store.registry.mcp": "MCP",
  "harness.store.registry.agents": "Agents",
  "harness.store.registry.workflows": "Workflows",
  "harness.store.registry.study": "Study",
  "harness.store.registry.other": "Other",
  "harness.store.registry.stale":
    "Could not reach the registry — showing the last fetched list.",
  "harness.store.registry.unavailable":
    "Registry unreachable. The built-in catalog still works.",
  "harness.store.registry.refresh": "Refresh",
  "harness.store.registry.tier.official": "Official",
  "harness.store.registry.tier.verified": "Verified",
  "harness.store.registry.tier.community": "Community",
  "harness.store.registry.referenceOnly":
    "Reference only — browse via link, no in-app install.",
  "harness.store.registry.usage.skill":
    "Once installed, agents use this skill via a slash command (/name) or automatically.",
  "harness.store.registry.usage.mcpServer":
    "Once installed, it registers in your agents' MCP config and its tools become available automatically.",
  "harness.store.registry.usage.agent":
    "Once installed, you can pick this agent type when spawning an agent.",
  "harness.store.registry.usage.workflow":
    "Reference only — opened as documentation, not installed.",
  "harness.store.registry.usage.knowledge":
    "Knowledge pack (reference only) — browse as agent context material.",
  "harness.store.registry.communityWarnTitle": "Install unreviewed item",
  "harness.store.registry.communityWarnBody":
    "This item is community tier — Marblo has not reviewed its contents. Installing downloads content from {source} onto your machine, where agents can load it. Proceed only after verifying the source yourself.",
  "harness.store.registry.communityWarnConsent":
    "I trust the source above ({source}) and want to install.",
  "harness.store.registry.communityWarnConfirm": "Acknowledge & install",
  "harness.store.registry.permissions": "Declared permissions",
  "harness.store.registry.permissionsNone": "Needs nothing (declared)",
  "harness.store.registry.permissionsUndeclared": "Permissions undeclared",
  "harness.store.registry.highRisk": "high-risk",
  "harness.store.registry.disclosureTitle": "Permission disclosure",
  "harness.store.registry.disclosureNote":
    "Marblo shows what an item says it needs. It does not restrict what it can do once installed. Only install items you trust.",
  "harness.store.registry.disclosureConfirm": "Confirm & install",
  "harness.store.registry.disclosureCancel": "Cancel",
  "harness.store.registry.install": "Install",
  "harness.store.registry.installing": "Installing…",
  "harness.store.registry.uninstall": "Uninstall",
  "harness.store.registry.uninstallConfirm":
    "Uninstall {name}? Only the files recorded in the install ledger will be removed.",
  "harness.store.registry.installed": "Installed",
  "harness.store.registry.outdated": "Update available",
  "harness.store.registry.notInstallable": "Not auto-installable",
  "harness.store.registry.revoked": "Revoked",
  "harness.store.registry.installDone": "{name} installed.",
  "harness.store.registry.installFail": "Install failed.",
  "harness.store.registry.uninstallDone": "{name} uninstalled.",
  "harness.store.registry.uninstallFail": "Uninstall failed.",
  // --- Rating (★1–5) — formula in electron/registry-rating.ts, docs/store-rating.md ---
  "harness.store.registry.rating.aria": "Rated {stars} out of 5",
  "harness.store.registry.rating.title": "★ {stars}/5 (raw score {score})",
  "harness.store.registry.rating.formula":
    "Formula: usefulness 50% + verification 30% + license 10% + freshness 10%",
  "harness.store.registry.rating.snapshotAt": "Star snapshot taken: {date}",
  "harness.store.registry.rating.reason.stars": "{stars} upstream GitHub stars",
  "harness.store.registry.rating.reason.starsMissing":
    "Upstream repo ({repo}) missing from the star snapshot — usefulness scored 0",
  "harness.store.registry.rating.reason.usefulnessUnmeasurable":
    "No upstream repo, so stars cannot measure usefulness — component excluded, capped at ★4",
  "harness.store.registry.rating.reason.verifiedPin":
    "Source verified — allowlisted host (GitHub) + immutable pin",
  "harness.store.registry.rating.reason.unpinnedSource":
    "Source ref is not an immutable pin (commit SHA or version tag)",
  "harness.store.registry.rating.reason.hostRejected":
    "Source repository is not an allowlisted host form",
  "harness.store.registry.rating.reason.verifiedIntegrity":
    "Integrity verified — every installed byte is checked against a digest",
  "harness.store.registry.rating.reason.integrityNotApplicable":
    "Not installed in-app — integrity component excluded (no install contract)",
  "harness.store.registry.rating.reason.noIntegrity":
    "No integrity anchor to check against",
  "harness.store.registry.rating.reason.licenseOsi":
    "OSI-approved license ({license})",
  "harness.store.registry.rating.reason.licensePublicDomain":
    "Public domain dedication ({license})",
  "harness.store.registry.rating.reason.licenseNonOsi":
    "Non-OSI license ({license}) — registry policy violation, capped at ★2",
  "harness.store.registry.rating.reason.licenseUnrecognized":
    "Unrecognized license ({license})",
  "harness.store.registry.rating.reason.licenseUndeclared":
    "No license declared",
  "harness.store.registry.rating.reason.freshPin":
    "Pin points at the current upstream commit",
  "harness.store.registry.rating.reason.freshUpstream":
    "Upstream active recently ({days} days ago)",
  "harness.store.registry.rating.reason.staleUpstream":
    "Upstream last active {days} days ago",
  "harness.store.registry.rating.reason.archivedUpstream":
    "Upstream repository is archived",
  "harness.store.registry.rating.reason.freshnessUnknown":
    "No upstream activity data — freshness component excluded",
  "harness.store.registry.rating.reason.capRevoked":
    "Revoked item — pinned to ★1",
  "harness.store.registry.rating.reason.capDeprecated":
    "Deprecated item — capped at ★3",
  "harness.store.registry.rating.reason.capUnverifiedSource":
    "Source could not be verified — capped at ★4 (★5 requires an allowlisted host and an immutable pin)",
  "harness.store.registry.rating.helpToggle": "How are these rated?",
  "harness.store.registry.rating.helpIntro":
    "Nobody hand-picks these scores. Four objective signals are weighted into a 1–5 rating; hover any star row to see that item's own evidence.",
  "harness.store.registry.rating.helpUsefulness":
    "Usefulness 50% — upstream GitHub stars on a log scale (one notch per 10×). Stars only count for the repository the installed bytes actually come from.",
  "harness.store.registry.rating.helpVerification":
    "Verification 30% — the same checks the installer enforces: allowlisted host, immutable pin (commit SHA or version tag), per-file integrity digests.",
  "harness.store.registry.rating.helpLicense":
    "License 10% — full credit only for OSI-approved licenses. Undeclared or unrecognized loses points; non-OSI (FSL, BUSL, NC…) violates registry policy and caps at ★2.",
  "harness.store.registry.rating.helpFreshness":
    "Freshness 10% — whether the pin tracks current upstream and whether upstream is still alive (archived or long-dormant loses points).",
  "harness.store.registry.rating.helpCaps":
    "Caps: revoked pins to ★1 · non-OSI ★2 · deprecated ★3 · unverified source ★4 · items with no upstream to measure ★4. ★5 requires proven upstream demand and a verified source.",
  "harness.store.registry.rating.helpSource":
    "Star counts come from a snapshot collected once at release build time — opening the Store never calls GitHub, and nothing in the app can change a score.",
  // Ratings are computed in the main process. When only the renderer is fresh,
  // the response carries no rating at all — and stars vanishing without a word
  // reads as "the rating feature is broken". Name the cause on screen.
  "harness.store.registry.rating.mainOutdated":
    "★ Ratings can't be shown — the running app predates them. Restart the app and they appear.",

  "harness.store.registry.source": "Source",
  "harness.store.registry.loadFail": "Failed to load the registry list.",
  // Community tier is listed; installing it needs explicit consent — one line.
  "harness.store.registry.communityListedNote":
    "{count} of these are community (unreviewed) — installing requires explicit consent",
  "harness.store.registry.githubCatalog": "Full catalog on GitHub →",
  "harness.store.registry.emptyCatalog":
    "No assets to show. The full catalog is on GitHub.",

  // --- Store 'Local models' (Ollama) tab — first-party curation (§4.4) ---
  "harness.store.local.tab": "Local models",
  "harness.store.local.title": "Local models (Ollama)",
  "harness.store.local.subtitle":
    "A first-party curation of small models that run free on your machine. Your system memory is measured so only models that fit install in one click (ollama pull); installed models become selectable under Local Model when adding an agent.",
  "harness.store.local.guideTitle": "Memory & quantization guide",
  "harness.store.local.guide.toggle": "How do I install and use Ollama?",
  "harness.store.local.guide.step1Before": "Install Ollama — ",
  "harness.store.local.guide.step1After":
    " (or `brew install ollama` on macOS), then start the Ollama app (or `ollama serve`).",
  "harness.store.local.guide.step2":
    "Pick a model that fits this machine below and click Install (ollama pull). If RAM is short, the button stays disabled.",
  "harness.store.local.guide.step3":
    "Once installed, choose it under Add agent → Local Model when spawning. (Orchestrator env-swap for local models is a follow-up.)",
  "harness.store.local.guideRam":
    "Recommended RAM = model residency + OS/app headroom. Macs use unified memory, so the GPU shares the same RAM — the more headroom above the listed minimum, the more stable.",
  "harness.store.local.guideQuant":
    "Catalog sizes are for ollama's default 4-bit quantizations (Q4_K_M etc.). Lower-bit quantization is smaller and faster but slightly lower quality.",
  "harness.store.local.guideContext":
    "The context shown is the model's maximum. At runtime the default context is smaller (ollama defaults to ~4K), and raising it costs proportionally more memory.",
  "harness.store.local.guideToolUse":
    "Under 7B is chat-only (smoke/test). For Marblo agent/orchestrator work (MCP tool-use), use a 7B+ coder (e.g. qwen2.5-coder:7b). Injecting tools into tiny models makes them mimic tool-call JSON and answer nonsense.",
  "harness.store.local.badgeChatOnly": "Chat only",
  "harness.store.local.badgeToolUse": "Tool-use ready",
  "harness.store.local.chatOnlyHint":
    "For testing and chat. Use a 7B+ coder for real agent work.",
  "harness.store.local.toolUseHint":
    "Can run MCP tool-use / agent work. Prefer coder variants for coding tasks.",
  "harness.store.local.installedHintChatOnly":
    "Select under Local Model for chat/smoke tests. Install a 7B+ coder for ticket work.",
  "harness.store.local.installedHintToolUse":
    "Pick this under Add agent → Local Model for real agent work.",
  "harness.store.local.hardwareLine": "This machine's memory: {gb} GB",
  "harness.store.local.unifiedMemoryNote": "unified memory (shared with GPU)",
  "harness.store.local.ollamaMissing":
    "Ollama is not installed, so one-click install is unavailable. Install Ollama first:",
  "harness.store.local.ollamaInstallLink": "ollama.com/download →",
  "harness.store.local.ollamaMissingShort": "Ollama not installed",
  "harness.store.local.daemonStopped":
    "Ollama is installed but its daemon is not running. Start the Ollama app (or `ollama serve`) and refresh.",
  "harness.store.local.daemonStoppedShort": "Ollama daemon stopped",
  "harness.store.local.loading": "Checking local model status…",
  "harness.store.local.loadFail": "Could not check local model status.",
  "harness.store.local.installed": "Installed",
  "harness.store.local.fits": "Fits this machine",
  "harness.store.local.insufficientRam": "Not enough ({gb} GB needed)",
  "harness.store.local.downloadSize": "Download",
  "harness.store.local.minRam": "Min RAM",
  "harness.store.local.context": "Context",
  "harness.store.local.pull": "Install (ollama pull)",
  "harness.store.local.installing": "Installing",
  "harness.store.local.progressPending": "Preparing",
  "harness.store.local.cancel": "Cancel",
  "harness.store.local.pullDone":
    "{id} installed — selectable under Local Model when adding an agent.",
  "harness.store.local.pullCancelled":
    "Cancelled installing {id} (partial downloads resume on retry).",
  "harness.store.local.pullFail": "Failed to install {id}: {error}",
  "harness.store.local.installedHint":
    "Pick this model under Add agent → Local Model.",
  "harness.store.local.desc.qwen25_05b":
    "Lightest chat/smoke model (chat-only). Do not use for agent MCP tool-use — pick a 7B+ coder instead.",
  "harness.store.local.desc.qwen25_15b":
    "Balance of weight and quality (chat-only) — fine for summary/classify smoke tests. Real work needs 7B+ coder.",
  "harness.store.local.desc.llama32_1b":
    "Meta's tiniest model — the smallest one supporting a 128K context.",
  "harness.store.local.desc.llama32_3b":
    "Top quality among the small ones — runs comfortably on 8GB+ machines.",
  "harness.store.local.desc.phi3_mini":
    "Microsoft's 3.8B model — strong reasoning quality for its size.",
  "harness.store.local.desc.gemma2_2b":
    "Google's 2B model — good for short conversations and drafts.",
};
