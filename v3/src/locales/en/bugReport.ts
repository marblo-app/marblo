/**
 * English — `bugReport.*` namespace. Typed against the ko counterpart so key
 * drift is a compile-time error.
 */
import type { bugReport as koBugReport } from "../ko/bugReport";

export const bugReport: Record<keyof typeof koBugReport, string> = {
  // ── Settings → tab + section ────────────────────────────
  "bugReport.tab": "Report a Bug",
  "bugReport.heading": "Report a Bug",
  "bugReport.help":
    "Found something broken? Tell us what went wrong and we'll take a look. Diagnostic details like app version and OS are attached automatically.",
  "bugReport.button": "Report a Bug",

  // ── Modal ───────────────────────────────────────────────
  "bugReport.modal.title": "Report a Bug",
  "bugReport.modal.descriptionLabel": "What happened?",
  "bugReport.modal.descriptionPlaceholder":
    "Describe what you were doing, what went wrong, and what you expected to happen.",
  "bugReport.modal.contextHeading": "Auto-attached details",
  "bugReport.modal.appVersion": "App version",
  "bugReport.modal.platform": "Platform",
  "bugReport.modal.route": "Location",
  "bugReport.modal.agents": "Agents",
  "bugReport.modal.cancel": "Cancel",
  "bugReport.modal.submit": "Send report",
  "bugReport.modal.submitting": "Sending…",
  "bugReport.modal.required": "Please describe the bug.",
  "bugReport.modal.successTitle": "Report submitted",
  "bugReport.modal.successBody":
    "Thanks for the report — we'll look into it shortly.",
  "bugReport.modal.errorGeneric":
    "Couldn't send your report. Please try again in a moment.",
  "bugReport.modal.loginRequired": "Sign in to report a bug.",
  "bugReport.modal.rateLimited": "Too many requests. Please try again shortly.",
  "bugReport.modal.close": "Close",
};
