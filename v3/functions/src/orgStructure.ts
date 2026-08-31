// 조직 뼈대 Phase 1 — 순수 판정 로직(Firebase/BQ 무의존). `orgIdentity.ts` 와
// 같은 규약으로 index.ts 에서 떼어내 `node --test` 로 단위검증한다.
//
// 설계 정본:
//   docs/org-analytics-b2b-design-2026-08-31.md   (#1333 로드맵 Phase 1)
//   docs/org-team-layer-design-2026-08-31.md      (#1336 경량 팀 라벨 (C))
//   docs/org-onboarding-web-first-design-2026-08-31.md (#1338 firstAppLoginAt)
//   v3/src/types/organization.ts                  (저장 스키마 정본)
//
// ── ★이 모듈이 지키는 불변식 셋 ─────────────────────────────────────────────
//
//  1) **조직 역할은 조직 설정·청구만 준다. 프로젝트 내용은 프로젝트 역할이
//     준다**(organization.ts:15-19 주석이 정본). 이 파일의 어떤 판정도
//     "org 역할 → 프로젝트 내용 접근" 을 돌려주지 않는다.
//  2) **팀은 라벨이지 권한이 아니다**(#1336 §3.4). `teamId` 는 이 파일의 어떤
//     권한 판정 함수의 입력에도 등장하지 않는다. 팀 매핑이 틀리면 차트 행이
//     잘못 묶일 뿐, 행이 새지 않는다 — 그 성질을 지키는 것이 이 규율이다.
//  3) **계정 축과 익명 축을 섞지 않는다**(#1338 §4, telemetry-data-model-map §5).
//     `org_members`·`org_project_bindings` 는 계정 축 표다. 익명 축 식별자
//     (installId·clientId·gaKey·userKey…)가 이 표에 실리는 순간 링크표가 아닌
//     곳에 다리가 생긴다 — `assertOrgDocAxisPurity` 가 write 전에 던진다.

import {
  isPersonalOrgId,
  validateOrgDisplayName,
  validateTeamOrgIntake,
  type OrgNameRejection,
} from "./orgIdentity";

// ── 컬렉션 경로 상수 — Firestore 에 적히는 이름의 단일 출처 ──────────────────
//
// ★firestore.rules 의 서버 전용 차단 블록과 1:1 대응한다. 여기 이름을 바꾸면
//   룰의 match 경로도 같이 바꿔야 한다(룰 테스트가 다섯 컬렉션 전면 차단을
//   고정하고 있다).

export const ORGANIZATIONS_COLLECTION = "organizations";
export const ORG_MEMBERS_COLLECTION = "org_members";
export const ORG_PROJECT_BINDINGS_COLLECTION = "org_project_bindings";
export const ORG_TEAMS_COLLECTION = "org_teams";
export const ORG_NAME_HISTORY_COLLECTION = "org_name_history";

/** `{orgId}_{uid}` 결정적 id — 프로젝트 `memberRoles` 규약과 같다. */
export function orgMemberDocId(orgId: string, uid: string): string {
  return `${orgId}_${uid}`;
}

// ── 조직 역할 판정 ───────────────────────────────────────────────────────────

export const ORG_ROLES = ["org_owner", "org_admin", "org_member"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/**
 * 저장값 → 역할. 모르는 값은 **가장 좁은 역할로 접지 않고 null** 로 떨어뜨린다
 * — 손상 문서에 org_member 권한을 주는 것도 권한 부여다(fail-closed).
 */
export function normalizeOrgRole(raw: unknown): OrgRole | null {
  if (typeof raw !== "string") return null;
  return (ORG_ROLES as readonly string[]).includes(raw)
    ? (raw as OrgRole)
    : null;
}

/** 조직 설정·멤버·팀 편제를 만지는 역할인가(org_admin 이상). */
export function isOrgAdminRole(role: OrgRole | null): boolean {
  return role === "org_owner" || role === "org_admin";
}

/**
 * 팀 개명·보관·병합 권한(#1336 §4.4 `manage_org_teams`).
 * organization.ts `ORG_ROLE_PERMISSIONS` 의 org_owner·org_admin 과 같은 집합.
 */
export function canManageOrgTeams(role: OrgRole | null): boolean {
  return isOrgAdminRole(role);
}

/** 프로젝트 역할 축 — 결합 판정에 필요한 만큼만. 정본은 githubApp.ProjectRole. */
export type BindingProjectRole = "owner" | "admin" | "member" | "viewer";

/**
 * ★결합 쓰기(프로젝트를 조직·팀에 붙이기) 권한 — #1336 §4.4 그대로:
 * `org_admin`+ **또는** 그 프로젝트의 owner/admin **이면서 조직 멤버인 사람**.
 *
 * ★조직 역할만으로 프로젝트 내용이 열리는 게 아니냐는 질문에 대한 답:
 *   결합은 프로젝트 **내용**이 아니라 조직 **편제**다(어느 조직·팀 소속인지).
 *   org_admin 이 결합을 만들어도 그 프로젝트의 태스크·원장은 여전히 프로젝트
 *   역할이 없으면 못 본다 — 불변식 1 이 그대로 산다.
 *
 * ★비멤버 프로젝트 관리자(외부 대행사, #1205 §2.5-6)는 결합을 못 만든다 —
 *   orgRole == null 이면 프로젝트 owner 라도 거부. 결합·팀 UI 전체가 조직
 *   문맥이다(#1336 §4.4 표 마지막 행).
 */
export function canBindProjectToOrg(input: {
  orgRole: OrgRole | null;
  projectRole: BindingProjectRole | null;
}): boolean {
  if (input.orgRole === null) return false;
  if (isOrgAdminRole(input.orgRole)) return true;
  return input.projectRole === "owner" || input.projectRole === "admin";
}

// ── 조직 생성 검증 — displayName 필수, 개인 조직 예외 ────────────────────────

export type OrgCreateRejection =
  | OrgNameRejection
  | "name_required_for_team_plan"
  | "org_id_required";

export type OrgCreateValidation =
  | { ok: true; orgId: string; displayName: string | null; isPersonal: boolean }
  | { ok: false; reason: OrgCreateRejection };

/**
 * ★조직 생성 시 `displayName` 필수 — 단 **개인 조직(`personal_<uid>`)은 예외**다.
 * #1336 이 "개인 조직엔 팀 개념이 아예 안 보인다" 로 정한 것과 같은 결:
 * 혼자인 사람에게 조직명을 묻는 것은 빈 개념을 파는 것이고, 개인 조직은
 * 화면에서 이름이 아니라 "내 프로젝트" 로 그려진다.
 *
 * 비개인 조직의 이름 검증은 `validateTeamOrgIntake`(기존, #1204)를 그대로 쓴다
 * — 규약을 두 벌 만들지 않는다.
 */
export function validateOrgCreate(input: {
  orgId: string;
  displayName: string | null | undefined;
}): OrgCreateValidation {
  if (typeof input.orgId !== "string" || input.orgId.trim().length === 0) {
    return { ok: false, reason: "org_id_required" };
  }
  if (isPersonalOrgId(input.orgId)) {
    // 개인 조직: 이름이 와도 검증만 통과하면 받고, 없어도 된다.
    if (input.displayName == null || input.displayName.trim().length === 0) {
      return {
        ok: true,
        orgId: input.orgId,
        displayName: null,
        isPersonal: true,
      };
    }
    const validation = validateOrgDisplayName(input.displayName);
    if (!validation.ok) return { ok: false, reason: validation.reason };
    return {
      ok: true,
      orgId: input.orgId,
      displayName: validation.value,
      isPersonal: true,
    };
  }
  const intake = validateTeamOrgIntake({
    displayName: input.displayName,
    orgId: input.orgId,
  });
  if (!intake.ok) return { ok: false, reason: intake.reason };
  return {
    ok: true,
    orgId: intake.orgId,
    displayName: intake.displayName,
    isPersonal: false,
  };
}

// ── 팀 라벨 — 표기 정규화 중복 가드 (#1336 §4.3) ────────────────────────────

/**
 * 팀명 정규화 — **동치 접기(대소문자·공백·전각)까지만** 한다.
 *
 * NFKC(전각 접기) → 연속 공백 접기 → trim → 소문자 접기. `Platform`·`platform`·
 * 전각 공백 낀 `Platform`·`Ｐｌａｔｆｏｒｍ` 은 전부 같은 키로 접힌다. 반면 `플랫폼` 과
 * `Platform` 은 **다른 팀이다** — 번역 동치까지 접으면 오배정이 생기고, 그건
 * 사람이 병합으로 정리할 일이다(#1336 §4.3).
 */
export function normalizeTeamName(raw: string): string {
  return raw.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

/** 중복 검사에 필요한 최소 모양. Firestore 문서 전체를 요구하지 않는다. */
export interface OrgTeamLike {
  id: string;
  orgId: string;
  displayName: string;
  normalizedName: string;
  archivedAtMs?: number | null;
}

export type TeamCreateRejection =
  | OrgNameRejection
  | "personal_org_has_no_teams";

export type TeamCreateDecision =
  | { ok: true; action: "create"; displayName: string; normalizedName: string }
  | { ok: true; action: "reuse"; team: OrgTeamLike }
  | { ok: false; reason: TeamCreateRejection };

/**
 * ★팀 생성 판정 — (B)안(자유 입력 문자열)의 함정을 생성 지점에서 막는다.
 *
 * - 정규화 일치가 있으면 **생성하지 않고 그 팀을 돌려준다**(#1336 §4.3 —
 *   "같은 이름의 팀이 이미 있어 그 팀으로 배정했습니다"). `Platform` 을 치면
 *   `platform` 팀이 재사용된다.
 * - ★유일성은 **조직 안에서만** 본다 — `existingTeams` 는 호출부가 그 조직의
 *   팀만 넘긴다(전역 유일 검사라는 것이 애초에 불가능한 모양이다).
 * - 보관된 팀은 재사용 대상이 아니다 — 보관은 "이 편제는 끝났다" 는 뜻이고,
 *   같은 이름의 새 팀은 새 편제다(과거 결합 행은 옛 id 를 그대로 가리킨다).
 * - ★개인 조직엔 팀 개념이 아예 없다(#1336 §4.1) — 콤보도 미지정 버킷도 없다.
 * - 이름 검증은 조직 표시명 규약(`validateOrgDisplayName`)의 축소 복제가 아니라
 *   **그대로 재사용**이다 — 새 규약을 만들지 않는다(#1336 §3.1).
 */
export function decideTeamCreate(input: {
  rawDisplayName: string;
  existingTeams: readonly OrgTeamLike[];
  isPersonalOrg: boolean;
}): TeamCreateDecision {
  if (input.isPersonalOrg) {
    return { ok: false, reason: "personal_org_has_no_teams" };
  }
  const validation = validateOrgDisplayName(input.rawDisplayName);
  if (!validation.ok) return { ok: false, reason: validation.reason };
  const normalizedName = normalizeTeamName(validation.value);
  const duplicate = input.existingTeams.find(
    (t) => t.normalizedName === normalizedName && t.archivedAtMs == null,
  );
  if (duplicate) return { ok: true, action: "reuse", team: duplicate };
  return {
    ok: true,
    action: "create",
    displayName: validation.value,
    normalizedName,
  };
}

// ── 결합표 — 시점 해석과 멱등 쓰기 판정 ─────────────────────────────────────

/**
 * 결합 행의 최소 모양. `orgIdentity.OrgProjectBindingLike` + `teamId`.
 * (저쪽 타입을 확장하지 않고 다시 적는 이유: 이 파일의 판정은 `teamId` 가
 * 필수이고, 확장 import 는 "teamId 없는 행" 을 조용히 통과시킨다.)
 */
export interface OrgProjectBindingRowLike {
  projectId: string;
  orgId: string;
  /** null = 팀 미지정("없다고 답함"). undefined 를 받지 않는다 — 판단 강제. */
  teamId: string | null;
  effectiveFromMs: number;
  recordedAtMs: number;
}

/**
 * 어떤 시점의 유효 결합 행. `resolveOrgIdAt`(orgIdentity)과 같은 정렬 규약 —
 * 같은 `effectiveFromMs` 가 둘이면 나중에 기록된 행(정정)이 이긴다.
 * 팀 해석(`resolveTeamIdAt`)이 조직 해석과 다른 행을 고르면 안 되므로,
 * 행 단위로 한 번만 해석하고 둘 다 여기서 읽는다.
 */
export function resolveBindingAt(
  bindings: readonly OrgProjectBindingRowLike[],
  projectId: string,
  atMs: number,
): OrgProjectBindingRowLike | null {
  const applicable = bindings
    .filter((b) => b.projectId === projectId && b.effectiveFromMs <= atMs)
    .sort(
      (a, b) =>
        a.effectiveFromMs - b.effectiveFromMs ||
        a.recordedAtMs - b.recordedAtMs,
    );
  return applicable[applicable.length - 1] ?? null;
}

/** 어떤 시점에 이 프로젝트가 어느 팀 것이었나. #1336 §3.2 `resolveTeamIdAt`. */
export function resolveTeamIdAt(
  bindings: readonly OrgProjectBindingRowLike[],
  projectId: string,
  atMs: number,
): string | null {
  return resolveBindingAt(bindings, projectId, atMs)?.teamId ?? null;
}

export type BindingWritePlan =
  | { action: "noop"; current: OrgProjectBindingRowLike }
  | { action: "append"; row: OrgProjectBindingRowLike };

/**
 * ★결합 쓰기 멱등 판정. 지금 유효한 결합이 이미 같은 (orgId, teamId) 이면
 * **행을 덧붙이지 않는다** — 재시도·더블클릭이 정정 행 파도를 만들면 추가전용
 * 표의 이력이 소음으로 덮인다. 값이 하나라도 다르면 새 행(재배정·정정)이다 —
 * 기존 행은 절대 고치지 않는다(추가 전용).
 */
export function planBindingWrite(input: {
  bindings: readonly OrgProjectBindingRowLike[];
  projectId: string;
  orgId: string;
  teamId: string | null;
  nowMs: number;
}): BindingWritePlan {
  const current = resolveBindingAt(
    input.bindings,
    input.projectId,
    input.nowMs,
  );
  if (
    current &&
    current.orgId === input.orgId &&
    current.teamId === input.teamId
  ) {
    return { action: "noop", current };
  }
  return {
    action: "append",
    row: {
      projectId: input.projectId,
      orgId: input.orgId,
      teamId: input.teamId,
      effectiveFromMs: input.nowMs,
      recordedAtMs: input.nowMs,
    },
  };
}

// ── firstAppLoginAt — forward-only 스탬프 (#1338 §7 ④) ──────────────────────

export type FirstAppLoginStampPlan =
  | { stamp: true; atMs: number }
  | { stamp: false; reason: "already_stamped" };

/**
 * ★앱 첫 로그인 스탬프는 **없을 때 한 번만** 찍는다. 이미 값이 있으면 어떤
 * 입력에도 덮어쓰지 않는다(forward-only) — "첫" 이라는 낱말이 데이터 성질이다.
 * 손상값(문자열·0·음수)도 "있음" 으로 친다: 덮어쓰는 쪽이 항상 더 위험하다.
 */
export function planFirstAppLoginStamp(
  existing: unknown,
  nowMs: number,
): FirstAppLoginStampPlan {
  if (existing === null || existing === undefined) {
    return { stamp: true, atMs: nowMs };
  }
  return { stamp: false, reason: "already_stamped" };
}

// ── 축 순수성 — 계정 축 표에 익명 축 식별자를 싣지 않는다 ────────────────────

/**
 * 익명 축 식별자 키. `org_members`·`org_project_bindings`(계정 축) write
 * 페이로드에 나타나면 안 된다 — `assertAxisPurity`(telemetry-data-model-map §5)
 * 와 같은 규율의 조직 축 판이다. 초대 토큰을 다운로드에 싣지 않는 이유
 * (#1338 §4 (A)안 기각 — "그 표가 명부가 된다")가 그대로 이 목록의 근거다.
 *
 * `LEDGER_FORBIDDEN_ORG_KEYS`(orgIdentity)와 대칭: 저쪽은 원장에 조직 정체성이
 * 들어가는 것을 막고, 이쪽은 조직 표에 익명 축이 들어가는 것을 막는다.
 */
export const ORG_DOC_FORBIDDEN_AXIS_KEYS: readonly string[] = [
  "installId",
  "clientId",
  "installClientId",
  "gaKey",
  "ga_key",
  "userKey",
  "user_key",
  "pseudonymousId",
  "inviteToken",
];

/**
 * 조직 축 write 페이로드의 축 순수성 검사. 섞였으면 던진다 — write 전에,
 * 시끄럽게(`assertNoOrgIdentityInLedgerPayload` 와 같은 태도).
 */
export function assertOrgDocAxisPurity(payload: Record<string, unknown>): void {
  const walk = (value: unknown, path: string, depth: number): void => {
    if (depth > 8 || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${path}[${i}]`, depth + 1));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (ORG_DOC_FORBIDDEN_AXIS_KEYS.includes(key)) {
        throw new Error(
          `조직 축(계정 축) 문서에 익명 축 식별자가 있습니다: ${path}${
            path ? "." : ""
          }${key} — ` +
            `익명 축과 계정 축의 유일한 다리는 링크표입니다. 이 표에 싣지 마세요.`,
        );
      }
      walk(child, `${path}${path ? "." : ""}${key}`, depth + 1);
    }
  };
  walk(payload, "", 0);
}
