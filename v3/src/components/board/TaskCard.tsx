import { useEffect, useMemo, useRef, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { Agent } from "../../types/agent";
import type { Task } from "../../types/task";
import type { WorktreeStatusTone } from "../../types/worktree";
import { getPresenceStatus, type PresenceStatus } from "../../types/user";
import { useAgentStore } from "../../stores/agentStore";
import { useEditorStore } from "../../stores/editorStore";
import { useWorktreeStore } from "../../stores/worktreeStore";
import {
  findTaskWorktree,
  resolveTaskAgentId,
  sameWorktreePath,
} from "../../lib/taskWorktree";
import { viewWorktree } from "../../lib/viewWorktree";
import { usePresence } from "../../hooks/usePresence";
import { isLaneTask, isMissionTask } from "../../lib/laneContext";
import {
  spawnedModelLabel,
  spawnedModelTitle,
} from "../../lib/spawnedModelLabel";
import { useTranslation } from "../../lib/i18n";
import FlowKanbanLink from "../flows/FlowKanbanLink";

const PRESENCE_DOT: Record<PresenceStatus, string> = {
  online: "bg-green-400",
  idle: "bg-yellow-400",
  offline: "bg-gray-500",
};

/**
 * Returns true for `durationMs` after `key` changes (skipping the first
 * render so cards don't all pulse on initial mount). Each TaskCard owns its
 * own hook instance, so 5 cards changing in the same Firestore snapshot get
 * 5 independent timers — exactly what the cmux-style "pane changed" cue
 * needs.
 *
 * The pulse visual itself is a CSS-only `opacity` animation
 * (`mb-card-pulse-overlay` in index.css) which keeps the work on the
 * compositor. `prefers-reduced-motion` users get a static ring for the
 * same window with no motion.
 */
function usePulseOnChange(key: number | string, durationMs = 1400): boolean {
  const [pulsing, setPulsing] = useState(false);
  const firstRender = useRef(true);
  const prevKey = useRef(key);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      prevKey.current = key;
      return;
    }
    if (prevKey.current === key) return;
    prevKey.current = key;
    setPulsing(true);
    const t = setTimeout(() => setPulsing(false), durationMs);
    return () => clearTimeout(t);
  }, [key, durationMs]);

  return pulsing;
}

// ★그래프 뷰(TaskGraphView)가 그대로 재사용한다 — 역할 뱃지 색/아이콘이
// 카드와 노드에서 갈리면 같은 보드 안에서 색이 정보가 아니게 된다.
export const ROLE_COLORS: Record<string, string> = {
  backend: "bg-orange-500/20 text-orange-400",
  frontend: "bg-cyan-500/20 text-cyan-400",
  test: "bg-pink-500/20 text-pink-400",
  devops: "bg-emerald-500/20 text-emerald-400",
};

export const ROLE_ICONS: Record<string, string> = {
  backend: "⚙️",
  frontend: "🎨",
  test: "🧪",
  devops: "🚀",
};

// agentStore 의 MODEL_ICONS 와 동일 (기존 AgentList/AgentStatusCard 중복 패턴).
export const MODEL_ICONS: Record<string, string> = {
  claude: "🟣",
  gemini: "🔵",
  gpt: "🟢",
  antigravity: "🟠",
  local: "⚫",
  custom: "⚪",
};

const PRIORITY_CONFIG: Record<number, { label: string; color: string }> = {
  5: { label: "P5", color: "bg-red-500/20 text-red-400" },
  4: { label: "P4", color: "bg-orange-500/20 text-orange-400" },
  3: { label: "P3", color: "bg-yellow-500/20 text-yellow-400" },
  2: { label: "P2", color: "bg-blue-500/20 text-blue-400" },
  1: { label: "P1", color: "bg-gray-500/20 text-gray-400" },
};

const WORKTREE_PILL_TONE: Record<WorktreeStatusTone, string> = {
  danger: "bg-red-500/15 text-red-300 border-red-500/30",
  warning: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  behind: "bg-yellow-500/15 text-yellow-300 border-yellow-500/30",
  ready: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  idle: "bg-gray-500/15 text-gray-300 border-gray-500/30",
};

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface TaskCardProps {
  task: Task;
  /** 생략하면 카드가 클릭 대상이 아니다(비기너 미니 보드엔 상세 모달이 없다). */
  onClick?: (task: Task) => void;
  onFlowNavigate?: (flowId: string, nodeId: string) => void;
  /**
   * ★경량 렌더. 비기너 모드 미니 보드가 이 카드를 **그대로** 재사용하되
   * (중복 구현 금지) 워크트리 pill·모델 스탬프·PR/Flow/우선순위 칩·담당자·
   * 생성시각을 전부 뺀 형태로 그린다.
   *
   * 뺀 것들은 장식이 아니라 "승격 후에 배우는 것" 이다. 비기너에게 정확한
   * 해상도는 제목 + 지금 굴러가는가 + 막혔는가, 딱 셋이다.
   *
   * ★단 **진입**은 예외다 — 아래 두 프롭 참조. 보이는 정보를 줄이는 것과
   * 갈 수 있는 곳을 없애는 것은 다른 일이고, 후자는 심플 모드를 그림으로
   * 만든다(미니 보드가 안 눌리던 시절과 같은 결함).
   */
  compact?: boolean;
  /**
   * ★compact 전용 — "바뀐 코드 보기" 진입. 워크트리가 매칭되면 카드 아래 작은
   * 버튼이 붙고, 누르면 엑스퍼트 카드와 **같은** 액션(`viewWorktree`)이 돈다:
   * 파일 트리 루트 전환 + 담당 에이전트 포커스 + Code 표면의 diff 열기.
   *
   * 프롭으로 가르는 이유는 워크트리 목록 신선도 유지(`ensureFresh`)가 여기에
   * 딸려 있어서다 — 진입을 안 그리는 호스트는 IPC 도 태우지 않는다(종전 동작).
   * 브랜치 이름은 compact 에서 여전히 안 보인다(라벨은 "바뀐 코드 보기").
   */
  showWorktreeDiff?: boolean;
  /**
   * ★compact 전용 — 이 티켓을 물고 있는 에이전트 칩. 누르면 그 에이전트의
   * 터미널로 간다(심플 셸에서는 `BeginnerAgentTerminalModal`). 생략하면 칩이
   * 뜨지 않는다 = 종전 동작(우상단 점만).
   */
  onAgentClick?: (agent: Agent) => void;
}

export function TaskCard({
  task,
  onClick,
  onFlowNavigate,
  compact,
  showWorktreeDiff,
  onAgentClick,
}: TaskCardProps) {
  return (
    <TaskCardContent
      task={task}
      onClick={onClick}
      onFlowNavigate={onFlowNavigate}
      compact={compact}
      showWorktreeDiff={showWorktreeDiff}
      onAgentClick={onAgentClick}
    />
  );
}

interface DraggableTaskCardProps {
  task: Task;
  onClick?: (task: Task) => void;
  onFlowNavigate?: (flowId: string, nodeId: string) => void;
}

export function DraggableTaskCard({
  task,
  onClick,
  onFlowNavigate,
}: DraggableTaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `task-${task.id}`,
      data: { task },
    });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
      <TaskCardContent
        task={task}
        onClick={onClick}
        onFlowNavigate={onFlowNavigate}
        isDragging={isDragging}
      />
    </div>
  );
}

function TaskCardContent({
  task,
  onClick,
  onFlowNavigate,
  isDragging,
  compact,
  showWorktreeDiff,
  onAgentClick,
}: TaskCardProps & { isDragging?: boolean }) {
  const { t } = useTranslation();
  const priority = PRIORITY_CONFIG[task.priority] ?? PRIORITY_CONFIG[1];
  const roleColor = ROLE_COLORS[task.role] ?? "bg-gray-500/20 text-gray-400";
  const roleIcon = ROLE_ICONS[task.role] ?? "📋";
  const worktrees = useWorktreeStore((s) => s.worktrees);
  const ensureFreshWorktrees = useWorktreeStore((s) => s.ensureFresh);
  const statusPill = useWorktreeStore((s) => s.statusPill);
  const rootPath = useEditorStore((s) => s.rootPath);
  // Same resolver as the detail modal (explicit taskId → path → branch), so
  // the card and the modal agree on whether a worktree exists for this task.
  const taskId = task.id;
  const matchingWorktree = useMemo(
    () => findTaskWorktree(worktrees, { id: taskId }),
    [worktrees, taskId],
  );
  const matchingPill = matchingWorktree ? statusPill(matchingWorktree) : null;
  // Is the file tree currently rooted at this task's worktree? Derived from the
  // authoritative rootPath (drift-free), used to show the button's active state.
  const viewingThisWorktree = matchingWorktree
    ? sameWorktreePath(rootPath, matchingWorktree.path)
    : false;

  const isBlocked = task.status === "BLOCKED";
  const isFailed = task.status === "FAILED";
  const statusHighlight = isBlocked
    ? "border-l-2 border-l-orange-500"
    : isFailed
      ? "border-l-2 border-l-red-500"
      : "";

  // Pulse the card whenever Firestore reports a change (status, claimedBy,
  // hasPmFeedback, prUrl, etc — they all bump updatedAt). Each card owns its
  // own pulse timer so simultaneous changes pulse independently.
  const updatedKey =
    task.updatedAt instanceof Date ? task.updatedAt.getTime() : 0;
  const pulsing = usePulseOnChange(updatedKey);

  // The worktree list must not be a boot-time snapshot: worktrees are created
  // *during* the session (agent dispatch), and a card whose worktree is
  // missing from a stale list silently loses its "이 워크트리 보기" affordance.
  // ensureFresh is TTL+in-flight gated, so a board full of cards mounting at
  // once still costs at most one worktree:list IPC per minute.
  // compact 는 기본적으로 워크트리를 그리지 않는다 — 미니 보드 카드가 마운트될
  // 때마다 worktree:list IPC 를 태울 이유가 없다. ★"바뀐 코드 보기" 진입을 켠
  // 호스트만 예외다: 그 버튼의 존재 여부가 곧 워크트리 매칭이라, 목록이 낡으면
  // 버튼이 조용히 사라진다(아래 두 이펙트가 막으려는 바로 그 결함).
  const needsWorktrees = !compact || !!showWorktreeDiff;
  useEffect(() => {
    if (!needsWorktrees) return;
    ensureFreshWorktrees().catch(() => {});
  }, [needsWorktrees, ensureFreshWorktrees]);

  // A claimed task without a matching worktree is the "worktree was created
  // after our snapshot" signature (claim → spawn → worktree add) — re-check.
  const missingClaimedWorktree = Boolean(task.claimedBy) && !matchingWorktree;
  useEffect(() => {
    if (!needsWorktrees) return;
    if (!missingClaimedWorktree) return;
    ensureFreshWorktrees().catch(() => {});
  }, [
    needsWorktrees,
    missingClaimedWorktree,
    task.status,
    ensureFreshWorktrees,
  ]);

  // Resolve the claimant agent → owner userId so we can show whose machine
  // is currently hosting the agent and whether that teammate is online.
  // When `claimedBy` is unset, all hooks short-circuit (usePresence handles
  // undefined as "no subscription").
  const agents = useAgentStore((s) => s.agents);
  // claimedBy 는 두 경로로 저장됨: 수동 UI 할당은 agent.name, MCP claim_task 는
  // agent.id. 매칭은 양쪽을 모두 받아야 한다 (TaskDetailModal 의 AgentAssign 과
  // 동일). 한쪽만 보면 다른 경로로 들어온 케이스에서 ownerId 가 잡히지 않아
  // presence 가 무조건 offline 으로 떨어진다.
  const claimingAgent = task.claimedBy
    ? agents.find((a) => a.name === task.claimedBy || a.id === task.claimedBy)
    : undefined;
  // 구체 모델 스탬프(model@effort). 없으면 null → 배지는 벤더로 fallback.
  const agentModelLabel = spawnedModelLabel(claimingAgent?.spawnedModel);
  const ownerId = claimingAgent?.ownerId;
  // compact 는 팀 presence 를 안 그린다 → 구독도 걸지 않는다(undefined = no-op).
  const lastHeartbeatAt = usePresence(compact ? undefined : ownerId);
  // Presence 1차 판정은 에이전트 프로세스의 직접 시그널(agent.status)을 본다.
  // - working/idle 이면 inject_message 가 즉시 잡힐 거라 online
  // - stopped/error 면 오프라인 배너로 회수 권유
  // - 에이전트 doc 매칭 실패(레거시·미지 status)일 때만 owner 사용자의 in-app
  //   heartbeat 으로 폴백 → 팀 협업 시 "owner 가 마블로 앱을 닫아둠" 시나리오
  //   도 그대로 잡힌다.
  let presence: PresenceStatus | null = null;
  if (task.claimedBy) {
    const status = claimingAgent?.status;
    if (status === "working" || status === "idle") {
      presence = "online";
    } else if (status === "stopped" || status === "error") {
      presence = "offline";
    } else {
      presence = getPresenceStatus(lastHeartbeatAt);
    }
  }

  if (compact) {
    // 지금 굴러가는가 — 담당 에이전트의 프로세스 시그널만 본다. presence(팀원이
    // 앱을 켜뒀나)는 협업 개념이라 비기너 화면에서는 노이즈다.
    const running = claimingAgent?.status === "working";
    // ★두 진입. 각각 자기 스위치를 갖는다 — 호스트가 갈 곳을 실제로 갖고 있을
    // 때만 그린다(막다른 버튼 금지).
    const diffEntry = showWorktreeDiff ? matchingWorktree : null;
    const agentEntry = onAgentClick && claimingAgent ? claimingAgent : null;
    return (
      <div
        data-testid="beginner-mini-task"
        data-task-status={task.status}
        // 셸 팔레트(카타푸친)로 그린다 — 어드밴스드 보드의 `gray-*` 는 푸른
        // 회색이라 비기너 셸의 보랏빛 패널 위에서 색이 튀었다.
        className={`relative rounded-md border border-[#313244] bg-[#1e1e2e] px-2.5 py-1.5 ${statusHighlight} ${
          onClick ? "cursor-pointer hover:border-[#45475a]" : ""
        }`}
        title={task.title}
        onClick={onClick ? () => onClick(task) : undefined}
      >
        {pulsing && (
          <span aria-hidden="true" className="mb-card-pulse-overlay" />
        )}
        <div className="flex items-start gap-1.5">
          <span aria-hidden className="text-[11px] leading-[18px]">
            {roleIcon}
          </span>
          <span className="min-w-0 flex-1 text-[11px] leading-[18px] text-[#cdd6f4] line-clamp-2">
            {task.title}
          </span>
          {/* 에이전트 칩이 뜨면 그 칩이 같은 점을 들고 있다 — 한 카드에 같은
              뜻의 초록 점이 둘이면 하나는 장식이 된다. */}
          {running && !agentEntry && (
            <span
              aria-hidden
              className="mt-1.5 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[#a6e3a1]"
            />
          )}
        </div>
        {(isBlocked || isFailed) && (
          <span className="mt-1 inline-flex rounded bg-[#f9e2af]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#f9e2af]">
            ⚠ {t("board.taskCard.stuck")}
          </span>
        )}

        {/* ── ★진입 줄 — 결과(바뀐 코드) 와 사람(에이전트) ────────────────
            엑스퍼트 카드의 워크트리 버튼·담당자 줄과 **같은 목적지**를 심플
            톤으로만 다시 그린 것이다: 액션은 `viewWorktree`, 매칭은
            `findTaskWorktree`/`resolveTaskAgentId`, 담당 판정은 `claimingAgent`
            — 전부 위에서 이미 계산한 값이라 이 줄에는 새 규칙이 없다.
            카드 자체도 눌리는 표면(티켓 상세)이라 두 버튼은 클릭을 삼킨다. */}
        {(diffEntry || agentEntry) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {diffEntry && (
              <button
                type="button"
                data-testid="beginner-mini-task-diff"
                onClick={(event) => {
                  event.stopPropagation();
                  viewWorktree(diffEntry, {
                    focusAgentId: resolveTaskAgentId(agents, task),
                  });
                }}
                title={t("beginner.board.viewDiffTip")}
                className={`inline-flex max-w-full items-center gap-1 rounded px-1.5 py-0.5 text-[10px] leading-4 transition-colors ${
                  viewingThisWorktree
                    ? "bg-[#89b4fa]/15 text-[#89b4fa]"
                    : "text-[#7f849c] hover:bg-[#313244]/70 hover:text-[#cdd6f4]"
                }`}
              >
                <span aria-hidden>{viewingThisWorktree ? "👁" : "◫"}</span>
                <span className="truncate">
                  {viewingThisWorktree
                    ? t("beginner.board.viewingDiff")
                    : t("beginner.board.viewDiff")}
                </span>
              </button>
            )}
            {agentEntry && (
              <button
                type="button"
                data-testid="beginner-mini-task-agent"
                data-agent-status={agentEntry.status}
                onClick={(event) => {
                  event.stopPropagation();
                  onAgentClick!(agentEntry);
                }}
                title={t("beginner.agents.openTerminal")}
                className="inline-flex min-w-0 max-w-full items-center gap-1 rounded px-1.5 py-0.5 text-[10px] leading-4 text-[#7f849c] transition-colors hover:bg-[#313244]/70 hover:text-[#cdd6f4]"
              >
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    running ? "animate-pulse bg-[#a6e3a1]" : "bg-[#6c7086]"
                  }`}
                />
                <span className="truncate">{agentEntry.name}</span>
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`relative cursor-pointer rounded-lg bg-gray-800 p-3 shadow hover:bg-gray-750 transition-colors border border-gray-700/50 hover:border-gray-600 ${statusHighlight} ${
        isDragging ? "ring-2 ring-blue-500" : ""
      } ${isLaneTask(task.contextId) ? "border-l-2 border-l-amber-500" : ""} ${
        isMissionTask(task.contextId) ? "border-l-2 border-l-violet-500" : ""
      }`}
      onClick={() => onClick?.(task)}
    >
      {pulsing && <span aria-hidden="true" className="mb-card-pulse-overlay" />}
      <div className="flex items-start justify-between gap-2 mb-2">
        <h4 className="text-sm font-medium text-gray-200 line-clamp-2 flex-1">
          {task.title}
        </h4>
        {task.dependsOn.length > 0 && (
          <span
            className="text-gray-500 flex-shrink-0"
            title={`${task.dependsOn.length} dependencies`}
          >
            🔗
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${roleColor}`}
        >
          {roleIcon} {task.role}
        </span>
        <span
          className={`inline-flex rounded px-1.5 py-0.5 text-xs font-medium ${priority.color}`}
        >
          {priority.label}
        </span>
        {/* 이 티켓을 물고 있는 에이전트가 실제로 어떤 모델로 떴는지. 벤더만
            보이면 같은 claude 안에서 fable5 인지 5.6-sol 인지 구분이 안 돼
            "지정한 모델로 떴는지" 를 보드에서 확인할 수 없었다. 스탬프가 없는
            에이전트(핀 없는 스폰·구 doc)는 벤더 이름으로 fallback. */}
        {claimingAgent && (
          <span
            className="inline-flex max-w-[160px] items-center gap-1 truncate rounded bg-gray-500/20 px-1.5 py-0.5 text-xs font-medium text-gray-300"
            title={spawnedModelTitle(
              agentModelLabel ?? claimingAgent.model,
              claimingAgent.model,
            )}
          >
            <span aria-hidden>{MODEL_ICONS[claimingAgent.model] ?? "⚪"}</span>
            <span className="truncate font-mono">
              {agentModelLabel ?? claimingAgent.model}
            </span>
          </span>
        )}
        {isLaneTask(task.contextId) && (
          <span
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium bg-amber-500/20 text-amber-300"
            title={`context: ${task.contextId}`}
          >
            ⛙ Lane
          </span>
        )}
        {isMissionTask(task.contextId) && (
          <span
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium bg-violet-500/20 text-violet-300"
            title={`mission: ${task.contextId}`}
          >
            🎯 Mission
            {claimingAgent?.model && (
              <span aria-label={`agent: ${claimingAgent.model}`}>
                {MODEL_ICONS[claimingAgent.model] ?? "⚪"}
              </span>
            )}
          </span>
        )}
        {isBlocked && (
          <span className="inline-flex rounded px-1.5 py-0.5 text-xs font-medium bg-orange-500/20 text-orange-400">
            BLOCKED
          </span>
        )}
        {isFailed && (
          <span className="inline-flex rounded px-1.5 py-0.5 text-xs font-medium bg-red-500/20 text-red-400">
            FAILED
          </span>
        )}
        {task.hasPmFeedback && (
          <span className="inline-flex rounded px-1.5 py-0.5 text-xs font-medium bg-yellow-500/20 text-yellow-400">
            💬 FB
          </span>
        )}
        {task.prUrl && (
          <span className="inline-flex rounded px-1.5 py-0.5 text-xs font-medium bg-green-500/20 text-green-400">
            PR
          </span>
        )}
        {task.flowId && (
          <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium bg-indigo-500/20 text-indigo-400">
            ⚡ Flow
          </span>
        )}
        {matchingWorktree && matchingPill && (
          <>
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs font-medium ${
                WORKTREE_PILL_TONE[matchingPill.tone]
              }`}
              title={`${matchingWorktree.branch} · ${matchingWorktree.path}`}
            >
              <span aria-hidden>{matchingPill.icon}</span>
              {matchingPill.label}
            </span>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                // "이 워크트리 보기": switch the left file tree to this
                // worktree, select its agent in the bottom panel, and open its
                // diff on the Code surface — all three in one click, all three
                // on the same worktree, via the sanctioned action.
                viewWorktree(matchingWorktree, {
                  focusAgentId: resolveTaskAgentId(agents, task),
                });
              }}
              className={`inline-flex min-w-0 max-w-[11rem] items-center gap-1 truncate rounded px-1.5 py-0.5 font-mono text-xs ${
                viewingThisWorktree
                  ? "bg-blue-500/20 text-blue-200 ring-1 ring-inset ring-blue-500/40"
                  : "text-blue-300 hover:bg-blue-500/10 hover:text-blue-200"
              }`}
              title={
                viewingThisWorktree
                  ? t("board.taskCard.viewingWorktree")
                  : t("board.taskCard.viewWorktreeTip", {
                      branch: matchingWorktree.branch,
                    })
              }
            >
              <span aria-hidden>{viewingThisWorktree ? "👁" : "⎇"}</span>
              {matchingWorktree.branch}
            </button>
          </>
        )}
      </div>

      {task.flowId && task.flowNodeId && (
        <div className="mt-2">
          <FlowKanbanLink
            flowId={task.flowId}
            flowNodeId={task.flowNodeId}
            onNavigate={onFlowNavigate}
          />
        </div>
      )}

      <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
        <span className="inline-flex items-center gap-1.5">
          {task.claimedBy && presence ? (
            <span
              aria-label={t("board.taskCard.assignee", {
                status: t(`board.presence.${presence}`),
              })}
              title={t("board.taskCard.assignee", {
                status: t(`board.presence.${presence}`),
              })}
              className={`inline-block h-2 w-2 rounded-full ${PRESENCE_DOT[presence]}`}
            />
          ) : null}
          <span>
            {task.claimedBy
              ? `👤 ${claimingAgent?.name || task.claimedBy}`
              : t("board.taskCard.unassigned")}
          </span>
        </span>
        <span>{timeAgo(task.createdAt)}</span>
      </div>
    </div>
  );
}
