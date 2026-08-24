// orgIdentity 순수 로직 단위테스트 (analyticsPseudonym.test.ts 규약).
//
// 실행:
//   cd v3/functions && npm run test:org-identity
//
// ★이 파일의 존재 이유(ticket LJf0at2EryJ4M5iBHioi): **"도메인이 같으니 넣어주자"
// 를 빨갛게 만든다.** 그 변경은 리뷰에서 친절한 편의로 보이고, 배포된 뒤에는
// 남남이 한 조직에 묶여 서로의 감사 로그와 비용을 본다. 그리고 그때 쌓인 원장은
// 해시 체인이라 귀속을 되돌릴 수 없다.
//
// 그래서 여기서 고정하는 성질은 하나다:
//   **`decideMembershipGrant` 는 어떤 입력에도 도메인만으로 멤버십을 주지 않는다.**
import test from "node:test";
import assert from "node:assert/strict";

import {
  DOMAIN_VERIFICATION_TTL_MS,
  DOMAIN_VERIFICATION_TXT_PREFIX,
  FREE_MAIL_DOMAINS,
  LEDGER_FORBIDDEN_ORG_KEYS,
  ORG_NAME_MAX_LENGTH,
  assertNoOrgIdentityInLedgerPayload,
  buildJoinRequestReceipt,
  classifyEmail,
  classifyEmailDomain,
  decideMembershipGrant,
  defaultOrgIdForUser,
  domainVerifySaltFingerprint,
  domainVerificationToken,
  domainVerificationTxtRecord,
  emailDomainOf,
  isDomainVerificationLive,
  isPersonalOrgId,
  normalizeOrgDisplayName,
  personalOrgId,
  resolveDomainVerifySalt,
  resolveOrgDisplayNameAt,
  resolveOrgIdAt,
  suggestOrgDisplayName,
  validateOrgDisplayName,
  validateTeamOrgIntake,
  verifyDomainOwnership,
} from "./orgIdentity";

const NOW = Date.UTC(2026, 7, 24); // 합성 기준시각. Date.now() 를 쓰지 않는다.
const SALT = "test-salt-not-a-real-secret";

// ── 도메인 추출·분류 ─────────────────────────────────────────────────────────

test("emailDomainOf — trim·소문자 정규화 후 마지막 @ 뒤", () => {
  assert.equal(emailDomainOf("  John.Kim@HypeMarc.com "), "hypemarc.com");
  assert.equal(emailDomainOf("a@b@corp.co.kr"), "corp.co.kr");
});

test("emailDomainOf — 이메일이 아니면 빈 문자열(억지 판정 금지)", () => {
  for (const bad of [
    "nodomain",
    "@corp.com",
    "user@",
    "user@localhost",
    "user@.corp.com",
    "user@corp..com",
    "user@corp.com.",
    "user@코퍼레이션.com",
  ]) {
    assert.equal(emailDomainOf(bad), "", bad);
  }
});

test("classifyEmailDomain — 국내 무료 메일은 전부 public", () => {
  // ★한국 맥락이 이 목록의 존재 이유다 — 소기업·프리랜서가 업무용으로 쓴다.
  for (const domain of [
    "naver.com",
    "daum.net",
    "hanmail.net",
    "kakao.com",
    "nate.com",
    "korea.com",
    "hotmail.co.kr",
  ]) {
    assert.equal(classifyEmailDomain(domain), "public", domain);
  }
});

test("classifyEmailDomain — 글로벌 무료 메일과 일회용 메일도 public", () => {
  for (const domain of [
    "gmail.com",
    "outlook.com",
    "icloud.com",
    "yahoo.com",
    "proton.me",
    "qq.com",
    "mailinator.com",
    "yopmail.com",
  ]) {
    assert.equal(classifyEmailDomain(domain), "public", domain);
  }
});

test("classifyEmailDomain — 대학 도메인은 multi_org (무료 메일이 아니지만 한 조직도 아니다)", () => {
  assert.equal(classifyEmailDomain("snu.ac.kr"), "multi_org");
  assert.equal(classifyEmailDomain("mail.kaist.ac.kr"), "multi_org");
  assert.equal(classifyEmailDomain("stanford.edu"), "multi_org");
});

test("classifyEmailDomain — go.kr/or.kr 는 일부러 corporate (도메인 하나가 대체로 기관 하나)", () => {
  assert.equal(classifyEmailDomain("moef.go.kr"), "corporate");
  assert.equal(classifyEmailDomain("nonprofit.or.kr"), "corporate");
});

test("classifyEmailDomain — 그 외는 corporate, 빈 값은 invalid", () => {
  assert.equal(classifyEmailDomain("hypemarc.com"), "corporate");
  assert.equal(classifyEmailDomain("marblo.app"), "corporate");
  assert.equal(classifyEmailDomain(""), "invalid");
  assert.equal(classifyEmail("nodomain"), "invalid");
});

// ── (가) 이름 제안 ───────────────────────────────────────────────────────────

test("suggestOrgDisplayName — 회사 도메인은 표시명을 제안한다", () => {
  assert.equal(
    suggestOrgDisplayName("john.kim@hypemarc.com").suggested,
    "Hypemarc"
  );
  assert.equal(suggestOrgDisplayName("a@marblo.app").suggested, "Marblo");
  assert.equal(suggestOrgDisplayName("a@toss.im").suggested, "Toss");
});

test("suggestOrgDisplayName — 다단 접미사에서 등록 라벨을 고른다", () => {
  assert.equal(suggestOrgDisplayName("a@hypemarc.co.kr").suggested, "Hypemarc");
  assert.equal(
    suggestOrgDisplayName("a@mail.hypemarc.co.kr").suggested,
    "Hypemarc"
  );
  assert.equal(
    suggestOrgDisplayName("a@open-source.io").suggested,
    "Open Source"
  );
});

test("★suggestOrgDisplayName — 공개 도메인은 제안조차 하지 않는다", () => {
  // "Gmail" 을 기본값으로 넣는 것은 틀린 값을 넣는 것이고, 동시에 우리가
  // 도메인으로 조직을 가른다는 사실을 사용자에게 알려 준다.
  for (const email of [
    "a@gmail.com",
    "a@naver.com",
    "a@daum.net",
    "a@kakao.com",
    "a@outlook.com",
    "a@mailinator.com",
  ]) {
    const result = suggestOrgDisplayName(email);
    assert.equal(result.suggested, null, email);
    assert.equal(result.reason, "public_domain", email);
  }
});

test("suggestOrgDisplayName — 퓨니코드는 추측하지 않는다", () => {
  const result = suggestOrgDisplayName("a@xn--hy1b41d.com");
  assert.equal(result.suggested, null);
  assert.equal(result.reason, "punycode_domain");
});

test("suggestOrgDisplayName — 이메일이 아니면 invalid_email", () => {
  assert.equal(suggestOrgDisplayName("nope").reason, "invalid_email");
});

test("★suggestOrgDisplayName 은 멤버십을 만들지 않는다 — 제안과 가입은 다른 함수다", () => {
  // (가)와 (나)의 분리를 코드로 고정한다. 제안 결과에는 orgId 도 멤버십도 없다.
  const suggestion = suggestOrgDisplayName("john.kim@hypemarc.com");
  assert.deepEqual(Object.keys(suggestion).sort(), [
    "domain",
    "domainClass",
    "reason",
    "suggested",
  ]);
});

// ── 표시명 검증 ──────────────────────────────────────────────────────────────

test("normalizeOrgDisplayName — NFKC + 공백 접기", () => {
  assert.equal(
    normalizeOrgDisplayName("\u3000Ｍａｒｂｌｏ\u3000\u3000Inc  "),
    "Marblo Inc"
  );
});

test("validateOrgDisplayName — 정상값은 정규화해 통과", () => {
  const result = validateOrgDisplayName("  하이프마크  주식회사 ");
  assert.deepEqual(result, { ok: true, value: "하이프마크 주식회사" });
});

test("validateOrgDisplayName — 이름을 거짓말하게 만드는 문자는 거부", () => {
  // RLO 하나면 화면의 글자 순서가 뒤집힌다. 초대 메일에서 이건 피싱 재료다.
  assert.deepEqual(validateOrgDisplayName("marblo\u202Emoc.olbram"), {
    ok: false,
    reason: "invisible_or_bidi",
  });
  assert.deepEqual(validateOrgDisplayName("mar\u200Bblo"), {
    ok: false,
    reason: "invisible_or_bidi",
  });
  assert.deepEqual(validateOrgDisplayName("mar\u0007blo"), {
    ok: false,
    reason: "control_char",
  });
});

test("validateOrgDisplayName — 길이 경계", () => {
  assert.deepEqual(validateOrgDisplayName(""), { ok: false, reason: "empty" });
  assert.deepEqual(validateOrgDisplayName(" a "), {
    ok: false,
    reason: "too_short",
  });
  assert.equal(
    validateOrgDisplayName("가".repeat(ORG_NAME_MAX_LENGTH)).ok,
    true
  );
  assert.deepEqual(
    validateOrgDisplayName("가".repeat(ORG_NAME_MAX_LENGTH + 1)),
    {
      ok: false,
      reason: "too_long",
    }
  );
});

test("★표시명은 전역 유일이 아니다 — 같은 이름이 두 번 통과한다", () => {
  // 유일성 강제는 선점 시장을 만들고, 표시명은 조직 밖으로 나가지 않으므로
  // 충돌 비용이 없다. 식별은 불변 orgId 가 한다.
  const a = validateOrgDisplayName("Marblo");
  const b = validateOrgDisplayName("Marblo");
  assert.deepEqual(a, b);
  assert.equal(a.ok && a.value, "Marblo");
});

// ── 개인 조직 ────────────────────────────────────────────────────────────────

test("★개인 조직은 도메인과 무관하게 uid 에서만 나온다", () => {
  const uid = "Zx0testtesttesttesttesttest0";
  assert.equal(personalOrgId(uid), `personal_${uid}`);
  assert.equal(defaultOrgIdForUser(uid), `personal_${uid}`);
  assert.equal(isPersonalOrgId(personalOrgId(uid)), true);
  assert.equal(isPersonalOrgId("BvR2kLm9QpXs"), false);
  // 회사 메일이든 지메일이든 같은 uid 면 같은 값 — 함수가 이메일을 받지도 않는다.
  assert.equal(defaultOrgIdForUser.length, 1);
});

// ── ★(나) 멤버십 — 자동 가입 없음 ───────────────────────────────────────────

const CORPORATE_ORG = "BvR2kLm9QpXsT1uV3wY5";

test("★도메인이 같아도 멤버십은 생기지 않는다 — 자동 가입 없음", () => {
  // 이 티켓의 핵심 성질. 같은 회사 도메인, 검증된 이메일, 그래도 거부다.
  const decision = decideMembershipGrant({
    email: "newbie@hypemarc.com",
    emailVerified: true,
    orgId: CORPORATE_ORG,
    nowMs: NOW,
  });
  assert.deepEqual(decision, { granted: false, reason: "no_invitation" });
});

test("★도메인이 검증된 조직이어도 도메인만으로는 멤버십이 없다", () => {
  // 검증은 '합류 요청 창구를 열 자격' 이지 '가입 자격' 이 아니다.
  const binding = {
    orgId: CORPORATE_ORG,
    domain: "hypemarc.com",
    verifiedAtMs: NOW - 1000,
    joinRequestsEnabled: true,
  };
  assert.equal(isDomainVerificationLive(binding, NOW), true);
  const decision = decideMembershipGrant({
    email: "newbie@hypemarc.com",
    emailVerified: true,
    orgId: binding.orgId,
    nowMs: NOW,
  });
  assert.equal(decision.granted, false);
});

test("★공개 도메인 다수가 서로 자동 결합되지 않는다 (데이터 유출 시나리오)", () => {
  // 지메일·네이버 사용자 여럿이 같은 조직에 묶이는 일이 없어야 한다.
  for (const email of ["a@gmail.com", "b@gmail.com", "c@naver.com"]) {
    const decision = decideMembershipGrant({
      email,
      emailVerified: true,
      orgId: CORPORATE_ORG,
      nowMs: NOW,
    });
    assert.equal(decision.granted, false, email);
  }
});

test("멤버십은 초대로 생긴다", () => {
  const decision = decideMembershipGrant({
    email: "Newbie@Hypemarc.com",
    emailVerified: true,
    orgId: CORPORATE_ORG,
    invitation: {
      invitedEmail: "newbie@hypemarc.com",
      orgId: CORPORATE_ORG,
      expiresAtMs: NOW + 1000,
    },
    nowMs: NOW,
  });
  assert.deepEqual(decision, { granted: true, path: "invitation" });
});

test("멤버십은 관리자 승인으로도 생긴다 — 그 둘이 전부다", () => {
  const decision = decideMembershipGrant({
    email: "newbie@hypemarc.com",
    emailVerified: true,
    orgId: CORPORATE_ORG,
    adminApproved: true,
    nowMs: NOW,
  });
  assert.deepEqual(decision, { granted: true, path: "admin_approval" });
});

test("초대 — 다른 사람 앞으로 온 초대는 쓸 수 없다", () => {
  const decision = decideMembershipGrant({
    email: "attacker@hypemarc.com",
    emailVerified: true,
    orgId: CORPORATE_ORG,
    invitation: {
      invitedEmail: "victim@hypemarc.com",
      orgId: CORPORATE_ORG,
      expiresAtMs: NOW + 1000,
    },
    nowMs: NOW,
  });
  assert.deepEqual(decision, {
    granted: false,
    reason: "invitation_email_mismatch",
  });
});

test("초대 — 만료된 초대는 거부", () => {
  const decision = decideMembershipGrant({
    email: "newbie@hypemarc.com",
    emailVerified: true,
    orgId: CORPORATE_ORG,
    invitation: {
      invitedEmail: "newbie@hypemarc.com",
      orgId: CORPORATE_ORG,
      expiresAtMs: NOW,
    },
    nowMs: NOW,
  });
  assert.deepEqual(decision, { granted: false, reason: "invitation_expired" });
});

test("초대 — 다른 조직 앞으로 온 초대는 이 조직을 열지 않는다", () => {
  const decision = decideMembershipGrant({
    email: "newbie@hypemarc.com",
    emailVerified: true,
    orgId: CORPORATE_ORG,
    invitation: {
      invitedEmail: "newbie@hypemarc.com",
      orgId: "OTHER_ORG_1234567890",
      expiresAtMs: NOW + 1000,
    },
    nowMs: NOW,
  });
  assert.deepEqual(decision, { granted: false, reason: "no_invitation" });
});

test("미검증 이메일은 초대가 있어도 거부 — 도메인 주장 자체가 증명되지 않았다", () => {
  const decision = decideMembershipGrant({
    email: "newbie@hypemarc.com",
    emailVerified: false,
    orgId: CORPORATE_ORG,
    invitation: {
      invitedEmail: "newbie@hypemarc.com",
      orgId: CORPORATE_ORG,
      expiresAtMs: NOW + 1000,
    },
    nowMs: NOW,
  });
  assert.deepEqual(decision, { granted: false, reason: "email_not_verified" });
});

test("★개인 조직은 초대로도 승인으로도 열리지 않는다", () => {
  const orgId = personalOrgId("Zx0testtesttesttesttesttest0");
  for (const extra of [
    { adminApproved: true },
    {
      invitation: {
        invitedEmail: "newbie@hypemarc.com",
        orgId,
        expiresAtMs: NOW + 1000,
      },
    },
  ]) {
    const decision = decideMembershipGrant({
      email: "newbie@hypemarc.com",
      emailVerified: true,
      orgId,
      nowMs: NOW,
      ...extra,
    });
    assert.deepEqual(decision, {
      granted: false,
      reason: "personal_org_not_joinable",
    });
  }
});

test("★자동 가입 경로는 타입에도 존재하지 않는다 — 부여 경로는 둘뿐", () => {
  // 통과 가능한 모든 입력을 훑어도 path 는 invitation/admin_approval 뿐이다.
  const paths = new Set<string>();
  for (const emailVerified of [true, false]) {
    for (const adminApproved of [true, false, undefined]) {
      for (const invitation of [
        undefined,
        {
          invitedEmail: "newbie@hypemarc.com",
          orgId: CORPORATE_ORG,
          expiresAtMs: NOW + 1000,
        },
      ]) {
        for (const email of ["newbie@hypemarc.com", "a@gmail.com"]) {
          const decision = decideMembershipGrant({
            email,
            emailVerified,
            orgId: CORPORATE_ORG,
            adminApproved,
            invitation,
            nowMs: NOW,
          });
          if (decision.granted) paths.add(decision.path);
        }
      }
    }
  }
  assert.deepEqual([...paths].sort(), ["admin_approval", "invitation"]);
});

// ── 도메인 소유 검증 ────────────────────────────────────────────────────────

test("domainVerificationTxtRecord — (orgId, domain) 쌍마다 다르다", () => {
  const a = domainVerificationTxtRecord(CORPORATE_ORG, "hypemarc.com", SALT);
  const b = domainVerificationTxtRecord(CORPORATE_ORG, "marblo.app", SALT);
  const c = domainVerificationTxtRecord(
    "OTHER_ORG_1234567890",
    "hypemarc.com",
    SALT
  );
  assert.ok(a && a.startsWith(DOMAIN_VERIFICATION_TXT_PREFIX));
  assert.notEqual(a, b);
  assert.notEqual(a, c);
});

test("domainVerificationToken — 대소문자·공백은 같은 토큰", () => {
  assert.equal(
    domainVerificationToken(CORPORATE_ORG, " HypeMarc.com ", SALT),
    domainVerificationToken(CORPORATE_ORG, "hypemarc.com", SALT)
  );
});

test("★솔트가 없으면 원시값 폴백이 아니라 null (fail-safe)", () => {
  assert.equal(
    domainVerificationToken(CORPORATE_ORG, "hypemarc.com", undefined),
    null
  );
  assert.equal(
    domainVerificationTxtRecord(CORPORATE_ORG, "hypemarc.com", undefined),
    null
  );
  assert.equal(
    verifyDomainOwnership(
      ["anything"],
      CORPORATE_ORG,
      "hypemarc.com",
      undefined
    ),
    false
  );
});

test("verifyDomainOwnership — 우리 토큰이 TXT 에 있으면 통과", () => {
  const record = domainVerificationTxtRecord(
    CORPORATE_ORG,
    "hypemarc.com",
    SALT
  );
  assert.ok(record);
  assert.equal(
    verifyDomainOwnership(
      ["v=spf1 include:_spf.google.com ~all", ` ${record} `],
      CORPORATE_ORG,
      "hypemarc.com",
      SALT
    ),
    true
  );
});

test("verifyDomainOwnership — 다른 조직의 토큰은 통과하지 않는다", () => {
  const other = domainVerificationTxtRecord(
    "OTHER_ORG_1234567890",
    "hypemarc.com",
    SALT
  );
  assert.ok(other);
  assert.equal(
    verifyDomainOwnership([other], CORPORATE_ORG, "hypemarc.com", SALT),
    false
  );
});

test("★공개·다중조직 도메인은 검증 자체를 거부한다", () => {
  for (const domain of ["gmail.com", "naver.com", "snu.ac.kr"]) {
    const record = domainVerificationTxtRecord(CORPORATE_ORG, domain, SALT);
    assert.ok(record);
    // 토큰 계산은 되지만 검증은 거부된다 — 나중에 "테스트용 우회" 가 이 문을
    // 열지 못하게 한다.
    assert.equal(
      verifyDomainOwnership([record], CORPORATE_ORG, domain, SALT),
      false,
      domain
    );
  }
});

test("★검증은 만료된다 — 도메인은 팔린다", () => {
  const binding = {
    orgId: CORPORATE_ORG,
    domain: "hypemarc.com",
    verifiedAtMs: NOW - DOMAIN_VERIFICATION_TTL_MS,
    joinRequestsEnabled: true,
  };
  assert.equal(isDomainVerificationLive(binding, NOW), false);
  assert.equal(
    isDomainVerificationLive({ ...binding, verifiedAtMs: null }, NOW),
    false
  );
  assert.equal(
    isDomainVerificationLive(
      { ...binding, verifiedAtMs: NOW - DOMAIN_VERIFICATION_TTL_MS + 1 },
      NOW
    ),
    true
  );
});

// ── 합류 요청 — 조직 존재를 누출하지 않는다 ─────────────────────────────────

const LIVE_BINDING = {
  orgId: CORPORATE_ORG,
  domain: "hypemarc.com",
  verifiedAtMs: NOW - 1000,
  joinRequestsEnabled: true,
};

test("★합류 요청 응답은 조직 존재와 무관하게 항상 같다", () => {
  const withOrg = buildJoinRequestReceipt({
    email: "a@hypemarc.com",
    emailVerified: true,
    binding: LIVE_BINDING,
    nowMs: NOW,
  });
  const withoutOrg = buildJoinRequestReceipt({
    email: "a@some-unknown-corp.com",
    emailVerified: true,
    nowMs: NOW,
  });
  const publicDomain = buildJoinRequestReceipt({
    email: "a@gmail.com",
    emailVerified: true,
    nowMs: NOW,
  });
  // 사용자에게 보이는 값이 셋 다 같다 — 경쟁사가 도메인으로 고객사를 확인할 수 없다.
  assert.equal(withOrg.userVisible, "request_received");
  assert.equal(withoutOrg.userVisible, "request_received");
  assert.equal(publicDomain.userVisible, "request_received");
  // 내부 판정만 다르다.
  assert.equal(withOrg.outcome, "submitted_to_org");
  assert.equal(withoutOrg.outcome, "discarded_no_target");
  assert.equal(publicDomain.outcome, "rejected_public_domain");
});

test("★합류 요청 응답에 조직명·orgId 가 실리지 않는다", () => {
  const receipt = buildJoinRequestReceipt({
    email: "a@hypemarc.com",
    emailVerified: true,
    binding: LIVE_BINDING,
    nowMs: NOW,
  });
  const serialized = JSON.stringify(receipt);
  assert.equal(serialized.includes(CORPORATE_ORG), false);
  assert.equal(serialized.includes("hypemarc"), false);
});

test("합류 요청 — 검증 만료·창구 꺼짐·도메인 불일치는 전부 조용히 버려진다", () => {
  const cases: ReadonlyArray<
    [string, Parameters<typeof buildJoinRequestReceipt>[0]]
  > = [
    [
      "창구 꺼짐",
      {
        email: "a@hypemarc.com",
        emailVerified: true,
        binding: { ...LIVE_BINDING, joinRequestsEnabled: false },
        nowMs: NOW,
      },
    ],
    [
      "검증 만료",
      {
        email: "a@hypemarc.com",
        emailVerified: true,
        binding: {
          ...LIVE_BINDING,
          verifiedAtMs: NOW - DOMAIN_VERIFICATION_TTL_MS - 1,
        },
        nowMs: NOW,
      },
    ],
    [
      "도메인 불일치",
      {
        email: "a@other-corp.com",
        emailVerified: true,
        binding: LIVE_BINDING,
        nowMs: NOW,
      },
    ],
  ];
  for (const [label, input] of cases) {
    const receipt = buildJoinRequestReceipt(input);
    assert.equal(receipt.userVisible, "request_received", label);
    assert.equal(receipt.outcome, "discarded_no_target", label);
  }
});

test("합류 요청 — 미검증 이메일은 접수되지 않는다", () => {
  const receipt = buildJoinRequestReceipt({
    email: "a@hypemarc.com",
    emailVerified: false,
    binding: LIVE_BINDING,
    nowMs: NOW,
  });
  assert.equal(receipt.outcome, "rejected_email_not_verified");
  assert.equal(receipt.userVisible, "request_received");
});

// ── 원장 귀속 ────────────────────────────────────────────────────────────────

test("★원장 페이로드에 조직 표시명·도메인이 있으면 write 전에 던진다", () => {
  for (const key of LEDGER_FORBIDDEN_ORG_KEYS) {
    assert.throws(
      () =>
        assertNoOrgIdentityInLedgerPayload({ params: { [key]: "Hypemarc" } }),
      /원장 페이로드에 조직 표시명/,
      key
    );
  }
});

test("원장 페이로드 — 중첩·배열 안쪽까지 본다", () => {
  assert.throws(() =>
    assertNoOrgIdentityInLedgerPayload({
      params: { items: [{ meta: { orgName: "Hypemarc" } }] },
    })
  );
});

test("원장 페이로드 — id 만 있으면 통과한다", () => {
  assert.doesNotThrow(() =>
    assertNoOrgIdentityInLedgerPayload({
      projectId: "P1",
      orgId: CORPORATE_ORG,
      params: { status: "DONE" },
    })
  );
});

test("★프로젝트↔조직 결합은 시점으로 해석된다 — 옮겨도 과거가 재귀속되지 않는다", () => {
  const bindings = [
    {
      projectId: "P1",
      orgId: "ORG_A",
      effectiveFromMs: Date.UTC(2026, 0, 1),
      recordedAtMs: Date.UTC(2026, 0, 1),
    },
    {
      projectId: "P1",
      orgId: "ORG_B",
      effectiveFromMs: Date.UTC(2026, 5, 1),
      recordedAtMs: Date.UTC(2026, 5, 1),
    },
  ];
  assert.equal(resolveOrgIdAt(bindings, "P1", Date.UTC(2025, 11, 31)), null);
  assert.equal(resolveOrgIdAt(bindings, "P1", Date.UTC(2026, 3, 1)), "ORG_A");
  assert.equal(resolveOrgIdAt(bindings, "P1", Date.UTC(2026, 6, 1)), "ORG_B");
  assert.equal(resolveOrgIdAt(bindings, "P2", NOW), null);
});

test("★잘못 붙은 귀속은 정정 행으로 고칠 수 있다 — 원장 밖이기 때문이다", () => {
  const bindings = [
    {
      projectId: "P1",
      orgId: "WRONG_ORG",
      effectiveFromMs: Date.UTC(2026, 0, 1),
      recordedAtMs: Date.UTC(2026, 0, 1),
    },
    // 같은 발효시각에 나중에 기록된 정정이 이긴다. 정정 사실은 지워지지 않는다.
    {
      projectId: "P1",
      orgId: "RIGHT_ORG",
      effectiveFromMs: Date.UTC(2026, 0, 1),
      recordedAtMs: Date.UTC(2026, 7, 24),
    },
  ];
  assert.equal(
    resolveOrgIdAt(bindings, "P1", Date.UTC(2026, 2, 1)),
    "RIGHT_ORG"
  );
  assert.equal(bindings.length, 2, "정정은 덮어쓰기가 아니라 추가다");
});

test("★이름 변경을 허용해도 과거 표기는 재현된다", () => {
  const history = [
    {
      orgId: CORPORATE_ORG,
      displayName: "하이프마크",
      effectiveFromMs: Date.UTC(2026, 0, 1),
      recordedAtMs: Date.UTC(2026, 0, 1),
    },
    {
      orgId: CORPORATE_ORG,
      displayName: "Marblo Inc.",
      effectiveFromMs: Date.UTC(2026, 5, 1),
      recordedAtMs: Date.UTC(2026, 5, 1),
    },
  ];
  assert.equal(
    resolveOrgDisplayNameAt(history, CORPORATE_ORG, Date.UTC(2026, 3, 1)),
    "하이프마크"
  );
  assert.equal(
    resolveOrgDisplayNameAt(history, CORPORATE_ORG, NOW),
    "Marblo Inc."
  );
  assert.equal(resolveOrgDisplayNameAt(history, "OTHER", NOW), null);
});

// ── 팀 요금제 입력 ───────────────────────────────────────────────────────────

test("★팀 요금제는 조직명이 비면 거부한다 — 도메인으로 조용히 채우지 않는다", () => {
  for (const empty of [null, undefined, "", "   "]) {
    assert.deepEqual(
      validateTeamOrgIntake({ displayName: empty, orgId: CORPORATE_ORG }),
      { ok: false, reason: "name_required_for_team_plan" }
    );
  }
});

test("팀 요금제 — 사람이 확인한 이름은 정규화해 통과", () => {
  assert.deepEqual(
    validateTeamOrgIntake({ displayName: " Hypemarc ", orgId: CORPORATE_ORG }),
    { ok: true, displayName: "Hypemarc", orgId: CORPORATE_ORG }
  );
});

test("팀 요금제 — 표시명 검증 실패는 그대로 전달된다", () => {
  assert.deepEqual(
    validateTeamOrgIntake({
      displayName: "a\u202Eb",
      orgId: CORPORATE_ORG,
    }),
    { ok: false, reason: "invisible_or_bidi" }
  );
});

// ── 환경변수 ─────────────────────────────────────────────────────────────────

test("resolveDomainVerifySalt — 없거나 빈 문자열이면 undefined", () => {
  assert.equal(resolveDomainVerifySalt({} as NodeJS.ProcessEnv), undefined);
  assert.equal(
    resolveDomainVerifySalt({
      ORG_DOMAIN_VERIFY_SALT: "",
    } as NodeJS.ProcessEnv),
    undefined
  );
  assert.equal(
    resolveDomainVerifySalt({
      ORG_DOMAIN_VERIFY_SALT: SALT,
    } as NodeJS.ProcessEnv),
    SALT
  );
});

test("★지문은 솔트를 드러내지 않는다 — 설정됐다는 사실만", () => {
  const fingerprint = domainVerifySaltFingerprint(SALT);
  assert.equal(fingerprint?.length, 8);
  assert.equal(SALT.includes(fingerprint as string), false);
  assert.equal(domainVerifySaltFingerprint(undefined), null);
});

// ── 목록 위생 ────────────────────────────────────────────────────────────────

test("공개 도메인 목록은 소문자·중복 없음", () => {
  for (const domain of FREE_MAIL_DOMAINS) {
    assert.equal(domain, domain.toLowerCase(), domain);
    assert.equal(domain.includes("@"), false, domain);
  }
});
