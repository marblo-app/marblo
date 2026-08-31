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
  classifyInviteCallableError,
  classifyOrgIntakeError,
  hasNonPersonalOrg,
  isPlausibleEmail,
  isPlausibleInviteToken,
  joinPath,
  normalizeOrgRoleKey,
  parseAcceptInviteData,
  parseCreateOrganizationData,
  parseResolveInviteData,
} from "./orgOnboarding";

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
