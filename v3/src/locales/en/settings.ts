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

  // ── Team management (TeamManagement) ─────────────────────
  "settings.team.inviteHeading": "Invite member",
  "settings.team.email": "Email",
  "settings.team.role": "Role",
  "settings.team.inviting": "Sending...",
  "settings.team.inviteButton": "Invite",
  "settings.team.pendingInvitations": "Pending invitations ({count})",
  "settings.team.membersHeading": "Members ({count})",
  "settings.team.you": "(You)",
  "settings.team.remove": "Remove",
  "settings.team.empty": "No members yet.",

  // ── Invitation banner (InvitationBanner) ─────────────────
  "settings.invitation.invitedYou": "{inviter} invited you to {project}",
  "settings.invitation.fallbackProject": "a project",
  "settings.invitation.accept": "Accept",
  "settings.invitation.reject": "Decline",

  // ── Plan gate (PlanGate) ─────────────────────────────────
  "settings.planGate.requiresPlan":
    "This feature is available on the {plan} plan and higher.",
  "settings.planGate.upgradeButton": "Upgrade plan",

  // ── Upgrade modal (UpgradeModal) ─────────────────────────
  "settings.upgrade.needed": "Upgrade required",
  "settings.upgrade.featureRequiresPlan":
    "{feature} is available on the {plan} plan and higher.",
  "settings.upgrade.planLabel": "{plan} plan",
  "settings.upgrade.projectsUnlimited": "Unlimited projects",
  "settings.upgrade.projectsCount": "{count} projects",
  "settings.upgrade.agentsUnlimited": "Unlimited agents",
  "settings.upgrade.agentsCount": "{count} agents",
  "settings.upgrade.processing": "Processing...",
  "settings.upgrade.upgradeTo": "Upgrade to {plan}",
  "settings.upgrade.feature.flowEditor": "Flow editor",
  "settings.upgrade.feature.teamCollab": "Team collaboration",
  "settings.upgrade.feature.orchestrator": "Orchestrator",
  "settings.upgrade.feature.prioritySupport": "Priority support",

  // ── Privacy settings (PrivacySettings) ───────────────────
  "settings.privacy.heading": "Privacy",
  "settings.privacy.optInDescription":
    "Sending data to the external third party (Sentry) is opt-in. All Marblo features work normally if you decline.",
  "settings.privacy.sentry.label": "Anonymous crash reports (Sentry)",
  "settings.privacy.sentry.hint": "PII is auto-masked in stack traces.",
  "settings.privacy.bigquery.label": "First-party quality metrics (BigQuery)",
  "settings.privacy.bigquery.body":
    "Only de-identified data (anonymous install ID, token/cost/event types) is collected to our GCP. Account UID, code, and input text are never included, and nothing is shared with third parties.",
  "settings.privacy.overseas.notice":
    "Overseas transfer consent: {status} — Sentry processes data in the US (PIPA Art. 15(2)).",
  "settings.privacy.overseas.agreed": "✓ Agreed",
  "settings.privacy.overseas.required": "Required",
  "settings.privacy.viewPolicy": "View privacy policy",
  "settings.privacy.requestDeletion": "Request data deletion (PIPA Art. 36)",
  "settings.privacy.lastUpdated":
    "Consent last updated: {date} (policy version {version})",
  "settings.privacy.deletion.subject":
    "[Marblo] Telemetry data deletion request",
  "settings.privacy.deletion.body":
    "Hello,\n\nI request deletion of the following user's telemetry data (PIPA Art. 36).\n\nUser UID: {uid}\n\nTarget services:\n[ ] Sentry (crash reports)\n\nPlease respond within 30 days.\n",
  "settings.saveFailed": "Save failed",

  // ── Subscription plans (SettingsPage › SubscriptionPlansSection) ─
  "settings.subscription.heading": "Register subscription plans",
  "settings.subscription.help":
    "If you use models on a monthly subscription (e.g. Claude Max, ChatGPT Plus), register them here. Registered models are billed at the monthly flat rate instead of per-token; optionally, once a monthly token allowance is exceeded, only the overage is billed per token. Without registration, the default per-token rate applies.",
  "settings.subscription.empty":
    "No subscription plans registered. All models are billed per token.",
  "settings.subscription.monthlyFlat": "Monthly USD",
  "settings.subscription.tokenAllowance": "Monthly token limit",
  "settings.subscription.optional": "(optional)",
  "settings.subscription.delete": "Delete",
  "settings.subscription.addPlan": "+ Add plan",
  "settings.subscription.saving": "Saving...",
  "settings.subscription.saved": "Saved",
};
