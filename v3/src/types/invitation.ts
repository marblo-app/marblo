export type InvitationRole = "owner" | "admin" | "member" | "viewer";
export type InvitationStatus = "pending" | "accepted" | "rejected" | "expired";

export interface Invitation {
  id: string;
  projectId: string;
  invitedEmail: string;
  invitedBy: string;
  role: InvitationRole;
  status: InvitationStatus;
  /**
   * 초대 시점에 owner 기기에서 캡처한 프로젝트 저장소 주소
   * (티켓 r8vIviEcwHFbFJ88RqZ7). project.gitRemoteUrl 이 비어 있고 owner 의
   * project 쓰기가 실패했을 때의 두 번째 전파 창구다 — 멤버가 수락할 때
   * 이 값이 project 로 승격돼 "저장소 연결" 모달이 clone 대상을 알게 된다.
   * 캡처가 불가능한 초대(로컬 git 폴더 없음)에는 아예 없는 필드다.
   */
  gitRemoteUrl?: string;
  createdAt: Date;
  expiresAt: Date;
}

// 'merge' = 코드 머지(앱 내 Merge 버튼 + merged→DONE 완료 처리). owner/admin 전용 —
// member 는 PR 제출(REVIEW)까지만. Firestore 룰의 REVIEW→DONE 게이트와 짝이다.
export const ROLE_PERMISSIONS: Record<InvitationRole, string[]> = {
  owner: [
    "read",
    "write",
    "delete",
    "merge",
    "manage_members",
    "manage_billing",
    "delete_project",
  ],
  admin: ["read", "write", "delete", "merge", "manage_members"],
  member: ["read", "write"],
  viewer: ["read"],
};
