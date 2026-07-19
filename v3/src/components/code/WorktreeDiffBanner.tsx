import type { ReactNode } from "react";
import { useEditorStore } from "../../stores/editorStore";
import { useWorktreeDiffStore } from "../../stores/worktreeDiffStore";
import { useNavigationStore } from "../../stores/navigationStore";
import { useTranslation } from "../../lib/i18n";

/**
 * Renders the verdict of the "이 워크트리 보기" diff auto-open.
 *
 * Lives in CodeTab, which both shells render verbatim (legacy Layout and the
 * Workspace shell's PaneContent), so one component covers both.
 *
 * ── Why this exists at all ───────────────────────────────────────────────────
 * The diff can legitimately fail to appear: nothing changed, the agent already
 * committed everything, every change was a deletion, git errored. Without this
 * banner each of those looks identical to the bug we just fixed — a click that
 * silently does nothing. So every non-"opened" outcome says what happened and,
 * where there is one, offers the next step.
 */
export function WorktreeDiffBanner() {
  const { t } = useTranslation();
  const state = useWorktreeDiffStore((s) => s.state);
  const reset = useWorktreeDiffStore((s) => s.reset);
  const rootPath = useEditorStore((s) => s.rootPath);
  const activeFilePath = useEditorStore((s) => s.activeFilePath);
  const openFile = useEditorStore((s) => s.openFile);
  const requestJump = useNavigationStore((s) => s.requestJump);

  if (state.kind === "idle") return null;

  // The verdict describes one worktree; once the root moves elsewhere it is
  // stale and must not keep describing the pane the user is now looking at.
  if (state.worktreePath !== rootPath) return null;

  if (state.kind === "loading") {
    return (
      <Bar tone="neutral">
        <span className="text-gray-400">{t("code.worktreeDiff.loading")}</span>
      </Bar>
    );
  }

  if (state.kind === "opened") {
    return (
      <Bar tone="neutral" onDismiss={reset}>
        <span className="flex-shrink-0 text-gray-400">
          {t("code.worktreeDiff.changedCount", { count: state.files.length })}
        </span>
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {state.files.map((file) => {
            const isActive = file.path === activeFilePath;
            return (
              <button
                key={file.path}
                type="button"
                disabled={!file.openable}
                onClick={() => void openFile(file.path)}
                title={
                  file.openable
                    ? file.relPath
                    : t("code.worktreeDiff.deletedFile", {
                        path: file.relPath,
                      })
                }
                className={`flex-shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${
                  isActive
                    ? "bg-blue-600 text-white"
                    : file.openable
                      ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                      : "cursor-not-allowed bg-gray-800 text-gray-500 line-through"
                }`}
              >
                {file.status} {file.relPath}
              </button>
            );
          })}
        </div>
      </Bar>
    );
  }

  if (state.kind === "committedOnly") {
    return (
      <Bar tone="warning" onDismiss={reset}>
        <span className="flex-1">
          {t("code.worktreeDiff.committedOnly", {
            count: state.filesChanged,
          })}
        </span>
        <button
          type="button"
          onClick={() => requestJump({ type: "worktrees" })}
          className="flex-shrink-0 rounded border border-amber-700 px-2 py-0.5 text-amber-200 hover:bg-amber-900/40"
        >
          {t("code.worktreeDiff.viewFullDiff")}
        </button>
      </Bar>
    );
  }

  if (state.kind === "clean") {
    return (
      <Bar tone="neutral" onDismiss={reset}>
        <span className="flex-1">{t("code.worktreeDiff.clean")}</span>
      </Bar>
    );
  }

  if (state.kind === "deletionsOnly") {
    return (
      <Bar tone="warning" onDismiss={reset}>
        <span className="flex-1">
          {t("code.worktreeDiff.deletionsOnly", { count: state.files.length })}
        </span>
      </Bar>
    );
  }

  return (
    <Bar tone="danger" onDismiss={reset}>
      <span className="flex-1">
        {t("code.worktreeDiff.error", { message: state.message })}
      </span>
    </Bar>
  );
}

function Bar({
  tone,
  onDismiss,
  children,
}: {
  tone: "neutral" | "warning" | "danger";
  onDismiss?: () => void;
  children: ReactNode;
}) {
  const toneClass =
    tone === "danger"
      ? "border-red-800 bg-red-950/70 text-red-200"
      : tone === "warning"
        ? "border-amber-800 bg-amber-950/60 text-amber-200"
        : "border-gray-700 bg-gray-800/80 text-gray-300";

  return (
    <div
      className={`flex items-center gap-2 border-b px-3 py-1.5 text-xs ${toneClass}`}
    >
      {children}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="flex-shrink-0 rounded px-1.5 py-0.5 opacity-70 hover:bg-white/10 hover:opacity-100"
          aria-label="Dismiss"
        >
          ✕
        </button>
      )}
    </div>
  );
}
