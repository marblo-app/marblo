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

// ─── 광고 제3자 제공 동의 범위 ─────────────────────────────────────────
/**
 * ★동의 문안이 "구글 광고 제3자 제공"까지 담고 있는 버전 목록.
 *
 * 왜 목록인가 — 날짜 문자열 크기 비교(`version >= "2026-09-08"`)를 쓰지
 * 않는다. 그 비교는 빈 문자열·미지 값·오타가 **true 쪽으로 새는** 방향을
 * 만든다. 허용목록은 모르는 값이 전부 false 로 떨어진다(fail-closed).
 * 동의 안 한 사람이 구글로 나가는 사고는 정확히 이 지점에서 난다.
 *
 * ★기존 동의자는 마이그레이션하지 않는다. 그들의 version 은 ""(빈 값) 또는
 *   "2026-07-14"/"2026-07-31"(구 문구)이고, 어느 것도 이 목록에 없으므로
 *   자동으로 "예전 문구"가 된다 — 그게 안전한 기본값이다.
 *
 * 문안을 또 개정하면 **여기에 새 버전을 추가**한다. 기존 항목은 지우지
 * 않는다(지우면 이미 받은 유효한 동의가 소급해서 무효가 된다).
 */
export const ADS_PROVISION_CONSENT_VERSIONS: readonly string[] = [
  // docs/marketing-hashed-email-ads-targeting-2026-09-07.md §8-2 (나)안
  "2026-09-08-ads",
];

/**
 * 이 동의가 **해시 이메일의 Google Ads 제공**까지 포함하는가.
 *
 * ★두 조건을 모두 요구한다. 하나라도 빠지면 false:
 *   1. `status === "granted"` — pending/revoked/unknown 은 애초에 발송·제공 불가
 *   2. `version` 이 허용목록에 있다 — 즉 그 사람이 **구글 제공 문구를 읽고**
 *      체크했다는 뜻
 *
 * ★`legalBasis` 도 `explicit_opt_in` 이어야 한다. 백필로 들어온 컨택트가
 *   우연히 새 버전 문자열을 갖게 되더라도 근거 없는 동의를 제공에 쓰지 않는다.
 */
export function consentCoversAdsProvision(
  consent: Pick<EmailMarketingConsent, "status" | "version" | "legalBasis">
    | null
    | undefined,
): boolean {
  if (!consent) return false;
  if (consent.status !== "granted") return false;
  if (consent.legalBasis !== "explicit_opt_in") return false;
  return ADS_PROVISION_CONSENT_VERSIONS.includes(consent.version);
}

/**
 * 광고 리스트 업로드 대상인가 — `consentCoversAdsProvision` 에 수신거부를
 * 한 겹 더 얹는다. 업로드 파이프라인이 생기면 이 함수 하나만 부르면 되도록
 * 판정을 한자리에 모은다(§6-3).
 */
export function isAdsAudienceEligible(
  contact: Pick<MarketingContactDoc, "emailMarketingConsent" | "unsubscribe">
    | null
    | undefined,
): boolean {
  if (!contact) return false;
  if (contact.unsubscribe?.status === "unsubscribed") return false;
  return consentCoversAdsProvision(contact.emailMarketingConsent);
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
  /** 정책 봉투 버전(필수동의 게이트용). 마케팅 문안 버전이 **아니다**. */
  version?: unknown;
  /**
   * ★마케팅 **문안** 버전. 없으면 구 문구다 — 구글 광고 제공 고지를 본 적 없다.
   *   웹의 `marblo-web/src/lib/privacyConsent.ts` `MARKETING_CONSENT_VERSION`
   *   과 같은 문자열이며, 이 값이 `ADS_PROVISION_CONSENT_VERSIONS` 허용목록과
   *   대조된다.
   */
  marketingVersion?: unknown;
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

  // ★컨택트의 consent.version 에는 **마케팅 문안 버전**을 싣는다. 정책 봉투
  //   버전(`version`)이 아니다 — 그걸 실으면 정책 개정만 해도 광고 제공 동의를
  //   새로 받은 것처럼 보인다. 없으면 ""(구 문구)로 떨어진다.
  const version =
    typeof afterConsent.marketingVersion === "string"
      ? afterConsent.marketingVersion
      : "";
  const beforeVersion =
    typeof beforeConsent?.marketingVersion === "string"
      ? beforeConsent.marketingVersion
      : "";
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

export interface MarketingConsentStatusResponse
  extends MarketingConsentStatusView {
  shouldPromptReconsent: boolean;
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

export function marketingConsentStatusResponse(
  contact: Partial<MarketingContactDoc> | null | undefined,
): MarketingConsentStatusResponse {
  const view = marketingConsentStatusView(contact);
  return { ...view, shouldPromptReconsent: shouldPromptReconsent(view) };
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

/**
 * BQ 스키마(테이블 생성용) — contactToBqRow 와 필드 정합 유지할 것.
 *
 * ★`ads_provision_consent` 컬럼은 **일부러 넣지 않았다**(티켓 Bz4qVDSRY4QQ7XmONZK4).
 *   이 스키마는 `table.exists()` 가 false 일 때만 쓰이므로, 이미 만들어진
 *   운영 테이블에는 적용되지 않는다. 여기에 컬럼을 더하면 행에도 더해야 하고
 *   그러면 **야간 미러(04:45 KST)가 "no such field" 로 깨진다.**
 *   광고 업로드 파이프라인(§6-3)을 실제로 구현할 때, 운영 테이블에
 *   `ALTER TABLE ... ADD COLUMN ads_provision_consent BOOL` 을 **먼저** 돌린 뒤
 *   이 배열과 `contactToBqRow` 에 같이 넣어라.
 *   그때까지 판정은 `consentCoversAdsProvision()` / `isAdsAudienceEligible()`
 *   로만 한다 — SQL 에 판정을 복제하지 마라.
 */
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

// ═══════════════════════════════════════════════════════════════════════════
// 구글 Customer Match 제거 대기열 (티켓 7THv6vmkSxUSMkKM5Ybe)
// ═══════════════════════════════════════════════════════════════════════════
//
// #1521(docs/marketing-hashed-email-ads-targeting-2026-09-07.md §8-6)이 읽기로
// 확인한 갭: 동의를 철회해도 구글 Customer Match 는 우리가 **명시적으로 제거
// 요청을 보내야** 리스트에서 빠진다. 지금은 그 요청을 만드는 코드조차 없다.
//
// ★이 티켓은 "보낸다"를 만들지 않는다. "잃어버리지 않는 대기열"만 만든다.
// 실제 구글 전송은 법무 검토 + 문구 배포 뒤 별도 승인으로 연결한다
// (#1518~#1521, 특히 #1520 §6-3의 업로드 파이프라인 설계와 이어질 자리).
//
// ── 왜 단일 진입점(marketing_contacts 의 onWrite)인가 ────────────────────────
// 철회 경로는 여럿이다 — 수신거부 링크(unsubscribeMarketingEmail, 직접 write),
// 설정 화면 토글(syncMarketingConsentOnUserWrite → upsertMarketingContact →
// mergeEmailConsent), 관리자 수동(콘솔에서 문서를 직접 고침), 앞으로 생길 다른
// 경로까지. 이 전부가 결국 **같은 문서**(`marketing_contacts/{contactId}`)를
// 쓴다. 그래서 각 호출부를 하나씩 계측하는 대신, 그 문서의 `onWrite` 하나에서
// "revoked/unsubscribed 로 넘어갔는가"만 판정한다 — 새 철회 경로가 생겨도
// 이 문서를 거치는 한 자동으로 커버된다(spawnNewAgent 의 크레덴셜 게이트,
// auditedTool 의 단일 초크포인트와 같은 설계 원칙).
//
// ── 계정 삭제는 왜 별도 경로가 필요한가 ──────────────────────────────────────
// `marketing_contacts` 는 uid 가 아니라 **이메일 해시**로 키가 잡힌다. 계정을
// 지워도(Firebase Auth 사용자 삭제) 이 컬렉션에는 아무 write 도 일어나지
// 않는다 — 그래서 위 onWrite 트리거가 계정 삭제를 잡을 수 없다. 별도로 Auth
// `onDelete` 를 걸고, 삭제되는 순간의 `UserRecord.email` 로 직접 대기열에
// 적는다 — `marketing_contacts` 문서가 그 시점에 있는지 없는지와 **무관하게**
// (문서가 나중에 삭제 요청으로 완전히 지워져도 대기열 항목은 독립된 컬렉션이라
// 살아남는다).
//
// ── marketing_contacts 문서를 "지우면"(수정이 아니라 삭제) 안 잡는다 — 의도적 ──
// `decideGoogleRemovalQueue` 는 `after === null` 이면 무조건 `{queue:false}` 다.
// `onWrite` 는 delete 에도 fire 하므로(그때 `change.after.exists === false`),
// 관리자가 콘솔에서 문서를 **삭제**하면 이 훅은 아무것도 큐에 올리지 않는다.
// 반면 관리자가 필드를 **수정**해서 revoked/unsubscribed 로 넘기면 같은 훅이
// 정상적으로 잡는다 — 그래서 "관리자 수동" 경로는 수정은 커버되고 삭제는
// 안 된다. 문서 삭제는 철회 의사 표시가 아니라 데이터 정리이고, 진짜 "계정을
// 지운다"는 의사는 Auth `onDelete`(바로 위)가 따로 잡으므로 이 둘을 합치지
// 않는다. (2026-09-08 기준 `marketing_contacts` 문서를 삭제하는 운영 코드
// 경로는 없다 — `grep -rn "MARKETING_CONTACTS_COLLECTION" ... | xargs grep -n
// "\.delete("` 로 확인, exit 1 = 정상 실행·매치 없음. 나중에 그런 경로가
// 생기면 삭제 직전에 이 큐에 명시적으로 올리거나, soft-delete 로 바꿔 이
// onWrite 가 잡게 해야 한다 — 안 그러면 철회 이력 없이 사람이 사라진다.)
// ───────────────────────────────────────────────────────────────────────────

// ★★Stage 2(업로드 파이프라인, 8t3OTHt9lyIFmfDQJjWJ)에 대한 불변식 ─────────
// 이 큐는 "빼야 할 후보" 목록이지 "구글에 보낼 목록"이 아니다. Auth onDelete
// 훅은 마케팅 동의를 준 적 없어 구글에 한 번도 올라간 적 없는 사람도, 동의했다가
// 업로드 전에 철회해 역시 올라간 적 없는 사람도 그대로 큐에 올린다(무해함 —
// 컨택트 문서를 안 읽기로 한 설계상 당연한 부작용). Stage 2 가 이 큐를 그대로
// 비우면 "한 번도 올린 적 없는 사람의 해시 이메일"을 제거 요청이라는 이름으로
// 구글에 보내게 되는데, 그것도 결국 해시를 지목한 전송이다 — 이 미션이 막으려던
// 사고와 같은 모양이다. **우리가 실제로 올린 식별자 집합(업로드 원장)과
// 교집합을 낸 뒤에만 제거를 보내야 한다.**
// ───────────────────────────────────────────────────────────────────────────
export const GOOGLE_REMOVAL_QUEUE_COLLECTION = "marketing_google_removal_queue";

/**
 * 대기열에 오른 사유. 셋 다 "구글에 이미 올라가 있었을 수 있으니 빼야 한다"는
 * 같은 결론으로 이어지지만, 감사·디버깅을 위해 원인을 구분해 남긴다.
 */
export type GoogleRemovalReason =
  | "unsubscribed"
  | "consent_revoked"
  | "account_deleted";

/** marketing_google_removal_queue/{contactId} 문서 형태. */
export interface GoogleRemovalQueueEntry {
  contactId: string;
  reason: GoogleRemovalReason;
  /** 무엇이 이 항목을 만들었나 — 감사용. 값(이메일·해시)은 아니다. */
  source: string;
  queuedAt: unknown; // Firestore Timestamp | Date
  /**
   * 다음 구글 동기화가 실제로 처리하면 채운다. ★이 티켓은 이 필드를 채우는
   * 코드를 만들지 않는다 — 전송 자체가 미연결이므로 항상 null로 시작한다.
   *
   * ★★재철회는 null 로 되돌아간다(의도) — `decideGoogleRemovalQueue` 는
   * edge-triggered 라 "새로운 철회 사건"일 때만 큐에 다시 쓴다(무관한 필드
   * 갱신이나 이미 철회 상태인 문서의 재확인은 걸러진다). 그래서 이 문서가
   * 다시 쓰인다는 것 자체가 "그사이 재동의해서 큐를 처리한 뒤 다시 철회했다"는
   * 뜻이고, 그 사람이 처리 이후 재업로드됐을 수 있으므로 resolvedAt 을 null 로
   * 리셋해 미처리로 되돌리는 게 맞다 — 처리된 사실을 지우는 버그가 아니다.
   * Stage 2 는 `resolvedAt === null` 인 항목만 처리 대상으로 본다(단조 증가를
   * 가정하지 않는다).
   */
  resolvedAt: unknown | null;
}

/** 컨택트 문서에서 대기열 판정에 필요한 필드만. */
export type MarketingContactConsentSnapshot = Pick<
  MarketingContactDoc,
  "emailMarketingConsent" | "unsubscribe"
> | null;

export interface GoogleRemovalQueueDecision {
  queue: boolean;
  reason?: GoogleRemovalReason;
}

/**
 * `marketing_contacts/{contactId}` 의 before/after 를 보고 구글 제거 대기열에
 * 올려야 하는지 판정한다. 순수 — Firestore 를 안 만진다.
 *
 * ★edge-triggered: **이미** revoked/unsubscribed 였던 문서가 무관한 필드
 * 갱신으로 다시 write 돼도 큐에 다시 안 올린다(예: emailEnc 최초 생성,
 * segments 갱신). "새로 철회된 사건"만 큐에 올린다.
 *
 * 판정 우선순위: unsubscribe 전이가 consent 전이보다 먼저 온다 — 수신거부
 * 링크는 두 필드를 한 write 로 같이 바꾸는데(§ isEmailable 참고), 사유 하나만
 * 필요하므로 더 구체적인 쪽(unsubscribed)을 남긴다.
 */
export function decideGoogleRemovalQueue(
  before: MarketingContactConsentSnapshot,
  after: MarketingContactConsentSnapshot,
): GoogleRemovalQueueDecision {
  if (!after) return { queue: false };

  const beforeUnsub = before?.unsubscribe?.status ?? "subscribed";
  const afterUnsub = after.unsubscribe?.status ?? "subscribed";
  if (afterUnsub === "unsubscribed" && beforeUnsub !== "unsubscribed") {
    return { queue: true, reason: "unsubscribed" };
  }

  const beforeConsent = before?.emailMarketingConsent?.status ?? "unknown";
  const afterConsent = after.emailMarketingConsent?.status ?? "unknown";
  if (afterConsent === "revoked" && beforeConsent !== "revoked") {
    return { queue: true, reason: "consent_revoked" };
  }

  return { queue: false };
}

/** 대기열 문서 하나를 조립한다. 순수 — `now` 는 주입받는다(운영: serverTimestamp). */
export function buildGoogleRemovalQueueEntry(
  contactId: string,
  reason: GoogleRemovalReason,
  source: string,
  now: unknown,
): GoogleRemovalQueueEntry {
  return { contactId, reason, source, queuedAt: now, resolvedAt: null };
}

/**
 * 계정 삭제 전용 조립기. `marketing_contacts` 문서를 **한 번도 읽지 않고**
 * 삭제되는 Auth 사용자의 이메일만으로 대기열 항목을 만든다 — 그 문서가
 * 이미 지워졌거나, 애초에 생긴 적이 없어도(마케팅 동의를 준 적 없는 사용자)
 * 이 함수는 값을 만든다. 호출부가 "컨택트가 있어야 큐에 올린다" 는 조건을
 * 걸면 계정 삭제로 문서가 사라지는 바로 그 순간 큐 항목도 같이 못 만드는
 * 사고가 난다 — 그게 이 티켓이 막으려는 것이다.
 */
export function googleRemovalQueueEntryForDeletedAccount(
  email: string,
  now: unknown,
): GoogleRemovalQueueEntry {
  const contactId = contactIdForEmail(email);
  return buildGoogleRemovalQueueEntry(
    contactId,
    "account_deleted",
    "system:auth_onDelete",
    now,
  );
}
