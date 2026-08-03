import { useState, useEffect } from "react";
import type { Invitation } from "../../types/invitation";
import type { Project } from "../../types/project";
import type { User } from "../../types/user";
import { useAuth } from "../../hooks/useAuth";
import { useTranslation } from "../../lib/i18n";
import * as teamService from "../../services/teamService";
import { getDocument, convertTimestamps } from "../../services/firestore";
import { useProjectStore } from "../../stores/projectStore";

/** 수락 직후 이 프로젝트가 동기화되면 바로 전환한다. */
const JOINED_BANNER_MS = 4000;

export function InvitationBanner() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [invitations, setInvitations] = useState<
    (Invitation & { projectName?: string; inviterName?: string })[]
  >([]);
  const [processing, setProcessing] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [joined, setJoined] = useState<{
    projectId: string;
    projectName: string;
  } | null>(null);
  const projects = useProjectStore((s) => s.projects);
  const setCurrentProject = useProjectStore((s) => s.setCurrentProject);

  // 초대 수락 직후 화면이 그대로 있으면 멤버가 새로 들어간 팀을 못 찾는다
  // (수동으로 프로젝트 드롭다운을 뒤져야 함) — 프로젝트 구독이 새 멤버십을
  // 반영하는 즉시 그 프로젝트로 전환해 '수락 → 코드 받기(RepoConnectModal)
  // → 보드' 로 바로 이어지게 한다.
  useEffect(() => {
    if (!joined) return;
    const project = projects.find((p) => p.id === joined.projectId);
    if (project) setCurrentProject(project);
  }, [joined, projects, setCurrentProject]);

  // "합류했습니다" 안내는 전환 여부와 무관하게 최소 시간 동안 보여준다.
  useEffect(() => {
    if (!joined) return;
    const timer = window.setTimeout(() => setJoined(null), JOINED_BANNER_MS);
    return () => window.clearTimeout(timer);
  }, [joined]);

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
                inv.projectId
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
                inv.invitedBy
              );
              if (inviter) {
                const u = convertTimestamps<User>(inviter, ["createdAt"]);
                inviterName = u.displayName || u.email;
              }
            } catch {
              /* ignore */
            }
            return { ...inv, projectName, inviterName };
          })
        );
        setInvitations(enriched);
      }
    );

    return () => unsubscribe();
  }, [user?.email]);

  const handleAccept = async (inv: Invitation & { projectName?: string }) => {
    if (!user) return;
    setProcessing(inv.id);
    setErrors((prev) => {
      if (!(inv.id in prev)) return prev;
      const next = { ...prev };
      delete next[inv.id];
      return next;
    });
    try {
      await teamService.acceptInvitation(inv.id, user.uid);
      setJoined({
        projectId: inv.projectId,
        projectName:
          inv.projectName || t("settings.invitation.fallbackProject"),
      });
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [inv.id]:
          err instanceof Error && err.message
            ? err.message
            : t("settings.invitation.acceptFailed"),
      }));
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = async (invitationId: string) => {
    setProcessing(invitationId);
    try {
      await teamService.rejectInvitation(invitationId);
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [invitationId]:
          err instanceof Error && err.message
            ? err.message
            : t("settings.invitation.rejectFailed"),
      }));
    } finally {
      setProcessing(null);
    }
  };

  if (invitations.length === 0 && !joined) return null;

  return (
    <div className="space-y-2 border-b border-gray-700 bg-blue-900/20 px-4 py-2">
      {joined && (
        <div className="flex items-center gap-2 rounded border border-green-700/50 bg-green-900/30 px-3 py-2 text-sm text-green-200">
          <svg
            className="h-4 w-4 text-green-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
          <span>
            {t("settings.invitation.joined", { project: joined.projectName })}
          </span>
        </div>
      )}
      {invitations.map((inv) => (
        <div key={inv.id} className="space-y-1">
          <div className="flex items-center justify-between rounded border border-blue-700/50 bg-blue-900/30 px-3 py-2">
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
                onClick={() => handleAccept(inv)}
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
          {errors[inv.id] && (
            <p className="px-1 text-xs text-red-400">{errors[inv.id]}</p>
          )}
        </div>
      ))}
    </div>
  );
}
