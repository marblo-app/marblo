/**
 * 콜러블 계약(가정)의 클라이언트 절반 — 파서·분류기의 규약을 고정한다.
 *
 * 특히 지키는 것:
 *   - ★콜러블 미배포(bare not-found)를 "링크가 잘못됐다(invalid)" 로 접지
 *     않는다 — 서버 절반이 아직 안 떠 있을 때 유효한 초대를 쫓아내면 안 된다.
 *   - 서버 status 어휘의 이형(not_found/revoked/email_mismatch…)이 화면
 *     상태 4종+α 로 정확히 접힌다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACCEPT_INVITE_CALLABLE,
  CREATE_ORG_INVITATION_CALLABLE,
  LIST_ORG_INVITATIONS_CALLABLE,
  RESOLVE_INVITE_CALLABLE,
  REVOKE_ORG_INVITATION_CALLABLE,
  classifyCreateInviteError,
  classifyRevokeInviteError,
  classifyInviteCallableError,
  classifyOrgIntakeError,
  hasNonPersonalOrg,
  isPlausibleEmail,
  isPlausibleInviteToken,
  joinPath,
  normalizeOrgRoleKey,
  parseAcceptInviteData,
  parseCreateOrgInvitationData,
  parseCreateOrganizationData,
  parseOrgInvitationList,
  parseResolveInviteData,
} from "./orgOnboarding";

// ── ★콜러블 이름 = 서버 배포 이름(#1343) — 가정 계약으로의 회귀를 막는다 ────
//
// 이 상수들이 한때 "resolveInvite"/"acceptInvite" 라는 **가정 이름**이었고,
// 그동안 /join 은 존재하지 않는 콜러블을 불러 항상 unavailable 로 떨어졌다.
// 서버 export(v3/functions/src/index.ts)와 다른 이름은 그 사고의 재발이다.

test("콜러블 이름이 서버 배포 이름과 같다", () => {
  assert.equal(RESOLVE_INVITE_CALLABLE, "resolveOrgInvitation");
  assert.equal(ACCEPT_INVITE_CALLABLE, "acceptOrgInvitation");
  assert.equal(CREATE_ORG_INVITATION_CALLABLE, "createOrgInvitation");
});

// ── parseResolveInviteData ──────────────────────────────────────────────────

const VALID_INVITE = {
  orgDisplayName: "하이프마크",
  inviterName: "김대표",
  orgRole: "org_member",
  teamName: null,
  projectName: "marblo",
  invitedEmail: "a@b.co",
  expiresAtMs: 1_800_000_000_000,
};

test("resolve: status+invite 봉투를 valid 로 읽는다", () => {
  const out = parseResolveInviteData({ status: "valid", invite: VALID_INVITE });
  assert.equal(out.kind, "valid");
  if (out.kind !== "valid") return;
  assert.equal(out.invite.orgDisplayName, "하이프마크");
  assert.equal(out.invite.orgRole, "org_member");
  assert.equal(out.invite.teamName, null);
});

test("resolve: status 없이 초대 내용만 와도 valid 로 읽는다", () => {
  const out = parseResolveInviteData(VALID_INVITE);
  assert.equal(out.kind, "valid");
});

test("resolve: 조직 표시명 없는 valid 는 valid 가 아니다 — 그릴 것이 없다", () => {
  const out = parseResolveInviteData({ status: "valid", invite: {} });
  assert.equal(out.kind, "unavailable");
});

test("resolve: 서버 어휘 이형이 화면 상태로 접힌다", () => {
  assert.equal(parseResolveInviteData({ status: "expired" }).kind, "expired");
  assert.equal(parseResolveInviteData({ status: "not_found" }).kind, "invalid");
  assert.equal(parseResolveInviteData({ status: "revoked" }).kind, "invalid");
  assert.equal(
    parseResolveInviteData({ status: "already_member" }).kind,
    "already_accepted"
  );
  assert.equal(
    parseResolveInviteData({ status: "email_mismatch" }).kind,
    "wrong_account"
  );
});

test("resolve: 만료 응답에 실린 초대 내용(만료 시각)은 보존된다", () => {
  const out = parseResolveInviteData({
    status: "expired",
    invite: VALID_INVITE,
  });
  assert.equal(out.kind, "expired");
  assert.equal(out.invite?.expiresAtMs, VALID_INVITE.expiresAtMs);
});

// ── ★서버 정본 응답(#1343) — 판별 키는 status 가 아니라 state 다 ────────────

test("resolve: 서버 정본 state 응답(로그인 전 최소 정보)을 valid 로 읽는다", () => {
  const out = parseResolveInviteData({
    state: "valid",
    authed: false,
    orgDisplayName: "하이프마크",
    orgRole: "org_admin",
    inviterName: "존킴",
    maskedInvitedEmail: "d***@h***.com",
    expiresAtMs: 1_800_000_000_000,
    projectCount: 1,
  });
  assert.equal(out.kind, "valid");
  if (out.kind !== "valid") return;
  assert.equal(out.invite.orgDisplayName, "하이프마크");
  assert.equal(out.invite.orgRole, "org_admin");
  // ★마스킹 이메일은 프리필용 invitedEmail 로 접지 않는다 — 못 쓰는 값이다.
  assert.equal(out.invite.invitedEmail, null);
});

test("resolve: 본인 로그인 응답의 projects[] 가 프로젝트 표시명으로 접힌다", () => {
  const out = parseResolveInviteData({
    state: "valid",
    authed: true,
    orgDisplayName: "하이프마크",
    projects: [
      { projectId: "p1", name: "마블로", role: "member" },
      { projectId: "p2", name: null, role: "member" },
    ],
  });
  assert.equal(out.kind, "valid");
  if (out.kind !== "valid") return;
  assert.equal(out.invite.projectName, "마블로, p2");
});

test("resolve: state 어휘가 화면 상태로 접힌다 — unusable 은 한 문구(invalid)", () => {
  assert.equal(parseResolveInviteData({ state: "unusable" }).kind, "invalid");
  assert.equal(parseResolveInviteData({ state: "expired" }).kind, "expired");
  assert.equal(
    parseResolveInviteData({ state: "email_mismatch" }).kind,
    "wrong_account"
  );
  assert.equal(
    parseResolveInviteData({ state: "already_accepted", orgId: "o1" }).kind,
    "already_accepted"
  );
});

test("resolve: 모르는 status·쓰레기 입력은 unavailable — 링크 탓을 하지 않는다", () => {
  assert.equal(
    parseResolveInviteData({ status: "banana" }).kind,
    "unavailable"
  );
  assert.equal(parseResolveInviteData(null).kind, "unavailable");
  assert.equal(parseResolveInviteData("x").kind, "unavailable");
  assert.equal(parseResolveInviteData([1]).kind, "unavailable");
});

// ── parseAcceptInviteData ───────────────────────────────────────────────────

test("accept: accepted 와 already_member 를 구분해 읽는다", () => {
  const fresh = parseAcceptInviteData({
    status: "accepted",
    orgId: "org1",
    orgDisplayName: "하이프마크",
  });
  assert.equal(fresh.kind, "accepted");
  if (fresh.kind === "accepted") {
    assert.equal(fresh.result.alreadyMember, false);
    assert.equal(fresh.result.orgId, "org1");
  }
  const again = parseAcceptInviteData({
    status: "already_member",
    orgId: "org1",
  });
  assert.equal(again.kind, "accepted");
  if (again.kind === "accepted") assert.equal(again.result.alreadyMember, true);
});

test("accept: 실패 status 는 화면 상태로, 쓰레기는 unavailable 로", () => {
  assert.equal(parseAcceptInviteData({ status: "expired" }).kind, "expired");
  assert.equal(
    parseAcceptInviteData({ status: "email_mismatch" }).kind,
    "wrong_account"
  );
  assert.equal(parseAcceptInviteData(undefined).kind, "unavailable");
});

test("accept: 서버 정본 { ok, orgId, noop } — noop 이 이미-멤버다(#1205 §5.3)", () => {
  const fresh = parseAcceptInviteData({
    ok: true,
    orgId: "org1",
    noop: false,
    granted: [],
    skipped: [],
  });
  assert.equal(fresh.kind, "accepted");
  if (fresh.kind === "accepted") {
    assert.equal(fresh.result.alreadyMember, false);
    assert.equal(fresh.result.orgId, "org1");
  }
  const again = parseAcceptInviteData({ ok: true, orgId: "org1", noop: true });
  assert.equal(again.kind, "accepted");
  if (again.kind === "accepted") assert.equal(again.result.alreadyMember, true);
  // ★모르는 모양(ok:false)을 성공으로 치지 않는다.
  assert.equal(parseAcceptInviteData({ ok: false }).kind, "unavailable");
});

// ── classifyInviteCallableError ─────────────────────────────────────────────

function err(code: string, message: string): unknown {
  return { code, message };
}

test("classify: 서버 메시지 어휘가 code 보다 먼저다", () => {
  assert.equal(
    classifyInviteCallableError(
      err("functions/failed-precondition", "invite_expired")
    ),
    "expired"
  );
  assert.equal(
    classifyInviteCallableError(err("functions/not-found", "invite_not_found")),
    "invalid"
  );
  assert.equal(
    classifyInviteCallableError(
      err("functions/failed-precondition", "already_member")
    ),
    "already_accepted"
  );
  assert.equal(
    classifyInviteCallableError(
      err("functions/permission-denied", "email_mismatch")
    ),
    "wrong_account"
  );
});

test("★classify: 콜러블 미배포(bare not-found)는 invalid 가 아니라 unavailable", () => {
  // Firebase 는 존재하지 않는 콜러블 호출에도 code 'functions/not-found' 를
  // 던진다. 그때 메시지에 초대 어휘가 없다 — 링크 탓으로 접으면 유효한
  // 초대를 들고 온 첫 사용자를 전부 쫓아내게 된다.
  assert.equal(
    classifyInviteCallableError(err("functions/not-found", "not-found")),
    "unavailable"
  );
});

test("classify: code 폴백 — permission-denied/unauthenticated/already-exists", () => {
  assert.equal(
    classifyInviteCallableError(err("functions/permission-denied", "denied")),
    "wrong_account"
  );
  assert.equal(
    classifyInviteCallableError(err("functions/unauthenticated", "x")),
    "unauthenticated"
  );
  assert.equal(
    classifyInviteCallableError(err("functions/already-exists", "x")),
    "already_accepted"
  );
  assert.equal(
    classifyInviteCallableError(new Error("network")),
    "unavailable"
  );
  assert.equal(classifyInviteCallableError(null), "unavailable");
});

// ── 조직 정보(b) — validateTeamOrgIntake 거절 어휘 매핑 ─────────────────────

// ── createOrgInvitation — 초대 생성(d)의 클라이언트 절반 ─────────────────────

test("createInvite: 성공 응답 — 링크는 서버 문자열이 아니라 토큰에서 재조립", () => {
  const out = parseCreateOrgInvitationData({
    ok: true,
    reused: false,
    joinPath: "/join/tok_abcdef123456",
    token: "tok_abcdef123456",
    expiresAtMs: 1_800_000_000_000,
    projects: [],
  });
  assert.ok(out);
  assert.equal(out.token, "tok_abcdef123456");
  assert.equal(out.joinPath, "/join/tok_abcdef123456");
  assert.equal(out.reused, false);
  assert.equal(out.expiresAtMs, 1_800_000_000_000);
});

test("createInvite: reused 플래그가 보존된다 — 먼저 준 링크가 산다는 안내용", () => {
  const out = parseCreateOrgInvitationData({
    ok: true,
    reused: true,
    token: "tok_abcdef123456",
    expiresAtMs: null,
  });
  assert.ok(out);
  assert.equal(out.reused, true);
  assert.equal(out.expiresAtMs, null);
});

test("createInvite: ok 아님·토큰 손상·쓰레기는 null — 성공으로 치지 않는다", () => {
  assert.equal(parseCreateOrgInvitationData({ ok: false }), null);
  assert.equal(
    parseCreateOrgInvitationData({ ok: true, token: "짧" }),
    null
  );
  assert.equal(parseCreateOrgInvitationData(null), null);
  assert.equal(parseCreateOrgInvitationData("x"), null);
});

test("createInvite 분류: 서버 메시지 어휘(좌석·요금제·이미 멤버)가 code 보다 먼저다", () => {
  assert.equal(
    classifyCreateInviteError(
      err(
        "functions/resource-exhausted",
        "좌석 한도를 초과해 초대를 만들 수 없습니다 (사용 중 5석 / 포함 5석): p1"
      )
    ),
    "seat_limit"
  );
  assert.equal(
    classifyCreateInviteError(
      err(
        "functions/failed-precondition",
        "팀 요금제(team/team_plus/enterprise)가 없어 이 프로젝트에는 멤버를 초대할 수 없습니다: p1"
      )
    ),
    "plan_required"
  );
  assert.equal(
    classifyCreateInviteError(
      err(
        "functions/failed-precondition",
        "이미 이 조직의 멤버입니다 — 초대장을 만들지 않았습니다"
      )
    ),
    "already_member"
  );
});

test("createInvite 분류: code 폴백 — 권한·입력·미로그인·판정불가", () => {
  assert.equal(
    classifyCreateInviteError(
      err("functions/permission-denied", "초대를 만들 권한이 없습니다")
    ),
    "permission"
  );
  assert.equal(
    classifyCreateInviteError(
      err("functions/invalid-argument", "초대를 만들 수 없습니다: invalid_email")
    ),
    "invalid"
  );
  assert.equal(
    classifyCreateInviteError(err("functions/unauthenticated", "Login required")),
    "unauthenticated"
  );
  // ★콜러블 미배포·네트워크는 입력 탓을 하지 않는다.
  assert.equal(
    classifyCreateInviteError(err("functions/not-found", "not-found")),
    "unavailable"
  );
});

test("intake: 서버 거절 어휘가 그대로 화면 상태로 접힌다", () => {
  assert.equal(
    classifyOrgIntakeError(
      err("functions/invalid-argument", "name_required_for_team_plan")
    ),
    "name_required"
  );
  assert.equal(
    classifyOrgIntakeError(err("functions/invalid-argument", "too_short")),
    "too_short"
  );
  assert.equal(
    classifyOrgIntakeError(err("functions/invalid-argument", "too_long")),
    "too_long"
  );
  assert.equal(
    classifyOrgIntakeError(err("functions/invalid-argument", "control_char")),
    "invalid_chars"
  );
  assert.equal(
    classifyOrgIntakeError(
      err("functions/invalid-argument", "invisible_or_bidi")
    ),
    "invalid_chars"
  );
  assert.equal(
    classifyOrgIntakeError(err("functions/unauthenticated", "x")),
    "unauthenticated"
  );
  assert.equal(
    classifyOrgIntakeError(err("functions/internal", "boom")),
    "unavailable"
  );
});

test("intake: createOrganization 응답 파서 — 온전할 때만 통과", () => {
  assert.deepEqual(
    parseCreateOrganizationData({ orgId: "o1", displayName: "하이프마크" }),
    { orgId: "o1", displayName: "하이프마크" }
  );
  assert.equal(parseCreateOrganizationData({ orgId: "o1" }), null);
  assert.equal(parseCreateOrganizationData("no"), null);
});

// ── getOrganizations 최소 독해 ──────────────────────────────────────────────

test("hasNonPersonalOrg: 비개인 조직이 있어야만 true", () => {
  assert.equal(
    hasNonPersonalOrg({ orgs: [{ orgId: "p", isPersonal: true }] }),
    false
  );
  assert.equal(
    hasNonPersonalOrg({
      orgs: [
        { orgId: "p", isPersonal: true },
        { orgId: "o", isPersonal: false },
      ],
    }),
    true
  );
  // 응답이 이상하면 false — 배너(조직 생성의 문)를 열어 두는 쪽으로 접는다.
  assert.equal(hasNonPersonalOrg(null), false);
  assert.equal(hasNonPersonalOrg({ orgs: "x" }), false);
});

// ── 위생 ────────────────────────────────────────────────────────────────────

test("token: 겉모양 검사 — 느슨하되 쓰레기는 거른다", () => {
  assert.equal(isPlausibleInviteToken("aA1-_9zXqQ"), true);
  assert.equal(isPlausibleInviteToken("short"), false);
  assert.equal(isPlausibleInviteToken("has space in it"), false);
  assert.equal(isPlausibleInviteToken("한글토큰은아니다"), false);
  assert.equal(isPlausibleInviteToken("x".repeat(513)), false);
});

test("joinPath 는 토큰을 인코딩한 내부 상대 경로다", () => {
  assert.equal(joinPath("abc123XY"), "/join/abc123XY");
  assert.ok(joinPath("a/b?c").startsWith("/join/"));
  assert.ok(!joinPath("a/b?c").includes("?"));
});

test("email 겉모양 검사", () => {
  assert.equal(isPlausibleEmail("a@b.co"), true);
  assert.equal(isPlausibleEmail("not-an-email"), false);
  assert.equal(isPlausibleEmail("a b@c.d"), false);
});

test("normalizeOrgRoleKey: 서버 어휘만 통과, 모르는 값은 null", () => {
  assert.equal(normalizeOrgRoleKey("org_admin"), "org_admin");
  assert.equal(normalizeOrgRoleKey("superuser"), null);
  assert.equal(normalizeOrgRoleKey(3), null);
});

// ── 대기 중 초대 · 철회(F4) — 티켓 3PRpIVJdyE5dUWQWwy6Y ─────────────────────

test("콜러블 이름 — 목록·철회도 서버 배포 이름 그대로", () => {
  assert.equal(LIST_ORG_INVITATIONS_CALLABLE, "listOrgInvitations");
  assert.equal(REVOKE_ORG_INVITATION_CALLABLE, "revokeOrgInvitation");
});

test("★목록 파서는 토큰을 실을 자리가 없다 — 서버가 줘도 화면으로 나가지 않는다", () => {
  const rows = parseOrgInvitationList({
    ok: true,
    invitations: [
      {
        invitedEmail: "dev@acme.com",
        orgRole: "org_member",
        expiresAtMs: 1_700_000_000_000,
        expired: false,
        projectCount: 2,
        // 서버가 실수로 토큰을 실어도 파서가 버린다(회귀 방지).
        token: "x".repeat(43),
      },
    ],
  });
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]).sort(), [
    "expired",
    "expiresAtMs",
    "invitedEmail",
    "orgRole",
    "projectCount",
  ]);
  assert.ok(!JSON.stringify(rows).includes("x".repeat(43)));
});

test("목록 파서는 어떤 입력에도 던지지 않고 못 읽은 행을 버린다", () => {
  for (const bad of [undefined, null, 42, "nope", [], {}, { ok: false }]) {
    assert.deepEqual(parseOrgInvitationList(bad), []);
  }
  const rows = parseOrgInvitationList({
    ok: true,
    invitations: [
      null,
      { invitedEmail: "" },
      { invitedEmail: "a@b.co", orgRole: "superuser" },
      { invitedEmail: "a@b.co", orgRole: "org_admin", projectCount: -3 },
    ],
  });
  assert.deepEqual(rows, [
    {
      invitedEmail: "a@b.co",
      orgRole: "org_admin",
      expiresAtMs: null,
      expired: false,
      projectCount: 0,
    },
  ]);
});

test("철회 실패 분류 — 관리자가 다르게 행동해야 하는 단위로만 가른다", () => {
  assert.equal(
    classifyRevokeInviteError({
      code: "functions/failed-precondition",
      message: "이미 수락된 초대입니다 — 멤버 제거로 처리해 주세요",
    }),
    "already_accepted"
  );
  assert.equal(
    classifyRevokeInviteError({ code: "functions/permission-denied" }),
    "permission"
  );
  assert.equal(
    classifyRevokeInviteError({ code: "functions/unauthenticated" }),
    "permission"
  );
  // 없는 초대(목록이 낡았을 뿐)·미배포·판정 불가는 전부 unknown.
  assert.equal(
    classifyRevokeInviteError({ code: "functions/not-found" }),
    "unknown"
  );
  assert.equal(classifyRevokeInviteError(undefined), "unknown");
});
