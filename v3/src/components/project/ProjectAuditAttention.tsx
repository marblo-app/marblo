import { useTranslation } from "../../lib/i18n";
import { taskStatusPillClass } from "../../lib/taskStatusStyle";
import type { AuditTicketGroup } from "../../lib/projectAuditView";
import { formatAuditTime } from "./ProjectAuditRow";
import { AttentionPill } from "./ProjectAuditTicketCard";

/** 배너에 펼쳐 보여주는 최대 건수. 나머지는 "외 N건" 으로만 센다. */
const VISIBLE_LIMIT = 5;

/**
 * 문제 우선 배너 — 이 화면에서 **가장 위**에 오는 블록.
 *
 * ★설계의 1번 항목이다. 예전 감사 화면은 시간순 firehose 라서, 지금 막힌 티켓이
 * 있어도 최근 메모 40건 아래로 밀려 보이지 않았다. 운영자가 이 탭을 여는 첫 번째
 * 이유("뭐 하나 터졌나?")에 화면이 스크롤 없이 답해야 한다.
 *
 * ★필터를 무시한다. 미션 하나만 보려고 필터를 걸어 둔 사이 다른 미션이 불타는
 * 것을 감사 화면이 숨기면 안 된다. 대신 그 사실을 문구로 밝힌다 —
 * "필터와 무관하게 전체 기준".
 *
 * 문제가 없을 때도 **블록을 없애지 않는다**. 조용히 사라지면 "이 화면에 그런
 * 기능이 있었나?" 가 되고, 다음에 진짜 문제가 떴을 때 그게 새 UI 처럼 보인다.
 */
export function ProjectAuditAttention({
  groups,
  locale,
  onOpenTicket,
  onOpenBoard,
}: {
  /** 주의 필요 티켓, 이미 심각도→최신순으로 정렬된 것. */
  groups: AuditTicketGroup[];
  locale: string;
  onOpenTicket: (taskId: string) => void;
  onOpenBoard: (group: AuditTicketGroup) => void;
}) {
  const { t } = useTranslation();

  if (groups.length === 0) {
    return (
      <div
        data-testid="audit-attention"
        className="mb-3 flex items-center gap-2 rounded border border-gray-800 bg-gray-900/40 px-3 py-2"
      >
        <span aria-hidden className="text-sm text-emerald-400">
          ✓
        </span>
        <span className="text-xs text-gray-400">
          {t("project.audit.admin.attentionNone")}
        </span>
      </div>
    );
  }

  const visible = groups.slice(0, VISIBLE_LIMIT);
  const overflow = groups.length - visible.length;

  return (
    <div
      data-testid="audit-attention"
      className="mb-3 rounded border border-red-900/50 bg-red-950/20 px-3 py-2"
    >
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-medium text-red-300">
          {t("project.audit.admin.attentionTitle", { count: groups.length })}
        </span>
        <span className="text-[11px] text-gray-500">
          {t("project.audit.admin.attentionScopeNote")}
        </span>
      </div>

      <ul className="space-y-1">
        {visible.map((group) => (
          <li
            key={group.key}
            className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded bg-gray-900/50 px-2 py-1.5"
          >
            <span
              className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${taskStatusPillClass(
                group.status
              )}`}
            >
              {group.status ?? t("project.audit.admin.statusUnknown")}
            </span>

            <span className="min-w-0 flex-1 truncate text-xs text-gray-100">
              {group.title ??
                (group.taskId
                  ? `#${group.taskId.slice(0, 8)}`
                  : t("project.audit.admin.noTicketTitle"))}
            </span>

            {group.attention && (
              <AttentionPill
                attention={group.attention}
                failedCount={group.failedCount}
                claimedBy={group.claimedBy}
              />
            )}

            <span className="flex-shrink-0 text-xs tabular-nums text-gray-500">
              {formatAuditTime(group.latestAt, locale)}
            </span>

            {/* 두 액션만 둔다: 원인을 보는 길(이력)과 고치는 길(보드에서 재배정).
                감사 화면이 직접 재배정하지 않는 이유는, 재배정은 보드/디스패치의
                권한·검증을 지나야 하는 쓰기 동작이고 이 패널은 읽기 전용이기
                때문이다 — 여기서 지름길을 내면 그 게이트가 두 벌이 된다. */}
            {group.taskId && (
              <span className="flex flex-shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => onOpenTicket(group.taskId!)}
                  className="text-xs text-blue-400 transition-colors hover:text-blue-300 hover:underline"
                >
                  {t("project.audit.admin.review")}
                </button>
                <button
                  type="button"
                  onClick={() => onOpenBoard(group)}
                  className="text-xs text-amber-300 transition-colors hover:text-amber-200 hover:underline"
                >
                  {t("project.audit.admin.reassign")}
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>

      {overflow > 0 && (
        <p className="mt-1 text-[11px] text-gray-500">
          {t("project.audit.admin.attentionMore", { count: overflow })}
        </p>
      )}
    </div>
  );
}
