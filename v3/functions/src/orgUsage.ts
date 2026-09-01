// 조직 롤업(L0) 순수 판정 — `getOrgUsageSummary` 콜러블의 판정 부분.
//
// 정본: docs/org-analytics-b2b-design-2026-08-31.md §4.2(봉투)·§6(권한표) ·
//       docs/org-team-layer-design-2026-08-31.md §5(팀 접기)·§6(미지정 버킷)
// IO(인증·Firestore·BQ)는 index.ts 의 콜러블이 하고, 여기는 순수 판정만 한다 —
// teamUsage.ts / orgStructure.ts 와 같은 분업이라 `node --test` 로 그대로 돈다.
//
// ── ★이 모듈이 지키는 것 ────────────────────────────────────────────────────
//
//  1) ★총계 불변식 S ⊆ visible(u) (#1205 §3.3): 보이는 합계는 반드시 그 사람이
//     볼 수 있는 집합의 합이어야 한다. 부분 가시 사용자에게 총계를 주면 남의
//     프로젝트 값이 **뺄셈으로** 나온다(총계 − 내 것 = 남의 것). 그래서 판정은
//     역할 지름길이 아니라 **집합 포함 검사**로 한다 — 나중에 부분 가시 역할이
//     생겨도 이 함수를 지나는 한 누수 경로가 안 생긴다.
//  2) ★restricted 는 0 이 아니다: 권한이 없으면 totals 를 봉투에 싣지 않는다.
//     0 으로 접으면 "조직이 아무것도 안 썼다" 는 거짓말이 된다(#1205 §4.2).
//  3) ★팀은 층이 아니라 라벨이다(#1336 §3.4): `teamId` 는 여기서도 권한 판정에
//     입력되지 않는다 — 그룹핑 키로만 쓰인다. 팀 소계는 L0(전수 가시) 안에서만
//     계산되므로 새 유출 경로가 없다(#1336 §5.2).
//  4) ★미지정은 버킷이다(#1336 §6): teamId=null 행을 숨기지도, 임의 팀에 밀어
//     넣지도 않는다. 미지정 소계가 합계에서 새면 팀 소계의 합 ≠ 총계가 되어
//     화면이 거짓말한다.

import { scrubIdentityLike, type TeamUsageByProject } from "./teamUsage";
import type { OrgRole } from "./orgStructure";

// ════════════════════════════════════════════════════════════════════════════
// 1. 스코프 상한 — 조직은 25 를 넘을 수 있다 (#1333 §8.1 Phase 2)
// ════════════════════════════════════════════════════════════════════════════

/**
 * 조직 롤업이 한 응답에 합산하는 프로젝트 상한. 팀 화면의 25(`capProjectScope`
 * 기본값)로는 조직이 잘리므로 올린다 — 단 ★잘린 개수를 밝히는 규약은 그대로다:
 * 이 값은 `capProjectScope(ids, ORG_USAGE_MAX_PROJECTS_IN_SCOPE)` 의 인자로만
 * 쓰이고, 넘치면 `omitted` 가 봉투(`projectsOmitted`)에 실린다. 조용한 절단은
 * 상한을 올려도 금지다.
 */
export const ORG_USAGE_MAX_PROJECTS_IN_SCOPE = 100;

// ════════════════════════════════════════════════════════════════════════════
// 2. ★불변식 S ⊆ visible(u) — 역할 지름길이 아니라 집합 포함 검사
// ════════════════════════════════════════════════════════════════════════════

/**
 * 이 사람이 조직 롤업에서 **볼 수 있는** 프로젝트 집합.
 *
 * 사장님 승인 방침(2026-08-24): 조직 관리자(org_owner/org_admin)는 결합
 * 프로젝트 **전수**의 집계를 본다. org_member 는 조직 집계 열람 권한이 없다 —
 * 자기 프로젝트는 기존 `/team` 화면(`getTeamUsageSummary`)에서 본다. 여기서
 * 부분집합을 돌려주면 그 합계가 "조직 전체" 로 읽혀 불변식이 깨지므로, 전수
 * 아니면 공집합이다. 멤버가 아닌 사람(null)도 공집합 — 존재 비노출과 겹친다.
 */
export function resolveOrgVisibleProjects(
  role: OrgRole | null,
  boundProjectIds: ReadonlyArray<string>
): string[] {
  if (role === "org_owner" || role === "org_admin") return [...boundProjectIds];
  return [];
}

/** S ⊆ visible 인가. 총계를 싣기 전 반드시 이 검사를 지난다. */
export function isScopeVisible(
  scopeIds: ReadonlyArray<string>,
  visibleIds: ReadonlyArray<string>
): boolean {
  const visible = new Set(visibleIds);
  return scopeIds.every((id) => visible.has(id));
}

export type OrgUsageAccess =
  | { kind: "full" }
  | { kind: "restricted" };

/**
 * 총계를 서빙할지 판정한다. ★판정 근거는 집합 포함이지 역할 문자열이 아니다 —
 * 역할은 `resolveOrgVisibleProjects` 를 통해서만 집합에 반영된다.
 */
export function decideOrgUsageAccess(
  role: OrgRole | null,
  scopeIds: ReadonlyArray<string>
): OrgUsageAccess {
  const visible = resolveOrgVisibleProjects(role, scopeIds);
  return isScopeVisible(scopeIds, visible)
    ? { kind: "full" }
    : { kind: "restricted" };
}

// ════════════════════════════════════════════════════════════════════════════
// 3. restricted 봉투 — ★숫자 필드 자체가 없다 (0 으로 접히는 경로 차단)
// ════════════════════════════════════════════════════════════════════════════

export const ORG_SCOPE_DENIED_CODE = "org_scope_denied";

/** ★조직·프로젝트의 존재를 확인해 주지 않는 한 문장(존재 비노출). */
export const ORG_SCOPE_DENIED_NOTE =
  "조직 전체 사용량은 조직 관리자만 볼 수 있습니다.";

export type OrgUsageRestricted = {
  restricted: true;
  /** 무엇이 있어야 보이나. ★조직·프로젝트 식별자는 담지 않는다(#1205 §4.2). */
  requires: "org_admin";
  reasonCode: typeof ORG_SCOPE_DENIED_CODE;
  reason: string;
  generatedAt: string;
};

/**
 * 권한 밖 호출의 응답. ★`totals`·`byProject`·`byTeam` 필드가 **아예 없다** —
 * 화면이 실수로 0 으로 접을 값 자체를 보내지 않는다. 멤버가 아닌 사람과
 * org_member 가 같은 모양을 받는다(존재 비노출).
 */
export function buildOrgUsageRestricted(nowMs: number): OrgUsageRestricted {
  return {
    restricted: true,
    requires: "org_admin",
    reasonCode: ORG_SCOPE_DENIED_CODE,
    reason: ORG_SCOPE_DENIED_NOTE,
    generatedAt: new Date(nowMs).toISOString(),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 4. 팀 접기 — 층을 늘리지 않고 L0 표에서 그룹핑 (#1336 §5)
// ════════════════════════════════════════════════════════════════════════════

export type OrgUsageByProjectRow = TeamUsageByProject & {
  /** 조직 안 팀 라벨. null = 미지정 버킷(#1336 §6). */
  teamId: string | null;
  /** 팀 표시명. 팀 문서를 못 찾으면 null — 화면이 "알 수 없는 팀" 으로 그린다. */
  teamDisplayName: string | null;
};

export type OrgUsageByTeam = {
  /** null = 미지정 버킷. ★숨기지도, 임의 팀에 밀어 넣지도 않는다. */
  teamId: string | null;
  teamDisplayName: string | null;
  costUsd: number;
  tokens: number;
  /** 이 팀으로 접힌 프로젝트 수(집계 창 안에 행이 있는 프로젝트 기준). */
  projects: number;
};

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * `byProject` 행을 결합표의 `teamId` 로 팀 소계로 접는다. BQ 변경 0 — Node
 * 그룹핑만이다(#1336 §7). ★불변식: Σ byTeam = Σ byProject (미지정 버킷 포함,
 * 각 버킷 6자리 반올림 오차 이내) — 미지정이 새면 화면이 거짓말한다.
 */
export function foldOrgTeams(
  byProject: ReadonlyArray<TeamUsageByProject>,
  teamIdByProject: ReadonlyMap<string, string | null>,
  teamNameById: ReadonlyMap<string, string>
): { byProject: OrgUsageByProjectRow[]; byTeam: OrgUsageByTeam[] } {
  // ★팀 표시명도 사람이 짓는다 — 프로젝트명·멤버 표시명과 같은 값 수준 신원
  //   차단 문을 지난다(이메일로 지은 팀명이 봉투에 실리지 않게).
  const teamLabel = (teamId: string | null): string | null =>
    teamId === null ? null : scrubIdentityLike(teamNameById.get(teamId) ?? null);

  const rows: OrgUsageByProjectRow[] = byProject.map((p) => {
    const teamId = teamIdByProject.get(p.projectId) ?? null;
    return {
      ...p,
      teamId,
      teamDisplayName: teamLabel(teamId),
    };
  });

  const buckets = new Map<
    string | null,
    { costUsd: number; tokens: number; projects: number }
  >();
  for (const row of rows) {
    const cur = buckets.get(row.teamId) ?? {
      costUsd: 0,
      tokens: 0,
      projects: 0,
    };
    cur.costUsd += row.costUsd;
    cur.tokens += row.tokens;
    cur.projects += 1;
    buckets.set(row.teamId, cur);
  }

  const byTeam: OrgUsageByTeam[] = [...buckets.entries()]
    .map(([teamId, v]) => ({
      teamId,
      teamDisplayName: teamLabel(teamId),
      costUsd: round6(v.costUsd),
      tokens: v.tokens,
      projects: v.projects,
    }))
    // 비용 내림차순, ★미지정(null)은 맨 뒤 — 배정 CTA 자리가 고정되게.
    .sort((a, b) => {
      if ((a.teamId === null) !== (b.teamId === null)) {
        return a.teamId === null ? 1 : -1;
      }
      return (
        b.costUsd - a.costUsd ||
        (a.teamId ?? "").localeCompare(b.teamId ?? "")
      );
    });

  return { byProject: rows, byTeam };
}
