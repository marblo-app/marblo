/**
 * 마케팅 수신동의 — 순수 로직(의존성 0).
 *
 * Firestore/Functions 를 만지는 코드는 `marketingConsentService.ts` 에 있고,
 * 여기에는 판정·로컬 저장 규약만 둔다(functions 쪽 `marketingContacts.ts` ↔
 * `index.ts` 분리와 같은 규약) — 그래야 vitest 가 firebase 부트 없이 돈다.
 *
 * ── 규제 불변식(PIPA/GDPR/CAN-SPAM) ──────────────────────────────────
 *  - 기본값은 언제나 **unchecked**. pre-check 도, "동의로 간주"도 없다.
 *  - grant 근거는 사용자가 체크박스를 켠 **그 행위 하나**뿐이다
 *    (`legalBasis=explicit_opt_in`). 다른 동의(활동/인용, 텔레메트리)를
 *    마케팅 동의로 재해석하지 않는다.
 *  - 미체크는 아무것도 쓰지 않는다 — 승격도 철회도 없다. 없는 동의를
 *    subscribed/emailable 로 만들지 않는다.
 *  - 이미 결정한 사람(granted/pending/revoked)에게는 재동의를 조르지 않는다.
 *    특히 revoked(수신거부 왕복을 마친 사람)에게 배너를 다시 띄우는 것은
 *    unsubscribe 를 무력화하는 행위다 — 구조적으로 막는다.
 */

/**
 * 동의 문안 버전. 재동의 캠페인으로 문안이 바뀌면 올린다 —
 * `users/{uid}.webPrivacyConsent.version` 에 그대로 기록되고,
 * functions 훅 1b(`decideMarketingConsentSync`)가 버전 상승을 재동의로 본다.
 */
export const MARKETING_CONSENT_VERSION = "2026-07-31";

/**
 * 서버(`getMyMarketingConsentStatus`)가 돌려주는 내 마케팅 컨택트 상태.
 * ★이메일(평문·암호문·해시) 은 절대 넘어오지 않는다 — 상태 플래그만.
 */
export type MarketingContactStatus =
  | "granted"
  | "pending"
  | "revoked"
  | "unknown"
  /** 컨택트 문서 자체가 없음(백필 이전 계정 등). 배너 대상 아님. */
  | "no_contact";

export interface MarketingConsentStatusView {
  status: MarketingContactStatus;
  unsubscribed: boolean;
  /** 파운더 세그먼트 여부 — 재동의 배너의 모수. */
  isFounder: boolean;
}

export interface ReconsentBannerInput {
  /** 서버 조회 결과. 아직 못 읽었으면 null(= 노출하지 않음). */
  view: MarketingConsentStatusView | null;
  /** 이 uid 가 "다시 안 보기" 를 눌렀나. */
  dismissed: boolean;
}

/**
 * 재동의 배너를 띄울지 판정한다.
 *
 * 노출 조건(전부 만족해야 함):
 *  1. 서버 조회가 성공했다 — 못 읽었으면(null) 조용히 미노출. 읽기 실패를
 *     "동의 안 했음" 으로 접지 않는다(privacyConsentService 의 3-state 규약과 동일).
 *  2. `status === "unknown"` — 아직 아무 결정도 안 한 사람만.
 *     granted(이미 동의) / pending(재동의 풀이지만 별도 캠페인 소관) /
 *     revoked(철회·수신거부) / no_contact 는 전부 미노출.
 *  3. 수신거부 상태가 아니다 — unsubscribe 왕복을 존중한다.
 *  4. 파운더다 — 이번 배너의 모수는 "기존 파운더 재동의" 다. 신규 가입자는
 *     온보딩 체크박스에서 이미 한 번 물었으므로, 거기서 미체크한 사람을
 *     로그인마다 다시 조르지 않는다(다크패턴 방지).
 *  5. "다시 안 보기" 를 누르지 않았다.
 */
export function shouldShowReconsentBanner({
  view,
  dismissed,
}: ReconsentBannerInput): boolean {
  if (!view) return false;
  if (dismissed) return false;
  if (view.unsubscribed) return false;
  if (view.status !== "unknown") return false;
  return view.isFounder;
}

// ─── "다시 안 보기" 로컬 기록 ────────────────────────────────────────
// 서버 상태가 아니라 UI 노출 억제일 뿐이므로 uid 별 localStorage 로 충분하다.
// (동의/철회 같은 법적 사실은 전부 Firestore 에만 기록된다.)
const DISMISS_PREFIX = "marblo:marketingReconsentDismissed:";

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function dismissKeyFor(uid: string): string {
  return `${DISMISS_PREFIX}${uid}`;
}

/** "다시 안 보기". best-effort — 저장 실패해도 throw 하지 않는다. */
export function rememberReconsentDismissed(uid: string): void {
  if (!uid) return;
  try {
    safeLocalStorage()?.setItem(dismissKeyFor(uid), "1");
  } catch {
    // private mode / quota — 배너가 다음 실행에 다시 뜰 뿐이다.
  }
}

export function hasDismissedReconsent(uid: string): boolean {
  if (!uid) return false;
  try {
    return safeLocalStorage()?.getItem(dismissKeyFor(uid)) === "1";
  } catch {
    return false;
  }
}

// ─── 가입 전(pre-sign-in) 마케팅 opt-in 파킹 ────────────────────────
/**
 * 첫 실행 플로우(FirstRunFlow)는 로그인 **전에** 동의를 묻는다 — uid 가 없어
 * Firestore 에 쓸 수 없으므로 답을 로컬에 park 하고, uid 가 생기는 순간
 * PrivacyConsentGate 가 flush 한다(프라이버시 동의와 같은 방식).
 *
 * ★프라이버시 동의 레코드(`marblo:pendingConsent`)와 **키를 분리**한다:
 *   저 레코드는 users/{uid}.privacyConsent(텔레메트리 스키마)로 flush 되고,
 *   이건 users/{uid}.webPrivacyConsent(마케팅)로 flush 된다 — 축이 다르다.
 * ★park 하는 값은 `true` 하나뿐이다. 미체크는 아무것도 저장하지 않는다 —
 *   "동의 안 함" 을 저장할 곳도, 저장할 이유도 없다.
 */
const PENDING_MARKETING_KEY = "marblo:pendingMarketingConsent";

export interface PendingMarketingConsent {
  locale: string;
  version: string;
}

export function rememberPendingMarketingOptIn(locale: string): void {
  try {
    safeLocalStorage()?.setItem(
      PENDING_MARKETING_KEY,
      JSON.stringify({ locale, version: MARKETING_CONSENT_VERSION }),
    );
  } catch {
    // best-effort. 잃어도 "동의를 못 받은 것" 일 뿐 — 없는 동의가 생기지는 않는다.
  }
}

/**
 * park 된 opt-in 을 읽는다. 문안 버전이 다르면(정책 문구 변경 후 남은 찌꺼기)
 * 사용자가 본 적 없는 문안으로 동의를 만들지 않기 위해 버리고 null.
 */
export function readPendingMarketingOptIn(): PendingMarketingConsent | null {
  try {
    const raw = safeLocalStorage()?.getItem(PENDING_MARKETING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingMarketingConsent>;
    if (parsed?.version !== MARKETING_CONSENT_VERSION) {
      clearPendingMarketingOptIn();
      return null;
    }
    return {
      locale: typeof parsed.locale === "string" ? parsed.locale : "ko",
      version: parsed.version,
    };
  } catch {
    return null;
  }
}

export function clearPendingMarketingOptIn(): void {
  try {
    safeLocalStorage()?.removeItem(PENDING_MARKETING_KEY);
  } catch {
    // best-effort
  }
}
