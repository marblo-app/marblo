import { useState, useRef, useEffect, useMemo } from "react";
import { useAuth } from "../hooks/useAuth";
import { useProjectStore } from "../stores/projectStore";
import { useEditorStore } from "../stores/editorStore";
import { useSubscriptionStore } from "../stores/subscriptionStore";
import { useActivityStreamStore } from "../stores/activityStreamStore";
import { useTranslation } from "../lib/i18n";
import { createProject } from "../services/projectService";
import { BugReportModal } from "./settings/BugReportModal";
import { InvitationBanner } from "./settings/InvitationBanner";
import { PresenceIndicator } from "./collaboration/PresenceIndicator";
import marbloMark from "../assets/marblo-mark.svg";
import type { Project } from "../types/project";

const RECENT_PROJECTS_KEY = "marblo.header.recentProjectIds";
const MAX_RECENT_PROJECTS = 8;

function readRecentProjectIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_PROJECTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

function recordRecentProjectId(id: string): string[] {
  const next = [
    id,
    ...readRecentProjectIds().filter((existing) => existing !== id),
  ].slice(0, MAX_RECENT_PROJECTS);
  try {
    localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(next));
  } catch {
    // private mode / storage quota — recent list just won't persist this session
  }
  return next;
}

/** 이름·멤버가 없는 깨진 문서. 데이터 정리(5492HUZy/AZN2XATv) 전까지 항상 숨김 — 검색해도 안 나옴. */
function isGhostProject(p: Project): boolean {
  return !p.name?.trim() || !p.members || p.members.length === 0;
}

/** 로컬 폴더·원격 저장소 연결이 전혀 없는 프로젝트. 기본 섹션엔 숨기되 검색으론 여전히 찾을 수 있다. */
function hasNoLinkedActivity(p: Project): boolean {
  return (
    !p.folderPath &&
    !p.legacyFolderPath &&
    !p.gitRemoteUrl &&
    (!p.folderPaths || Object.keys(p.folderPaths).length === 0)
  );
}

function ProjectMenuItem({
  project,
  onSelect,
}: {
  project: Project;
  onSelect: (project: Project) => void;
}) {
  return (
    <button
      onClick={() => onSelect(project)}
      className="flex w-full flex-col px-3 py-2 text-left text-sm text-gray-300 hover:bg-gray-700"
    >
      <span>{project.name}</span>
      {project.folderPath && (
        <span className="truncate text-[10px] text-gray-500">
          {project.folderPath.replace(/^\/Users\/[^/]+/, "~")}
        </span>
      )}
    </button>
  );
}

interface HeaderProps {
  onNavigateToSettings?: () => void;
}

/**
 * Header pill that mirrors the Cmd+Shift+A shortcut so the panel is
 * discoverable without keyboard. Active style when the panel is open
 * gives the user a clear "this is on" cue and a one-click close.
 */
function ActivityStreamToggle() {
  const open = useActivityStreamStore((s) => s.open);
  const toggle = useActivityStreamStore((s) => s.toggle);
  return (
    <button
      type="button"
      onClick={toggle}
      title="Activity Stream (⌘⇧A)"
      aria-label="Toggle Activity Stream"
      aria-pressed={open}
      className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
        open
          ? "bg-[#89b4fa]/20 text-[#89b4fa]"
          : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
      }`}
    >
      <svg
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4 6h16M4 12h16M4 18h7"
        />
      </svg>
      <span>Activity</span>
    </button>
  );
}

/**
 * Global "Report a bug" entry point. Always visible in the header so beta
 * users can reach the existing BugReportModal without digging through
 * Settings → Bug Report. Reuses the exact same modal + submitBugReport path;
 * this only adds a second trigger.
 */
function BugReportButton() {
  const { t } = useTranslation();
  const [showModal, setShowModal] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setShowModal(true)}
        title={t("bugReport.globalButtonTitle")}
        aria-label={t("bugReport.globalButtonTitle")}
        className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
      >
        <span aria-hidden>🐛</span>
        <span>{t("bugReport.globalButton")}</span>
      </button>
      {showModal && <BugReportModal onClose={() => setShowModal(false)} />}
    </>
  );
}

const PLAN_BADGE_STYLES: Record<string, string> = {
  free: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  pro: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  team: "bg-purple-500/20 text-purple-400 border-purple-500/30",
};

export function Header({ onNavigateToSettings }: HeaderProps) {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const projects = useProjectStore((s) => s.projects);
  const currentProject = useProjectStore((s) => s.currentProject);
  const setCurrentProject = useProjectStore((s) => s.setCurrentProject);
  const setRootPath = useEditorStore((s) => s.setRootPath);
  const getPlan = useSubscriptionStore((s) => s.getPlan);

  const handleSelectProject = (project: typeof projects[number]) => {
    if (currentProject?.id === project.id) {
      setShowProjectMenu(false);
      return;
    }
    setCurrentProject(project);
    // Sync rootPath so file tree / orchestrator / editor follow the project.
    // null when the project has no folder bound — FileTree will show its
    // empty-state picker until the user opens a folder.
    setRootPath(project.folderPath ?? null);
    setShowProjectMenu(false);
  };

  const plan = getPlan();

  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [recentProjectIds, setRecentProjectIds] = useState<string[]>(() =>
    readRecentProjectIds()
  );
  const userMenuRef = useRef<HTMLDivElement>(null);
  const projectMenuRef = useRef<HTMLDivElement>(null);

  const toggleProjectMenu = () => {
    const next = !showProjectMenu;
    setShowProjectMenu(next);
    if (next) setProjectSearch("");
  };

  // "최근" 신호: 선택할 때마다 갱신되는 로컬 히스토리(이 기기 한정, 데이터 정리와 무관).
  useEffect(() => {
    if (!currentProject) return;
    setRecentProjectIds(recordRecentProjectId(currentProject.id));
  }, [currentProject?.id]);

  const projectMenuGroups = useMemo(() => {
    const query = projectSearch.trim().toLowerCase();
    const visible = projects.filter(
      (p) => !isGhostProject(p) && p.id !== currentProject?.id
    );

    if (query) {
      return {
        searchResults: visible.filter((p) =>
          p.name.toLowerCase().includes(query)
        ),
        recent: [] as Project[],
        mine: [] as Project[],
      };
    }

    const visibleById = new Map(visible.map((p) => [p.id, p]));
    const recent = recentProjectIds
      .map((id) => visibleById.get(id))
      .filter((p): p is Project => Boolean(p));
    const recentIds = new Set(recent.map((p) => p.id));

    const mine = visible.filter(
      (p) => !recentIds.has(p.id) && !hasNoLinkedActivity(p)
    );

    // Fallback: nobody counts as "recent" or "linked" yet (fresh account) —
    // surface everything rather than showing an empty-looking dropdown.
    const shown = new Set([...recentIds, ...mine.map((p) => p.id)]);
    const rest = visible.filter((p) => !shown.has(p.id));

    return { searchResults: [] as Project[], recent, mine: [...mine, ...rest] };
  }, [projects, currentProject?.id, projectSearch, recentProjectIds]);

  const handleCreateProject = async () => {
    if (!newProjectName.trim() || !user) return;
    await createProject({
      name: newProjectName.trim(),
      ownerId: user.uid,
      members: [user.uid],
    });
    setNewProjectName("");
    setShowNewProject(false);
    setShowProjectMenu(false);
  };

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        userMenuRef.current &&
        !userMenuRef.current.contains(e.target as Node)
      ) {
        setShowUserMenu(false);
      }
      if (
        projectMenuRef.current &&
        !projectMenuRef.current.contains(e.target as Node)
      ) {
        setShowProjectMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <>
      <header
        className="flex h-12 items-center justify-between border-b border-gray-700 bg-gray-900 px-4"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        {/* Left: Logo */}
        <div className="flex items-center gap-2">
          <img
            src={marbloMark}
            alt="Marblo"
            className="h-6 w-6 rounded-md"
            draggable={false}
          />
          <span className="text-lg font-bold text-white">Marblo</span>
          <span className="text-xs text-gray-500">v3</span>
        </div>

        {/* Center: Project selector */}
        <div
          className="flex items-center gap-2"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <div className="relative" ref={projectMenuRef}>
            <button
              onClick={toggleProjectMenu}
              className="flex items-center gap-1 rounded px-2 py-1 text-sm text-gray-300 hover:bg-gray-800"
            >
              <span>{currentProject?.name || t("header.selectProject")}</span>
              <svg
                className="h-3 w-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>

            {showProjectMenu && (
              <div className="absolute left-1/2 -translate-x-1/2 top-full z-50 mt-1 w-64 border border-gray-700 bg-gray-800 py-1 shadow-lg rounded">
                {currentProject && (
                  <div className="border-b border-gray-700 px-3 py-2">
                    <div className="flex flex-col text-left text-sm text-blue-400">
                      <span>{currentProject.name}</span>
                      {currentProject.folderPath && (
                        <span className="truncate text-[10px] text-gray-500">
                          {currentProject.folderPath.replace(
                            /^\/Users\/[^/]+/,
                            "~"
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                <div className="px-2 py-2">
                  <input
                    type="text"
                    value={projectSearch}
                    onChange={(e) => setProjectSearch(e.target.value)}
                    placeholder={t("header.searchProjects")}
                    className="w-full rounded bg-gray-700 border border-gray-600 px-2 py-1 text-sm text-gray-200 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div className="max-h-72 overflow-y-auto">
                  {projectSearch.trim() ? (
                    projectMenuGroups.searchResults.length > 0 ? (
                      projectMenuGroups.searchResults.map((p) => (
                        <ProjectMenuItem
                          key={p.id}
                          project={p}
                          onSelect={handleSelectProject}
                        />
                      ))
                    ) : (
                      <p className="px-3 py-2 text-xs text-gray-500">
                        {t("header.noSearchResults")}
                      </p>
                    )
                  ) : (
                    <>
                      {projectMenuGroups.recent.length > 0 && (
                        <div>
                          <p className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-gray-500">
                            {t("header.recentProjects")}
                          </p>
                          {projectMenuGroups.recent.map((p) => (
                            <ProjectMenuItem
                              key={p.id}
                              project={p}
                              onSelect={handleSelectProject}
                            />
                          ))}
                        </div>
                      )}
                      {projectMenuGroups.mine.length > 0 && (
                        <div>
                          <p className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-gray-500">
                            {t("header.myProjects")}
                          </p>
                          {projectMenuGroups.mine.map((p) => (
                            <ProjectMenuItem
                              key={p.id}
                              project={p}
                              onSelect={handleSelectProject}
                            />
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div className="border-t border-gray-700 mt-1 pt-1">
                  {showNewProject ? (
                    <div className="px-3 py-2 flex gap-2">
                      <input
                        type="text"
                        value={newProjectName}
                        onChange={(e) => setNewProjectName(e.target.value)}
                        onKeyDown={(e) =>
                          e.key === "Enter" && handleCreateProject()
                        }
                        placeholder={t("header.projectName")}
                        className="flex-1 rounded bg-gray-700 border border-gray-600 px-2 py-1 text-sm text-gray-200 focus:border-blue-500 focus:outline-none"
                        autoFocus
                      />
                      <button
                        onClick={handleCreateProject}
                        className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-500"
                      >
                        {t("header.add")}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowNewProject(true)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:bg-gray-700 hover:text-gray-300"
                    >
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 4v16m8-8H4"
                        />
                      </svg>
                      {t("header.newProject")}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Plan badge */}
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase ${
              PLAN_BADGE_STYLES[plan] || PLAN_BADGE_STYLES.free
            }`}
          >
            {plan}
          </span>
        </div>

        {/* Right: Activity Stream toggle + user avatar */}
        <div
          className="flex items-center gap-1"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {/* B3: 현재 프로젝트에 접속 중인 팀원 아바타 (본인 제외, 없으면 무표시) */}
          {currentProject && (
            <PresenceIndicator projectId={currentProject.id} />
          )}

          <BugReportButton />

          <ActivityStreamToggle />

          <div className="relative" ref={userMenuRef}>
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-2 rounded px-2 py-1 hover:bg-gray-800"
            >
              {user?.photoURL ? (
                <img
                  src={user.photoURL}
                  alt=""
                  className="h-6 w-6 rounded-full"
                />
              ) : (
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-500 text-xs font-medium text-white">
                  {user?.displayName?.[0] || user?.email?.[0] || "?"}
                </div>
              )}
              <span className="text-sm text-gray-300">
                {user?.displayName || user?.email || "User"}
              </span>
            </button>

            {showUserMenu && (
              <div className="absolute right-0 top-full z-50 mt-1 w-48 border border-gray-700 bg-gray-800 py-1 shadow-lg">
                <div className="border-b border-gray-700 px-3 py-2">
                  <p className="truncate text-sm text-gray-300">
                    {user?.email}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setShowUserMenu(false);
                    onNavigateToSettings?.();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                  {t("header.settings")}
                </button>
                <button
                  onClick={logout}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-gray-700"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                    />
                  </svg>
                  {t("header.logout")}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* B1: 나에게 온 pending 초대 수락/거절 배너. Header 는 Layout ·
        WorkspaceShell · pre-project 브랜치 전부에 마운트되는 유일한 공통
        상단이라, 여기 두면 초대받은 사용자가 어떤 화면에서든 배너를 본다.
        pending 초대가 없으면 null 을 렌더해 픽셀 변화가 없다. */}
      <InvitationBanner />
    </>
  );
}
