"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// marketingContacts 순수 로직 단위테스트 (redact.test.ts 와 동일 규약).
// 컴파일 후 `node --test` 로 실행:
//   tsc src/marketingContacts.ts src/marketingContacts.test.ts --outDir /tmp/out \
//       --module commonjs --target es2020 --esModuleInterop \
//   && node --test /tmp/out/marketingContacts.test.js
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const marketingContacts_1 = require("./marketingContacts");
const KEY = Buffer.alloc(32, 7).toString("base64"); // 테스트 전용 고정 키
const SECRET = "test-unsub-secret";
(0, node_test_1.test)("contactIdForEmail: 정규화(trim+lowercase) 후 sha256 — 같은 이메일 = 같은 id", () => {
    const a = (0, marketingContacts_1.contactIdForEmail)("  John.Kim@Example.COM ");
    const b = (0, marketingContacts_1.contactIdForEmail)("john.kim@example.com");
    strict_1.default.equal(a, b);
    strict_1.default.match(a, /^[0-9a-f]{64}$/);
});
(0, node_test_1.test)("emailDomainOf: 도메인만 추출(평문 local part 비노출)", () => {
    strict_1.default.equal((0, marketingContacts_1.emailDomainOf)("A@Gmail.com"), "gmail.com");
    strict_1.default.equal((0, marketingContacts_1.emailDomainOf)("invalid"), "");
});
(0, node_test_1.test)("encryptEmail/decryptEmail: 라운드트립 + iv 난수화", () => {
    const enc1 = (0, marketingContacts_1.encryptEmail)("USER@Example.com", KEY);
    const enc2 = (0, marketingContacts_1.encryptEmail)("USER@Example.com", KEY);
    strict_1.default.notEqual(enc1, enc2); // iv 가 달라 암호문도 달라야 함
    strict_1.default.equal((0, marketingContacts_1.decryptEmail)(enc1, KEY), "user@example.com");
    strict_1.default.equal((0, marketingContacts_1.decryptEmail)(enc2, KEY), "user@example.com");
    strict_1.default.ok(enc1.startsWith("v1:"));
    strict_1.default.ok(!enc1.includes("user@example.com"));
});
(0, node_test_1.test)("decryptEmail: 다른 키/변조 암호문은 실패", () => {
    const otherKey = Buffer.alloc(32, 9).toString("base64");
    const enc = (0, marketingContacts_1.encryptEmail)("user@example.com", KEY);
    strict_1.default.throws(() => (0, marketingContacts_1.decryptEmail)(enc, otherKey));
    const tampered = enc.slice(0, -4) + "AAAA";
    strict_1.default.throws(() => (0, marketingContacts_1.decryptEmail)(tampered, KEY));
});
(0, node_test_1.test)("parseEncKey: 32바이트 base64 만 유효", () => {
    strict_1.default.ok((0, marketingContacts_1.parseEncKey)(KEY));
    strict_1.default.equal((0, marketingContacts_1.parseEncKey)(""), null);
    strict_1.default.equal((0, marketingContacts_1.parseEncKey)("short"), null);
    strict_1.default.equal((0, marketingContacts_1.parseEncKey)(Buffer.alloc(16).toString("base64")), null);
});
(0, node_test_1.test)("unsubscribe 토큰: 파생·검증 stateless, 위조 거부", () => {
    const cid = (0, marketingContacts_1.contactIdForEmail)("user@example.com");
    const token = (0, marketingContacts_1.unsubscribeTokenForContact)(cid, SECRET);
    strict_1.default.match(token, /^[0-9a-f]{64}$/);
    strict_1.default.ok((0, marketingContacts_1.verifyUnsubscribeToken)(cid, token, SECRET));
    strict_1.default.ok(!(0, marketingContacts_1.verifyUnsubscribeToken)(cid, token.slice(0, -1) + "0", SECRET));
    strict_1.default.ok(!(0, marketingContacts_1.verifyUnsubscribeToken)(cid, token, "other-secret"));
    strict_1.default.ok(!(0, marketingContacts_1.verifyUnsubscribeToken)(cid, "", SECRET));
    strict_1.default.ok(!(0, marketingContacts_1.verifyUnsubscribeToken)(cid, token, ""));
    // 다른 컨택트의 토큰은 통하지 않는다
    const otherToken = (0, marketingContacts_1.unsubscribeTokenForContact)((0, marketingContacts_1.contactIdForEmail)("other@example.com"), SECRET);
    strict_1.default.ok(!(0, marketingContacts_1.verifyUnsubscribeToken)(cid, otherToken, SECRET));
});
(0, node_test_1.test)("buildUnsubscribeUrl: contactId + 토큰 포함", () => {
    const cid = (0, marketingContacts_1.contactIdForEmail)("user@example.com");
    const url = (0, marketingContacts_1.buildUnsubscribeUrl)("https://fn.example.com", cid, SECRET);
    strict_1.default.ok(url.includes(`c=${cid}`));
    strict_1.default.ok(url.includes("t="));
    strict_1.default.ok(url.startsWith("https://fn.example.com/unsubscribeMarketingEmail"));
});
const consentOf = (status) => ({
    status,
    source: "s",
    version: "v1",
    consentedAt: null,
    revokedAt: null,
    legalBasis: "explicit_opt_in",
});
const subscribed = {
    status: "subscribed",
    tokenHash: null,
    unsubscribedAt: null,
};
const unsubscribed = {
    status: "unsubscribed",
    tokenHash: "h",
    unsubscribedAt: null,
};
(0, node_test_1.test)("isEmailable: consent granted + not unsubscribed 만 발송 가능", () => {
    strict_1.default.equal((0, marketingContacts_1.isEmailable)(null).reason, "no_contact");
    strict_1.default.equal((0, marketingContacts_1.isEmailable)({
        emailMarketingConsent: consentOf("unknown"),
        unsubscribe: subscribed,
        emailEnc: "e",
    }).reason, "consent_not_granted");
    strict_1.default.equal((0, marketingContacts_1.isEmailable)({
        emailMarketingConsent: consentOf("revoked"),
        unsubscribe: subscribed,
        emailEnc: "e",
    }).reason, "consent_not_granted");
    // ★pending(waitlist 재동의 대상 풀)은 발송 불가 — COMPLIANCE-AUDIT D2 정정 반영
    strict_1.default.equal((0, marketingContacts_1.isEmailable)({
        emailMarketingConsent: consentOf("pending"),
        unsubscribe: subscribed,
        emailEnc: "e",
    }).reason, "consent_not_granted");
    strict_1.default.equal((0, marketingContacts_1.isEmailable)({
        emailMarketingConsent: consentOf("granted"),
        unsubscribe: unsubscribed,
        emailEnc: "e",
    }).reason, "unsubscribed");
    strict_1.default.equal((0, marketingContacts_1.isEmailable)({
        emailMarketingConsent: consentOf("granted"),
        unsubscribe: subscribed,
        emailEnc: "e",
    }).ok, true);
});
(0, node_test_1.test)("lifecycle/segments 파생", () => {
    const base = {
        hasWaitlist: true,
        hasAuthAccount: false,
        isFounder: false,
        founderRejected: false,
        hasActivePaidSubscription: false,
        hasActiveFounderGrant: false,
    };
    strict_1.default.equal((0, marketingContacts_1.deriveLifecycleStage)(base), "lead");
    strict_1.default.equal((0, marketingContacts_1.deriveLifecycleStage)({ ...base, hasAuthAccount: true }), "signup");
    strict_1.default.equal((0, marketingContacts_1.deriveLifecycleStage)({ ...base, isFounder: true }), "founder");
    strict_1.default.equal((0, marketingContacts_1.deriveLifecycleStage)({
        ...base,
        isFounder: true,
        hasActivePaidSubscription: true,
    }), "subscriber");
    strict_1.default.deepEqual((0, marketingContacts_1.deriveSegments)({
        ...base,
        hasAuthAccount: true,
        isFounder: true,
        hasActiveFounderGrant: true,
    }), ["waitlist", "auth_user", "founder", "beta_active"]);
    strict_1.default.deepEqual((0, marketingContacts_1.deriveSegments)({ ...base, founderRejected: true }), [
        "waitlist",
        "founder_rejected",
    ]);
});
(0, node_test_1.test)("contactToBqRow: 평문 이메일·emailEnc 를 구조적으로 배제", () => {
    const email = "secret.user@example.com";
    const cid = (0, marketingContacts_1.contactIdForEmail)(email);
    const row = (0, marketingContacts_1.contactToBqRow)(cid, {
        uid: "u1",
        normalizedEmailHash: cid,
        emailEnc: (0, marketingContacts_1.encryptEmail)(email, KEY),
        emailDomain: "example.com",
        source: "waitlist",
        locale: "ko",
        signupAt: new Date("2026-01-02T03:04:05Z"),
        founderStatus: "selected",
        subscription: {
            plan: "pro",
            status: "active",
            provider: "toss",
            periodEnd: null,
        },
        emailMarketingConsent: consentOf("granted"),
        unsubscribe: subscribed,
        segments: ["waitlist", "founder"],
        lifecycleStage: "founder",
    }, "2026-07-18");
    const json = JSON.stringify(row);
    strict_1.default.ok(!json.includes("secret.user")); // 평문 local part 없음
    strict_1.default.ok(!json.includes("v1:")); // 암호문(emailEnc)도 미러하지 않음
    strict_1.default.equal(row.email_hash, cid);
    strict_1.default.equal(row.signup_at, "2026-01-02T03:04:05.000Z");
    strict_1.default.equal(row.snapshot_date, "2026-07-18");
    strict_1.default.equal(row.consent_status, "granted");
    strict_1.default.deepEqual(row.segments, ["waitlist", "founder"]);
});
(0, node_test_1.test)("toIsoOrNull: Timestamp 유사체·Date·number·null 처리", () => {
    strict_1.default.equal((0, marketingContacts_1.toIsoOrNull)(null), null);
    strict_1.default.equal((0, marketingContacts_1.toIsoOrNull)(undefined), null);
    strict_1.default.equal((0, marketingContacts_1.toIsoOrNull)(0), "1970-01-01T00:00:00.000Z");
    strict_1.default.equal((0, marketingContacts_1.toIsoOrNull)({ toMillis: () => 1000 }), "1970-01-01T00:00:01.000Z");
    strict_1.default.equal((0, marketingContacts_1.toIsoOrNull)({ seconds: 2 }), "1970-01-01T00:00:02.000Z");
});
// ─── mergeEmailConsent (동의 병합 단일 판정) ──────────────────────────
const NOW = new Date("2026-07-20T00:00:00Z");
const GRANT = {
    source: "web_privacy_consent",
    version: "2026-07-14",
    legalBasis: "explicit_opt_in",
    consentedAt: null,
};
const PENDING = { source: "waitlist_form", detail: "activity agreement only" };
const REVOKE = { source: "web_privacy_consent", detail: "unchecked" };
const withStatus = (status) => ({
    status,
    source: "prev",
    version: "2026-01-01",
    consentedAt: status === "granted" ? NOW : null,
    revokedAt: null,
    legalBasis: status === "granted" ? "explicit_opt_in" : "none",
});
(0, node_test_1.test)("mergeEmailConsent grant: unknown/pending 만 granted 로 승격", () => {
    const fromUnknown = (0, marketingContacts_1.mergeEmailConsent)(marketingContacts_1.UNKNOWN_CONSENT, { grant: GRANT }, NOW);
    strict_1.default.equal(fromUnknown.consent.status, "granted");
    strict_1.default.equal(fromUnknown.consent.legalBasis, "explicit_opt_in");
    strict_1.default.equal(fromUnknown.event?.type, "granted");
    const fromPending = (0, marketingContacts_1.mergeEmailConsent)(withStatus("pending"), { grant: GRANT }, NOW);
    strict_1.default.equal(fromPending.consent.status, "granted");
    strict_1.default.equal(fromPending.event?.type, "granted");
    // 이미 granted → 변화 없음 + 이벤트 없음(멱등, 중복 감사기록 방지)
    const already = (0, marketingContacts_1.mergeEmailConsent)(withStatus("granted"), { grant: GRANT }, NOW);
    strict_1.default.equal(already.consent.status, "granted");
    strict_1.default.equal(already.event, null);
    strict_1.default.equal(already.consent.source, "prev"); // 기존 동의 증빙 보존
});
(0, node_test_1.test)("★mergeEmailConsent: revoked 는 grant 로 절대 되살아나지 않는다", () => {
    const r = (0, marketingContacts_1.mergeEmailConsent)(withStatus("revoked"), { grant: GRANT }, NOW);
    strict_1.default.equal(r.consent.status, "revoked");
    strict_1.default.equal(r.event, null);
});
(0, node_test_1.test)("mergeEmailConsent revoke: granted/pending → revoked, revokedAt 기록", () => {
    const fromGranted = (0, marketingContacts_1.mergeEmailConsent)(withStatus("granted"), { revoke: REVOKE }, NOW);
    strict_1.default.equal(fromGranted.consent.status, "revoked");
    strict_1.default.equal(fromGranted.consent.revokedAt, NOW);
    strict_1.default.equal(fromGranted.consent.consentedAt, NOW); // 동의 시점은 감사용으로 보존
    strict_1.default.equal(fromGranted.event?.type, "revoked");
    const fromPending = (0, marketingContacts_1.mergeEmailConsent)(withStatus("pending"), { revoke: REVOKE }, NOW);
    strict_1.default.equal(fromPending.consent.status, "revoked");
    // unknown 은 철회할 것이 없다 — noop
    const fromUnknown = (0, marketingContacts_1.mergeEmailConsent)(marketingContacts_1.UNKNOWN_CONSENT, { revoke: REVOKE }, NOW);
    strict_1.default.equal(fromUnknown.consent.status, "unknown");
    strict_1.default.equal(fromUnknown.event, null);
});
(0, node_test_1.test)("★mergeEmailConsent: 철회가 동의를 이긴다(같은 요청에 둘 다 와도 revoke)", () => {
    const r = (0, marketingContacts_1.mergeEmailConsent)(withStatus("granted"), { grant: GRANT, revoke: REVOKE }, NOW);
    strict_1.default.equal(r.consent.status, "revoked");
    strict_1.default.equal(r.event?.type, "revoked");
});
(0, node_test_1.test)("mergeEmailConsent pending: unknown 만 편입, granted 를 강등하지 않음", () => {
    strict_1.default.equal((0, marketingContacts_1.mergeEmailConsent)(marketingContacts_1.UNKNOWN_CONSENT, { pending: PENDING }, NOW).consent
        .status, "pending");
    strict_1.default.equal((0, marketingContacts_1.mergeEmailConsent)(withStatus("granted"), { pending: PENDING }, NOW).consent
        .status, "granted");
    strict_1.default.equal((0, marketingContacts_1.mergeEmailConsent)(withStatus("revoked"), { pending: PENDING }, NOW).consent
        .status, "revoked");
});
(0, node_test_1.test)("mergeEmailConsent: 요청이 없으면 현재 상태 그대로(base 없으면 unknown)", () => {
    strict_1.default.equal((0, marketingContacts_1.mergeEmailConsent)(null, {}, NOW).consent.status, "unknown");
    strict_1.default.equal((0, marketingContacts_1.mergeEmailConsent)(undefined, {}, NOW).event, null);
    strict_1.default.equal((0, marketingContacts_1.mergeEmailConsent)(withStatus("granted"), {}, NOW).consent.status, "granted");
});
// ─── decideMarketingConsentSync (users/{uid} write → 무엇을 할 것인가) ─
const userDoc = (marketing, version = "2026-07-14") => ({
    webPrivacyConsent: {
        collectionUse: true,
        overseasTransfer: true,
        marketing,
        version,
        locale: "ko",
        acceptedAt: NOW,
    },
});
(0, node_test_1.test)("decideMarketingConsentSync: 마케팅 체크 → grant(버전·로케일·동의시각 전달)", () => {
    const a = (0, marketingContacts_1.decideMarketingConsentSync)(null, userDoc(true));
    strict_1.default.equal(a.kind, "grant");
    if (a.kind === "grant") {
        strict_1.default.equal(a.version, "2026-07-14");
        strict_1.default.equal(a.locale, "ko");
        strict_1.default.equal(a.consentedAt, NOW);
    }
});
(0, node_test_1.test)("★decideMarketingConsentSync: 미체크는 건드리지 않는다(승격도 철회도 없음)", () => {
    // 가입 시 마케팅 미체크 — granted 인 적이 없으므로 revoke 대상이 아니다
    const a = (0, marketingContacts_1.decideMarketingConsentSync)(null, userDoc(false));
    strict_1.default.equal(a.kind, "none");
    if (a.kind === "none")
        strict_1.default.equal(a.reason, "never_opted_in");
    // 계속 미체크로 다른 필드만 갱신 — 여전히 none
    const b = (0, marketingContacts_1.decideMarketingConsentSync)(userDoc(false), userDoc(false));
    strict_1.default.equal(b.kind, "none");
});
(0, node_test_1.test)("decideMarketingConsentSync: true→false 전이만 revoke", () => {
    const a = (0, marketingContacts_1.decideMarketingConsentSync)(userDoc(true), userDoc(false));
    strict_1.default.equal(a.kind, "revoke");
});
(0, node_test_1.test)("decideMarketingConsentSync: consent 레코드 없으면 no_consent_record", () => {
    const a = (0, marketingContacts_1.decideMarketingConsentSync)(null, { someOtherField: 1 });
    strict_1.default.equal(a.kind, "none");
    if (a.kind === "none")
        strict_1.default.equal(a.reason, "no_consent_record");
    // ★앱의 privacyConsent(텔레메트리 스키마)는 마케팅 동의 소스가 아니다
    const b = (0, marketingContacts_1.decideMarketingConsentSync)(null, {
        privacyConsent: { firstPartyTelemetry: true, marketing: true },
    });
    strict_1.default.equal(b.kind, "none");
    if (b.kind === "none")
        strict_1.default.equal(b.reason, "no_consent_record");
});
(0, node_test_1.test)("decideMarketingConsentSync: 멱등 — 동의 유지 상태의 무관한 write 는 unchanged", () => {
    const a = (0, marketingContacts_1.decideMarketingConsentSync)(userDoc(true), userDoc(true));
    strict_1.default.equal(a.kind, "none");
    if (a.kind === "none")
        strict_1.default.equal(a.reason, "unchanged");
    // 단 정책 버전이 오르면(재동의) 다시 grant 를 흘려보낸다
    const b = (0, marketingContacts_1.decideMarketingConsentSync)(userDoc(true), userDoc(true, "2027-01-01"));
    strict_1.default.equal(b.kind, "grant");
});
(0, node_test_1.test)("★순서 무관: saveConsent 가 auth onCreate 보다 나중이어도 granted 로 수렴", () => {
    // 순서 A — auth onCreate 먼저(동의 정보 없이 컨택트 생성) → saveConsent 나중
    let consentA = (0, marketingContacts_1.mergeEmailConsent)(null, {}, NOW).consent; // onCreate: grant 요청 없음
    strict_1.default.equal(consentA.status, "unknown");
    const actionA = (0, marketingContacts_1.decideMarketingConsentSync)(null, userDoc(true));
    strict_1.default.equal(actionA.kind, "grant");
    consentA = (0, marketingContacts_1.mergeEmailConsent)(consentA, { grant: GRANT }, NOW).consent;
    strict_1.default.equal(consentA.status, "granted");
    // 순서 B — saveConsent 먼저(컨택트를 granted 로 생성) → auth onCreate 나중
    let consentB = (0, marketingContacts_1.mergeEmailConsent)(null, { grant: GRANT }, NOW).consent;
    strict_1.default.equal(consentB.status, "granted");
    consentB = (0, marketingContacts_1.mergeEmailConsent)(consentB, {}, NOW).consent; // 뒤늦은 onCreate
    strict_1.default.equal(consentB.status, "granted");
    // 두 순서의 최종 상태가 같고, 둘 다 발송 가능
    strict_1.default.equal(consentA.status, consentB.status);
    for (const c of [consentA, consentB]) {
        strict_1.default.equal((0, marketingContacts_1.isEmailable)({
            emailMarketingConsent: c,
            unsubscribe: subscribed,
            emailEnc: "e",
        }).ok, true);
    }
});
// ─── backfillConsentGrantFromUserDoc (백필의 동의 매핑) ───────────────
// 회귀 방지: 백필이 users/{uid}.webPrivacyConsent 를 안 읽어서 granted 승격이
// 0 이던 버그(티켓 N8sAY4Tjelm5EhZmvjvv). 반대 방향(동의 없는 사람을 granted 로
// 만드는 것)은 규제 위반이라 양쪽을 다 못박는다.
(0, node_test_1.test)("backfillConsentGrantFromUserDoc: marketing=true → explicit_opt_in grant", () => {
    const g = (0, marketingContacts_1.backfillConsentGrantFromUserDoc)(userDoc(true));
    strict_1.default.ok(g);
    strict_1.default.equal(g.grant.legalBasis, "explicit_opt_in");
    strict_1.default.equal(g.grant.source, "web_privacy_consent");
    strict_1.default.equal(g.grant.version, "2026-07-14");
    strict_1.default.equal(g.grant.consentedAt, NOW); // 백필 시각이 아니라 실제 동의 시각
    strict_1.default.equal(g.locale, "ko");
    // 훅과 같은 판정기를 쓴다 — 백필/훅의 동의 기준이 갈라지지 않는다
    const viaHook = (0, marketingContacts_1.decideMarketingConsentSync)(null, userDoc(true));
    strict_1.default.equal(viaHook.kind, "grant");
    if (viaHook.kind === "grant")
        strict_1.default.equal(g.grant.version, viaHook.version);
});
(0, node_test_1.test)("★backfillConsentGrantFromUserDoc: 동의 없는 사람은 절대 grant 하지 않는다", () => {
    strict_1.default.equal((0, marketingContacts_1.backfillConsentGrantFromUserDoc)(userDoc(false)), null); // 미체크
    strict_1.default.equal((0, marketingContacts_1.backfillConsentGrantFromUserDoc)({}), null); // 동의 레코드 없음
    strict_1.default.equal((0, marketingContacts_1.backfillConsentGrantFromUserDoc)(null), null); // users 문서 없음
    strict_1.default.equal((0, marketingContacts_1.backfillConsentGrantFromUserDoc)(undefined), null);
    // 앱의 privacyConsent(텔레메트리 스키마)는 마케팅 동의 소스가 아니다
    strict_1.default.equal((0, marketingContacts_1.backfillConsentGrantFromUserDoc)({
        privacyConsent: { firstPartyTelemetry: true, marketing: true },
    }), null);
    // marketing 이 truthy 지만 true 가 아닌 값도 동의가 아니다
    strict_1.default.equal((0, marketingContacts_1.backfillConsentGrantFromUserDoc)({ webPrivacyConsent: { marketing: "1" } }), null);
});
(0, node_test_1.test)("★백필 grant 는 revoked 를 되살리지 않는다(수신거부 이력 보존)", () => {
    const g = (0, marketingContacts_1.backfillConsentGrantFromUserDoc)(userDoc(true));
    strict_1.default.ok(g);
    const merged = (0, marketingContacts_1.mergeEmailConsent)(withStatus("revoked"), { grant: g.grant }, NOW);
    strict_1.default.equal(merged.consent.status, "revoked");
    strict_1.default.equal(merged.event, null);
});
(0, node_test_1.test)("백필 grant 는 unknown·pending 만 올리고, 이미 granted 면 멱등", () => {
    const g = (0, marketingContacts_1.backfillConsentGrantFromUserDoc)(userDoc(true));
    strict_1.default.ok(g);
    strict_1.default.equal((0, marketingContacts_1.mergeEmailConsent)(null, { grant: g.grant }, NOW).consent.status, "granted");
    strict_1.default.equal((0, marketingContacts_1.mergeEmailConsent)(withStatus("pending"), { grant: g.grant }, NOW).consent
        .status, "granted");
    // 재실행해도 이벤트가 다시 쌓이지 않는다
    strict_1.default.equal((0, marketingContacts_1.mergeEmailConsent)(withStatus("granted"), { grant: g.grant }, NOW).event, null);
});
(0, node_test_1.test)("★철회 우선 불변식: 수신거부한 사람은 재동의해도 발송 불가", () => {
    // unsubscribe 링크로 수신거부 → 이후 설정에서 마케팅을 다시 체크한 경우.
    // consent 는 granted 로 갈 수 있어도 unsubscribe 가 이겨 발송 불가여야 한다.
    const consent = (0, marketingContacts_1.mergeEmailConsent)(withStatus("pending"), { grant: GRANT }, NOW).consent;
    strict_1.default.equal(consent.status, "granted");
    const verdict = (0, marketingContacts_1.isEmailable)({
        emailMarketingConsent: consent,
        unsubscribe: unsubscribed,
        emailEnc: "e",
    });
    strict_1.default.equal(verdict.ok, false);
    strict_1.default.equal(verdict.reason, "unsubscribed");
});
(0, node_test_1.test)("★revoke 후에는 isEmailable=false", () => {
    const consent = (0, marketingContacts_1.mergeEmailConsent)(withStatus("granted"), { revoke: REVOKE }, NOW).consent;
    strict_1.default.equal((0, marketingContacts_1.isEmailable)({
        emailMarketingConsent: consent,
        unsubscribe: subscribed,
        emailEnc: "e",
    }).ok, false);
});
// ─── decideWaitlistConsentGrant (베타신청 폼 마케팅 동의 판정) ──────────
// 회귀 방지: 티켓 zaLMLwYf1kQfeQJqdAkz — 베타신청 폼에 grantConsent 호출부가
// 0건이라 marketing_contacts 를 백필해도 emailable 이 0→0 이던 문제.
(0, node_test_1.test)("decideWaitlistConsentGrant: marketingConsent=true → grant(버전·동의시각 전달)", () => {
    const consentedAt = new Date("2026-07-31T00:00:00Z");
    const decision = (0, marketingContacts_1.decideWaitlistConsentGrant)({
        agreed: true,
        marketingConsent: true,
        marketingConsentVersion: "2026-07-31",
        marketingConsentAt: consentedAt,
    });
    strict_1.default.equal(decision.kind, "grant");
    if (decision.kind === "grant") {
        strict_1.default.equal(decision.version, "2026-07-31");
        strict_1.default.equal(decision.consentedAt, consentedAt);
    }
});
(0, node_test_1.test)("★decideWaitlistConsentGrant: agreed(활동/인용 동의)만으로는 grant 근거가 아니다 — pending 까지만", () => {
    const decision = (0, marketingContacts_1.decideWaitlistConsentGrant)({ agreed: true });
    strict_1.default.equal(decision.kind, "pending");
});
(0, node_test_1.test)("decideWaitlistConsentGrant: 아무 동의도 없으면 none", () => {
    strict_1.default.equal((0, marketingContacts_1.decideWaitlistConsentGrant)({}).kind, "none");
    strict_1.default.equal((0, marketingContacts_1.decideWaitlistConsentGrant)({ agreed: false, marketingConsent: false }).kind, "none");
});
(0, node_test_1.test)("★decideWaitlistConsentGrant: marketingConsent 이 truthy 지만 true 가 아니면 grant 하지 않는다", () => {
    strict_1.default.equal((0, marketingContacts_1.decideWaitlistConsentGrant)({ marketingConsent: "1" })
        .kind, "none");
});
(0, node_test_1.test)("★신규 waitlist 마케팅 동의자는 grant → isEmailable=ok(0→0 회귀 방지)", () => {
    const decision = (0, marketingContacts_1.decideWaitlistConsentGrant)({
        agreed: true,
        marketingConsent: true,
        marketingConsentVersion: "2026-07-31",
        marketingConsentAt: NOW,
    });
    strict_1.default.equal(decision.kind, "grant");
    if (decision.kind !== "grant")
        return;
    const merged = (0, marketingContacts_1.mergeEmailConsent)(marketingContacts_1.UNKNOWN_CONSENT, {
        grant: {
            source: "waitlist_form_marketing_optin",
            version: decision.version,
            legalBasis: "explicit_opt_in",
            consentedAt: decision.consentedAt,
        },
    }, NOW);
    strict_1.default.equal(merged.consent.status, "granted");
    strict_1.default.equal(merged.consent.legalBasis, "explicit_opt_in");
    strict_1.default.equal((0, marketingContacts_1.isEmailable)({
        emailMarketingConsent: merged.consent,
        unsubscribe: subscribed,
        emailEnc: "e",
    }).ok, true);
});
