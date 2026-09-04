// orgOnboarding 순수 로직 단위테스트 (orgStructure.test.ts 규약).
//
// 실행:
//   cd v3/functions && npm run test:org-onboarding
//
// ★여기서 고정하는 성질(티켓 cOOR4tUEEn3vAw3UFEcg 완료 기준):
//   1) 토큰 해석 — 유효·만료·위조·타인 이메일이 각각 맞는 상태로, 무효 사유는
//      본인이 아닐 때 전부 `unusable` 하나로 접힌다(존재 비노출).
//   2) 수락 계획 — 역할 보존(#1299 재발 방지) · 재사용 차단 · 이미 멤버 멱등 ·
//      admin 초대 owner 전용 불변식.
//   3) 생성 판정 — #1330 규율(이미 멤버·유효 중복에 초대장을 만들지 않는다).
//   4) 토큰 — 추측 불가 형식·회전 규칙의 재료(형식 검사).
import test from "node:test";
import assert from "node:assert/strict";

import {
  INVITABLE_ORG_ROLES,
  checkTeamSeatForInvite,
  ORG_INVITATIONS_COLLECTION,
  ORG_INVITE_TTL_MS,
  PROJECT_INVITATIONS_COLLECTION,
  generateOrgInviteToken,
  isPlausibleInviteEmail,
  isPlausibleOrgInviteToken,
  maskInviteEmail,
  normalizeInvitedOrgRole,
  orgInvitationDocConsistent,
  orgInvitationDocId,
  orgRoleFromInvitation,
  ORG_INVITE_REUSE_WINDOW_MS,
  planOrgInviteAccept,
  planOrgInviteCreate,
  planOrgInviteRevoke,
  planProjectInviteCreate,
  planProjectMembershipChange,
  projectInvitationDocId,
  resolveOrgInviteView,
  sanitizeInvitationGitRemoteUrl,
  type OrgInvitationLike,
  type ProjectGrantContext,
} from "./orgOnboarding";

const NOW = Date.UTC(2026, 7, 31, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

function pendingInvitation(
  overrides: Partial<OrgInvitationLike> = {}
): OrgInvitationLike {
  const orgId = overrides.orgId ?? "org-acme";
  const invitedEmail = overrides.invitedEmail ?? "dev@acme.com";
  return {
    docId: orgInvitationDocId(orgId, invitedEmail),
    orgId,
    invitedEmail,
    invitedByUid: "uid-admin",
    orgRole: "org_member",
    status: "pending",
    expiresAtMs: NOW + 3 * DAY,
    acceptedByUid: null,
    projectIds: [],
    ...overrides,
  };
}

const INVITEE = { uid: "uid-dev", email: "dev@acme.com", emailVerified: true };
/** 초대 대상이 아닌 로그인 사용자 — 무효 사유가 접히는지 확인하는 데 쓴다. */
const OTHER_VIEWER = {
  uid: "uid-other",
  email: "other@acme.com",
  emailVerified: true,
};

// ── 컬렉션·규약 상수 ─────────────────────────────────────────────────────────

test("컬렉션 이름 — 조직 초대는 신설, 프로젝트 초대는 기존 컬렉션 그대로", () => {
  assert.equal(ORG_INVITATIONS_COLLECTION, "org_invitations");
  assert.equal(PROJECT_INVITATIONS_COLLECTION, "invitations");
});

// ── gitRemoteUrl 정화 (티켓 8a2ni2GiTnNpNb7HbMyJ) ──────────────────────────
//
// createProjectInvitation 콜러블이 클라 인자를 그대로 저장하지 않는지 고정
// 한다 — v3/electron/git-url-safety.ts 의 미러이므로 크레덴셜 제거 성질이
// 갈라지면 팀 전원이 읽는 초대 문서로 샌다.

test("sanitizeInvitationGitRemoteUrl: 문자열이 아니거나 빈 값은 null", () => {
  assert.equal(sanitizeInvitationGitRemoteUrl(undefined), null);
  assert.equal(sanitizeInvitationGitRemoteUrl(null), null);
  assert.equal(sanitizeInvitationGitRemoteUrl(42), null);
  assert.equal(sanitizeInvitationGitRemoteUrl(""), null);
  assert.equal(sanitizeInvitationGitRemoteUrl("   "), null);
});

test("sanitizeInvitationGitRemoteUrl: 과도하게 긴 값은 null (2048자 초과)", () => {
  const huge = `https://github.com/${"a".repeat(2100)}/repo`;
  assert.equal(sanitizeInvitationGitRemoteUrl(huge), null);
});

test("sanitizeInvitationGitRemoteUrl: https 크레덴셜(oauth2 토큰 포함)을 벗긴다", () => {
  assert.equal(
    sanitizeInvitationGitRemoteUrl("https://oauth2:ghp_secret@github.com/acme/repo.git"),
    "https://github.com/acme/repo.git",
  );
  assert.equal(
    sanitizeInvitationGitRemoteUrl("https://x-access-token:ghs_secret@github.com/acme/repo.git"),
    "https://github.com/acme/repo.git",
  );
});

test("sanitizeInvitationGitRemoteUrl: ssh 는 계정명(git@)은 남기고 password 만 뗀다", () => {
  assert.equal(
    sanitizeInvitationGitRemoteUrl("ssh://git:secret@github.com/acme/repo.git"),
    "ssh://git@github.com/acme/repo.git",
  );
  // scp 축약형도 마찬가지 — git@host:path 는 계정명이라 살아 있어야 clone 이 된다.
  assert.equal(
    sanitizeInvitationGitRemoteUrl("git@github.com:acme/repo.git"),
    "git@github.com:acme/repo.git",
  );
});

test("sanitizeInvitationGitRemoteUrl: 크레덴셜 없는 값은 그대로, github.com 외 호스트도 허용", () => {
  // 호스트를 제한하지 않는다 — RepoConnectModal 은 GitHub 외 원격도 clone 한다.
  assert.equal(
    sanitizeInvitationGitRemoteUrl("https://gitlab.com/acme/repo.git"),
    "https://gitlab.com/acme/repo.git",
  );
  assert.equal(
    sanitizeInvitationGitRemoteUrl("  https://github.com/acme/repo.git  "),
    "https://github.com/acme/repo.git",
  );
});

test("문서 id 규약 — {orgId|projectId}_{소문자 이메일} (기존 초대 규약 미러)", () => {
  assert.equal(
    orgInvitationDocId("org1", " Dev@Acme.COM "),
    "org1_dev@acme.com"
  );
  assert.equal(projectInvitationDocId("p1", "A@B.co"), "p1_a@b.co");
});

test("만료는 프로젝트 초대와 같은 7일", () => {
  assert.equal(ORG_INVITE_TTL_MS, 7 * DAY);
});

// ── 1) 토큰 — 추측 불가 형식 ────────────────────────────────────────────────

test("토큰 — base64url 43자(256비트), 생성마다 다르다", () => {
  const a = generateOrgInviteToken();
  const b = generateOrgInviteToken();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
  assert.ok(isPlausibleOrgInviteToken(a));
});

test("토큰 형식 밖 입력은 조회 없이 접힌다 — 문서 id·이메일·짧은 값·비문자열", () => {
  assert.equal(isPlausibleOrgInviteToken("org-acme_dev@acme.com"), false);
  assert.equal(isPlausibleOrgInviteToken("short"), false);
  assert.equal(isPlausibleOrgInviteToken(""), false);
  assert.equal(isPlausibleOrgInviteToken(null), false);
  assert.equal(isPlausibleOrgInviteToken(123), false);
  // 43자라도 base64url 밖 문자가 섞이면 거부.
  assert.equal(isPlausibleOrgInviteToken("!".repeat(43)), false);
});

test("이메일 마스킹 — 로그인 전 응답에는 원문 대신 이것만 실린다", () => {
  assert.equal(maskInviteEmail("John.Kim@Hypemarc.com"), "j***@hypemarc.com");
  assert.equal(maskInviteEmail("깨진값"), "***");
});

test("이메일 최소 모양 검사", () => {
  assert.equal(isPlausibleInviteEmail("dev@acme.com"), true);
  assert.equal(isPlausibleInviteEmail("  dev@acme.com  "), true);
  assert.equal(isPlausibleInviteEmail("dev@acme"), false);
  assert.equal(isPlausibleInviteEmail("@acme.com"), false);
  assert.equal(isPlausibleInviteEmail("a b@acme.com"), false);
  assert.equal(isPlausibleInviteEmail("dev@acme.com."), false);
  assert.equal(isPlausibleInviteEmail(""), false);
  assert.equal(isPlausibleInviteEmail(undefined), false);
});

// ── 조직 역할 접기 — 아래로만 ───────────────────────────────────────────────

test("초대 가능 조직 역할에 org_owner 가 없다 — 초대장은 승격 통로가 아니다", () => {
  assert.deepEqual([...INVITABLE_ORG_ROLES], ["org_admin", "org_member"]);
  assert.equal(normalizeInvitedOrgRole("org_owner"), null);
  assert.equal(normalizeInvitedOrgRole("org_admin"), "org_admin");
  assert.equal(normalizeInvitedOrgRole(undefined), "org_member");
  assert.equal(normalizeInvitedOrgRole("nonsense"), null);
});

test("수락 시 저장값 접기 — 보존이 원칙, 손상·org_owner 는 org_member 로만 접힌다", () => {
  assert.equal(orgRoleFromInvitation("org_admin"), "org_admin");
  assert.equal(orgRoleFromInvitation("org_member"), "org_member");
  assert.equal(orgRoleFromInvitation("org_owner"), "org_member");
  assert.equal(orgRoleFromInvitation("garbage"), "org_member");
  assert.equal(orgRoleFromInvitation(undefined), "org_member");
});

// ── 문서 정합 — id·본문·수신자 단일 수렴 ────────────────────────────────────

test("id·본문 정합 — 어긋난 문서(오염)는 통과하지 못한다", () => {
  assert.equal(orgInvitationDocConsistent(pendingInvitation()), true);
  assert.equal(
    orgInvitationDocConsistent(
      pendingInvitation({ docId: "other-org_dev@acme.com" })
    ),
    false
  );
  assert.equal(
    orgInvitationDocConsistent(pendingInvitation({ orgId: "" })),
    false
  );
});

// ── 2) 해석 — 유효·만료·위조·타인 이메일 ────────────────────────────────────

test("해석: 유효 + 로그인 전 → valid(authed:false) — 최소 표시만", () => {
  const view = resolveOrgInviteView({
    invitation: pendingInvitation(),
    nowMs: NOW,
    viewer: null,
  });
  assert.deepEqual(view, { state: "valid", authed: false });
});

test("해석: 유효 + 본인 로그인 → valid(canAccept), 미검증 이메일은 canAccept:false", () => {
  assert.deepEqual(
    resolveOrgInviteView({
      invitation: pendingInvitation(),
      nowMs: NOW,
      viewer: INVITEE,
    }),
    { state: "valid", authed: true, canAccept: true }
  );
  assert.deepEqual(
    resolveOrgInviteView({
      invitation: pendingInvitation(),
      nowMs: NOW,
      viewer: { ...INVITEE, emailVerified: false },
    }),
    { state: "valid", authed: true, canAccept: false }
  );
});

test("해석: 이메일 대소문자·공백은 결속을 깨지 않는다", () => {
  const view = resolveOrgInviteView({
    invitation: pendingInvitation(),
    nowMs: NOW,
    viewer: { ...INVITEE, email: " Dev@ACME.com " },
  });
  assert.equal(view.state, "valid");
});

test("해석: 타인 이메일 로그인 → email_mismatch (초대된 이메일은 응답에 없다)", () => {
  const view = resolveOrgInviteView({
    invitation: pendingInvitation(),
    nowMs: NOW,
    viewer: { uid: "uid-x", email: "other@else.com", emailVerified: true },
  });
  assert.deepEqual(view, { state: "email_mismatch" });
  // 상태 객체 어디에도 invitedEmail 이 실리지 않는다.
  assert.equal(JSON.stringify(view).includes("acme.com"), false);
});

test("해석: 위조/취소/없음 — 전부 unusable 하나로 접힌다 (존재 비노출)", () => {
  assert.deepEqual(
    resolveOrgInviteView({ invitation: null, nowMs: NOW, viewer: null }),
    { state: "unusable" }
  );
  assert.deepEqual(
    resolveOrgInviteView({
      invitation: pendingInvitation({ status: "revoked" }),
      nowMs: NOW,
      viewer: INVITEE,
    }),
    { state: "unusable" }
  );
  // 모르는 status 도 열리지 않는다(fail-closed).
  assert.deepEqual(
    resolveOrgInviteView({
      invitation: pendingInvitation({ status: "weird" }),
      nowMs: NOW,
      viewer: INVITEE,
    }),
    { state: "unusable" }
  );
});

test("해석: 만료 — 본인일 때만 expired, 남이면 unusable (§5.5 구별 규칙)", () => {
  const expired = pendingInvitation({ expiresAtMs: NOW - 1 });
  assert.deepEqual(
    resolveOrgInviteView({ invitation: expired, nowMs: NOW, viewer: INVITEE }),
    { state: "expired", expiresAtMs: NOW - 1 }
  );
  // 로그인 전 — 만료를 알려주면 "초대가 실재했다" 신호가 된다.
  assert.deepEqual(
    resolveOrgInviteView({ invitation: expired, nowMs: NOW, viewer: null }),
    { state: "unusable" }
  );
  // 타인 계정도 마찬가지.
  assert.deepEqual(
    resolveOrgInviteView({
      invitation: expired,
      nowMs: NOW,
      viewer: { uid: "uid-x", email: "other@else.com", emailVerified: true },
    }),
    { state: "unusable" }
  );
  // 손상(expiresAtMs null)은 만료 취급 — 열리는 쪽으로 접지 않는다.
  assert.equal(
    resolveOrgInviteView({
      invitation: pendingInvitation({ expiresAtMs: null }),
      nowMs: NOW,
      viewer: INVITEE,
    }).state,
    "expired"
  );
});

test("해석: 수락된 초대 — 본인이면 already_accepted, 남이면 unusable (재사용 차단)", () => {
  const accepted = pendingInvitation({
    status: "accepted",
    acceptedByUid: "uid-dev",
  });
  assert.deepEqual(
    resolveOrgInviteView({ invitation: accepted, nowMs: NOW, viewer: INVITEE }),
    { state: "already_accepted" }
  );
  assert.deepEqual(
    resolveOrgInviteView({
      invitation: accepted,
      nowMs: NOW,
      viewer: { uid: "uid-thief", email: "dev@acme.com", emailVerified: true },
    }),
    { state: "unusable" }
  );
  assert.deepEqual(
    resolveOrgInviteView({ invitation: accepted, nowMs: NOW, viewer: null }),
    { state: "unusable" }
  );
});

test("해석: id·본문 어긋난 오염 문서는 유효해 보여도 unusable", () => {
  const view = resolveOrgInviteView({
    invitation: pendingInvitation({ docId: "forged_dev@acme.com" }),
    nowMs: NOW,
    viewer: INVITEE,
  });
  assert.deepEqual(view, { state: "unusable" });
});

// ── 3) 수락 계획 — 원자성의 재료 ────────────────────────────────────────────

function grantCtx(
  overrides: Partial<ProjectGrantContext> = {}
): ProjectGrantContext {
  return {
    projectId: "p1",
    invitation: {
      role: "viewer",
      status: "pending",
      expiresAtMs: NOW + DAY,
      invitedEmail: "dev@acme.com",
      invitedByUid: "uid-admin",
    },
    projectExists: true,
    projectOwnerId: "uid-owner",
    alreadyProjectMember: false,
    ...overrides,
  };
}

test("수락: org_members 쓰기 + 프로젝트 grant 를 한 계획으로 — 역할이 보존된다(#1299)", () => {
  const plan = planOrgInviteAccept({
    invitation: pendingInvitation({ orgRole: "org_admin" }),
    nowMs: NOW,
    viewer: INVITEE,
    alreadyOrgMember: false,
    projects: [grantCtx()],
  });
  assert.ok(plan.ok && !plan.noop);
  if (plan.ok && !plan.noop) {
    assert.equal(plan.orgId, "org-acme");
    // ★조직 역할 보존 — org_member 로 접히지 않는다.
    assert.deepEqual(plan.orgMemberWrite, { role: "org_admin" });
    // ★프로젝트 역할 보존 — viewer 초대는 viewer 로 못 박힌다(member 아님).
    assert.deepEqual(plan.grants, [{ projectId: "p1", role: "viewer" }]);
    assert.deepEqual(plan.skipped, []);
  }
});

test("수락: 거부 사유가 있으면 계획에 쓰기가 전혀 없다 — 반쪽 상태의 원천 봉쇄", () => {
  for (const [invitation, viewer, reason] of [
    [null, INVITEE, "unusable"],
    [pendingInvitation({ status: "revoked" }), INVITEE, "unusable"],
    [pendingInvitation({ expiresAtMs: NOW - 1 }), INVITEE, "expired"],
    [
      pendingInvitation(),
      { uid: "uid-x", email: "other@else.com", emailVerified: true },
      "email_mismatch",
    ],
    [
      pendingInvitation(),
      { ...INVITEE, emailVerified: false },
      "email_unverified",
    ],
  ] as const) {
    const plan = planOrgInviteAccept({
      invitation,
      nowMs: NOW,
      viewer,
      alreadyOrgMember: false,
      projects: [grantCtx()],
    });
    assert.deepEqual(plan, { ok: false, reason });
  }
});

test("수락: 본인 재클릭(이미 수락) → noop 성공 — 멱등, 타인은 위 unusable 로 차단", () => {
  const plan = planOrgInviteAccept({
    invitation: pendingInvitation({
      status: "accepted",
      acceptedByUid: "uid-dev",
    }),
    nowMs: NOW,
    viewer: INVITEE,
    alreadyOrgMember: true,
    projects: [],
  });
  assert.deepEqual(plan, { ok: true, noop: true, orgId: "org-acme" });
});

test("수락: 이미 조직 멤버면 org_members 를 덮지 않는다 — 강등·승격 둘 다 금지", () => {
  const plan = planOrgInviteAccept({
    invitation: pendingInvitation({ orgRole: "org_admin" }),
    nowMs: NOW,
    viewer: INVITEE,
    alreadyOrgMember: true,
    projects: [],
  });
  assert.ok(plan.ok && !plan.noop);
  if (plan.ok && !plan.noop) assert.equal(plan.orgMemberWrite, null);
});

test("수락: 프로젝트 grant 의 개별 결격은 건너뛰고 사유를 남긴다 — 수락 전체를 죽이지 않는다", () => {
  const plan = planOrgInviteAccept({
    invitation: pendingInvitation(),
    nowMs: NOW,
    viewer: INVITEE,
    alreadyOrgMember: false,
    projects: [
      grantCtx({
        projectId: "p-ok",
        invitation: { ...grantCtx().invitation!, role: "member" },
      }),
      grantCtx({ projectId: "p-cancelled", invitation: null }),
      grantCtx({
        projectId: "p-expired",
        invitation: { ...grantCtx().invitation!, expiresAtMs: NOW - 1 },
      }),
      grantCtx({
        projectId: "p-used",
        invitation: { ...grantCtx().invitation!, status: "accepted" },
      }),
      grantCtx({
        projectId: "p-gone",
        projectExists: false,
        projectOwnerId: null,
      }),
      grantCtx({ projectId: "p-already", alreadyProjectMember: true }),
      grantCtx({
        projectId: "p-other-email",
        invitation: { ...grantCtx().invitation!, invitedEmail: "else@x.co" },
      }),
    ],
  });
  assert.ok(plan.ok && !plan.noop);
  if (plan.ok && !plan.noop) {
    assert.deepEqual(plan.grants, [{ projectId: "p-ok", role: "member" }]);
    assert.deepEqual(
      plan.skipped.map((s) => [s.projectId, s.reason]),
      [
        ["p-cancelled", "no_invitation"],
        ["p-expired", "expired"],
        ["p-used", "not_pending"],
        ["p-gone", "project_missing"],
        ["p-already", "already_member"],
        ["p-other-email", "email_mismatch"],
      ]
    );
  }
});

test("수락: admin 초대는 owner 가 낸 것만 — 아니면 member 강등이 아니라 skip (rules 두 번째 문 미러)", () => {
  const byOwner = grantCtx({
    invitation: {
      ...grantCtx().invitation!,
      role: "admin",
      invitedByUid: "uid-owner",
    },
  });
  const byAdmin = grantCtx({
    projectId: "p2",
    invitation: {
      ...grantCtx().invitation!,
      role: "admin",
      invitedByUid: "uid-admin",
    },
  });
  const plan = planOrgInviteAccept({
    invitation: pendingInvitation(),
    nowMs: NOW,
    viewer: INVITEE,
    alreadyOrgMember: false,
    projects: [byOwner, byAdmin],
  });
  assert.ok(plan.ok && !plan.noop);
  if (plan.ok && !plan.noop) {
    assert.deepEqual(plan.grants, [{ projectId: "p1", role: "admin" }]);
    assert.deepEqual(plan.skipped, [
      { projectId: "p2", reason: "admin_invite_owner_only" },
    ]);
  }
});

test("수락: 프로젝트 초대의 owner 자칭·손상 역할은 member 로만 접힌다", () => {
  const plan = planOrgInviteAccept({
    invitation: pendingInvitation(),
    nowMs: NOW,
    viewer: INVITEE,
    alreadyOrgMember: false,
    projects: [
      grantCtx({ invitation: { ...grantCtx().invitation!, role: "garbage" } }),
    ],
  });
  assert.ok(plan.ok && !plan.noop);
  if (plan.ok && !plan.noop) {
    assert.deepEqual(plan.grants, [{ projectId: "p1", role: "member" }]);
  }
});

// ── 4) 생성 판정 — #1330 규율 ───────────────────────────────────────────────

test("생성: org_admin 미만·개인 조직·잘못된 입력은 거부", () => {
  const base = {
    isPersonalOrg: false,
    rawEmail: "dev@acme.com",
    rawOrgRole: undefined,
    inviteeAlreadyOrgMember: false,
    existing: null,
    nowMs: NOW,
  };
  assert.deepEqual(
    planOrgInviteCreate({ ...base, requesterOrgRole: "org_member" }),
    { ok: false, reason: "not_org_admin" }
  );
  assert.deepEqual(planOrgInviteCreate({ ...base, requesterOrgRole: null }), {
    ok: false,
    reason: "not_org_admin",
  });
  assert.deepEqual(
    planOrgInviteCreate({
      ...base,
      requesterOrgRole: "org_owner",
      isPersonalOrg: true,
    }),
    { ok: false, reason: "personal_org_no_invites" }
  );
  assert.deepEqual(
    planOrgInviteCreate({
      ...base,
      requesterOrgRole: "org_admin",
      rawEmail: "not-an-email",
    }),
    { ok: false, reason: "invalid_email" }
  );
  assert.deepEqual(
    planOrgInviteCreate({
      ...base,
      requesterOrgRole: "org_admin",
      rawOrgRole: "org_owner",
    }),
    { ok: false, reason: "invalid_org_role" }
  );
});

test("생성: 이미 멤버면 초대장을 만들지 않는다 (#1330 그대로)", () => {
  assert.deepEqual(
    planOrgInviteCreate({
      requesterOrgRole: "org_owner",
      isPersonalOrg: false,
      rawEmail: "dev@acme.com",
      rawOrgRole: "org_member",
      inviteeAlreadyOrgMember: true,
      existing: null,
      nowMs: NOW,
    }),
    { ok: false, reason: "already_member" }
  );
});

// ── 재초대 = 토큰 회전 (티켓 3PRpIVJdyE5dUWQWwy6Y · 감사 #1378 F4) ───────────

test("생성: 방금 만든 pending 만 재사용 — 제출 더블클릭이 링크를 죽이지 않는다", () => {
  const base = {
    requesterOrgRole: "org_owner" as const,
    isPersonalOrg: false,
    rawEmail: " Dev@Acme.COM ",
    rawOrgRole: "org_admin",
    inviteeAlreadyOrgMember: false,
    nowMs: NOW,
  };
  // 창 안(방금 제출) — 같은 한 번의 행위로 보고 토큰을 회전하지 않는다.
  for (const createdAtMs of [NOW, NOW - 1000, NOW - ORG_INVITE_REUSE_WINDOW_MS]) {
    assert.deepEqual(
      planOrgInviteCreate({
        ...base,
        existing: { status: "pending", expiresAtMs: NOW + DAY, createdAtMs },
      }),
      { ok: true, action: "reuse" },
      `createdAtMs=${createdAtMs} 은 재사용 창 안이다`
    );
  }
});

test("★생성: 창 밖 재초대는 새 토큰을 발급한다 — 먼저 보낸 링크가 죽는다(F4)", () => {
  const base = {
    requesterOrgRole: "org_owner" as const,
    isPersonalOrg: false,
    rawEmail: " Dev@Acme.COM ",
    rawOrgRole: "org_admin",
    inviteeAlreadyOrgMember: false,
    nowMs: NOW,
  };
  const created = {
    ok: true,
    action: "create",
    invitedEmail: "dev@acme.com",
    orgRole: "org_admin",
    expiresAtMs: NOW + ORG_INVITE_TTL_MS,
  };
  for (const existing of [
    null,
    // ★F4 의 본체: 아직 만료 전인 pending 이라도, 창 밖 재초대는 회전한다.
    {
      status: "pending",
      expiresAtMs: NOW + DAY,
      createdAtMs: NOW - ORG_INVITE_REUSE_WINDOW_MS - 1,
    },
    { status: "pending", expiresAtMs: NOW + DAY, createdAtMs: NOW - 3 * DAY },
    // createdAt 손상·미래 시각 — 판단이 안 서면 옛 링크를 살려 두지 않는다.
    { status: "pending", expiresAtMs: NOW + DAY, createdAtMs: null },
    { status: "pending", expiresAtMs: NOW + DAY, createdAtMs: NOW + DAY },
    // 기존 규율 그대로: 만료·철회·수락(후 퇴사) 문서도 새로 쓴다.
    { status: "pending", expiresAtMs: NOW - 1, createdAtMs: NOW - 1000 },
    { status: "pending", expiresAtMs: null, createdAtMs: NOW - 1000 },
    { status: "revoked", expiresAtMs: NOW + DAY, createdAtMs: NOW - 1000 },
    { status: "accepted", expiresAtMs: NOW + DAY, createdAtMs: NOW - 1000 },
  ]) {
    assert.deepEqual(
      planOrgInviteCreate({ ...base, existing }),
      created,
      `existing=${JSON.stringify(existing)} 은 새 초대여야 한다`
    );
  }
});

test("★해석·수락: 철회된 토큰으로는 가입이 거부된다 (회귀 — F4 완료 기준)", () => {
  const revoked = pendingInvitation({ status: "revoked" });
  // 본인이 로그인해 있어도 사유를 갈라 주지 않는다 — 취소는 unusable 로 접힌다.
  for (const viewer of [null, INVITEE, OTHER_VIEWER]) {
    assert.deepEqual(
      resolveOrgInviteView({ invitation: revoked, nowMs: NOW, viewer }),
      { state: "unusable" }
    );
  }
  // 수락 계획도 같은 판정 — 어떤 쓰기 계획도 나오지 않는다(멤버십 생성 없음).
  assert.deepEqual(
    planOrgInviteAccept({
      invitation: revoked,
      nowMs: NOW,
      viewer: INVITEE,
      alreadyOrgMember: false,
      projects: [],
    }),
    { ok: false, reason: "unusable" }
  );
});

test("★수락: 철회된 프로젝트 초대는 grant 되지 않는다 (한 폼 두 문서의 철회 쪽)", () => {
  const plan = planOrgInviteAccept({
    invitation: pendingInvitation({ projectIds: ["p-1"] }),
    nowMs: NOW,
    viewer: INVITEE,
    alreadyOrgMember: false,
    projects: [
      {
        projectId: "p-1",
        invitation: {
          role: "admin",
          status: "revoked",
          expiresAtMs: NOW + DAY,
          invitedEmail: "dev@acme.com",
          invitedByUid: "uid-admin",
        },
        projectExists: true,
        projectOwnerId: "uid-admin",
        alreadyProjectMember: false,
      },
    ],
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.ok && plan.noop, false);
  if (!plan.ok || plan.noop) return;
  assert.deepEqual(plan.grants, []);
  assert.deepEqual(plan.skipped, [{ projectId: "p-1", reason: "not_pending" }]);
});

test("★철회: 조직 관리자만 취소할 수 있다 (권한 — F4 완료 기준)", () => {
  const invitation = pendingInvitation({ projectIds: ["p-1", "p-2"] });
  for (const requesterOrgRole of ["org_owner", "org_admin"] as const) {
    assert.deepEqual(
      planOrgInviteRevoke({ requesterOrgRole, invitation }),
      {
        ok: true,
        action: "revoke",
        orgId: "org-acme",
        invitedEmail: "dev@acme.com",
        projectIds: ["p-1", "p-2"],
      },
      `${requesterOrgRole} 는 철회할 수 있다`
    );
  }
  // 멤버·비멤버(역할 없음)·손상 역할 — 전부 거부.
  for (const requesterOrgRole of ["org_member", null] as const) {
    assert.deepEqual(
      planOrgInviteRevoke({ requesterOrgRole, invitation }),
      { ok: false, reason: "not_org_admin" }
    );
  }
});

test("철회: 권한 판정이 존재 판정보다 먼저다 — 비관리자에게 존재를 흘리지 않는다", () => {
  assert.deepEqual(
    planOrgInviteRevoke({ requesterOrgRole: "org_member", invitation: null }),
    { ok: false, reason: "not_org_admin" }
  );
});

test("철회: 없는 초대·오염 문서는 not_found, 수락된 초대는 멤버 제거의 소관", () => {
  assert.deepEqual(
    planOrgInviteRevoke({ requesterOrgRole: "org_admin", invitation: null }),
    { ok: false, reason: "not_found" }
  );
  assert.deepEqual(
    planOrgInviteRevoke({
      requesterOrgRole: "org_admin",
      invitation: pendingInvitation({ docId: "org-other_dev@acme.com" }),
    }),
    { ok: false, reason: "not_found" }
  );
  assert.deepEqual(
    planOrgInviteRevoke({
      requesterOrgRole: "org_admin",
      invitation: pendingInvitation({ status: "accepted" }),
    }),
    { ok: false, reason: "already_accepted" }
  );
});

test("철회: 이미 철회된 초대는 멱등 성공(동시 클릭), 만료·손상 상태도 철회 대상", () => {
  assert.deepEqual(
    planOrgInviteRevoke({
      requesterOrgRole: "org_admin",
      invitation: pendingInvitation({ status: "revoked" }),
    }),
    { ok: true, action: "noop", orgId: "org-acme" }
  );
  // 만료·손상 상태 — 링크를 확실히 죽이는 유일한 경로라 철회를 허용한다.
  for (const status of ["expired", "", "bogus"]) {
    const decision = planOrgInviteRevoke({
      requesterOrgRole: "org_admin",
      invitation: pendingInvitation({ status, expiresAtMs: null }),
    });
    assert.deepEqual(decision, {
      ok: true,
      action: "revoke",
      orgId: "org-acme",
      invitedEmail: "dev@acme.com",
      projectIds: [],
    });
  }
});

test("생성(프로젝트): admin 초대는 owner 전용, 비관리 프로젝트는 거부, 이미 멤버는 skip", () => {
  const base = {
    rawRole: "member",
    inviteeAlreadyProjectMember: false,
    existing: null,
    nowMs: NOW,
  };
  assert.deepEqual(
    planProjectInviteCreate({ ...base, requesterProjectRole: "member" }),
    { ok: false, reason: "not_project_admin" }
  );
  assert.deepEqual(
    planProjectInviteCreate({ ...base, requesterProjectRole: null }),
    { ok: false, reason: "not_project_admin" }
  );
  assert.deepEqual(
    planProjectInviteCreate({
      ...base,
      requesterProjectRole: "admin",
      rawRole: "admin",
    }),
    { ok: false, reason: "admin_invite_owner_only" }
  );
  assert.deepEqual(
    planProjectInviteCreate({
      ...base,
      requesterProjectRole: "owner",
      rawRole: "admin",
    }),
    { ok: true, action: "create", role: "admin" }
  );
  assert.deepEqual(
    planProjectInviteCreate({
      ...base,
      requesterProjectRole: "admin",
      inviteeAlreadyProjectMember: true,
    }),
    { ok: true, action: "skip_already_member" }
  );
  assert.deepEqual(
    planProjectInviteCreate({
      ...base,
      requesterProjectRole: "admin",
      existing: { status: "pending", expiresAtMs: NOW + DAY },
    }),
    { ok: true, action: "reuse" }
  );
  // owner 자칭 초대 역할은 member 로 접혀 생성된다(서버 규약 그대로).
  assert.deepEqual(
    planProjectInviteCreate({
      ...base,
      requesterProjectRole: "owner",
      rawRole: "owner",
    }),
    { ok: true, action: "create", role: "member" }
  );
});

// ── 팀 협업 엔타이틀먼트 · 좌석 강제 (티켓 gT9EXiONpzqFwY1xjc3n) ────────────

test("좌석: 팀 협업 플랜이 아니면 좌석 계산 전에 거부 (free/pro/미상)", () => {
  for (const plan of ["free", "pro", "", "unknown"]) {
    assert.deepEqual(
      checkTeamSeatForInvite({
        ownerPlan: plan,
        invitedRole: "member",
        seatsInUse: 0,
      }),
      { ok: false, reason: "no_team_entitlement" },
      plan
    );
  }
});

test("좌석: team=1석 — 오너가 이미 1석을 쓰므로 비 viewer 초대는 거부된다", () => {
  // 완료 기준 케이스: team 플랜의 좌석 초과 초대 거부.
  assert.deepEqual(
    checkTeamSeatForInvite({
      ownerPlan: "team",
      invitedRole: "member",
      seatsInUse: 1, // 오너 1석
    }),
    { ok: false, reason: "seat_limit_exceeded", includedSeats: 1, seatsInUse: 1 }
  );
  assert.deepEqual(
    checkTeamSeatForInvite({
      ownerPlan: "team",
      invitedRole: "admin",
      seatsInUse: 1,
    }),
    { ok: false, reason: "seat_limit_exceeded", includedSeats: 1, seatsInUse: 1 }
  );
});

test("좌석: viewer 는 좌석을 쓰지 않는다 — team=1석에서도 viewer 초대는 허용", () => {
  assert.deepEqual(
    checkTeamSeatForInvite({
      ownerPlan: "team",
      invitedRole: "viewer",
      seatsInUse: 1,
    }),
    { ok: true }
  );
});

test("좌석: team_plus=5석 — 5석 미만이면 허용, 차면 거부", () => {
  assert.deepEqual(
    checkTeamSeatForInvite({
      ownerPlan: "team_plus",
      invitedRole: "member",
      seatsInUse: 4, // 오너 1 + 멤버/pending 3
    }),
    { ok: true }
  );
  assert.deepEqual(
    checkTeamSeatForInvite({
      ownerPlan: "team_plus",
      invitedRole: "member",
      seatsInUse: 5,
    }),
    {
      ok: false,
      reason: "seat_limit_exceeded",
      includedSeats: 5,
      seatsInUse: 5,
    }
  );
});

test("좌석: enterprise 는 무제한", () => {
  assert.deepEqual(
    checkTeamSeatForInvite({
      ownerPlan: "enterprise",
      invitedRole: "member",
      seatsInUse: 10_000,
    }),
    { ok: true }
  );
});


// ── 멤버십 직접 변경 판정 (감사 F2, 티켓 d0x7NG8CIGmcQGBg16iy) ──────────────
//
// 여기서 고정하는 성질:
//   1) 자격 — owner/admin 만. 그 외(member·viewer·비멤버)는 전부 같은 사유로
//      접힌다(존재 비노출).
//   2) admin 부여는 owner 전용 — 초대 게이트(planProjectInviteCreate)와 같은
//      불변식. 서버 경로라고 문을 하나 빼지 않는다.
//   3) ★역할이 **항상** 못 박힌다 — 어떤 손상 입력이 와도 add 결정은
//      admin|member|viewer 중 하나를 반환한다. 이것이 "이 경로로 들어온 멤버는
//      memberRoles 문서가 없을 수 없다"의 판정층 근거다(#1299 재발 방지).
//   4) 좌석 검사가 필요한 때 — 지금 좌석을 쓰지 않는 대상(비멤버·viewer)만.
//      이미 좌석을 쓰는 멤버의 역할 재고정에 seatsInUse+1 을 물리면 정원이 찬
//      팀에서 역할 수정이 영영 막힌다(과교정).
//   5) 오너는 제거 불가 · 오너 자가치유는 역할 문서를 쓰지 않는다.

const MEMBERSHIP_BASE = {
  requesterProjectRole: "owner" as const,
  rawAction: "add" as unknown,
  targetUid: "target-uid",
  rawRole: "member" as unknown,
  projectOwnerId: "owner-uid",
  targetCurrentRole: null,
};

test("멤버십: owner/admin 만 변경할 수 있다 (그 외는 not_project_admin 하나로 접힌다)", () => {
  for (const role of ["member", "viewer", null] as const) {
    assert.deepEqual(
      planProjectMembershipChange({
        ...MEMBERSHIP_BASE,
        requesterProjectRole: role,
      }),
      { ok: false, reason: "not_project_admin" }
    );
  }
  assert.equal(
    planProjectMembershipChange({ ...MEMBERSHIP_BASE }).ok,
    true
  );
  assert.equal(
    planProjectMembershipChange({
      ...MEMBERSHIP_BASE,
      requesterProjectRole: "admin",
    }).ok,
    true
  );
});

test("멤버십: admin 부여는 owner 전용 (초대 게이트와 같은 불변식)", () => {
  assert.deepEqual(
    planProjectMembershipChange({
      ...MEMBERSHIP_BASE,
      requesterProjectRole: "admin",
      rawRole: "admin",
    }),
    { ok: false, reason: "admin_grant_owner_only" }
  );
  assert.deepEqual(
    planProjectMembershipChange({
      ...MEMBERSHIP_BASE,
      requesterProjectRole: "owner",
      rawRole: "admin",
    }),
    { ok: true, action: "add", role: "admin", seatCheckRequired: true }
  );
});

test("★멤버십: add 결정은 어떤 손상 입력에도 역할을 반드시 못 박는다 (#1299 재발 방지)", () => {
  const garbage: unknown[] = [
    undefined,
    null,
    "",
    "  ",
    "OWNER",
    "owner",
    "superadmin",
    42,
    {},
    ["admin"],
  ];
  for (const rawRole of garbage) {
    const d = planProjectMembershipChange({ ...MEMBERSHIP_BASE, rawRole });
    assert.equal(d.ok, true, `rawRole=${JSON.stringify(rawRole)}`);
    assert.equal(d.ok && d.action, "add");
    assert.ok(
      d.ok &&
        d.action === "add" &&
        (d.role === "admin" || d.role === "member" || d.role === "viewer"),
      `역할이 못 박히지 않았다: rawRole=${JSON.stringify(rawRole)}`
    );
  }
  // 'owner' 자칭은 member 로 접힌다 — 위로 접히는 경로는 없다.
  const owned = planProjectMembershipChange({
    ...MEMBERSHIP_BASE,
    rawRole: "owner",
  });
  assert.equal(owned.ok && owned.action === "add" && owned.role, "member");
});

test("멤버십: 좌석 검사는 '새 좌석을 먹는 변경'에만 필요하다", () => {
  // 비멤버 추가 → 새 좌석.
  assert.equal(
    (
      planProjectMembershipChange({
        ...MEMBERSHIP_BASE,
        targetCurrentRole: null,
      }) as { seatCheckRequired: boolean }
    ).seatCheckRequired,
    true
  );
  // viewer(0석) → member 승급도 새 좌석이다. 여기를 건너뛰면 "viewer 로 넣고
  // 승급"이 좌석 우회로가 된다.
  assert.equal(
    (
      planProjectMembershipChange({
        ...MEMBERSHIP_BASE,
        targetCurrentRole: "viewer",
      }) as { seatCheckRequired: boolean }
    ).seatCheckRequired,
    true
  );
  // 이미 좌석을 쓰는 멤버의 역할 재고정 — 새 좌석이 아니다(과교정 방지).
  for (const current of ["member", "admin"] as const) {
    assert.equal(
      (
        planProjectMembershipChange({
          ...MEMBERSHIP_BASE,
          targetCurrentRole: current,
        }) as { seatCheckRequired: boolean }
      ).seatCheckRequired,
      false,
      `targetCurrentRole=${current}`
    );
  }
});

test("멤버십: 오너는 제거할 수 없다 / 오너 자가치유는 역할 문서를 쓰지 않는다", () => {
  assert.deepEqual(
    planProjectMembershipChange({
      ...MEMBERSHIP_BASE,
      rawAction: "remove",
      targetUid: "owner-uid",
    }),
    { ok: false, reason: "cannot_remove_owner" }
  );
  // 오너를 members 에 되넣기 — role null(문서 안 씀) · 좌석 검사 없음.
  assert.deepEqual(
    planProjectMembershipChange({
      ...MEMBERSHIP_BASE,
      targetUid: "owner-uid",
      targetCurrentRole: "owner",
    }),
    { ok: true, action: "add", role: null, seatCheckRequired: false }
  );
});

test("멤버십: remove 는 비멤버여도 멱등 성공 / action·target 검증", () => {
  assert.deepEqual(
    planProjectMembershipChange({
      ...MEMBERSHIP_BASE,
      rawAction: "remove",
      targetCurrentRole: null,
    }),
    { ok: true, action: "remove" }
  );
  for (const rawAction of [undefined, null, "", "delete", "ADD", 1, {}]) {
    assert.deepEqual(
      planProjectMembershipChange({ ...MEMBERSHIP_BASE, rawAction }),
      { ok: false, reason: "invalid_action" }
    );
  }
  assert.deepEqual(
    planProjectMembershipChange({ ...MEMBERSHIP_BASE, targetUid: "" }),
    { ok: false, reason: "invalid_target" }
  );
});
