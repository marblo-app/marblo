import { useTranslation } from "../../lib/i18n";
import type {
  AuditMissionProgress,
  AuditMissionSection,
} from "../../lib/projectAuditView";
import type { Worktree } from "../../types/worktree";
import { formatAuditTime } from "./ProjectAuditRow";
import { ProjectAuditTicketCard } from "./ProjectAuditTicketCard";

/**
 * 미션 섹션 — 티켓 카드들을 묶는 상위 맥락.
 *
 * 미션이 없는 티켓은 마지막 "보드" 섹션에 모인다. 두 종류를 같은 컴포넌트가
 * 그리는 이유는 레이아웃이 같아야 하기 때문이다 — 보드만 다른 모양이면 화면이
 * 두 개의 목록으로 읽히고, 그러면 접기 규칙도 두 벌이 된다.
 */
export function ProjectAuditMissionSectionView({
  section,
  locale,
  worktrees,
  expandedTickets,
  onToggleTicket,
  onOpenTicket,
  onOpenBoard,
}: {
  section: AuditMissionSection;
  locale: string;
  worktrees: Worktree[];
  expandedTickets: Set<string>;
  onToggleTicket: (key: string) => void;
  onOpenTicket: (taskId: string) => void;
  onOpenBoard: (taskId: string) => void;
}) {
  const { t } = useTranslation();
  const isBoard = section.missionId === null;

  return (
    <section
      data-testid="audit-section"
      data-mission-id={section.missionId ?? "__board__"}
      className="rounded-lg border border-gray-800 bg-gray-900/30 p-2"
    >
      <header className="mb-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-1">
        <span aria-hidden className="flex-shrink-0 text-xs">
          {isBoard ? "🗂️" : "🎯"}
        </span>
        <h4 className="min-w-0 flex-1 truncate text-sm font-medium text-gray-100">
          {isBoard
            ? t("project.audit.admin.boardSection")
            : (section.goal ?? `#${section.missionId?.slice(0, 8)}`)}
        </h4>

        {section.status && (
          <span className="flex-shrink-0 rounded border border-gray-700 bg-gray-900 px-1.5 py-0.5 text-[10px] uppercase text-gray-400">
            {section.status}
          </span>
        )}

        {section.progress && <MissionProgressBar progress={section.progress} />}

        {section.attentionCount > 0 && (
          <span className="flex-shrink-0 rounded border border-red-800/70 bg-red-950/40 px-1.5 py-0.5 text-[10px] text-red-300">
            ⚠ {section.attentionCount}
          </span>
        )}

        <span className="flex-shrink-0 text-[11px] text-gray-500">
          {t("project.audit.admin.missionSummary", {
            tickets: section.ticketCount,
            actions: section.actionCount,
          })}
        </span>

        <span className="flex-shrink-0 text-xs tabular-nums text-gray-500">
          {formatAuditTime(section.latestAt, locale)}
        </span>
      </header>

      {isBoard && (
        <p className="mb-1 px-1 text-[11px] text-gray-600">
          {t("project.audit.admin.boardSectionNote")}
        </p>
      )}

      <ul className="space-y-1.5">
        {section.tickets.map((group) => (
          <ProjectAuditTicketCard
            key={group.key}
            group={group}
            expanded={expandedTickets.has(group.key)}
            onToggle={() => onToggleTicket(group.key)}
            locale={locale}
            worktrees={worktrees}
            onOpenTicket={onOpenTicket}
            onOpenBoard={onOpenBoard}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * 진행바.
 *
 * ★분모의 출처를 숨기지 않는다. 롤업(`projection`)이 없어 `taskIds` 로 셌고 그중
 * 상태를 못 읽은 티켓이 있으면 "(N 미상)" 을 같이 쓴다 — 3/10 이라고만 쓰면
 * 나머지 7이 전부 미완료인 것처럼 읽히는데, 실제로는 모르는 것일 수 있다.
 */
function MissionProgressBar({ progress }: { progress: AuditMissionProgress }) {
  const { t } = useTranslation();
  const pct =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <span className="flex flex-shrink-0 items-center gap-1.5">
      <span
        className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-800"
        role="presentation"
      >
        <span
          className="block h-full rounded-full bg-emerald-500/70"
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="text-[10px] tabular-nums text-gray-400">
        {t("project.audit.admin.missionProgress", {
          done: progress.done,
          total: progress.total,
        })}
        {progress.unknown > 0 &&
          t("project.audit.admin.missionProgressUnknown", {
            count: progress.unknown,
          })}
      </span>
    </span>
  );
}
