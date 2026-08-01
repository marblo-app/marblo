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
