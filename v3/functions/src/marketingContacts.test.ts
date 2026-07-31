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
  mergeEmailConsent,
  decideMarketingConsentSync,
  backfillConsentGrantFromUserDoc,
  decideWaitlistConsentGrant,
  marketingConsentStatusView,
  shouldPromptReconsent,
  UNKNOWN_CONSENT,
  type ContactFlags,
  type EmailMarketingConsent,
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
    SECRET,
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
const subscribed = {
  status: "subscribed" as const,
  tokenHash: null,
  unsubscribedAt: null,
};
const unsubscribed = {
  status: "unsubscribed" as const,
  tokenHash: "h",
  unsubscribedAt: null,
};

test("isEmailable: consent granted + not unsubscribed 만 발송 가능", () => {
  assert.equal(isEmailable(null).reason, "no_contact");
  assert.equal(
    isEmailable({
      emailMarketingConsent: consentOf("unknown"),
      unsubscribe: subscribed,
      emailEnc: "e",
    }).reason,
    "consent_not_granted",
  );
  assert.equal(
    isEmailable({
      emailMarketingConsent: consentOf("revoked"),
      unsubscribe: subscribed,
      emailEnc: "e",
    }).reason,
    "consent_not_granted",
  );
  // ★pending(waitlist 재동의 대상 풀)은 발송 불가 — COMPLIANCE-AUDIT D2 정정 반영
  assert.equal(
    isEmailable({
      emailMarketingConsent: consentOf("pending"),
      unsubscribe: subscribed,
      emailEnc: "e",
    }).reason,
    "consent_not_granted",
  );
  assert.equal(
    isEmailable({
      emailMarketingConsent: consentOf("granted"),
      unsubscribe: unsubscribed,
      emailEnc: "e",
    }).reason,
    "unsubscribed",
  );
  assert.equal(
    isEmailable({
      emailMarketingConsent: consentOf("granted"),
      unsubscribe: subscribed,
      emailEnc: "e",
    }).ok,
    true,
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
  assert.equal(
    deriveLifecycleStage({ ...base, hasAuthAccount: true }),
    "signup",
  );
  assert.equal(deriveLifecycleStage({ ...base, isFounder: true }), "founder");
  assert.equal(
    deriveLifecycleStage({
      ...base,
      isFounder: true,
      hasActivePaidSubscription: true,
    }),
    "subscriber",
  );
  assert.deepEqual(
    deriveSegments({
      ...base,
      hasAuthAccount: true,
      isFounder: true,
      hasActiveFounderGrant: true,
    }),
    ["waitlist", "auth_user", "founder", "beta_active"],
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
    },
    "2026-07-18",
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
    "1970-01-01T00:00:01.000Z",
  );
  assert.equal(toIsoOrNull({ seconds: 2 }), "1970-01-01T00:00:02.000Z");
});

// ─── mergeEmailConsent (동의 병합 단일 판정) ──────────────────────────
const NOW = new Date("2026-07-20T00:00:00Z");
const GRANT = {
  source: "web_privacy_consent",
  version: "2026-07-14",
  legalBasis: "explicit_opt_in" as const,
  consentedAt: null,
};
const PENDING = { source: "waitlist_form", detail: "activity agreement only" };
const REVOKE = { source: "web_privacy_consent", detail: "unchecked" };

const withStatus = (
  status: "granted" | "pending" | "revoked" | "unknown",
): EmailMarketingConsent => ({
  status,
  source: "prev",
  version: "2026-01-01",
  consentedAt: status === "granted" ? NOW : null,
  revokedAt: null,
  legalBasis: status === "granted" ? "explicit_opt_in" : "none",
});

test("mergeEmailConsent grant: unknown/pending 만 granted 로 승격", () => {
  const fromUnknown = mergeEmailConsent(UNKNOWN_CONSENT, { grant: GRANT }, NOW);
  assert.equal(fromUnknown.consent.status, "granted");
  assert.equal(fromUnknown.consent.legalBasis, "explicit_opt_in");
  assert.equal(fromUnknown.event?.type, "granted");

  const fromPending = mergeEmailConsent(
    withStatus("pending"),
    { grant: GRANT },
    NOW,
  );
  assert.equal(fromPending.consent.status, "granted");
  assert.equal(fromPending.event?.type, "granted");

  // 이미 granted → 변화 없음 + 이벤트 없음(멱등, 중복 감사기록 방지)
  const already = mergeEmailConsent(
    withStatus("granted"),
    { grant: GRANT },
    NOW,
  );
  assert.equal(already.consent.status, "granted");
  assert.equal(already.event, null);
  assert.equal(already.consent.source, "prev"); // 기존 동의 증빙 보존
});

test("★mergeEmailConsent: revoked 는 grant 로 절대 되살아나지 않는다", () => {
  const r = mergeEmailConsent(withStatus("revoked"), { grant: GRANT }, NOW);
  assert.equal(r.consent.status, "revoked");
  assert.equal(r.event, null);
});

test("mergeEmailConsent revoke: granted/pending → revoked, revokedAt 기록", () => {
  const fromGranted = mergeEmailConsent(
    withStatus("granted"),
    { revoke: REVOKE },
    NOW,
  );
  assert.equal(fromGranted.consent.status, "revoked");
  assert.equal(fromGranted.consent.revokedAt, NOW);
  assert.equal(fromGranted.consent.consentedAt, NOW); // 동의 시점은 감사용으로 보존
  assert.equal(fromGranted.event?.type, "revoked");

  const fromPending = mergeEmailConsent(
    withStatus("pending"),
    { revoke: REVOKE },
    NOW,
  );
  assert.equal(fromPending.consent.status, "revoked");

  // unknown 은 철회할 것이 없다 — noop
  const fromUnknown = mergeEmailConsent(
    UNKNOWN_CONSENT,
    { revoke: REVOKE },
    NOW,
  );
  assert.equal(fromUnknown.consent.status, "unknown");
  assert.equal(fromUnknown.event, null);
});

test("★mergeEmailConsent: 철회가 동의를 이긴다(같은 요청에 둘 다 와도 revoke)", () => {
  const r = mergeEmailConsent(
    withStatus("granted"),
    { grant: GRANT, revoke: REVOKE },
    NOW,
  );
  assert.equal(r.consent.status, "revoked");
  assert.equal(r.event?.type, "revoked");
});

test("mergeEmailConsent pending: unknown 만 편입, granted 를 강등하지 않음", () => {
  assert.equal(
    mergeEmailConsent(UNKNOWN_CONSENT, { pending: PENDING }, NOW).consent
      .status,
    "pending",
  );
  assert.equal(
    mergeEmailConsent(withStatus("granted"), { pending: PENDING }, NOW).consent
      .status,
    "granted",
  );
  assert.equal(
    mergeEmailConsent(withStatus("revoked"), { pending: PENDING }, NOW).consent
      .status,
    "revoked",
  );
});

test("mergeEmailConsent: 요청이 없으면 현재 상태 그대로(base 없으면 unknown)", () => {
  assert.equal(mergeEmailConsent(null, {}, NOW).consent.status, "unknown");
  assert.equal(mergeEmailConsent(undefined, {}, NOW).event, null);
  assert.equal(
    mergeEmailConsent(withStatus("granted"), {}, NOW).consent.status,
    "granted",
  );
});

// ─── decideMarketingConsentSync (users/{uid} write → 무엇을 할 것인가) ─
const userDoc = (marketing: boolean, version = "2026-07-14") => ({
  webPrivacyConsent: {
    collectionUse: true,
    overseasTransfer: true,
    marketing,
    version,
    locale: "ko",
    acceptedAt: NOW,
  },
});

test("decideMarketingConsentSync: 마케팅 체크 → grant(버전·로케일·동의시각 전달)", () => {
  const a = decideMarketingConsentSync(null, userDoc(true));
  assert.equal(a.kind, "grant");
  if (a.kind === "grant") {
    assert.equal(a.version, "2026-07-14");
    assert.equal(a.locale, "ko");
    assert.equal(a.consentedAt, NOW);
  }
});

test("★decideMarketingConsentSync: 미체크는 건드리지 않는다(승격도 철회도 없음)", () => {
  // 가입 시 마케팅 미체크 — granted 인 적이 없으므로 revoke 대상이 아니다
  const a = decideMarketingConsentSync(null, userDoc(false));
  assert.equal(a.kind, "none");
  if (a.kind === "none") assert.equal(a.reason, "never_opted_in");

  // 계속 미체크로 다른 필드만 갱신 — 여전히 none
  const b = decideMarketingConsentSync(userDoc(false), userDoc(false));
  assert.equal(b.kind, "none");
});

test("decideMarketingConsentSync: true→false 전이만 revoke", () => {
  const a = decideMarketingConsentSync(userDoc(true), userDoc(false));
  assert.equal(a.kind, "revoke");
});

test("decideMarketingConsentSync: consent 레코드 없으면 no_consent_record", () => {
  const a = decideMarketingConsentSync(null, { someOtherField: 1 });
  assert.equal(a.kind, "none");
  if (a.kind === "none") assert.equal(a.reason, "no_consent_record");

  // ★앱의 privacyConsent(텔레메트리 스키마)는 마케팅 동의 소스가 아니다
  const b = decideMarketingConsentSync(null, {
    privacyConsent: { firstPartyTelemetry: true, marketing: true },
  });
  assert.equal(b.kind, "none");
  if (b.kind === "none") assert.equal(b.reason, "no_consent_record");
});

test("decideMarketingConsentSync: 멱등 — 동의 유지 상태의 무관한 write 는 unchanged", () => {
  const a = decideMarketingConsentSync(userDoc(true), userDoc(true));
  assert.equal(a.kind, "none");
  if (a.kind === "none") assert.equal(a.reason, "unchanged");

  // 단 정책 버전이 오르면(재동의) 다시 grant 를 흘려보낸다
  const b = decideMarketingConsentSync(
    userDoc(true),
    userDoc(true, "2027-01-01"),
  );
  assert.equal(b.kind, "grant");
});

test("★순서 무관: saveConsent 가 auth onCreate 보다 나중이어도 granted 로 수렴", () => {
  // 순서 A — auth onCreate 먼저(동의 정보 없이 컨택트 생성) → saveConsent 나중
  let consentA = mergeEmailConsent(null, {}, NOW).consent; // onCreate: grant 요청 없음
  assert.equal(consentA.status, "unknown");
  const actionA = decideMarketingConsentSync(null, userDoc(true));
  assert.equal(actionA.kind, "grant");
  consentA = mergeEmailConsent(consentA, { grant: GRANT }, NOW).consent;
  assert.equal(consentA.status, "granted");

  // 순서 B — saveConsent 먼저(컨택트를 granted 로 생성) → auth onCreate 나중
  let consentB = mergeEmailConsent(null, { grant: GRANT }, NOW).consent;
  assert.equal(consentB.status, "granted");
  consentB = mergeEmailConsent(consentB, {}, NOW).consent; // 뒤늦은 onCreate
  assert.equal(consentB.status, "granted");

  // 두 순서의 최종 상태가 같고, 둘 다 발송 가능
  assert.equal(consentA.status, consentB.status);
  for (const c of [consentA, consentB]) {
    assert.equal(
      isEmailable({
        emailMarketingConsent: c,
        unsubscribe: subscribed,
        emailEnc: "e",
      }).ok,
      true,
    );
  }
});

// ─── backfillConsentGrantFromUserDoc (백필의 동의 매핑) ───────────────
// 회귀 방지: 백필이 users/{uid}.webPrivacyConsent 를 안 읽어서 granted 승격이
// 0 이던 버그(티켓 N8sAY4Tjelm5EhZmvjvv). 반대 방향(동의 없는 사람을 granted 로
// 만드는 것)은 규제 위반이라 양쪽을 다 못박는다.
test("backfillConsentGrantFromUserDoc: marketing=true → explicit_opt_in grant", () => {
  const g = backfillConsentGrantFromUserDoc(userDoc(true));
  assert.ok(g);
  assert.equal(g.grant.legalBasis, "explicit_opt_in");
  assert.equal(g.grant.source, "web_privacy_consent");
  assert.equal(g.grant.version, "2026-07-14");
  assert.equal(g.grant.consentedAt, NOW); // 백필 시각이 아니라 실제 동의 시각
  assert.equal(g.locale, "ko");

  // 훅과 같은 판정기를 쓴다 — 백필/훅의 동의 기준이 갈라지지 않는다
  const viaHook = decideMarketingConsentSync(null, userDoc(true));
  assert.equal(viaHook.kind, "grant");
  if (viaHook.kind === "grant") assert.equal(g.grant.version, viaHook.version);
});

test("★backfillConsentGrantFromUserDoc: 동의 없는 사람은 절대 grant 하지 않는다", () => {
  assert.equal(backfillConsentGrantFromUserDoc(userDoc(false)), null); // 미체크
  assert.equal(backfillConsentGrantFromUserDoc({}), null); // 동의 레코드 없음
  assert.equal(backfillConsentGrantFromUserDoc(null), null); // users 문서 없음
  assert.equal(backfillConsentGrantFromUserDoc(undefined), null);
  // 앱의 privacyConsent(텔레메트리 스키마)는 마케팅 동의 소스가 아니다
  assert.equal(
    backfillConsentGrantFromUserDoc({
      privacyConsent: { firstPartyTelemetry: true, marketing: true },
    }),
    null,
  );
  // marketing 이 truthy 지만 true 가 아닌 값도 동의가 아니다
  assert.equal(
    backfillConsentGrantFromUserDoc({ webPrivacyConsent: { marketing: "1" } }),
    null,
  );
});

test("★백필 grant 는 revoked 를 되살리지 않는다(수신거부 이력 보존)", () => {
  const g = backfillConsentGrantFromUserDoc(userDoc(true));
  assert.ok(g);
  const merged = mergeEmailConsent(
    withStatus("revoked"),
    { grant: g.grant },
    NOW,
  );
  assert.equal(merged.consent.status, "revoked");
  assert.equal(merged.event, null);
});

test("백필 grant 는 unknown·pending 만 올리고, 이미 granted 면 멱등", () => {
  const g = backfillConsentGrantFromUserDoc(userDoc(true));
  assert.ok(g);
  assert.equal(
    mergeEmailConsent(null, { grant: g.grant }, NOW).consent.status,
    "granted",
  );
  assert.equal(
    mergeEmailConsent(withStatus("pending"), { grant: g.grant }, NOW).consent
      .status,
    "granted",
  );
  // 재실행해도 이벤트가 다시 쌓이지 않는다
  assert.equal(
    mergeEmailConsent(withStatus("granted"), { grant: g.grant }, NOW).event,
    null,
  );
});

test("★철회 우선 불변식: 수신거부한 사람은 재동의해도 발송 불가", () => {
  // unsubscribe 링크로 수신거부 → 이후 설정에서 마케팅을 다시 체크한 경우.
  // consent 는 granted 로 갈 수 있어도 unsubscribe 가 이겨 발송 불가여야 한다.
  const consent = mergeEmailConsent(
    withStatus("pending"),
    { grant: GRANT },
    NOW,
  ).consent;
  assert.equal(consent.status, "granted");
  const verdict = isEmailable({
    emailMarketingConsent: consent,
    unsubscribe: unsubscribed,
    emailEnc: "e",
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "unsubscribed");
});

test("★revoke 후에는 isEmailable=false", () => {
  const consent = mergeEmailConsent(
    withStatus("granted"),
    { revoke: REVOKE },
    NOW,
  ).consent;
  assert.equal(
    isEmailable({
      emailMarketingConsent: consent,
      unsubscribe: subscribed,
      emailEnc: "e",
    }).ok,
    false,
  );
});

// ─── decideWaitlistConsentGrant (베타신청 폼 마케팅 동의 판정) ──────────
// 회귀 방지: 티켓 zaLMLwYf1kQfeQJqdAkz — 베타신청 폼에 grantConsent 호출부가
// 0건이라 marketing_contacts 를 백필해도 emailable 이 0→0 이던 문제.
test("decideWaitlistConsentGrant: marketingConsent=true → grant(버전·동의시각 전달)", () => {
  const consentedAt = new Date("2026-07-31T00:00:00Z");
  const decision = decideWaitlistConsentGrant({
    agreed: true,
    marketingConsent: true,
    marketingConsentVersion: "2026-07-31",
    marketingConsentAt: consentedAt,
  });
  assert.equal(decision.kind, "grant");
  if (decision.kind === "grant") {
    assert.equal(decision.version, "2026-07-31");
    assert.equal(decision.consentedAt, consentedAt);
  }
});

test("★decideWaitlistConsentGrant: agreed(활동/인용 동의)만으로는 grant 근거가 아니다 — pending 까지만", () => {
  const decision = decideWaitlistConsentGrant({ agreed: true });
  assert.equal(decision.kind, "pending");
});

test("decideWaitlistConsentGrant: 아무 동의도 없으면 none", () => {
  assert.equal(decideWaitlistConsentGrant({}).kind, "none");
  assert.equal(
    decideWaitlistConsentGrant({ agreed: false, marketingConsent: false }).kind,
    "none",
  );
});

test("★decideWaitlistConsentGrant: marketingConsent 이 truthy 지만 true 가 아니면 grant 하지 않는다", () => {
  assert.equal(
    decideWaitlistConsentGrant({ marketingConsent: "1" as unknown as boolean })
      .kind,
    "none",
  );
});

test("★신규 waitlist 마케팅 동의자는 grant → isEmailable=ok(0→0 회귀 방지)", () => {
  const decision = decideWaitlistConsentGrant({
    agreed: true,
    marketingConsent: true,
    marketingConsentVersion: "2026-07-31",
    marketingConsentAt: NOW,
  });
  assert.equal(decision.kind, "grant");
  if (decision.kind !== "grant") return;
  const merged = mergeEmailConsent(
    UNKNOWN_CONSENT,
    {
      grant: {
        source: "waitlist_form_marketing_optin",
        version: decision.version,
        legalBasis: "explicit_opt_in",
        consentedAt: decision.consentedAt,
      },
    },
    NOW,
  );
  assert.equal(merged.consent.status, "granted");
  assert.equal(merged.consent.legalBasis, "explicit_opt_in");
  assert.equal(
    isEmailable({
      emailMarketingConsent: merged.consent,
      unsubscribe: subscribed,
      emailEnc: "e",
    }).ok,
    true,
  );
});

// ─── 앱 마케팅 opt-in 2곳(온보딩 체크박스 + 기존 파운더 재동의 배너) ──────
// 둘 다 users/{uid}.webPrivacyConsent.marketing=true 를 쓰고 훅 1b
// (decideMarketingConsentSync)가 grant 로 잇는다 — 새 훅 없음.

test("★앱 온보딩 opt-in: webPrivacyConsent.marketing=true → grant → isEmailable=ok", () => {
  const action = decideMarketingConsentSync(null, {
    webPrivacyConsent: {
      marketing: true,
      version: "2026-07-31",
      locale: "ko",
      acceptedAt: NOW,
    },
  });
  assert.equal(action.kind, "grant");
  if (action.kind !== "grant") return;
  const merged = mergeEmailConsent(
    UNKNOWN_CONSENT,
    {
      grant: {
        source: "web_privacy_consent",
        version: action.version,
        legalBasis: "explicit_opt_in",
        consentedAt: action.consentedAt,
      },
    },
    NOW,
  );
  assert.equal(merged.consent.status, "granted");
  assert.equal(merged.consent.legalBasis, "explicit_opt_in");
  assert.equal(
    isEmailable({
      emailMarketingConsent: merged.consent,
      unsubscribe: subscribed,
      emailEnc: "e",
    }).ok,
    true,
  );
});

test("★온보딩에서 체크 안 하면 아무 write 도 없고, 설령 문서가 있어도 승격되지 않는다", () => {
  // 앱은 미체크 시 webPrivacyConsent 자체를 쓰지 않는다 → no_consent_record.
  assert.equal(
    decideMarketingConsentSync(null, { someOtherField: 1 }).kind,
    "none",
  );
  // 어떤 경로로 marketing:false 가 들어와도 never_opted_in — granted 로 올리지 않는다.
  const action = decideMarketingConsentSync(null, {
    webPrivacyConsent: { marketing: false, version: "2026-07-31" },
  });
  assert.equal(action.kind, "none");
  if (action.kind === "none") assert.equal(action.reason, "never_opted_in");
  // 컨택트는 unknown 그대로 → 발송 불가.
  assert.equal(
    isEmailable({
      emailMarketingConsent: UNKNOWN_CONSENT,
      unsubscribe: subscribed,
      emailEnc: "e",
    }).reason,
    "consent_not_granted",
  );
});

test("marketingConsentStatusView: 컨택트 없으면 no_contact(배너 대상 아님)", () => {
  const view = marketingConsentStatusView(null);
  assert.deepEqual(view, {
    status: "no_contact",
    unsubscribed: false,
    isFounder: false,
  });
  assert.equal(shouldPromptReconsent(view), false);
});

test("marketingConsentStatusView: 세그먼트/founderStatus 중 하나만 있어도 파운더로 본다", () => {
  assert.equal(
    marketingConsentStatusView({ segments: ["auth_user", "founder"] })
      .isFounder,
    true,
  );
  assert.equal(
    marketingConsentStatusView({ founderStatus: "selected" }).isFounder,
    true,
  );
  // rejected 는 파운더가 아니다(deriveSegments 와 같은 기준).
  assert.equal(
    marketingConsentStatusView({ founderStatus: "rejected" }).isFounder,
    false,
  );
  assert.equal(marketingConsentStatusView({ segments: [] }).isFounder, false);
});

test("★재동의 배너: status unknown 인 파운더에게만 노출", () => {
  const founderUnknown = {
    emailMarketingConsent: UNKNOWN_CONSENT,
    unsubscribe: subscribed,
    segments: ["founder"],
  };
  assert.equal(
    shouldPromptReconsent(marketingConsentStatusView(founderUnknown)),
    true,
  );
  // 파운더가 아니면 미노출 — 신규 가입자는 온보딩 체크박스에서 이미 물었다.
  assert.equal(
    shouldPromptReconsent(
      marketingConsentStatusView({
        ...founderUnknown,
        segments: ["auth_user"],
      }),
    ),
    false,
  );
});

test("★재동의 배너: status≠unknown 이면 전부 미노출(granted/pending/revoked)", () => {
  for (const status of ["granted", "pending", "revoked"] as const) {
    const view = marketingConsentStatusView({
      emailMarketingConsent: { ...UNKNOWN_CONSENT, status },
      unsubscribe: subscribed,
      segments: ["founder"],
    });
    assert.equal(view.status, status);
    assert.equal(
      shouldPromptReconsent(view),
      false,
      `${status} 인 사람에게 배너가 떴다`,
    );
  }
});

test("★재동의 배너: 수신거부자에게는 절대 노출하지 않는다(unsub 왕복 유지)", () => {
  // status 가 어쩌다 unknown 으로 남아 있어도 unsubscribed 가 이긴다.
  const view = marketingConsentStatusView({
    emailMarketingConsent: UNKNOWN_CONSENT,
    unsubscribe: unsubscribed,
    segments: ["founder"],
  });
  assert.equal(view.unsubscribed, true);
  assert.equal(shouldPromptReconsent(view), false);
});

test("★재동의 배너 opt-in 도 같은 경로로 granted — 단, revoked 는 되살리지 않는다", () => {
  const grant = {
    source: "web_privacy_consent",
    version: "2026-07-31",
    legalBasis: "explicit_opt_in" as const,
    consentedAt: NOW,
  };
  // unknown(배너 노출 대상) → granted
  const promoted = mergeEmailConsent(UNKNOWN_CONSENT, { grant }, NOW);
  assert.equal(promoted.consent.status, "granted");
  assert.equal(promoted.event?.type, "granted");
  // revoked 인 사람은 애초에 배너를 못 보지만, 설령 write 가 흘러와도 안 되살아난다.
  const revoked = mergeEmailConsent(
    { ...UNKNOWN_CONSENT, status: "revoked" },
    { grant },
    NOW,
  );
  assert.equal(revoked.consent.status, "revoked");
  assert.equal(revoked.event, null);
});
