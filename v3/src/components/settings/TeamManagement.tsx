import { useState } from 'react';
import type { InvitationRole } from '../../types/invitation';
import { useTeam } from '../../hooks/useTeam';
import { useAuth } from '../../hooks/useAuth';

const ROLE_BADGE_COLORS: Record<InvitationRole, string> = {
  owner: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  admin: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  member: 'bg-green-500/20 text-green-400 border-green-500/30',
  viewer: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

const ROLE_LABELS: Record<InvitationRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
};

const ASSIGNABLE_ROLES: InvitationRole[] = ['admin', 'member', 'viewer'];

interface TeamManagementProps {
  projectId: string;
}

export function TeamManagement({ projectId }: TeamManagementProps) {
  const { user } = useAuth();
  const {
    members,
    memberRoles,
    invitations,
    loading,
    error,
    invite,
    cancelInvitation,
    updateRole,
    removeMember,
    checkPermission,
    clearError,
  } = useTeam(projectId);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<InvitationRole>('member');
  const [inviting, setInviting] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const canManageMembers = checkPermission('manage_members');

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    setInviting(true);
    try {
      await invite(inviteEmail.trim(), inviteRole);
      setInviteEmail('');
      setInviteRole('member');
    } catch {
      // error is set in hook
    } finally {
      setInviting(false);
    }
  };

  const handleRoleChange = async (userId: string, role: InvitationRole) => {
    try {
      await updateRole(userId, role);
    } catch {
      // error is set in hook
    }
  };

  const handleRemove = async (userId: string) => {
    try {
      await removeMember(userId);
      setConfirmRemove(null);
    } catch {
      // error is set in hook
    }
  };

  const handleCancelInvitation = async (invitationId: string) => {
    try {
      await cancelInvitation(invitationId);
    } catch {
      // error is set in hook
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-600 border-t-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Error Banner */}
      {error && (
        <div className="flex items-center justify-between rounded border border-red-700 bg-red-900/30 px-4 py-2 text-sm text-red-400">
          <span>{error}</span>
          <button onClick={clearError} className="ml-2 text-red-400 hover:text-red-300">
            &times;
          </button>
        </div>
      )}

      {/* Invite Form */}
      {canManageMembers && (
        <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
          <h3 className="mb-3 text-sm font-medium text-gray-200">멤버 초대</h3>
          <form onSubmit={handleInvite} className="flex items-end gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-xs text-gray-400">이메일</label>
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="user@example.com"
                className="w-full rounded border border-gray-600 bg-gray-900 px-3 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                required
              />
            </div>
            <div className="w-32">
              <label className="mb-1 block text-xs text-gray-400">역할</label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as InvitationRole)}
                className="w-full rounded border border-gray-600 bg-gray-900 px-3 py-1.5 text-sm text-gray-200 focus:border-blue-500 focus:outline-none"
              >
                {ASSIGNABLE_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={inviting || !inviteEmail.trim()}
              className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {inviting ? '전송 중...' : '초대'}
            </button>
          </form>
        </div>
      )}

      {/* Pending Invitations */}
      {invitations.length > 0 && (
        <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
          <h3 className="mb-3 text-sm font-medium text-gray-200">
            대기 중인 초대 ({invitations.length})
          </h3>
          <div className="space-y-2">
            {invitations.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center justify-between rounded border border-gray-700 bg-gray-900 px-3 py-2"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-300">{inv.invitedEmail}</span>
                  <RoleBadge role={inv.role} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">
                    {formatDate(inv.createdAt)}
                  </span>
                  {canManageMembers && (
                    <button
                      onClick={() => handleCancelInvitation(inv.id)}
                      className="rounded px-2 py-1 text-xs text-red-400 hover:bg-red-900/30"
                    >
                      취소
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Members List */}
      <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
        <h3 className="mb-3 text-sm font-medium text-gray-200">
          멤버 ({members.length})
        </h3>
        <div className="space-y-2">
          {members.map((member) => {
            const role = memberRoles[member.id] || 'member';
            const isCurrentUser = user?.uid === member.id;
            const isOwner = role === 'owner';

            return (
              <div
                key={member.id}
                className="flex items-center justify-between rounded border border-gray-700 bg-gray-900 px-3 py-2.5"
              >
                <div className="flex items-center gap-3">
                  {/* Avatar */}
                  {member.photoURL ? (
                    <img
                      src={member.photoURL}
                      alt=""
                      className="h-8 w-8 rounded-full"
                    />
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-700 text-xs font-medium text-gray-300">
                      {member.displayName?.[0] || member.email?.[0] || '?'}
                    </div>
                  )}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-200">
                        {member.displayName || member.email}
                      </span>
                      {isCurrentUser && (
                        <span className="text-xs text-gray-500">(나)</span>
                      )}
                    </div>
                    <span className="text-xs text-gray-500">{member.email}</span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {/* Role */}
                  {canManageMembers && !isOwner && !isCurrentUser ? (
                    <select
                      value={role}
                      onChange={(e) =>
                        handleRoleChange(member.id, e.target.value as InvitationRole)
                      }
                      className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-gray-300 focus:border-blue-500 focus:outline-none"
                    >
                      {ASSIGNABLE_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <RoleBadge role={role} />
                  )}

                  {/* Date */}
                  <span className="text-xs text-gray-500">
                    {formatDate(member.createdAt)}
                  </span>

                  {/* Remove button */}
                  {canManageMembers && !isOwner && !isCurrentUser && (
                    <>
                      {confirmRemove === member.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleRemove(member.id)}
                            className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700"
                          >
                            확인
                          </button>
                          <button
                            onClick={() => setConfirmRemove(null)}
                            className="rounded px-2 py-1 text-xs text-gray-400 hover:bg-gray-700"
                          >
                            취소
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmRemove(member.id)}
                          className="rounded px-2 py-1 text-xs text-red-400 hover:bg-red-900/30"
                        >
                          제거
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}

          {members.length === 0 && (
            <p className="py-4 text-center text-sm text-gray-500">
              아직 멤버가 없습니다.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function RoleBadge({ role }: { role: InvitationRole }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${ROLE_BADGE_COLORS[role]}`}
    >
      {ROLE_LABELS[role]}
    </span>
  );
}

function formatDate(date: Date): string {
  if (!(date instanceof Date) || isNaN(date.getTime())) return '';
  return date.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
