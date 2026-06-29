import { useEffect, useMemo, useState } from "react";
import { t, useTranslation } from "../../lib/i18n";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { subscribeToMergeHistory } from "../../services/mergeHistoryService";
import type { MergeHistoryEntry } from "../../types/mergeHistory";
import type { Task } from "../../types/task";
import {
  isCompletionReport,
  parseCompletionReport,
  type ParsedCompletionReport,
} from "../../lib/completionReport";
import { computeShareStats, resolvePrUrl } from "../../lib/shareCard";
import { useTaskActivities } from "../../hooks/useTaskActivities";
import { DiffViewer } from "../board/DiffViewer";
import { ShareCard } from "./ShareCard";

// 완료 보고를 추적할 최근 완료 태스크 상한. task 당 Firestore activities 리스너가
// 하나씩 생기므로, 무한정 구독하지 않도록 최신순으로 잘라 둔다.
const MAX_TRACKED = 50;

function relativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return t("workHistory.time.justNow");
  if (min < 60) return t("workHistory.time.minutesAgo", { count: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("workHistory.time.hoursAgo", { count: hr });
  const day = Math.floor(hr / 24);
  if (day < 30) return t("workHistory.time.daysAgo", { count: day });
  return date.toLocaleDateString("ko-KR");
}

function ProvenanceField({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      <span className="w-12 flex-shrink-0 text-xs font-medium text-gray-500">
        {label}
      </span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-xs text-gray-300">
        {value}
      </span>
    </div>
  );
}

function WorkHistoryRow({
  task,
  report,
  mergeEntry,
}: {
  task: Task;
  report: ParsedCompletionReport | null;
  mergeEntry: MergeHistoryEntry | null;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [diff, setDiff] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  const prUrl = resolvePrUrl(task, report);

  const loadDiff = async () => {
    if (!mergeEntry || diff !== null || diffLoading) return;
    setDiffLoading(true);
    setDiffError(null);
    try {
      const res = await window.electronAPI.worktree.showCommit(
        mergeEntry.repoRoot,
        mergeEntry.headSha,
      );
      setDiff(res.diff);
    } catch (err) {
      setDiffError(
        err instanceof Error ? err.message : t("workHistory.diff.loadFailed"),
      );
    } finally {
      setDiffLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-800/40 px-3 py-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 text-left"
        title={task.id}
      >
        <span aria-hidden className="text-gray-500">
          {expanded ? "▾" : "▸"}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-gray-100">
          {task.title || (
            <span className="text-gray-500">
              {t("workHistory.row.untitled")}
            </span>
          )}
        </span>
        <span className="w-24 flex-shrink-0 truncate text-xs text-gray-400">
          {task.claimedBy ?? "—"}
        </span>
        {prUrl && (
          <span className="flex-shrink-0 rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-medium text-violet-300">
            PR
          </span>
        )}
        {report && (
          <span className="flex-shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
            {t("workHistory.badge.report")}
          </span>
        )}
        <span
          className="w-16 flex-shrink-0 text-right text-xs text-gray-500"
          title={task.updatedAt?.toLocaleString?.("ko-KR")}
        >
          {task.updatedAt ? relativeTime(task.updatedAt) : "—"}
        </span>
      </button>

      {expanded && (
        <div className="mt-2 space-y-1.5 border-t border-gray-800 pt-2">
          {report ? (
            <>
              <ProvenanceField
                label={t("workHistory.provenance.problem")}
                value={report.problem}
              />
              <ProvenanceField
                label={t("workHistory.provenance.approach")}
                value={report.approach}
              />
              <ProvenanceField
                label={t("workHistory.provenance.changes")}
                value={report.changes}
              />
              <ProvenanceField
                label={t("workHistory.provenance.verification")}
                value={report.verification}
              />
            </>
          ) : (
            <p className="text-xs text-gray-500">{t("workHistory.noReport")}</p>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            {prUrl && (
              <a
                href={prUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-blue-400 hover:underline"
              >
                {t("workHistory.openPr")} ↗
              </a>
            )}
            {mergeEntry && (
              <button
                type="button"
                onClick={loadDiff}
                disabled={diffLoading || diff !== null}
                className="rounded border border-gray-700 px-2 py-0.5 text-xs text-gray-300 transition hover:bg-gray-800 disabled:opacity-50"
              >
                {diff !== null
                  ? `diff (${mergeEntry.headSha.slice(0, 7)})`
                  : diffLoading
                    ? t("workHistory.diff.loading")
                    : t("workHistory.diff.view")}
              </button>
            )}
          </div>

          {(diff !== null || diffError) && (
            <div className="pt-1">
              <DiffViewer
                diff={diff ?? ""}
                loading={diffLoading}
                error={diffError}
                onRetry={() => {
                  setDiff(null);
                  setDiffError(null);
                  void loadDiff();
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function WorkHistoryTab() {
  const { t } = useTranslation();
  const currentProject = useProjectStore((s) => s.currentProject);
  const tasks = useTaskStore((s) => s.tasks);
  const subscribeToTasks = useTaskStore((s) => s.subscribeToTasks);

  // 태스크 구독 — 다른 탭과 같은 store 를 공유하지만, 이 탭이 단독으로 떠도
  // 데이터가 차도록 직접 구독한다(다른 탭 의존 없음 = 격리).
  useEffect(() => {
    if (!currentProject) return;
    const unsub = subscribeToTasks(currentProject.id);
    return () => unsub();
  }, [currentProject?.id, subscribeToTasks]);

  // 완료 태스크, 최신순.
  const doneTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.status === "DONE")
        .sort((a, b) => {
          const at = a.updatedAt ? +a.updatedAt : 0;
          const bt = b.updatedAt ? +b.updatedAt : 0;
          return bt - at;
        }),
    [tasks],
  );

  const trackedTasks = useMemo(
    () => doneTasks.slice(0, MAX_TRACKED),
    [doneTasks],
  );

  const trackedIds = useMemo(
    () => trackedTasks.map((t) => t.id),
    [trackedTasks],
  );

  const activitiesMap = useTaskActivities(trackedIds);

  // 추적 태스크별 최신 "✅ 완료 보고" 를 파싱.
  const reports = useMemo(() => {
    const out: Record<string, ParsedCompletionReport | null> = {};
    for (const task of trackedTasks) {
      const acts = activitiesMap[task.id] ?? [];
      let parsed: ParsedCompletionReport | null = null;
      for (let i = acts.length - 1; i >= 0; i--) {
        if (isCompletionReport(acts[i].message)) {
          parsed = parseCompletionReport(acts[i].message);
          break;
        }
      }
      out[task.id] = parsed;
    }
    return out;
  }, [trackedTasks, activitiesMap]);

  // 머지 이력(taskId → 최신 entry) — diff 의 git 좌표(repoRoot/headSha) 출처.
  // 인덱스가 이미 있는 cross-project 경로로 구독하고 projectId 는 클라에서 필터
  // (WorktreeTab 과 동일한 안전 경로 — 새 composite 인덱스 불필요).
  const [mergeByTask, setMergeByTask] = useState<
    Record<string, MergeHistoryEntry>
  >({});
  useEffect(() => {
    if (!currentProject) {
      setMergeByTask({});
      return;
    }
    const projectId = currentProject.id;
    const unsub = subscribeToMergeHistory(
      (entries) => {
        const map: Record<string, MergeHistoryEntry> = {};
        for (const entry of entries) {
          if (entry.projectId !== projectId) continue;
          // entries 는 최신순 — taskId 당 첫(=가장 최근) 항목만.
          if (entry.taskId && !map[entry.taskId]) map[entry.taskId] = entry;
        }
        setMergeByTask(map);
      },
      { maxResults: 200 },
    );
    return () => unsub();
  }, [currentProject?.id]);

  const shareStats = useMemo(
    () => computeShareStats(trackedTasks, reports),
    [trackedTasks, reports],
  );

  if (!currentProject) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500">
        {t("workHistory.selectProject")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <h1 className="text-sm font-semibold text-gray-200">
          {t("workHistory.title")}
        </h1>
        <span className="text-xs text-gray-500">
          {t("workHistory.doneCount", { count: doneTasks.length })}
          {doneTasks.length > MAX_TRACKED &&
            ` ${t("workHistory.recentAggregate", { count: MAX_TRACKED })}`}
        </span>
      </div>

      <ShareCard stats={shareStats} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {doneTasks.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="rounded-xl border border-dashed border-gray-700 bg-gray-800/30 p-6 text-center">
              <p className="text-sm text-gray-300">
                {t("workHistory.empty.title")}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {t("workHistory.empty.hint")}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            {trackedTasks.map((task) => (
              <WorkHistoryRow
                key={task.id}
                task={task}
                report={reports[task.id] ?? null}
                mergeEntry={mergeByTask[task.id] ?? null}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
