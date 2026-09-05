/**
 * 조직 작업 성과(완료·실패) 롤업 — 프레젠테이션 이전의 순수 집계.
 *
 * ★새 콜러블이 아니다. 이미 배포된 `getTeamProjectAudit`(#1124, 2026-08-22 머지 —
 *   `getOrgUsageSummary`보다 열흘 이른 기존 기능이라 배포 갭 위험이 없다)를 조직에
 *   결합된 프로젝트마다 호출해, 그 결과를 여기서 하나로 접는다.
 *
 * ★그 콜러블은 프로젝트별 역할을 서버가 직접 확인한다(조직 역할과 별개 축).
 *   조직 관리자가 그 프로젝트의 오너·관리자가 아니면 `disabled`(no_role)를
 *   돌려준다 — 그 행은 합계에서 조용히 빠지지 않고 "제외" 로 셈해진다
 *   (조용한 절단 금지, `orgUsageContract.ts` 의 `projectsOmitted` 와 같은 규율).
 *
 * ★성공/실패는 계정 축(프로젝트 티켓 원장)의 tasksDone/tasksFailed 다.
 *   `task_outcomes`(익명 설치 축)는 여기 들어오지 않는다 — `teamAuditContract.ts`
 *   의 같은 축 가드(§ TeamAuditSummary.tasksFailed 주석)를 그대로 물려받는다.
 *
 * ★React·firebase 무의존. `tsx --test` 로 그대로 돈다.
 */

import { maskDisplayName } from "../team/teamUsageContract";
import type { TeamAuditEnvelope } from "../team/teamAuditContract";

// ── 입력 — 프로젝트 하나당 감사 콜러블 응답 ──────────────────────────────────

export type OrgOutcomeProjectInput = {
  projectId: string;
  /** null = 팀 미지정("없다고 답함", #1336 §6) — `orgUsageContract` 와 같은 규약. */
  teamId: string | null;
  teamDisplayName: string | null;
  /** null = 콜러블 호출 자체가 실패했다(네트워크 등). no_role 과 사유는 다르지만
   *  "합계에서 빠진다" 는 결과는 같다 — 둘 다 `excludedProjects` 로 셈한다. */
  envelope: TeamAuditEnvelope | null;
};

export type OrgOutcomeByTeamRow = {
  teamId: string | null;
  teamDisplayName: string | null;
  tasksDone: number;
  tasksFailed: number;
  tasksOpen: number;
  projects: number;
};

export type OrgOutcomesData =
  | { kind: "noBindings" }
  | {
      /** 결합은 있었지만 이 계정으로는 하나도 못 읽었다(전부 no_role/오류). */
      kind: "noAccess";
      attempted: number;
    }
  | {
      kind: "data";
      generatedAt: string | null;
      tasksDone: number;
      tasksFailed: number;
      tasksOpen: number;
      byTeam: OrgOutcomeByTeamRow[];
      /** ★분모 없는 비율 금지 — 집계에 실제로 포함된 프로젝트 수. */
      includedProjects: number;
      /** 시도했지만 no_role/no_project/오류로 빠진 프로젝트 수. 0 이면 완전 집계. */
      excludedProjects: number;
      /** 조직 결합 수가 상한을 넘어 아예 시도하지 않은 프로젝트 수. */
      cappedOmitted: number;
      /** 포함된 프로젝트 중 부분 스캔(`scan_truncated` 등)이 있었나 — 있으면
       *  합계가 실제보다 낮을 수 있다. */
      hasPartialSource: boolean;
    };

/** 이 프로젝트의 감사 응답을 합계에 넣어도 되나. `disabled`(no_role 등)는 뺀다. */
function isIncludable(env: TeamAuditEnvelope | null): env is TeamAuditEnvelope {
  if (!env) return false;
  const gate = env.teamAudit;
  if (!gate) return false;
  return gate.state !== "disabled";
}

/** 완료/실패만으로 낸 성공률. 분모(완료+실패)가 0 이면 **모른다**(0% 이 아니다). */
export function successRate(
  tasksDone: number,
  tasksFailed: number
): number | null {
  const denom = tasksDone + tasksFailed;
  if (denom <= 0) return null;
  return tasksDone / denom;
}

/** 팀 표 정렬 — 실패 많은 팀이 먼저, 미지정은 항상 맨 뒤(usage 표와 같은 관례). */
function compareOutcomeRows(
  a: OrgOutcomeByTeamRow,
  b: OrgOutcomeByTeamRow
): number {
  const aUnassigned = a.teamId === null;
  const bUnassigned = b.teamId === null;
  if (aUnassigned !== bUnassigned) return aUnassigned ? 1 : -1;
  if (b.tasksFailed !== a.tasksFailed) return b.tasksFailed - a.tasksFailed;
  if (b.tasksDone !== a.tasksDone) return b.tasksDone - a.tasksDone;
  return (a.teamId ?? "").localeCompare(b.teamId ?? "");
}

/**
 * 프로젝트별 감사 응답을 조직 롤업 하나로 접는다.
 *
 * @param bindingsCount 조직에 결합된 전체 프로젝트 수(상한 적용 전).
 * @param rows          실제로 감사 콜러블을 부른 프로젝트들의 응답. 상한에 걸려
 *                      아예 부르지 않은 프로젝트는 여기 없다 — 그 차이가
 *                      `cappedOmitted` 다.
 */
export function aggregateOrgOutcomes(
  bindingsCount: number,
  rows: OrgOutcomeProjectInput[]
): OrgOutcomesData {
  if (bindingsCount === 0) return { kind: "noBindings" };
  if (rows.length === 0) return { kind: "noAccess", attempted: 0 };

  const included = rows.filter(
    (r): r is OrgOutcomeProjectInput & { envelope: TeamAuditEnvelope } =>
      isIncludable(r.envelope)
  );
  if (included.length === 0) {
    return { kind: "noAccess", attempted: rows.length };
  }

  const byTeamMap = new Map<string, OrgOutcomeByTeamRow>();
  let tasksDone = 0;
  let tasksFailed = 0;
  let tasksOpen = 0;
  let hasPartialSource = false;
  let generatedAt: string | null = null;

  for (const row of included) {
    const env = row.envelope;
    const summary = env.summary;
    const done = summary?.tasksDone ?? 0;
    const failed = summary?.tasksFailed ?? 0;
    const open = summary?.tasksOpen ?? 0;
    tasksDone += done;
    tasksFailed += failed;
    tasksOpen += open;
    if (env.teamAudit?.state === "partial") hasPartialSource = true;
    if (env.generatedAt) generatedAt = env.generatedAt;

    const key = row.teamId ?? "__unassigned__";
    const existing = byTeamMap.get(key);
    if (existing) {
      existing.tasksDone += done;
      existing.tasksFailed += failed;
      existing.tasksOpen += open;
      existing.projects += 1;
    } else {
      byTeamMap.set(key, {
        teamId: row.teamId,
        // ★팀명도 사람이 짓는다 — 멤버 표시명과 같은 마지막 문턱을 지난다.
        teamDisplayName: maskDisplayName(row.teamDisplayName),
        tasksDone: done,
        tasksFailed: failed,
        tasksOpen: open,
        projects: 1,
      });
    }
  }

  const byTeam = [...byTeamMap.values()].sort(compareOutcomeRows);

  return {
    kind: "data",
    generatedAt,
    tasksDone,
    tasksFailed,
    tasksOpen,
    byTeam,
    includedProjects: included.length,
    excludedProjects: rows.length - included.length,
    cappedOmitted: Math.max(0, bindingsCount - rows.length),
    hasPartialSource,
  };
}
