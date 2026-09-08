/**
 * PIPA(개인정보 보호법) 동의 상태 서비스 — marblo-web.
 *
 * v3 데스크탑 앱(v3/src/services/privacyConsentService.ts)의 consent envelope
 * (version / acceptedAt / locale + merge:true 쓰기)를 웹으로 이식한다.
 *
 * 다만 웹은 텔레메트리(sentry/ga4/mixpanel) 동의가 아니라 *가입·결제*
 * 맥락의 동의이므로 users/{uid}.webPrivacyConsent 를 canonical field 로
 * 사용한다. 기존 users/{uid}.privacyConsent 는 읽기 fallback 으로만 둔다.
 * 앱이 같은 privacyConsent 맵을 앱 스키마/버전으로 저장하므로, 웹이 같은 맵을
 * canonical 로 쓰면 양쪽이 서로를 stale 로 만들어 재프롬프트 루프가 생긴다.
 *
 * 웹 플래그:
 *   - collectionUse    : 개인정보 수집·이용 동의 (필수)
 *   - overseasTransfer : 개인정보 국외 이전 별도 동의 (필수, PIPA 제28조의8)
 *   - marketing        : 마케팅·광고성 정보 수신 (선택)
 */
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  type FieldValue,
} from "firebase/firestore";
import { db } from "./firebase";

/** 동의 문구가 바뀌면 이 버전을 올린다 → 사용자에게 재동의를 요구. */
export const CURRENT_POLICY_VERSION = "2026-07-14";

/**
 * ★마케팅 동의 **문안** 버전 — 정책 봉투 버전(`CURRENT_POLICY_VERSION`)과 **다른 축**이다.
 *
 * 왜 갈랐나 — `CURRENT_POLICY_VERSION` 은 `collectionUse`·`overseasTransfer`·
 * `marketing` 세 플래그를 한 봉투로 묶고 `hasRequiredConsent()` 가 그 값을 AND 로
 * 건다. 그래서 그 상수를 올리면 **기존 전 사용자에게 필수동의 게이트 모달이
 * 다시 뜬다.** 그런데 사장님 결정은 "재동의 캠페인은 하지 않는다"
 * (docs/marketing-hashed-email-ads-targeting-2026-09-07.md §8-1(2))다.
 * 마케팅 문안만 바뀌었으므로 마케팅 축만 따로 세는 것이 맞다.
 *
 * ★기존 문서에는 이 필드가 **없다**. 없으면 "예전 문구"로 취급된다 —
 * 마이그레이션하지 않는 것이 안전한 기본값이다. 판정은 백엔드
 * `v3/functions/src/marketingContacts.ts` 의 허용목록
 * (`ADS_PROVISION_CONSENT_VERSIONS`)이 하며, 이 상수와 **같은 문자열**이어야 한다.
 */
export const MARKETING_CONSENT_VERSION = "2026-09-08-ads";

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
  /**
   * 이 사용자가 동의한 **마케팅 문안**의 버전. 빈 문자열이면 구 문구
   * (= 구글 광고 제공 고지를 본 적 없음)다. ★기본값을 "현재 버전"으로
   * 두지 않는다 — 그러면 기존 동의자가 새 문구 동의자로 오인된다.
   */
  marketingVersion: string;
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
  marketingVersion: "",
  acceptedAt: null,
  locale: "ko",
};

interface RawConsent {
  collectionUse?: boolean;
  overseasTransfer?: boolean;
  marketing?: boolean;
  version?: string;
  marketingVersion?: string;
  acceptedAt?: { toDate: () => Date } | FieldValue | null;
  locale?: string;
}

interface RawConsentDocument {
  /** Web canonical consent. Separated from the desktop app consent schema. */
  webPrivacyConsent?: RawConsent;
  /** Legacy web location and current desktop app location. Read fallback only. */
  privacyConsent?: RawConsent;
}

function toDateOrNull(value: RawConsent["acceptedAt"]): Date | null {
  return value &&
    "toDate" in value &&
    typeof value.toDate === "function"
    ? value.toDate()
    : null;
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
    // ★없으면 "" — 구 문구다. 현재 버전으로 채우지 않는다.
    marketingVersion: raw.marketingVersion ?? "",
    acceptedAt: toDateOrNull(raw.acceptedAt),
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
    const data = snap.exists()
      ? (snap.data() as RawConsentDocument | undefined)
      : undefined;
    const raw = data?.webPrivacyConsent ?? data?.privacyConsent;
    if (!raw) return { status: "missing" };
    return { status: "ok", consent: toConsent(raw) };
  } catch (err) {
    console.warn("[privacyConsent] getConsent failed:", err);
    const code = (err as { code?: string }).code ?? null;
    return { status: "error", code };
  }
}

/**
 * ★쓰기 경로는 **이 함수 하나**다. 가입 폼·필수동의 모달·설정 토글이 전부
 *   `saveConsent()` 를 거쳐 여기로 온다 — 그래서 한 군데만 고치면 다른
 *   경로가 옛 버전으로 남는 사고가 구조적으로 안 생긴다.
 *   `v3/tests/unit/marketingVersionWritePath.test.ts` 가 이 단일 경로와
 *   앱 쪽 두 쓰기 지점까지 함께 못박는다.
 *
 * ★`marketingVersion` 은 **marketing 이 true 일 때만** 현재 문안 버전을 싣는다.
 *   끈 상태에 버전만 남으면 "동의 안 했는데 새 문구 버전을 가진 사람"이 생겨
 *   판정이 헷갈린다. 껐다가 다시 켜면 그 시점의 현재 버전이 새로 써진다 —
 *   그때 새 문구를 다시 봤으므로 그게 맞는 동작이다.
 */
function consentWritePayload(
  flags: ConsentFlags,
  locale: ConsentLocale
): { webPrivacyConsent: RawConsent } {
  return {
    webPrivacyConsent: {
      ...flags,
      version: CURRENT_POLICY_VERSION,
      marketingVersion: flags.marketing ? MARKETING_CONSENT_VERSION : "",
      acceptedAt: serverTimestamp(),
      locale,
    },
  };
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
    consentWritePayload(flags, locale),
    { merge: true }
  );
  // 서버 write 성공 → 증빙 캐시를 무장. 이후 read 실패(재로드/재방문)에도
  // 이 유저를 재프롬프트하지 않도록.
  rememberConsentAccepted(uid, CURRENT_POLICY_VERSION);
}

/**
 * #295 이전/앱 덮어쓰기 이후처럼 Firestore 의 legacy privacyConsent 가 stale
 * 이더라도, 이 브라우저에 현재 웹 정책 동의 증빙 캐시가 있으면 canonical
 * webPrivacyConsent 를 best-effort 로 복구한다. 필수 동의 gate 억제용 복구라
 * 선택 마케팅 동의는 false 로 둔다.
 */
export async function repairCachedWebConsent(
  uid: string,
  locale: ConsentLocale = "ko"
): Promise<void> {
  if (!hasAcceptedConsentCached(uid, CURRENT_POLICY_VERSION)) return;
  await setDoc(
    doc(db, "users", uid),
    consentWritePayload(
      {
        collectionUse: true,
        overseasTransfer: true,
        marketing: false,
      },
      locale
    ),
    { merge: true }
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
