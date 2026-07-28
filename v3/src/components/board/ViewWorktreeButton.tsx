import { useEditorStore } from "../../stores/editorStore";
import { sameWorktreePath } from "../../lib/taskWorktree";
import { viewWorktree } from "../../lib/viewWorktree";
import { useTranslation } from "../../lib/i18n";
import type { Worktree } from "../../types/worktree";

/**
 * "이 워크트리 보기" — the sanctioned entry point that switches the left file
 * tree to this task's worktree and selects its agent in the bottom panel,
 * WITHOUT a full-pane takeover (the current main tab stays put). Closes the
 * host surface (modal / drawer) so the sidebar file tree behind it becomes
 * visible.
 *
 * TaskDetailModal 지역 컴포넌트였으나 퀵레인 상세 드로우도 같은 동작이 필요해
 * 파일로 뺐다. 이 버튼을 복제하면 "보는 중" 판정(rootPath 대조)과 focusAgentId
 * 전달이 두 벌이 되고, 한쪽만 낡는다.
 */
export function ViewWorktreeButton({
  worktree,
  agentId,
  onClose,
}: {
  worktree: Worktree;
  agentId: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const rootPath = useEditorStore((s) => s.rootPath);
  const viewing = sameWorktreePath(rootPath, worktree.path);

  return (
    <button
      type="button"
      onClick={() => {
        viewWorktree(worktree, { focusAgentId: agentId });
        onClose();
      }}
      className={`flex items-center gap-2 rounded border px-3 py-2 text-sm transition-colors ${
        viewing
          ? "border-purple-500/50 bg-purple-500/20 text-purple-200"
          : "border-purple-500/30 bg-purple-500/10 text-purple-300 hover:bg-purple-500/20"
      }`}
      title={
        viewing
          ? t("board.taskDetail.viewingWorktree")
          : t("board.taskDetail.viewWorktreeTip", { branch: worktree.branch })
      }
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
          d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
        />
      </svg>
      {viewing
        ? t("board.taskDetail.viewingWorktree")
        : t("board.taskDetail.viewWorktree")}
      <span className="font-mono text-xs text-purple-400/80">
        {worktree.branch}
      </span>
    </button>
  );
}
