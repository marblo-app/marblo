// marketingContacts 순수 로직 단위테스트 (redact.test.ts 와 동일 규약).
// 컴파일 후 `node --test` 로 실행:
//   tsc src/marketingContacts.ts src/marketingContacts.test.ts --outDir /tmp/out \
//       --module commonjs --target es2020 --esModuleInterop \
//   && node --test /tmp/out/marketingContacts.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contactIdForEmail,
  emailDomainOf,
  encryptEmail,
  decryptEmail,
  parseEncKey,
  unsubscribeTokenForContact,
  verifyUnsubscribeToken,
  buildUnsubscribeUrl,
  isEmailable,
  deriveLifecycleStage,
  deriveSegments,
  contactToBqRow,
  toIsoOrNull,
  type ContactFlags,
} from "./marketingContacts";

const KEY = Buffer.alloc(32, 7).toString("base64"); // 테스트 전용 고정 키
const SECRET = "test-unsub-secret";

test("contactIdForEmail: 정규화(trim+lowercase) 후 sha256 — 같은 이메일 = 같은 id", () => {
  const a = contactIdForEmail("  John.Kim@Example.COM ");
  const b = contactIdForEmail("john.kim@example.com");
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("emailDomainOf: 도메인만 추출(평문 local part 비노출)", () => {
  assert.equal(emailDomainOf("A@Gmail.com"), "gmail.com");
  assert.equal(emailDomainOf("invalid"), "");
});

test("encryptEmail/decryptEmail: 라운드트립 + iv 난수화", () => {
  const enc1 = encryptEmail("USER@Example.com", KEY);
  const enc2 = encryptEmail("USER@Example.com", KEY);
  assert.notEqual(enc1, enc2); // iv 가 달라 암호문도 달라야 함
  assert.equal(decryptEmail(enc1, KEY), "user@example.com");
  assert.equal(decryptEmail(enc2, KEY), "user@example.com");
  assert.ok(enc1.startsWith("v1:"));
  assert.ok(!enc1.includes("user@example.com"));
});

test("decryptEmail: 다른 키/변조 암호문은 실패", () => {
  const otherKey = Buffer.alloc(32, 9).toString("base64");
  const enc = encryptEmail("user@example.com", KEY);
  assert.throws(() => decryptEmail(enc, otherKey));
  const tampered = enc.slice(0, -4) + "AAAA";
  assert.throws(() => decryptEmail(tampered, KEY));
});

test("parseEncKey: 32바이트 base64 만 유효", () => {
  assert.ok(parseEncKey(KEY));
  assert.equal(parseEncKey(""), null);
  assert.equal(parseEncKey("short"), null);
  assert.equal(parseEncKey(Buffer.alloc(16).toString("base64")), null);
});

test("unsubscribe 토큰: 파생·검증 stateless, 위조 거부", () => {
  const cid = contactIdForEmail("user@example.com");
  const token = unsubscribeTokenForContact(cid, SECRET);
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.ok(verifyUnsubscribeToken(cid, token, SECRET));
  assert.ok(!verifyUnsubscribeToken(cid, token.slice(0, -1) + "0", SECRET));
  assert.ok(!verifyUnsubscribeToken(cid, token, "other-secret"));
  assert.ok(!verifyUnsubscribeToken(cid, "", SECRET));
  assert.ok(!verifyUnsubscribeToken(cid, token, ""));
  // 다른 컨택트의 토큰은 통하지 않는다
  const otherToken = unsubscribeTokenForContact(
    contactIdForEmail("other@example.com"),
    SECRET
  );
  assert.ok(!verifyUnsubscribeToken(cid, otherToken, SECRET));
});

test("buildUnsubscribeUrl: contactId + 토큰 포함", () => {
  const cid = contactIdForEmail("user@example.com");
  const url = buildUnsubscribeUrl("https://fn.example.com", cid, SECRET);
  assert.ok(url.includes(`c=${cid}`));
  assert.ok(url.includes("t="));
  assert.ok(url.startsWith("https://fn.example.com/unsubscribeMarketingEmail"));
});

const consentOf = (status: "granted" | "pending" | "revoked" | "unknown") => ({
  status,
  source: "s",
  version: "v1",
  consentedAt: null,
  revokedAt: null,
  legalBasis: "explicit_opt_in" as const,
});
const subscribed = { status: "subscribed" as const, tokenHash: null, unsubscribedAt: null };
const unsubscribed = {
  status: "unsubscribed" as const,
  tokenHash: "h",
  unsubscribedAt: null,
};

test("isEmailable: consent granted + not unsubscribed 만 발송 가능", () => {
  assert.equal(isEmailable(null).reason, "no_contact");
  assert.equal(
    isEmailable({ emailMarketingConsent: consentOf("unknown"), unsubscribe: subscribed, emailEnc: "e" }).reason,
    "consent_not_granted"
  );
  assert.equal(
    isEmailable({ emailMarketingConsent: consentOf("revoked"), unsubscribe: subscribed, emailEnc: "e" }).reason,
    "consent_not_granted"
  );
  // ★pending(waitlist 재동의 대상 풀)은 발송 불가 — COMPLIANCE-AUDIT D2 정정 반영
  assert.equal(
    isEmailable({ emailMarketingConsent: consentOf("pending"), unsubscribe: subscribed, emailEnc: "e" }).reason,
    "consent_not_granted"
  );
  assert.equal(
    isEmailable({ emailMarketingConsent: consentOf("granted"), unsubscribe: unsubscribed, emailEnc: "e" }).reason,
    "unsubscribed"
  );
  assert.equal(
    isEmailable({ emailMarketingConsent: consentOf("granted"), unsubscribe: subscribed, emailEnc: "e" }).ok,
    true
  );
});

test("lifecycle/segments 파생", () => {
  const base: ContactFlags = {
    hasWaitlist: true,
    hasAuthAccount: false,
    isFounder: false,
    founderRejected: false,
    hasActivePaidSubscription: false,
    hasActiveFounderGrant: false,
  };
  assert.equal(deriveLifecycleStage(base), "lead");
  assert.equal(deriveLifecycleStage({ ...base, hasAuthAccount: true }), "signup");
  assert.equal(deriveLifecycleStage({ ...base, isFounder: true }), "founder");
  assert.equal(
    deriveLifecycleStage({ ...base, isFounder: true, hasActivePaidSubscription: true }),
    "subscriber"
  );
  assert.deepEqual(
    deriveSegments({
      ...base,
      hasAuthAccount: true,
      isFounder: true,
      hasActiveFounderGrant: true,
    }),
    ["waitlist", "auth_user", "founder", "beta_active"]
  );
  assert.deepEqual(deriveSegments({ ...base, founderRejected: true }), [
    "waitlist",
    "founder_rejected",
  ]);
});

test("contactToBqRow: 평문 이메일·emailEnc 를 구조적으로 배제", () => {
  const email = "secret.user@example.com";
  const cid = contactIdForEmail(email);
  const row = contactToBqRow(
    cid,
    {
      uid: "u1",
      normalizedEmailHash: cid,
      emailEnc: encryptEmail(email, KEY),
      emailDomain: "example.com",
      source: "waitlist",
      locale: "ko",
      signupAt: new Date("2026-01-02T03:04:05Z"),
      founderStatus: "selected",
      subscription: { plan: "pro", status: "active", provider: "toss", periodEnd: null },
      emailMarketingConsent: consentOf("granted"),
      unsubscribe: subscribed,
      segments: ["waitlist", "founder"],
      lifecycleStage: "founder",
    },
    "2026-07-18"
  );
  const json = JSON.stringify(row);
  assert.ok(!json.includes("secret.user")); // 평문 local part 없음
  assert.ok(!json.includes("v1:")); // 암호문(emailEnc)도 미러하지 않음
  assert.equal(row.email_hash, cid);
  assert.equal(row.signup_at, "2026-01-02T03:04:05.000Z");
  assert.equal(row.snapshot_date, "2026-07-18");
  assert.equal(row.consent_status, "granted");
  assert.deepEqual(row.segments, ["waitlist", "founder"]);
});

test("toIsoOrNull: Timestamp 유사체·Date·number·null 처리", () => {
  assert.equal(toIsoOrNull(null), null);
  assert.equal(toIsoOrNull(undefined), null);
  assert.equal(toIsoOrNull(0), "1970-01-01T00:00:00.000Z");
  assert.equal(
    toIsoOrNull({ toMillis: () => 1000 }),
    "1970-01-01T00:00:01.000Z"
  );
  assert.equal(toIsoOrNull({ seconds: 2 }), "1970-01-01T00:00:02.000Z");
});
