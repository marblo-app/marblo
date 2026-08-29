// analyticsInternal 순수 로직 단위테스트 (analyticsPseudonym.test.ts 규약).
// 실행:
//   cd v3/functions && npm run test:analytics-internal
//
// ★이 파일이 지키는 것 다섯:
//   1) 오너는 설정이 비어 있어도, 못 읽어도 **항상** 내부다(fail-safe).
//   2) 판정은 boolean 이 아니라 (내부여부, **사유**)다 — 왜 빠졌는지 되짚을 수 있다.
//   3) 이메일 비교 규약은 한 곳에만 있다(설정 쪽과 계정 쪽이 같은 함수를 탄다).
//   4) BQ 로 나가는 것은 `us_` 가명 배열뿐 — 원시 uid·이메일·도메인·솔트 없음.
//   5) 요약에 원시값이 한 글자도 없다(기존 "제외 건수만 노출한다" 규약).
import test from "node:test";
import assert from "node:assert/strict";

import { pseudonymizeAnalyticsId } from "./analyticsPseudonym";
import {
  ADMIN_UID_ENV,
  EMPTY_INTERNAL_CONFIG,
  INTERNAL_EMAILS_ENV,
  INTERNAL_EMAIL_DOMAINS_ENV,
  INTERNAL_UIDS_ENV,
  buildInternalMatcher,
  classifyInternalAccount,
  deriveInternalUserKeys,
  internalUidsOf,
  mergeInternalConfigs,
  normalizeEmail,
  normalizeEmailDomain,
  parseListEnv,
  readInternalConfigFromDoc,
  readInternalConfigFromEnv,
  summarizeInternalMatcher,
} from "./analyticsInternal";

const SALT = "test-salt-do-not-use-in-prod";
const OWNER = "owner-uid-0000000000000000";
const MELO = "melo-uid-00000000000000000";

// ═══════════════════════════════════════════════════════════════════════════
// 1) 오너 폴백 — 설정이 비어도 내부 판정이 0명이 되면 안 된다
// ═══════════════════════════════════════════════════════════════════════════

test("★설정이 완전히 비어도 오너는 내부다", () => {
  const m = buildInternalMatcher(EMPTY_INTERNAL_CONFIG, {
    [ADMIN_UID_ENV]: OWNER,
  });
  const v = classifyInternalAccount({ uid: OWNER }, m);
  assert.equal(v.internal, true);
  assert.equal(v.reason, "owner");
});

test("ADMIN_UID 가 없으면 오너 폴백도 없다 — 조용히 아무나 내부가 되지 않는다", () => {
  const m = buildInternalMatcher(EMPTY_INTERNAL_CONFIG, {});
  assert.equal(m.ownerUid, null);
  assert.equal(classifyInternalAccount({ uid: OWNER }, m).internal, false);
});

test("★사유 우선순위는 좁은 규칙부터다 — 오너가 도메인 규칙에 가려지지 않는다", () => {
  const m = buildInternalMatcher(
    { uids: [], emails: [], emailDomains: ["hypemarc.com"] },
    { [ADMIN_UID_ENV]: OWNER }
  );
  const v = classifyInternalAccount(
    { uid: OWNER, email: "someone@hypemarc.com" },
    m
  );
  assert.equal(v.reason, "owner", "넓은 규칙이 좁은 규칙을 덮었다");
});

// ═══════════════════════════════════════════════════════════════════════════
// 2) 목록 판정 — uid / 이메일 / 도메인
// ═══════════════════════════════════════════════════════════════════════════

test("uid 목록으로 내부를 잡고 사유가 listed_uid 다", () => {
  const m = buildInternalMatcher(
    { uids: [MELO], emails: [], emailDomains: [] },
    { [ADMIN_UID_ENV]: OWNER }
  );
  assert.deepEqual(classifyInternalAccount({ uid: MELO }, m), {
    internal: true,
    reason: "listed_uid",
  });
});

test("이메일 목록은 정규화 후 비교된다 — 대소문자·공백·+태그가 같은 사람이다", () => {
  const m = buildInternalMatcher(
    { uids: [], emails: ["Data.Gadapida@Example.COM"], emailDomains: [] },
    {}
  );
  for (const e of [
    "data.gadapida@example.com",
    "  DATA.GADAPIDA@example.com ",
    "data.gadapida+beta@example.com",
  ]) {
    const v = classifyInternalAccount({ uid: "x", email: e }, m);
    assert.equal(v.internal, true, `${e} 가 안 잡혔다`);
    assert.equal(v.reason, "listed_email");
  }
});

test("★gmail 만 점을 무시한다 — 다른 도메인에서 점을 지우면 남을 잡는다", () => {
  assert.equal(normalizeEmail("a.b@gmail.com"), "ab@gmail.com");
  assert.equal(normalizeEmail("a.b@googlemail.com"), "ab@googlemail.com");
  // hypemarc.com 은 점이 의미를 갖는다: john.kim ≠ johnkim
  assert.equal(normalizeEmail("john.kim@hypemarc.com"), "john.kim@hypemarc.com");
  assert.notEqual(
    normalizeEmail("john.kim@hypemarc.com"),
    normalizeEmail("johnkim@hypemarc.com")
  );
});

test("도메인 규칙은 도메인만 본다", () => {
  const m = buildInternalMatcher(
    { uids: [], emails: [], emailDomains: ["@HypeMarc.com", ".example.org"] },
    {}
  );
  assert.equal(
    classifyInternalAccount({ uid: "x", email: "anyone@hypemarc.com" }, m)
      .reason,
    "email_domain"
  );
  assert.equal(
    classifyInternalAccount({ uid: "x", email: "anyone@example.org" }, m)
      .reason,
    "email_domain"
  );
  // 서브도메인은 **안** 잡는다 — 넓히려면 명시적으로 넣어라.
  assert.equal(
    classifyInternalAccount({ uid: "x", email: "a@mail.hypemarc.com" }, m)
      .internal,
    false
  );
});

test("아무 규칙에도 안 걸리면 내부가 아니고 사유는 null 이다", () => {
  const m = buildInternalMatcher(EMPTY_INTERNAL_CONFIG, {
    [ADMIN_UID_ENV]: OWNER,
  });
  assert.deepEqual(
    classifyInternalAccount({ uid: "customer", email: "a@customer.com" }, m),
    { internal: false, reason: null }
  );
});

test("이메일 모양이 아니면 조용히 통과시키지 않고 판정에서 뺀다", () => {
  for (const bad of ["", "  ", "nope", "a@b", "a@@b.com", "@b.com", "a@.com"]) {
    assert.equal(normalizeEmail(bad), null, `${bad} 가 이메일로 통과했다`);
  }
  assert.equal(normalizeEmail(null), null);
  assert.equal(normalizeEmail(42), null);
  assert.equal(normalizeEmailDomain("nodot"), null);
  assert.equal(normalizeEmailDomain("a@b.com"), null);
});

// ═══════════════════════════════════════════════════════════════════════════
// 3) 설정 읽기 — env / Firestore 문서 / 합집합
// ═══════════════════════════════════════════════════════════════════════════

test("env 목록은 쉼표·공백 어느 쪽으로도 갈라진다", () => {
  assert.deepEqual(parseListEnv("a, b\nc  d,,e"), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(parseListEnv(""), []);
  assert.deepEqual(parseListEnv(undefined), []);
});

test("env 설정에 ADMIN_UID 는 섞이지 않는다 — 오너는 항상 별도 폴백이다", () => {
  const c = readInternalConfigFromEnv({
    [ADMIN_UID_ENV]: OWNER,
    [INTERNAL_UIDS_ENV]: MELO,
    [INTERNAL_EMAILS_ENV]: "a@b.com",
    [INTERNAL_EMAIL_DOMAINS_ENV]: "hypemarc.com",
  });
  assert.deepEqual(c.uids, [MELO]);
  assert.ok(!c.uids.includes(OWNER));
});

test("★Firestore 문서가 없거나 모양이 틀려도 던지지 않는다 — 빈 설정이다", () => {
  for (const bad of [null, undefined, 42, "nope", [], { uids: 7 }]) {
    const c = readInternalConfigFromDoc(bad);
    assert.deepEqual(c, EMPTY_INTERNAL_CONFIG, `${String(bad)} 가 던졌거나 샜다`);
  }
});

test("Firestore 문서는 배열도 쉼표 문자열도 받는다", () => {
  assert.deepEqual(
    readInternalConfigFromDoc({
      uids: ["u1", " u2 ", "", 7],
      emails: "a@b.com, c@d.com",
      emailDomains: ["hypemarc.com"],
    }),
    { uids: ["u1", "u2"], emails: ["a@b.com", "c@d.com"], emailDomains: ["hypemarc.com"] }
  );
});

test("★두 소스는 합집합이다 — Firestore 를 못 읽어도 env 쪽이 살아 있다", () => {
  const merged = mergeInternalConfigs(
    readInternalConfigFromEnv({ [INTERNAL_UIDS_ENV]: MELO }),
    readInternalConfigFromDoc(null)
  );
  const m = buildInternalMatcher(merged, { [ADMIN_UID_ENV]: OWNER });
  assert.equal(classifyInternalAccount({ uid: MELO }, m).internal, true);
  assert.equal(classifyInternalAccount({ uid: OWNER }, m).internal, true);
});

// ═══════════════════════════════════════════════════════════════════════════
// 4) BQ 로 나가는 형태 — 가명 배열 하나
// ═══════════════════════════════════════════════════════════════════════════

test("★내부 키는 events/링크표의 user_key 와 같은 kind·같은 솔트다", () => {
  const keys = deriveInternalUserKeys([OWNER, MELO], SALT);
  assert.deepEqual(
    keys,
    [
      pseudonymizeAnalyticsId("user", OWNER, SALT),
      pseudonymizeAnalyticsId("user", MELO, SALT),
    ]
      .map(String)
      .sort()
  );
  for (const k of keys) assert.match(k, /^us_[0-9a-f]{24}$/);
});

test("★솔트가 없으면 빈 배열이다 — 원시 uid 폴백 금지", () => {
  assert.deepEqual(deriveInternalUserKeys([OWNER, MELO], null), []);
});

test("★파생값에 원시 uid 가 한 글자도 없다", () => {
  for (const k of deriveInternalUserKeys([OWNER, MELO], SALT)) {
    assert.ok(!k.includes(OWNER));
    assert.ok(!k.includes(MELO));
  }
});

test("빈 값·중복은 조용히 정리된다", () => {
  const keys = deriveInternalUserKeys([MELO, MELO, "", "  "], SALT);
  assert.equal(keys.length, 1);
});

test("internalUidsOf 는 오너 + 목록의 uid 축만 돌려준다", () => {
  const m = buildInternalMatcher(
    { uids: [MELO], emails: ["x@y.com"], emailDomains: ["hypemarc.com"] },
    { [ADMIN_UID_ENV]: OWNER }
  );
  assert.deepEqual(internalUidsOf(m), [OWNER, MELO].sort());
});

// ═══════════════════════════════════════════════════════════════════════════
// 5) 요약 — 원시값을 한 글자도 내보내지 않는다
// ═══════════════════════════════════════════════════════════════════════════

test("★요약에 uid·이메일·도메인 원문이 없다. 개수뿐이다", () => {
  const m = buildInternalMatcher(
    { uids: [MELO], emails: ["x@hypemarc.com"], emailDomains: ["hypemarc.com"] },
    { [ADMIN_UID_ENV]: OWNER }
  );
  const s = summarizeInternalMatcher(m);
  const json = JSON.stringify(s);
  assert.ok(!json.includes(OWNER));
  assert.ok(!json.includes(MELO));
  assert.ok(!json.includes("hypemarc"));
  assert.deepEqual(s, {
    hasOwner: true,
    uidRules: 1,
    emailRules: 1,
    domainRules: 1,
    emailOnlyRules: 2,
  });
});

test("★uid 를 모르는 규칙 수를 센다 — 그만큼은 user_key 축 제외에 참여 못 한다", () => {
  const m = buildInternalMatcher(
    { uids: [], emails: ["a@b.com"], emailDomains: ["c.com", "d.com"] },
    {}
  );
  assert.equal(summarizeInternalMatcher(m).emailOnlyRules, 3);
  // 그 셋은 deriveInternalUserKeys 로 넘어가지 못한다(uid 파생이므로).
  assert.deepEqual(deriveInternalUserKeys(internalUidsOf(m), SALT), []);
});
