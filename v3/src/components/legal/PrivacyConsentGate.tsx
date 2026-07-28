/**
 * PrivacyConsentGate — orchestrates consent loading + modal display + SDK
 * initialization. Mounted once at the top of the authenticated app shell.
 *
 * Lifecycle:
 *   1. User signs in → Auth state ready → load consent from Firestore.
 *   2. If consent.version doesn't match CURRENT_POLICY_VERSION → show modal.
 *   3. User clicks 허용/나중에 → save flags → modal closes.
 *   4. Whenever consent flips (modal save or Settings toggle), drive
 *      Sentry and first-party telemetry gates to match. (GA4 is not used in
 *      the app — the website uses it separately under its own consent.)
 */
import { useEffect } from "react";
import { useAuth } from "../../hooks/useAuth";
import { usePrivacyConsentStore } from "../../stores/privacyConsentStore";
import { maybeInitSentry } from "../../lib/telemetry/sentry";
import { setTelemetryEnabled } from "../../services/telemetryService";
import {
  readPendingConsent,
  clearPendingConsent,
} from "../../services/privacyConsentService";
import { PrivacyConsentModal } from "./PrivacyConsentModal";

export function PrivacyConsentGate() {
  const { user } = useAuth();
  const needsPrompt = usePrivacyConsentStore((s) => s.needsPrompt);
  const hasLoaded = usePrivacyConsentStore((s) => s.hasLoaded);
  const sentryConsent = usePrivacyConsentStore((s) => s.consent.sentry);
  const firstPartyTelemetry = usePrivacyConsentStore(
    (s) => s.consent.firstPartyTelemetry,
  );
  const load = usePrivacyConsentStore((s) => s.load);
  const save = usePrivacyConsentStore((s) => s.save);

  // Load consent the first time we have a uid.
  useEffect(() => {
    if (!user?.uid) return;

    // The first-run flow (FirstRunFlow) asks for consent before sign-in, so the
    // answer is waiting in localStorage with no uid attached. Flush it instead
    // of reading — this user answered seconds ago, that answer is authoritative,
    // and `save` flips needsPrompt=false synchronously so the modal never
    // flashes on top of the flow that just closed.
    const pending = readPendingConsent();
    if (pending) {
      save(user.uid, pending.flags, pending.locale)
        // Only drop the parked answer once it is durably stored. On a failed
        // write we keep it and retry next launch — the alternative is losing
        // the consent record server-side and re-prompting a user who already
        // answered.
        .then(() => clearPendingConsent())
        .catch((err) => {
          console.warn(
            "[PrivacyConsentGate] pending consent flush failed:",
            err,
          );
        });
      return;
    }

    load(user.uid).catch((err) => {
      // Fail open with default OFF — user will see the prompt next launch.
      // 정확한 진단을 위해 err 는 콘솔에 남긴다 (service 내부 logFirestoreError
      // 가 이미 자세히 출력하지만, 호출 경로가 load 인지 save 인지 구분 위해
      // 한 줄 더).
      console.warn("[PrivacyConsentGate] load failed:", err);
    });
  }, [user?.uid, load, save]);

  // Drive SDK init based on current consent. maybeInitSentry is idempotent.
  useEffect(() => {
    maybeInitSentry(sentryConsent).catch(() => {});
  }, [sentryConsent]);

  useEffect(() => {
    setTelemetryEnabled(firstPartyTelemetry);
  }, [firstPartyTelemetry]);

  // Never surface the blocking modal before consent has been read at least once.
  // The store defaults needsPrompt=true (fail-safe); showing that default during
  // the initial load/retry window is exactly the cold-start + macOS-wake
  // re-prompt (the renderer is discarded+reloaded on wake, resetting the store).
  if (!user || !hasLoaded || !needsPrompt) return null;
  return <PrivacyConsentModal />;
}
