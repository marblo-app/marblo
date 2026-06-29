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
};
