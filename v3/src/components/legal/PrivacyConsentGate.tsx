/**
 * PrivacyConsentGate — orchestrates consent loading + modal display + SDK
 * initialization. Mounted once at the top of the authenticated app shell.
 *
 * Lifecycle:
 *   1. User signs in → Auth state ready → load consent from Firestore.
 *   2. If consent.version doesn't match CURRENT_POLICY_VERSION → show modal.
 *   3. User clicks 허용/나중에 → save flags → modal closes.
 *   4. Whenever consent flips (modal save or Settings toggle), drive
 *      Sentry/GA4 init/teardown to match.
 */
import { useEffect } from "react";
import { useAuth } from "../../hooks/useAuth";
import { usePrivacyConsentStore } from "../../stores/privacyConsentStore";
import { maybeInitSentry } from "../../lib/telemetry/sentry";
import { maybeInitGA4 } from "../../lib/telemetry/ga4";
import { PrivacyConsentModal } from "./PrivacyConsentModal";

export function PrivacyConsentGate() {
  const { user } = useAuth();
  const needsPrompt = usePrivacyConsentStore((s) => s.needsPrompt);
  const sentryConsent = usePrivacyConsentStore((s) => s.consent.sentry);
  const ga4Consent = usePrivacyConsentStore((s) => s.consent.ga4);
  const load = usePrivacyConsentStore((s) => s.load);

  // Load consent the first time we have a uid.
  useEffect(() => {
    if (!user?.uid) return;
    load(user.uid).catch((err) => {
      // Fail open with default OFF — user will see the prompt next launch.
      // 정확한 진단을 위해 err 는 콘솔에 남긴다 (service 내부 logFirestoreError
      // 가 이미 자세히 출력하지만, 호출 경로가 load 인지 save 인지 구분 위해
      // 한 줄 더).
      console.warn("[PrivacyConsentGate] load failed:", err);
    });
  }, [user?.uid, load]);

  // Drive SDK init based on current consent. maybeInit* are idempotent.
  useEffect(() => {
    maybeInitSentry(sentryConsent).catch(() => {});
    maybeInitGA4(ga4Consent).catch(() => {});
  }, [sentryConsent, ga4Consent]);

  if (!user || !needsPrompt) return null;
  return <PrivacyConsentModal />;
}
