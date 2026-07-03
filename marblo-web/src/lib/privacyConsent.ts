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
export const CURRENT_POLICY_VERSION = "2026-07-14";

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
 * consent read 결과 — 세 상태를 구분한다. 일시적 read 실패를 "미동의"로
 * 접으면(fail-open→DEFAULT) 재방문/재로드마다 이미 동의한 유저에게 게이트
 * 모달이 다시 뜬다(데스크탑 앱의 sleep/resume 재프롬프트와 같은 버그).
 *
 *   - "ok"      : read 성공 + consent 레코드 존재.
 *   - "missing" : read 성공 + 레코드 없음 (진짜 미동의 → 프롬프트가 정답).
 *   - "error"   : read 실패 (offline / stale token / permission-denied / …).
 *                 저장된 동의는 UNKNOWN — 호출자는 이를 "미동의"로 간주하면 안 된다.
 */
export type GetConsentResult =
  | { status: "ok"; consent: PrivacyConsent }
  | { status: "missing" }
  | { status: "error"; code: string | null };

/**
 * users/{uid}.privacyConsent 를 읽어 세 상태로 구분한다. 절대 실패를
 * DEFAULT_CONSENT 로 접지 않는다 — 그 접힘이 재방문 재프롬프트 버그다.
 */
export async function getConsentResult(uid: string): Promise<GetConsentResult> {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    const raw = snap.exists()
      ? (snap.data()?.privacyConsent as RawConsent | undefined)
      : undefined;
    if (!raw) return { status: "missing" };
    return { status: "ok", consent: toConsent(raw) };
  } catch (err) {
    console.warn("[privacyConsent] getConsent failed:", err);
    const code = (err as { code?: string }).code ?? null;
    return { status: "error", code };
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * getConsentResult + 짧은 선형 backoff 재시도. 재로드 직후엔 첫 read 가
 * 네트워크/토큰 미준비로 실패하기 쉽다 — 한두 번 재시도하면 대개 붙는다.
 * "error" 만 재시도하고 "ok"/"missing" 은 확정값이라 즉시 반환.
 * `backoffMs` 는 주입 가능(테스트가 즉시 돌도록).
 */
export async function getConsentWithRetry(
  uid: string,
  attempts = 3,
  backoffMs = 400
): Promise<GetConsentResult> {
  let last: GetConsentResult = { status: "error", code: null };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = await getConsentResult(uid);
    if (result.status !== "error") return result;
    last = result;
    if (attempt < attempts && backoffMs > 0) await sleep(backoffMs * attempt);
  }
  return last;
}

/**
 * users/{uid}.privacyConsent 를 읽어 정규화한다. 읽기 실패는 fail-open —
 * DEFAULT_CONSENT(미동의)를 돌려준다. 게이팅(모달)이 아닌 표시용 경로(설정
 * 페이지 등)에서 쓴다. 게이트는 getConsentWithRetry 를 써서 일시 실패에
 * 재프롬프트하지 않는다.
 */
export async function getConsent(uid: string): Promise<PrivacyConsent> {
  const result = await getConsentResult(uid);
  return result.status === "ok" ? result.consent : DEFAULT_CONSENT;
}

/**
 * 로컬 동의-증빙 캐시.
 *
 * "이 uid 가 이 정책 버전 동의를 서버에 성공적으로 저장했다"를 localStorage 에
 * 기록한다. 게이트가 read 실패 시, 이미 동의한 것을 아는 유저에게 불필요한
 * 재프롬프트를 억제하는 데 쓴다 — 동의를 날조하지 않는다(실제 서버 write 성공
 * 후에만 기록, 버전 스코프라 정책 상향 시 무효화).
 */
const CONSENT_CACHE_PREFIX = "marblo:consentAccepted:";

function consentCacheKey(uid: string, version: string): string {
  return `${CONSENT_CACHE_PREFIX}${uid}:${version}`;
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/** `uid` 가 `version` 동의를 마쳤음을 기록. best-effort — 절대 throw 안 함. */
export function rememberConsentAccepted(uid: string, version: string): void {
  if (!version) return;
  try {
    safeLocalStorage()?.setItem(consentCacheKey(uid, version), "1");
  } catch {
    // private mode / quota / disabled storage — 캐시는 best-effort.
  }
}

/** 이 기기에서 `uid` 가 `version` 을 동의했다는 로컬 증빙이 있는가. */
export function hasAcceptedConsentCached(
  uid: string,
  version: string
): boolean {
  if (!version) return false;
  try {
    return safeLocalStorage()?.getItem(consentCacheKey(uid, version)) === "1";
  } catch {
    return false;
  }
}

/**
 * 동의 플래그 저장 + version/acceptedAt 갱신. merge:true 로 users/{uid} 의
 * 다른 필드를 덮어쓰지 않는다 (v3 saveConsent 와 동일 패턴).
 */
export async function saveConsent(
  uid: string,
  flags: ConsentFlags,
  locale: ConsentLocale = "ko"
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
  // 서버 write 성공 → 증빙 캐시를 무장. 이후 read 실패(재로드/재방문)에도
  // 이 유저를 재프롬프트하지 않도록.
  rememberConsentAccepted(uid, CURRENT_POLICY_VERSION);
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
