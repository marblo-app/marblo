import { useState, useEffect, useCallback, useMemo } from "react";
import { where } from "firebase/firestore";
import type { User } from "../types/user";
import type { Invitation, InvitationRole } from "../types/invitation";
import { ROLE_PERMISSIONS } from "../types/invitation";
import {
  subscribeToCollection,
  convertTimestamps,
} from "../services/firestore";
import * as teamService from "../services/teamService";
import { subscribeToPresence } from "../services/collaborationService";
import {
  resolveMemberDisplayName,
  sortMembersByRole,
} from "../lib/teamMembers";
import { useAuth } from "./useAuth";
import { t } from "../lib/i18n";

const INVITATION_DATE_FIELDS = ["createdAt", "expiresAt"];
function toInvitation(raw: Record<string, unknown>): Invitation {
  return convertTimestamps<Invitation>(raw, INVITATION_DATE_FIELDS);
}

export function useTeam(projectId: string) {
  const { user } = useAuth();
  const [members, setMembers] = useState<User[]>([]);
  const [memberRoles, setMemberRoles] = useState<
    Record<string, InvitationRole>
  >({});
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // uid → presence 문서의 displayName. users/{uid} 문서는 오너 외 멤버에서
  // displayName 이 비어 있는 경우가 흔해(그 필드를 채우는 쓰기 경로가 이 앱
  // 어디에도 없다), usePresenceSync 가 60초마다 Firebase Auth 값으로 갱신하는
  // 프로젝트 스코프 presence 문서를 이름 폴백 소스로 쓴다.
  const [presenceNames, setPresenceNames] = useState<Record<string, string>>(
    {}
  );

  // 멤버 목록 로드 (프로젝트 변경 시)
  useEffect(() => {
    if (!projectId) {
      setMembers([]);
      setMemberRoles({});
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function loadMembers() {
      try {
        const [memberList, roles] = await Promise.all([
          teamService.getProjectMembers(projectId),
          teamService.getMemberRoles(projectId),
        ]);
        if (!cancelled) {
          setMembers(memberList);
          setMemberRoles(roles);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : t("common.team.loadMembersFailed")
          );
          setLoading(false);
        }
      }
    }

    loadMembers();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // 초대 목록 실시간 구독
  useEffect(() => {
    if (!projectId) {
      setInvitations([]);
      return;
    }

    const unsubscribe = subscribeToCollection<Record<string, unknown>>(
      "invitations",
      [where("projectId", "==", projectId), where("status", "==", "pending")],
      (docs) => setInvitations(docs.map(toInvitation))
    );

    return () => unsubscribe();
  }, [projectId]);

  // 프로젝트 스코프 presence 구독 — 이름 폴백 소스(위 주석 참조).
  useEffect(() => {
    if (!projectId) {
      setPresenceNames({});
      return;
    }

    const unsubscribe = subscribeToPresence(projectId, (presence) => {
      const next: Record<string, string> = {};
      for (const p of presence) next[p.userId] = p.displayName;
      setPresenceNames(next);
    });

    return () => unsubscribe();
  }, [projectId]);

  // 표시용 멤버 목록 — 이름 해석(users → presence → email → uid) + role 우선
  // 정렬(owner→admin→member→viewer, 동률은 이름순). lib/teamMembers.ts 참조.
  const displayMembers = useMemo(
    () =>
      sortMembersByRole(
        members.map((m) => ({
          ...m,
          displayName: resolveMemberDisplayName(m, presenceNames[m.id]),
        })),
        memberRoles
      ),
    [members, memberRoles, presenceNames]
  );

  const currentRole = useMemo(() => {
    if (!user) return "viewer" as InvitationRole;
    return memberRoles[user.uid] || "member";
  }, [user, memberRoles]);

  const invite = useCallback(
    async (email: string, role: InvitationRole) => {
      try {
        if (!user) throw new Error(t("common.loginRequired"));
        await teamService.createInvitation(projectId, email, role, user.uid);
        window.dispatchEvent(new CustomEvent("marblo:team-invitation-created", {
          detail: { projectId },
        }));
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : t("common.team.inviteFailed");
        setError(msg);
        throw err;
      }
    },
    [projectId, user]
  );

  const accept = useCallback(
    async (invitationId: string) => {
      try {
        if (!user) throw new Error(t("common.loginRequired"));
        await teamService.acceptInvitation(invitationId, user.uid);
        // 멤버 목록 리로드
        const [memberList, roles] = await Promise.all([
          teamService.getProjectMembers(projectId),
          teamService.getMemberRoles(projectId),
        ]);
        setMembers(memberList);
        setMemberRoles(roles);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : t("common.team.acceptFailed");
        setError(msg);
        throw err;
      }
    },
    [projectId, user]
  );

  const reject = useCallback(async (invitationId: string) => {
    try {
      await teamService.rejectInvitation(invitationId);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : t("common.team.rejectFailed");
      setError(msg);
      throw err;
    }
  }, []);

  const cancelInvitation = useCallback(async (invitationId: string) => {
    try {
      await teamService.cancelInvitation(invitationId);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : t("common.team.cancelInviteFailed");
      setError(msg);
      throw err;
    }
  }, []);

  const updateRole = useCallback(
    async (userId: string, role: InvitationRole) => {
      try {
        await teamService.updateMemberRole(projectId, userId, role);
        setMemberRoles((prev) => ({ ...prev, [userId]: role }));
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : t("common.team.updateRoleFailed");
        setError(msg);
        throw err;
      }
    },
    [projectId]
  );

  const removeMember = useCallback(
    async (userId: string) => {
      try {
        await teamService.removeMember(projectId, userId);
        setMembers((prev) => prev.filter((m) => m.id !== userId));
        setMemberRoles((prev) => {
          const next = { ...prev };
          delete next[userId];
          return next;
        });
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : t("common.team.removeMemberFailed");
        setError(msg);
        throw err;
      }
    },
    [projectId]
  );

  const checkPermission = useCallback(
    (action: string): boolean => {
      return ROLE_PERMISSIONS[currentRole]?.includes(action) ?? false;
    },
    [currentRole]
  );

  return {
    members: displayMembers,
    memberRoles,
    invitations,
    loading,
    error,
    currentRole,
    invite,
    accept,
    reject,
    cancelInvitation,
    updateRole,
    removeMember,
    checkPermission,
    clearError: () => setError(null),
  };
}
