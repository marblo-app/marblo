/**
 * English — `legal.*` namespace. Typed `Record<keyof typeof koLegal, string>`
 * so key drift vs ko is a compile error for this namespace alone.
 */
import type { legal as koLegal } from "../ko/legal";

export const legal: Record<keyof typeof koLegal, string> = {
  "legal.privacy.title": "Privacy Policy",
  "legal.privacy.close": "Close",
  "legal.privacy.summaryHeading": "Summary",
  "legal.privacy.measuresHeading": "Technical safeguards",
  "legal.privacy.contactHeading": "Contact",
  "legal.privacy.contactPrefix": "Privacy inquiries / data deletion requests: ",

  // ── Privacy consent modal (PrivacyConsentModal) ──────────
  "legal.consent.heading": "Help us make Marblo more reliable",
  "legal.consent.body":
    "Consenting to sending data to the <b>third-party services (US-hosted)</b> below helps us improve Marblo faster. <b>We never send your code, BYOK keys, or input.</b> All features work the same if you decline. (First-party quality metrics are collected as de-identified data only — see Details.)",
  "legal.consent.sentry.label": "Send crash reports (Sentry, US-hosted)",
  "legal.consent.sentry.hint":
    "File paths, environment variables, and BYOK keys are auto-masked in stack traces.",
  "legal.consent.overseas.label":
    "Separate consent for overseas transfer (PIPA Art. 15(2))",
  "legal.consent.overseas.hint":
    "Sentry processes data on US servers. This consent is required to enable the option above.",
  "legal.consent.overseasRequired":
    "Sentry is US-hosted, so overseas transfer consent is required.",
  "legal.consent.saveFailed": "Save failed",
  "legal.consent.viewDetails":
    "View details (collected items · retention · effect of declining)",
  "legal.consent.later": "Later",
  "legal.consent.saving": "Saving...",
  "legal.consent.allow": "Allow",

  // ── Marketing email opt-in (optional) — separate from telemetry consent ──
  "legal.consent.marketing.label":
    "Marketing emails (optional) — product news, updates, and event invites",
  "legal.consent.marketing.hint":
    "Sent to your sign-up email. All features work the same if you decline, and you can withdraw any time via the unsubscribe link in every email.",

  // ── Training-data contribution card (TrainingConsentCard) ──
  "legal.training.heading":
    "Make Marblo better — contribute your work to model improvement",
  "legal.training.body":
    "Marblo learns which model to hand which job to. If you'd like, your work can help with that learning.",
  "legal.training.alreadyOn.label": "Already on · de-identified metrics",
  "legal.training.alreadyOn.hint":
    "An anonymous install ID and aggregate metrics (de-identified derived features such as model, duration, and success) are used to improve routing quality. No raw text is included, and you can turn this off any time in Settings → Privacy.",
  "legal.training.rawText.label":
    "Optional · contribute raw prompts & responses",
  "legal.training.rawText.hint":
    "Stores the raw text of your own agent turns (which may include code) in a separate secure store used to train our own models. Fully isolated from the de-identified metrics, never shared with third parties, and withdrawable any time. Your consent is recorded immediately; actual collection opens up in phases.",
  "legal.training.noPressure":
    "Optional — every feature works exactly the same if you don't take part.",
  "legal.training.viewDetails":
    "View details (collected items · retention · withdrawal)",
  "legal.training.optIn": "Count me in",
  "legal.training.later": "Later",
  "legal.training.saving": "Saving...",
  "legal.training.thanks":
    "Thank you! You can change this any time in Settings → Privacy.",

  // ── Re-consent banner for existing users (MarketingReconsentBanner) ──
  "legal.reconsent.label": "Get product news by email",
  "legal.reconsent.basis":
    "Product news, updates, and event invites sent to your sign-up email. Optional — withdraw any time via the unsubscribe link in every email.",
  "legal.reconsent.submit": "Save consent",
  "legal.reconsent.saving": "Saving...",
  "legal.reconsent.savedNotice": "Consent saved. Thank you!",
  "legal.reconsent.saveFailed": "Save failed — please try again later.",
  "legal.reconsent.dismiss": "Don't show again",

  // ── One-time privacy-policy clarification (PrivacyClarificationNotice) ──
  // ★This copy informs; it does not ask. No "agree"/"accept" wording — the
  //   banner stores nothing.
  "legal.clarification.label": "Your privacy policy has changed",
  "legal.clarification.body":
    "We previously wrote that the two records could not be matched up — we are taking that back: to see in aggregate how people came to Marblo, we sometimes connect service usage records with website visit records using identifiers processed so that they cannot identify anyone. The information needed to turn those identifiers back into the original is kept separately, and the result is used only for statistical analysis. We collect nothing new from you and are not asking you to consent again — you will see this notice once and it will not come back.",
  "legal.clarification.viewDetails": "Details",
  "legal.clarification.dismiss": "Dismiss",
};
