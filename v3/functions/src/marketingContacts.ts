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
      "MARKETING_EMAIL_ENC_KEY must be base64-encoded 32 bytes (value not logged)"
    );
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const normalized = normalizeMarketingEmail(email);
  const ct = Buffer.concat([
    cipher.update(normalized, "utf8"),
    cipher.final(),
  ]);
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
      "MARKETING_EMAIL_ENC_KEY must be base64-encoded 32 bytes (value not logged)"
    );
  }
  const parts = emailEnc.split(":");
  if (parts.length !== 4 || parts[0] !== EMAIL_ENC_VERSION) {
    throw new Error(`unsupported emailEnc format (expected ${EMAIL_ENC_VERSION})`);
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivB64, "base64")
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
  secret: string
): string {
  if (!secret) throw new Error("MARKETING_UNSUB_SECRET is not configured");
  return createHmac("sha256", secret)
    .update(`unsub:${contactId}`, "utf8")
    .digest("hex");
}

export function verifyUnsubscribeToken(
  contactId: string,
  token: string,
  secret: string
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
  secret: string
): string {
  const token = unsubscribeTokenForContact(contactId, secret);
  return `${functionsBaseUrl}/unsubscribeMarketingEmail?c=${encodeURIComponent(
    contactId
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
  > | null
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
  snapshotDate: string
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
