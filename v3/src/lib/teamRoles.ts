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
