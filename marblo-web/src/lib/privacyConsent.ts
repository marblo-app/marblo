/**
 * PIPA(개인정보 보호법) 동의 상태 서비스 — marblo-web.
 *
 * v3 데스크탑 앱(v3/src/services/privacyConsentService.ts)의 스키마/저장
 * 패턴을 웹으로 이식한다. 동일한 Firestore 문서 경로
 * (users/{uid}.privacyConsent)와 envelope(version / acceptedAt / locale +
 * merge:true 쓰기)를 그대로 사용해 데스크탑과 스키마 정합을 유지한다.
 *
 * 다만 웹은 텔레메트리(sentry/ga4/mixpanel) 동의가 아니라 *가입·결제* 맥락의
 * 동의이므로 플래그를 다음으로 치환한다:
 *   - collectionUse    : 개인정보 수집·이용 동의 (필수)
 *   - overseasTransfer : 개인정보 국외 이전 별도 동의 (필수, PIPA 제28조의8)
 *   - marketing        : 마케팅·광고성 정보 수신 (선택)
 */
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";

/** 동의 문구가 바뀌면 이 버전을 올린다 → 사용자에게 재동의를 요구. */
export const CURRENT_POLICY_VERSION = "2026-06-18";

export type ConsentLocale = "ko" | "en" | "ja";

export type ConsentFlags = {
  /** 개인정보 수집·이용 동의 (필수) */
  collectionUse: boolean;
  /** 개인정보 국외 이전 별도 동의 (필수, PIPA 제28조의8) */
  overseasTransfer: boolean;
  /** 마케팅·광고성 정보 수신 (선택) */
  marketing: boolean;
};

export interface PrivacyConsent extends ConsentFlags {
  version: string;
  acceptedAt: Date | null;
  locale: ConsentLocale;
}

/** 가입·결제를 진행하려면 반드시 동의해야 하는 필수 항목. */
export const REQUIRED_FLAGS: (keyof ConsentFlags)[] = [
  "collectionUse",
  "overseasTransfer",
];

export const DEFAULT_CONSENT: PrivacyConsent = {
  collectionUse: false,
  overseasTransfer: false,
  marketing: false,
  version: "",
  acceptedAt: null,
  locale: "ko",
};

interface RawConsent {
  collectionUse?: boolean;
  overseasTransfer?: boolean;
  marketing?: boolean;
  version?: string;
  acceptedAt?: { toDate: () => Date } | null;
  locale?: string;
}

function toConsent(raw: RawConsent | undefined): PrivacyConsent {
  if (!raw) return DEFAULT_CONSENT;
  const locale: ConsentLocale =
    raw.locale === "en" || raw.locale === "ja" ? raw.locale : "ko";
  return {
    collectionUse: !!raw.collectionUse,
    overseasTransfer: !!raw.overseasTransfer,
    marketing: !!raw.marketing,
    version: raw.version ?? "",
    acceptedAt:
      raw.acceptedAt && typeof raw.acceptedAt.toDate === "function"
        ? raw.acceptedAt.toDate()
        : null,
    locale,
  };
}

/**
 * users/{uid}.privacyConsent 를 읽어 정규화한다. 읽기 실패는 fail-open —
 * DEFAULT_CONSENT(미동의)를 돌려준다. 실제 강제(게이팅)는 가입 폼 + 결제
 * 단계 + Gate 모달에서 이뤄진다.
 */
export async function getConsent(uid: string): Promise<PrivacyConsent> {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    const data = snap.exists() ? snap.data() : null;
    return toConsent(
      (data?.privacyConsent as RawConsent | undefined) ?? undefined,
    );
  } catch (err) {
    console.warn("[privacyConsent] getConsent failed:", err);
    return DEFAULT_CONSENT;
  }
}

/**
 * 동의 플래그 저장 + version/acceptedAt 갱신. merge:true 로 users/{uid} 의
 * 다른 필드를 덮어쓰지 않는다 (v3 saveConsent 와 동일 패턴).
 */
export async function saveConsent(
  uid: string,
  flags: ConsentFlags,
  locale: ConsentLocale = "ko",
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
    { merge: true },
  );
}

/** 사용자가 현재 정책 버전을 본(동의 기록한) 적이 있는가. */
export function isConsentCurrent(consent: PrivacyConsent): boolean {
  return consent.version === CURRENT_POLICY_VERSION;
}

/**
 * 필수 동의를 현재 버전 기준으로 모두 마쳤는가 — 가입·결제 게이팅의 기준.
 * 버전이 바뀌면(정책 개정) 다시 false 가 되어 재동의를 요구한다.
 */
export function hasRequiredConsent(consent: PrivacyConsent): boolean {
  return (
    isConsentCurrent(consent) &&
    REQUIRED_FLAGS.every((f) => consent[f] === true)
  );
}
