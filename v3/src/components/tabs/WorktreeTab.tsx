import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useWorktreeStore } from "../../stores/worktreeStore";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { useNavigationStore } from "../../stores/navigationStore";
import { viewWorktree } from "../../lib/viewWorktree";
import { subscribeToMergeHistory } from "../../services/mergeHistoryService";
import type { Task } from "../../types/task";
import type { MergeHistoryEntry } from "../../types/mergeHistory";
import type {
  Worktree,
  WorktreeStatusPill,
  WorktreeStatusTone,
} from "../../types/worktree";
import {
  archiveReason,
  isWorktreeArchived,
  worktreeKey,
  type ArchiveReason,
  type ArchiveSignals,
} from "../../lib/worktreeHygiene";
import {
  isCleanupCandidate,
  worktreeCategory,
  type WorktreeCategory,
} from "../../lib/worktreeCategory";
import { githubRepoWebBase, worktreeGithubUrl } from "../../lib/githubWebUrl";
import { routeInstructionToOrchestrator } from "../../services/orchestratorInstructionService";
import { useAuth } from "../../hooks/useAuth";
import { useArchiveSignals } from "../../hooks/useArchiveSignals";
import { t, useTranslation } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";
import {
  initialWorktreeProjectFilter,
  nextWorktreeProjectFilter,
  WORKTREE_PROJECT_FILTER_ALL,
  WORKTREE_PROJECT_FILTER_LOADING,
} from "./worktreeProjectFilter";

const TONE_CLASSES: Record<WorktreeStatusTone, string> = {
  danger: "bg-red-500/15 text-red-300 border border-red-500/30",
  warning: "bg-amber-500/15 text-amber-300 border border-amber-500/30",
  behind: "bg-yellow-500/15 text-yellow-300 border border-yellow-500/30",
  ready: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",
  idle: "bg-gray-500/15 text-gray-300 border border-gray-500/30",
};

/**
 * Per-category presentation: row accent border, badge chip, label + tooltip.
 * Colours follow the ticket — 개발중 파랑 / 머지필요 노랑 / 정리필요 회색 (both
 * cleanup variants share grey, distinguished by their sub-label).
 */
const CATEGORY_STYLE: Record<
  WorktreeCategory,
  {
    accent: string;
    badge: string;
    icon: string;
    labelKey: MessageKey;
    tipKey: MessageKey;
  }
> = {
  developing: {
    accent: "border-l-blue-500/70",
    badge: "border-blue-500/30 bg-blue-500/15 text-blue-300",
    icon: "🔵",
    labelKey: "worktree.category.developing",
    tipKey: "worktree.category.developingTip",
  },
  mergeNeeded: {
    accent: "border-l-amber-500/70",
    badge: "border-amber-500/30 bg-amber-500/15 text-amber-300",
    icon: "🟡",
    labelKey: "worktree.category.mergeNeeded",
    tipKey: "worktree.category.mergeNeededTip",
  },
  cleanupMerged: {
    accent: "border-l-gray-500/60",
    badge: "border-gray-500/30 bg-gray-500/15 text-gray-300",
    icon: "⚪",
    labelKey: "worktree.category.cleanupMerged",
    tipKey: "worktree.category.cleanupMergedTip",
  },
  cleanupStale: {
    accent: "border-l-gray-500/60",
    badge: "border-gray-500/30 bg-gray-500/15 text-gray-300",
    icon: "⚪",
    labelKey: "worktree.category.cleanupStale",
    tipKey: "worktree.category.cleanupStaleTip",
  },
};

// 상태 필터 드롭다운 옵션. tone 값과 1:1.
const STATUS_OPTIONS: {
  value: WorktreeStatusTone | "all";
  labelKey: MessageKey;
}[] = [
  { value: "all", labelKey: "worktree.filter.all" },
  { value: "ready", labelKey: "worktree.filter.ready" },
  { value: "behind", labelKey: "worktree.filter.behind" },
  { value: "warning", labelKey: "worktree.filter.warning" },
  { value: "danger", labelKey: "worktree.filter.danger" },
  { value: "idle", labelKey: "worktree.filter.idle" },
];

interface WorktreeTitleMeta {
  title: string;
  subtitle: string | null;
  titleTip: string;
}

function resolveWorktreeTitle(
  taskById: Map<string, Task>,
  input: { taskId: string | null; branch: string },
): WorktreeTitleMeta {
  const task = input.taskId ? taskById.get(input.taskId) : null;
  if (task) {
    return {
      title: task.title,
      subtitle: input.taskId,
      titleTip: `${task.title} · ${input.taskId}`,
    };
  }

  const title = input.branch || input.taskId || "(ad-hoc)";
  return {
    title,
    subtitle: input.taskId,
    titleTip: input.taskId ? `${title} · ${input.taskId}` : title,
  };
}

function StatusPill({ pill }: { pill: WorktreeStatusPill }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        TONE_CLASSES[pill.tone]
      }`}
    >
      <span aria-hidden>{pill.icon}</span>
      {pill.label}
    </span>
  );
}

function CategoryBadge({ category }: { category: WorktreeCategory }) {
  const { t } = useTranslation();
  const style = CATEGORY_STYLE[category];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${style.badge}`}
      title={t(style.tipKey)}
    >
      <span aria-hidden>{style.icon}</span>
      {t(style.labelKey)}
    </span>
  );
}

function ConflictSummary({ worktree }: { worktree: Worktree }) {
  const { t } = useTranslation();
  const conflicts = worktree.status?.conflicts.length ?? 0;
  if (conflicts > 0) {
    return <span className="text-red-300">{conflicts} conflicts</span>;
  }
  if (worktree.status && !worktree.status.mergeable) {
    return (
      <span className="text-amber-300">
        {t("worktree.conflict.rebaseNeeded")}
      </span>
    );
  }
  return <span className="text-gray-500">{t("worktree.conflict.none")}</span>;
}

type RowAction =
  | "rebase"
  | "merge"
  | "resolve"
  | "open"
  | "archive"
  | "delete"
  | "github"
  | "ticket"
  | "review";

function ActionButton({
  children,
  disabled,
  title,
  tone = "default",
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  title: string;
  tone?: "default" | "danger" | "ready";
  onClick: () => void;
}) {
  const toneClass =
    tone === "danger"
      ? "border-red-500/40 text-red-300 hover:bg-red-500/10"
      : tone === "ready"
        ? "border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10"
        : "border-gray-700 text-gray-300 hover:bg-gray-800";

  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`rounded border px-1.5 py-0.5 text-[11px] transition disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-600 disabled:opacity-60 ${toneClass}`}
    >
      {children}
    </button>
  );
}

function RowActions({
  worktree,
  archived,
  category,
  githubUrl,
  ticketAvailable,
  busyAction,
  onAction,
}: {
  worktree: Worktree;
  archived: boolean;
  category: WorktreeCategory;
  githubUrl: string | null;
  ticketAvailable: boolean;
  busyAction: RowAction | null;
  onAction: (worktree: Worktree, action: RowAction) => void;
}) {
  const { t } = useTranslation();
  const mergeable = worktree.status?.mergeable === true;
  const hasConflict = Boolean(worktree.status && !worktree.status.mergeable);
  const canResolve = hasConflict;
  const disabled = busyAction !== null;
  // "오케에게 리뷰 요청" is for worktrees a human must judge: still in
  // development or in conflict, or waiting for a merge decision. A landed
  // (cleanupMerged) worktree needs no review, so it is hidden there.
  const showReview =
    category === "developing" || category === "mergeNeeded" || hasConflict;

  return (
    <div className="flex flex-shrink-0 items-center gap-1">
      <ActionButton
        disabled={disabled}
        title={`Rebase ${worktree.branch} from ${worktree.baseRef}`}
        onClick={() => onAction(worktree, "rebase")}
      >
        {busyAction === "rebase" ? "Rebasing" : "Rebase"}
      </ActionButton>
      {mergeable ? (
        <ActionButton
          disabled={disabled}
          title={`Squash-merge ${worktree.branch}`}
          tone="ready"
          onClick={() => onAction(worktree, "merge")}
        >
          {busyAction === "merge" ? "Merging" : "Merge"}
        </ActionButton>
      ) : (
        <ActionButton
          disabled={disabled || !canResolve}
          title={
            canResolve
              ? `Spawn resolver for ${worktree.branch}`
              : t("worktree.action.resolveOnlyConflict")
          }
          onClick={() => onAction(worktree, "resolve")}
        >
          {busyAction === "resolve" ? "Resolving" : "Resolve"}
        </ActionButton>
      )}
      <ActionButton
        disabled={disabled || !githubUrl}
        title={
          githubUrl
            ? t("worktree.action.githubTip")
            : t("worktree.action.githubUnavailable")
        }
        onClick={() => onAction(worktree, "github")}
      >
        {t("worktree.action.github")}
      </ActionButton>
      <ActionButton
        disabled={disabled || !ticketAvailable}
        title={
          ticketAvailable
            ? t("worktree.action.ticketTip")
            : t("worktree.action.ticketUnavailable")
        }
        onClick={() => onAction(worktree, "ticket")}
      >
        {t("worktree.action.ticket")}
      </ActionButton>
      {showReview && (
        <ActionButton
          disabled={disabled}
          title={t("worktree.action.reviewTip")}
          onClick={() => onAction(worktree, "review")}
        >
          {busyAction === "review"
            ? t("worktree.action.reviewSending")
            : t("worktree.action.review")}
        </ActionButton>
      )}
      <ActionButton
        disabled={disabled}
        title={t("worktree.action.openInCode")}
        onClick={() => onAction(worktree, "open")}
      >
        Open
      </ActionButton>
      <ActionButton
        disabled={disabled}
        title={
          archived ? t("worktree.action.restore") : t("worktree.action.archive")
        }
        onClick={() => onAction(worktree, "archive")}
      >
        {archived ? t("worktree.restoreAction") : t("worktree.archiveAction")}
      </ActionButton>
      <ActionButton
        disabled={disabled}
        title={t("worktree.action.removeCleanup")}
        tone="danger"
        onClick={() => onAction(worktree, "delete")}
      >
        {busyAction === "delete" ? "Deleting" : "Delete"}
      </ActionButton>
    </div>
  );
}

/** Badge styling + copy per auto-archive reason. */
const ARCHIVE_REASON_STYLE: Record<
  ArchiveReason,
  { className: string; labelKey: MessageKey; tipKey: MessageKey }
> = {
  merged: {
    className: "border-sky-500/30 bg-sky-500/15 text-sky-300",
    labelKey: "worktree.archivedReason.merged",
    tipKey: "worktree.archivedReason.mergedTip",
  },
  done: {
    className: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300",
    labelKey: "worktree.archivedReason.done",
    tipKey: "worktree.archivedReason.doneTip",
  },
  stale: {
    className: "border-amber-500/30 bg-amber-500/15 text-amber-300",
    labelKey: "worktree.archivedReason.stale",
    tipKey: "worktree.archivedReason.staleTip",
  },
};

function ArchiveReasonBadge({
  worktree,
  signals,
}: {
  worktree: Worktree;
  signals: ArchiveSignals;
}) {
  const { t } = useTranslation();
  const reason = archiveReason(worktree, signals);
  if (!reason) return null;
  const style = ARCHIVE_REASON_STYLE[reason];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${style.className}`}
      title={t(style.tipKey)}
    >
      {t(style.labelKey)}
    </span>
  );
}

function WorktreeRow({
  worktree,
  titleMeta,
  pill,
  category,
  githubUrl,
  ticketAvailable,
  archived,
  signals,
  busyAction,
  onAction,
}: {
  worktree: Worktree;
  titleMeta: WorktreeTitleMeta;
  pill: WorktreeStatusPill;
  category: WorktreeCategory;
  githubUrl: string | null;
  ticketAvailable: boolean;
  archived: boolean;
  signals: ArchiveSignals;
  busyAction: RowAction | null;
  onAction: (worktree: Worktree, action: RowAction) => void;
}) {
  const { t } = useTranslation();
  const status = worktree.status;
  const ahead = status?.ahead ?? 0;
  const behind = status?.behind ?? 0;
  const insertions = status?.insertions ?? 0;
  const deletions = status?.deletions ?? 0;

  return (
    <div
      className={`rounded-lg border border-l-4 border-gray-800 bg-gray-800/40 px-3 py-2 ${CATEGORY_STYLE[category].accent}`}
    >
      {/* 메인 행: 제목 / 카테고리 배지 / 에이전트 / 브랜치 / +ins/-del / 상태 pill */}
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1" title={titleMeta.titleTip}>
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-gray-100">
              {titleMeta.title}
            </span>
            <CategoryBadge category={category} />
          </div>
          {titleMeta.subtitle && (
            <div className="truncate font-mono text-[10px] text-gray-500">
              {titleMeta.subtitle}
            </div>
          )}
        </div>
        <span className="w-24 flex-shrink-0 truncate text-xs text-gray-400">
          {worktree.agentId ?? "—"}
        </span>
        <span
          className="w-44 flex-shrink-0 truncate font-mono text-xs text-blue-300"
          title={worktree.branch}
        >
          {worktree.branch}
        </span>
        <span className="w-20 flex-shrink-0 text-right font-mono text-xs">
          <span className="text-emerald-400">+{insertions}</span>
          <span className="text-gray-600">/</span>
          <span className="text-red-400">-{deletions}</span>
        </span>
        <span className="w-24 flex-shrink-0 text-right">
          <StatusPill pill={pill} />
        </span>
      </div>

      {/* 보조 행: ▲ahead ▼behind / 충돌수 / 아카이브 사유 / 액션 */}
      <div className="mt-1.5 flex items-center gap-3 pl-0.5 text-xs text-gray-400">
        <span className="flex items-center gap-2 font-mono">
          <span title={t("worktree.row.aheadTip")}>▲{ahead}</span>
          <span title={t("worktree.row.behindTip")}>▼{behind}</span>
        </span>
        <span>
          <ConflictSummary worktree={worktree} />
        </span>
        {archived && (
          <ArchiveReasonBadge worktree={worktree} signals={signals} />
        )}
        <span className="ml-auto">
          <RowActions
            worktree={worktree}
            archived={archived}
            category={category}
            githubUrl={githubUrl}
            ticketAvailable={ticketAvailable}
            busyAction={busyAction}
            onAction={onAction}
          />
        </span>
      </div>
    </div>
  );
}

// ── 완료 이력 (merge-history 감사 트레일) ─────────────────────────────

function relativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return t("worktree.time.justNow");
  if (min < 60) return t("worktree.time.minutesAgo", { min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("worktree.time.hoursAgo", { hr });
  const day = Math.floor(hr / 24);
  if (day < 30) return t("worktree.time.daysAgo", { day });
  return date.toLocaleDateString();
}

function MergeModeBadge({ mode }: { mode: MergeHistoryEntry["mode"] }) {
  const { t } = useTranslation();
  const isAuto = mode === "auto";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        isAuto
          ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
          : "bg-sky-500/15 text-sky-300 border border-sky-500/30"
      }`}
      title={
        isAuto ? t("worktree.merge.autoTip") : t("worktree.merge.humanTip")
      }
    >
      {isAuto ? t("worktree.merge.auto") : t("worktree.merge.human")}
    </span>
  );
}

function MergeHistoryRow({
  entry,
  projectLabel,
  titleMeta,
}: {
  entry: MergeHistoryEntry;
  projectLabel: string;
  titleMeta: WorktreeTitleMeta;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [diff, setDiff] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    const next = !expanded;
    setExpanded(next);
    // Lazy-load the diff on first expand; the squashed commit lives on base.
    if (next && diff === null && !loading) {
      setLoading(true);
      setError(null);
      try {
        const res = await window.electronAPI.worktree.showCommit(
          entry.repoRoot,
          entry.headSha,
        );
        setDiff(res.diff);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : t("worktree.diffLoadFailed"),
        );
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-800/40 px-3 py-2">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-3 text-left"
        title={t("worktree.history.rowTip")}
      >
        <span aria-hidden className="text-gray-500">
          {expanded ? "▾" : "▸"}
        </span>
        <span
          className="w-28 flex-shrink-0 truncate text-xs text-gray-500"
          title={projectLabel}
        >
          {projectLabel}
        </span>
        <span className="min-w-0 flex-1" title={titleMeta.titleTip}>
          <span className="block truncate text-sm font-semibold text-gray-100">
            {titleMeta.title}
          </span>
          {titleMeta.subtitle && (
            <span className="block truncate font-mono text-[10px] text-gray-500">
              {titleMeta.subtitle}
            </span>
          )}
        </span>
        <span
          className="w-44 flex-shrink-0 truncate font-mono text-xs text-blue-300"
          title={entry.branch}
        >
          {entry.branch}
        </span>
        <span
          className="w-16 flex-shrink-0 font-mono text-xs text-emerald-300"
          title={t("worktree.history.shaTip", { sha: entry.headSha })}
        >
          {entry.headSha.slice(0, 7)}
        </span>
        <span
          className="w-20 flex-shrink-0 text-right text-xs text-gray-400"
          title={entry.mergedAt.toLocaleString("ko-KR")}
        >
          {relativeTime(entry.mergedAt)}
        </span>
        <span className="w-16 flex-shrink-0 text-right">
          <MergeModeBadge mode={entry.mode} />
        </span>
      </button>

      {expanded && (
        <div className="mt-2 border-t border-gray-800 pt-2">
          {loading ? (
            <p className="text-xs text-gray-500">
              {t("worktree.history.diffLoading")}
            </p>
          ) : error ? (
            <p className="text-xs text-red-300">{error}</p>
          ) : (
            <pre className="max-h-96 overflow-auto rounded bg-gray-900/70 p-2 font-mono text-[11px] leading-snug text-gray-300">
              {diff}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ── 범례 (상태 카테고리 + 버튼 설명) ──────────────────────────────────

/** Small colour chip mirroring a category's badge, for the legend. */
function LegendChip({ category }: { category: WorktreeCategory }) {
  const { t } = useTranslation();
  const style = CATEGORY_STYLE[category];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${style.badge}`}
    >
      <span aria-hidden>{style.icon}</span>
      {t(style.labelKey)}
    </span>
  );
}

function WorktreeLegend() {
  const { t } = useTranslation();
  const buttonKeys: MessageKey[] = [
    "worktree.legend.btnRebase",
    "worktree.legend.btnMerge",
    "worktree.legend.btnGithub",
    "worktree.legend.btnTicket",
    "worktree.legend.btnReview",
    "worktree.legend.btnArchive",
    "worktree.legend.btnDelete",
  ];
  return (
    <div className="space-y-2 rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2 text-xs text-gray-400">
      {/* 상태 카테고리 */}
      <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
        <span className="font-semibold text-gray-300">
          {t("worktree.legend.statesTitle")}
        </span>
        <span className="flex items-center gap-1.5">
          <LegendChip category="developing" />
          <span>{t("worktree.legend.developing")}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <LegendChip category="mergeNeeded" />
          <span>{t("worktree.legend.mergeNeeded")}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <LegendChip category="cleanupMerged" />
          <span>{t("worktree.legend.cleanup")}</span>
        </span>
      </div>
      {/* 버튼 */}
      <div className="flex flex-wrap items-start gap-x-4 gap-y-1 border-t border-gray-800 pt-2">
        <span className="font-semibold text-gray-300">
          {t("worktree.legend.buttonsTitle")}
        </span>
        {buttonKeys.map((key) => (
          <span key={key}>{t(key)}</span>
        ))}
      </div>
    </div>
  );
}

export function WorktreeTab() {
  const worktrees = useWorktreeStore((s) => s.worktrees);
  const loading = useWorktreeStore((s) => s.loading);
  const lastError = useWorktreeStore((s) => s.lastError);
  const refresh = useWorktreeStore((s) => s.refresh);
  const rebase = useWorktreeStore((s) => s.rebase);
  const merge = useWorktreeStore((s) => s.merge);
  const resolve = useWorktreeStore((s) => s.resolve);
  const remove = useWorktreeStore((s) => s.remove);
  const cleanupWorktrees = useWorktreeStore((s) => s.cleanupWorktrees);
  const statusPill = useWorktreeStore((s) => s.statusPill);
  const archiveOverrides = useWorktreeStore((s) => s.archiveOverrides);
  const archiveSignals = useArchiveSignals();
  const setWorktreeArchived = useWorktreeStore((s) => s.setWorktreeArchived);
  const projects = useProjectStore((s) => s.projects);
  const currentProjectId = useProjectStore((s) => s.currentProject?.id ?? null);
  const tasks = useTaskStore((s) => s.tasks);
  const subscribeToTasks = useTaskStore((s) => s.subscribeToTasks);
  const { user } = useAuth();
  const { t } = useTranslation();

  const [projectFilter, setProjectFilter] = useState<string>(() =>
    initialWorktreeProjectFilter(useProjectStore.getState().currentProject?.id),
  );
  const [statusFilter, setStatusFilter] = useState<WorktreeStatusTone | "all">(
    "all",
  );
  const [mergeableOnly, setMergeableOnly] = useState(false);
  // 아카이브 뷰: 기본은 활성/온고잉만. 켜면 아카이브(머지/stale/수동보관)된 것만
  // 보여주고 각 행에서 복원 가능.
  const [archivedView, setArchivedView] = useState(false);
  // 예외 뷰: 자동머지 안 되고 사람이 봐야 하는 것만 (충돌/머지불가 or stale).
  // 자율성 다이얼 L1에서 clean+mergeable은 자동머지되므로 예외가 아님.
  const [exceptionsOnly, setExceptionsOnly] = useState(false);
  const [busy, setBusy] = useState<{ id: string; action: RowAction } | null>(
    null,
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [cleaningStale, setCleaningStale] = useState(false);
  // 범례 — 카테고리/버튼 한 줄 설명. 기본 펼침(감사 온보딩 도움), 접기 가능.
  const [showLegend, setShowLegend] = useState(true);
  // 완료 이력 뷰 — 머지되어 사라진 워크트리의 감사 트레일 (merge_history).
  const [historyView, setHistoryView] = useState(false);
  const [history, setHistory] = useState<MergeHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  // repoRoot → GitHub 웹 base URL(github.com 리모트만, 아니면 null). 행의 GitHub
  // 버튼이 동기적으로 쓰도록 미리 채운다. fs.gitRemoteUrl 은 repoRoot 당 1회만.
  const [remoteBases, setRemoteBases] = useState<Record<string, string | null>>(
    {},
  );
  const fetchedRootsRef = useRef<Set<string>>(new Set());

  // mount 시 1회 로드. 실패는 store.lastError 로 표면화되므로 swallow.
  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  // repoRoot 별 GitHub 리모트 base 를 lazily 채운다(중복 방지=fetchedRootsRef).
  useEffect(() => {
    const roots = Array.from(new Set(worktrees.map((wt) => wt.repoRoot)));
    const missing = roots.filter((r) => !fetchedRootsRef.current.has(r));
    if (missing.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const root of missing) {
        fetchedRootsRef.current.add(root);
        let base: string | null = null;
        try {
          const url = await window.electronAPI.fs.gitRemoteUrl(root);
          base = githubRepoWebBase(url);
        } catch {
          base = null;
        }
        if (cancelled) return;
        setRemoteBases((prev) => ({ ...prev, [root]: base }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [worktrees]);

  useEffect(() => {
    if (!currentProjectId) return;
    const unsub = subscribeToTasks(currentProjectId);
    return () => unsub();
  }, [currentProjectId, subscribeToTasks]);

  useEffect(() => {
    setProjectFilter((currentFilter) =>
      nextWorktreeProjectFilter(currentFilter, currentProjectId),
    );
  }, [currentProjectId]);

  // 완료 이력은 뷰가 켜졌을 때만 구독 (on-demand 리스너).
  // ★현재 프로젝트로 스코프한다: merge_history read 룰이 isProjectMember 로 조여지면
  // unscoped(orderBy-only) 쿼리는 permission-denied 로 통째 거부된다(#406/#428 패턴).
  // where(projectId==) + orderBy mergedAt 은 firestore.indexes.json 의
  // (projectId, mergedAt DESC) 복합인덱스로 서빙된다. 크로스프로젝트 이력은 단일
  // 쿼리로 못 읽고 원래 불필요 — auditService 와 동일한 스코프 패턴.
  useEffect(() => {
    if (!historyView) return;
    if (!currentProjectId) return;
    setHistoryLoading(true);
    const unsub = subscribeToMergeHistory(
      (entries) => {
        setHistory(entries);
        setHistoryLoading(false);
      },
      { projectId: currentProjectId, maxResults: 200 },
    );
    return () => unsub();
  }, [historyView, currentProjectId]);

  // 이력은 이미 현재 프로젝트로 스코프+최신순 정렬됨. 프로젝트 필터는 워크트리 목록에만
  // 의미가 있고(로컬 git 출처라 크로스프로젝트 가능), 이력은 항상 현재 프로젝트를 보여준다.
  const historyEntries = useMemo(
    () =>
      projectFilter === WORKTREE_PROJECT_FILTER_ALL
        ? history
        : history.filter((e) => e.projectId === projectFilter),
    [history, projectFilter],
  );

  const taskById = useMemo(
    () => new Map(tasks.map((task) => [task.id, task])),
    [tasks],
  );

  // 워크트리 → 감사 라이프사이클 카테고리 (taskStore 상태 기반, git squash 무관).
  const categoryOf = useMemo(
    () =>
      (worktree: Worktree): WorktreeCategory =>
        worktreeCategory(
          worktree,
          worktree.taskId ? (taskById.get(worktree.taskId) ?? null) : null,
          archiveSignals,
        ),
    [taskById, archiveSignals],
  );

  // 워크트리 → GitHub 링크(있으면). task.prUrl 우선, 없으면 리모트에서 파생.
  const resolveGithubUrl = useMemo(
    () =>
      (worktree: Worktree): string | null => {
        const task = worktree.taskId
          ? (taskById.get(worktree.taskId) ?? null)
          : null;
        const pr = task?.prUrl?.trim();
        if (pr) return pr;
        return worktreeGithubUrl({
          remoteUrl: remoteBases[worktree.repoRoot] ?? null,
          branch: worktree.branch,
          baseRef: worktree.baseRef,
        });
      },
    [taskById, remoteBases],
  );

  // projectId → 사람이 읽는 이름. 미등록 프로젝트는 id 그대로.
  const projectName = useMemo(() => {
    const map = new Map(projects.map((p) => [p.id, p.name]));
    return (projectId: string) => map.get(projectId) ?? projectId;
  }, [projects]);

  // 필터 적용 후 프로젝트별 그룹.
  const groups = useMemo(() => {
    const filtered = worktrees.filter((wt) => {
      // Base layer: the default view shows only active/ongoing worktrees;
      // archived (merged / stale / manually-archived) ones move to the archive
      // view. This is what collapses a 100+-worktree project to just the live
      // work.
      const isArchived = isWorktreeArchived(
        wt,
        archiveOverrides,
        archiveSignals,
      );
      if (archivedView ? !isArchived : isArchived) {
        return false;
      }
      if (
        projectFilter !== WORKTREE_PROJECT_FILTER_ALL &&
        wt.projectId !== projectFilter
      ) {
        return false;
      }
      if (statusFilter !== "all" && statusPill(wt).tone !== statusFilter) {
        return false;
      }
      if (mergeableOnly && !wt.status?.mergeable) {
        return false;
      }
      if (exceptionsOnly) {
        const isException = wt.status
          ? !wt.status.mergeable || wt.stale === true
          : false;
        if (!isException) return false;
      }
      return true;
    });

    const byProject = new Map<string, Worktree[]>();
    for (const wt of filtered) {
      const list = byProject.get(wt.projectId) ?? [];
      list.push(wt);
      byProject.set(wt.projectId, list);
    }
    return Array.from(byProject.entries()).sort(([a], [b]) =>
      projectName(a).localeCompare(projectName(b)),
    );
  }, [
    worktrees,
    projectFilter,
    statusFilter,
    mergeableOnly,
    exceptionsOnly,
    archivedView,
    archiveOverrides,
    archiveSignals,
    statusPill,
    projectName,
  ]);

  // 필터 드롭다운에 노출할 프로젝트 목록 (worktree 가 존재하는 것만).
  const projectOptions = useMemo(() => {
    const ids = Array.from(new Set(worktrees.map((wt) => wt.projectId)));
    return ids
      .map((id) => ({ id, name: projectName(id) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [worktrees, projectName]);

  // 일괄 cleanup 대상 — ★'정리 필요(머지됨)' 카테고리(DONE 티켓, base에 안착)만.
  // 개발 중·충돌·미커밋 워크트리는 절대 포함하지 않는다(오늘 미커밋 워크트리가
  // cleanup 에 지워져 유실된 사고 재발 방지). isCleanupCandidate 가 dirty/busy 에
  // 더해 unpushed(로컬 전용 커밋)까지 배제하므로, 렌더러가 직접 remove 해도
  // 메인프로세스 repo-wide cleanupStale 보다 안전하다(그건 dirty 를 --force 로 지움).
  const cleanupCandidates = useMemo(
    () =>
      worktrees.filter((wt) => {
        const task = wt.taskId ? (taskById.get(wt.taskId) ?? null) : null;
        return (
          worktreeCategory(wt, task, archiveSignals) === "cleanupMerged" &&
          isCleanupCandidate(wt, task, archiveSignals)
        );
      }),
    [worktrees, taskById, archiveSignals],
  );

  // 아카이브된 워크트리 수 — 토글 배지에 표시.
  const archivedCount = useMemo(
    () =>
      worktrees.filter((wt) =>
        isWorktreeArchived(wt, archiveOverrides, archiveSignals),
      ).length,
    [worktrees, archiveOverrides, archiveSignals],
  );

  const waitingForDefaultProject =
    projectFilter === WORKTREE_PROJECT_FILTER_LOADING;
  const isEmpty =
    !waitingForDefaultProject && !loading && worktrees.length === 0;
  const noMatches =
    !waitingForDefaultProject &&
    !loading &&
    worktrees.length > 0 &&
    groups.length === 0;

  const openWorktree = (worktree: Worktree) => {
    // Worktrees-tab "Open" = open the checkout in the Code editor. Route through
    // the sanctioned viewWorktree action (project bind + rootPath switch + files
    // reveal + proper Code-tab jump) instead of the old DOM hack that
    // synthesised a click on the "Code" tab button.
    viewWorktree(worktree, { switchToCodeTab: true });
  };

  // 오케스트레이터에게 이 워크트리 리뷰를 요청한다. worktree.projectId 의 오케에게
  // 보낸다(워크트리는 크로스프로젝트일 수 있으므로 현재 프로젝트가 아님).
  const handleReviewRequest = async (worktree: Worktree) => {
    const task = worktree.taskId
      ? (taskById.get(worktree.taskId) ?? null)
      : null;
    const label = task?.title ?? worktree.branch;
    const hasConflict = Boolean(worktree.status && !worktree.status.mergeable);
    const statusText = hasConflict
      ? t("worktree.review.statusConflict")
      : t("worktree.review.statusDeveloping");
    const message = t("worktree.review.message", {
      label: worktree.taskId ? `${label} (${worktree.taskId})` : label,
      branch: worktree.branch,
      status: statusText,
    });

    setBusy({ id: worktree.id, action: "review" });
    try {
      const result = await routeInstructionToOrchestrator({
        projectId: worktree.projectId,
        message,
        fromUserId: user?.uid,
        fromUserName: user?.displayName ?? "User",
        taskId: worktree.taskId ?? null,
      });
      if (result === "failed") {
        setActionError(t("worktree.review.failed"));
      } else {
        setActionMessage(
          result === "local"
            ? t("worktree.review.sentLocal", { branch: worktree.branch })
            : t("worktree.review.sentQueued", { branch: worktree.branch }),
        );
      }
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : t("worktree.review.failed"),
      );
    } finally {
      setBusy(null);
    }
  };

  const handleAction = async (worktree: Worktree, action: RowAction) => {
    setActionError(null);
    setActionMessage(null);

    if (action === "open") {
      openWorktree(worktree);
      setActionMessage(t("worktree.msg.opened", { branch: worktree.branch }));
      return;
    }

    // Archive/restore is a local-only view toggle (no git/IPC) — flip the
    // persisted override and surface a confirmation banner.
    if (action === "archive") {
      const wasArchived = isWorktreeArchived(
        worktree,
        archiveOverrides,
        archiveSignals,
      );
      setWorktreeArchived(worktreeKey(worktree), !wasArchived);
      setActionMessage(
        wasArchived
          ? t("worktree.msg.restored", { branch: worktree.branch })
          : t("worktree.msg.archived", { branch: worktree.branch }),
      );
      return;
    }

    // GitHub: open the PR (task.prUrl) or the branch's compare/tree view in the
    // OS browser. window.open("_blank") → main's setWindowOpenHandler routes
    // external https to shell.openExternal (no new IPC).
    if (action === "github") {
      const url = resolveGithubUrl(worktree);
      if (!url) return;
      window.open(url, "_blank", "noopener");
      return;
    }

    // 티켓 보기: jump to this worktree's board ticket (reuses the same
    // navigationStore hand-off the Activity Stream "태스크 열기" uses — Layout
    // switches to the board tab, KanbanBoard opens the detail modal).
    if (action === "ticket") {
      if (!worktree.taskId) return;
      useNavigationStore
        .getState()
        .requestJump({ type: "task", id: worktree.taskId });
      return;
    }

    // 오케에게 리뷰 요청: hand a free-form review request to the project
    // orchestrator via the proven local-PTY-first / Firestore-queue routing.
    if (action === "review") {
      await handleReviewRequest(worktree);
      return;
    }

    if (action === "delete") {
      const ok = window.confirm(
        t("worktree.confirm.delete", { branch: worktree.branch }),
      );
      if (!ok) return;
    }

    setBusy({ id: worktree.id, action });
    try {
      if (action === "rebase") {
        await rebase(worktree.path, worktree.baseRef);
        setActionMessage(
          t("worktree.msg.rebased", { branch: worktree.branch }),
        );
      } else if (action === "merge") {
        await merge({
          repoRoot: worktree.repoRoot,
          path: worktree.path,
          baseRef: worktree.baseRef,
          branch: worktree.branch,
          // 머지 이력 감사 트레일용 메타 (사람이 누른 머지).
          projectId: worktree.projectId,
          taskId: worktree.taskId ?? undefined,
          mode: "manual",
        });
        setActionMessage(t("worktree.msg.merged", { branch: worktree.branch }));
      } else if (action === "resolve") {
        await resolve({
          repoRoot: worktree.repoRoot,
          path: worktree.path,
          baseRef: worktree.baseRef,
          branch: worktree.branch,
          projectId: worktree.projectId,
          taskId: worktree.taskId ?? undefined,
          conflicts: worktree.status?.conflicts,
        });
        setActionMessage(
          t("worktree.msg.resolveStarted", { branch: worktree.branch }),
        );
      } else if (action === "delete") {
        await remove(worktree.repoRoot, worktree.path, true);
        setActionMessage(
          t("worktree.msg.removed", { branch: worktree.branch }),
        );
      }
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Worktree action failed",
      );
    } finally {
      setBusy(null);
    }
  };

  // '정리 필요(머지됨)' 워크트리만 명시적으로 일괄 제거한다. 후보는 이미
  // cleanupCandidates 로 좁혀져 있어(개발중·충돌·미커밋·unpushed 전부 제외) 안전.
  // repo-wide cleanupStale 대신 정확히 이 목록만 remove 하므로 라이브 작업이
  // 쓸려나갈 수 없다.
  const handleCleanupMerged = async () => {
    setActionError(null);
    setActionMessage(null);
    if (cleanupCandidates.length === 0) return;

    const ok = window.confirm(
      t("worktree.confirm.cleanupMerged", { count: cleanupCandidates.length }),
    );
    if (!ok) return;

    setCleaningStale(true);
    try {
      const result = await cleanupWorktrees(
        cleanupCandidates.map((wt) => ({
          repoRoot: wt.repoRoot,
          path: wt.path,
        })),
      );
      if (result.failed.length > 0) {
        setActionError(
          t("worktree.msg.cleanupPartial", {
            removed: result.removed.length,
            failed: result.failed.length,
            detail: result.failed
              .map((f) => `${f.path}: ${f.error}`)
              .join("; "),
          }),
        );
      } else {
        setActionMessage(
          t("worktree.msg.cleanupDone", { removed: result.removed.length }),
        );
      }
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : t("worktree.error.cleanupFailed"),
      );
    } finally {
      setCleaningStale(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      {/* 헤더 + 필터 */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-sm font-semibold text-gray-200">Worktrees</h1>

        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200"
        >
          {projectFilter === WORKTREE_PROJECT_FILTER_LOADING ? (
            <option value={WORKTREE_PROJECT_FILTER_LOADING} disabled>
              Loading project...
            </option>
          ) : null}
          <option value={WORKTREE_PROJECT_FILTER_ALL}>All projects</option>
          {projectOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as WorktreeStatusTone | "all")
          }
          className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {t(opt.labelKey)}
            </option>
          ))}
        </select>

        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-300">
          <input
            type="checkbox"
            checked={mergeableOnly}
            onChange={(e) => setMergeableOnly(e.target.checked)}
            className="accent-emerald-500"
          />
          Mergeable
        </label>

        <label
          className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-300"
          title={t("worktree.exceptionsTip")}
        >
          <input
            type="checkbox"
            checked={exceptionsOnly}
            onChange={(e) => setExceptionsOnly(e.target.checked)}
            className="accent-amber-500"
          />
          {t("worktree.exceptionsLabel")}
        </label>

        <button
          type="button"
          onClick={() => setArchivedView((v) => !v)}
          title={t("worktree.archivedToggleTip")}
          className={`rounded border px-2 py-1 text-xs transition ${
            archivedView
              ? "border-gray-400/50 bg-gray-500/15 text-gray-200"
              : "border-gray-700 text-gray-300 hover:bg-gray-800"
          }`}
        >
          {t("worktree.archivedToggleLabel", { count: archivedCount })}
        </button>

        <button
          type="button"
          onClick={() => setHistoryView((v) => !v)}
          title={t("worktree.historyToggleTip")}
          className={`rounded border px-2 py-1 text-xs transition ${
            historyView
              ? "border-sky-500/50 bg-sky-500/15 text-sky-200"
              : "border-gray-700 text-gray-300 hover:bg-gray-800"
          }`}
        >
          {t("worktree.historyToggleLabel")}
        </button>

        <button
          type="button"
          onClick={() => setShowLegend((v) => !v)}
          title={t("worktree.legend.toggleTip")}
          aria-expanded={showLegend}
          className={`rounded border px-2 py-1 text-xs transition ${
            showLegend
              ? "border-gray-400/50 bg-gray-500/15 text-gray-200"
              : "border-gray-700 text-gray-300 hover:bg-gray-800"
          }`}
        >
          {t("worktree.legend.toggleLabel")}
        </button>

        <div className="ml-auto flex items-center gap-2">
          {cleanupCandidates.length > 0 && (
            <button
              type="button"
              onClick={handleCleanupMerged}
              disabled={cleaningStale || loading}
              title={t("worktree.cleanupMergedTip")}
              className="rounded border border-gray-500/40 px-2 py-1 text-xs text-gray-300 transition hover:bg-gray-500/10 disabled:opacity-50"
            >
              {cleaningStale
                ? t("worktree.cleaningStale")
                : t("worktree.cleanupMergedLabel", {
                    count: cleanupCandidates.length,
                  })}
            </button>
          )}

          <button
            type="button"
            onClick={() => refresh().catch(() => {})}
            disabled={loading}
            className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-50"
          >
            {loading ? t("worktree.refreshing") : t("worktree.refresh")}
          </button>
        </div>
      </div>

      {/* 에러 배너 */}
      {lastError && (
        <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {t("worktree.error.loadFailed", { error: lastError })}
        </div>
      )}
      {actionError && (
        <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {t("worktree.error.actionFailed", { error: actionError })}
        </div>
      )}
      {actionMessage && (
        <div className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
          {actionMessage}
        </div>
      )}

      {/* 범례 — 상태(카테고리) + 버튼 한 줄 설명 */}
      {showLegend && <WorktreeLegend />}

      {/* 본문 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {waitingForDefaultProject ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-500">
            {t("worktree.loading")}
          </div>
        ) : historyView ? (
          historyLoading && history.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-gray-500">
              {t("worktree.history.loading")}
            </div>
          ) : historyEntries.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <div className="rounded-xl border border-dashed border-gray-700 bg-gray-800/30 p-6 text-center">
                <p className="text-sm text-gray-300">
                  {t("worktree.history.emptyTitle")}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {t("worktree.history.emptyHint")}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              {historyEntries.map((entry) => (
                <MergeHistoryRow
                  key={entry.id}
                  entry={entry}
                  projectLabel={projectName(entry.projectId)}
                  titleMeta={resolveWorktreeTitle(taskById, {
                    taskId: entry.taskId,
                    branch: entry.branch,
                  })}
                />
              ))}
            </div>
          )
        ) : loading && worktrees.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-500">
            {t("worktree.loading")}
          </div>
        ) : isEmpty ? (
          <div className="flex h-full items-center justify-center">
            <div className="rounded-xl border border-dashed border-gray-700 bg-gray-800/30 p-6 text-center">
              <p className="text-sm text-gray-300">
                {t("worktree.emptyTitle")}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {t("worktree.emptyHint")}
              </p>
            </div>
          </div>
        ) : archivedView && groups.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="rounded-xl border border-dashed border-gray-700 bg-gray-800/30 p-6 text-center">
              <p className="text-sm text-gray-300">
                {t("worktree.archivedEmptyTitle")}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {t("worktree.archivedEmptyHint")}
              </p>
            </div>
          </div>
        ) : noMatches ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-500">
            {t("worktree.noMatches")}
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map(([projectId, items]) => (
              <section key={projectId}>
                <h2 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
                  <span aria-hidden>▸</span>
                  {projectName(projectId)}
                  <span className="text-gray-600">({items.length})</span>
                </h2>
                <div className="space-y-1.5">
                  {items.map((wt) => (
                    <WorktreeRow
                      key={wt.id}
                      worktree={wt}
                      titleMeta={resolveWorktreeTitle(taskById, wt)}
                      pill={statusPill(wt)}
                      category={categoryOf(wt)}
                      githubUrl={resolveGithubUrl(wt)}
                      ticketAvailable={
                        wt.taskId != null && taskById.has(wt.taskId)
                      }
                      archived={isWorktreeArchived(
                        wt,
                        archiveOverrides,
                        archiveSignals,
                      )}
                      signals={archiveSignals}
                      busyAction={busy?.id === wt.id ? busy.action : null}
                      onAction={handleAction}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
