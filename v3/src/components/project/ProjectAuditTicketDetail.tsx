import { useEffect, useMemo } from "react";
import { useTranslation } from "../../lib/i18n";
import { useTaskAuditTrail } from "../../hooks/useProjectAuditLog";
import { useWorktreeStore } from "../../stores/worktreeStore";
import { useReplayableMissions } from "../../hooks/useMissionReplay";
import { useNavigationStore } from "../../stores/navigationStore";
import { findTaskWorktree } from "../../lib/taskWorktree";
import { isReplayDashboardEnabled } from "../../lib/replayDashboardFlag";
import {
  auditSourceNotices,
  isAuditLoading,
  isFullyDenied,
  type LedgerFieldValue,
  type TicketLedgerRow,
} from "../../lib/projectAuditView";
import { ViewWorktreeButton } from "../board/ViewWorktreeButton";
import {
  AuditBadge,
  AuditEvidenceDetails,
  RowLabel,
  formatAuditTime,
} from "./ProjectAuditRow";

/**
 * 티켓 원장 상세 — 감사 로그에서 티켓을 클릭했을 때 여는 모달(티켓
 * U6ITRR38Z3c4MGLyg2PU).
 *
 * ★뷰/읽기 전용이다. `useTaskAuditTrail` 이 이미 읽고 있는 두 소스(사람
 * `projectAuditLog` + 오케 원장 `audit_logs`)를 taskId 로 스코프해 다시 읽을
 * 뿐, 새 write 도 새 컬렉션도 만들지 않는다.
 *
 * 크로스링크 둘은 **있을 때만** 뜬다(억지 링크 금지):
 *   - "코드 보기" — 이 티켓 이력에 워크트리 근거(worktreeId)가 있고, 지금 그
 *     워크트리가 실제로 살아 있을 때만. `viewWorktree` 는 보드 카드의 "이
 *     워크트리 보기"와 정확히 같은 초크포인트다(lib/viewWorktree.ts).
 *   - "Replay 보기" — 이 티켓이 완료된 미션(taskIds 에 포함)에 속할 때만.
 *     `useReplayableMissions` 도 완료이력 탭의 Replay 목록과 같은 훅이다.
 */
export function ProjectAuditTicketDetail({
  projectId,
  taskId,
  taskTitle,
  nameByUid,
  onClose,
}: {
  projectId: string;
  taskId: string;
  taskTitle: string | null;
  nameByUid: Record<string, string>;
  onClose: () => void;
}) {
  const { t, locale } = useTranslation();
  const { rows, sources } = useTaskAuditTrail(projectId, taskId, nameByUid);
  const loading = isAuditLoading(sources);
  const notices = auditSourceNotices(sources);

  const worktrees = useWorktreeStore((s) => s.worktrees);
  const ensureFreshWorktrees = useWorktreeStore((s) => s.ensureFresh);
  useEffect(() => {
    ensureFreshWorktrees().catch(() => {});
  }, [taskId, ensureFreshWorktrees]);
  const taskWorktree = useMemo(
    () => findTaskWorktree(worktrees, { id: taskId }),
    [worktrees, taskId],
  );
  const hasWorktreeEvidence = rows.some(
    (row) => row.worktree?.state === "value",
  );
  const showViewCode = !!taskWorktree && hasWorktreeEvidence;
  const archivedWorktreeEvidence =
    !taskWorktree &&
    rows.find((row) => row.worktree?.state === "value")?.worktree;

  // ★"Replay 보기" CTA 는 리플레이 대시보드와 함께 파킹됐다. 미션 구독은 오직
  // 이 CTA 를 그리기 위한 것이라, 파킹 중에는 리스너도 열지 않는다.
  const replayDashboard = useMemo(() => isReplayDashboardEnabled(), []);
  const { missions } = useReplayableMissions(
    replayDashboard ? projectId : null,
  );
  const mission = useMemo(
    () => missions.find((m) => m.taskIds?.includes(taskId)) ?? null,
    [missions, taskId],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border border-gray-700 bg-gray-800 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-gray-700 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="min-w-0 whitespace-normal break-words text-lg font-semibold text-gray-100">
              {taskTitle ?? `#${taskId.slice(0, 8)}`}
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              {t("project.audit.ticket.subtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-3 flex-shrink-0 p-1.5 text-gray-400 transition-colors hover:text-gray-200"
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
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {(showViewCode || archivedWorktreeEvidence || mission) && (
          <div className="flex flex-wrap items-center gap-2 border-b border-gray-700 px-5 py-3">
            {showViewCode && taskWorktree && (
              <ViewWorktreeButton
                worktree={taskWorktree}
                agentId={taskWorktree.agentId}
                onClose={onClose}
              />
            )}
            {archivedWorktreeEvidence && (
              <ArchivedWorktreeNotice evidence={archivedWorktreeEvidence} />
            )}
            {/* ★목적지(History 탭의 Replay 뷰)가 파킹돼 있으면 이 CTA 는 History
                탭을 열고 아무것도 안 하는 죽은 버튼이 된다 — 같은 플래그로 함께
                내린다(`lib/replayDashboardFlag`). */}
            {mission && replayDashboard && (
              <button
                type="button"
                onClick={() => {
                  useNavigationStore.getState().requestJump({
                    type: "missionReplay",
                    missionId: mission.id,
                  });
                  onClose();
                }}
                className="flex items-center gap-1.5 rounded border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs text-blue-300 transition-colors hover:bg-blue-500/20"
              >
                {t("project.audit.ticket.viewReplay")}
              </button>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {isFullyDenied(sources) ? (
            <div className="rounded border border-dashed border-gray-700 bg-gray-900/50 px-4 py-8 text-center">
              <p className="text-sm text-gray-400">
                {t("project.audit.denied")}
              </p>
            </div>
          ) : (
            <>
              {notices.length > 0 && (
                <p className="mb-2 text-xs text-red-400/70">
                  {t("project.audit.ticket.partialNotice")}
                </p>
              )}

              {loading && (
                <div className="flex items-center justify-center py-10">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-600 border-t-blue-500" />
                </div>
              )}

              {!loading &&
                (rows.length === 0 ? (
                  <p className="py-8 text-center text-sm text-gray-500">
                    {t("project.audit.ticket.empty")}
                  </p>
                ) : (
                  <ul className="divide-y divide-gray-800">
                    {rows.map((row) => (
                      <TicketLedgerRowView
                        key={row.key}
                        row={row}
                        locale={locale}
                      />
                    ))}
                  </ul>
                ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** 원장 행 하나 — 목록의 `AuditRow` 와 같은 골격에, 봉인·워크트리 필드 상태를 더한다. */
function TicketLedgerRowView({
  row,
  locale,
}: {
  row: TicketLedgerRow;
  locale: string;
}) {
  const { t } = useTranslation();

  return (
    <li className="py-2">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        <AuditBadge row={row} />

        <span
          className="rounded border border-gray-700 bg-gray-900 px-1.5 py-0.5 text-[10px] text-gray-400"
          title={row.label.kind === "tool" ? row.label.toolName : undefined}
        >
          <RowLabel label={row.label} />
        </span>

        <span className="text-sm text-gray-200">
          {row.actorLabel ?? t("project.audit.actor.unknown")}
        </span>

        {row.detail && (
          <span className="min-w-0 whitespace-normal break-words text-xs text-gray-500">
            {row.detail}
          </span>
        )}

        {row.failed && (
          <span className="rounded border border-red-900/60 px-1 text-[10px] text-red-400">
            {t("project.audit.failed")}
          </span>
        )}

        {row.sealStatus && (
          <span
            className="rounded border border-gray-700 px-1 text-[10px] text-gray-500"
            title={t("project.audit.ticket.sealHint")}
          >
            {row.sealStatus === "sealed"
              ? t("project.audit.ticket.sealed")
              : t("project.audit.ticket.unsealed")}
          </span>
        )}

        {row.worktree && row.worktree.state !== "value" && (
          <span className="rounded border border-amber-800/60 px-1 text-[10px] text-amber-400">
            {row.worktree.state === "preLedger"
              ? t("project.audit.ticket.worktreePreLedger")
              : t("project.audit.ticket.worktreeOutOfConvention")}
          </span>
        )}

        {row.worktree?.state === "value" && (
          <span className="rounded border border-gray-700 bg-gray-900 px-1 font-mono text-[10px] text-gray-400">
            {row.worktree.value}
          </span>
        )}

        <span className="ml-auto flex-shrink-0 text-xs tabular-nums text-gray-500">
          {formatAuditTime(row.createdAt, locale)}
        </span>
      </div>
      <AuditEvidenceDetails evidence={row.evidence} />
    </li>
  );
}

function ArchivedWorktreeNotice({ evidence }: { evidence: LedgerFieldValue }) {
  const { t } = useTranslation();
  if (evidence.state !== "value") return null;
  return (
    <button
      type="button"
      disabled
      className="flex cursor-not-allowed items-center gap-1.5 rounded border border-amber-800/60 bg-amber-950/20 px-3 py-1.5 text-xs text-amber-300 opacity-80"
      title={t("project.audit.worktreeArchivedTip", {
        worktreeId: evidence.value,
      })}
    >
      {t("project.audit.worktreeArchived")}
      <span className="font-mono text-[11px] text-amber-200/80">
        {evidence.value}
      </span>
    </button>
  );
}
