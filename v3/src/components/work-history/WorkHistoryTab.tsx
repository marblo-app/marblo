import { useEffect, useMemo, useState } from "react";
import { t, useTranslation } from "../../lib/i18n";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { useNavigationStore } from "../../stores/navigationStore";
import { subscribeToMergeHistory } from "../../services/mergeHistoryService";
import type { MergeHistoryEntry } from "../../types/mergeHistory";
import type { Task } from "../../types/task";
import {
  isCompletionReport,
  parseCompletionReport,
  type ParsedCompletionReport,
} from "../../lib/completionReport";
import { computeShareStats, resolvePrUrl } from "../../lib/shareCard";
import {
  DEFAULT_WORK_HISTORY_FILTER,
  filterDoneTasks,
  isFilterActive,
  type WorkHistoryFilter,
} from "../../lib/workHistoryFilter";
import { useTaskActivities } from "../../hooks/useTaskActivities";
import { DiffViewer } from "../board/DiffViewer";
import { TaskDetailModal } from "../board/TaskDetailModal";
import { periodLabel } from "../common/PeriodSelector";
import { ShareCard } from "./ShareCard";
import { WorkHistoryFilterBar } from "./WorkHistoryFilterBar";
import { FirstMissionShareNudge } from "./FirstMissionShareNudge";
import { MissionReplayList } from "./replay/MissionReplayList";
import { MissionReplayDetail } from "./replay/MissionReplayDetail";

// 완료 보고를 추적할 최근 완료 태스크 상한. task 당 Firestore activities 리스너가
// 하나씩 생기므로, 무한정 구독하지 않도록 최신순으로 잘라 둔다.
//
// ★이건 **리스너 상한이지 렌더/집계 상한이 아니다.** 예전엔 이 슬라이스 결과를
// 리스트와 공유카드에도 그대로 먹였는데, 그러면 기간 필터가 화면에서 사라진다:
// 컷오프는 **오래된 쪽만** 잘라내므로 어떤 기간이든 50건 이상 남아 있으면 "최신
// 50건" 이 전부 같은 50건이 된다. 라이브 실측(이 프로젝트 DONE 938건): 7일 164 /
// 30일 588 / 전체 938 — 셋 다 50을 넘어 **세 기간의 리스트와 Shipped 카드가 완전히
// 동일**했다. 그래서 리스트와 집계는 필터 결과 **전체**에 걸고, 이 상한은
// activities 구독에만 남긴다.
const MAX_TRACKED = 50;

/**
 * 이 탭이 그리는 두 축 — 태스크 단위(기존)와 미션 단위 Replay(신규).
 *
 * 신규 탭을 만들지 않고 같은 탭 안에서 토글하는 것은 설계 §1 확정 사항이다.
 * "완료된 일을 보여주는 집"이 이미 여기고, Replay 는 그 집의 미션 단위 뷰다.
 */
type WorkHistoryView = "tasks" | "replay";

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
  reportTracked,
  mergeEntry,
  commitRepoRoot,
}: {
  task: Task;
  report: ParsedCompletionReport | null;
  /** 이 태스크의 activities 를 구독했는가(= report 가 null 이면 "정말 없음"). */
  reportTracked: boolean;
  mergeEntry: MergeHistoryEntry | null;
  commitRepoRoot?: string;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
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
        commitRepoRoot ?? mergeEntry.repoRoot,
        mergeEntry.headSha,
        mergeEntry.projectId,
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
    <>
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
              // "보고가 없다" 와 "보고를 아직 안 읽었다" 는 다른 상태다 —
              // 리스너 창(MAX_TRACKED) 밖의 행에서 전자를 말하면 거짓말이 된다.
              <p className="text-xs text-gray-500">
                {reportTracked
                  ? t("workHistory.noReport")
                  : t("workHistory.reportNotLoaded", { count: MAX_TRACKED })}
              </p>
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
              <button
                type="button"
                onClick={() => setShowDetail(true)}
                className="text-xs text-blue-400 hover:underline"
              >
                {t("workHistory.openTicket")}
              </button>
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
      {showDetail && (
        <TaskDetailModal task={task} onClose={() => setShowDetail(false)} />
      )}
    </>
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

  // Replay 는 **추가 뷰**다 — 기존 태스크 뷰의 상태·구독은 그대로 두고, 미션
  // 구독(useReplayableMissions/useMissionReplay)은 Replay 를 실제로 열었을 때만
  // 마운트된다(리스너를 안 쓰는 화면에 켜 두지 않는다).
  const [view, setView] = useState<WorkHistoryView>("tasks");
  const [replayMissionId, setReplayMissionId] = useState<string | null>(null);

  // 감사 로그 티켓 상세의 "Replay 보기" 크로스링크 → Layout 이 이 탭을
  // 앞으로 가져온 뒤, 여기서 missionId 를 직접 읽어 Replay 뷰를 연다
  // (BoardTab 이 "task" 잡을 소비하는 것과 같은 hand-off 모양).
  const pendingJump = useNavigationStore((s) => s.pendingJump);
  const consumeJump = useNavigationStore((s) => s.consumeJump);
  useEffect(() => {
    if (!pendingJump || pendingJump.type !== "missionReplay") return;
    setView("replay");
    setReplayMissionId(pendingJump.missionId);
    consumeJump();
  }, [pendingJump, consumeJump]);

  const [filter, setFilter] = useState<WorkHistoryFilter>(
    DEFAULT_WORK_HISTORY_FILTER,
  );
  const patchFilter = (patch: Partial<WorkHistoryFilter>) =>
    setFilter((prev) => ({ ...prev, ...patch }));

  // 프로젝트 전체 완료 건수 — 필터와 무관한 분모(헤더의 "완료 N건").
  const doneTotal = useMemo(
    () => tasks.filter((task) => task.status === "DONE").length,
    [tasks],
  );

  // ★필터를 슬라이스보다 먼저 건다. 반대로 하면 역할·검색이 "최근 50건 안에서만"
  //   동작한다(lib/workHistoryFilter 헤더 참조).
  //   `Date.now()` 를 memo 의존성에 넣을 수 없으니 기간 컷오프는 filter 가 바뀔 때
  //   또는 태스크 스냅샷이 들어올 때 다시 계산된다 — 구독이 살아 있는 화면이라
  //   실사용에서 경계가 밀릴 일은 없다.
  const doneTasks = useMemo(
    () => filterDoneTasks(tasks, filter),
    [tasks, filter],
  );

  const trackedTasks = useMemo(
    () => doneTasks.slice(0, MAX_TRACKED),
    [doneTasks],
  );

  const trackedIds = useMemo(
    () => trackedTasks.map((t) => t.id),
    [trackedTasks],
  );

  const trackedIdSet = useMemo(() => new Set(trackedIds), [trackedIds]);

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
  // ★현재 프로젝트로 스코프해 구독한다: merge_history read 룰이 isProjectMember 로
  // 조여지면 unscoped(orderBy-only) 쿼리는 permission-denied 로 통째 거부된다
  // (#406/#428 패턴). where(projectId==) + orderBy mergedAt 은 firestore.indexes.json
  // 의 (projectId, mergedAt DESC) 복합인덱스로 서빙된다 — auditService 와 동일 패턴.
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
          // entries 는 쿼리에서 이미 현재 프로젝트로 스코프됨 + 최신순 →
          // taskId 당 첫(=가장 최근) 항목만.
          if (entry.taskId && !map[entry.taskId]) map[entry.taskId] = entry;
        }
        setMergeByTask(map);
      },
      { projectId, maxResults: 200 },
    );
    return () => unsub();
  }, [currentProject?.id]);

  // 공유카드는 **필터 결과 전체**를 집계한다 — 리스너 창(최신 50건)으로 좁히면
  // 기간을 바꿔도 수치가 안 움직인다(파일 상단 MAX_TRACKED 주석). 리스트도 같은
  // 집합을 그리므로 카드와 화면은 여전히 일치한다. 보고 기반 축
  // (tests/riskFlags)만 분모가 다르고, 그건 stats.reportsScanned 로 카드가 밝힌다.
  const shareStats = useMemo(
    () => computeShareStats(doneTasks, reports),
    [doneTasks, reports],
  );

  const filterOn = isFilterActive(filter);
  // ★카운트는 "필터가 기본값과 다른가" 가 아니라 "실제로 잘렸는가" 로 가른다.
  // 기본값이 30일이라 전자로 가르면 30일 컷을 걸어 놓고 전체 건수를 표시하게 되고
  // (=거짓말), "전체" 로 바꿔도 숫자가 그대로라 기간 선택기가 죽은 것처럼 보인다.
  const countTrimmed = doneTasks.length !== doneTotal;

  if (!currentProject) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500">
        {t("workHistory.selectProject")}
      </div>
    );
  }

  return (
    // 단일 스크롤 흐름: 헤더·ShareCard·리스트를 한 overflow-y-auto 컨테이너에 일반
    // 흐름으로 배치한다. 스크롤하면 ShareCard 도 함께 위로 밀려 올라가 리스트가 전체
    // 높이를 활용한다(ShareCard sticky 미적용 — 요청=전체 스크롤).
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-sm font-semibold text-gray-200">
          {t("workHistory.title")}
        </h1>
        {view === "tasks" && (
          <span className="text-xs text-gray-500">
            {/* 필터가 걸려 있으면 "필터 N / 전체 M" 로 분모를 같이 보여준다 —
                숫자 하나만 바뀌면 완료 이력이 사라진 것처럼 읽힌다. */}
            {countTrimmed
              ? t("workHistory.filteredCount", {
                  count: doneTasks.length,
                  total: doneTotal,
                  period: periodLabel(filter.periodId, t),
                })
              : t("workHistory.doneCount", { count: doneTotal })}
            {doneTasks.length > MAX_TRACKED &&
              ` ${t("workHistory.reportWindow", { count: MAX_TRACKED })}`}
          </span>
        )}

        <div className="ml-auto flex flex-shrink-0 gap-1">
          {(["tasks", "replay"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                setView(mode);
                // 목록으로 돌아갈 때 이전 선택이 남아 있으면, 다음에 Replay 를
                // 열었을 때 고르지도 않은 미션이 펼쳐진다.
                if (mode === "tasks") setReplayMissionId(null);
              }}
              className={`rounded border px-2 py-0.5 text-xs transition ${
                view === mode
                  ? "border-gray-500 bg-gray-800 text-gray-100"
                  : "border-gray-700 text-gray-400 hover:bg-gray-800"
              }`}
            >
              {mode === "tasks"
                ? t("workHistory.view.tasks")
                : t("workHistory.view.missions")}
            </button>
          ))}
        </div>
      </div>

      {view === "replay" ? (
        replayMissionId ? (
          <MissionReplayDetail
            missionId={replayMissionId}
            projectId={currentProject.id}
            onBack={() => setReplayMissionId(null)}
          />
        ) : (
          <MissionReplayList
            projectId={currentProject.id}
            onSelect={setReplayMissionId}
          />
        )
      ) : (
        <>
          <FirstMissionShareNudge
            key={currentProject.id}
            projectId={currentProject.id}
            onOpenReplay={(missionId) => {
              setView("replay");
              setReplayMissionId(missionId);
            }}
          />

          <WorkHistoryFilterBar
            filter={filter}
            onChange={patchFilter}
            onReset={() => setFilter(DEFAULT_WORK_HISTORY_FILTER)}
          />

          <ShareCard stats={shareStats} />

          {doneTasks.length === 0 ? (
            <div className="flex flex-1 items-center justify-center py-12">
              <div className="rounded-xl border border-dashed border-gray-700 bg-gray-800/30 p-6 text-center">
                {/* 완료가 아예 없는 것과 필터에 안 걸린 것은 다른 상태다 —
                    후자에서 "완료된 작업이 없습니다" 는 거짓말이 된다. */}
                <p className="text-sm text-gray-300">
                  {filterOn && doneTotal > 0
                    ? t("workHistory.empty.filtered.title")
                    : t("workHistory.empty.title")}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {filterOn && doneTotal > 0
                    ? t("workHistory.empty.filtered.hint")
                    : t("workHistory.empty.hint")}
                </p>
                {filterOn && doneTotal > 0 && (
                  <button
                    type="button"
                    onClick={() => setFilter(DEFAULT_WORK_HISTORY_FILTER)}
                    className="mt-3 rounded border border-gray-700 px-2.5 py-1 text-xs text-gray-300 transition hover:bg-gray-800"
                  >
                    {t("workHistory.filter.reset")}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              {/* 필터 결과 전체를 그린다(리스너 창으로 자르지 않는다) — 그래야 기간을
                  좁힌 게 화면에 남는다. 행 자체는 접힌 상태에서 버튼 하나라 가볍고,
                  무거운 쪽(activities 구독)은 여전히 MAX_TRACKED 로 묶여 있다. */}
              {doneTasks.map((task) => (
                <WorkHistoryRow
                  key={task.id}
                  task={task}
                  report={reports[task.id] ?? null}
                  reportTracked={trackedIdSet.has(task.id)}
                  mergeEntry={mergeByTask[task.id] ?? null}
                  commitRepoRoot={currentProject.folderPath}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
