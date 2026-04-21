import { where } from 'firebase/firestore';
import type { Invitation, InvitationRole } from '../types/invitation';
import type { User } from '../types/user';
import { ROLE_PERMISSIONS } from '../types/invitation';
import {
  getDocument,
  queryDocuments,
  createDocument,
  setDocument,
  updateDocument,
  deleteDocument,
  toTimestamp,
  convertTimestamps,
  subscribeToCollection,
} from './firestore';
import * as projectService from './projectService';

const INVITATIONS = 'invitations';
const USERS = 'users';
const INVITATION_DATE_FIELDS = ['createdAt', 'expiresAt'];
const USER_DATE_FIELDS = ['createdAt'];

function toInvitation(raw: Record<string, unknown>): Invitation {
  return convertTimestamps<Invitation>(raw, INVITATION_DATE_FIELDS);
}

function toUser(raw: Record<string, unknown>): User {
  return convertTimestamps<User>(raw, USER_DATE_FIELDS);
}

// --- 초대 ---

export async function createInvitation(
  projectId: string,
  email: string,
  role: InvitationRole,
  invitedBy: string,
): Promise<string> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7일 후 만료

  // 중복 초대 체크
  const existing = await queryDocuments<Record<string, unknown>>(
    INVITATIONS,
    where('projectId', '==', projectId),
    where('invitedEmail', '==', email),
    where('status', '==', 'pending'),
  );
  if (existing.length > 0) {
    throw new Error('이미 대기 중인 초대가 있습니다.');
  }

  return createDocument(INVITATIONS, {
    projectId,
    invitedEmail: email,
    invitedBy,
    role,
    status: 'pending',
    createdAt: toTimestamp(now),
    expiresAt: toTimestamp(expiresAt),
  });
}

export async function acceptInvitation(
  invitationId: string,
  userId: string,
): Promise<void> {
  const raw = await getDocument<Record<string, unknown>>(INVITATIONS, invitationId);
  if (!raw) throw new Error('초대를 찾을 수 없습니다.');

  const invitation = toInvitation(raw);
  if (invitation.status !== 'pending') {
    throw new Error('이미 처리된 초대입니다.');
  }
  if (new Date() > invitation.expiresAt) {
    await updateDocument(INVITATIONS, invitationId, { status: 'expired' });
    throw new Error('만료된 초대입니다.');
  }

  // 초대 상태 업데이트
  await updateDocument(INVITATIONS, invitationId, { status: 'accepted' });

  // 프로젝트 멤버에 추가
  await projectService.addMember(invitation.projectId, userId);
}

export async function rejectInvitation(invitationId: string): Promise<void> {
  const raw = await getDocument<Record<string, unknown>>(INVITATIONS, invitationId);
  if (!raw) throw new Error('초대를 찾을 수 없습니다.');

  await updateDocument(INVITATIONS, invitationId, { status: 'rejected' });
}

export async function cancelInvitation(invitationId: string): Promise<void> {
  await deleteDocument(INVITATIONS, invitationId);
}

// --- 초대 조회 ---

export async function getPendingInvitations(projectId: string): Promise<Invitation[]> {
  const docs = await queryDocuments<Record<string, unknown>>(
    INVITATIONS,
    where('projectId', '==', projectId),
    where('status', '==', 'pending'),
  );
  return docs.map(toInvitation);
}

export async function getMyInvitations(email: string): Promise<Invitation[]> {
  const docs = await queryDocuments<Record<string, unknown>>(
    INVITATIONS,
    where('invitedEmail', '==', email),
    where('status', '==', 'pending'),
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
    [where('projectId', '==', projectId), where('status', '==', 'pending')],
    (docs) => callback(docs.map(toInvitation)),
  );
}

export function subscribeToMyInvitations(
  email: string,
  callback: (invitations: Invitation[]) => void,
) {
  return subscribeToCollection<Record<string, unknown>>(
    INVITATIONS,
    [where('invitedEmail', '==', email), where('status', '==', 'pending')],
    (docs) => callback(docs.map(toInvitation)),
  );
}

// --- 멤버 관리 ---

const MEMBER_ROLES = 'memberRoles';

function memberRoleDocId(projectId: string, userId: string): string {
  return `${projectId}_${userId}`;
}

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
    const raw = await getDocument<Record<string, unknown>>(USERS, memberId);
    if (raw) {
      members.push(toUser(raw));
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
  if (project?.ownerId === userId) return 'owner';

  // memberRoles에서 조회 (composite ID)
  const docId = memberRoleDocId(projectId, userId);
  const doc = await getDocument<Record<string, unknown>>(MEMBER_ROLES, docId);
  if (doc) {
    return (doc as { role: InvitationRole }).role;
  }

  // 기본 역할
  return 'member';
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
    where('projectId', '==', projectId),
  );

  const roles: Record<string, InvitationRole> = {};
  for (const doc of docs) {
    const d = doc as { userId: string; role: InvitationRole };
    roles[d.userId] = d.role;
  }

  // Owner는 프로젝트에서 확인
  const project = await projectService.getProject(projectId);
  if (project) {
    roles[project.ownerId] = 'owner';
  }

  return roles;
}
