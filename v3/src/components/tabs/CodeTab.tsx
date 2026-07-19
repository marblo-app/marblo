import { useEffect, useMemo } from "react";
import { useEditorStore } from "../../stores/editorStore";
import { useProjectStore } from "../../stores/projectStore";
import { useWorktreeStore } from "../../stores/worktreeStore";
import { EditorTabs } from "../code/EditorTabs";
import { CodeEditor } from "../code/CodeEditor";
import { ImagePreview } from "../code/ImagePreview";
import { DiffSurface } from "../workspace/DiffSurface";
import { WorktreeDiffBanner } from "../code/WorktreeDiffBanner";
import { isImageFile } from "../../lib/imageFiles";
import {
  countUnknownVerdicts,
  isActiveOngoingWorktree,
} from "../../lib/worktreeHygiene";
import { useTranslation } from "../../lib/i18n";

export interface DiffRenderProps {
  filePath: string;
  language: string;
  currentContent: string;
}

interface CodeTabProps {
  /**
   * Optional override for the diff view. Defaults to DiffSurface (diff-A:
   * full-width diff + Monaco inline review comments routed to the orchestrator)
   * for ALL users, regardless of workspace mode. Callers that need the plain
   * legacy DiffViewer can inject it here; the Workspace shell relies on the
   * default so there is a single source of truth for the diff experience.
   */
  renderDiff?: (props: DiffRenderProps) => JSX.Element;
}

export function CodeTab({ renderDiff }: CodeTabProps = {}) {
  const { t } = useTranslation();
  const openFiles = useEditorStore((s) => s.openFiles);
  const activeFilePath = useEditorStore((s) => s.activeFilePath);
  const showDiff = useEditorStore((s) => s.showDiff);
  const rootPath = useEditorStore((s) => s.rootPath);
  const setRootPath = useEditorStore((s) => s.setRootPath);
  const closeAllFiles = useEditorStore((s) => s.closeAllFiles);
  const saveError = useEditorStore((s) => s.saveError);
  const clearSaveError = useEditorStore((s) => s.clearSaveError);
  const currentProject = useProjectStore((s) => s.currentProject);
  const worktrees = useWorktreeStore((s) => s.worktrees);
  const ensureFreshWorktrees = useWorktreeStore((s) => s.ensureFresh);
  const archiveOverrides = useWorktreeStore((s) => s.archiveOverrides);

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

  // Only active/ongoing task worktrees belong in the dropdown — merged/idle
  // (auto-archived) and manually-archived ones are hidden so the list stays
  // usable even when a project has accumulated 100+ worktrees. The currently
  // selected root is always kept visible (below) so switching *away* from an
  // archived worktree still works.
  const activeWorktrees = useMemo(
    () =>
      projectWorktrees.filter((worktree) =>
        isActiveOngoingWorktree(worktree, archiveOverrides),
      ),
    [projectWorktrees, archiveOverrides],
  );

  const selectedWorktree = projectWorktrees.find(
    (worktree) => worktree.path === rootPath,
  );

  // The dropdown's options: active worktrees, plus the current selection if it
  // happens to be an archived one (so the <select> value stays valid).
  const visibleWorktrees = useMemo(() => {
    if (
      selectedWorktree &&
      !activeWorktrees.some((w) => w.path === selectedWorktree.path)
    ) {
      return [...activeWorktrees, selectedWorktree];
    }
    return activeWorktrees;
  }, [activeWorktrees, selectedWorktree]);

  const archivedCount = projectWorktrees.length - activeWorktrees.length;

  // Worktrees git could not judge. They stay listed (hiding unjudged work is
  // worse than one extra row), but the count is shown rather than swallowed —
  // a filter with no evidence should look broken, not look empty. When the
  // verdict path died this would have read "판정 불가 160" instead of quietly
  // listing all of them (ticket NaviULZe).
  const unknownCount = useMemo(
    () => countUnknownVerdicts(projectWorktrees),
    [projectWorktrees],
  );

  const selectedRoot = selectedWorktree ? (rootPath ?? "") : "__project__";

  // Light (topology-only) refresh with a TTL. The tab remounts on every tab
  // switch, and the full worktree:list sweep it used to fire here spawns up to
  // 7 git subprocesses per worktree — measured 12–26s of disk-saturating storm
  // at ~680 registered worktrees, dragging the whole app (ticket HruNFJpj).
  // The dropdown only needs enumeration; archived-filter verdicts come from
  // the persisted verdict cache (see lib/worktreeVerdictCache).
  useEffect(() => {
    ensureFreshWorktrees().catch(() => {});
  }, [ensureFreshWorktrees]);

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
          {visibleWorktrees.map((worktree) => (
            <option key={worktree.id} value={worktree.path}>
              {worktree.taskId ? `${worktree.taskId} · ` : ""}
              {worktree.branch} · {worktree.path}
            </option>
          ))}
          {archivedCount > 0 && (
            <option disabled value="__archived_hint__">
              {t("code.rootArchivedHint", { count: archivedCount })}
            </option>
          )}
          {unknownCount > 0 && (
            <option disabled value="__unknown_hint__">
              {t("code.rootUnknownHint", { count: unknownCount })}
            </option>
          )}
        </select>
      </div>

      {/* Editor tabs */}
      <EditorTabs />

      {/* Verdict of the "이 워크트리 보기" diff auto-open — the changed-file
          strip when it opened, and an explicit reason when it could not. Both
          shells render CodeTab, so this covers legacy Layout and the Workspace
          shell alike. */}
      <WorktreeDiffBanner />

      {/* Save failure — a swallowed write error means the edit never hit disk */}
      {saveError && (
        <div className="flex items-center gap-2 border-b border-red-800 bg-red-950/70 px-3 py-1.5 text-xs text-red-200">
          <span className="flex-1 truncate">
            {t("code.saveFailed", { name: saveError.name })}:{" "}
            {saveError.message}
          </span>
          <button
            type="button"
            onClick={clearSaveError}
            className="flex-shrink-0 rounded px-1.5 py-0.5 text-red-300 hover:bg-red-900/60 hover:text-red-100"
            aria-label={t("code.saveFailedDismiss")}
          >
            ✕
          </button>
        </div>
      )}

      {/* Editor content */}
      <div className="flex-1 overflow-hidden">
        {activeFile ? (
          showDiff ? (
            renderDiff ? (
              renderDiff({
                filePath: activeFile.path,
                language: activeFile.language,
                currentContent: activeFile.content,
              })
            ) : (
              <DiffSurface
                filePath={activeFile.path}
                language={activeFile.language}
                currentContent={activeFile.content}
              />
            )
          ) : isImageFile(activeFile.path) ? (
            <ImagePreview
              filePath={activeFile.path}
              content={activeFile.content}
              language={activeFile.language}
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
