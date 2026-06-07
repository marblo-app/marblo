import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useWorktreeStore } from "../../stores/worktreeStore";
import { useProjectStore } from "../../stores/projectStore";
import { useEditorStore } from "../../stores/editorStore";
import type {
  Worktree,
  WorktreeStatusPill,
  WorktreeStatusTone,
} from "../../types/worktree";

const TONE_CLASSES: Record<WorktreeStatusTone, string> = {
  danger: "bg-red-500/15 text-red-300 border border-red-500/30",
  warning: "bg-amber-500/15 text-amber-300 border border-amber-500/30",
  behind: "bg-yellow-500/15 text-yellow-300 border border-yellow-500/30",
  ready: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",
  idle: "bg-gray-500/15 text-gray-300 border border-gray-500/30",
};

// 상태 필터 드롭다운 옵션. tone 값과 1:1.
const STATUS_OPTIONS: { value: WorktreeStatusTone | "all"; label: string }[] = [
  { value: "all", label: "전체 상태" },
  { value: "ready", label: "🟢 머지 가능" },
  { value: "behind", label: "🟡 뒤처짐" },
  { value: "warning", label: "⚠️ stale" },
  { value: "danger", label: "🔴 충돌" },
  { value: "idle", label: "⚪ 작업중" },
];

function StatusPill({ pill }: { pill: WorktreeStatusPill }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[pill.tone]}`}
    >
      <span aria-hidden>{pill.icon}</span>
      {pill.label}
    </span>
  );
}

function ConflictSummary({ worktree }: { worktree: Worktree }) {
  const conflicts = worktree.status?.conflicts.length ?? 0;
  if (conflicts > 0) {
    return <span className="text-red-300">{conflicts} conflicts</span>;
  }
  if (worktree.status && !worktree.status.mergeable) {
    return <span className="text-amber-300">rebase 필요</span>;
  }
  return <span className="text-gray-500">충돌없음</span>;
}

type RowAction = "rebase" | "merge" | "resolve" | "open" | "delete";

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
  busyAction,
  onAction,
}: {
  worktree: Worktree;
  busyAction: RowAction | null;
  onAction: (worktree: Worktree, action: RowAction) => void;
}) {
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
              : "충돌 상태에서만 Resolve 가능"
          }
          onClick={() => onAction(worktree, "resolve")}
        >
          {busyAction === "resolve" ? "Resolving" : "Resolve"}
        </ActionButton>
      )}
      <ActionButton
        disabled={disabled}
        title="Code 탭에서 이 worktree 열기"
        onClick={() => onAction(worktree, "open")}
      >
        Open
      </ActionButton>
      <ActionButton
        disabled={disabled}
        title="워크트리 제거 및 브랜치 cleanup"
        tone="danger"
        onClick={() => onAction(worktree, "delete")}
      >
        {busyAction === "delete" ? "Deleting" : "Delete"}
      </ActionButton>
    </div>
  );
}

function WorktreeRow({
  worktree,
  pill,
  busyAction,
  onAction,
}: {
  worktree: Worktree;
  pill: WorktreeStatusPill;
  busyAction: RowAction | null;
  onAction: (worktree: Worktree, action: RowAction) => void;
}) {
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

      {/* 보조 행: ▲ahead ▼behind / 충돌수 / 액션 */}
      <div className="mt-1.5 flex items-center gap-3 pl-0.5 text-xs text-gray-400">
        <span className="flex items-center gap-2 font-mono">
          <span title="ahead (base 대비 앞선 커밋)">▲{ahead}</span>
          <span title="behind (base 대비 뒤처진 커밋)">▼{behind}</span>
        </span>
        <span>
          <ConflictSummary worktree={worktree} />
        </span>
        <span className="ml-auto">
          <RowActions
            worktree={worktree}
            busyAction={busyAction}
            onAction={onAction}
          />
        </span>
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
  const cleanupStale = useWorktreeStore((s) => s.cleanupStale);
  const statusPill = useWorktreeStore((s) => s.statusPill);
  const projects = useProjectStore((s) => s.projects);
  const currentProject = useProjectStore((s) => s.currentProject);
  const setCurrentProject = useProjectStore((s) => s.setCurrentProject);
  const setRootPath = useEditorStore((s) => s.setRootPath);
  const closeAllFiles = useEditorStore((s) => s.closeAllFiles);

  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<WorktreeStatusTone | "all">(
    "all",
  );
  const [mergeableOnly, setMergeableOnly] = useState(false);
  // 예외 뷰: 자동머지 안 되고 사람이 봐야 하는 것만 (충돌/머지불가 or stale).
  // 자율성 다이얼 L1에서 clean+mergeable은 자동머지되므로 예외가 아님.
  const [exceptionsOnly, setExceptionsOnly] = useState(false);
  const [busy, setBusy] = useState<{ id: string; action: RowAction } | null>(
    null,
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [cleaningStale, setCleaningStale] = useState(false);

  // mount 시 1회 로드. 실패는 store.lastError 로 표면화되므로 swallow.
  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  // projectId → 사람이 읽는 이름. 미등록 프로젝트는 id 그대로.
  const projectName = useMemo(() => {
    const map = new Map(projects.map((p) => [p.id, p.name]));
    return (projectId: string) => map.get(projectId) ?? projectId;
  }, [projects]);

  // 필터 적용 후 프로젝트별 그룹.
  const groups = useMemo(() => {
    const filtered = worktrees.filter((wt) => {
      if (projectFilter !== "all" && wt.projectId !== projectFilter) {
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

  const isEmpty = !loading && worktrees.length === 0;
  const noMatches = !loading && worktrees.length > 0 && groups.length === 0;

  const openWorktree = (worktree: Worktree) => {
    const project = projects.find((p) => p.id === worktree.projectId);
    if (project && currentProject?.id !== project.id) {
      setCurrentProject(project);
    }
    closeAllFiles();
    setRootPath(worktree.path);
    const codeTab = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Code",
    );
    codeTab?.click();
  };

  const handleAction = async (worktree: Worktree, action: RowAction) => {
    setActionError(null);
    setActionMessage(null);

    if (action === "open") {
      openWorktree(worktree);
      setActionMessage(`${worktree.branch} worktree를 Code 탭에 열었습니다.`);
      return;
    }

    if (action === "delete") {
      const ok = window.confirm(
        `${worktree.branch} worktree를 제거하고 브랜치도 cleanup할까요?`,
      );
      if (!ok) return;
    }

    setBusy({ id: worktree.id, action });
    try {
      if (action === "rebase") {
        await rebase(worktree.path, worktree.baseRef);
        setActionMessage(`${worktree.branch} rebase 완료`);
      } else if (action === "merge") {
        await merge({
          repoRoot: worktree.repoRoot,
          path: worktree.path,
          baseRef: worktree.baseRef,
          branch: worktree.branch,
        });
        setActionMessage(`${worktree.branch} squash-merge 완료`);
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
        setActionMessage(`${worktree.branch} resolve agent 시작`);
      } else if (action === "delete") {
        await remove(worktree.repoRoot, worktree.path, true);
        setActionMessage(`${worktree.branch} worktree 제거 완료`);
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
      `정리 가능(stale) 워크트리 ${staleWorktrees.length}개를 제거하고 브랜치도 cleanup할까요?`,
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
          `${removed}개 정리, ${failures.length}개 실패 — ${failures.join("; ")}`,
        );
      } else {
        setActionMessage(`stale 워크트리 ${removed}개 정리 완료`);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "stale cleanup 실패");
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
          <option value="all">All projects</option>
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
              {opt.label}
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
          title="자동머지 안 되고 사람이 봐야 하는 것만 (충돌/머지불가 또는 stale)"
        >
          <input
            type="checkbox"
            checked={exceptionsOnly}
            onChange={(e) => setExceptionsOnly(e.target.checked)}
            className="accent-amber-500"
          />
          ⚠️ 예외만
        </label>

        <div className="ml-auto flex items-center gap-2">
          {staleWorktrees.length > 0 && (
            <button
              type="button"
              onClick={handleCleanupStale}
              disabled={cleaningStale || loading}
              title="이미 머지됨/장기 무활동인 워크트리를 일괄 제거 (브랜치 cleanup)"
              className="rounded border border-amber-500/40 px-2 py-1 text-xs text-amber-300 transition hover:bg-amber-500/10 disabled:opacity-50"
            >
              {cleaningStale
                ? "정리 중…"
                : `⚠️ 정리 가능 일괄 cleanup (${staleWorktrees.length})`}
            </button>
          )}

          <button
            type="button"
            onClick={() => refresh().catch(() => {})}
            disabled={loading}
            className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-50"
          >
            {loading ? "새로고침 중…" : "새로고침"}
          </button>
        </div>
      </div>

      {/* 에러 배너 */}
      {lastError && (
        <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          워크트리 로드 실패: {lastError}
        </div>
      )}
      {actionError && (
        <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          워크트리 액션 실패: {actionError}
        </div>
      )}
      {actionMessage && (
        <div className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
          {actionMessage}
        </div>
      )}

      {/* 본문 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && worktrees.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-500">
            워크트리를 불러오는 중…
          </div>
        ) : isEmpty ? (
          <div className="flex h-full items-center justify-center">
            <div className="rounded-xl border border-dashed border-gray-700 bg-gray-800/30 p-6 text-center">
              <p className="text-sm text-gray-300">워크트리가 없습니다.</p>
              <p className="mt-1 text-xs text-gray-500">
                에이전트가 태스크용 워크트리를 만들면 여기에 표시됩니다.
              </p>
            </div>
          </div>
        ) : noMatches ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-500">
            필터 조건에 맞는 워크트리가 없습니다.
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
