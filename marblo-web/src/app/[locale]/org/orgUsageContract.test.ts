/**
 * 조직 롤업 봉투 계약 테스트 (`orgContract.test.ts` 규약 — tsx --test).
 *
 * ★여기서 고정하는 성질 셋(티켓 aoJQjTMV6KtanCSeO0x4 완료 기준):
 *   1. restricted 봉투가 숫자로 환원되지 않는다 — kind 로만 갈린다.
 *   2. 팀별 그룹핑이 서버의 byTeam 순서를 따르고, 어느 소계에도 안 붙는 행은
 *      버려지지 않는다(미지정으로 합류 — 합계 보존).
 *   3. 잘린 프로젝트 개수(projectsOmitted)가 봉투에서 화면까지 산다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  groupProjectsByTeam,
  normalizeOrgUsage,
  type OrgUsageByProjectRow,
  type OrgUsageByTeamRow,
} from "./orgUsageContract";

function dataEnvelope(overrides: Record<string, unknown> = {}): unknown {
  return {
    restricted: false,
    orgId: "org1",
    rangeDays: 30,
    generatedAt: "2026-09-01T00:00:00.000Z",
    cache: { hit: false, ageSeconds: 0, ttlSeconds: 900 },
    teamUsage: {
      state: "complete",
      disabledReason: null,
      disabledReasonCode: null,
      effectiveFrom: "2026-04-01",
      basis: "account_ledger",
      basisLabel: "로그인한 계정 기준",
      costLabel: "사용량 환산 비용(추정)",
      costNotBillingNote: "청구액이 아닙니다.",
      scope: "team",
      projectsInScope: 2,
      projectsOmitted: 0,
      projectsTruncatedNote: null,
    },
    orchestratorAxis: {
      state: "not_collected",
      reason: null,
      reasonCode: "orchestrator_not_collected",
      collectingSince: null,
      legacySegment: null,
    },
    totals: {
      costUsd: 12,
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      tokens: 120,
    },
    byDay: [{ day: "2026-08-31", costUsd: 12, tokens: 120, partial: false }],
    byMember: [],
    byProject: [
      {
        projectId: "p1",
        projectName: "A",
        costUsd: 10,
        tokens: 100,
        teamId: "t1",
        teamDisplayName: "플랫폼팀",
      },
      {
        projectId: "p2",
        projectName: null,
        costUsd: 2,
        tokens: 20,
        teamId: null,
        teamDisplayName: null,
      },
    ],
    byTeam: [
      {
        teamId: "t1",
        teamDisplayName: "플랫폼팀",
        costUsd: 10,
        tokens: 100,
        projects: 1,
      },
      { teamId: null, teamDisplayName: null, costUsd: 2, tokens: 20, projects: 1 },
    ],
    byModel: [],
    byActorKind: [],
    coverage: { rowsInWindow: 3 },
    ...overrides,
  };
}

test("restricted 봉투는 kind 로만 갈리고 숫자가 없다", () => {
  const out = normalizeOrgUsage({
    restricted: true,
    requires: "org_admin",
    reasonCode: "org_scope_denied",
    reason: "조직 전체 사용량은 조직 관리자만 볼 수 있습니다.",
  });
  assert.equal(out.kind, "restricted");
  if (out.kind !== "restricted") return;
  assert.equal(out.requires, "org_admin");
  assert.equal(out.reasonCode, "org_scope_denied");
  // ★타입 수준에서 totals 가 없다 — 런타임에서도 키가 없다.
  assert.equal("totals" in out, false);
});

test("data 봉투 — byTeam·byProject(teamId 포함)·잘림 개수가 접힌다", () => {
  const out = normalizeOrgUsage(dataEnvelope());
  assert.equal(out.kind, "data");
  if (out.kind !== "data") return;
  assert.equal(out.byTeam.length, 2);
  assert.equal(out.byTeam[0].teamId, "t1");
  assert.equal(out.byTeam[0].teamDisplayName, "플랫폼팀");
  assert.equal(out.byTeam[1].teamId, null);
  assert.equal(out.byProject[0].teamId, "t1");
  assert.equal(out.projectsOmitted, 0);
  assert.equal(out.envelope.teamUsage?.state, "complete");
  assert.equal(out.basisLabel, "로그인한 계정 기준");
});

test("★잘린 프로젝트 개수가 봉투에서 산다(조용한 절단 금지)", () => {
  const raw = dataEnvelope();
  (raw as { teamUsage: Record<string, unknown> }).teamUsage.projectsOmitted = 7;
  (raw as { teamUsage: Record<string, unknown> }).teamUsage.projectsTruncatedNote =
    "일부만 집계했습니다";
  const out = normalizeOrgUsage(raw);
  assert.equal(out.kind, "data");
  if (out.kind !== "data") return;
  assert.equal(out.projectsOmitted, 7);
  assert.equal(out.projectsTruncatedNote, "일부만 집계했습니다");
});

test("★이메일로 지은 팀명은 화면까지 오지 못한다(마지막 문턱)", () => {
  const raw = dataEnvelope();
  (raw as { byTeam: Array<Record<string, unknown>> }).byTeam[0].teamDisplayName =
    "kim@example.com";
  const out = normalizeOrgUsage(raw);
  assert.equal(out.kind, "data");
  if (out.kind !== "data") return;
  assert.equal(out.byTeam[0].teamDisplayName, null);
});

test("쓰레기 입력에도 던지지 않는다", () => {
  for (const junk of [null, undefined, 42, "x", [], { byTeam: "nope" }]) {
    const out = normalizeOrgUsage(junk);
    assert.equal(out.kind, "data");
  }
});

function team(
  teamId: string | null,
  costUsd: number,
  projects: number
): OrgUsageByTeamRow {
  return { teamId, teamDisplayName: null, costUsd, tokens: 0, projects };
}

function proj(
  projectId: string,
  teamId: string | null,
  costUsd: number
): OrgUsageByProjectRow {
  return {
    projectId,
    projectName: null,
    costUsd,
    tokens: 0,
    teamId,
    teamDisplayName: null,
  };
}

test("그룹핑은 byTeam 순서를 따르고 프로젝트는 비용 내림차순", () => {
  const groups = groupProjectsByTeam(
    [team("t1", 12, 2), team(null, 1, 1)],
    [proj("a", "t1", 2), proj("b", "t1", 10), proj("c", null, 1)]
  );
  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups[0].rows.map((r) => r.projectId),
    ["b", "a"]
  );
  assert.equal(groups[1].team.teamId, null);
});

test("★어느 소계에도 안 붙는 행은 버려지지 않는다 — 미지정으로 합류(합계 보존)", () => {
  // 서버 byTeam 에 없는 teamId 를 단 행(방어적 시나리오).
  const groups = groupProjectsByTeam(
    [team("t1", 10, 1)],
    [proj("a", "t1", 10), proj("ghost", "t-gone", 5)]
  );
  const all = groups.flatMap((g) => g.rows.map((r) => r.projectId));
  assert.ok(all.includes("ghost"), "고아 행이 화면에서 사라졌다");
  const unassigned = groups.find((g) => g.team.teamId === null);
  assert.ok(unassigned);
  assert.equal(unassigned.rows[0].projectId, "ghost");
});
