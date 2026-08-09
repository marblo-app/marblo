/**
 * Privacy consent — Firestore read/write for the per-user consent record.
 *
 * Schema (`users/<uid>.privacyConsent`):
 *   {
 *     firstPartyTelemetry: boolean, // de-identified first-party analytics
 *     sentry: boolean,        // crash reports → Sentry (US-hosted)
 *     ga4: boolean,           // usage analytics → GA4 (US-hosted)
 *     mixpanel: boolean,      // product funnel → Mixpanel (Q4 activation)
 *     overseasTransfer: boolean,  // PIPA 별도 동의: 국외 이전
 *     version: string,        // bump when policy text changes → re-prompt
 *     acceptedAt: Timestamp,  // server time at consent
 *     locale: string,         // 'ko' | 'en' | 'ja' for re-display in user lang
 *   }
 *
 * Default state when the user has not yet been prompted: first-party
 * de-identified analytics true; third-party / overseas flags false.
 */
import {
  doc,
  getDocFromServer,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { db } from "../lib/firebase";

/**
 * Firestore 호출 실패 시 정확한 진단을 위한 상세 로그.
 * FirebaseError 의 code 는 "permission-denied", "unauthenticated", "not-found" 등.
 * 추가로 auth.currentUser 의 상태와 호출 시점 uid 일치 여부 까지 함께 출력.
 */
function logFirestoreError(label: string, err: unknown, uid: string): void {
  const auth = getAuth();
  const cur = auth.currentUser;
  const fbErr = err as { code?: string; name?: string; message?: string };
  console.error(`[PrivacyConsent:${label}] failed`, {
    code: fbErr.code,
    name: fbErr.name,
    message: fbErr.message,
    requestedUid: uid,
    authUid: cur?.uid ?? null,
    uidMatch: cur?.uid === uid,
    emailVerified: cur?.emailVerified ?? null,
    isAnonymous: cur?.isAnonymous ?? null,
    providerId: cur?.providerData?.[0]?.providerId ?? null,
  });
}

/** Bump this string when policy text changes. Existing users will be
 *  re-prompted because their stored version no longer matches. */
export const CURRENT_POLICY_VERSION = "2026-06-01";

export type ConsentFlags = {
  firstPartyTelemetry: boolean;
  sentry: boolean;
  ga4: boolean;
  mixpanel: boolean;
  overseasTransfer: boolean;
  /**
   * ★생성형 파인튜닝용 학습데이터(프롬프트/응답 **원문**) 캡처 동의
   * (ticket IqcXHVbT0rXnHloXpV7n).
   *
   * 위 플래그들과 성격이 다르다: 저 넷은 비식별 지표를 어디로 보낼지의 문제고,
   * 이건 원문 텍스트(코드·PII)를 보관해도 되는지의 문제다. 그래서 저장소도
   * 분리돼 있고(admin 전용 BigQuery marblo_training), **오늘은 운영자 본인
   * (ADMIN_UID)에게만 열린다** — 다른 계정은 이 값이 true 여도 서버가 거부한다
   * (전면 옵트인 설계는 로드맵 ZFgn4zpt).
   *
   * optional 인 이유: 최초 실행 동의 모달(PIPA 옵트인 4항목)에 이 항목을 넣지
   * 않기 위해서다. 넣으면 정책 버전을 올려야 하고, 그러면 전 사용자가 동의
   * 팝업을 다시 보게 된다(#797~#809 saga). 미설정(undefined)의 해석은 서버가
   * 한다 — 운영자 본인은 자기동의로 ON, 그 외는 애초에 비적격.
   */
  trainingDataCapture?: boolean;
};

export interface PrivacyConsent extends ConsentFlags {
  /** 로컬 표시용으로는 항상 boolean(미설정=false)으로 정규화된다. */
  trainingDataCapture: boolean;
  version: string;
  acceptedAt: Date | null;
  locale: string;
}

export const DEFAULT_CONSENT: PrivacyConsent = {
  firstPartyTelemetry: true,
  sentry: false,
  ga4: false,
  mixpanel: false,
  overseasTransfer: false,
  trainingDataCapture: false,
  version: "",
  acceptedAt: null,
  locale: "ko",
};

interface RawConsent {
  firstPartyTelemetry?: boolean;
  sentry?: boolean;
  ga4?: boolean;
  mixpanel?: boolean;
  overseasTransfer?: boolean;
  trainingDataCapture?: boolean;
  version?: string;
  acceptedAt?: { toDate: () => Date } | null;
  locale?: string;
}

/**
 * Result of a consent read. We MUST distinguish three outcomes — folding a
 * transient read failure into "no consent" is exactly the sleep/resume bug:
 *
 *   - "ok"      : Firestore read succeeded and a consent record exists.
 *   - "missing" : read succeeded but the user has no consent record yet
 *                 (genuinely not consented → prompt is correct).
 *   - "error"   : read FAILED (offline, stale auth token, permission-denied,
 *                 unavailable, …). The stored consent is UNKNOWN — callers must
 *                 NOT treat this as "not consented". PIPA 옵트인 정설: 실패는
 *                 '동의 간주'도 '미동의 간주'도 아니다 — 그냥 모른다.
 */
export type GetConsentResult =
  | {
      status: "ok";
      consent: PrivacyConsent;
      readSource?: "server";
      attempts?: number;
    }
  | { status: "missing"; readSource?: "server"; attempts?: number }
  | {
      status: "error";
      code: string | null;
      readSource?: "server";
      attempts?: number;
    };

function toConsent(raw: RawConsent | undefined): PrivacyConsent {
  if (!raw) return DEFAULT_CONSENT;
  return {
    firstPartyTelemetry: raw.firstPartyTelemetry !== false,
    sentry: !!raw.sentry,
    ga4: !!raw.ga4,
    mixpanel: !!raw.mixpanel,
    overseasTransfer: !!raw.overseasTransfer,
    trainingDataCapture: !!raw.trainingDataCapture,
    version: raw.version ?? "",
    acceptedAt:
      raw.acceptedAt && typeof raw.acceptedAt.toDate === "function"
        ? raw.acceptedAt.toDate()
        : null,
    locale: raw.locale ?? "ko",
  };
}

/**
 * Read the consent record for `uid`, distinguishing a successful read (with or
 * without a record) from a failed read. NEVER returns DEFAULT_CONSENT on
 * failure — that conflation is the sleep/resume re-prompt bug.
 */
export async function getConsent(uid: string): Promise<GetConsentResult> {
  try {
    const snap = await getDocFromServer(doc(db, "users", uid));
    const raw = snap.exists()
      ? (snap.data()?.privacyConsent as RawConsent | undefined)
      : undefined;
    if (!raw) return { status: "missing", readSource: "server" };
    return { status: "ok", consent: toConsent(raw), readSource: "server" };
  } catch (err) {
    logFirestoreError("getConsent", err, uid);
    const code = (err as { code?: string }).code ?? null;
    return { status: "error", code, readSource: "server" };
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * getConsent with a short linear backoff over transient failures. On wake the
 * very first read often fails (network not up / auth token not refreshed yet);
 * one or two retries usually land once connectivity returns. A first "missing"
 * is also verified before being returned so a cold auth/permission race cannot
 * surface the modal from a single empty read.
 *
 * `backoffMs` is injectable so unit tests can run retries instantly.
 */
export async function getConsentWithRetry(
  uid: string,
  attempts = 3,
  backoffMs = 400,
): Promise<GetConsentResult> {
  let last: GetConsentResult = { status: "error", code: null };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = await getConsent(uid);
    last = { ...result, attempts: attempt };
    if (result.status === "ok") return last;
    if (result.status === "missing" && attempt >= attempts) return last;
    if (attempt < attempts && backoffMs > 0) await sleep(backoffMs * attempt);
  }
  return last;
}

class ConsentWriteVerificationError extends Error {
  constructor(
    readonly uid: string,
    readonly result: GetConsentResult,
  ) {
    super(
      `Privacy consent write verification failed: ${result.status}${
        result.status === "ok" ? `:${result.consent.version}` : ""
      }`,
    );
    this.name = "ConsentWriteVerificationError";
  }
}

function describeReadOutcome(result: GetConsentResult): {
  outcome: GetConsentResult["status"];
  code: string | null;
  storedVersion: string | null;
} {
  return {
    outcome: result.status,
    code: result.status === "error" ? result.code : null,
    storedVersion: result.status === "ok" ? result.consent.version : null,
  };
}

function logConsentWriteVerification(
  uid: string,
  result: GetConsentResult,
): void {
  console.error("[PrivacyConsent:saveConsent] read-back verification failed", {
    requestedUid: uid,
    ...describeReadOutcome(result),
    currentVersion: CURRENT_POLICY_VERSION,
  });
}

async function verifySavedConsent(uid: string): Promise<void> {
  const result = await getConsentWithRetry(uid, 3, 250);
  if (
    result.status === "ok" &&
    result.consent.version === CURRENT_POLICY_VERSION
  ) {
    console.info("[PrivacyConsent:saveConsent] read-back verified", {
      requestedUid: uid,
      storedVersion: result.consent.version,
      currentVersion: CURRENT_POLICY_VERSION,
    });
    return;
  }

  logConsentWriteVerification(uid, result);
  throw new ConsentWriteVerificationError(uid, result);
}

/**
 * Local proof-of-consent cache.
 *
 * Records "this uid successfully saved consent for this policy version" in
 * localStorage. Used by the store on a FAILED read to suppress a needless
 * re-prompt for someone we KNOW already consented (sleep/resume), without ever
 * fabricating consent — the key is written only after a real server write
 * succeeds, and it is version-scoped so a policy bump invalidates it.
 *
 * ⚠ This proves "do not re-prompt", NOT "consent is granted". Optional-SDK
 * gating still reads the live flags; this only governs modal visibility.
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

/** Record that `uid` accepted `version`. Best-effort — never throws. */
export function rememberConsentAccepted(uid: string, version: string): void {
  if (!version) return;
  try {
    safeLocalStorage()?.setItem(consentCacheKey(uid, version), "1");
  } catch {
    // private mode / quota / disabled storage — cache is best-effort.
  }
}

/** True iff we have local proof `uid` accepted `version` on this device. */
export function hasAcceptedConsentCached(
  uid: string,
  version: string,
): boolean {
  if (!version) return false;
  try {
    return safeLocalStorage()?.getItem(consentCacheKey(uid, version)) === "1";
  } catch {
    return false;
  }
}

/**
 * Pending (pre-sign-in) consent.
 *
 * The first-run flow asks for consent in one continuous sequence right after
 * the language picker — which is *before* the user has signed in, so there is
 * no uid to write against yet. The answer is parked here and flushed to
 * Firestore by PrivacyConsentGate the moment a uid appears.
 *
 * Why not just ask after sign-in (the old behavior)? Because the consent read
 * is auth + network bound, so the modal landed ~5s after the language modal —
 * a second full-screen overlay dropping onto a screen the user had already
 * started clicking (F5, cleanroom #633/#641).
 *
 * Version-scoped like the proof-of-consent cache: a policy bump invalidates a
 * stale pending answer rather than flushing consent to text the user never saw.
 */
const PENDING_CONSENT_KEY = "marblo:pendingConsent";

export interface PendingConsent {
  flags: ConsentFlags;
  locale: string;
  version: string;
}

/** Park a pre-sign-in consent answer. Best-effort — never throws. */
export function rememberPendingConsent(
  flags: ConsentFlags,
  locale: string,
): void {
  try {
    safeLocalStorage()?.setItem(
      PENDING_CONSENT_KEY,
      JSON.stringify({ flags, locale, version: CURRENT_POLICY_VERSION }),
    );
  } catch {
    // private mode / quota / disabled storage. The user still gets asked again
    // after sign-in via the Gate — we lose the head start, not the consent.
  }
}

/**
 * Read a parked answer for the CURRENT policy version, or null. A record for a
 * superseded version is dropped (and cleared) rather than returned.
 */
export function readPendingConsent(): PendingConsent | null {
  try {
    const raw = safeLocalStorage()?.getItem(PENDING_CONSENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingConsent>;
    if (parsed?.version !== CURRENT_POLICY_VERSION || !parsed.flags) {
      clearPendingConsent();
      return null;
    }
    return {
      flags: {
        firstPartyTelemetry: parsed.flags.firstPartyTelemetry !== false,
        sentry: !!parsed.flags.sentry,
        ga4: !!parsed.flags.ga4,
        mixpanel: !!parsed.flags.mixpanel,
        overseasTransfer: !!parsed.flags.overseasTransfer,
      },
      locale: parsed.locale ?? "ko",
      version: parsed.version,
    };
  } catch {
    // Unparseable/unavailable — treat as absent. Don't clear blindly here;
    // a storage throw would just throw again.
    return null;
  }
}

/** Drop the parked answer (after a successful flush). Never throws. */
export function clearPendingConsent(): void {
  try {
    safeLocalStorage()?.removeItem(PENDING_CONSENT_KEY);
  } catch {
    // best-effort
  }
}

/**
 * Drop keys whose value is `undefined`.
 *
 * `trainingDataCapture` is optional, so a caller that never decided it (the
 * first-run modal) leaves it undefined — and Firestore rejects an undefined
 * field value outright, which would fail the whole consent write. Omitting the
 * key is also the semantically right thing: with `merge: true` a previously
 * stored value survives instead of being silently reset.
 */
function definedFlags(flags: ConsentFlags): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(flags)) {
    if (typeof value === "boolean") out[key] = value;
  }
  return out;
}

/** Save flags + bump version + acceptedAt. `merge: true` so we don't
 *  clobber other fields on the user doc. */
export async function saveConsent(
  uid: string,
  flags: ConsentFlags,
  locale: string = "ko",
): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await setDoc(
        doc(db, "users", uid),
        {
          privacyConsent: {
            ...definedFlags(flags),
            version: CURRENT_POLICY_VERSION,
            acceptedAt: serverTimestamp(),
            locale,
          },
        },
        { merge: true },
      );
      await verifySavedConsent(uid);
      // Server write is durably observable → arm the proof-of-consent cache so
      // a later read failure (sleep/resume, offline) won't re-prompt this user.
      rememberConsentAccepted(uid, CURRENT_POLICY_VERSION);
      return;
    } catch (err) {
      lastError = err;
      logFirestoreError(`saveConsent attempt ${attempt}`, err, uid);
      if (attempt < 2) await sleep(300 * attempt);
    }
  }
  throw lastError;
}

/** True if the user has seen the current policy version. */
export function isConsentCurrent(consent: PrivacyConsent): boolean {
  return consent.version === CURRENT_POLICY_VERSION;
}
