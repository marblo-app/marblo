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
  "harness.store.title": "Harness Store",
  "harness.store.subtitle": "Install skills / MCPs in one place",
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
  "harness.store.footerGithub":
    "Direct install from external GitHub URLs is coming later (after trust verification).",
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
};
