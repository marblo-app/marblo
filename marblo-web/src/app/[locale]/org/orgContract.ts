/**
 * 조직 봉투 계약 + 착지 규칙 — `getOrganizations` 응답을 화면이 읽을 수 있는
 * 모양으로 접고, "로그인하면 어디로" 를 순수 함수로 판정한다.
 *
 * 정본: `docs/org-analytics-b2b-design-2026-08-31.md` §3(#1333) ·
 *       `v3/docs/org-access-and-login-flow-2026-08-24.md` §5.8(착지 규칙).
 * 서버 구현은 `v3/functions/src/index.ts` 의 `getOrganizations` 콜러블.
 *
 * ★"조직 없음" 상태는 존재하지 않는다(§5.1) — 서버가 파생 개인 조직을 목록에
 *   항상 실어 보내고, 여기서도 그 불변식을 정규화가 지킨다.
 * ★`detail: null` 은 "없다" 와 "권한 없다" 를 구분해 주지 않는다(존재 비노출).
 *   화면은 그 구분을 시도하지 않고 §5.8 의 기본 조직으로 조용히 착지한다.
 *
 * ★React·firebase 무의존. 그래서 `tsx --test` 로 그대로 돈다.
 */

import type { UsageCell } from "../team/teamUsageContract";

// ── 봉투 원형 (서버 미러) ───────────────────────────────────────────────────

/** 조직 역할. 프로젝트 역할과 **다른 축**이다(`v3/src/types/organization.ts`). */
export type OrgRole = "org_owner" | "org_admin" | "org_member";

export type OrgListEntry = {
  orgId: string;
  /** 표시명. 개인 조직은 서버가 이름을 싣지 않는다(null). */
  displayName: string | null;
  isPersonal: boolean;
  role: OrgRole;
};

export type OrgTeamEntry = {
  teamId: string;
  displayName: string;
  archived: boolean;
};

export type OrgBindingEntry = {
  bindingId: string;
  projectId: string;
  /** null = 팀 미지정("없다고 답함", #1336 §6). */
  teamId: string | null;
  effectiveFromMs: number | null;
  recordedAtMs: number | null;
};

export type OrgDetail = {
  orgId: string;
  displayName: string | null;
  isPersonal: boolean;
  myRole: OrgRole;
  /** ★개인 조직엔 팀 개념이 아예 없다(#1336 §4.1) — null 이면 화면이 그리지 않는다. */
  teams: OrgTeamEntry[] | null;
  /** 결합 목록은 조직 편제 관리 정보 — org_admin+ 에게만. 아니면 null. */
  bindings: OrgBindingEntry[] | null;
};

export type OrgsEnvelope = {
  generatedAt: string | null;
  orgs: OrgListEntry[];
  /** null = 없거나 권한 없음. **구분해 주지 않는다**(존재 비노출). */
  detail: OrgDetail | null;
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

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** ★손상 역할은 org_member 로 접지 않는다(fail-closed, 서버와 같은 규율). */
function orgRole(v: unknown): OrgRole | null {
  return v === "org_owner" || v === "org_admin" || v === "org_member"
    ? v
    : null;
}

function normalizeOrgList(v: unknown): OrgListEntry[] {
  return arr(v).flatMap((row) => {
    const r = asRecord(row);
    const orgId = str(r?.orgId);
    const role = orgRole(r?.role);
    if (!r || !orgId || !role) return [];
    return [
      {
        orgId,
        displayName: str(r.displayName),
        isPersonal: r.isPersonal === true,
        role,
      },
    ];
  });
}

function normalizeTeams(v: unknown): OrgTeamEntry[] | null {
  // ★null 과 [] 를 가른다 — null 은 "팀 개념 없음"(개인 조직), [] 는 "팀 0개".
  if (!Array.isArray(v)) return null;
  return v.flatMap((row) => {
    const r = asRecord(row);
    const teamId = str(r?.teamId);
    const displayName = str(r?.displayName);
    if (!r || !teamId || !displayName) return [];
    return [{ teamId, displayName, archived: r.archived === true }];
  });
}

function normalizeBindings(v: unknown): OrgBindingEntry[] | null {
  // ★null 과 [] 를 가른다 — null 은 "권한으로 안 실림"(org_member), [] 는 "결합 0건".
  if (!Array.isArray(v)) return null;
  return v.flatMap((row) => {
    const r = asRecord(row);
    const bindingId = str(r?.bindingId);
    const projectId = str(r?.projectId);
    if (!r || !bindingId || !projectId) return [];
    return [
      {
        bindingId,
        projectId,
        teamId: str(r.teamId),
        effectiveFromMs: num(r.effectiveFromMs),
        recordedAtMs: num(r.recordedAtMs),
      },
    ];
  });
}

function normalizeDetail(v: unknown): OrgDetail | null {
  const r = asRecord(v);
  if (!r) return null;
  const orgId = str(r.orgId);
  const myRole = orgRole(r.myRole);
  if (!orgId || !myRole) return null;
  return {
    orgId,
    displayName: str(r.displayName),
    isPersonal: r.isPersonal === true,
    myRole,
    teams: normalizeTeams(r.teams),
    bindings: normalizeBindings(r.bindings),
  };
}

/** 콜러블 응답 → 화면이 읽는 봉투. 어떤 입력이 와도 던지지 않는다. */
export function normalizeOrganizations(raw: unknown): OrgsEnvelope {
  const r = asRecord(raw) ?? {};
  return {
    generatedAt: str(r.generatedAt),
    orgs: normalizeOrgList(r.orgs),
    detail: normalizeDetail(r.detail),
  };
}

// ── ★착지 규칙 — §5.8 그대로. 새로 발명하지 않는다 ─────────────────────────

/**
 * "마지막 본 조직" 저장 키. ★개인 조직은 orgId(`personal_<uid>`) 대신
 * `"me"` 센티널로 적는다 — uid 를 저장소에 흘리지 않고, `/org/me` 별칭
 * 규약(#1333 §3.1)과 같은 모양을 유지한다.
 */
export const ORG_LAST_SEEN_STORAGE_KEY = "marblo.org.lastSeenOrgId";
export const PERSONAL_ORG_SENTINEL = "me";

export type OrgLanding =
  | { kind: "me" }
  | { kind: "org"; orgId: string }
  | { kind: "choose" };

/**
 * §5.8 조직 착지 규칙:
 *
 * ```
 * 1) 마지막으로 본 조직 (localStorage)  — 단 여전히 멤버인지 서버가 확인한다
 * 2) 없으면: 비개인 조직이 정확히 하나면 그것
 * 3) 여럿이면: 조직 선택 화면 (개인 조직도 목록에 포함)
 * 4) 비개인 조직이 없으면: 개인 조직
 * ```
 *
 * ★1번의 "서버가 확인" = `orgs`(서버가 uid 로 만든 멤버십 목록)와의 교집합.
 *   localStorage 는 사용자가 고칠 수 있으므로 임의 orgId 를 넣어도 여기서
 *   무시되고, "그 조직은 없습니다" 도 "볼 수 없습니다" 도 아닌 기본 조직으로
 *   조용히 떨어진다(존재 비노출).
 * ★2번은 "정확히 하나" 다 — 여럿이면 **자동 착지하지 않는다**(대행사가 고객 A
 *   화면을 열어 둔 채 B 와 회의하는 사고 방지).
 */
export function resolveOrgLanding(
  orgs: OrgListEntry[],
  lastSeenOrgId: string | null
): OrgLanding {
  if (lastSeenOrgId === PERSONAL_ORG_SENTINEL) return { kind: "me" };
  if (lastSeenOrgId !== null) {
    const hit = orgs.find((o) => o.orgId === lastSeenOrgId);
    // 센티널 이전에 적힌 원시 개인 orgId 도 개인 조직으로 푼다.
    if (hit)
      return hit.isPersonal
        ? { kind: "me" }
        : { kind: "org", orgId: hit.orgId };
    // 멤버가 아니다 → 무시하고 다음 규칙으로.
  }
  const nonPersonal = orgs.filter((o) => !o.isPersonal);
  if (nonPersonal.length === 1)
    return { kind: "org", orgId: nonPersonal[0].orgId };
  if (nonPersonal.length > 1) return { kind: "choose" };
  return { kind: "me" };
}

/** 착지 결과 → 로케일 접두 없는 경로. 링크는 호출부가 `localeHref` 로 감싼다. */
export function landingPath(landing: OrgLanding): string {
  switch (landing.kind) {
    case "me":
      return "/org/me";
    case "org":
      return `/org/${landing.orgId}`;
    case "choose":
      return "/org";
  }
}

/** 조직 목록 항목 → 경로. ★개인 조직은 `/org/me` 하나로만 연다(#1333 §3.1). */
export function orgPath(
  entry: Pick<OrgListEntry, "orgId" | "isPersonal">
): string {
  return entry.isPersonal ? "/org/me" : `/org/${entry.orgId}`;
}

// ── 스위처 노출 조건 ────────────────────────────────────────────────────────

/**
 * ★조직이 하나뿐이면 스위처를 보이지 않는다(#1333 — 개인 조직은 모두에게
 * 있으므로 "하나뿐" = 개인 조직만 있는 상태다). 대부분이 그렇고, 보이면 그게
 * 잡음이다.
 */
export function isSwitcherVisible(orgs: OrgListEntry[]): boolean {
  return orgs.length > 1;
}

// ── 조직 전체 사용량 칸 판정 ────────────────────────────────────────────────

/**
 * L0(조직 전체 사용량) 칸의 상태를 역할로 판정한다.
 *
 * - `org_member` → **`restricted`.** 팀 분해를 못 본다(#1333 §6 권한표).
 *   ★빈칸도 0 도 아니다 — "무엇이 필요한지"(`requires`) 를 함께 싣는다
 *   (#1205 §4.2 여섯 번째 부재). 조직·프로젝트 식별자는 담지 않는다.
 * - `org_admin`/`org_owner` → **`unwired`.** 조직 롤업 콜러블(`getOrgUsageSummary`)
 *   은 Phase 2 다(#1333 §8) — 아직 계약 미배선이고, 그걸 0 이나 빈칸으로
 *   그리지 않기 위해 `restricted` 종류를 롤업보다 먼저 만든다(§8 "restricted
 *   셀 종류가 없는 채 조직 화면을 먼저 지으면 0 으로 접는 경로가 생긴다").
 */
export function deriveOrgTotalsCell(myRole: OrgRole): UsageCell {
  if (myRole === "org_member") {
    return {
      kind: "restricted",
      requires: "org_admin",
      reasonCode: "org_scope_denied",
      reason: null,
    };
  }
  return { kind: "unwired" };
}

// ── 결합표 접기 — 추가 전용 행 → 현재 유효 결합 ─────────────────────────────

/**
 * `org_project_bindings` 는 추가 전용이다 — 재배정·정정은 새 행이다. 화면의
 * "결합된 프로젝트" 목록은 프로젝트마다 **가장 최근에 유효해진 행 하나**다.
 * 판정 키는 (effectiveFrom, recordedAt) 순 — 서버 `resolveBindingAt` 과 같은
 * 방향이고, 시각이 없는 행은 가장 오래된 것으로 접는다(fail-old).
 */
export function currentBindings(rows: OrgBindingEntry[]): OrgBindingEntry[] {
  const byProject = new Map<string, OrgBindingEntry>();
  for (const row of rows) {
    const prev = byProject.get(row.projectId);
    if (!prev || compareBindingRecency(row, prev) > 0) {
      byProject.set(row.projectId, row);
    }
  }
  return [...byProject.values()].sort((a, b) =>
    a.projectId < b.projectId ? -1 : a.projectId > b.projectId ? 1 : 0
  );
}

function compareBindingRecency(a: OrgBindingEntry, b: OrgBindingEntry): number {
  const ae = a.effectiveFromMs ?? -Infinity;
  const be = b.effectiveFromMs ?? -Infinity;
  if (ae !== be) return ae - be;
  const ar = a.recordedAtMs ?? -Infinity;
  const br = b.recordedAtMs ?? -Infinity;
  return ar - br;
}
