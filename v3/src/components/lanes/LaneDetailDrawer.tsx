import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAgentStore } from "../../stores/agentStore";
import { useTaskActivities } from "../../hooks/useTaskActivities";
import { laneStatusPill } from "../../lib/laneStatus";
import { harnessIcon, laneToneColor } from "../../lib/laneVisuals";
import {
  buildLaneTimeline,
  type LaneTimelineEntry,
} from "../../lib/laneTimeline";
import { resolveTaskAgentId } from "../../lib/taskWorktree";
import {
  spawnedModelLabel,
  spawnedModelTitle,
} from "../../lib/spawnedModelLabel";
import { useTranslation } from "../../lib/i18n";
import type { LaneRow } from "../../types/lane";
import { TaskDetailModal } from "../board/TaskDetailModal";
import { ViewWorktreeButton } from "../board/ViewWorktreeButton";
import { LaneTerminalButton } from "./LaneTerminalButton";

/**
 * 레인 카드 클릭 → 오른쪽에서 밀려 나오는 **상세 드로우**.
 *
 * ── 무엇을 새로 만들지 않았나 ────────────────────────────────────────────────
 * 이 드로우는 새 데이터소스도, 두 번째 티켓 상세뷰도 아니다. 한 레인에 흩어져
 * 있던 세 가지(티켓·에이전트·워크트리)를 한 화면에 모아 보여주는 **조합**이며,
 * 내용물은 전부 기존 것을 그대로 쓴다:
 *   · 티켓 편집/코멘트/diff/상태전환 → 기존 board/TaskDetailModal 을 그대로 마운트
 *     ("티켓 상세 열기"). 여기에 다시 구현하지 않는다.
 *   · 워크트리 진입 → board/ViewWorktreeButton (lib/viewWorktree 의 공인 경로)
 *   · 에이전트 터미널 → LaneTerminalButton (카드와 같은 컴포넌트)
 *   · 히스토리 → hooks/useTaskActivities (완료이력 탭과 같은 구독)
 * 드로우가 자체로 하는 일은 배치와 요약뿐이다.
 *
 * ── 왜 모달이 아니라 드로우인가 ──────────────────────────────────────────────
 * 퀵레인의 전제는 "메인 작업과 병렬". 화면 한가운데를 덮는 모달은 그 전제를
 * 깨고, 특히 "이 워크트리 보기"처럼 뒤쪽 파일트리를 바꾸는 액션과 상성이 나쁘다.
 * 오른쪽 패널은 카드 목록을 시야에 남긴 채 한 레인만 깊게 본다.
 */

function formatDateTime(date: Date): string {
  return date.toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="w-20 flex-shrink-0 text-gray-500">{label}</span>
      <span className="min-w-0 flex-1 text-gray-300">{children}</span>
    </div>
  );
}

/** 값 + 복사 버튼. 경로·id 처럼 "터미널에 붙여넣을" 값 전용. */
function CopyableValue({ value, title }: { value: string; title?: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <span className="flex min-w-0 items-start gap-1.5">
      <span
        className="min-w-0 flex-1 break-all font-mono text-[11px] text-gray-300"
        title={title ?? value}
      >
        {value}
      </span>
      <button
        type="button"
        onClick={() => {
          // 클립보드 거부(권한/비보안 컨텍스트)는 조용히 삼키지 않고 그냥
          // "복사됨" 을 띄우지 않는 것으로 드러난다.
          navigator.clipboard
            .writeText(value)
            .then(() => setCopied(true))
            .catch(() => {});
        }}
        className="flex-shrink-0 rounded px-1 text-[10px] text-gray-500 transition hover:bg-gray-700 hover:text-gray-300"
      >
        {copied ? t("lanes.detail.copied") : t("lanes.detail.copy")}
      </button>
    </span>
  );
}

const TIMELINE_ICON: Record<LaneTimelineEntry["kind"], string> = {
  created: "📝",
  claimed: "🤝",
  status: "🚦",
  activity: "•",
};

function TimelineRow({ entry }: { entry: LaneTimelineEntry }) {
  const { t } = useTranslation();

  const headline =
    entry.kind === "created"
      ? t("lanes.detail.timeline.created")
      : entry.kind === "claimed"
        ? t("lanes.detail.timeline.claimed", { actor: entry.actor ?? "—" })
        : entry.kind === "status"
          ? t("lanes.detail.timeline.status", { status: entry.status ?? "—" })
          : (entry.actor ?? "—");

  return (
    <div
      className={`px-2.5 py-1.5 ${
        entry.kind === "activity"
          ? "border-l-2 border-blue-500/40"
          : "border-l-2 border-gray-600 bg-gray-800/40"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-gray-400">
          <span aria-hidden>{TIMELINE_ICON[entry.kind]}</span>
          <span className="truncate">{headline}</span>
        </span>
        <span className="flex-shrink-0 text-[10px] text-gray-600">
          {formatDateTime(entry.at)}
        </span>
      </div>
      {entry.message && (
        <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-gray-300">
          {entry.message}
        </p>
      )}
    </div>
  );
}

export function LaneDetailDrawer({
  row,
  onClose,
}: {
  row: LaneRow;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { task, agent, worktree } = row;
  const agents = useAgentStore((s) => s.agents);
  const [showTicket, setShowTicket] = useState(false);

  // Esc 로 닫기 — 드로우는 배경을 덮지 않으므로(작업 흐름 유지) 마우스를
  // 배경으로 옮기지 않고도 빠져나갈 길이 필요하다. 티켓 모달이 위에 떠 있는
  // 동안엔 그쪽이 먼저 닫혀야 하므로 여기선 무시한다.
  useEffect(() => {
    if (showTicket) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, showTicket]);

  // 활동로그 — 완료이력 탭과 같은 구독 훅. 배열 리터럴을 매 렌더 새로 만들지
  // 않도록 memo 로 고정(훅 내부 effect 키는 문자열이라 안전하지만, 불필요한
  // 재계산을 막는다).
  const taskIds = useMemo(() => [task.id], [task.id]);
  const activitiesMap = useTaskActivities(taskIds);
  const timeline = useMemo(
    () => buildLaneTimeline(task, activitiesMap[task.id] ?? []),
    [task, activitiesMap],
  );

  const pill = laneStatusPill(task, worktree);
  const st = worktree?.status;
  const modelLabel = agent ? spawnedModelLabel(agent.spawnedModel) : null;
  // 워크트리 진입 시 하단 패널이 고를 에이전트. 레인은 agent 를 직접 알지만
  // claimedBy 만 있는 경우도 있어 보드와 같은 해석기를 쓴다.
  const focusAgentId = agent?.id ?? resolveTaskAgentId(agents, task);

  return (
    <>
      {/* 모달이 아니라 보조 패널(<aside>) — 뒤의 카드 목록은 계속 살아 있어
          다른 카드를 눌러 바로 갈아탈 수 있다. */}
      <aside
        aria-label={t("lanes.detail.title")}
        className="absolute right-0 top-0 z-40 flex h-full w-full max-w-md flex-col border-l border-gray-700 bg-gray-900 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2 border-b border-gray-700 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span aria-hidden>{harnessIcon(agent?.model)}</span>
              <h2 className="truncate text-sm font-semibold text-gray-100">
                {task.title}
              </h2>
            </div>
            <span
              className="mt-1 inline-flex items-center gap-1 text-xs font-medium"
              style={{ color: laneToneColor(pill.tone) }}
            >
              <span aria-hidden>{pill.icon}</span>
              {pill.label}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("lanes.detail.close")}
            className="flex-shrink-0 rounded px-1.5 py-0.5 text-gray-400 transition hover:bg-gray-800 hover:text-gray-200"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
          {/* ── 연결 티켓 ─────────────────────────────────────────────── */}
          <Section title={t("lanes.detail.ticket")}>
            <Field label={t("lanes.detail.ticketId")}>
              <CopyableValue value={task.id} />
            </Field>
            <Field label={t("lanes.detail.status")}>
              <span className="rounded bg-gray-700 px-1.5 py-0.5 font-mono text-[11px] text-gray-200">
                {task.status}
              </span>
            </Field>
            <Field label={t("lanes.detail.created")}>
              {formatDateTime(task.createdAt)}
            </Field>
            <Field label={t("lanes.detail.updated")}>
              {formatDateTime(task.updatedAt)}
            </Field>
            {task.prUrl && (
              <Field label="PR">
                <a
                  href={task.prUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-blue-400 hover:underline"
                >
                  {task.prUrl}
                </a>
              </Field>
            )}
            {/* 티켓 본문·코멘트·diff·상태전환은 기존 보드 상세뷰가 이미 전부
                한다 — 여기서 다시 만들지 않고 그대로 연다. */}
            <button
              type="button"
              onClick={() => setShowTicket(true)}
              className="mt-1 w-full rounded border border-gray-700 px-3 py-1.5 text-xs text-gray-300 transition hover:bg-gray-800"
            >
              {t("lanes.detail.openTicket")}
            </button>
          </Section>

          {/* ── 담당 에이전트 ─────────────────────────────────────────── */}
          <Section title={t("lanes.detail.agent")}>
            {agent ? (
              <>
                <Field label={t("lanes.detail.agentName")}>
                  {harnessIcon(agent.model)} {agent.name}
                </Field>
                <Field label={t("lanes.detail.agentStatus")}>
                  {agent.status}
                </Field>
                <Field label={t("lanes.detail.harness")}>
                  <span className="font-mono text-[11px]">{agent.model}</span>
                  {modelLabel && (
                    <span
                      className="ml-1.5 inline-block max-w-full truncate rounded border border-[#45475a] bg-[#181825] px-1.5 py-0.5 font-mono text-[10px] text-[#a6adc8]"
                      title={spawnedModelTitle(modelLabel, agent.model)}
                    >
                      {modelLabel}
                    </span>
                  )}
                </Field>
                <Field label={t("lanes.detail.claimedBy")}>
                  {task.claimedBy ?? t("lanes.detail.unclaimed")}
                </Field>
                <div className="pt-1">
                  <LaneTerminalButton agent={agent} onOpened={onClose} />
                </div>
              </>
            ) : (
              <p className="text-xs text-gray-500">
                {t("lanes.detail.noAgent")}
              </p>
            )}
          </Section>

          {/* ── 워크트리 ─────────────────────────────────────────────── */}
          <Section title={t("lanes.detail.worktree")}>
            {worktree ? (
              <>
                <Field label={t("lanes.detail.branch")}>
                  <span className="break-all font-mono text-[11px] text-gray-300">
                    {worktree.branch}
                  </span>
                </Field>
                <Field label={t("lanes.detail.baseRef")}>
                  <span className="font-mono text-[11px]">
                    {worktree.baseRef}
                  </span>
                </Field>
                <Field label={t("lanes.detail.path")}>
                  <CopyableValue value={worktree.path} />
                </Field>
                {st && (
                  <Field label={t("lanes.detail.diffStat")}>
                    ▲{st.ahead} ▼{st.behind} · +{st.insertions}/−{st.deletions}{" "}
                    (
                    {t("lanes.detail.filesChanged", {
                      count: String(st.filesChanged),
                    })}
                    )
                  </Field>
                )}
                {st && st.conflicts.length > 0 && (
                  <div className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300">
                    <div className="font-medium">
                      {t("lanes.detail.conflicts", {
                        count: String(st.conflicts.length),
                      })}
                    </div>
                    <div className="mt-0.5 break-all font-mono text-[10px] text-red-300/80">
                      {st.conflicts.join(", ")}
                    </div>
                  </div>
                )}
                <div className="pt-1">
                  <ViewWorktreeButton
                    worktree={worktree}
                    agentId={focusAgentId}
                    onClose={onClose}
                  />
                </div>
              </>
            ) : (
              <p className="text-xs text-gray-500">
                {t("lanes.row.worktreePreparing")}
              </p>
            )}
          </Section>

          {/* ── 히스토리 (활동로그 + 상태전이 마커) ───────────────────── */}
          <Section
            title={t("lanes.detail.history", {
              count: String(timeline.length),
            })}
          >
            {timeline.length === 0 ? (
              <p className="text-xs text-gray-500">
                {t("lanes.detail.noHistory")}
              </p>
            ) : (
              <div className="divide-y divide-gray-800 rounded border border-gray-800 bg-gray-900/60">
                {timeline.map((entry) => (
                  <TimelineRow key={entry.id} entry={entry} />
                ))}
              </div>
            )}
          </Section>
        </div>
      </aside>

      {/* 기존 보드 티켓 상세뷰를 그대로 재사용 — 드로우 위에 뜬다. */}
      {showTicket && (
        <TaskDetailModal task={task} onClose={() => setShowTicket(false)} />
      )}
    </>
  );
}
