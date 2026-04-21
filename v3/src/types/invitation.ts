export type InvitationRole = 'owner' | 'admin' | 'member' | 'viewer';
export type InvitationStatus = 'pending' | 'accepted' | 'rejected' | 'expired';

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

export const ROLE_PERMISSIONS: Record<InvitationRole, string[]> = {
  owner: ['read', 'write', 'delete', 'manage_members', 'manage_billing', 'delete_project'],
  admin: ['read', 'write', 'delete', 'manage_members'],
  member: ['read', 'write'],
  viewer: ['read'],
};
