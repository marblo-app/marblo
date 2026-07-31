// marketing_contacts 운영 SoT — 순수 로직 모듈.
//
// firebase 의존성 없는 순수 함수만 둔다(redact.ts 와 동일 규약) — 컴파일 후
// `node --test` 로 바로 검증 가능. Firestore/Auth/BQ 를 만지는 코드는 전부
// index.ts 쪽 훅·콜러블에 있다.
//
// 프라이버시 원칙:
//  - 평문 이메일은 Firestore 에 저장하지 않는다. AES-256-GCM 암호문(emailEnc)과
//    sha256 해시(normalizedEmailHash=docId)만 저장한다.
//  - BigQuery 미러(contactToBqRow)에는 암호문조차 내보내지 않는다 — 해시·도메인·
//    상태·세그먼트만. (분석에 평문 이메일이 필요하면 그건 설계 위반이다.)
//  - unsubscribe 토큰은 HMAC 파생(stateless) — 평문 토큰을 어디에도 저장하지
//    않고, 검증은 재계산 + timing-safe 비교로 한다.
import {
  createHash,
  createHmac,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "crypto";

// ─── 컬렉션 경로(단일소스) ──────────────────────────────────────────
export const MARKETING_CONTACTS_COLLECTION = "marketing_contacts";
export const CONSENT_EVENTS_SUBCOLLECTION = "consent_events";
export const PUSH_TOKENS_COLLECTION = "push_tokens";

// ─── 타입 ──────────────────────────────────────────────────────────
/**
 * 마케팅 수신동의 상태.
 *  - granted: 유효한 마케팅 수신동의 있음 → 발송 가능
 *  - pending: 재동의 캠페인 대상 풀. waitlist 폼의 체크박스는 "활동/인용 동의"
 *    이지 개인정보(이메일) 수집·이용/마케팅 수신동의가 아니다
 *    (marblo-web/docs/COMPLIANCE-AUDIT.md D2, PIPA Med) — 그래서 granted 로
 *    승격하지 않고 pending 으로만 적재한다. 발송 불가.
 *  - revoked: 철회/수신거부 → 발송 불가, 훅으로 되살리지 않음
 *  - unknown: 동의 증거 없음(Auth-만 가입자 등) → 발송 불가
 */
export type ConsentStatus = "granted" | "pending" | "revoked" | "unknown";
export type UnsubscribeStatus = "subscribed" | "unsubscribed";
export type LifecycleStage = "lead" | "signup" | "founder" | "subscriber";

export type ContactSource =
  | "auth_signup"
  | "waitlist"
  | "founder"
  | "subscription"
  | "manual";

export interface EmailMarketingConsent {
  status: ConsentStatus;
  /** 동의가 어디서 왔나: waitlist_form | backfill_waitlist | unsubscribe_link | admin | ... */
  source: string;
  /** 동의 문안 버전(재동의 캠페인 시 갱신) */
  version: string;
  consentedAt: unknown | null; // Firestore Timestamp | Date | null
  revokedAt: unknown | null;
  /**
   * 법적 근거.
   *  - explicit_opt_in: 마케팅 전용 체크박스 동의 (granted 의 유일한 정상 근거)
   *  - none: 근거 없음 — pending/unknown/백필 컨택트의 기본값.
   * ★waitlist agreed=true 를 근거로 쓰지 않는다: 그 체크박스는 활동/인용 동의로
   *   감사(COMPLIANCE-AUDIT.md D2)가 판정했다. 근거를 날조하지 말 것.
   */
  legalBasis: "explicit_opt_in" | "none";
}

export interface ContactSubscription {
  plan: string | null;
  status: string | null;
  provider: string | null;
  periodEnd: unknown | null;
}

export interface ContactUnsubscribe {
  status: UnsubscribeStatus;
  /** sha256(HMAC 토큰) — 감사 대조용. 평문 토큰은 어디에도 저장하지 않는다. */
  tokenHash: string | null;
  unsubscribedAt: unknown | null;
}

/** marketing_contacts/{contactId} 문서 형태. contactId = sha256(normalizedEmail). */
export interface MarketingContactDoc {
  uid: string | null;
  normalizedEmailHash: string;
  /** AES-256-GCM 암호문("v1:" 포맷). 키 미설정 환경에선 null(해시만으로 dedupe). */
  emailEnc: string | null;
  /** 집계용 도메인(gmail.com 등) — 평문 local part 는 저장하지 않는다. */
  emailDomain: string;
  source: ContactSource;
  locale: string;
  signupAt: unknown | null; // Auth metadata.creationTime
  founderStatus: string | null; // founders/{email}.status 미러
  subscription: ContactSubscription;
  emailMarketingConsent: EmailMarketingConsent;
  unsubscribe: ContactUnsubscribe;
  segments: string[];
  lifecycleStage: LifecycleStage;
  createdAt: unknown;
  updatedAt: unknown;
}

/**
 * push_tokens/{uid_deviceId} — 이번 티켓은 스키마 정의만(적재는 후속).
 * 푸시 마케팅 동의(pushMarketingConsent)는 이메일 동의와 완전히 분리된 축이다.
 */
export interface PushTokenDoc {
  uid: string;
  deviceId: string;
  platform: "ios" | "android" | "web" | "desktop";
  /** FCM 토큰 평문이 아니라 sha256 해시. 평문은 발송 시스템 도입 시 KMS 검토. */
  tokenHash: string;
  pushMarketingConsent: {
    status: ConsentStatus;
    consentedAt: unknown | null;
    revokedAt: unknown | null;
  };
  createdAt: unknown;
  updatedAt: unknown;
}

export interface ConsentEvent {
  type:
    | "granted"
    | "pending_init" // 재동의 대상 풀 편입(마케팅 동의 아님 — 발송 불가)
    | "revoked"
    | "unsubscribed"
    | "backfill_init"
    | "resubscribed";
  channel: "email" | "push";
  source: string;
  actor: string; // "system" | "backfill" | "unsubscribe_link" | admin uid
  detail: string;
  at: unknown;
}

// ─── 이메일 정규화·해시 ─────────────────────────────────────────────
export function normalizeMarketingEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** contactId = sha256(normalizedEmail) — 이메일당 문서 1개가 docId 로 보장된다. */
export function contactIdForEmail(email: string): string {
  return sha256Hex(normalizeMarketingEmail(email));
}

export function emailDomainOf(email: string): string {
  const normalized = normalizeMarketingEmail(email);
  const at = normalized.lastIndexOf("@");
  return at > 0 ? normalized.slice(at + 1) : "";
}

// ─── 이메일 암호화 (AES-256-GCM) ────────────────────────────────────
// 포맷: "v1:<b64 iv>:<b64 authTag>:<b64 ciphertext>"
// 키: base64 인코딩된 32바이트 (env MARKETING_EMAIL_ENC_KEY — 값 출력 금지)
const EMAIL_ENC_VERSION = "v1";

export function parseEncKey(keyBase64: string): Buffer | null {
  if (!keyBase64) return null;
  try {
    const key = Buffer.from(keyBase64, "base64");
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

export function encryptEmail(email: string, keyBase64: string): string {
  const key = parseEncKey(keyBase64);
  if (!key) {
    throw new Error(
      "MARKETING_EMAIL_ENC_KEY must be base64-encoded 32 bytes (value not logged)",
    );
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const normalized = normalizeMarketingEmail(email);
  const ct = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    EMAIL_ENC_VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ct.toString("base64"),
  ].join(":");
}

export function decryptEmail(emailEnc: string, keyBase64: string): string {
  const key = parseEncKey(keyBase64);
  if (!key) {
    throw new Error(
      "MARKETING_EMAIL_ENC_KEY must be base64-encoded 32 bytes (value not logged)",
    );
  }
  const parts = emailEnc.split(":");
  if (parts.length !== 4 || parts[0] !== EMAIL_ENC_VERSION) {
    throw new Error(
      `unsupported emailEnc format (expected ${EMAIL_ENC_VERSION})`,
    );
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

// ─── unsubscribe 토큰 (HMAC, stateless) ─────────────────────────────
// token = HMAC-SHA256(secret, "unsub:" + contactId) hex.
// 평문 토큰은 저장하지 않는다 — 링크 생성 시 파생, 검증 시 재계산.
export function unsubscribeTokenForContact(
  contactId: string,
  secret: string,
): string {
  if (!secret) throw new Error("MARKETING_UNSUB_SECRET is not configured");
  return createHmac("sha256", secret)
    .update(`unsub:${contactId}`, "utf8")
    .digest("hex");
}

export function verifyUnsubscribeToken(
  contactId: string,
  token: string,
  secret: string,
): boolean {
  if (!secret || !token || !contactId) return false;
  const expected = unsubscribeTokenForContact(contactId, secret);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(token, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function buildUnsubscribeUrl(
  functionsBaseUrl: string,
  contactId: string,
  secret: string,
): string {
  const token = unsubscribeTokenForContact(contactId, secret);
  return `${functionsBaseUrl}/unsubscribeMarketingEmail?c=${encodeURIComponent(
    contactId,
  )}&t=${encodeURIComponent(token)}`;
}

// ─── emailable 판정 (마케팅 발송 게이트의 단일소스) ──────────────────
export interface EmailableVerdict {
  ok: boolean;
  reason:
    | "ok"
    | "no_contact"
    | "consent_not_granted"
    | "unsubscribed"
    | "no_email";
}

export function isEmailable(
  contact: Pick<
    MarketingContactDoc,
    "emailMarketingConsent" | "unsubscribe" | "emailEnc"
  > | null,
): EmailableVerdict {
  if (!contact) return { ok: false, reason: "no_contact" };
  if (contact.unsubscribe?.status === "unsubscribed") {
    return { ok: false, reason: "unsubscribed" };
  }
  if (contact.emailMarketingConsent?.status !== "granted") {
    return { ok: false, reason: "consent_not_granted" };
  }
  return { ok: true, reason: "ok" };
}

// ─── consent 병합 (upsert·훅의 단일 판정) ───────────────────────────
/**
 * 컨택트 consent 전이 요청. 셋 다 "요청"일 뿐이며 실제 적용 여부는
 * mergeEmailConsent 가 현재 상태를 보고 판정한다.
 */
export interface ConsentMergeRequest {
  /** 명시적 마케팅 수신동의 부여 (unknown|pending 일 때만 적용) */
  grant?: {
    source: string;
    version: string;
    legalBasis: EmailMarketingConsent["legalBasis"];
    consentedAt?: unknown | null;
  } | null;
  /** 재동의 대상 풀 편입 (unknown 일 때만 적용) — 발송 불가 상태 유지 */
  pending?: { source: string; detail: string } | null;
  /** 동의 철회 (granted|pending 일 때 적용) */
  revoke?: { source: string; detail: string } | null;
}

export interface ConsentMergeResult {
  consent: EmailMarketingConsent;
  /** 실제로 상태가 바뀐 경우에만 non-null — consent_events 에 기록할 항목 */
  event: { type: ConsentEvent["type"]; source: string; detail: string } | null;
}

export const UNKNOWN_CONSENT: EmailMarketingConsent = {
  status: "unknown",
  source: "",
  version: "",
  consentedAt: null,
  revokedAt: null,
  legalBasis: "none",
};

/**
 * consent 병합의 단일 판정기. 훅 5개·백필·설정 변경이 전부 여기로 수렴한다.
 *
 * 우선순위와 불변식:
 *  1. ★철회가 동의를 이긴다 — revoke 요청이 있으면 grant 요청은 무시한다.
 *     (같은 write 에서 둘 다 오는 일은 없지만, 오면 안전한 쪽으로 접는다.)
 *  2. grant: unknown|pending → granted. ★revoked 는 절대 되살리지 않는다 —
 *     재동의는 revoked 상태를 명시적으로 지우는 별도 경로에서만.
 *  3. pending: unknown → pending. granted 를 pending 으로 강등하지 않는다.
 *  4. 그 외에는 현재 상태 그대로(멱등) — event 도 null 이라 중복 기록이 없다.
 *
 * `now` 는 타임스탬프 값을 주입받는다(운영: serverTimestamp 센티넬, 테스트: Date).
 */
export function mergeEmailConsent(
  base: EmailMarketingConsent | null | undefined,
  request: ConsentMergeRequest,
  now: unknown,
): ConsentMergeResult {
  const current = base ?? UNKNOWN_CONSENT;

  if (
    request.revoke &&
    (current.status === "granted" || current.status === "pending")
  ) {
    return {
      consent: {
        status: "revoked",
        source: request.revoke.source,
        version: current.version,
        consentedAt: current.consentedAt,
        revokedAt: now,
        legalBasis: current.legalBasis,
      },
      event: {
        type: "revoked",
        source: request.revoke.source,
        detail: request.revoke.detail,
      },
    };
  }

  if (
    request.grant &&
    !request.revoke &&
    (current.status === "unknown" || current.status === "pending")
  ) {
    return {
      consent: {
        status: "granted",
        source: request.grant.source,
        version: request.grant.version,
        consentedAt: request.grant.consentedAt ?? now,
        revokedAt: null,
        legalBasis: request.grant.legalBasis,
      },
      event: {
        type: "granted",
        source: request.grant.source,
        detail: `legalBasis=${request.grant.legalBasis} version=${request.grant.version}`,
      },
    };
  }

  if (request.pending && !request.revoke && current.status === "unknown") {
    return {
      consent: {
        status: "pending",
        source: request.pending.source,
        version: "",
        consentedAt: null,
        revokedAt: null,
        legalBasis: "none",
      },
      event: {
        type: "pending_init",
        source: request.pending.source,
        detail: request.pending.detail,
      },
    };
  }

  return { consent: current, event: null };
}

// ─── users/{uid}.webPrivacyConsent → 마케팅 동의 동기화 판정 ──────────
/**
 * ★마케팅 수신동의의 유일한 소스는 users/{uid}.webPrivacyConsent.marketing 이다.
 *
 * 데스크탑 앱이 쓰는 users/{uid}.privacyConsent 는 텔레메트리 동의
 * (firstPartyTelemetry/sentry/ga4/mixpanel/overseasTransfer) 스키마로,
 * marketing 필드 자체가 없다 — 읽지 않는다. waitlist 의 agreed 도 마찬가지로
 * 마케팅 동의가 아니다(COMPLIANCE-AUDIT.md D2).
 */
export interface WebPrivacyConsentRaw {
  marketing?: unknown;
  version?: unknown;
  locale?: unknown;
  acceptedAt?: unknown;
}

export interface UserDocRaw {
  webPrivacyConsent?: WebPrivacyConsentRaw;
  [key: string]: unknown;
}

export type MarketingConsentSyncAction =
  | {
      kind: "none";
      reason: "no_consent_record" | "unchanged" | "never_opted_in";
    }
  | {
      kind: "grant";
      version: string;
      locale: string;
      consentedAt: unknown | null;
    }
  | { kind: "revoke"; reason: "opted_out" };

/**
 * users/{uid} write 를 보고 마케팅 컨택트에 무엇을 해야 하는지 판정한다.
 *
 * ★"동의를 안 한 사람"과 "동의를 철회한 사람"을 구분한다. marketing 이 처음부터
 * false 인 사람(가입 시 체크 안 함)은 revoke 대상이 아니다 — 애초에 granted 인
 * 적이 없으므로 아무것도 하지 않는다(never_opted_in). true→false 전이만 철회다.
 *
 * ★멱등: marketing 이 그대로면(둘 다 true, 또는 acceptedAt 만 갱신) unchanged 로
 * 접어 users 문서의 무관한 필드 갱신마다 컨택트를 다시 쓰지 않는다. 단 동의 문안
 * 버전이 오르면(재동의) grant 를 다시 흘려보낸다.
 */
export function decideMarketingConsentSync(
  before: UserDocRaw | null | undefined,
  after: UserDocRaw | null | undefined,
): MarketingConsentSyncAction {
  const afterConsent = after?.webPrivacyConsent;
  if (!afterConsent) return { kind: "none", reason: "no_consent_record" };

  const beforeConsent = before?.webPrivacyConsent;
  const wasMarketing = beforeConsent?.marketing === true;
  const isMarketing = afterConsent.marketing === true;

  if (!isMarketing) {
    // 동의한 적 없는 사람은 건드리지 않는다 — granted 로 올리지도, revoke 하지도 않음.
    return wasMarketing
      ? { kind: "revoke", reason: "opted_out" }
      : { kind: "none", reason: "never_opted_in" };
  }

  const version =
    typeof afterConsent.version === "string" ? afterConsent.version : "";
  const beforeVersion =
    typeof beforeConsent?.version === "string" ? beforeConsent.version : "";
  // 이미 동의 상태 그대로이고 버전도 같으면 재적용 불필요(멱등).
  if (wasMarketing && version === beforeVersion) {
    return { kind: "none", reason: "unchanged" };
  }

  const locale =
    typeof afterConsent.locale === "string" ? afterConsent.locale : "ko";
  return {
    kind: "grant",
    version,
    locale,
    consentedAt: afterConsent.acceptedAt ?? null,
  };
}

/**
 * 백필 전용: users/{uid} 문서 한 장을 보고 "이 사람에게 명시적 마케팅 동의가
 * 실제로 기록돼 있는가"만 판정해 grant 요청을 만든다(없으면 null).
 *
 * ★훅(syncMarketingConsentOnUserWrite)과 같은 판정기 decideMarketingConsentSync
 *   를 재사용한다 — 백필과 훅의 동의 기준이 갈라지는 것을 구조적으로 막는다.
 * ★null 이 아닌 값을 돌려주는 경우는 webPrivacyConsent.marketing === true
 *   하나뿐이다. 동의 기록이 없거나(false·필드 없음·문서 없음) 앱의
 *   privacyConsent(텔레메트리 스키마)뿐인 사용자를 granted 로 만드는 경로는
 *   없다 — 동의 없는 발송은 PIPA 위반이다.
 * ★revoke 는 돌려주지 않는다: 백필에는 before 스냅샷이 없어 true→false 전이를
 *   관측할 수 없고, 철회 판정은 훅의 책임이다. 이미 revoked 인 컨택트는
 *   mergeEmailConsent 가 되살리지 않는다(우선순위 2).
 */
export function backfillConsentGrantFromUserDoc(
  userDoc: UserDocRaw | null | undefined,
): {
  locale: string;
  grant: {
    source: string;
    version: string;
    legalBasis: EmailMarketingConsent["legalBasis"];
    consentedAt: unknown | null;
  };
} | null {
  const action = decideMarketingConsentSync(null, userDoc);
  if (action.kind !== "grant") return null;
  return {
    locale: action.locale,
    grant: {
      source: "web_privacy_consent",
      version: action.version,
      legalBasis: "explicit_opt_in",
      consentedAt: action.consentedAt,
    },
  };
}

// ─── waitlist(베타신청) 폼 → 마케팅 동의 판정 ─────────────────────────
/**
 * betatester50_waitlist/{docId} 문서 형태 — 훅 판정에 필요한 필드만.
 *
 *  - agreed: "활동/인용 동의"(파운더 활동·설문·리뷰 인용). 마케팅 수신동의가
 *    아니다(COMPLIANCE-AUDIT.md D2) — grant 근거로 쓰지 않는다.
 *  - marketingConsent: 폼의 별도 마케팅 수신동의 체크박스(★기본 unchecked).
 *    이것만 explicit_opt_in grant 의 근거다.
 */
export interface WaitlistDocRaw {
  agreed?: unknown;
  marketingConsent?: unknown;
  marketingConsentVersion?: unknown;
  marketingConsentAt?: unknown;
}

export type WaitlistConsentDecision =
  | { kind: "grant"; version: string; consentedAt: unknown | null }
  | { kind: "pending" }
  | { kind: "none" };

/**
 * waitlist 신청 문서 하나를 보고 컨택트 consent 를 어떻게 다뤄야 하는지
 * 판정한다. 훅(syncMarketingContactOnWaitlistCreate)이 이 결과를
 * upsertMarketingContact 의 grantConsent/markPending 요청으로 그대로 옮긴다.
 *
 * 우선순위: marketingConsent=true 만 grant. 그 외 agreed=true 는 여전히
 * pending(재동의 대상 풀)까지만 — grant 근거가 아니다. 둘 다 없으면 none.
 */
export function decideWaitlistConsentGrant(
  data: WaitlistDocRaw,
): WaitlistConsentDecision {
  if (data.marketingConsent === true) {
    return {
      kind: "grant",
      version:
        typeof data.marketingConsentVersion === "string"
          ? data.marketingConsentVersion
          : "",
      consentedAt: data.marketingConsentAt ?? null,
    };
  }
  if (data.agreed === true) return { kind: "pending" };
  return { kind: "none" };
}

// ─── 내 동의 상태 조회(재동의 배너 게이트) ───────────────────────────
/**
 * 클라이언트에 돌려줄 "내 마케팅 컨택트 상태" — ★상태 플래그만.
 *
 * `marketing_contacts` 는 Firestore 룰에서 클라이언트 접근이 전면 차단이라
 * (Admin SDK 전용) 앱은 이 뷰를 onCall(`getMyMarketingConsentStatus`)로만 본다.
 * 이메일은 평문도, `emailEnc` 암호문도, `normalizedEmailHash` 도 넘기지 않는다 —
 * 배너를 띄울지 판정하는 데 필요 없는 정보다.
 */
export interface MarketingConsentStatusView {
  /** 컨택트 문서가 아예 없으면 no_contact(배너 대상 아님). */
  status: ConsentStatus | "no_contact";
  unsubscribed: boolean;
  isFounder: boolean;
}

export function marketingConsentStatusView(
  contact: Partial<MarketingContactDoc> | null | undefined,
): MarketingConsentStatusView {
  if (!contact) {
    return { status: "no_contact", unsubscribed: false, isFounder: false };
  }
  const founderStatus = contact.founderStatus ?? null;
  return {
    status: contact.emailMarketingConsent?.status ?? "unknown",
    unsubscribed: contact.unsubscribe?.status === "unsubscribed",
    // 세그먼트가 1차 근거. 백필 순서에 따라 세그먼트가 아직 안 붙은 컨택트도
    // founderStatus 미러로 잡는다(rejected 는 제외 — deriveSegments 와 동일 기준).
    isFounder:
      (Array.isArray(contact.segments) &&
        contact.segments.includes("founder")) ||
      (!!founderStatus && founderStatus !== "rejected"),
  };
}

/**
 * 재동의 배너 노출 판정(서버측 단일소스 — 렌더러의 shouldShowReconsentBanner 와
 * 같은 규칙을 서버에서도 고정해 단위테스트로 지킨다).
 *
 * ★`unknown` 하나만 노출 대상이다:
 *   - granted: 이미 동의 — 다시 물을 이유가 없다.
 *   - pending: 재동의 캠페인 풀. 별도 승인 캠페인 소관이지 로그인 배너가 아니다.
 *   - revoked: 철회/수신거부. 여기에 배너를 띄우면 unsubscribe 왕복이 무의미해진다.
 *   - no_contact: 판정 근거 자체가 없다.
 * ★unsubscribed 는 status 와 무관하게 즉시 차단한다.
 */
export function shouldPromptReconsent(
  view: MarketingConsentStatusView,
): boolean {
  if (view.unsubscribed) return false;
  if (view.status !== "unknown") return false;
  return view.isFounder;
}

// ─── lifecycle·세그먼트 파생 ────────────────────────────────────────
export interface ContactFlags {
  hasWaitlist: boolean;
  hasAuthAccount: boolean;
  isFounder: boolean;
  founderRejected: boolean;
  hasActivePaidSubscription: boolean;
  hasActiveFounderGrant: boolean;
}

export function deriveLifecycleStage(f: ContactFlags): LifecycleStage {
  if (f.hasActivePaidSubscription) return "subscriber";
  if (f.isFounder && !f.founderRejected) return "founder";
  if (f.hasAuthAccount) return "signup";
  return "lead";
}

export function deriveSegments(f: ContactFlags): string[] {
  const segments: string[] = [];
  if (f.hasWaitlist) segments.push("waitlist");
  if (f.hasAuthAccount) segments.push("auth_user");
  if (f.isFounder && !f.founderRejected) segments.push("founder");
  if (f.founderRejected) segments.push("founder_rejected");
  if (f.hasActivePaidSubscription) segments.push("paid");
  if (f.hasActiveFounderGrant) segments.push("beta_active");
  return segments;
}

// ─── BigQuery 미러 행 매핑 ──────────────────────────────────────────
// ★평문 이메일도, emailEnc 암호문도 절대 내보내지 않는다.
export interface MarketingContactBqRow {
  snapshot_date: string; // YYYY-MM-DD
  contact_id: string;
  uid: string | null;
  email_hash: string;
  email_domain: string;
  source: string;
  locale: string;
  signup_at: string | null; // ISO
  founder_status: string | null;
  subscription_plan: string | null;
  subscription_status: string | null;
  subscription_provider: string | null;
  subscription_period_end: string | null; // ISO
  consent_status: string;
  consent_legal_basis: string;
  consent_version: string;
  consented_at: string | null; // ISO
  unsubscribe_status: string;
  unsubscribed_at: string | null; // ISO
  segments: string[];
  lifecycle_stage: string;
  created_at: string | null; // ISO
  updated_at: string | null; // ISO
}

// Firestore Timestamp | Date | number | null → ISO string | null
export function toIsoOrNull(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "number") return new Date(v).toISOString();
  if (v instanceof Date) return v.toISOString();
  const ts = v as { toMillis?: () => number; seconds?: number };
  if (typeof ts.toMillis === "function") {
    return new Date(ts.toMillis()).toISOString();
  }
  if (typeof ts.seconds === "number") {
    return new Date(ts.seconds * 1000).toISOString();
  }
  return null;
}

export function contactToBqRow(
  contactId: string,
  data: Partial<MarketingContactDoc>,
  snapshotDate: string,
): MarketingContactBqRow {
  const consent = data.emailMarketingConsent;
  const sub = data.subscription;
  const unsub = data.unsubscribe;
  return {
    snapshot_date: snapshotDate,
    contact_id: contactId,
    uid: data.uid ?? null,
    email_hash: data.normalizedEmailHash ?? contactId,
    email_domain: data.emailDomain ?? "",
    source: data.source ?? "manual",
    locale: data.locale ?? "ko",
    signup_at: toIsoOrNull(data.signupAt),
    founder_status: data.founderStatus ?? null,
    subscription_plan: sub?.plan ?? null,
    subscription_status: sub?.status ?? null,
    subscription_provider: sub?.provider ?? null,
    subscription_period_end: toIsoOrNull(sub?.periodEnd),
    consent_status: consent?.status ?? "unknown",
    consent_legal_basis: consent?.legalBasis ?? "none",
    consent_version: consent?.version ?? "",
    consented_at: toIsoOrNull(consent?.consentedAt),
    unsubscribe_status: unsub?.status ?? "subscribed",
    unsubscribed_at: toIsoOrNull(unsub?.unsubscribedAt),
    segments: Array.isArray(data.segments) ? data.segments : [],
    lifecycle_stage: data.lifecycleStage ?? "lead",
    created_at: toIsoOrNull(data.createdAt),
    updated_at: toIsoOrNull(data.updatedAt),
  };
}

/** BQ 스키마(테이블 생성용) — contactToBqRow 와 필드 정합 유지할 것. */
export const MARKETING_CONTACTS_BQ_SCHEMA = [
  { name: "snapshot_date", type: "DATE", mode: "REQUIRED" },
  { name: "contact_id", type: "STRING", mode: "REQUIRED" },
  { name: "uid", type: "STRING" },
  { name: "email_hash", type: "STRING", mode: "REQUIRED" },
  { name: "email_domain", type: "STRING" },
  { name: "source", type: "STRING" },
  { name: "locale", type: "STRING" },
  { name: "signup_at", type: "TIMESTAMP" },
  { name: "founder_status", type: "STRING" },
  { name: "subscription_plan", type: "STRING" },
  { name: "subscription_status", type: "STRING" },
  { name: "subscription_provider", type: "STRING" },
  { name: "subscription_period_end", type: "TIMESTAMP" },
  { name: "consent_status", type: "STRING" },
  { name: "consent_legal_basis", type: "STRING" },
  { name: "consent_version", type: "STRING" },
  { name: "consented_at", type: "TIMESTAMP" },
  { name: "unsubscribe_status", type: "STRING" },
  { name: "unsubscribed_at", type: "TIMESTAMP" },
  { name: "segments", type: "STRING", mode: "REPEATED" },
  { name: "lifecycle_stage", type: "STRING" },
  { name: "created_at", type: "TIMESTAMP" },
  { name: "updated_at", type: "TIMESTAMP" },
] as const;
