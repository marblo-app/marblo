/**
 * 조직 롤업 봉투 계약 — `getOrgUsageSummary` 응답을 화면이 읽는 모양으로 접는다.
 *
 * 정본: `docs/org-analytics-b2b-design-2026-08-31.md` §4.2 ·
 *       `docs/org-team-layer-design-2026-08-31.md` §5.
 * 서버 구현은 `v3/functions/src/index.ts` 의 `getOrgUsageSummary` +
 * `v3/functions/src/orgUsage.ts`(순수 판정).
 *
 * ★봉투는 teamUsage 계약을 계승한다 — 상태 5종·노트 코드·라벨이 같으므로
 *   정규화도 `normalizeTeamUsage` 를 그대로 지나고, 여기서는 조직 확장분
 *   (`restricted` 봉투 · `byTeam[]` · `byProject[].teamId` · 잘림 공개)만 접는다.
 * ★`restricted` 는 0 이 아니다: 서버가 숫자 필드 없는 봉투를 보내고, 여기서도
 *   숫자로 환원하는 경로를 타입 수준에서 남기지 않는다.
 *
 * ★React·firebase 무의존. 그래서 `tsx --test` 로 그대로 돈다.
 */

import {
  maskDisplayName,
  normalizeTeamUsage,
  type ByProjectRow,
  type TeamUsageEnvelope,
} from "../team/teamUsageContract";

// ── 봉투 원형 (서버 미러) ───────────────────────────────────────────────────

export type OrgUsageByTeamRow = {
  /** null = 미지정 버킷(#1336 §6) — 숨기지도, 임의 팀에 밀어 넣지도 않는다. */
  teamId: string | null;
  teamDisplayName: string | null;
  costUsd: number;
  tokens: number;
  projects: number;
};

export type OrgUsageByProjectRow = ByProjectRow & {
  teamId: string | null;
  teamDisplayName: string | null;
};

export type OrgUsageData =
  | {
      kind: "restricted";
      /** 무엇이 있어야 보이나 — 서버와 같은 역할 이름 하나뿐이다. */
      requires: "org_admin";
      reasonCode: string | null;
      reason: string | null;
    }
  | {
      kind: "data";
      envelope: TeamUsageEnvelope;
      byProject: OrgUsageByProjectRow[];
      byTeam: OrgUsageByTeamRow[];
      /** ★상한에 잘려 집계에서 빠진 프로젝트 수. 0 이 아니면 합계는 전체가 아니다. */
      projectsOmitted: number;
      projectsTruncatedNote: string | null;
      /** 집계 근거 라벨(ko 폴백) — "로그인한 계정 기준" 을 화면이 말하는 자리. */
      basisLabel: string | null;
      costLabel: string | null;
      costNotBillingNote: string | null;
      /**
       * ★조회 창의 실제 경계(티켓 EmHUecXSgXSyrF2XgJ8b). 서버는 이미
       * `teamUsage.fromDay`/`toDayExclusive` 를 보내지만 `normalizeTeamUsage`
       * 는 이 값을 옮기지 않아 화면이 "언제부터 언제까지" 를 말하지 못했다 —
       * `effectiveFrom`("게이트 발효일 이후")만 보이니 그 옆의 숫자가 "발효일
       * 부터의 합계" 로 읽혔다(오케가 정확히 이렇게 속았다). `windowToDay` 는
       * **포함 경계**로 바꿔서 낸다 — 서버의 `toDayExclusive` 를 그대로 보여주면
       * 실제로 안 걷힌 내일 날짜가 "이 날짜까지 걷었다" 로 읽힌다.
       */
      windowFromDay: string | null;
      windowToDay: string | null;
    };

// ── 방어적 정규화 (신뢰 경계) ───────────────────────────────────────────────

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function numOr0(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` 모양만 받는다. 아니면 null(지어내지 않는다). */
function dayString(v: unknown): string | null {
  return typeof v === "string" && DAY_RE.test(v) ? v : null;
}

/**
 * 서버의 `toDayExclusive`(배제 경계, `day < toDayExclusive`)를 화면이 말할
 * **포함** 마지막 날로 바꾼다. 그대로 보여주면 아직 안 걷힌 내일 날짜가
 * "이 날짜까지 걷었다" 로 읽힌다.
 */
function toInclusiveEndDay(toDayExclusive: string | null): string | null {
  if (toDayExclusive === null) return null;
  const d = new Date(`${toDayExclusive}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function normalizeByTeam(v: unknown): OrgUsageByTeamRow[] {
  return arr(v).flatMap((row) => {
    const r = asRecord(row);
    if (!r) return [];
    const teamId = str(r.teamId);
    return [
      {
        teamId,
        // ★팀명도 사람이 짓는다 — 멤버 표시명과 같은 마지막 문턱을 지난다.
        teamDisplayName: maskDisplayName(str(r.teamDisplayName)),
        costUsd: numOr0(r.costUsd),
        tokens: numOr0(r.tokens),
        projects: numOr0(r.projects),
      },
    ];
  });
}

function normalizeOrgByProject(v: unknown): OrgUsageByProjectRow[] {
  return arr(v).flatMap((row) => {
    const r = asRecord(row);
    const projectId = str(r?.projectId);
    if (!r || !projectId) return [];
    return [
      {
        projectId,
        // 프로젝트명은 서버가 값 수준 차단(scrubIdentityLike)을 이미 지났다 —
        // 팀 계약(normalizeByProject)과 같은 취급.
        projectName: str(r.projectName),
        costUsd: numOr0(r.costUsd),
        tokens: numOr0(r.tokens),
        teamId: str(r.teamId),
        teamDisplayName: maskDisplayName(str(r.teamDisplayName)),
      },
    ];
  });
}

/** 콜러블 응답 → 화면이 읽는 값. 어떤 입력이 와도 던지지 않는다. */
export function normalizeOrgUsage(raw: unknown): OrgUsageData {
  const r = asRecord(raw) ?? {};

  if (r.restricted === true) {
    return {
      kind: "restricted",
      requires: "org_admin",
      reasonCode: str(r.reasonCode),
      reason: str(r.reason),
    };
  }

  const envelope = normalizeTeamUsage(raw);
  const meta = asRecord(r.teamUsage);
  return {
    kind: "data",
    envelope,
    byProject: normalizeOrgByProject(r.byProject),
    byTeam: normalizeByTeam(r.byTeam),
    // ★조용한 절단 금지 — 서버가 센 잘린 개수를 그대로 실어 나른다.
    projectsOmitted: numOr0(meta?.projectsOmitted),
    projectsTruncatedNote: str(meta?.projectsTruncatedNote),
    basisLabel: str(meta?.basisLabel),
    costLabel: str(meta?.costLabel),
    costNotBillingNote: str(meta?.costNotBillingNote),
    windowFromDay: dayString(meta?.fromDay),
    windowToDay: toInclusiveEndDay(dayString(meta?.toDayExclusive)),
  };
}

// ── 표 그룹핑 — 층을 늘리지 않고 L0 표에서 접는다(#1336 §5) ─────────────────

export type OrgUsageTeamGroup = {
  team: OrgUsageByTeamRow;
  rows: OrgUsageByProjectRow[];
};

/**
 * `byTeam` 순서(비용 내림차순, 미지정 맨 뒤)대로 프로젝트 행을 팀 아래에 접는다.
 * ★소계에 잡혔는데 행이 안 보이거나, 행이 있는데 어느 소계에도 없는 프로젝트가
 *   생기지 않게 — 남는 행은 버리지 않고 미지정 그룹으로 보낸다(합계 보존).
 */
export function groupProjectsByTeam(
  byTeam: OrgUsageByTeamRow[],
  byProject: OrgUsageByProjectRow[]
): OrgUsageTeamGroup[] {
  const groups = byTeam.map((team) => ({
    team,
    rows: byProject
      .filter((p) => p.teamId === team.teamId)
      .sort(
        (a, b) =>
          b.costUsd - a.costUsd || a.projectId.localeCompare(b.projectId)
      ),
  }));
  const seen = new Set(byTeam.map((t) => t.teamId));
  const orphans = byProject.filter((p) => !seen.has(p.teamId));
  if (orphans.length > 0) {
    const unassigned = groups.find((g) => g.team.teamId === null);
    if (unassigned) {
      unassigned.rows.push(...orphans);
    } else {
      groups.push({
        team: {
          teamId: null,
          teamDisplayName: null,
          costUsd: orphans.reduce((acc, p) => acc + p.costUsd, 0),
          tokens: orphans.reduce((acc, p) => acc + p.tokens, 0),
          projects: orphans.length,
        },
        rows: orphans,
      });
    }
  }
  return groups;
}
