export type InvitationRole = "owner" | "admin" | "member" | "viewer";
export type InvitationStatus = "pending" | "accepted" | "rejected" | "expired";

/**
 * `memberRoles/{projectId}_{uid}.role` 에 **실제로 저장될 수 있는** 역할.
 *
 * ★`owner` 가 빠진 것이 핵심이다. owner 는 `projects.ownerId` 하나로만 판정되며
 * (서버 `resolveProjectRole`, 룰 `isProjectOwner`), 역할 문서에 'owner' 를 써서
 * 승격하는 통로는 서버(`normalizeMemberRole`)와 룰(`memberRoles` create/update)
 * 양쪽에서 막혀 있다. 타입으로도 그 구분을 남긴다 — 저장 경로에서 'owner' 를
 * 다룰 수 있는 것처럼 보이면 다음 사람이 그 통로를 다시 연다.
 */
export type StoredMemberRole = Exclude<InvitationRole, "owner">;

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
//
// 'write' = **쓸 수 있는 사람**의 정의다. 저장소 push(githubApp.roleCanWriteRepo)
// 와 보드 티켓 create/update/delete(firestore.rules 의 canWriteTasks) 가 같은
// 이 한 칸을 본다. viewer 에게 'write' 가 없다는 것이 "읽기 전용 초대"의 전부다.
// 새 축을 만들지 말고 이 표를 고쳐라 — 룰만 고치면 조용히 갈라진다.
//
// ★'delete' 는 보드 티켓 삭제 축이 **아니다**. 지금 이 퍼미션을 읽는 코드는
// 없고(프로젝트/멤버 삭제 같은 관리 행위를 뜻하는 자리로 남아 있다), 티켓 삭제는
// 'write' 축에 있다. member 는 예나 지금이나 자기 보드의 티켓을 지울 수 있다 —
// 여기서 'delete' 축으로 갈아타면 member 의 기존 보드 동작이 조용히 죽는다.
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
