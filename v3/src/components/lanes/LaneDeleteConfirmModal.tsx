import { useEffect } from "react";

/**
 * 레인 삭제 전용 destructive 확인 모달 — window.confirm 대체.
 * 실제 cleanup 은 호출측(LanesTab.performDelete)이 수행하고, 여기서는
 * 무엇이 제거되는지 보여주고 확정/취소만 받는다. 취소 시 아무 변경 없음.
 */
export function LaneDeleteConfirmModal({
  title,
  branch,
  hasAgent,
  hasWorktree,
  onCancel,
  onConfirm,
}: {
  title: string;
  branch: string | null;
  hasAgent: boolean;
  hasWorktree: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="lane-delete-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
    >
      <div
        className="w-[420px] rounded-lg border border-red-500/30 bg-gray-800 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          id="lane-delete-title"
          className="mb-2 text-sm font-semibold text-red-300"
        >
          레인 항목 삭제
        </h3>
        <p className="mb-3 text-sm text-gray-200">
          <span className="font-medium">“{title}”</span> 레인 항목을 삭제할까요?
        </p>
        <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          <p className="mb-1 font-medium">
            이 작업은 되돌릴 수 없으며 아래 항목이 함께 제거됩니다:
          </p>
          <ul className="list-inside list-disc space-y-0.5 text-red-300/90">
            {hasAgent && <li>에이전트 프로세스 및 기록</li>}
            <li>태스크 기록</li>
            {hasWorktree && (
              <li>
                격리 워크트리와 브랜치
                {branch && (
                  <span className="ml-1 font-mono text-red-200">
                    ({branch})
                  </span>
                )}
              </li>
            )}
          </ul>
        </div>
        <div className="flex justify-end gap-2">
          <button
            autoFocus
            type="button"
            onClick={onCancel}
            className="rounded px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500"
          >
            삭제
          </button>
        </div>
      </div>
    </div>
  );
}
