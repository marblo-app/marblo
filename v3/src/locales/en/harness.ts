/**
 * English — `harness.*` namespace. Typed `Record<keyof typeof koHarness, string>`
 * so a key present in ko but missing here (or vice-versa) is a compile error
 * for this namespace alone.
 */
import type { harness as koHarness } from "../ko/harness";

export const harness: Record<keyof typeof koHarness, string> = {
  // --- Connection status panel ---
  "harness.conn.title": "Connection",
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
    "Creating a connection from the project's local path auto-fills the repo URL and default branch from git.",
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
  "harness.store.subtitle": "CLIs, vendors, channels — what this app needs",
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
    "Connect CLIs, vendors and channels to this app.",
  // --- Telegram channel panel ---
  "harness.telegram.status.idle": "Idle",
  "harness.telegram.status.connected": "Connected",
  "harness.telegram.status.needsCheck": "Needs check",
  "harness.telegram.status.disconnected": "Disconnected",
  "harness.telegram.title": "Channel connection",
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
    "For a public channel use its @username; for a private channel/group, find the chatId in the Telegram API response.",
  "harness.telegram.guide.step4":
    "Enter the bot token and chatId, save, then turn on the active toggle.",
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
    "Invite the bot to the channel you want to use and note its channel ID.",
  "harness.slack.guide.step6":
    "Enter the Bot Token and App Token above, save, then verify with the Probe button.",
  "harness.slack.guide.step7":
    "Mention the bot in the channel and confirm the reply round-trips.",

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
  "harness.store.local.guideRam":
    "Recommended RAM = model residency + OS/app headroom. Macs use unified memory, so the GPU shares the same RAM — the more headroom above the listed minimum, the more stable.",
  "harness.store.local.guideQuant":
    "Catalog sizes are for ollama's default 4-bit quantizations (Q4_K_M etc.). Lower-bit quantization is smaller and faster but slightly lower quality.",
  "harness.store.local.guideContext":
    "The context shown is the model's maximum. At runtime the default context is smaller (ollama defaults to ~4K), and raising it costs proportionally more memory.",
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
  "harness.store.local.cancel": "Cancel",
  "harness.store.local.pullDone":
    "{id} installed — selectable under Local Model when adding an agent.",
  "harness.store.local.pullCancelled":
    "Cancelled installing {id} (partial downloads resume on retry).",
  "harness.store.local.pullFail": "Failed to install {id}: {error}",
  "harness.store.local.installedHint":
    "Pick this model under Add agent → Local Model.",
  "harness.store.local.desc.qwen25_05b":
    "The lightest smoke-test model — instant responses even on low-end machines.",
  "harness.store.local.desc.qwen25_15b":
    "A balance of weight and quality — good for simple tasks like summarizing and classifying.",
  "harness.store.local.desc.llama32_1b":
    "Meta's tiniest model — the smallest one supporting a 128K context.",
  "harness.store.local.desc.llama32_3b":
    "Top quality among the small ones — runs comfortably on 8GB+ machines.",
  "harness.store.local.desc.phi3_mini":
    "Microsoft's 3.8B model — strong reasoning quality for its size.",
  "harness.store.local.desc.gemma2_2b":
    "Google's 2B model — good for short conversations and drafts.",
};
