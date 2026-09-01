// orgUsage 순수 로직 단위테스트 (orgStructure.test.ts 규약).
//
// 실행:
//   cd v3/functions && npm run test:org-usage
//
// ★여기서 고정하는 성질 넷(티켓 aoJQjTMV6KtanCSeO0x4 완료 기준):
//   1) ★불변식 S ⊆ visible(u) — org_member·비멤버는 restricted 고, 판정은 역할
//      지름길이 아니라 집합 포함 검사다(부분 가시 → restricted).
//   2) ★restricted 는 0 이 아니다 — 봉투에 숫자 필드 자체가 없다.
//   3) 팀 접기 — org_teams 의 teamId 그룹핑, 미지정(null) 버킷, Σ소계 = Σ프로젝트.
//   4) 조직 상한 — 25→100 상향에도 잘린 개수를 밝히는 규약(capProjectScope)이
//      그대로 산다.
import test from "node:test";
import assert from "node:assert/strict";

import { capProjectScope, type TeamUsageByProject } from "./teamUsage";
import {
  ORG_SCOPE_DENIED_CODE,
  ORG_USAGE_MAX_PROJECTS_IN_SCOPE,
  buildOrgUsageRestricted,
  decideOrgUsageAccess,
  foldOrgTeams,
  isScopeVisible,
  resolveOrgVisibleProjects,
} from "./orgUsage";

// ── 1. 불변식 S ⊆ visible(u) ────────────────────────────────────────────────

test("org_owner/org_admin 은 결합 전수가 visible 이라 full 이다", () => {
  const s = ["p1", "p2", "p3"];
  assert.deepEqual(decideOrgUsageAccess("org_owner", s), { kind: "full" });
  assert.deepEqual(decideOrgUsageAccess("org_admin", s), { kind: "full" });
});

test("★org_member 는 restricted 다 — 0 으로 접히지 않는다", () => {
  assert.deepEqual(decideOrgUsageAccess("org_member", ["p1", "p2"]), {
    kind: "restricted",
  });
});

test("★비멤버(null)도 restricted — org_member 와 구분되지 않는다(존재 비노출)", () => {
  assert.deepEqual(decideOrgUsageAccess(null, ["p1"]), { kind: "restricted" });
});

test("★판정의 실체는 집합 포함이다 — 부분 가시는 역할과 무관하게 막힌다", () => {
  // visible 이 S 의 진부분집합이면 총계를 서빙하면 안 된다(뺄셈 유출).
  assert.equal(isScopeVisible(["p1", "p2"], ["p1"]), false);
  assert.equal(isScopeVisible(["p1", "p2"], ["p1", "p2", "p3"]), true);
  // 공집합 S 는 자명하게 포함이지만, 역할이 안 되면 visible 이 공집합이라
  // S 가 비어있지 않은 한 절대 full 이 안 된다.
  assert.deepEqual(resolveOrgVisibleProjects("org_member", ["p1"]), []);
  assert.deepEqual(resolveOrgVisibleProjects(null, ["p1"]), []);
  assert.deepEqual(resolveOrgVisibleProjects("org_admin", ["p1"]), ["p1"]);
});

// ── 2. restricted 봉투 — 숫자 필드 자체가 없다 ──────────────────────────────

test("★restricted 봉투에는 totals/byProject/byTeam 이 아예 없다", () => {
  const env = buildOrgUsageRestricted(1_756_700_000_000);
  assert.equal(env.restricted, true);
  assert.equal(env.requires, "org_admin");
  assert.equal(env.reasonCode, ORG_SCOPE_DENIED_CODE);
  assert.equal(typeof env.reason, "string");
  // ★0 으로 접히는 경로 차단 — 값이 0 인 게 아니라 필드가 없다.
  const keys = Object.keys(env);
  for (const forbidden of ["totals", "byProject", "byTeam", "byDay", "byModel"]) {
    assert.equal(keys.includes(forbidden), false, `${forbidden} 이 실려 있다`);
  }
  // ★조직·프로젝트 식별자를 담지 않는다(존재 비노출).
  assert.equal(keys.includes("orgId"), false);
});

// ── 3. 팀 접기 ──────────────────────────────────────────────────────────────

function row(projectId: string, costUsd: number, tokens: number): TeamUsageByProject {
  return { projectId, projectName: null, costUsd, tokens };
}

test("팀별 그룹핑이 org_teams 의 teamId 를 따르고 미지정은 버킷으로 남는다", () => {
  const byProject = [row("a", 10.5, 100), row("b", 2.25, 20), row("c", 1, 10)];
  const teamIdByProject = new Map<string, string | null>([
    ["a", "t1"],
    ["b", "t1"],
    ["c", null], // 미지정 — "없다고 답함"
  ]);
  const teamNames = new Map([["t1", "플랫폼팀"]]);
  const { byProject: rows, byTeam } = foldOrgTeams(
    byProject,
    teamIdByProject,
    teamNames
  );

  assert.equal(rows.find((r) => r.projectId === "a")?.teamId, "t1");
  assert.equal(rows.find((r) => r.projectId === "a")?.teamDisplayName, "플랫폼팀");
  assert.equal(rows.find((r) => r.projectId === "c")?.teamId, null);

  assert.equal(byTeam.length, 2);
  const t1 = byTeam.find((t) => t.teamId === "t1");
  assert.ok(t1);
  assert.equal(t1.costUsd, 12.75);
  assert.equal(t1.tokens, 120);
  assert.equal(t1.projects, 2);
  const unassigned = byTeam.find((t) => t.teamId === null);
  assert.ok(unassigned, "미지정 버킷이 없다 — 숨기면 소계 합 ≠ 총계가 된다");
  assert.equal(unassigned.costUsd, 1);
  // ★미지정은 맨 뒤 — 배정 CTA 자리가 고정된다.
  assert.equal(byTeam[byTeam.length - 1].teamId, null);
});

test("★Σ byTeam = Σ byProject — 미지정 포함, 반올림 오차 이내", () => {
  const byProject = [
    row("a", 0.123456, 3),
    row("b", 0.000001, 1),
    row("c", 7.777777, 7),
    row("d", 0.5, 5),
  ];
  const teamIdByProject = new Map<string, string | null>([
    ["a", "t1"],
    ["b", "t2"],
    ["c", null],
    // "d" 는 매핑 자체가 없다(결합표 밖) → 미지정 버킷으로 접혀야 샌 값이 없다.
  ]);
  const { byTeam } = foldOrgTeams(byProject, teamIdByProject, new Map());
  const teamSum = byTeam.reduce((acc, t) => acc + t.costUsd, 0);
  const projectSum = byProject.reduce((acc, p) => acc + p.costUsd, 0);
  assert.ok(
    Math.abs(teamSum - projectSum) < (byTeam.length + 1) * 5e-7,
    `팀 소계 합(${teamSum})이 프로젝트 합(${projectSum})과 어긋난다`
  );
  const tokensSum = byTeam.reduce((acc, t) => acc + t.tokens, 0);
  assert.equal(tokensSum, 16);
});

test("팀 문서를 못 찾은 teamId 는 이름 null 로 남는다(임의 팀으로 밀지 않는다)", () => {
  const { byTeam } = foldOrgTeams(
    [row("a", 1, 1)],
    new Map([["a", "ghost-team"]]),
    new Map()
  );
  assert.equal(byTeam.length, 1);
  assert.equal(byTeam[0].teamId, "ghost-team");
  assert.equal(byTeam[0].teamDisplayName, null);
});

test("행이 없는 조직(빈 상태)은 빈 배열 둘로 끝난다 — 던지지 않는다", () => {
  const { byProject, byTeam } = foldOrgTeams([], new Map(), new Map());
  assert.deepEqual(byProject, []);
  assert.deepEqual(byTeam, []);
});

// ── 4. 조직 상한 — 잘린 개수를 밝히는 규약 유지 ─────────────────────────────

test("조직 상한(100)을 넘으면 조용히 자르지 않고 omitted 를 센다", () => {
  const many = Array.from({ length: 130 }, (_, i) => `p${i}`);
  const { ids, omitted } = capProjectScope(many, ORG_USAGE_MAX_PROJECTS_IN_SCOPE);
  assert.equal(ids.length, 100);
  assert.equal(omitted, 30);
  // 팀 상한(25)보다 실제로 올라갔다 — 26번째 프로젝트가 잘리지 않는다.
  const mid = Array.from({ length: 26 }, (_, i) => `p${i}`);
  const capped = capProjectScope(mid, ORG_USAGE_MAX_PROJECTS_IN_SCOPE);
  assert.equal(capped.ids.length, 26);
  assert.equal(capped.omitted, 0);
});
