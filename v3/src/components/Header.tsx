import { useState, useRef, useEffect } from "react";
import { useAuth } from "../hooks/useAuth";
import { useProjectStore } from "../stores/projectStore";
import { useEditorStore } from "../stores/editorStore";
import { useSubscriptionStore } from "../stores/subscriptionStore";
import { useActivityStreamStore } from "../stores/activityStreamStore";
import { useTranslation } from "../lib/i18n";
import { createProject } from "../services/projectService";

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
  const userMenuRef = useRef<HTMLDivElement>(null);
  const projectMenuRef = useRef<HTMLDivElement>(null);

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
    <header
      className="flex h-12 items-center justify-between border-b border-gray-700 bg-gray-900 px-4"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {/* Left: Logo */}
      <div className="flex items-center gap-2">
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
            onClick={() => setShowProjectMenu(!showProjectMenu)}
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
            <div className="absolute left-1/2 -translate-x-1/2 top-full z-50 mt-1 w-56 border border-gray-700 bg-gray-800 py-1 shadow-lg rounded">
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleSelectProject(p)}
                  className={`flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-gray-700 ${
                    currentProject?.id === p.id
                      ? "text-blue-400"
                      : "text-gray-300"
                  }`}
                >
                  <span>{p.name}</span>
                  {p.folderPath && (
                    <span className="truncate text-[10px] text-gray-500">
                      {p.folderPath.replace(/^\/Users\/[^/]+/, "~")}
                    </span>
                  )}
                </button>
              ))}
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
                <p className="truncate text-sm text-gray-300">{user?.email}</p>
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
  );
}
