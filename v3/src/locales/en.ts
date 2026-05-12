import type { MessageKey } from "./ko";

/**
 * English string table. Must define every key listed in ko.ts.
 * Compile-time check via the `Record<MessageKey, string>` annotation —
 * missing or extra keys flag as TS errors.
 */
export const en: Record<MessageKey, string> = {
  // ── Header ──────────────────────────────────────────────
  "header.selectProject": "Select Project",
  "header.newProject": "New Project",
  "header.projectName": "Project name",
  "header.add": "Add",
  "header.settings": "Settings",
  "header.logout": "Log out",
  "header.planBadge.suffix": "Plan",

  // ── Settings → tabs ─────────────────────────────────────
  "settings.title": "Settings",
  "settings.tab.profile": "Profile",
  "settings.tab.models": "Agent Models",
  "settings.tab.billing": "Billing",
  "settings.tab.team": "Team",
  "settings.tab.privacy": "Privacy",
  "settings.tab.apikeys": "API Keys",
  "settings.tab.language": "Language",
  "settings.profile.heading": "Profile",
  "settings.account.heading": "Account",
  "settings.account.name": "Name",
  "settings.account.email": "Email",
  "settings.account.uid": "UID",
  "settings.team.selectProjectFirst": "Select a project first.",
  "settings.models.heading": "Agent Model Preset",
  "settings.models.help":
    "Sets which models the orchestrator uses when spawning new agents. Tasks tagged with a specific model pick it directly; everything else follows the preset distribution.",
  "settings.language.heading": "Language",
  "settings.language.help": "Switch the UI language. Takes effect immediately.",
  "settings.language.korean": "한국어",
  "settings.language.english": "English",

  // ── Agents Dashboard ────────────────────────────────────
  "agents.dashboard.title": "Agent Dashboard",
  "agents.dashboard.addAgent": "Add Agent",
  "agents.dashboard.cleanup": "Cleanup",
  "agents.dashboard.cleanupConfirm":
    "Delete {count} inactive agents?\n(working agents are kept)",
  "agents.dashboard.loading": "Loading agents...",

  // ── Plans ───────────────────────────────────────────────
  "plan.free": "Free",
  "plan.pro": "Pro",
  "plan.team": "Team",
  "plan.teamPlus": "Team Plus",
  "plan.enterprise": "Enterprise",
};
