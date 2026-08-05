import { useTranslation } from "../../lib/i18n";
import { findTaskWorktree } from "../../lib/taskWorktree";
import type { Worktree } from "../../types/worktree";
import { ViewWorktreeButton } from "../board/ViewWorktreeButton";

/**
 * 티켓 하나의 **링크 클러스터** — [티켓 상세] · [PR] · [워크트리].
 *
 * ★왜 "점프 버튼"을 폐기했나
 * 예전엔 감사 행마다 "이 워크트리 보기"라는 큰 보라색 버튼이 붙어 있었다. 감사
 * 화면에서 그건 이질적이다 — 운영자는 기록을 **읽으러** 왔는데 가장 큰 시각적
 * 무게가 화면을 떠나는 동작에 실려 있었다(사장님 도그푸딩 피드백). 완료 이력
 * (WorkHistoryTab)은 이미 같은 문제를 텍스트 링크 한 줄로 풀어 뒀고, 이 클러스터는
 * 그 시각 언어를 그대로 가져온다 — 두 화면이 한 제품처럼 읽히도록.
 *
 * ★없는 링크는 **숨긴다**(비활성으로도 안 남긴다). PR 없는 티켓에 회색 PR 링크가
 * 남아 있으면 "PR 이 있는데 못 여는 건가?"가 된다. 유일한 예외가 워크트리인데,
 * 그건 "없다"가 아니라 **"있었는데 정리됐다"** 라는 별개의 사실이라 아카이브
 * 안내로 남긴다(#781).
 */
export function ProjectAuditLinks({
  taskId,
  prUrl,
  worktreeId,
  worktrees,
  onOpenTicket,
  onNavigate,
}: {
  taskId: string;
  /** task.prUrl. 없으면 PR 링크를 아예 안 그린다. */
  prUrl: string | null;
  /** 원장이 기록한 worktreeId. null 이면 이 티켓엔 워크트리 근거 자체가 없다. */
  worktreeId: string | null;
  worktrees: Worktree[];
  onOpenTicket: (taskId: string) => void;
  /** 워크트리로 이동할 때 호출부가 닫아야 할 표면이 있으면(모달 등). */
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  // 원장에 근거가 있을 때만 라이브 워크트리를 찾는다. 근거 없이 경로만 맞는
  // 워크트리를 붙이면 "이 티켓이 거기서 작업됐다"는 없는 사실을 만든다.
  const live = worktreeId ? findTaskWorktree(worktrees, { id: taskId }) : null;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <button
        type="button"
        onClick={() => onOpenTicket(taskId)}
        className="text-xs text-blue-400 transition-colors hover:text-blue-300 hover:underline"
        title={`#${taskId}`}
      >
        {t("project.audit.admin.linkTicket")}
      </button>

      {prUrl && (
        <a
          href={prUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-blue-400 transition-colors hover:text-blue-300 hover:underline"
          title={prUrl}
        >
          {t("project.audit.admin.linkPr")} ↗
        </a>
      )}

      {live && (
        <ViewWorktreeButton
          worktree={live}
          agentId={live.agentId}
          onClose={onNavigate ?? (() => {})}
          variant="link"
        />
      )}

      {/* ★raw worktreeId 를 줄에 찍지 않는다. 예전엔 `<project>/<taskId>` 원문이
          링크 옆에 그대로 붙어 있어서 줄이 그 문자열에 잡아먹혔고, 정작 운영자가
          읽어야 할 것(이 티켓의 워크트리는 이미 정리됐다)이 안 보였다 — 사장님이
          "Archived 워크트리가 raw 태그"로 지적한 지점이다. 원문은 버리지 않고
          tooltip 으로 옮긴다(대조가 필요한 사람은 hover 로 그대로 본다). */}
      {worktreeId && !live && (
        <span
          className="inline-flex flex-shrink-0 items-center rounded border border-amber-800/60 bg-amber-950/20 px-1.5 py-0.5 text-[10px] text-amber-300"
          title={t("project.audit.worktreeArchivedTip", { worktreeId })}
        >
          {t("project.audit.worktreeArchived")}
        </span>
      )}
    </div>
  );
}
