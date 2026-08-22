import { useEffect, useMemo, useState } from "react";
import type { User } from "../../types/user";
import { useProjectStore } from "../../stores/projectStore";
import { useAuth } from "../../hooks/useAuth";
import { useTeam } from "../../hooks/useTeam";
import { useTranslation } from "../../lib/i18n";
import { canViewAuditLog, canViewWorkload } from "../../lib/teamRoles";
import { sortMembersByRole } from "../../lib/teamMembers";
import { TeamManagement } from "../settings/TeamManagement";
import { PlanGate } from "../settings/PlanGate";
import { MemberWorkloadPanel } from "./MemberWorkloadPanel";
import { ProjectAuditPanel } from "./ProjectAuditPanel";
import { REPO_CONNECT_OPEN_EVENT } from "../collaboration/RepoConnectModal";
import { GitHubAccessGuide } from "../collaboration/GitHubAccessGuide";
import { githubCollaboratorsUrl } from "../../lib/githubWebUrl";
import { FirstShareNudge } from "../work-history/FirstMissionShareNudge";

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
  const [invitationCreated, setInvitationCreated] = useState(false);
  /**
   * GitHub App 경로가 살아 있는가(설치됨 + 이 저장소 접근 가능).
   *
   * ★아래 레거시 콜라보레이터 안내를 끄는 데 쓴다. App 이 붙어 있으면 팀원을
   * GitHub 콜라보레이터로 초대할 필요가 **없고**, 그런데도 "추가하세요" 를
   * 띄우면 새 가이드("팀원은 GitHub 에서 할 게 없습니다")와 정면으로 모순된다.
   * `null` 은 아직 모른다는 뜻 — 모를 때는 기존 동작(안내 표시)을 유지한다.
   */
  const [appConnected, setAppConnected] = useState<boolean | null>(null);

  useEffect(() => {
    const onInvitationCreated = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string }>).detail;
      if (detail?.projectId === projectId) setInvitationCreated(true);
    };
    window.addEventListener("marblo:team-invitation-created", onInvitationCreated);
    return () => window.removeEventListener("marblo:team-invitation-created", onInvitationCreated);
  }, [projectId]);

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
  const workloadRoles = useMemo(
    () =>
      user && !memberRoles[user.uid]
        ? { ...memberRoles, [user.uid]: currentRole }
        : memberRoles,
    [user, memberRoles, currentRole]
  );

  // ★ useTeam 이 이미 role 우선 정렬(owner→admin→member→viewer)해 돌려주지만,
  // 위 백필로 self 를 앞에 끼워 넣으면 그 순서가 다시 깨진다 — 여기서 한 번 더
  // sortMembersByRole 을 통과시켜 오너가 항상 맨 위에 오도록 보장한다.
  const workloadMembers = useMemo<User[]>(() => {
    if (!user || members.some((m) => m.id === user.uid)) return members;
    const self: User = {
      id: user.uid,
      email: user.email || "",
      displayName: user.displayName || user.email || user.uid,
      photoURL: user.photoURL || "",
      createdAt: new Date(),
    };
    return sortMembersByRole([self, ...members], workloadRoles);
  }, [user, members, workloadRoles]);

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
        <FirstShareNudge
          projectId={projectId}
          surface="project"
          enabled={currentProject?.ownerId === user?.uid}
        />

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
            {/* ★수동 재호출 진입점 (티켓 r8vg9pMWCRtdnUzR3KyX):
                자동 모달을 닫았거나 빈 폴더로 own 이 된 멤버가 여기서
                모달을 다시 띄울 수 있다. RepoConnectModal 이 이 이벤트를
                받아 dismissed 상태를 무시하고 표시한다. */}
            <button
              type="button"
              onClick={() =>
                window.dispatchEvent(new CustomEvent(REPO_CONNECT_OPEN_EVENT))
              }
              className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200 hover:border-gray-500 hover:bg-gray-700"
            >
              {t("project.repoConnectCta")}
            </button>
            <span>
              {t("project.memberCount", { count: workloadMembers.length })}
            </span>
            <span className="rounded border border-gray-700 bg-gray-800 px-2 py-0.5 uppercase text-gray-400">
              {t("project.myRole")}: {currentRole}
            </span>
          </div>
        </div>

        {/* ★GitHub 연결 안내 — 오너용 설치 가이드 / 팀원용 "나는 뭘 하나"
            (티켓 kzxsRzC37uVvYftpVZO4). 두 사람이 서로 다른 것을 해야 하는
            기능이라 화면도 역할에 따라 갈린다. 멤버 목록·역할 UI 보다 위에
            두는 이유: 역할을 주기 전에 "코드가 어떻게 전달되는가" 를 먼저
            알아야 오너가 무엇을 하는지 이해한 채로 역할을 준다. */}
        <GitHubAccessGuide
          projectId={projectId}
          isOwner={currentProject?.ownerId === user?.uid}
          role={currentRole}
          hasRepoUrl={!!currentProject?.gitRemoteUrl}
          onAppConnectedChange={setAppConnected}
        />

        {/* ★App 이 붙어 있으면 이 안내는 **틀린 말**이 되므로 감춘다 —
            콜라보레이터 초대는 App 이 없을 때의 경로다. 아직 모를 때(null)는
            기존 동작 그대로 표시한다. */}
        {appConnected !== true &&
          invitationCreated &&
          githubCollaboratorsUrl(currentProject?.gitRemoteUrl) && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            <span>{t("githubGuide.legacyCollaborator.notice")}</span>
            <a
              href={githubCollaboratorsUrl(currentProject?.gitRemoteUrl) ?? undefined}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 underline hover:text-white"
            >
              {t("githubGuide.legacyCollaborator.link")}
            </a>
          </div>
        )}

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
