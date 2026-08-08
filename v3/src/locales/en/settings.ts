/**
 * English — `settings.*` namespace. Typed against the ko counterpart so key
 * drift is a compile-time error.
 */
import type { settings as koSettings } from "../ko/settings";

export const settings: Record<keyof typeof koSettings, string> = {
  // ── Settings → tabs ─────────────────────────────────────
  "settings.title": "Settings",
  "settings.tab.profile": "Profile",
  "settings.tab.adminAnalytics": "Admin Analytics",
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
    "Sets which harnesses enter the competition when the orchestrator spawns a new agent. The winner is not a fixed percentage — every dispatch scores tag fit, live quota headroom, weekly token limits, recent usage and the routing graph, then picks the harness and the specific model rung inside it. Naming a model on the task overrides all of this.",
  "settings.models.customHelp":
    "Pick the harnesses yourself. Smart routing still decides the winner among them.",
  "settings.models.customLastHarness":
    "Keep at least one on — dispatch has nothing to pick from otherwise.",
  "settings.models.restartNote":
    "The preset saves immediately, but dispatch routing reads it in the Electron main process, which does not hot reload. Restart the app before checking the live spawn mix.",
  "settings.orchestratorModel.heading": "Orchestrator Model",
  "settings.orchestratorModel.help":
    "Choose which CLI runs the orchestrator itself. If MARBLO_ORCHESTRATOR_MODEL is set in the environment, the environment wins.",
  "settings.orchestratorModel.label": "Runtime model",
  "settings.orchestratorModel.restartRunning":
    "The orchestrator is currently running. Stop and start it again for this change to apply.",
  "settings.orchestratorModel.restartStopped":
    "This applies on the next orchestrator start. Electron main does not hot reload, so rebuild/restart the app before runtime verification.",
  "settings.orchestratorModel.saved":
    "Saved. Applies after the next orchestrator restart.",
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
  "settings.team.projectTabHint":
    "Workload per member (agents, in progress, review, done, merges) lives alongside this list on the Project tab.",
  "settings.team.projectTabCta": "Open Project tab",

  // ── Invitation banner (InvitationBanner) ─────────────────
  "settings.invitation.invitedYou": "{inviter} invited you to {project}",
  "settings.invitation.fallbackProject": "a project",
  "settings.invitation.accept": "Accept",
  "settings.invitation.reject": "Decline",
  "settings.invitation.joined": "Joined {project}. Switching over…",
  "settings.invitation.acceptFailed":
    "Couldn't accept the invitation. Please try again.",
  "settings.invitation.rejectFailed":
    "Couldn't decline the invitation. Please try again.",

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
  "settings.upgrade.feature.projects": "More projects",
  "settings.upgrade.feature.agents": "Unlimited agents",

  // ── Privacy settings (PrivacySettings) ───────────────────
  "settings.privacy.heading": "Privacy",
  "settings.privacy.optInDescription":
    "De-identified usage analytics is on by default and can be turned off anytime. External third-party sends (Sentry) remain opt-in.",
  "settings.privacy.firstParty.label": "Usage analytics (de-identified)",
  "settings.privacy.firstParty.hint":
    "Only anonymous install ID and aggregate metrics go to our GCP (BigQuery). Account UID, code, and input text are excluded.",
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
  "settings.subscription.heading": "Subscription billing",
  "settings.subscription.help":
    "Harnesses you run on a subscription are detected automatically below. Register an amount only if you want cost reports converted to a monthly flat rate.",
  "settings.subscription.detected.heading": "Detected CLI subscriptions",
  "settings.subscription.detected.none": "Not detected",
  "settings.subscription.detected.help":
    "Read directly from each CLI account's rate-limit windows. Whether a subscription is active — and how much of it is used — is detected this way; the monthly price is not something the CLI reports.",
  "settings.subscription.manual.heading": "Register monthly amount (advanced)",
  "settings.subscription.manual.help":
    "Enter an amount to bill cost reports at a monthly flat rate instead of per token. Vendors that aren't auto-detected above (GLM, MiniMax and others with no balance API) are declared here too. Without registration, the default per-token rate applies.",
  "settings.subscription.empty":
    "No subscription plans registered. All models are billed per token.",
  "settings.subscription.monthlyFlat": "Monthly USD",
  "settings.subscription.tokenAllowance": "Monthly token limit",
  "settings.subscription.optional": "(optional)",
  "settings.subscription.delete": "Delete",
  "settings.subscription.addPlan": "+ Add plan",
  "settings.subscription.saving": "Saving...",
  "settings.subscription.saved": "Saved",

  // ── env-swap vendor keys (SettingsPage › VendorKeysSettings) ─────
  "settings.vendorKeys.heading": "Vendor API keys (env-swap)",
  "settings.vendorKeys.help":
    "These vendors ship no CLI of their own — we spawn the same claude harness and swap only the backend. Keys registered here are encrypted with the OS keychain, stored in {path}, and injected as environment variables only into spawned agent processes. No plaintext is ever shown on screen, written to logs, or sent to the cloud.",
  "settings.vendorKeys.loading": "Loading vendor key status...",
  "settings.vendorKeys.noEncryption":
    "OS keychain encryption is unavailable on this system, so keys cannot be saved. On Linux, install libsecret-1-0 / gnome-keyring and restart. (We never fall back to plaintext storage.)",
  "settings.vendorKeys.defaultHint":
    "Points the claude harness at this vendor's endpoint.",
  "settings.vendorKeys.models": "Models: {models}",
  "settings.vendorKeys.ready": "Active",
  "settings.vendorKeys.notReady": "Not configured",
  "settings.vendorKeys.partialWarning":
    "Every required key must be present before this vendor activates. With only some of them filled in, the profile is not injected at all — a half-injected profile would send your Anthropic credentials to someone else's endpoint.",
  "settings.vendorKeys.unset": "Not set",
  "settings.vendorKeys.sourceEnv":
    "· using shell/.env value (takes precedence over the stored key)",
  "settings.vendorKeys.sourceStore": "· app store",
  "settings.vendorKeys.replacePlaceholder":
    "Entering a new key replaces the stored one",
  "settings.vendorKeys.newPlaceholder": "Key issued from {console}",
  "settings.vendorKeys.save": "Save",
  "settings.vendorKeys.delete": "Delete",
  "settings.vendorKeys.envWinsNotice":
    "A shell/.env variable of the same name exists and takes precedence. To use the stored key, unset the shell variable and restart.",
  "settings.vendorKeys.saved": "Key saved securely (OS keychain encryption).",
  "settings.vendorKeys.saveFailed": "Failed to save the key.",
  "settings.vendorKeys.deleted": "Stored key deleted.",
  "settings.vendorKeys.deleteFailed": "Failed to delete the key.",
  "settings.vendorKeys.respawnNotice":
    "Agents already running hold their own copy of the environment — a new key takes effect from the next spawn.",
  "settings.vendorKeys.consoleFallback": "the vendor console",
  "settings.vendorKeys.hint.zai":
    "GLM Coding Plan subscription key. Points the claude harness at the Z.ai endpoint.",
  "settings.vendorKeys.hint.minimax":
    "MiniMax Token Plan subscription key. Points the claude harness at the MiniMax endpoint.",
};
