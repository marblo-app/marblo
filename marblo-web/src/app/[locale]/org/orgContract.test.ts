/**
 * 조직 계약 테스트 — ★착지 규칙(§5.8) 분기 **전수** + 신뢰 경계 정규화.
 *
 * 착지 규칙은 이미 정해져 있다(#1333 §3.3 이 §5.8 을 인용):
 *   마지막 본 조직 → 유일한 비개인 조직 → 선택 화면 → 개인 조직
 * 이 테스트가 그 순서 그대로를 분기 전수로 고정한다 — 구현이 규칙을 다시
 * 발명하면 여기서 깨진다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  currentBindings,
  deriveOrgTotalsCell,
  isSwitcherVisible,
  landingPath,
  normalizeOrganizations,
  orgPath,
  resolveOrgLanding,
  PERSONAL_ORG_SENTINEL,
  type OrgBindingEntry,
  type OrgListEntry,
} from "./orgContract";

const PERSONAL: OrgListEntry = {
  orgId: "personal_uid_1",
  displayName: null,
  isPersonal: true,
  role: "org_owner",
};

function org(
  orgId: string,
  role: OrgListEntry["role"] = "org_member"
): OrgListEntry {
  return { orgId, displayName: `조직 ${orgId}`, isPersonal: false, role };
}

// ── ★착지 규칙 분기 전수 ────────────────────────────────────────────────────

test("규칙 1: 마지막 본 조직이 여전히 멤버면 그곳 — 여럿이어도 선택 화면을 건너뛴다", () => {
  const orgs = [PERSONAL, org("a"), org("b")];
  assert.deepEqual(resolveOrgLanding(orgs, "a"), { kind: "org", orgId: "a" });
  assert.deepEqual(resolveOrgLanding(orgs, "b"), { kind: "org", orgId: "b" });
});

test("규칙 1: 마지막 본 조직이 개인 센티널이면 개인 조직", () => {
  const orgs = [PERSONAL, org("a"), org("b")];
  assert.deepEqual(resolveOrgLanding(orgs, PERSONAL_ORG_SENTINEL), {
    kind: "me",
  });
});

test("규칙 1: 센티널 이전에 적힌 원시 개인 orgId 도 개인 조직으로 푼다", () => {
  const orgs = [PERSONAL, org("a"), org("b")];
  assert.deepEqual(resolveOrgLanding(orgs, "personal_uid_1"), { kind: "me" });
});

test("규칙 1 탈락: 멤버가 아닌 마지막 본 조직은 무시된다 — 임의 값을 넣어도 아무 일도 없다", () => {
  // localStorage 는 사용자가 고칠 수 있다(§5.8). 존재 여부에 답하지 않고
  // 다음 규칙으로 떨어질 뿐이다.
  assert.deepEqual(resolveOrgLanding([PERSONAL, org("a")], "stale"), {
    kind: "org",
    orgId: "a",
  });
  assert.deepEqual(resolveOrgLanding([PERSONAL], "stale"), { kind: "me" });
  assert.deepEqual(resolveOrgLanding([PERSONAL, org("a"), org("b")], "stale"), {
    kind: "choose",
  });
});

test("규칙 2: 비개인 조직이 정확히 하나면 그것", () => {
  assert.deepEqual(resolveOrgLanding([PERSONAL, org("only")], null), {
    kind: "org",
    orgId: "only",
  });
});

test("규칙 3: 여럿이면 자동 착지하지 않는다 — 선택 화면", () => {
  // 대행사가 고객 A 화면을 열어 둔 채 B 와 회의하는 사고 방지(§5.8).
  assert.deepEqual(resolveOrgLanding([PERSONAL, org("a"), org("b")], null), {
    kind: "choose",
  });
  assert.deepEqual(
    resolveOrgLanding([PERSONAL, org("a"), org("b"), org("c")], null),
    { kind: "choose" }
  );
});

test("규칙 4: 비개인 조직이 없으면 개인 조직 — '조직 없음' 상태는 존재하지 않는다", () => {
  assert.deepEqual(resolveOrgLanding([PERSONAL], null), { kind: "me" });
  // 봉투가 통째로 비어도(방어) 개인 조직으로 접는다 — 깨진 화면이 없다.
  assert.deepEqual(resolveOrgLanding([], null), { kind: "me" });
});

test("착지 결과 → 경로", () => {
  assert.equal(landingPath({ kind: "me" }), "/org/me");
  assert.equal(landingPath({ kind: "org", orgId: "a" }), "/org/a");
  assert.equal(landingPath({ kind: "choose" }), "/org");
});

test("개인 조직 경로는 /org/me 하나뿐 — uid 가 실린 orgId 를 URL 에 싣지 않는다", () => {
  assert.equal(orgPath(PERSONAL), "/org/me");
  assert.equal(orgPath(org("a")), "/org/a");
});

// ── ★스위처 노출 조건 ───────────────────────────────────────────────────────

test("조직이 하나뿐이면(=개인 조직만) 스위처를 보이지 않는다", () => {
  assert.equal(isSwitcherVisible([PERSONAL]), false);
  assert.equal(isSwitcherVisible([]), false);
});

test("비개인 조직이 하나라도 있으면 스위처가 보인다", () => {
  assert.equal(isSwitcherVisible([PERSONAL, org("a")]), true);
  assert.equal(isSwitcherVisible([PERSONAL, org("a"), org("b")]), true);
});

// ── ★restricted 판정 — 여섯 번째 부재(#1205 §4.2) ──────────────────────────

test("org_member 의 조직 전체 사용량 칸은 빈칸이 아니라 restricted 다", () => {
  assert.deepEqual(deriveOrgTotalsCell("org_member"), {
    kind: "restricted",
    requires: "org_admin",
    reasonCode: "org_scope_denied",
    reason: null,
  });
});

test("관리자의 칸은 restricted 가 아니라 미배선이다 — 롤업 콜러블은 다음 단계다", () => {
  assert.deepEqual(deriveOrgTotalsCell("org_admin"), { kind: "unwired" });
  assert.deepEqual(deriveOrgTotalsCell("org_owner"), { kind: "unwired" });
});

// ── 신뢰 경계 정규화 ────────────────────────────────────────────────────────

test("깨진 입력에도 던지지 않고 빈 봉투로 접는다", () => {
  for (const bad of [undefined, null, 42, "nope", [], {}]) {
    const env = normalizeOrganizations(bad);
    assert.deepEqual(env.orgs, []);
    assert.equal(env.detail, null);
  }
});

test("손상 행은 org_member 로 접지 않고 버린다(fail-closed)", () => {
  const env = normalizeOrganizations({
    orgs: [
      {
        orgId: "ok",
        displayName: "이름",
        isPersonal: false,
        role: "org_admin",
      },
      { orgId: "bad-role", displayName: null, isPersonal: false, role: "root" },
      { displayName: "id 없음", isPersonal: false, role: "org_member" },
      "행이 아님",
    ],
  });
  assert.deepEqual(env.orgs, [
    { orgId: "ok", displayName: "이름", isPersonal: false, role: "org_admin" },
  ]);
});

test("detail 의 teams/bindings 는 null 과 [] 를 가른다 — null 은 '없음' 이 아니다", () => {
  // 개인 조직: 팀 개념 자체가 없다(null) → 화면이 팀 영역을 그리지 않는다.
  const personal = normalizeOrganizations({
    detail: {
      orgId: "personal_u",
      displayName: null,
      isPersonal: true,
      myRole: "org_owner",
      teams: null,
      bindings: null,
    },
  });
  assert.equal(personal.detail?.teams, null);
  assert.equal(personal.detail?.bindings, null);

  // 비개인 조직 org_member: 결합 목록이 권한으로 안 실린다(null) — 빈칸이 아니다.
  const member = normalizeOrganizations({
    detail: {
      orgId: "o1",
      displayName: "조직",
      isPersonal: false,
      myRole: "org_member",
      teams: [],
      bindings: null,
    },
  });
  assert.deepEqual(member.detail?.teams, []);
  assert.equal(member.detail?.bindings, null);
});

test("detail 의 myRole 이 손상이면 detail 을 통째로 버린다", () => {
  const env = normalizeOrganizations({
    detail: { orgId: "o1", isPersonal: false, myRole: "superuser" },
  });
  assert.equal(env.detail, null);
});

// ── 결합표 접기 — 추가 전용 행 → 현재 유효 결합 ─────────────────────────────

function binding(
  bindingId: string,
  projectId: string,
  teamId: string | null,
  effectiveFromMs: number | null,
  recordedAtMs: number | null = null
): OrgBindingEntry {
  return { bindingId, projectId, teamId, effectiveFromMs, recordedAtMs };
}

test("프로젝트마다 가장 최근에 유효해진 행 하나만 남는다 — 재배정은 새 행이다", () => {
  const rows = [
    binding("b1", "p1", "t1", 100),
    binding("b2", "p1", "t2", 200), // p1 을 t2 로 재배정
    binding("b3", "p2", null, 150),
  ];
  assert.deepEqual(currentBindings(rows), [
    binding("b2", "p1", "t2", 200),
    binding("b3", "p2", null, 150),
  ]);
});

test("effectiveFrom 이 같으면 recordedAt 이 늦은 정정이 이긴다", () => {
  const rows = [
    binding("b1", "p1", "t1", 100, 10),
    binding("b2", "p1", "t2", 100, 20),
  ];
  assert.deepEqual(currentBindings(rows), [binding("b2", "p1", "t2", 100, 20)]);
});

test("시각 없는 행은 가장 오래된 것으로 접는다(fail-old) · 빈 입력은 빈 결과", () => {
  const rows = [
    binding("b1", "p1", "t1", null),
    binding("b2", "p1", "t2", 100),
  ];
  assert.deepEqual(currentBindings(rows), [binding("b2", "p1", "t2", 100)]);
  assert.deepEqual(currentBindings([]), []);
});
