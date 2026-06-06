import { useEffect, useMemo, useState } from "react";
import { useWorktreeStore } from "../../stores/worktreeStore";
import { useProjectStore } from "../../stores/projectStore";
import type {
  Worktree,
  WorktreeStatusPill,
  WorktreeStatusTone,
} from "../../types/worktree";

// 크로스 프로젝트 Worktree 칵핏 (spec §7.1).
// 읽기 + 상태 pill 까지만. 행 액션(Rebase/Merge/Open/Delete)은 다음 태스크
// (wt-tab-actions)에서 배선하므로 여기서는 disabled placeholder 로 자리만 잡는다.

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

// 행 액션 placeholder. 다음 태스크(wt-tab-actions)에서 onClick 배선.
function RowActions() {
  const actions = ["Rebase", "Merge", "Open", "✕"];
  return (
    <div className="flex flex-shrink-0 items-center gap-1">
      {actions.map((label) => (
        <button
          key={label}
          type="button"
          disabled
          title="다음 태스크(wt-tab-actions)에서 배선됩니다"
          className="cursor-not-allowed rounded border border-gray-700 px-1.5 py-0.5 text-[11px] text-gray-500 opacity-60"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function WorktreeRow({
  worktree,
  pill,
}: {
  worktree: Worktree;
  pill: WorktreeStatusPill;
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
          <RowActions />
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
  const statusPill = useWorktreeStore((s) => s.statusPill);
  const projects = useProjectStore((s) => s.projects);

  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<WorktreeStatusTone | "all">(
    "all",
  );
  const [mergeableOnly, setMergeableOnly] = useState(false);

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

  const isEmpty = !loading && worktrees.length === 0;
  const noMatches = !loading && worktrees.length > 0 && groups.length === 0;

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

        <button
          type="button"
          onClick={() => refresh().catch(() => {})}
          disabled={loading}
          className="ml-auto rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-50"
        >
          {loading ? "새로고침 중…" : "새로고침"}
        </button>
      </div>

      {/* 에러 배너 */}
      {lastError && (
        <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          워크트리 로드 실패: {lastError}
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
