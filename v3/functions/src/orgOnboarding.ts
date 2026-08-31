// 온보딩 v0 — 초대·수락 순수 판정(Firebase 무의존). `orgStructure.ts` 규약으로
// index.ts 에서 떼어내 `node --test` 로 단위검증한다(티켓 cOOR4tUEEn3vAw3UFEcg).
//
// 설계 정본:
//   docs/org-onboarding-web-first-design-2026-08-31.md (#1338 §4·§5·§11 v0)
//   v3/docs/org-access-and-login-flow-2026-08-24.md    (#1205 §2.6 한 폼 두 문서 ·
//                                                       §5.3~5.5 초대 규약·접힌 문구)
//   docs/org-team-layer-design-2026-08-31.md           (#1336 — 팀은 여기 안 나온다:
//                                                       팀은 사람이 아니라 결합에 붙는다)
//
// ── ★이 모듈이 지키는 불변식 ────────────────────────────────────────────────
//
//  1) **초대 링크는 조직 URL 이 아니라 난수 토큰이다**(#1338 §5). 토큰 없이는
//     아무것도 알 수 없고, 무효 토큰의 모든 사유(오타·취소·타인 수락분)는
//     `unusable` 하나로 접힌다 — 만료·이미수락·이메일불일치는 **본인이 확실할
//     때만** 갈라 보여준다(#1205 §5.5 "구별할 수 있을 때만 구별한다").
//  2) **토큰은 문서 id 가 아니라 난수 필드다**(#1338 §5★) — 문서 id 는
//     `{orgId}_{email}` 이라 URL 에 실으면 이메일·조직이 노출된다.
//  3) **역할은 초대 문서의 값이 보존된다**(#1299 재발 방지). 접기는 손상값을
//     아래로만 접는다(모르는 조직 역할 → org_member, 모르는 프로젝트 역할 →
//     member, owner 자칭 → member) — 위로 접히는 경로는 없다.
//  4) **admin 프로젝트 초대는 owner 가 낸 것만 유효하다** — firestore.rules
//     `invitedSelfRoleMatchesInvite` 의 불변식을 서버 수락 경로에도 똑같이 둔다.
//     조용히 member 로 강등해 주지 않는다: 그 grant 는 사유와 함께 건너뛴다.
//  5) **수락은 전부 아니면 전무**다(#1338 §4). 이 모듈은 "무엇을 쓸지"의 계획만
//     내리고, 원자성은 콜러블의 단일 트랜잭션이 진다 — 계획에 실패 사유가 있으면
//     아무것도 쓰지 않는다.

import { normalizeEmail } from "./orgIdentity";
import { normalizeMemberRole, type ProjectRole } from "./githubApp";
import { normalizeOrgRole, type OrgRole } from "./orgStructure";
import { randomBytes } from "node:crypto";

// ── 컬렉션·규약 상수 ─────────────────────────────────────────────────────────

/**
 * 조직 초대 문서. ★firestore.rules 의 서버 전용 차단 블록(조직 축)에 함께
 * 묶인다 — 클라이언트 read/write 전면 차단, 접근은 콜러블뿐. 이메일 결속
 * read 게이트를 룰 문법으로 재현하지 않고 콜러블이 판정한다(#1205 §5.4 와
 * 같은 성질을 서버 코드에서).
 */
export const ORG_INVITATIONS_COLLECTION = "org_invitations";

/**
 * 프로젝트 초대는 **기존 컬렉션·기존 규약 그대로**다(#1338 §12 — "두 경로가
 * 같은 초대 문서를 본다": 웹 수락과 앱 InvitationBanner 가 같은 문서를 본다).
 */
export const PROJECT_INVITATIONS_COLLECTION = "invitations";

/** teamService.createInvitation 과 같은 7일. 두 축의 만료가 갈라지지 않게. */
export const ORG_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** `{orgId}_{소문자 이메일}` — 프로젝트 초대(`invitationDocId`)와 같은 결정적 규약. */
export function orgInvitationDocId(orgId: string, email: string): string {
  return `${orgId}_${normalizeEmail(email)}`;
}

/** teamService.invitationDocId 의 서버 미러 — 형식을 바꾸면 룰도 함께 바꿔야 한다. */
export function projectInvitationDocId(
  projectId: string,
  email: string
): string {
  return `${projectId}_${normalizeEmail(email)}`;
}

// ── 토큰 — 추측 불가 난수 (#1338 §5) ────────────────────────────────────────

/** 32바이트 = 256비트. base64url 43자. 전수 추측이 계산상 불가능한 크기. */
export const ORG_INVITE_TOKEN_BYTES = 32;
const ORG_INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateOrgInviteToken(): string {
  return randomBytes(ORG_INVITE_TOKEN_BYTES).toString("base64url");
}

/**
 * 형식이 맞는 값만 쿼리에 태운다 — 형식 밖 입력은 조회 없이 `unusable` 로
 * 접는다(무효 사유를 입력 모양으로도 구분해 주지 않는다).
 */
export function isPlausibleOrgInviteToken(raw: unknown): raw is string {
  return typeof raw === "string" && ORG_INVITE_TOKEN_PATTERN.test(raw);
}

// ── 이메일 — 결속·표시 ──────────────────────────────────────────────────────

/** 초대를 만들 수 있는 최소 모양 검사. 배달 가능성 검증이 아니라 결속 키 위생. */
export function isPlausibleInviteEmail(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  const email = raw.trim();
  if (email.length < 3 || email.length > 254 || /\s/.test(email)) return false;
  const at = email.indexOf("@");
  // 로컬·도메인 비어 있지 않고 @ 가 하나, 도메인에 점이 있다.
  return (
    at > 0 &&
    at === email.lastIndexOf("@") &&
    email.indexOf(".", at + 2) > at + 1 &&
    !email.endsWith(".")
  );
}

/**
 * 로그인 전 화면용 마스킹(`j***@hypemarc.com`). 원문 이메일은 로그인 전
 * 응답에 싣지 않는다 — 링크는 슬랙에서 전달·전달되는 물건이다(#1338 §5).
 */
export function maskInviteEmail(email: string): string {
  const normalized = normalizeEmail(email);
  const at = normalized.indexOf("@");
  if (at <= 0) return "***";
  return `${normalized[0]}***${normalized.slice(at)}`;
}

// ── 역할 접기 — 아래로만 ────────────────────────────────────────────────────

/**
 * 초대로 부여 가능한 조직 역할. ★`org_owner` 는 초대로 얻을 수 없다 —
 * owner 는 조직 생성자의 자리이고, 초대장이 승격 통로가 되면
 * `memberRoles` 의 "owner 자칭 금지" 와 같은 구멍을 조직 축에 다시 판다.
 */
export const INVITABLE_ORG_ROLES = ["org_admin", "org_member"] as const;
export type InvitableOrgRole = typeof INVITABLE_ORG_ROLES[number];

/** 생성 입력 검증용 — 미지정은 org_member, 그 외 모르는 값·org_owner 는 null(거부). */
export function normalizeInvitedOrgRole(raw: unknown): InvitableOrgRole | null {
  if (raw === undefined || raw === null) return "org_member";
  if (typeof raw !== "string") return null;
  return (INVITABLE_ORG_ROLES as readonly string[]).includes(raw)
    ? (raw as InvitableOrgRole)
    : null;
}

/**
 * 수락 시점의 저장값 접기 — ★보존이 원칙(#1299), 접기는 아래로만. 손상값·
 * `org_owner`(생성 게이트를 우회해 심어진 값)는 org_member 로 접는다.
 */
export function orgRoleFromInvitation(raw: unknown): OrgRole {
  const role = normalizeOrgRole(raw);
  if (role === null || role === "org_owner") return "org_member";
  return role;
}

// ── 초대 문서의 최소 모양 ───────────────────────────────────────────────────

export type OrgInvitationStatus =
  | "pending"
  | "accepted"
  | "revoked"
  | "expired";

export interface OrgInvitationLike {
  /** 문서 id. 본문과의 정합 검사에 쓴다(id·본문·수신자 단일 수렴). */
  docId: string;
  orgId: string;
  /** 소문자 정규화 저장. */
  invitedEmail: string;
  invitedByUid: string;
  /** 저장 원문 — 접기는 수락 시점에 한다(보존 원칙). */
  orgRole: unknown;
  status: string;
  /** null = 손상. fail-closed(만료 취급). */
  expiresAtMs: number | null;
  acceptedByUid: string | null;
  /** 한 폼 두 문서(#1205 §2.6)의 프로젝트 쪽 — 초대 시점에 체크된 프로젝트들. */
  projectIds: readonly string[];
}

/**
 * 문서 id 규약 재계산 정합 — `assertInvitationTargetsOneProject`(teamService,
 * 티켓 3YSvLFCT707GpV8FEyUp)와 같은 규율의 조직 축 판. 토큰 쿼리로 찾은
 * 문서의 id·본문이 한 (조직, 이메일) 로 수렴하지 않으면 오염이다.
 */
export function orgInvitationDocConsistent(inv: OrgInvitationLike): boolean {
  return (
    typeof inv.orgId === "string" &&
    inv.orgId.length > 0 &&
    typeof inv.invitedEmail === "string" &&
    inv.invitedEmail.length > 0 &&
    orgInvitationDocId(inv.orgId, inv.invitedEmail) === inv.docId
  );
}

// ── 생성 판정 (#1330 규율: 이미 멤버·중복 초대에 초대장을 만들지 않는다) ─────

export type OrgInviteCreateRejection =
  | "not_org_admin"
  | "personal_org_no_invites"
  | "invalid_email"
  | "invalid_org_role"
  | "already_member";

export type OrgInviteCreateDecision =
  | { ok: false; reason: OrgInviteCreateRejection }
  /** 유효한 pending 초대가 이미 있다 — 토큰을 회전하지 않고 그대로 돌려준다(멱등). */
  | { ok: true; action: "reuse" }
  /** 새로 쓴다(같은 문서 id 덮어쓰기 포함 — 만료·철회·퇴사 후 재초대는 토큰 회전). */
  | {
      ok: true;
      action: "create";
      invitedEmail: string;
      orgRole: InvitableOrgRole;
      expiresAtMs: number;
    };

export function planOrgInviteCreate(input: {
  requesterOrgRole: OrgRole | null;
  isPersonalOrg: boolean;
  rawEmail: unknown;
  rawOrgRole: unknown;
  inviteeAlreadyOrgMember: boolean;
  existing: { status: string; expiresAtMs: number | null } | null;
  nowMs: number;
}): OrgInviteCreateDecision {
  // 권한 먼저 — 비관리자에게는 이메일·멤버 여부 어떤 판정 결과도 흘리지 않는다.
  if (
    input.requesterOrgRole !== "org_owner" &&
    input.requesterOrgRole !== "org_admin"
  ) {
    return { ok: false, reason: "not_org_admin" };
  }
  // 개인 조직은 초대의 대상이 아니다(organization.ts `isPersonal` 주석 정본).
  if (input.isPersonalOrg) {
    return { ok: false, reason: "personal_org_no_invites" };
  }
  if (!isPlausibleInviteEmail(input.rawEmail)) {
    return { ok: false, reason: "invalid_email" };
  }
  const orgRole = normalizeInvitedOrgRole(input.rawOrgRole);
  if (orgRole === null) return { ok: false, reason: "invalid_org_role" };
  // ★#1330 그대로: 이미 멤버면 초대장을 또 만들지 않는다 — 수락이 현재 역할을
  //   초대장 역할로 덮을 수 있고, 있던 사람에게 초대 알림이 또 간다.
  if (input.inviteeAlreadyOrgMember) {
    return { ok: false, reason: "already_member" };
  }
  // 유효한 pending 이 있으면 재사용(더블클릭·재발급 남발이 토큰을 회전시키면
  // 먼저 전달된 링크가 조용히 죽는다). 만료·철회·수락(후 퇴사) 문서는 새로 쓴다.
  if (
    input.existing &&
    input.existing.status === "pending" &&
    input.existing.expiresAtMs !== null &&
    input.existing.expiresAtMs > input.nowMs
  ) {
    return { ok: true, action: "reuse" };
  }
  return {
    ok: true,
    action: "create",
    invitedEmail: normalizeEmail(input.rawEmail as string),
    orgRole,
    expiresAtMs: input.nowMs + ORG_INVITE_TTL_MS,
  };
}

/**
 * 한 폼 두 문서(#1205 §2.6)의 프로젝트 쪽 생성 판정 — 프로젝트 하나당 한 번.
 *
 * ★목록 강제는 호출부의 몫이 아니라 이 판정의 몫이다: 초대자가 owner/admin 이
 *   아닌 프로젝트는 무조건 거부 — 초대 폼이 조직 전체 프로젝트 열람 창구가
 *   되면 안 된다(#1205 §2.6 `intersectProjectScope` 규율).
 * ★admin 초대는 owner 만 낼 수 있다 — firestore.rules 의 invitations create
 *   게이트와 같은 불변식(서버 경로라고 문을 하나 빼지 않는다).
 */
export type ProjectInviteCreateDecision =
  | { ok: false; reason: "not_project_admin" | "admin_invite_owner_only" }
  | { ok: true; action: "skip_already_member" }
  | { ok: true; action: "reuse" }
  | { ok: true; action: "create"; role: Exclude<ProjectRole, "owner"> };

export function planProjectInviteCreate(input: {
  requesterProjectRole: ProjectRole | null;
  rawRole: unknown;
  inviteeAlreadyProjectMember: boolean;
  existing: { status: string; expiresAtMs: number | null } | null;
  nowMs: number;
}): ProjectInviteCreateDecision {
  if (
    input.requesterProjectRole !== "owner" &&
    input.requesterProjectRole !== "admin"
  ) {
    return { ok: false, reason: "not_project_admin" };
  }
  // 서버 규약 그대로 접는다: owner 자칭·모르는 값 → member (githubApp 정본).
  const role = normalizeMemberRole(input.rawRole);
  if (role === "owner") {
    // normalizeMemberRole 은 owner 를 반환하지 않지만, 타입 좁히기를 위해 남긴다.
    return { ok: false, reason: "not_project_admin" };
  }
  if (role === "admin" && input.requesterProjectRole !== "owner") {
    return { ok: false, reason: "admin_invite_owner_only" };
  }
  if (input.inviteeAlreadyProjectMember) {
    return { ok: true, action: "skip_already_member" };
  }
  if (
    input.existing &&
    input.existing.status === "pending" &&
    input.existing.expiresAtMs !== null &&
    input.existing.expiresAtMs > input.nowMs
  ) {
    return { ok: true, action: "reuse" };
  }
  return { ok: true, action: "create", role };
}

// ── 해석 판정 — 로그인 전 최소, 본인 확실할 때만 구별 ───────────────────────

export interface InviteViewer {
  uid: string;
  /** auth 토큰의 이메일. 없는 계정(익명 등)은 null. */
  email: string | null;
  emailVerified: boolean;
}

export type OrgInviteView =
  /** 오타·취소·위조·타인 수락분 — 전부 이 하나로 접힌다(존재 비노출). */
  | { state: "unusable" }
  /** ★본인(이메일 일치)일 때만 — #1205 §5.5 "구별할 수 있을 때만 구별한다". */
  | { state: "expired"; expiresAtMs: number | null }
  /** ★본인이 이미 수락한 초대 — "조직으로 이동" 안내용. */
  | { state: "already_accepted" }
  /** 유효 + 로그인 전. 화면은 최소 표시 + 로그인/가입으로 잇는다. */
  | { state: "valid"; authed: false }
  /** 유효 + 본인 로그인. canAccept=false 는 이메일 미검증(#1205 상태 4). */
  | { state: "valid"; authed: true; canAccept: boolean }
  /** 유효하지만 다른 계정 — 초대된 이메일은 응답에 싣지 않는다(#1205 §5.4). */
  | { state: "email_mismatch" };

export function resolveOrgInviteView(input: {
  invitation: OrgInvitationLike | null;
  nowMs: number;
  viewer: InviteViewer | null;
}): OrgInviteView {
  const inv = input.invitation;
  if (!inv || !orgInvitationDocConsistent(inv)) return { state: "unusable" };

  const emailMatches =
    input.viewer !== null &&
    typeof input.viewer.email === "string" &&
    normalizeEmail(input.viewer.email) === inv.invitedEmail;

  if (inv.status === "revoked") return { state: "unusable" };
  if (inv.status === "accepted") {
    return input.viewer !== null && inv.acceptedByUid === input.viewer.uid
      ? { state: "already_accepted" }
      : { state: "unusable" };
  }
  // 손상(expiresAtMs null)은 만료 취급 — 열리는 쪽으로 접지 않는다(fail-closed).
  const expired =
    inv.status === "expired" ||
    inv.expiresAtMs === null ||
    input.nowMs >= inv.expiresAtMs;
  if (inv.status !== "pending") return { state: "unusable" };
  if (expired) {
    return emailMatches
      ? { state: "expired", expiresAtMs: inv.expiresAtMs }
      : { state: "unusable" };
  }
  if (input.viewer === null) return { state: "valid", authed: false };
  if (emailMatches) {
    return {
      state: "valid",
      authed: true,
      canAccept: input.viewer.emailVerified,
    };
  }
  return { state: "email_mismatch" };
}

// ── 수락 판정 — 한 폼 두 문서를 원자로 (#1338 §4 · #1205 §2.6) ──────────────

export interface ProjectGrantContext {
  projectId: string;
  /** `invitations/{projectId}_{email}` — 취소됐으면 null. */
  invitation: {
    role: unknown;
    status: string;
    expiresAtMs: number | null;
    invitedEmail: string;
    invitedByUid: string | null;
  } | null;
  projectExists: boolean;
  projectOwnerId: string | null;
  alreadyProjectMember: boolean;
}

export type ProjectGrantSkipReason =
  | "no_invitation"
  | "not_pending"
  | "expired"
  | "email_mismatch"
  | "project_missing"
  | "already_member"
  | "admin_invite_owner_only";

export interface ProjectGrantPlan {
  projectId: string;
  /** ★초대 문서의 역할 그대로(아래로만 접은 값) — #1299 재발 방지의 본체. */
  role: Exclude<ProjectRole, "owner">;
}

export type OrgInviteAcceptRejection =
  | "unusable"
  | "expired"
  | "email_mismatch"
  | "email_unverified";

export type OrgInviteAcceptPlan =
  | { ok: false; reason: OrgInviteAcceptRejection }
  /** 본인이 이미 수락한 초대의 재클릭 — 아무것도 쓰지 않고 성공(멱등). */
  | { ok: true; noop: true; orgId: string }
  | {
      ok: true;
      noop: false;
      orgId: string;
      /** null = 이미 조직 멤버(역할을 덮지 않는다 — 강등·승격 둘 다 금지). */
      orgMemberWrite: { role: OrgRole } | null;
      grants: ProjectGrantPlan[];
      skipped: { projectId: string; reason: ProjectGrantSkipReason }[];
    };

/**
 * ★이 판정이 내리는 계획을 콜러블이 **단일 트랜잭션**으로 쓴다. 여기서 ok 가
 * 아니면 어떤 쓰기도 없다 — "가입은 됐는데 소속 없음"(반쪽 상태)은 계획
 * 단계에서 이미 불가능하고, 쓰기 단계의 반쪽은 트랜잭션이 막는다.
 */
export function planOrgInviteAccept(input: {
  invitation: OrgInvitationLike | null;
  nowMs: number;
  viewer: InviteViewer;
  alreadyOrgMember: boolean;
  projects: readonly ProjectGrantContext[];
}): OrgInviteAcceptPlan {
  const view = resolveOrgInviteView({
    invitation: input.invitation,
    nowMs: input.nowMs,
    viewer: input.viewer,
  });
  const inv = input.invitation;
  if (view.state === "already_accepted" && inv) {
    return { ok: true, noop: true, orgId: inv.orgId };
  }
  if (view.state === "unusable") return { ok: false, reason: "unusable" };
  if (view.state === "expired") return { ok: false, reason: "expired" };
  if (view.state === "email_mismatch") {
    return { ok: false, reason: "email_mismatch" };
  }
  if (view.state !== "valid" || !view.authed || !inv) {
    // valid+authed:false 는 viewer 를 준 이상 도달 불가 — 방어적으로 닫는다.
    return { ok: false, reason: "unusable" };
  }
  if (!view.canAccept) return { ok: false, reason: "email_unverified" };

  const grants: ProjectGrantPlan[] = [];
  const skipped: { projectId: string; reason: ProjectGrantSkipReason }[] = [];
  for (const ctx of input.projects) {
    const pInv = ctx.invitation;
    if (!pInv) {
      skipped.push({ projectId: ctx.projectId, reason: "no_invitation" });
      continue;
    }
    if (normalizeEmail(pInv.invitedEmail) !== inv.invitedEmail) {
      skipped.push({ projectId: ctx.projectId, reason: "email_mismatch" });
      continue;
    }
    if (pInv.status !== "pending") {
      skipped.push({ projectId: ctx.projectId, reason: "not_pending" });
      continue;
    }
    if (pInv.expiresAtMs === null || input.nowMs >= pInv.expiresAtMs) {
      skipped.push({ projectId: ctx.projectId, reason: "expired" });
      continue;
    }
    if (!ctx.projectExists) {
      skipped.push({ projectId: ctx.projectId, reason: "project_missing" });
      continue;
    }
    if (ctx.alreadyProjectMember) {
      // 역할 문서를 건드리지 않는다 — 기존 멤버의 역할 변경은 updateMemberRole
      // 의 소관이지 초대 수락의 부수효과가 아니다(#1330 과 같은 결).
      skipped.push({ projectId: ctx.projectId, reason: "already_member" });
      continue;
    }
    const role = normalizeMemberRole(pInv.role);
    if (role === "owner") {
      // normalizeMemberRole 은 owner 를 내지 않는다 — 타입 좁히기용 방어선.
      skipped.push({ projectId: ctx.projectId, reason: "not_pending" });
      continue;
    }
    // ★rules `invitedSelfRoleMatchesInvite` 의 두 번째 문과 동일: admin 은
    //   owner 가 낸 초대장으로만. member 로 조용히 강등해 주지 않는다 — 역할이
    //   바뀌어 부여되는 것 자체가 #1299 부류의 조용한 균열이다.
    if (
      role === "admin" &&
      (ctx.projectOwnerId === null || pInv.invitedByUid !== ctx.projectOwnerId)
    ) {
      skipped.push({
        projectId: ctx.projectId,
        reason: "admin_invite_owner_only",
      });
      continue;
    }
    grants.push({ projectId: ctx.projectId, role });
  }

  return {
    ok: true,
    noop: false,
    orgId: inv.orgId,
    orgMemberWrite: input.alreadyOrgMember
      ? null
      : { role: orgRoleFromInvitation(inv.orgRole) },
    grants,
    skipped,
  };
}
