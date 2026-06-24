/**
 * English — `settings.*` namespace. Typed against the ko counterpart so key
 * drift is a compile-time error.
 */
import type { settings as koSettings } from "../ko/settings";

export const settings: Record<keyof typeof koSettings, string> = {
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
};
