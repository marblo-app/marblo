import { t } from "../../lib/i18n";
import type { ProjectSetup } from "../../hooks/useProjectSetup";

/**
 * The inline name-your-project banner for the project-setup flow. Split out of
 * FileTree so it renders at the always-mounted Layout level: the flow can be
 * triggered (via `marblo:select-folder`) with the sidebar collapsed or on a
 * non-files panel, so its follow-up prompt must not live inside FileTree.
 *
 * The happy path is silent — picking a folder auto-registers a project (named
 * after the folder) and boots the orchestrator with no banner at all. This
 * inline banner is only the fallback shown when auto-register can't run (not
 * signed in) or the write fails.
 */
export function ProjectSetupBanners(props: ProjectSetup) {
  const {
    showNewProject,
    newProjectName,
    setNewProjectName,
    newProjectInputRef,
    handleCreateInlineProject,
    handleCancelInlineProject,
    recoveryNotice,
    dismissRecoveryNotice,
  } = props;

  if (!showNewProject && !recoveryNotice) return null;

  return (
    <div className="flex-shrink-0">
      {recoveryNotice && (
        <div className="flex items-center justify-between gap-3 border-b border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-200">
          <span className="min-w-0 truncate">{recoveryNotice}</span>
          <button
            type="button"
            onClick={dismissRecoveryNotice}
            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-emerald-200 hover:bg-emerald-500/20"
            aria-label="Dismiss notice"
          >
            x
          </button>
        </div>
      )}

      {/* Inline project creation banner */}
      {showNewProject && (
        <div className="border-b border-blue-500/30 bg-blue-500/10 px-3 py-2">
          <p className="mb-1 text-[11px] font-medium text-blue-400">
            {t("sidebar.tree.newProject")}
          </p>
          <div className="flex items-center gap-1">
            <input
              ref={newProjectInputRef}
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateInlineProject();
                if (e.key === "Escape") handleCancelInlineProject();
              }}
              className="flex-1 rounded border border-gray-600 bg-gray-700 px-2 py-1 text-xs text-gray-200 focus:border-blue-500 focus:outline-none"
              placeholder={t("sidebar.tree.projectNamePlaceholder")}
            />
            <button
              onClick={handleCreateInlineProject}
              className="rounded bg-blue-600 px-2 py-1 text-[11px] text-white hover:bg-blue-500"
              title={t("sidebar.tree.create")}
            >
              <svg
                className="h-3.5 w-3.5"
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
            </button>
          </div>
          <p className="mt-1 text-[10px] text-gray-500">
            {t("sidebar.tree.createHint")}
          </p>
        </div>
      )}
    </div>
  );
}
