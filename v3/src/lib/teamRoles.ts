/**
 * 멤버 role 기반 권한 판정 (순수 함수 — firebase 의존 없음, 유닛테스트 대상).
 *
 * 머지(코드 랜딩 = 앱 내 Merge 버튼 + merged→DONE 완료 처리)는 owner/admin 만
 * 가능하다. member 는 PR 을 올리고(REVIEW 제출) admin 이 랜딩한다. UI 게이트
 * (WorktreeTab / App.tsx 화해 루프)와 Firestore 룰(REVIEW→DONE 전이)이 같은
 * 판정을 공유하도록 여기에 모은다.
 *
 * admin 승격/강등은 owner 전용이다("admin=owner 가 지정"). admin 은 member/
 * viewer 의 role 만 바꿀 수 있고, 다른 admin 을 건드릴 수 없다.
 */
import type { InvitationRole } from "../types/invitation";
import { ROLE_PERMISSIONS } from "../types/invitation";

export function canMergeAsRole(
  role: InvitationRole | null | undefined,
): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes("merge") ?? false;
}

/**
 * 보드 티켓을 만들고/고치고/지울 수 있는가(= ROLE_PERMISSIONS 의 `write`).
 *
 * ★MIRROR — `firestore.rules` 의 `canWriteProjectScoped(projectId)` 와 **같은 판정**이다.
 * 룰이 최종 게이트고 이 함수는 화면의 1차 게이트다. 두 벌인 이유는 룰이 TS 를
 * import 할 수 없어서고(TEAM_COLLAB_PLANS 와 같은 규약), drift 는
 * `tests/unit/task-write-role-drift.test.ts` 가 소스 스캔으로 잡는다.
 *
 * 왜 생겼나: 룰이 원래 `isProjectMember` 만 봐서 "읽기 전용"으로 초대한 viewer
 * 가 보드 티켓을 만들고 지울 수 있었다(REVIEW→DONE 만 막혔다). 역할표는 viewer
 * 에게 `read` 만 준다. 저장소 push 는 이미 같은 `write` 퍼미션으로 막고 있었다
 * (`functions/src/githubApp.ts` 의 `roleCanWriteRepo`) — 게이트를 하나로 맞춘다.
 *
 * ★삭제도 이 축이다. `ROLE_PERMISSIONS` 의 `delete` 는 티켓 삭제 축이 아니다
 * (invitation.ts 주석 참조) — member 의 기존 보드 삭제 동작을 죽이지 않는다.
 */
export function canWriteTasksAsRole(
  role: InvitationRole | null | undefined,
): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes("write") ?? false;
}

/**
 * 보드가 읽기전용인 **이유** — 화면이 두 사유를 갈라 보여주기 위한 축.
 *
 *  - "role": 역할 미달(viewer). 관리자에게 역할 상향을 요청하면 풀린다.
 *  - "plan": 오너의 요금제에 팀 협업 엔타이틀먼트(team/team_plus/enterprise)
 *            가 없다. 오너가 업그레이드해야 풀린다.
 *
 * 조용한 실패 금지 — permission-denied 를 그대로 보여주면 사용자는 룰 드리프트
 * 로 오인한다. 이 판정이 UI 문구의 단일 근거다.
 */
export type BoardReadOnlyReason = "role" | "plan" | null;

export interface BoardWriteGate {
  canWrite: boolean;
  reason: BoardReadOnlyReason;
}

/**
 * 보드 쓰기 게이트의 클라이언트 판정 (티켓 gT9EXiONpzqFwY1xjc3n).
 *
 * ★MIRROR — `firestore.rules` 의 `canWriteProjectScoped(projectId)` 와 **같은 판정**이다:
 *   오너는 플랜과 무관하게 자기 보드에 쓴다(free 솔로 보존) → 역할 축(viewer
 *   배제) → 플랜 축(오너의 팀 협업 엔타이틀먼트). 룰이 최종 게이트고 이 함수는
 *   화면의 1차 게이트 + 사유 표시다.
 *
 * `ownerPlanHasTeamCollab` 의 출처: 오너 본인 화면은 자기 구독
 * (subscriptionStore → planLimits.getPlanLimits(plan).hasTeamCollab)으로 알 수
 * 있지만, **멤버는 오너의 구독 문서를 읽을 수 없다**(rules: subscriptions 는
 * 본인만 read). 멤버 화면은 서버 판정(getBoardAccess 콜러블)의 결과를 넘겨라.
 * 미상(undefined)은 null 사유의 낙관 통과로 접지 않고 **plan 미달로 접는다** —
 * 룰이 fail-closed 라 화면만 낙관하면 "쓸 수 있어 보이는데 저장이 죽는" 조용한
 * 실패가 된다.
 */
export function resolveBoardWriteGate(input: {
  role: InvitationRole | null | undefined;
  isProjectOwner: boolean;
  ownerPlanHasTeamCollab: boolean | undefined;
}): BoardWriteGate {
  if (input.isProjectOwner) return { canWrite: true, reason: null };
  if (!canWriteTasksAsRole(input.role)) return { canWrite: false, reason: "role" };
  if (input.ownerPlanHasTeamCollab !== true) {
    return { canWrite: false, reason: "plan" };
  }
  return { canWrite: true, reason: null };
}

/**
 * 구성원별 작업량(프로젝트 탭)을 볼 수 있는가.
 *
 * 멤버 관리와 **같은 게이트**다 — 작업량 표는 "누가 무엇을 얼마나 했나" 라는
 * 인사 성격의 정보라서, 멤버를 관리할 수 없는 사람에게 열어 줄 이유가 없다.
 * firestore.rules 의 isAdminOrOwner(=owner/admin) 와 같은 판정을 UI 에서
 * 재사용하기 위해 ROLE_PERMISSIONS 의 manage_members 에서 파생한다 — 별도
 * 목록을 두면 룰과 UI 가 조용히 갈라진다.
 */
export function canViewWorkload(
  role: InvitationRole | null | undefined,
): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes("manage_members") ?? false;
}

/**
 * 감사 로그(구성원의 앱 내 행위 기록)를 볼 수 있는가.
 *
 * 작업량과 **같은 게이트**를 그대로 쓴다 — firestore.rules 가 projectAuditLog
 * read 를 isAdminOrOwner 로 잠가 두었고(services/projectAuditService), 그건
 * 작업량 게이트(canViewWorkload)가 파생하는 manage_members 와 같은 판정이다.
 * 별도 목록을 만들면 룰과 UI 가 조용히 갈라진다. 이름을 따로 두는 이유는
 * 호출부에서 "작업량 권한으로 감사를 열었다"로 읽히지 않게 하기 위함이고,
 * 나중에 두 게이트가 갈라져야 하면 여기 한 줄만 바꾸면 된다.
 *
 * ★UI 게이트는 1차 필터일 뿐 최종 권한이 아니다. 룰이 최종이라 화면 쪽에서도
 * permission-denied 를 반드시 처리해야 한다(ProjectAuditPanel).
 */
export function canViewAuditLog(
  role: InvitationRole | null | undefined,
): boolean {
  return canViewWorkload(role);
}

/** 이 role 의 사용자가 다른 멤버에게 부여할 수 있는 role 목록. */
export function assignableRolesFor(
  currentRole: InvitationRole,
): InvitationRole[] {
  if (currentRole === "owner") return ["admin", "member", "viewer"];
  if (currentRole === "admin") return ["member", "viewer"];
  return [];
}

/**
 * currentRole 사용자가 targetRole 멤버의 role 변경/제거를 시도할 수 있는가.
 * owner 는 (자기 자신 제외 — 호출부에서 isCurrentUser 로 차단) 전원 가능,
 * admin 은 member/viewer 만. owner role 자체는 누구도 편집 불가.
 */
export function canEditMemberRole(
  currentRole: InvitationRole,
  targetRole: InvitationRole,
): boolean {
  if (targetRole === "owner") return false;
  if (currentRole === "owner") return true;
  if (currentRole === "admin") return targetRole !== "admin";
  return false;
}
