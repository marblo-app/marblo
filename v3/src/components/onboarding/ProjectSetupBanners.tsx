import { t } from "../../lib/i18n";
import type { ProjectSetup } from "../../hooks/useProjectSetup";

/**
 * The folder-choice + inline-create banners for the project-setup flow. Split
 * out of FileTree so they render at the always-mounted Layout level: the flow
 * can be triggered (via `marblo:select-folder`) with the sidebar collapsed or
 * on a non-files panel, so its follow-up prompts must not live inside FileTree.
 */
export function ProjectSetupBanners(props: ProjectSetup) {
  const {
    folderChoice,
    handleChooseRegister,
    handleChooseBrowse,
    dismissFolderChoice,
    showNewProject,
    newProjectName,
    setNewProjectName,
    newProjectInputRef,
    handleCreateInlineProject,
    handleCancelInlineProject,
  } = props;

  if (!folderChoice && !showNewProject) return null;

  return (
    <div className="flex-shrink-0">
      {/* Folder-open choice banner — shown when an unregistered folder is
          picked: register it as a project, or just browse it read-only. */}
      {folderChoice && (
        <div className="border-b border-blue-500/30 bg-blue-500/10 px-3 py-2">
          <p className="mb-1 text-[11px] font-medium text-blue-400">
            {t("sidebar.tree.openFolder")}
          </p>
          <p
            className="mb-2 truncate text-[10px] text-gray-400"
            title={folderChoice.path}
          >
            {folderChoice.path}
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={handleChooseRegister}
              className="rounded bg-blue-600 px-2 py-1 text-[11px] text-white hover:bg-blue-500"
            >
              {t("sidebar.tree.registerProject")}
            </button>
            <button
              onClick={handleChooseBrowse}
              className="rounded bg-gray-700 px-2 py-1 text-[11px] text-gray-200 hover:bg-gray-600"
            >
              {t("sidebar.tree.browseReadonly")}
            </button>
            <button
              onClick={dismissFolderChoice}
              className="ml-auto rounded px-2 py-1 text-[11px] text-gray-400 hover:text-gray-200"
              title={t("sidebar.tree.cancel")}
            >
              {t("sidebar.tree.cancel")}
            </button>
          </div>
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
