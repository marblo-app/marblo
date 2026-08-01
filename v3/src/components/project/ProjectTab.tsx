import { useMemo } from "react";
import type { User } from "../../types/user";
import { useProjectStore } from "../../stores/projectStore";
import { useAuth } from "../../hooks/useAuth";
import { useTeam } from "../../hooks/useTeam";
import { useTranslation } from "../../lib/i18n";
import { canViewAuditLog, canViewWorkload } from "../../lib/teamRoles";
import { TeamManagement } from "../settings/TeamManagement";
import { PlanGate } from "../settings/PlanGate";
import { MemberWorkloadPanel } from "./MemberWorkloadPanel";
import { ProjectAuditPanel } from "./ProjectAuditPanel";

/**
 * 프로젝트 탭 — 이 프로젝트의 **사람** 쪽 전부를 한 화면에 모은다: 누가 있고
 * (멤버), 무엇을 할 수 있고(역할), 지금 얼마나 지고 있나(작업량).
 *
 * ★ 새로 만든 것은 이 화면 하나뿐이다. 초대·역할부여 UI 는 Settings → Team 의
 * <TeamManagement /> 를 **그대로** 재사용한다(같은 컴포넌트, 같은 useTeam 훅,
 * 같은 teamRoles 판정). 초대 폼을 여기 다시 그리면 두 화면의 권한 규칙이
 * 갈라지는 건 시간문제라서, 옮기지도 복제하지도 않고 공유한다.
 *
 * 권한은 두 축으로 갈린다:
 *  - 요금제(PlanGate "team_members") — Settings 팀 탭과 동일. 여기서 빼면 무료
 *    플랜에 팀 관리가 뒷문으로 열린다.
 *  - 역할(canViewWorkload = owner/admin) — 작업량 표는 인사 성격의 정보라
 *    멤버 관리 권한과 같은 게이트를 쓴다(firestore.rules isAdminOrOwner 와
 *    같은 판정). member/viewer 는 멤버 목록까지만 읽는다.
 */
export function ProjectTab() {
  const { t } = useTranslation();
  const currentProject = useProjectStore((s) => s.currentProject);
  const projectId = currentProject?.id || "";
  const { user } = useAuth();
  const { members, memberRoles, currentRole, loading } = useTeam(projectId);

  /**
   * 작업량 표에 넘길 멤버 목록.
   *
   * ★ teamService.getProjectMembers 는 `project.members` 배열을 읽는데, 이
   * 배열이 생기기 전에 만들어진 프로젝트에는 소유자 본인이 안 들어 있다
   * (scripts/backfill-project-members.mjs 가 있는 이유). 그대로 두면 소유자가
   * 자기 탭을 열었을 때 자기 에이전트·티켓이 전부 '미귀속' 으로 떨어져서,
   * 가장 흔한 1인 프로젝트가 빈 표로 보인다. 목록에 없으면 로그인 프로필로
   * 한 줄 채워 넣는다 — 역할은 useTeam 이 이미 owner 로 판정해 둔 값을 쓴다.
   */
  const workloadMembers = useMemo<User[]>(() => {
    if (!user || members.some((m) => m.id === user.uid)) return members;
    const self: User = {
      id: user.uid,
      email: user.email || "",
      displayName: user.displayName || user.email || user.uid,
      photoURL: user.photoURL || "",
      createdAt: new Date(),
    };
    return [self, ...members];
  }, [user, members]);

  const workloadRoles = useMemo(
    () =>
      user && !memberRoles[user.uid]
        ? { ...memberRoles, [user.uid]: currentRole }
        : memberRoles,
    [user, memberRoles, currentRole],
  );

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-gray-400">
        <div>
          <p className="text-lg font-medium">{t("project.noProject.title")}</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">
            {t("project.noProject.desc")}
          </p>
          <button
            type="button"
            onClick={() =>
              window.dispatchEvent(new CustomEvent("marblo:select-folder"))
            }
            className="mt-4 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
          >
            {t("project.noProject.cta")}
          </button>
        </div>
      </div>
    );
  }

  const showWorkload = canViewWorkload(currentRole);
  const showAudit = canViewAuditLog(currentRole);

  return (
    <div className="h-full overflow-auto p-4">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-gray-100">
              {currentProject?.name || t("project.title")}
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              {t("project.subtitle")}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>
              {t("project.memberCount", { count: workloadMembers.length })}
            </span>
            <span className="rounded border border-gray-700 bg-gray-800 px-2 py-0.5 uppercase text-gray-400">
              {t("project.myRole")}: {currentRole}
            </span>
          </div>
        </div>

        {/* 작업량 — owner/admin 전용. 로딩 중에는 역할 판정이 아직 'viewer'
            기본값이라 게이트를 걸면 한 프레임 깜빡이므로 로딩을 먼저 본다. */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-600 border-t-blue-500" />
          </div>
        ) : (
          <>
            {showWorkload && (
              <MemberWorkloadPanel
                projectId={projectId}
                members={workloadMembers}
                memberRoles={workloadRoles}
              />
            )}

            {/* 감사 로그 — 작업량(결과) 바로 아래에 행위를 둔다. 둘을 나란히
                보면 구성원별로 "얼마나 지고 있나 + 실제로 무엇을 했나"가
                한 화면에서 맞물린다. 게이트는 작업량과 같은 owner/admin 이고,
                룰이 최종 권한이라 패널이 permission-denied 도 스스로 처리한다. */}
            {showAudit && (
              <ProjectAuditPanel
                projectId={projectId}
                members={workloadMembers}
              />
            )}
          </>
        )}

        {/* 멤버 · 역할 · 초대 — Settings → Team 과 같은 컴포넌트를 공유한다. */}
        <PlanGate feature="team_members">
          <TeamManagement projectId={projectId} />
        </PlanGate>
      </div>
    </div>
  );
}
