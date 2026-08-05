import { create } from "zustand";
import {
  DEFAULT_CONSENT,
  getConsentWithRetry,
  saveConsent,
  isConsentCurrent,
  hasAcceptedConsentCached,
  rememberConsentAccepted,
  CURRENT_POLICY_VERSION,
  type ConsentFlags,
  type GetConsentResult,
  type PrivacyConsent,
} from "../services/privacyConsentService";

type ConsentReadOutcome = GetConsentResult["status"] | "not_loaded";

interface PrivacyConsentState {
  consent: PrivacyConsent;
  loading: boolean;
  /** True until the user has accepted the CURRENT policy version. */
  needsPrompt: boolean;
  /**
   * False until `load()` has resolved at least once for the current renderer.
   *
   * `needsPrompt` defaults to `true` (fail-safe), but that default must NEVER be
   * shown to the user before we've actually read their consent — otherwise the
   * blocking modal flashes on every cold start, and on macOS wake (which
   * discards+reloads the renderer, resetting this store) the already-consented
   * user watches the modal reappear for the whole read/retry window. The Gate
   * gates the modal on `hasLoaded` so it only ever appears after an
   * authoritative resolution.
   */
  hasLoaded: boolean;
  lastReadOutcome: ConsentReadOutcome;
  lastReadCode: string | null;
  load: (uid: string) => Promise<void>;
  save: (uid: string, flags: ConsentFlags, locale?: string) => Promise<void>;
  /** Local update without Firestore write — used for optimistic UI in
   *  Settings toggles. Pair with save() afterward. */
  patchLocal: (flags: Partial<ConsentFlags>) => void;
}

/**
 * Holds the current user's consent record. Loaded once at sign-in
 * (Layout drives this via auth subscription). UI components read flags
 * to decide whether to show the onboarding modal and to gate optional
 * SDK initialization (Sentry/GA4/Mixpanel).
 */
export const usePrivacyConsentStore = create<PrivacyConsentState>(
  (set, get) => ({
    consent: DEFAULT_CONSENT,
    loading: false,
    needsPrompt: true,
    hasLoaded: false,
    lastReadOutcome: "not_loaded",
    lastReadCode: null,

    load: async (uid: string) => {
      set({ loading: true });
      const result = await getConsentWithRetry(uid);
      const cacheHit = hasAcceptedConsentCached(uid, CURRENT_POLICY_VERSION);

      const diagnose = (needsPrompt: boolean, storedVersion: string | null) => {
        console.info("[PrivacyConsentStore] load outcome", {
          readOutcome: result.status,
          readCode: result.status === "error" ? result.code : null,
          storedVersion,
          currentVersion: CURRENT_POLICY_VERSION,
          versionCurrent: storedVersion === CURRENT_POLICY_VERSION,
          cacheHit,
          needsPrompt,
        });
      };

      if (result.status === "ok") {
        // Authoritative read. Re-prompt only if the stored version is stale.
        const { consent } = result;
        const needsPrompt = !isConsentCurrent(consent);
        set({
          consent,
          loading: false,
          hasLoaded: true,
          needsPrompt,
          lastReadOutcome: result.status,
          lastReadCode: null,
        });
        diagnose(needsPrompt, consent.version);
        // Keep the proof-of-consent cache in sync so a later read failure
        // (sleep/resume, offline) won't re-prompt this already-consented user.
        if (isConsentCurrent(consent)) {
          rememberConsentAccepted(uid, consent.version);
        }
        return;
      }

      if (result.status === "missing") {
        // Read succeeded, user genuinely has no consent record → prompt.
        set({
          consent: DEFAULT_CONSENT,
          loading: false,
          hasLoaded: true,
          needsPrompt: true,
          lastReadOutcome: result.status,
          lastReadCode: null,
        });
        diagnose(true, null);
        return;
      }

      // result.status === "error": the read FAILED, so the stored consent is
      // unknown. Do NOT flip needsPrompt to true on a transient failure — that
      // is the sleep/resume bug. If we have local proof this user already
      // accepted the CURRENT policy version, keep the modal hidden; otherwise
      // hold the existing needsPrompt (don't surface the modal off a failure).
      // PIPA 옵트인 정설: 실패 시 '동의 간주'가 아니라 '이미 동의자 재프롬프트 안 함'.
      if (cacheHit) {
        set({
          loading: false,
          hasLoaded: true,
          needsPrompt: false,
          lastReadOutcome: result.status,
          lastReadCode: result.code,
        });
        diagnose(false, get().consent.version || null);
      } else {
        set({
          loading: false,
          hasLoaded: true,
          lastReadOutcome: result.status,
          lastReadCode: result.code,
        });
        diagnose(get().needsPrompt, get().consent.version || null);
      }
    },

    save: async (uid, flags, locale = "ko") => {
      // Local state 를 먼저 set — Firestore write 가 실패해도 같은 세션
      // 동안은 모달이 다시 안 뜨도록 보장 (UX 우선). Write 실패는 catch 후
      // 그대로 throw — 호출자가 토스트/로그 처리. needsPrompt 가 이미
      // false 라 다음 mount 에서 모달 재출현 안 함.
      set({
        consent: {
          ...get().consent,
          ...flags,
          version: CURRENT_POLICY_VERSION,
          acceptedAt: new Date(),
          locale,
        },
        needsPrompt: false,
        hasLoaded: true,
      });
      await saveConsent(uid, flags, locale);
    },

    patchLocal: (flags) => {
      set({ consent: { ...get().consent, ...flags } });
    },
  }),
);
