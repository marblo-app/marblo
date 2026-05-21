import { create } from "zustand";
import {
  DEFAULT_CONSENT,
  getConsent,
  saveConsent,
  isConsentCurrent,
  CURRENT_POLICY_VERSION,
  type ConsentFlags,
  type PrivacyConsent,
} from "../services/privacyConsentService";

interface PrivacyConsentState {
  consent: PrivacyConsent;
  loading: boolean;
  /** True until the user has accepted the CURRENT policy version. */
  needsPrompt: boolean;
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

    load: async (uid: string) => {
      set({ loading: true });
      const consent = await getConsent(uid);
      set({
        consent,
        loading: false,
        needsPrompt: !isConsentCurrent(consent),
      });
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
      });
      await saveConsent(uid, flags, locale);
    },

    patchLocal: (flags) => {
      set({ consent: { ...get().consent, ...flags } });
    },
  }),
);
