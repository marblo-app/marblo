/**
 * First-run flow — the single sequence a brand-new install goes through:
 *
 *   ① language picker  →  ② privacy/telemetry consent  →  app
 *
 * Both steps are still mandatory gates; what changed is that they are now one
 * continuous flow instead of two overlays separated by seconds.
 *
 * ── Why (F5, cleanroom #633/#641) ────────────────────────────────────────────
 * The language picker gates on localStorage only, so it appeared instantly.
 * The consent modal gated on auth uid → Firestore read (3 attempts, 400/800ms
 * backoff), so it appeared ~5s later (measured 5012ms) — a second full-screen
 * `fixed inset-0` overlay dropping onto a screen the user had already started
 * clicking. Two blocking layers, staggered, with an interactive-but-doomed gap
 * in between.
 *
 * The fix is to stop deriving step ② from a network read. Consent is collected
 * here, before sign-in, in the same tick the language step closes. There is no
 * uid yet, so the answer is parked in localStorage (`rememberPendingConsent`)
 * and PrivacyConsentGate flushes it to Firestore the moment a uid appears.
 * Nothing is inferred or assumed on the user's behalf — the parked record is
 * their literal answer, version-scoped to the policy text they were shown.
 *
 * ── What still runs the old way ──────────────────────────────────────────────
 * Existing installs (locale already chosen, no in-progress marker) never enter
 * this flow, so the policy-version-bump re-prompt keeps going through
 * PrivacyConsentGate exactly as before. This is deliberate: without it, every
 * already-consented user would get re-asked once, since their prior consent
 * lives under a uid we can't read before sign-in.
 */
import { useEffect, useState } from "react";
import { hasChosenLocale } from "../../lib/i18n";
import {
  markFirstRunFlowFinished,
  markFirstRunFlowStarted,
} from "../../lib/firstRunFlow";
import {
  rememberPendingConsent,
  readPendingConsent,
  type ConsentFlags,
} from "../../services/privacyConsentService";
import { usePrivacyConsentStore } from "../../stores/privacyConsentStore";
import { PrivacyConsentModal } from "../legal/PrivacyConsentModal";
import { LanguageFirstRun } from "./LanguageFirstRun";

interface FirstRunFlowProps {
  /** Called once both steps are answered — host unmounts the flow. */
  onComplete: () => void;
}

export function FirstRunFlow({ onComplete }: FirstRunFlowProps) {
  const patchLocal = usePrivacyConsentStore((s) => s.patchLocal);
  // Step is decided once, at mount: whichever gates are still open. A resumed
  // flow (quit after ①) skips straight to ②.
  const [step, setStep] = useState<"language" | "consent">(() =>
    hasChosenLocale() ? "consent" : "language",
  );

  useEffect(() => {
    markFirstRunFlowStarted();
  }, []);

  // Already answered on a previous, interrupted run — nothing left to ask.
  useEffect(() => {
    if (step === "consent" && readPendingConsent()) {
      markFirstRunFlowFinished();
      onComplete();
    }
  }, [step, onComplete]);

  const handleConsent = async (flags: ConsentFlags, locale: string) => {
    rememberPendingConsent(flags, locale);
    // Reflect the answer in-session too, so the optional-SDK gates in
    // PrivacyConsentGate act on it as soon as they mount rather than on the
    // all-off default until the Firestore flush lands.
    patchLocal(flags);
  };

  if (step === "language") {
    // No gap by construction: this setState renders the consent step in the
    // same commit that unmounts the picker.
    return <LanguageFirstRun onComplete={() => setStep("consent")} />;
  }

  return (
    <PrivacyConsentModal
      onSubmit={handleConsent}
      onComplete={() => {
        markFirstRunFlowFinished();
        onComplete();
      }}
    />
  );
}
