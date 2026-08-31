// orgStructure 순수 로직 단위테스트 (orgIdentity.test.ts 규약).
//
// 실행:
//   cd v3/functions && npm run test:org-structure
//
// ★여기서 고정하는 성질 넷(티켓 DdtAH0WUGXyVlKImxm1N 완료 기준):
//   1) 권한 게이트 — 조직 역할은 편제만 주고, 결합 쓰기는 #1336 §4.4 표 그대로.
//   2) 팀명 정규화 중복 가드 — `Platform` 과 `platform` 이 따로 생기지 않는다.
//   3) 개인 조직 예외 — displayName 필수의 예외, 그리고 팀 개념 자체의 부재.
//   4) 결합 쓰기 멱등 — 같은 (orgId, teamId) 재시도는 행을 덧붙이지 않는다.
import test from "node:test";
import assert from "node:assert/strict";

import {
  ORG_DOC_FORBIDDEN_AXIS_KEYS,
  ORG_MEMBERS_COLLECTION,
  ORG_NAME_HISTORY_COLLECTION,
  ORG_PROJECT_BINDINGS_COLLECTION,
  ORG_TEAMS_COLLECTION,
  ORGANIZATIONS_COLLECTION,
  assertOrgDocAxisPurity,
  canBindProjectToOrg,
  canManageOrgTeams,
  decideTeamCreate,
  isOrgAdminRole,
  normalizeOrgRole,
  normalizeTeamName,
  orgMemberDocId,
  planBindingWrite,
  planFirstAppLoginStamp,
  resolveBindingAt,
  resolveTeamIdAt,
  validateOrgCreate,
  type OrgProjectBindingRowLike,
  type OrgTeamLike,
} from "./orgStructure";

// ── 컬렉션 상수 — 이름이 바뀌면 룰·콜러블이 갈라진다 ─────────────────────────

test("컬렉션 5개 이름이 티켓 스키마와 일치한다", () => {
  assert.equal(ORGANIZATIONS_COLLECTION, "organizations");
  assert.equal(ORG_MEMBERS_COLLECTION, "org_members");
  assert.equal(ORG_PROJECT_BINDINGS_COLLECTION, "org_project_bindings");
  assert.equal(ORG_TEAMS_COLLECTION, "org_teams");
  assert.equal(ORG_NAME_HISTORY_COLLECTION, "org_name_history");
});

test("orgMemberDocId 는 {orgId}_{uid} 결정적 규약", () => {
  assert.equal(orgMemberDocId("org1", "uidA"), "org1_uidA");
});

// ── 1) 권한 게이트 ───────────────────────────────────────────────────────────

test("normalizeOrgRole — 모르는 값은 null 로 fail-closed (org_member 로 접지 않는다)", () => {
  assert.equal(normalizeOrgRole("org_owner"), "org_owner");
  assert.equal(normalizeOrgRole("org_admin"), "org_admin");
  assert.equal(normalizeOrgRole("org_member"), "org_member");
  assert.equal(normalizeOrgRole("owner"), null);
  assert.equal(normalizeOrgRole(""), null);
  assert.equal(normalizeOrgRole(undefined), null);
  assert.equal(normalizeOrgRole(42), null);
});

test("isOrgAdminRole / canManageOrgTeams — org_admin 이상만", () => {
  assert.equal(isOrgAdminRole("org_owner"), true);
  assert.equal(isOrgAdminRole("org_admin"), true);
  assert.equal(isOrgAdminRole("org_member"), false);
  assert.equal(isOrgAdminRole(null), false);
  assert.equal(canManageOrgTeams("org_admin"), true);
  assert.equal(canManageOrgTeams("org_member"), false);
});

test("canBindProjectToOrg — #1336 §4.4 표 그대로", () => {
  // org_admin+ 는 프로젝트 역할 없이도 결합 가능(편제는 조직 관리 권한).
  assert.equal(
    canBindProjectToOrg({ orgRole: "org_admin", projectRole: null }),
    true
  );
  assert.equal(
    canBindProjectToOrg({ orgRole: "org_owner", projectRole: "viewer" }),
    true
  );
  // 조직 멤버이면서 그 프로젝트 owner/admin 이면 가능.
  assert.equal(
    canBindProjectToOrg({ orgRole: "org_member", projectRole: "owner" }),
    true
  );
  assert.equal(
    canBindProjectToOrg({ orgRole: "org_member", projectRole: "admin" }),
    true
  );
  // 조직 멤버라도 프로젝트 member/viewer 는 불가.
  assert.equal(
    canBindProjectToOrg({ orgRole: "org_member", projectRole: "member" }),
    false
  );
  assert.equal(
    canBindProjectToOrg({ orgRole: "org_member", projectRole: "viewer" }),
    false
  );
  // ★조직 밖 사람은 프로젝트 owner 라도 불가 — 결합·팀 UI 는 조직 문맥이다.
  assert.equal(
    canBindProjectToOrg({ orgRole: null, projectRole: "owner" }),
    false
  );
});

// ── 3) 조직 생성 — displayName 필수, 개인 조직 예외 ──────────────────────────

test("validateOrgCreate — 비개인 조직은 이름 필수", () => {
  const rejected = validateOrgCreate({ orgId: "orgA", displayName: null });
  assert.deepEqual(rejected, {
    ok: false,
    reason: "name_required_for_team_plan",
  });
  const blank = validateOrgCreate({ orgId: "orgA", displayName: "   " });
  assert.deepEqual(blank, { ok: false, reason: "name_required_for_team_plan" });
  const accepted = validateOrgCreate({
    orgId: "orgA",
    displayName: "  Hypemarc  ",
  });
  assert.deepEqual(accepted, {
    ok: true,
    orgId: "orgA",
    displayName: "Hypemarc",
    isPersonal: false,
  });
});

test("validateOrgCreate — ★개인 조직(personal_<uid>)은 이름 없이 생성된다", () => {
  const personal = validateOrgCreate({
    orgId: "personal_uid123",
    displayName: null,
  });
  assert.deepEqual(personal, {
    ok: true,
    orgId: "personal_uid123",
    displayName: null,
    isPersonal: true,
  });
  // 이름을 줘도 검증만 통과하면 받는다.
  const named = validateOrgCreate({
    orgId: "personal_uid123",
    displayName: "내 작업실",
  });
  assert.deepEqual(named, {
    ok: true,
    orgId: "personal_uid123",
    displayName: "내 작업실",
    isPersonal: true,
  });
});

test("validateOrgCreate — orgId 없는 입력은 거부", () => {
  assert.deepEqual(validateOrgCreate({ orgId: "", displayName: "X팀" }), {
    ok: false,
    reason: "org_id_required",
  });
});

// ── 2) 팀명 정규화 중복 가드 ─────────────────────────────────────────────────

test("normalizeTeamName — 대소문자·공백·전각을 접는다", () => {
  assert.equal(normalizeTeamName("Platform"), "platform");
  assert.equal(normalizeTeamName("  platform  "), "platform");
  assert.equal(normalizeTeamName("Ｐｌａｔｆｏｒｍ"), "platform");
  assert.equal(normalizeTeamName("플랫폼   팀"), "플랫폼 팀");
});

test("normalizeTeamName — ★번역 동치는 접지 않는다 (다른 팀이다)", () => {
  assert.notEqual(normalizeTeamName("플랫폼"), normalizeTeamName("Platform"));
});

const TEAMS: readonly OrgTeamLike[] = [
  {
    id: "team-platform",
    orgId: "orgA",
    displayName: "platform",
    normalizedName: "platform",
  },
  {
    id: "team-archived",
    orgId: "orgA",
    displayName: "legacy",
    normalizedName: "legacy",
    archivedAtMs: 1000,
  },
];

test("decideTeamCreate — ★정규화 일치는 생성하지 않고 기존 팀을 재사용한다", () => {
  const decision = decideTeamCreate({
    rawDisplayName: "  Platform ",
    existingTeams: TEAMS,
    isPersonalOrg: false,
  });
  assert.deepEqual(decision, {
    ok: true,
    action: "reuse",
    team: TEAMS[0],
  });
});

test("decideTeamCreate — 일치가 없으면 생성 (표시명은 원문 유지, 키는 정규화)", () => {
  const decision = decideTeamCreate({
    rawDisplayName: "앱팀",
    existingTeams: TEAMS,
    isPersonalOrg: false,
  });
  assert.deepEqual(decision, {
    ok: true,
    action: "create",
    displayName: "앱팀",
    normalizedName: "앱팀",
  });
});

test("decideTeamCreate — 보관된 팀은 재사용 대상이 아니다 (새 편제로 생성)", () => {
  const decision = decideTeamCreate({
    rawDisplayName: "Legacy",
    existingTeams: TEAMS,
    isPersonalOrg: false,
  });
  assert.equal(decision.ok && decision.action, "create");
});

test("decideTeamCreate — ★개인 조직엔 팀 개념이 없다", () => {
  const decision = decideTeamCreate({
    rawDisplayName: "Platform",
    existingTeams: [],
    isPersonalOrg: true,
  });
  assert.deepEqual(decision, {
    ok: false,
    reason: "personal_org_has_no_teams",
  });
});

test("decideTeamCreate — 조직 표시명 규약 그대로 검증한다 (bidi 거부)", () => {
  const decision = decideTeamCreate({
    rawDisplayName: "team‮name",
    existingTeams: [],
    isPersonalOrg: false,
  });
  assert.deepEqual(decision, { ok: false, reason: "invisible_or_bidi" });
});

// ── 결합표 시점 해석 ─────────────────────────────────────────────────────────

const BINDINGS: readonly OrgProjectBindingRowLike[] = [
  // 3월: orgA·플랫폼팀
  {
    projectId: "p1",
    orgId: "orgA",
    teamId: "team-platform",
    effectiveFromMs: 100,
    recordedAtMs: 100,
  },
  // 4월: 팀 재배정(앱팀) — 새 행, 기존 행 불변
  {
    projectId: "p1",
    orgId: "orgA",
    teamId: "team-app",
    effectiveFromMs: 200,
    recordedAtMs: 200,
  },
  // 같은 effectiveFrom 의 정정 — 나중에 기록된 행이 이긴다
  {
    projectId: "p1",
    orgId: "orgA",
    teamId: null,
    effectiveFromMs: 200,
    recordedAtMs: 300,
  },
  {
    projectId: "p2",
    orgId: "orgB",
    teamId: null,
    effectiveFromMs: 100,
    recordedAtMs: 100,
  },
];

test("resolveBindingAt / resolveTeamIdAt — 시점별 팀 연속성 (#1336 §3.2)", () => {
  assert.equal(resolveTeamIdAt(BINDINGS, "p1", 150), "team-platform");
  // 같은 effectiveFrom 정정: 나중 기록(teamId null)이 이긴다.
  assert.equal(resolveTeamIdAt(BINDINGS, "p1", 250), null);
  assert.equal(resolveBindingAt(BINDINGS, "p1", 250)?.orgId, "orgA");
  // 결합 이전 시점은 null.
  assert.equal(resolveBindingAt(BINDINGS, "p1", 50), null);
  // 다른 프로젝트의 행이 섞이지 않는다.
  assert.equal(resolveBindingAt(BINDINGS, "p2", 150)?.orgId, "orgB");
});

// ── 4) 결합 쓰기 멱등 ────────────────────────────────────────────────────────

test("planBindingWrite — ★같은 (orgId, teamId) 재시도는 noop", () => {
  const plan = planBindingWrite({
    bindings: BINDINGS,
    projectId: "p1",
    orgId: "orgA",
    teamId: null, // 250 시점 유효값과 동일
    nowMs: 400,
  });
  assert.equal(plan.action, "noop");
});

test("planBindingWrite — 팀만 달라져도 새 행 (재배정)", () => {
  const plan = planBindingWrite({
    bindings: BINDINGS,
    projectId: "p1",
    orgId: "orgA",
    teamId: "team-platform",
    nowMs: 400,
  });
  assert.equal(plan.action, "append");
  if (plan.action === "append") {
    assert.deepEqual(plan.row, {
      projectId: "p1",
      orgId: "orgA",
      teamId: "team-platform",
      effectiveFromMs: 400,
      recordedAtMs: 400,
    });
  }
});

test("planBindingWrite — 첫 결합은 append", () => {
  const plan = planBindingWrite({
    bindings: [],
    projectId: "p9",
    orgId: "orgA",
    teamId: null,
    nowMs: 400,
  });
  assert.equal(plan.action, "append");
});

// ── firstAppLoginAt — forward-only ──────────────────────────────────────────

test("planFirstAppLoginStamp — 없을 때만 찍는다", () => {
  assert.deepEqual(planFirstAppLoginStamp(null, 1000), {
    stamp: true,
    atMs: 1000,
  });
  assert.deepEqual(planFirstAppLoginStamp(undefined, 1000), {
    stamp: true,
    atMs: 1000,
  });
});

test("planFirstAppLoginStamp — ★이미 있으면 어떤 입력에도 덮지 않는다", () => {
  assert.equal(planFirstAppLoginStamp(new Date(1), 1000).stamp, false);
  assert.equal(planFirstAppLoginStamp(0, 1000).stamp, false);
  assert.equal(planFirstAppLoginStamp("garbage", 1000).stamp, false);
});

// ── 축 순수성 ────────────────────────────────────────────────────────────────

test("assertOrgDocAxisPurity — 익명 축 식별자가 섞이면 던진다", () => {
  for (const key of ORG_DOC_FORBIDDEN_AXIS_KEYS) {
    assert.throws(
      () => assertOrgDocAxisPurity({ nested: { [key]: "x" } }),
      new RegExp(key)
    );
  }
});

test("assertOrgDocAxisPurity — 계정 축 필드만 있으면 통과", () => {
  assert.doesNotThrow(() =>
    assertOrgDocAxisPurity({
      orgId: "orgA",
      uid: "uidA",
      role: "org_member",
      grantPath: "invitation",
      firstAppLoginAt: null,
    })
  );
});
