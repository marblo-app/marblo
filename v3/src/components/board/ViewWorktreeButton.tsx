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
 *
 * ★`variant` 는 **모양만** 가른다. 감사 로그의 링크 클러스터는 [티켓]·[PR] 과
 * 같은 줄에 앉는 텍스트 링크라 큰 버튼이 어울리지 않지만, 거기서 이 컴포넌트를
 * 안 쓰고 `viewWorktree` 를 직접 부르면 위 경고가 그대로 현실이 된다("보는 중"
 * 판정이 두 벌). 그래서 복제 대신 껍데기만 두 벌 둔다.
 */
export function ViewWorktreeButton({
  worktree,
  agentId,
  onClose,
  variant = "button",
}: {
  worktree: Worktree;
  agentId: string | null;
  onClose: () => void;
  variant?: "button" | "link";
}) {
  const { t } = useTranslation();
  const rootPath = useEditorStore((s) => s.rootPath);
  const viewing = sameWorktreePath(rootPath, worktree.path);

  const label = viewing
    ? t("board.taskDetail.viewingWorktree")
    : t("board.taskDetail.viewWorktree");
  const title = viewing
    ? t("board.taskDetail.viewingWorktree")
    : t("board.taskDetail.viewWorktreeTip", { branch: worktree.branch });
  const open = () => {
    viewWorktree(worktree, { focusAgentId: agentId });
    onClose();
  };

  if (variant === "link") {
    return (
      <button
        type="button"
        onClick={open}
        title={title}
        className={`inline-flex max-w-full items-center gap-1 text-xs transition-colors ${
          viewing
            ? "text-purple-200"
            : "text-purple-300 hover:text-purple-200 hover:underline"
        }`}
      >
        <WorktreeGlyph className="h-3.5 w-3.5 flex-shrink-0" />
        <span className="flex-shrink-0">{label}</span>
        <span className="min-w-0 truncate font-mono text-[11px] text-purple-400/80">
          {worktree.branch}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={open}
      className={`flex items-center gap-2 rounded border px-3 py-2 text-sm transition-colors ${
        viewing
          ? "border-purple-500/50 bg-purple-500/20 text-purple-200"
          : "border-purple-500/30 bg-purple-500/10 text-purple-300 hover:bg-purple-500/20"
      }`}
      title={title}
    >
      <WorktreeGlyph className="h-4 w-4" />
      {label}
      <span className="font-mono text-xs text-purple-400/80">
        {worktree.branch}
      </span>
    </button>
  );
}

function WorktreeGlyph({ className }: { className: string }) {
  return (
    <svg
      className={className}
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
  );
}
