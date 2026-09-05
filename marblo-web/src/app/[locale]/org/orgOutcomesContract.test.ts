/**
 * 조직 작업 성과 롤업 — 순수 집계 판정 테스트.
 *
 * ★이 티켓의 핵심 갭: 조직 화면에 성공·실패가 없었다(`task_outcomes` 는 축
 *   가드로 못 들어오고, 팀 원장 기반 `tasksDone`/`tasksFailed` 는 `/team` 감사
 *   탭에만 있었다). 여기서는 그 원장 값을 프로젝트마다 모아 조직 롤업으로
 *   접는 판정만 검사한다 — 렌더링은 `OrgOutcomesView.test.tsx`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateOrgOutcomes,
  successRate,
  type OrgOutcomeProjectInput,
} from "./orgOutcomesContract";
import type { TeamAuditEnvelope } from "../team/teamAuditContract";

function envelope(overrides: {
  state?: "disabled" | "empty" | "partial" | "complete";
  tasksDone?: number;
  tasksFailed?: number;
  tasksOpen?: number;
  generatedAt?: string | null;
}): TeamAuditEnvelope {
  const state = overrides.state ?? "complete";
  return {
    // ★`??` 는 `null` 도 폴백시킨다 — 명시적 null 오버라이드를 살리려면 `in` 검사.
    generatedAt:
      "generatedAt" in overrides
        ? overrides.generatedAt ?? null
        : "2026-09-05T00:00:00.000Z",
    projectId: "p",
    projects: [],
    teamAudit: {
      state,
      reasonCode: state === "disabled" ? "no_role" : null,
      reason: null,
      scope: "team",
      role: state === "disabled" ? null : "owner",
      projectsInScope: state === "disabled" ? 0 : 1,
      basis: "project_event_ledger",
    },
    page: { limit: 50, returned: 0, nextCursor: null, hasMore: false },
    criteria: null,
    summary:
      state === "disabled"
        ? null
        : {
            eventsInWindow: null,
            eventsByKind: {},
            tasksTotal: null,
            tasksOpen: overrides.tasksOpen ?? 0,
            tasksDone: overrides.tasksDone ?? 0,
            tasksFailed: overrides.tasksFailed ?? 0,
            attentionCount: null,
            criticalCount: null,
            agentsTotal: null,
            missionsTotal: null,
            missionsActive: null,
          },
    events: [],
    attention: [],
    workload: [],
    withheld: [],
    notes: [],
  };
}

function row(
  overrides: Partial<OrgOutcomeProjectInput> = {}
): OrgOutcomeProjectInput {
  return {
    projectId: "p1",
    teamId: null,
    teamDisplayName: null,
    envelope: envelope({}),
    ...overrides,
  };
}

// ── successRate — 분모 없는 비율 금지 ────────────────────────────────────────

test("successRate: 완료+실패 0 이면 모른다(0% 이 아니다)", () => {
  assert.equal(successRate(0, 0), null);
});

test("successRate: 완료/실패 비율을 낸다", () => {
  assert.equal(successRate(9, 1), 0.9);
  assert.equal(successRate(1, 9), 0.1);
});

test("successRate: 진행 중(open)은 분모에 안 들어간다 — 호출부가 안 넘긴다", () => {
  // open 은 함수 시그니처에 아예 없다 — 계약으로 배제.
  assert.equal(successRate(5, 5), 0.5);
});

// ── aggregateOrgOutcomes — 세 상태를 가른다 ─────────────────────────────────

test("결합 0건이면 noBindings — 시도조차 안 한다", () => {
  const result = aggregateOrgOutcomes(0, []);
  assert.deepEqual(result, { kind: "noBindings" });
});

test("결합은 있는데 부른 프로젝트가 0건이면 noAccess(attempted 0)", () => {
  const result = aggregateOrgOutcomes(3, []);
  assert.deepEqual(result, { kind: "noAccess", attempted: 0 });
});

test("전부 no_role(disabled)이면 noAccess — attempted 가 실제 시도 수", () => {
  const rows = [
    row({ projectId: "p1", envelope: envelope({ state: "disabled" }) }),
    row({ projectId: "p2", envelope: envelope({ state: "disabled" }) }),
  ];
  const result = aggregateOrgOutcomes(2, rows);
  assert.deepEqual(result, { kind: "noAccess", attempted: 2 });
});

test("콜러블 호출 자체가 실패(envelope null)해도 noAccess 로 접힌다", () => {
  const rows = [row({ projectId: "p1", envelope: null })];
  const result = aggregateOrgOutcomes(1, rows);
  assert.deepEqual(result, { kind: "noAccess", attempted: 1 });
});

test("포함된 프로젝트가 하나라도 있으면 data — 완료/실패/진행 합산", () => {
  const rows = [
    row({
      projectId: "p1",
      teamId: "t1",
      teamDisplayName: "플랫폼팀",
      envelope: envelope({ tasksDone: 10, tasksFailed: 2, tasksOpen: 3 }),
    }),
    row({
      projectId: "p2",
      teamId: "t1",
      teamDisplayName: "플랫폼팀",
      envelope: envelope({ tasksDone: 5, tasksFailed: 0, tasksOpen: 1 }),
    }),
  ];
  const result = aggregateOrgOutcomes(2, rows);
  assert.equal(result.kind, "data");
  if (result.kind !== "data") return;
  assert.equal(result.tasksDone, 15);
  assert.equal(result.tasksFailed, 2);
  assert.equal(result.tasksOpen, 4);
  assert.equal(result.includedProjects, 2);
  assert.equal(result.excludedProjects, 0);
  assert.equal(result.cappedOmitted, 0);
  assert.equal(result.byTeam.length, 1);
  assert.equal(result.byTeam[0].tasksDone, 15);
  assert.equal(result.byTeam[0].tasksFailed, 2);
  assert.equal(result.byTeam[0].projects, 2);
});

test("제외된 프로젝트(no_role)는 조용히 사라지지 않고 excludedProjects 로 셈해진다", () => {
  const rows = [
    row({
      projectId: "p1",
      teamId: "t1",
      envelope: envelope({ tasksDone: 4, tasksFailed: 1 }),
    }),
    row({ projectId: "p2", envelope: envelope({ state: "disabled" }) }),
    row({ projectId: "p3", envelope: null }),
  ];
  const result = aggregateOrgOutcomes(3, rows);
  assert.equal(result.kind, "data");
  if (result.kind !== "data") return;
  // 제외된 두 건이 합계에 0 으로도 안 들어간다 — 애초에 안 더해진다.
  assert.equal(result.tasksDone, 4);
  assert.equal(result.includedProjects, 1);
  assert.equal(result.excludedProjects, 2);
});

test("상한에 걸려 아예 안 부른 프로젝트는 cappedOmitted 로 밝힌다", () => {
  // bindingsCount=10 인데 rows 는 2개만 — 나머지 8개는 상한 밖.
  const rows = [
    row({ projectId: "p1", envelope: envelope({ tasksDone: 1 }) }),
    row({ projectId: "p2", envelope: envelope({ tasksDone: 1 }) }),
  ];
  const result = aggregateOrgOutcomes(10, rows);
  assert.equal(result.kind, "data");
  if (result.kind !== "data") return;
  assert.equal(result.cappedOmitted, 8);
});

test("미지정(teamId=null) 버킷은 표에 남고 항상 맨 뒤다", () => {
  const rows = [
    row({
      projectId: "p1",
      teamId: null,
      envelope: envelope({ tasksDone: 100 }),
    }),
    row({
      projectId: "p2",
      teamId: "t1",
      teamDisplayName: "플랫폼팀",
      envelope: envelope({ tasksDone: 1, tasksFailed: 1 }),
    }),
  ];
  const result = aggregateOrgOutcomes(2, rows);
  assert.equal(result.kind, "data");
  if (result.kind !== "data") return;
  // t1 은 실패가 있어 완료 수가 훨씬 적어도 미지정보다 먼저다.
  assert.equal(result.byTeam[0].teamId, "t1");
  assert.equal(result.byTeam[1].teamId, null);
});

test("실패가 많은 팀이 표에서 먼저 나온다 — '실패가 어디서 나는가' 를 바로 읽게", () => {
  const rows = [
    row({
      projectId: "p1",
      teamId: "quiet",
      envelope: envelope({ tasksDone: 50, tasksFailed: 0 }),
    }),
    row({
      projectId: "p2",
      teamId: "noisy",
      envelope: envelope({ tasksDone: 10, tasksFailed: 8 }),
    }),
  ];
  const result = aggregateOrgOutcomes(2, rows);
  assert.equal(result.kind, "data");
  if (result.kind !== "data") return;
  assert.equal(result.byTeam[0].teamId, "noisy");
  assert.equal(result.byTeam[1].teamId, "quiet");
});

test("partial 상태가 섞이면 hasPartialSource 가 켜진다", () => {
  const rows = [
    row({
      projectId: "p1",
      envelope: envelope({ state: "partial", tasksDone: 1 }),
    }),
    row({ projectId: "p2", envelope: envelope({ tasksDone: 1 }) }),
  ];
  const result = aggregateOrgOutcomes(2, rows);
  assert.equal(result.kind, "data");
  if (result.kind !== "data") return;
  assert.equal(result.hasPartialSource, true);
});

test("전부 complete 이면 hasPartialSource 가 꺼져 있다 — 뮤테이션 확인용 반례", () => {
  const rows = [
    row({ projectId: "p1", envelope: envelope({ tasksDone: 1 }) }),
    row({ projectId: "p2", envelope: envelope({ tasksDone: 1 }) }),
  ];
  const result = aggregateOrgOutcomes(2, rows);
  assert.equal(result.kind, "data");
  if (result.kind !== "data") return;
  assert.equal(result.hasPartialSource, false);
});

test("generatedAt 은 포함된 응답 중 하나에서 가져온다 — null 만 있으면 null", () => {
  const rows = [
    row({
      projectId: "p1",
      envelope: envelope({ generatedAt: null, tasksDone: 1 }),
    }),
  ];
  const result = aggregateOrgOutcomes(1, rows);
  assert.equal(result.kind, "data");
  if (result.kind !== "data") return;
  assert.equal(result.generatedAt, null);
});
