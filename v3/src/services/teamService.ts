import { where } from "firebase/firestore";
import type {
  Invitation,
  InvitationRole,
  StoredMemberRole,
} from "../types/invitation";
import type { User } from "../types/user";
import { USER_DATE_FIELDS } from "../types/user";
import { ROLE_PERMISSIONS } from "../types/invitation";
import {
  getDocument,
  queryDocuments,
  setDocument,
  updateDocument,
  deleteDocument,
  toTimestamp,
  convertTimestamps,
  subscribeToCollection,
} from "./firestore";
import * as projectService from "./projectService";
import { resolveProjectFolderPath } from "../lib/projectPaths";
import { sanitizeGitRemoteUrl } from "../lib/gitUrlSafety";
import { t } from "../lib/i18n";

const INVITATIONS = "invitations";
const MEMBER_ROLES = "memberRoles";

function memberRoleDocId(projectId: string, userId: string): string {
  return `${projectId}_${userId}`;
}

const USERS = "users";
const INVITATION_DATE_FIELDS = ["createdAt", "expiresAt"];
// `users` 날짜 필드 목록은 types/user 의 USER_DATE_FIELDS 하나뿐이다 —
// presenceService 도 같은 상수를 쓴다. 여기 로컬 목록을 다시 두면 두 경로가
// 갈라지고, 빠뜨린 쪽 User 만 raw Timestamp 를 품은 채 `Date` 로 타이핑된다.

function toInvitation(raw: Record<string, unknown>): Invitation {
  return convertTimestamps<Invitation>(raw, INVITATION_DATE_FIELDS);
}

function toUser(raw: Record<string, unknown>): User {
  return convertTimestamps<User>(raw, USER_DATE_FIELDS);
}

function missingUserDocumentMember(userId: string): User {
  return {
    id: userId,
    email: userId,
    displayName: userId,
    photoURL: "",
    createdAt: new Date(0),
  };
}

// --- 초대 ---

export function normalizeInviteEmail(email: string): string {
  return email.trim().toLowerCase();
}

// 초대 문서 ID 는 결정적이다: {projectId}_{소문자 이메일}.
// Firestore 보안룰은 컬렉션 쿼리가 불가능해서, 초대 수락 self-join 룰
// (firestore.rules hasValidPendingInvite)이 이 규약으로 초대 문서를 get 해
// 검증한다. 여기 형식을 바꾸면 룰도 함께 바꿔야 한다.
export function invitationDocId(projectId: string, email: string): string {
  return `${projectId}_${normalizeInviteEmail(email)}`;
}

/**
 * 초대 시점의 저장소 주소 캡처 (티켓 r8vIviEcwHFbFJ88RqZ7).
 *
 * ★왜 여기서 하나: 멤버 기기의 "저장소 연결" 모달은 project.gitRemoteUrl 을
 * 보고 clone 을 제안하는데, 그 필드는 **로컬 git 폴더가 붙은 기기에서 폴더를
 * 고를 때만** 채워진다(useProjectSetup 의 생성/backfill 경로). 그래서 owner 가
 * 그 경로를 한 번도 지나지 않은 프로젝트는 URL 이 비어 있고, 초대받은 멤버는
 * 로컬 repo 가 없어 스스로 채울 수도 없다 — 모달이 clone 대상을 영영 모른다.
 * 초대는 owner 기기에서 일어나므로 여기가 URL 을 확보할 자연스러운 지점이다.
 *
 * 전 구간 fail-soft: 캡처 실패가 초대를 막아선 안 된다. 못 얻으면 모달의
 * 수동입력 폴백이 받아준다(shouldOfferRepoConnect 는 URL 없이도 노출한다).
 *
 * @returns 확보한 원본 URL(정규화하지 않은 그대로), 없으면 null.
 */
export async function captureProjectRepoUrl(
  projectId: string,
): Promise<string | null> {
  let project: Awaited<ReturnType<typeof projectService.getProject>> = null;
  try {
    project = await projectService.getProject(projectId);
  } catch {
    return null;
  }
  if (!project) return null;
  if (project.gitRemoteUrl) return sanitizeGitRemoteUrl(project.gitRemoteUrl);

  // 이 기기 칸의 경로만 본다 — 다른 기기의 경로는 이 디스크에 없다
  // (projectPaths 의 "폴백 금지" 불변식).
  const localPath = resolveProjectFolderPath(
    { folderPath: project.folderPath, folderPaths: project.folderPaths },
    await thisMachineId(),
  );
  // ★크레덴셜을 벗겨서만 쓴다 — 이 값은 projects/invitations 문서에 실려
  // 팀 전원에게 읽힌다 (티켓 d0d0JkRd1SeGTxVRx4nQ). 메인 프로세스가 이미
  // 정화해 주지만, 구버전 IPC·오염된 캐시를 대비한 2중 방어다.
  const origin = sanitizeGitRemoteUrl(
    localPath ? await localGitRemoteUrl(localPath) : null,
  );
  if (!origin) return null;

  try {
    await projectService.updateProject(projectId, { gitRemoteUrl: origin });
  } catch (err) {
    // 프로젝트 문서에 못 써도(권한·오프라인) 초대 문서에 실어 전파한다.
    console.warn(
      "[teamService] project gitRemoteUrl backfill failed (fail-soft):",
      err,
    );
  }
  return origin;
}

/** 이 기기의 machineId. 렌더러 밖(테스트·미도착)에서는 null 로 degrade. */
async function thisMachineId(): Promise<string | null> {
  try {
    const id = await window.electronAPI?.getMachineId?.();
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}

/** 로컬 폴더의 git origin. 읽을 수 없으면 null(useProjectSetup 과 같은 API). */
async function localGitRemoteUrl(path: string): Promise<string | null> {
  try {
    const url = await window.electronAPI?.fs?.gitRemoteUrl?.(path);
    return typeof url === "string" && url ? url : null;
  } catch {
    return null;
  }
}

/**
 * 초대 문서에 실린 저장소 주소를 프로젝트로 승격한다(수락 직후, fail-soft).
 *
 * ★반드시 addMember 뒤에 부른다 — projects 업데이트는 멤버에게만 허용되므로
 * (firestore.rules `allow update: isProjectMember`), 멤버가 되기 전에 부르면
 * permission-denied 다. 이미 URL 이 있는 프로젝트는 건드리지 않는다: owner 가
 * 정한 값이 항상 이긴다.
 */
async function propagateInvitationRepoUrl(
  invitation: Invitation,
): Promise<void> {
  // 오염된 초대 문서(구버전이 쓴 토큰 URL)를 프로젝트로 옮겨 심지 않는다.
  const url = sanitizeGitRemoteUrl(invitation.gitRemoteUrl);
  // 정규화가 null 이면 URL 로서 의미가 없는 값 — 쓰지 않는다.
  if (!url || !projectService.normalizeGitRemoteUrl(url)) return;
  try {
    const project = await projectService.getProject(invitation.projectId);
    if (!project || project.gitRemoteUrl) return;
    await projectService.updateProject(invitation.projectId, {
      gitRemoteUrl: url,
    });
  } catch (err) {
    console.warn(
      "[teamService] invitation gitRemoteUrl propagation failed (fail-soft):",
      err,
    );
  }
}

export async function createInvitation(
  projectId: string,
  email: string,
  role: InvitationRole,
  invitedBy: string,
): Promise<string> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7일 후 만료
  const invitedEmail = normalizeInviteEmail(email);

  // 중복 초대 체크
  const existing = await queryDocuments<Record<string, unknown>>(
    INVITATIONS,
    where("projectId", "==", projectId),
    where("invitedEmail", "==", invitedEmail),
    where("status", "==", "pending"),
  );
  if (existing.length > 0) {
    throw new Error(t("common.team.duplicateInvite"));
  }

  // owner 기기에서만 얻을 수 있는 값이라 초대를 쓰기 전에 확보한다.
  const gitRemoteUrl = await captureProjectRepoUrl(projectId);

  const docId = invitationDocId(projectId, email);
  await setDocument(INVITATIONS, docId, {
    projectId,
    invitedEmail,
    invitedBy,
    role,
    status: "pending",
    // 없을 때 undefined 를 실으면 Firestore 가 거부한다 — 아예 빼고 쓴다.
    ...(gitRemoteUrl ? { gitRemoteUrl } : {}),
    createdAt: toTimestamp(now),
    expiresAt: toTimestamp(expiresAt),
  });
  return docId;
}

/**
 * 이 초대가 "정확히 어느 프로젝트 하나"를 가리키는지 확정한다
 * (티켓 3YSvLFCT707GpV8FEyUp, P0 오버그랜트 재발 방지).
 *
 * ★왜 필요한가: 수락은 `addMember(invitation.projectId, uid)` 로 **본문 필드**를
 * 믿고 쓰는데, 초대 문서를 찾은 근거는 **문서 id**(`{projectId}_{소문자 이메일}`)
 * 다. 둘이 어긋난 문서가 하나라도 있으면 "어느 프로젝트에 넣을 것인가"의
 * 권위자가 둘로 갈리고, 사용자가 지정하지 않은 프로젝트로 멤버십이 새는 통로가
 * 된다 — 콜라보 1명 추가가 owner 의 다른 프로젝트들로 번진 사고가 정확히 그
 * 모양이었다. firestore.rules 의 self-join(B2)은 이미 `inv.projectId ==
 * projectId` 를 검증하므로, 여기서 같은 판정을 클라이언트에서 먼저 내려
 * **어떤 프로젝트에도 쓰기가 나가지 않게** 한다(서버 거부에 기대면 대상
 * 프로젝트를 향한 쓰기가 실제로 한 번 나간 뒤 막힌다).
 *
 * 검사는 id 규약 재계산 하나로 충분하다: id 가 projectId 와 이메일 둘 다에서
 * 파생되므로, 재계산이 일치하면 본문·id·수신자가 한 프로젝트로 수렴한다.
 */
function assertInvitationTargetsOneProject(
  invitationId: string,
  invitation: Invitation,
): void {
  const { projectId, invitedEmail } = invitation;
  if (
    typeof projectId !== "string" ||
    !projectId ||
    typeof invitedEmail !== "string" ||
    !invitedEmail ||
    invitationDocId(projectId, invitedEmail) !== invitationId
  ) {
    throw new Error(t("common.team.inviteMalformed"));
  }
}

/**
 * 초대장에 적힌 역할을 `memberRoles` 문서에 못 박기 전에 정규화한다.
 *
 * ★서버의 `normalizeMemberRole`(functions/src/githubApp.ts) 과 **같은 접기**다:
 * 모르는 값과 `owner` 는 `member` 로 접는다. owner 는 `projects.ownerId` 로만
 * 되며 역할 문서로 승격되지 않는다 — 여기서 'owner' 를 그대로 쓰면 룰이
 * 거부해서 수락 자체가 죽고, 룰이 없더라도 승격 통로가 열린다.
 */
export function memberRoleFromInvitation(raw: unknown): StoredMemberRole {
  if (typeof raw !== "string") return "member";
  const t = raw.trim().toLowerCase();
  return t === "admin" || t === "viewer" || t === "member"
    ? (t as StoredMemberRole)
    : "member";
}

/**
 * 수락자가 **자기 역할 문서**를 초대장의 역할로 만든다.
 *
 * 자기 승격이 아니다 — 값의 출처가 초대 문서이고, 초대는 admin/owner 만 만들 수
 * 있다. `firestore.rules` 의 `isInvitedSelfRoleWrite` 가 서버 쪽에서 같은 것을
 * 강제한다(초대의 role 과 일치하지 않으면 거부). 이 함수 하나가 "역할 문서 없는
 * 멤버"가 새로 생기는 유일한 경로를 막는다.
 *
 * 실패하면 던진다. 삼키면 멤버십만 생기고 역할이 비어 기본값 member 로 접히는
 * — 고치려는 그 사고가 그대로 남는다.
 */
async function pinInvitedMemberRole(
  invitation: Invitation,
  userId: string,
): Promise<void> {
  const role = memberRoleFromInvitation(invitation.role);
  await setDocument(
    MEMBER_ROLES,
    memberRoleDocId(invitation.projectId, userId),
    {
      projectId: invitation.projectId,
      userId,
      role,
    },
  );
}

export async function acceptInvitation(
  invitationId: string,
  userId: string,
): Promise<void> {
  const raw = await getDocument<Record<string, unknown>>(
    INVITATIONS,
    invitationId,
  );
  if (!raw) throw new Error(t("common.team.inviteNotFound"));

  const invitation = toInvitation(raw);
  assertInvitationTargetsOneProject(invitationId, invitation);
  if (invitation.status !== "pending") {
    throw new Error(t("common.team.inviteAlreadyHandled"));
  }
  if (new Date() > invitation.expiresAt) {
    await updateDocument(INVITATIONS, invitationId, { status: "expired" });
    throw new Error(t("common.team.inviteExpired"));
  }

  // ★역할 문서를 members 추가보다 **먼저** 쓴다 (티켓 uhkQrRBgeBRddWb6OeDa, P1).
  //
  // 예전 순서는 addMember 만 했고 `invitation.role` 을 그대로 버렸다. 그래서
  // 수락한 사람은 `memberRoles/{projectId}_{uid}` 문서가 **없는 멤버**가 됐고,
  // 서버(githubApp.normalizeMemberRole)와 룰(getMemberRole)이 그를 기본값
  // `member` 로 접어 **저장소 write 토큰을 내줬다** — viewer 로 초대해도.
  // 라이브 확인: 역할 문서 없는 계정이 `{"ok":true,"role":"member","access":"write"}`.
  //
  // 순서를 뒤집는 이유: addMember 를 먼저 하면 역할 쓰기가 실패했을 때 이미
  // "문서 없는 멤버"가 되어 그 사고가 그대로 재현된다. 역할이 못 박히지 않으면
  // 애초에 멤버가 되지 않는 편이 안전하다 — 초대는 pending 으로 남고 재시도가
  // 멱등하게 성립한다.
  await pinInvitedMemberRole(invitation, userId);

  // B2: 순서가 중요하다 — members 추가를 먼저, status 전이를 나중에.
  // 보안룰의 self-join 허용(hasValidPendingInvite)은 "status=pending 인 초대"를
  // 근거로 삼으므로, status 를 먼저 accepted 로 바꾸면 그 근거가 사라져
  // addMember 가 permission-denied 로 죽는다. addMember 성공 후 status 전이가
  // 실패해도 재시도(arrayUnion no-op)가 룰상 멱등 통과한다.
  await projectService.addMember(invitation.projectId, userId);

  // 초대에 실려온 저장소 주소를 프로젝트로 승격(티켓 r8vIviEcwHFbFJ88RqZ7).
  // 멤버가 된 직후가 이 쓰기가 룰상 허용되는 첫 시점이다.
  await propagateInvitationRepoUrl(invitation);

  // 초대 상태 업데이트
  await updateDocument(INVITATIONS, invitationId, { status: "accepted" });
}

export async function rejectInvitation(invitationId: string): Promise<void> {
  const raw = await getDocument<Record<string, unknown>>(
    INVITATIONS,
    invitationId,
  );
  if (!raw) throw new Error(t("common.team.inviteNotFound"));

  await updateDocument(INVITATIONS, invitationId, { status: "rejected" });
}

export async function cancelInvitation(invitationId: string): Promise<void> {
  await deleteDocument(INVITATIONS, invitationId);
}

// --- 초대 조회 ---

export async function getPendingInvitations(
  projectId: string,
): Promise<Invitation[]> {
  const docs = await queryDocuments<Record<string, unknown>>(
    INVITATIONS,
    where("projectId", "==", projectId),
    where("status", "==", "pending"),
  );
  return docs.map(toInvitation);
}

export async function getMyInvitations(email: string): Promise<Invitation[]> {
  const docs = await queryDocuments<Record<string, unknown>>(
    INVITATIONS,
    where("invitedEmail", "==", normalizeInviteEmail(email)),
    where("status", "==", "pending"),
  );
  return docs.map(toInvitation);
}

// --- 실시간 구독 ---

export function subscribeToPendingInvitations(
  projectId: string,
  callback: (invitations: Invitation[]) => void,
) {
  return subscribeToCollection<Record<string, unknown>>(
    INVITATIONS,
    [where("projectId", "==", projectId), where("status", "==", "pending")],
    (docs) => callback(docs.map(toInvitation)),
  );
}

export function subscribeToMyInvitations(
  email: string,
  callback: (invitations: Invitation[]) => void,
) {
  return subscribeToCollection<Record<string, unknown>>(
    INVITATIONS,
    [
      where("invitedEmail", "==", normalizeInviteEmail(email)),
      where("status", "==", "pending"),
    ],
    (docs) => callback(docs.map(toInvitation)),
  );
}

// --- 멤버 관리 ---

export async function updateMemberRole(
  projectId: string,
  userId: string,
  role: InvitationRole,
): Promise<void> {
  const docId = memberRoleDocId(projectId, userId);
  await setDocument(MEMBER_ROLES, docId, { projectId, userId, role });
}

export async function removeMember(
  projectId: string,
  userId: string,
): Promise<void> {
  await projectService.removeMember(projectId, userId);
  const docId = memberRoleDocId(projectId, userId);
  try {
    await deleteDocument(MEMBER_ROLES, docId);
  } catch {
    // role doc may not exist
  }
}

export async function getProjectMembers(projectId: string): Promise<User[]> {
  const project = await projectService.getProject(projectId);
  if (!project) return [];

  const members: User[] = [];
  for (const memberId of project.members) {
    let raw: Record<string, unknown> | null = null;
    try {
      raw = await getDocument<Record<string, unknown>>(USERS, memberId);
    } catch (err) {
      console.warn(
        `[teamService] users/${memberId} read failed; keeping uid-visible member row:`,
        err,
      );
    }
    if (raw) {
      members.push(toUser(raw));
    } else {
      members.push(missingUserDocumentMember(memberId));
    }
  }
  return members;
}

export async function getMemberRole(
  projectId: string,
  userId: string,
): Promise<InvitationRole> {
  // Owner 체크
  const project = await projectService.getProject(projectId);
  if (project?.ownerId === userId) return "owner";

  // memberRoles에서 조회 (composite ID)
  const docId = memberRoleDocId(projectId, userId);
  const doc = await getDocument<Record<string, unknown>>(MEMBER_ROLES, docId);
  if (doc) {
    return (doc as { role: InvitationRole }).role;
  }

  // 기본 역할
  return "member";
}

export async function checkPermission(
  projectId: string,
  userId: string,
  action: string,
): Promise<boolean> {
  const role = await getMemberRole(projectId, userId);
  return ROLE_PERMISSIONS[role]?.includes(action) ?? false;
}

// --- 멤버 역할 일괄 조회 ---

export async function getMemberRoles(
  projectId: string,
): Promise<Record<string, InvitationRole>> {
  const docs = await queryDocuments<Record<string, unknown>>(
    MEMBER_ROLES,
    where("projectId", "==", projectId),
  );

  const roles: Record<string, InvitationRole> = {};
  for (const doc of docs) {
    const d = doc as { userId: string; role: InvitationRole };
    roles[d.userId] = d.role;
  }

  // Owner는 프로젝트에서 확인
  const project = await projectService.getProject(projectId);
  if (project) {
    roles[project.ownerId] = "owner";
  }

  return roles;
}
