import { useEffect, useMemo } from "react";
import { useEditorStore } from "../../stores/editorStore";
import { useProjectStore } from "../../stores/projectStore";
import { useWorktreeStore } from "../../stores/worktreeStore";
import { EditorTabs } from "../code/EditorTabs";
import { CodeEditor } from "../code/CodeEditor";
import { DiffViewer } from "../code/DiffViewer";
import { useTranslation } from "../../lib/i18n";

export function CodeTab() {
  const { t } = useTranslation();
  const openFiles = useEditorStore((s) => s.openFiles);
  const activeFilePath = useEditorStore((s) => s.activeFilePath);
  const showDiff = useEditorStore((s) => s.showDiff);
  const rootPath = useEditorStore((s) => s.rootPath);
  const setRootPath = useEditorStore((s) => s.setRootPath);
  const closeAllFiles = useEditorStore((s) => s.closeAllFiles);
  const currentProject = useProjectStore((s) => s.currentProject);
  const worktrees = useWorktreeStore((s) => s.worktrees);
  const refreshWorktrees = useWorktreeStore((s) => s.refresh);

  const activeFile = openFiles.find((f) => f.path === activeFilePath);
  const projectRootPath = currentProject?.folderPath ?? null;

  const projectWorktrees = useMemo(() => {
    if (!currentProject) return [];
    return worktrees
      .filter((worktree) => worktree.projectId === currentProject.id)
      .sort((a, b) =>
        (a.taskId ?? a.branch).localeCompare(b.taskId ?? b.branch),
      );
  }, [currentProject, worktrees]);

  const selectedRoot = projectWorktrees.some(
    (worktree) => worktree.path === rootPath,
  )
    ? (rootPath ?? "")
    : "__project__";

  useEffect(() => {
    refreshWorktrees().catch(() => {});
  }, [refreshWorktrees]);

  const handleRootChange = (value: string) => {
    const nextRoot = value === "__project__" ? projectRootPath : value;
    if (nextRoot === rootPath) return;
    closeAllFiles();
    setRootPath(nextRoot);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-gray-700 bg-gray-800 px-3 py-2">
        <span className="text-xs font-medium text-gray-400">Root</span>
        <select
          value={selectedRoot}
          onChange={(event) => handleRootChange(event.target.value)}
          className="min-w-0 max-w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200 outline-none focus:border-blue-500"
          title={rootPath ?? t("code.rootNotSelected")}
        >
          <option value="__project__">
            {projectRootPath
              ? `Project root · ${projectRootPath}`
              : "Project root"}
          </option>
          {projectWorktrees.map((worktree) => (
            <option key={worktree.id} value={worktree.path}>
              {worktree.taskId ? `${worktree.taskId} · ` : ""}
              {worktree.branch} · {worktree.path}
            </option>
          ))}
        </select>
      </div>

      {/* Editor tabs */}
      <EditorTabs />

      {/* Editor content */}
      <div className="flex-1 overflow-hidden">
        {activeFile ? (
          showDiff ? (
            <DiffViewer
              filePath={activeFile.path}
              language={activeFile.language}
              currentContent={activeFile.content}
            />
          ) : (
            <CodeEditor
              filePath={activeFile.path}
              content={activeFile.content}
              language={activeFile.language}
            />
          )
        ) : (
          <div className="flex h-full items-center justify-center text-gray-400">
            <div className="text-center">
              <svg
                className="mx-auto h-16 w-16 text-gray-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                />
              </svg>
              <p className="mt-4 text-lg font-medium">
                {t("code.noFileSelected.title")}
              </p>
              <p className="mt-1 text-sm text-gray-500">
                {t("code.noFileSelected.hint")}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
