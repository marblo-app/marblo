import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useWorktreeStore } from "../../stores/worktreeStore";
import { useProjectStore } from "../../stores/projectStore";
import { viewWorktree } from "../../lib/viewWorktree";
import { subscribeToMergeHistory } from "../../services/mergeHistoryService";
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

type RowAction = "rebase" | "merge" | "resolve" | "open" | "archive" | "delete";

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
  busyAction,
  onAction,
}: {
  worktree: Worktree;
  archived: boolean;
  busyAction: RowAction | null;
  onAction: (worktree: Worktree, action: RowAction) => void;
}) {
  const { t } = useTranslation();
  const mergeable = worktree.status?.mergeable === true;
  const canResolve = Boolean(worktree.status && !worktree.status.mergeable);
  const disabled = busyAction !== null;

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
  pill,
  archived,
  signals,
  busyAction,
  onAction,
}: {
  worktree: Worktree;
  pill: WorktreeStatusPill;
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
    <div className="rounded-lg border border-gray-800 bg-gray-800/40 px-3 py-2">
      {/* 메인 행: 제목 / 에이전트 / 브랜치 / +ins/-del / 상태 pill */}
      <div className="flex items-center gap-3">
        <span
          className="min-w-0 flex-1 truncate text-sm text-gray-100"
          title={worktree.taskId ?? undefined}
        >
          {worktree.taskId ?? <span className="text-gray-500">(ad-hoc)</span>}
        </span>
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
}: {
  entry: MergeHistoryEntry;
  projectLabel: string;
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
        <span
          className="min-w-0 flex-1 truncate text-sm text-gray-100"
          title={entry.taskId ?? undefined}
        >
          {entry.taskId ?? <span className="text-gray-500">(ad-hoc)</span>}
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

export function WorktreeTab() {
  const worktrees = useWorktreeStore((s) => s.worktrees);
  const loading = useWorktreeStore((s) => s.loading);
  const lastError = useWorktreeStore((s) => s.lastError);
  const refresh = useWorktreeStore((s) => s.refresh);
  const rebase = useWorktreeStore((s) => s.rebase);
  const merge = useWorktreeStore((s) => s.merge);
  const resolve = useWorktreeStore((s) => s.resolve);
  const remove = useWorktreeStore((s) => s.remove);
  const cleanupStale = useWorktreeStore((s) => s.cleanupStale);
  const statusPill = useWorktreeStore((s) => s.statusPill);
  const archiveOverrides = useWorktreeStore((s) => s.archiveOverrides);
  const archiveSignals = useArchiveSignals();
  const setWorktreeArchived = useWorktreeStore((s) => s.setWorktreeArchived);
  const projects = useProjectStore((s) => s.projects);
  const currentProjectId = useProjectStore((s) => s.currentProject?.id ?? null);
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
  // 완료 이력 뷰 — 머지되어 사라진 워크트리의 감사 트레일 (merge_history).
  const [historyView, setHistoryView] = useState(false);
  const [history, setHistory] = useState<MergeHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // mount 시 1회 로드. 실패는 store.lastError 로 표면화되므로 swallow.
  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

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

  // 정리 가능(stale) 워크트리 — 이미 base에 머지됨 / 장기 무활동.
  const staleWorktrees = useMemo(
    () => worktrees.filter((wt) => wt.stale),
    [worktrees],
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

  // 정리 가능 워크트리를 repoRoot별로 묶어 일괄 cleanup (deleteBranch).
  const handleCleanupStale = async () => {
    setActionError(null);
    setActionMessage(null);
    if (staleWorktrees.length === 0) return;

    const repoRoots = Array.from(
      new Set(staleWorktrees.map((wt) => wt.repoRoot)),
    );
    const ok = window.confirm(
      t("worktree.confirm.cleanupStale", { count: staleWorktrees.length }),
    );
    if (!ok) return;

    setCleaningStale(true);
    try {
      let removed = 0;
      const failures: string[] = [];
      for (const repoRoot of repoRoots) {
        const result = await cleanupStale(repoRoot);
        removed += result.removed.length;
        for (const fail of result.failed) {
          failures.push(`${fail.path}: ${fail.error}`);
        }
      }
      if (failures.length > 0) {
        setActionError(
          t("worktree.msg.cleanupPartial", {
            removed,
            failed: failures.length,
            detail: failures.join("; "),
          }),
        );
      } else {
        setActionMessage(t("worktree.msg.cleanupDone", { removed }));
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

        <div className="ml-auto flex items-center gap-2">
          {staleWorktrees.length > 0 && (
            <button
              type="button"
              onClick={handleCleanupStale}
              disabled={cleaningStale || loading}
              title={t("worktree.cleanupStaleTip")}
              className="rounded border border-amber-500/40 px-2 py-1 text-xs text-amber-300 transition hover:bg-amber-500/10 disabled:opacity-50"
            >
              {cleaningStale
                ? t("worktree.cleaningStale")
                : t("worktree.cleanupStaleLabel", {
                    count: staleWorktrees.length,
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
                      pill={statusPill(wt)}
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
