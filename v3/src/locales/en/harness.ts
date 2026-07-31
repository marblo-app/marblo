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
  "harness.store.registry.source": "Source",
  "harness.store.registry.loadFail": "Failed to load the registry list.",
  // Community tier is listed; installing it needs explicit consent — one line.
  "harness.store.registry.communityListedNote":
    "{count} of these are community (unreviewed) — installing requires explicit consent",
  "harness.store.registry.githubCatalog": "Full catalog on GitHub →",
  "harness.store.registry.emptyCatalog":
    "No assets to show. The full catalog is on GitHub.",
};
