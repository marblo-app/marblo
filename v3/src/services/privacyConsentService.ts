/**
 * Privacy consent — Firestore read/write for the per-user consent record.
 *
 * Schema (`users/<uid>.privacyConsent`):
 *   {
 *     sentry: boolean,        // crash reports → Sentry (US-hosted)
 *     ga4: boolean,           // usage analytics → GA4 (US-hosted)
 *     mixpanel: boolean,      // product funnel → Mixpanel (Q4 activation)
 *     overseasTransfer: boolean,  // PIPA 별도 동의: 국외 이전
 *     version: string,        // bump when policy text changes → re-prompt
 *     acceptedAt: Timestamp,  // server time at consent
 *     locale: string,         // 'ko' | 'en' | 'ja' for re-display in user lang
 *   }
 *
 * Default state when the user has not yet been prompted: every flag false.
 * PIPA 제15조 옵트인 정설 — silence is not consent.
 */
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../lib/firebase";

/** Bump this string when policy text changes. Existing users will be
 *  re-prompted because their stored version no longer matches. */
export const CURRENT_POLICY_VERSION = "2026-05-08";

export type ConsentFlags = {
  sentry: boolean;
  ga4: boolean;
  mixpanel: boolean;
  overseasTransfer: boolean;
};

export interface PrivacyConsent extends ConsentFlags {
  version: string;
  acceptedAt: Date | null;
  locale: string;
}

export const DEFAULT_CONSENT: PrivacyConsent = {
  sentry: false,
  ga4: false,
  mixpanel: false,
  overseasTransfer: false,
  version: "",
  acceptedAt: null,
  locale: "ko",
};

interface RawConsent {
  sentry?: boolean;
  ga4?: boolean;
  mixpanel?: boolean;
  overseasTransfer?: boolean;
  version?: string;
  acceptedAt?: { toDate: () => Date } | null;
  locale?: string;
}

function toConsent(raw: RawConsent | undefined): PrivacyConsent {
  if (!raw) return DEFAULT_CONSENT;
  return {
    sentry: !!raw.sentry,
    ga4: !!raw.ga4,
    mixpanel: !!raw.mixpanel,
    overseasTransfer: !!raw.overseasTransfer,
    version: raw.version ?? "",
    acceptedAt:
      raw.acceptedAt && typeof raw.acceptedAt.toDate === "function"
        ? raw.acceptedAt.toDate()
        : null,
    locale: raw.locale ?? "ko",
  };
}

export async function getConsent(uid: string): Promise<PrivacyConsent> {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    const data = snap.exists() ? snap.data() : null;
    return toConsent(
      (data?.privacyConsent as RawConsent | undefined) ?? undefined
    );
  } catch (err) {
    console.warn("[PrivacyConsent] read failed:", err);
    return DEFAULT_CONSENT;
  }
}

/** Save flags + bump version + acceptedAt. `merge: true` so we don't
 *  clobber other fields on the user doc. */
export async function saveConsent(
  uid: string,
  flags: ConsentFlags,
  locale: string = "ko"
): Promise<void> {
  await setDoc(
    doc(db, "users", uid),
    {
      privacyConsent: {
        ...flags,
        version: CURRENT_POLICY_VERSION,
        acceptedAt: serverTimestamp(),
        locale,
      },
    },
    { merge: true }
  );
}

/** True if the user has seen the current policy version. */
export function isConsentCurrent(consent: PrivacyConsent): boolean {
  return consent.version === CURRENT_POLICY_VERSION;
}
