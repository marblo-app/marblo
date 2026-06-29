import { useState, useEffect } from "react";
import type { Invitation } from "../../types/invitation";
import type { Project } from "../../types/project";
import type { User } from "../../types/user";
import { useAuth } from "../../hooks/useAuth";
import { useTranslation } from "../../lib/i18n";
import * as teamService from "../../services/teamService";
import { getDocument, convertTimestamps } from "../../services/firestore";

export function InvitationBanner() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [invitations, setInvitations] = useState<
    (Invitation & { projectName?: string; inviterName?: string })[]
  >([]);
  const [processing, setProcessing] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.email) {
      setInvitations([]);
      return;
    }

    const unsubscribe = teamService.subscribeToMyInvitations(
      user.email,
      async (invs) => {
        // 프로젝트명과 초대자 이름을 함께 로드
        const enriched = await Promise.all(
          invs.map(async (inv) => {
            let projectName = "";
            let inviterName = "";
            try {
              const project = await getDocument<Record<string, unknown>>(
                "projects",
                inv.projectId,
              );
              if (project) {
                projectName = convertTimestamps<Project>(project, [
                  "createdAt",
                  "updatedAt",
                ]).name;
              }
            } catch {
              /* ignore */
            }
            try {
              const inviter = await getDocument<Record<string, unknown>>(
                "users",
                inv.invitedBy,
              );
              if (inviter) {
                const u = convertTimestamps<User>(inviter, ["createdAt"]);
                inviterName = u.displayName || u.email;
              }
            } catch {
              /* ignore */
            }
            return { ...inv, projectName, inviterName };
          }),
        );
        setInvitations(enriched);
      },
    );

    return () => unsubscribe();
  }, [user?.email]);

  const handleAccept = async (invitationId: string) => {
    if (!user) return;
    setProcessing(invitationId);
    try {
      await teamService.acceptInvitation(invitationId, user.uid);
    } catch {
      // error handled elsewhere
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = async (invitationId: string) => {
    setProcessing(invitationId);
    try {
      await teamService.rejectInvitation(invitationId);
    } catch {
      // error handled elsewhere
    } finally {
      setProcessing(null);
    }
  };

  if (invitations.length === 0) return null;

  return (
    <div className="space-y-2 border-b border-gray-700 bg-blue-900/20 px-4 py-2">
      {invitations.map((inv) => (
        <div
          key={inv.id}
          className="flex items-center justify-between rounded border border-blue-700/50 bg-blue-900/30 px-3 py-2"
        >
          <div className="flex items-center gap-2 text-sm text-gray-200">
            <svg
              className="h-4 w-4 text-blue-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
            <span>
              {t("settings.invitation.invitedYou")
                .split(/(\{inviter\}|\{project\})/)
                .map((seg, i) => {
                  if (seg === "{inviter}")
                    return (
                      <strong key={i} className="text-blue-300">
                        {inv.inviterName || t("common.unknown")}
                      </strong>
                    );
                  if (seg === "{project}")
                    return (
                      <strong key={i} className="text-blue-300">
                        {inv.projectName ||
                          t("settings.invitation.fallbackProject")}
                      </strong>
                    );
                  return seg;
                })}
            </span>
            <span className="text-xs text-gray-500">({inv.role})</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleAccept(inv.id)}
              disabled={processing === inv.id}
              className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {t("settings.invitation.accept")}
            </button>
            <button
              onClick={() => handleReject(inv.id)}
              disabled={processing === inv.id}
              className="rounded border border-gray-600 px-3 py-1 text-xs text-gray-300 hover:bg-gray-700 disabled:opacity-50"
            >
              {t("settings.invitation.reject")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
