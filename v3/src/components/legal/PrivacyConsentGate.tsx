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
  CURRENT_POLICY_VERSION,
  readPendingConsent,
  clearPendingConsent,
} from "../../services/privacyConsentService";
import {
  readPendingMarketingOptIn,
  clearPendingMarketingOptIn,
} from "../../services/marketingConsent";
import { saveMarketingOptIn } from "../../services/marketingConsentService";
import { PrivacyConsentModal } from "./PrivacyConsentModal";

export function PrivacyConsentGate() {
  const { user } = useAuth();
  const needsPrompt = usePrivacyConsentStore((s) => s.needsPrompt);
  const hasLoaded = usePrivacyConsentStore((s) => s.hasLoaded);
  const storedVersion = usePrivacyConsentStore((s) => s.consent.version);
  const lastReadOutcome = usePrivacyConsentStore((s) => s.lastReadOutcome);
  const lastReadCode = usePrivacyConsentStore((s) => s.lastReadCode);
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

  // 가입 전 첫 실행 플로우에서 켠 마케팅 opt-in 을 uid 가 생기는 순간 flush.
  //
  // ★프라이버시 동의 flush 와 분리된 효과다: 저장 위치가 다르고(privacyConsent
  //   ↔ webPrivacyConsent), 한쪽 실패가 다른 쪽을 막으면 안 된다. write 가
  //   성공했을 때만 park 을 지운다 — 실패 시 다음 실행에서 다시 시도한다
  //   (동의를 받고도 잃어버리는 것이 최악).
  useEffect(() => {
    if (!user?.uid) return;
    const pendingMarketing = readPendingMarketingOptIn();
    if (!pendingMarketing) return;
    saveMarketingOptIn(user.uid, pendingMarketing.locale)
      .then(() => clearPendingMarketingOptIn())
      .catch((err) => {
        console.warn(
          "[PrivacyConsentGate] pending marketing opt-in flush failed:",
          err,
        );
      });
  }, [user?.uid]);

  useEffect(() => {
    console.info("[PrivacyConsentGate] evaluation", {
      hasUser: !!user,
      uid: user?.uid ?? null,
      hasLoaded,
      needsPrompt,
      showPrompt: !!user && hasLoaded && needsPrompt,
      readOutcome: lastReadOutcome,
      readCode: lastReadCode,
      storedVersion: storedVersion || null,
      currentVersion: CURRENT_POLICY_VERSION,
      versionCurrent: storedVersion === CURRENT_POLICY_VERSION,
    });
  }, [
    user,
    hasLoaded,
    needsPrompt,
    lastReadOutcome,
    lastReadCode,
    storedVersion,
  ]);

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
