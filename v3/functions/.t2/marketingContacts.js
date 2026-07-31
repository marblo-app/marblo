"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MARKETING_CONTACTS_BQ_SCHEMA = exports.UNKNOWN_CONSENT = exports.PUSH_TOKENS_COLLECTION = exports.CONSENT_EVENTS_SUBCOLLECTION = exports.MARKETING_CONTACTS_COLLECTION = void 0;
exports.normalizeMarketingEmail = normalizeMarketingEmail;
exports.sha256Hex = sha256Hex;
exports.contactIdForEmail = contactIdForEmail;
exports.emailDomainOf = emailDomainOf;
exports.parseEncKey = parseEncKey;
exports.encryptEmail = encryptEmail;
exports.decryptEmail = decryptEmail;
exports.unsubscribeTokenForContact = unsubscribeTokenForContact;
exports.verifyUnsubscribeToken = verifyUnsubscribeToken;
exports.buildUnsubscribeUrl = buildUnsubscribeUrl;
exports.isEmailable = isEmailable;
exports.mergeEmailConsent = mergeEmailConsent;
exports.decideMarketingConsentSync = decideMarketingConsentSync;
exports.backfillConsentGrantFromUserDoc = backfillConsentGrantFromUserDoc;
exports.decideWaitlistConsentGrant = decideWaitlistConsentGrant;
exports.deriveLifecycleStage = deriveLifecycleStage;
exports.deriveSegments = deriveSegments;
exports.toIsoOrNull = toIsoOrNull;
exports.contactToBqRow = contactToBqRow;
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
const crypto_1 = require("crypto");
// ─── 컬렉션 경로(단일소스) ──────────────────────────────────────────
exports.MARKETING_CONTACTS_COLLECTION = "marketing_contacts";
exports.CONSENT_EVENTS_SUBCOLLECTION = "consent_events";
exports.PUSH_TOKENS_COLLECTION = "push_tokens";
// ─── 이메일 정규화·해시 ─────────────────────────────────────────────
function normalizeMarketingEmail(email) {
    return email.trim().toLowerCase();
}
function sha256Hex(input) {
    return (0, crypto_1.createHash)("sha256").update(input, "utf8").digest("hex");
}
/** contactId = sha256(normalizedEmail) — 이메일당 문서 1개가 docId 로 보장된다. */
function contactIdForEmail(email) {
    return sha256Hex(normalizeMarketingEmail(email));
}
function emailDomainOf(email) {
    const normalized = normalizeMarketingEmail(email);
    const at = normalized.lastIndexOf("@");
    return at > 0 ? normalized.slice(at + 1) : "";
}
// ─── 이메일 암호화 (AES-256-GCM) ────────────────────────────────────
// 포맷: "v1:<b64 iv>:<b64 authTag>:<b64 ciphertext>"
// 키: base64 인코딩된 32바이트 (env MARKETING_EMAIL_ENC_KEY — 값 출력 금지)
const EMAIL_ENC_VERSION = "v1";
function parseEncKey(keyBase64) {
    if (!keyBase64)
        return null;
    try {
        const key = Buffer.from(keyBase64, "base64");
        return key.length === 32 ? key : null;
    }
    catch {
        return null;
    }
}
function encryptEmail(email, keyBase64) {
    const key = parseEncKey(keyBase64);
    if (!key) {
        throw new Error("MARKETING_EMAIL_ENC_KEY must be base64-encoded 32 bytes (value not logged)");
    }
    const iv = (0, crypto_1.randomBytes)(12);
    const cipher = (0, crypto_1.createCipheriv)("aes-256-gcm", key, iv);
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
function decryptEmail(emailEnc, keyBase64) {
    const key = parseEncKey(keyBase64);
    if (!key) {
        throw new Error("MARKETING_EMAIL_ENC_KEY must be base64-encoded 32 bytes (value not logged)");
    }
    const parts = emailEnc.split(":");
    if (parts.length !== 4 || parts[0] !== EMAIL_ENC_VERSION) {
        throw new Error(`unsupported emailEnc format (expected ${EMAIL_ENC_VERSION})`);
    }
    const [, ivB64, tagB64, ctB64] = parts;
    const decipher = (0, crypto_1.createDecipheriv)("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
        decipher.update(Buffer.from(ctB64, "base64")),
        decipher.final(),
    ]).toString("utf8");
}
// ─── unsubscribe 토큰 (HMAC, stateless) ─────────────────────────────
// token = HMAC-SHA256(secret, "unsub:" + contactId) hex.
// 평문 토큰은 저장하지 않는다 — 링크 생성 시 파생, 검증 시 재계산.
function unsubscribeTokenForContact(contactId, secret) {
    if (!secret)
        throw new Error("MARKETING_UNSUB_SECRET is not configured");
    return (0, crypto_1.createHmac)("sha256", secret)
        .update(`unsub:${contactId}`, "utf8")
        .digest("hex");
}
function verifyUnsubscribeToken(contactId, token, secret) {
    if (!secret || !token || !contactId)
        return false;
    const expected = unsubscribeTokenForContact(contactId, secret);
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(token, "utf8");
    if (a.length !== b.length)
        return false;
    return (0, crypto_1.timingSafeEqual)(a, b);
}
function buildUnsubscribeUrl(functionsBaseUrl, contactId, secret) {
    const token = unsubscribeTokenForContact(contactId, secret);
    return `${functionsBaseUrl}/unsubscribeMarketingEmail?c=${encodeURIComponent(contactId)}&t=${encodeURIComponent(token)}`;
}
function isEmailable(contact) {
    if (!contact)
        return { ok: false, reason: "no_contact" };
    if (contact.unsubscribe?.status === "unsubscribed") {
        return { ok: false, reason: "unsubscribed" };
    }
    if (contact.emailMarketingConsent?.status !== "granted") {
        return { ok: false, reason: "consent_not_granted" };
    }
    return { ok: true, reason: "ok" };
}
exports.UNKNOWN_CONSENT = {
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
function mergeEmailConsent(base, request, now) {
    const current = base ?? exports.UNKNOWN_CONSENT;
    if (request.revoke &&
        (current.status === "granted" || current.status === "pending")) {
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
    if (request.grant &&
        !request.revoke &&
        (current.status === "unknown" || current.status === "pending")) {
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
function decideMarketingConsentSync(before, after) {
    const afterConsent = after?.webPrivacyConsent;
    if (!afterConsent)
        return { kind: "none", reason: "no_consent_record" };
    const beforeConsent = before?.webPrivacyConsent;
    const wasMarketing = beforeConsent?.marketing === true;
    const isMarketing = afterConsent.marketing === true;
    if (!isMarketing) {
        // 동의한 적 없는 사람은 건드리지 않는다 — granted 로 올리지도, revoke 하지도 않음.
        return wasMarketing
            ? { kind: "revoke", reason: "opted_out" }
            : { kind: "none", reason: "never_opted_in" };
    }
    const version = typeof afterConsent.version === "string" ? afterConsent.version : "";
    const beforeVersion = typeof beforeConsent?.version === "string" ? beforeConsent.version : "";
    // 이미 동의 상태 그대로이고 버전도 같으면 재적용 불필요(멱등).
    if (wasMarketing && version === beforeVersion) {
        return { kind: "none", reason: "unchanged" };
    }
    const locale = typeof afterConsent.locale === "string" ? afterConsent.locale : "ko";
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
function backfillConsentGrantFromUserDoc(userDoc) {
    const action = decideMarketingConsentSync(null, userDoc);
    if (action.kind !== "grant")
        return null;
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
/**
 * waitlist 신청 문서 하나를 보고 컨택트 consent 를 어떻게 다뤄야 하는지
 * 판정한다. 훅(syncMarketingContactOnWaitlistCreate)이 이 결과를
 * upsertMarketingContact 의 grantConsent/markPending 요청으로 그대로 옮긴다.
 *
 * 우선순위: marketingConsent=true 만 grant. 그 외 agreed=true 는 여전히
 * pending(재동의 대상 풀)까지만 — grant 근거가 아니다. 둘 다 없으면 none.
 */
function decideWaitlistConsentGrant(data) {
    if (data.marketingConsent === true) {
        return {
            kind: "grant",
            version: typeof data.marketingConsentVersion === "string"
                ? data.marketingConsentVersion
                : "",
            consentedAt: data.marketingConsentAt ?? null,
        };
    }
    if (data.agreed === true)
        return { kind: "pending" };
    return { kind: "none" };
}
function deriveLifecycleStage(f) {
    if (f.hasActivePaidSubscription)
        return "subscriber";
    if (f.isFounder && !f.founderRejected)
        return "founder";
    if (f.hasAuthAccount)
        return "signup";
    return "lead";
}
function deriveSegments(f) {
    const segments = [];
    if (f.hasWaitlist)
        segments.push("waitlist");
    if (f.hasAuthAccount)
        segments.push("auth_user");
    if (f.isFounder && !f.founderRejected)
        segments.push("founder");
    if (f.founderRejected)
        segments.push("founder_rejected");
    if (f.hasActivePaidSubscription)
        segments.push("paid");
    if (f.hasActiveFounderGrant)
        segments.push("beta_active");
    return segments;
}
// Firestore Timestamp | Date | number | null → ISO string | null
function toIsoOrNull(v) {
    if (v == null)
        return null;
    if (typeof v === "number")
        return new Date(v).toISOString();
    if (v instanceof Date)
        return v.toISOString();
    const ts = v;
    if (typeof ts.toMillis === "function") {
        return new Date(ts.toMillis()).toISOString();
    }
    if (typeof ts.seconds === "number") {
        return new Date(ts.seconds * 1000).toISOString();
    }
    return null;
}
function contactToBqRow(contactId, data, snapshotDate) {
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
exports.MARKETING_CONTACTS_BQ_SCHEMA = [
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
];
