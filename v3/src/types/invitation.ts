export type InvitationRole = "owner" | "admin" | "member" | "viewer";
export type InvitationStatus = "pending" | "accepted" | "rejected" | "expired";

export interface Invitation {
  id: string;
  projectId: string;
  invitedEmail: string;
  invitedBy: string;
  role: InvitationRole;
  status: InvitationStatus;
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
