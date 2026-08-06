import { useMemo } from "react";
import type { MessageKey } from "../../locales/ko";
import { useTranslation } from "../../lib/i18n";
import { taskStatusPillClass } from "../../lib/taskStatusStyle";
import {
  foldAuditRows,
  type AuditAttention,
  type AuditTicketGroup,
} from "../../lib/projectAuditView";
import type { Worktree } from "../../types/worktree";
import { ProjectAuditLinks } from "./ProjectAuditLinks";
import { AuditTimelineRow, formatAuditTime } from "./ProjectAuditRow";

/**
 * 티켓 하나의 카드 = 이 화면의 1차 단위.
 *
 * 헤더 한 줄이 "이 티켓은 지금 어떤 상태이고, 누가(어느 모델이) 몇 번 손댔고,
 * 마지막이 언제인가"를 답한다. 예전에는 같은 티켓이 created/claimed/dispatched/
 * status/submitted 로 5줄씩 흩어져 그 질문에 답하려면 화면을 스캔해야 했다.
 *
 * ★캡처는 그대로다 — 펼치면 그 5줄이 원문 그대로 다시 보인다. 이 카드는 표현만
 * 접는다(lib/projectAuditView 의 `foldAuditRows` 와 같은 원칙).
 */
export function ProjectAuditTicketCard({
  group,
  expanded,
  onToggle,
  locale,
  worktrees,
  onOpenTicket,
  onOpenBoard,
}: {
  group: AuditTicketGroup;
  expanded: boolean;
  onToggle: () => void;
  locale: string;
  worktrees: Worktree[];
  onOpenTicket: (taskId: string) => void;
  onOpenBoard: (taskId: string) => void;
}) {
  const { t } = useTranslation();

  // 펼친 타임라인 안에서도 같은 티켓의 연속 메모는 접는다 — 한 티켓 안에서만
  // 도는 루프라 그룹 조건(같은 taskId)이 자동으로 만족된다.
  const timeline = useMemo(() => foldAuditRows(group.rows), [group.rows]);

  const title =
    group.title ??
    (group.taskId
      ? `#${group.taskId.slice(0, 8)}`
      : t("project.audit.admin.noTicketTitle"));

  return (
    <li
      data-testid="audit-ticket"
      data-task-id={group.taskId ?? "__none__"}
      className={`rounded border px-3 py-2 transition-colors ${
        group.attention
          ? group.attention.severity === "critical"
            ? "border-red-900/60 bg-red-950/10"
            : "border-amber-900/50 bg-amber-950/10"
          : "border-gray-800 bg-gray-900/40"
      }`}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          title={group.taskId ? `#${group.taskId}` : undefined}
        >
          <span aria-hidden className="flex-shrink-0 text-gray-500">
            {expanded ? "▾" : "▸"}
          </span>

          <span
            className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${taskStatusPillClass(
              group.status,
            )}`}
          >
            {group.status ?? t("project.audit.admin.statusUnknown")}
          </span>

          <span className="min-w-0 flex-1 truncate text-sm text-gray-100">
            {title}
          </span>
        </button>

        {/* 모델 칩 — 이 티켓에 실제로 등장한 모델 전부. 하나만 뽑아 대표로
            보여주면 "이 모델이 다 했다"는 오귀속이 된다(예전 메모 묶음 요약이
            집계를 안 올린 것과 같은 이유). */}
        {group.models.map((model) => (
          <span
            key={model}
            className="flex-shrink-0 rounded border border-purple-800/70 bg-purple-950/40 px-1.5 py-0.5 text-[10px] text-purple-300"
          >
            {`🤖 ${model}`}
          </span>
        ))}

        {group.attention && (
          <AttentionPill
            attention={group.attention}
            failedCount={group.failedCount}
            claimedBy={group.claimedBy}
          />
        )}

        <span className="flex-shrink-0 text-[11px] text-gray-500">
          {t("project.audit.admin.ticketSummary", {
            actions: group.actionCount,
            actors: group.actorCount,
          })}
        </span>

        <span className="flex-shrink-0 text-xs tabular-nums text-gray-500">
          {formatAuditTime(group.latestAt, locale)}
        </span>
      </div>

      {/* 링크 클러스터는 토글 버튼 **밖**에 둔다 — 안에 넣으면 버튼 중첩(무효
          HTML)이고, 링크를 누를 때마다 카드가 같이 펼쳐진다. */}
      {group.taskId && (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-6">
          <ProjectAuditLinks
            taskId={group.taskId}
            prUrl={group.prUrl}
            worktreeId={group.worktreeId}
            worktrees={worktrees}
            onOpenTicket={onOpenTicket}
          />
          {group.attention && (
            <button
              type="button"
              onClick={() => onOpenBoard(group.taskId!)}
              className="text-xs text-amber-300 transition-colors hover:text-amber-200 hover:underline"
            >
              {t("project.audit.admin.reassign")}
            </button>
          )}
        </div>
      )}

      {!group.taskId && (
        <p className="mt-1 pl-6 text-[11px] text-gray-600">
          {t("project.audit.admin.noTicketNote")}
        </p>
      )}

      {expanded && (
        <div className="mt-2 ml-6 border-l border-gray-800 pl-3">
          <TicketEvidenceSummary
            group={group}
            worktrees={worktrees}
            onOpenTicket={onOpenTicket}
          />
          <ul className="divide-y divide-gray-800">
            {timeline.map((display) =>
              display.kind === "group" ? (
                // 접힌 메모 묶음은 여기서 한 줄로 표시만 한다 — 티켓 카드가 이미
                // 접힘 단위라, 그 안에 또 접히는 단계를 두면 클릭 두 번이 필요해진다.
                <li key={display.key} className="py-1.5">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="rounded border border-gray-700 bg-gray-900 px-1.5 py-0.5 text-[10px] text-gray-400">
                      {t("project.audit.group.badge")}
                    </span>
                    <span className="text-xs text-gray-500">
                      {t("project.audit.group.count", {
                        count: display.rows.length,
                      })}
                    </span>
                    <span className="min-w-0 break-words text-xs text-gray-500">
                      {display.rows[0]?.detail}
                    </span>
                    <span className="ml-auto flex-shrink-0 text-xs tabular-nums text-gray-500">
                      {formatAuditTime(display.rows[0].createdAt, locale)}
                    </span>
                  </div>
                  {display.rows.map((row) => (
                    <AuditTimelineRow key={row.key} row={row} locale={locale} />
                  ))}
                </li>
              ) : (
                <AuditTimelineRow
                  key={display.row.key}
                  row={display.row}
                  locale={locale}
                />
              ),
            )}
          </ul>
        </div>
      )}
    </li>
  );
}

function TicketEvidenceSummary({
  group,
  worktrees,
  onOpenTicket,
}: {
  group: AuditTicketGroup;
  worktrees: Worktree[];
  onOpenTicket: (taskId: string) => void;
}) {
  const { t } = useTranslation();
  const hasDetail =
    !!group.detail.lastActivity ||
    !!group.detail.resolutionSummary ||
    !!group.detail.prUrl ||
    !!group.detail.worktreeId;
  if (!group.taskId || !hasDetail) return null;
  return (
    <details
      data-testid="audit-ticket-evidence"
      className="mb-2 rounded border border-gray-800 bg-gray-950/30 px-2 py-1.5 text-xs text-gray-400"
    >
      <summary className="cursor-pointer select-none text-[11px] font-medium text-gray-400 hover:text-gray-200">
        {t("project.audit.detail.ticketToggle")}
      </summary>
      <div className="mt-2 space-y-2">
        {group.detail.resolutionSummary && (
          <EvidenceText
            label={t("project.audit.detail.resolution")}
            value={group.detail.resolutionSummary}
          />
        )}
        {group.detail.lastActivity && (
          <EvidenceText
            label={t("project.audit.detail.lastActivity")}
            value={group.detail.lastActivity}
          />
        )}
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-600">
            {t("project.audit.detail.links")}
          </div>
          <ProjectAuditLinks
            taskId={group.taskId}
            prUrl={group.detail.prUrl}
            worktreeId={group.detail.worktreeId}
            worktrees={worktrees}
            onOpenTicket={onOpenTicket}
          />
        </div>
      </div>
    </details>
  );
}

function EvidenceText({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-600">
        {label}
      </div>
      <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-gray-300">
        {value}
      </p>
    </div>
  );
}

/**
 * 주의 필요 사유 pill.
 *
 * 사유를 **전부** 쓴다(대표 하나로 줄이지 않는다) — "실패로 종료"만 보이고
 * "고아 클레임"이 가려지면 운영자가 재배정 대신 재실행을 고른다. 짧은 라벨
 * 여러 개가 긴 문장 하나보다 훑기 쉽다.
 */
export function AttentionPill({
  attention,
  failedCount,
  claimedBy,
}: {
  attention: AuditAttention;
  failedCount: number;
  /** 고아 클레임 사유의 근거 — hover 로 어느 에이전트인지 밝힌다. */
  claimedBy?: string | null;
}) {
  const { t } = useTranslation();
  const critical = attention.severity === "critical";
  return (
    <span
      className={`flex flex-shrink-0 flex-wrap items-center gap-x-1.5 rounded border px-1.5 py-0.5 text-[10px] ${
        critical
          ? "border-red-800/70 bg-red-950/40 text-red-300"
          : "border-amber-800/70 bg-amber-950/40 text-amber-300"
      }`}
    >
      {attention.kinds.map((kind) => (
        <span
          key={kind}
          title={
            kind === "orphanedClaim" && claimedBy
              ? t("project.audit.admin.reason.orphanedClaimTip", {
                  agentId: claimedBy,
                })
              : undefined
          }
        >
          {attentionReasonLabel(kind, attention, failedCount, t)}
        </span>
      ))}
    </span>
  );
}

/** 사유 → 사람이 읽는 라벨. 수치를 갖는 둘만 근거를 같이 싣는다. */
function attentionReasonLabel(
  kind: AuditAttention["kinds"][number],
  attention: AuditAttention,
  failedCount: number,
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
): string {
  switch (kind) {
    case "taskFailed":
      return t("project.audit.admin.reason.taskFailed");
    case "taskBlocked":
      return t("project.audit.admin.reason.taskBlocked");
    case "failedActions":
      return t("project.audit.admin.reason.failedActions", {
        count: failedCount,
      });
    case "orphanedClaim":
      return t("project.audit.admin.reason.orphanedClaim");
    case "stalled":
      // 시간 단위로 내림한다 — "6.3시간" 은 정확해 보이지만 판정 임계값이
      // 시간 단위라 그 소수점은 아무 결정도 바꾸지 않는다.
      return t("project.audit.admin.reason.stalled", {
        hours: Math.floor((attention.idleMs ?? 0) / 3_600_000),
      });
  }
}
