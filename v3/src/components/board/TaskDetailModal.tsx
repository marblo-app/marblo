import { useEffect, useRef, useState } from "react";
import type { Task, TaskStatus } from "../../types/task";
import type { Activity } from "../../types/activity";
import type { Agent } from "../../types/agent";
import type { TaskComment } from "../../types/chat";
import {
  updateTask,
  updateTaskStatus,
  deleteTask,
} from "../../services/taskService";
import {
  addActivity,
  subscribeToActivities,
} from "../../services/activityService";
import { addComment, subscribeToComments } from "../../services/commentService";
import { getNextStatuses } from "../../services/stateMachine";
import { useAgentStore } from "../../stores/agentStore";
import { useTaskStore } from "../../stores/taskStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { useAgentFocusStore } from "../../stores/agentFocusStore";
import { getSessionIdForAgent } from "../../stores/agentSessionMap";
import { useProjectStore } from "../../stores/projectStore";
import { useWorktreeStore } from "../../stores/worktreeStore";
import { useAuth } from "../../hooks/useAuth";
import { useTranslation } from "../../lib/i18n";
import {
  spawnedModelLabel,
  spawnedModelTitle,
} from "../../lib/spawnedModelLabel";
import { findTaskWorktree, resolveTaskAgentId } from "../../lib/taskWorktree";
import { TASK_STATUS_COLORS } from "../../lib/taskStatusStyle";
import { TaskBodySections, hasAnyBody } from "./TaskBodySections";
import { DiffViewer } from "./DiffViewer";
import { ViewWorktreeButton } from "./ViewWorktreeButton";

type DetailTab = "comments" | "activity" | "diff";

// 감사 로그의 관리자 뷰도 같은 팔레트를 쓴다 — 두 화면이 같은 상태를 다른
// 색으로 칠하지 않도록 lib/taskStatusStyle 한 곳에만 둔다.
const STATUS_COLORS = TASK_STATUS_COLORS;

const STATUS_BUTTON_COLORS: Record<TaskStatus, string> = {
  TODO: "bg-gray-600 hover:bg-gray-500",
  CLAIMED: "bg-yellow-600 hover:bg-yellow-500",
  IN_PROGRESS: "bg-blue-600 hover:bg-blue-500",
  REVIEW: "bg-purple-600 hover:bg-purple-500",
  BLOCKED: "bg-orange-600 hover:bg-orange-500",
  FAILED: "bg-red-600 hover:bg-red-500",
  DONE: "bg-green-600 hover:bg-green-500",
};

const ROLE_COLORS: Record<string, string> = {
  backend: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  frontend: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  test: "bg-pink-500/20 text-pink-400 border-pink-500/30",
  devops: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
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

function formatDate(date: Date): string {
  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const MODEL_ICONS: Record<string, string> = {
  claude: "🟣",
  gemini: "🔵",
  gpt: "🟢",
  antigravity: "🟠",
  local: "⚫",
  custom: "⚪",
};

function getErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function AgentAssign({
  taskId,
  claimedBy,
}: {
  taskId: string;
  claimedBy: string | null;
}) {
  const allAgents = useAgentStore((s) => s.agents);
  const tasks = useTaskStore((s) => s.tasks);
  const candidates = allAgents.filter((a) => a.role !== "orchestrator");

  // Show only the most-recently-assigned agent across the board (by
  // claimedAt). Falls back to the newest agent if no task has been
  // claimed yet. Keeps the picker as a single chip per user request.
  let suggested: (typeof candidates)[number] | undefined;
  const ranked = tasks
    .filter((t) => t.claimedBy && t.claimedAt)
    .sort((a, b) => b.claimedAt!.getTime() - a.claimedAt!.getTime());
  for (const t of ranked) {
    const found = candidates.find(
      (a) => a.name === t.claimedBy || a.id === t.claimedBy,
    );
    if (found) {
      suggested = found;
      break;
    }
  }
  if (!suggested) {
    suggested = [...candidates].sort(
      (a, b) =>
        (b.createdAt?.getTime?.() ?? 0) - (a.createdAt?.getTime?.() ?? 0),
    )[0];
  }
  const agents = suggested ? [suggested] : [];

  if (agents.length === 0) return null;

  const handleAssign = async (agentName: string) => {
    const prevAgent = claimedBy;
    await updateTask(taskId, { claimedBy: agentName });
    // Notify new agent
    window.electronAPI.bridge
      .injectMessage({
        targetAgent: agentName,
        tag: "Task Reassigned",
        message: `이 태스크가 당신에게 배정되었습니다.${
          prevAgent ? ` (이전: ${prevAgent})` : ""
        }`,
        taskId,
      })
      .catch(() => {});
    // Notify previous agent
    if (prevAgent) {
      window.electronAPI.bridge
        .injectMessage({
          targetAgent: prevAgent,
          tag: "Task Reassigned",
          message: `이 태스크가 ${agentName}에게 재배정되었습니다. 작업을 중단하세요.`,
          taskId,
        })
        .catch(() => {});
    }
  };

  const handleUnassign = async () => {
    const prevAgent = claimedBy;
    await updateTask(taskId, { claimedBy: null });
    if (prevAgent) {
      window.electronAPI.bridge
        .injectMessage({
          targetAgent: prevAgent,
          tag: "Task Reassigned",
          message: "이 태스크의 배정이 해제되었습니다. 작업을 중단하세요.",
          taskId,
        })
        .catch(() => {});
    }
  };

  return (
    <div>
      <h3 className="text-xs font-medium text-gray-400 uppercase mb-2">
        Assign Agent
      </h3>
      <div className="flex flex-wrap gap-2">
        {agents.map((agent) => {
          const isAssigned = claimedBy === agent.name || claimedBy === agent.id;
          // 구체 모델 스탬프. 없으면 배지를 빼고 기존 아이콘+이름만 남긴다.
          const modelLabel = spawnedModelLabel(agent.spawnedModel);
          return (
            <button
              key={agent.id}
              onClick={() =>
                isAssigned ? handleUnassign() : handleAssign(agent.name)
              }
              title={
                modelLabel
                  ? spawnedModelTitle(modelLabel, agent.model)
                  : agent.model
              }
              className={`flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs transition-colors ${
                isAssigned
                  ? "border-blue-500 bg-blue-500/20 text-blue-400"
                  : "border-gray-600 bg-gray-700/50 text-gray-400 hover:border-gray-500 hover:text-gray-300"
              }`}
            >
              <span>{MODEL_ICONS[agent.model] || "⚪"}</span>
              <span>{agent.name}</span>
              {modelLabel && (
                <span className="max-w-[140px] truncate rounded bg-black/30 px-1 py-px font-mono text-[10px] text-gray-400">
                  {modelLabel}
                </span>
              )}
              {isAssigned && <span className="text-[10px]">✓</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AgentTerminalButton({
  claimedBy,
  onClose,
  onOpenAgentTerminal,
}: {
  claimedBy: string | null;
  onClose: () => void;
  /**
   * 심플(비기너) 셸처럼 **터미널 탭/열이 없는** 표면에서 넘긴다.
   * 있으면 어드밴스드의 `openTerminalForSession` 경로를 건너뛰고 이 콜백만
   * 부른다 — 심플 셸에 탭이 없는데 그 경로를 타면 모달만 닫히고 아무 화면도
   * 안 뜬다(티켓 어사인 에이전트 "터미널 보기" 무반응).
   */
  onOpenAgentTerminal?: (agent: Agent) => void;
}) {
  const agents = useAgentStore((s) => s.agents);
  const terminalSessions = useTerminalStore((s) => s.sessions);
  const openTerminalForSession = useTerminalStore(
    (s) => s.openTerminalForSession,
  );
  const setFocusedAgent = useAgentFocusStore((s) => s.setFocusedAgent);
  const { t } = useTranslation();

  if (!claimedBy) return null;

  const normalizedClaim = claimedBy.toLowerCase();
  const agent = agents.find(
    (a) =>
      a.role !== "orchestrator" &&
      (a.id === claimedBy ||
        a.name === claimedBy ||
        a.name.toLowerCase() === normalizedClaim),
  );
  if (!agent) return null;

  const ptySessionId = getSessionIdForAgent(agent.id);
  const hasSession = terminalSessions.some((s) => s.id === ptySessionId);

  const handleOpenTerminal = () => {
    // ★심플 셸: 전용 터미널 모달(BeginnerAgentTerminalModal)로 넘긴다.
    // 상세 모달을 닫는 건 호출 쪽이 같이 하든(배타 선택) 여기서 onClose 하든
    // 같다 — 둘 다 idempotent 하다.
    if (onOpenAgentTerminal) {
      onOpenAgentTerminal(agent);
      onClose();
      return;
    }
    const icon = MODEL_ICONS[agent.model] || "⚪";
    setFocusedAgent(agent.id);
    openTerminalForSession(ptySessionId, `${icon} ${agent.name}`);
    onClose(); // Close modal to show terminal
  };

  // 이 티켓을 물고 있는 워커가 실제로 어떤 모델로 떴는지. 없으면(핀 없는
  // 스폰·구 doc) 배지 없이 기존 표시 그대로.
  const modelLabel = spawnedModelLabel(agent.spawnedModel);

  return (
    <div>
      <button
        type="button"
        data-testid="task-detail-view-terminal"
        onClick={handleOpenTerminal}
        title={
          modelLabel ? spawnedModelTitle(modelLabel, agent.model) : agent.model
        }
        className="flex items-center gap-2 rounded border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-blue-400 hover:bg-blue-500/20 transition-colors"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
        {MODEL_ICONS[agent.model] || "⚪"}{" "}
        {t("board.taskDetail.viewTerminal", { name: agent.name })}
        {modelLabel && (
          <span className="max-w-[160px] truncate rounded bg-black/30 px-1 py-px font-mono text-[10px] text-gray-400">
            {modelLabel}
          </span>
        )}
        {!hasSession && (
          <span className="text-[10px] text-gray-500">
            {t("board.taskDetail.connect")}
          </span>
        )}
      </button>
    </div>
  );
}

interface TaskDetailModalProps {
  task: Task;
  onClose: () => void;
  /**
   * 어드밴스드 터미널 탭 대신 **에이전트 터미널 오버레이**를 여는 표면이 넘긴다
   * (비기너 셸의 `BeginnerAgentTerminalModal`). 생략하면 기존처럼 터미널 탭을
   * 연다 — 칸반/작업내역/퀵레인 등 어드밴스드 표면은 그대로.
   */
  onOpenAgentTerminal?: (agent: Agent) => void;
}

export function TaskDetailModal({
  task,
  onClose,
  onOpenAgentTerminal,
}: TaskDetailModalProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const currentProject = useProjectStore((s) => s.currentProject);
  const worktrees = useWorktreeStore((s) => s.worktrees);
  const resolveWorktree = useWorktreeStore((s) => s.resolveWorktree);
  const ensureFreshWorktrees = useWorktreeStore((s) => s.ensureFresh);
  const worktreesLoading = useWorktreeStore((s) => s.loading);
  const agents = useAgentStore((s) => s.agents);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [detailTab, setDetailTab] = useState<DetailTab>("comments");
  const [diff, setDiff] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(task.title);
  const [editDescription, setEditDescription] = useState(
    task.description || "",
  );
  const [editPriority, setEditPriority] = useState(task.priority);
  const [deleting, setDeleting] = useState(false);
  // Outcome of an explicit "다시 찾기" click. "idle" is *not* a result — it
  // means the user hasn't asked yet — so a re-find that comes back empty must
  // land on its own state rather than reverting to the generic "no worktree"
  // line, which reads as "nothing happened".
  const [refind, setRefind] = useState<"idle" | "missed" | "error">("idle");
  const logEndRef = useRef<HTMLDivElement>(null);

  const nextStatuses = getNextStatuses(task.status);
  const roleColor =
    ROLE_COLORS[task.role] ?? "bg-gray-500/20 text-gray-400 border-gray-500/30";
  const taskWorktree = findTaskWorktree(worktrees, task);

  useEffect(() => {
    const unsubscribe = subscribeToActivities(task.id, setActivities);
    return unsubscribe;
  }, [task.id]);

  useEffect(() => {
    const unsubscribe = subscribeToComments(task.id, setComments);
    return unsubscribe;
  }, [task.id]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activities, comments]);

  useEffect(() => {
    setDiff(null);
    setDiffError(null);
    setDiffLoading(false);
    setRefind("idle");
  }, [task.id]);

  // Re-find: resolve this one worktree on demand. A miss and an IPC failure are
  // distinct outcomes and both are shown — neither may look like "no worktree,
  // as expected".
  const handleRefind = () => {
    setRefind("idle");
    resolveWorktree((list) => findTaskWorktree(list, task)).then(
      (worktree) => setRefind(worktree ? "idle" : "missed"),
      () => setRefind("error"),
    );
  };

  // Opening a ticket is the moment the user expects its worktree to exist —
  // don't resolve against a boot-time snapshot (worktrees are created mid-
  // session by agent dispatch). TTL-gated, so repeated opens are free.
  useEffect(() => {
    ensureFreshWorktrees().catch(() => {});
  }, [task.id, ensureFreshWorktrees]);

  const loadDiff = async () => {
    if (diffLoading) return;

    setDiffLoading(true);
    setDiffError(null);
    try {
      // Snapshot miss escalates to a single light re-enumeration (~0.14s), not
      // the full status sweep this used to call: the sweep enumerates the very
      // same worktrees and only adds per-worktree status probes, so it could
      // never find one the light path missed — it just spent 9.4–26s failing,
      // on precisely the path the user hits when a ticket's worktree is
      // missing (ticket jSVKHpBzjvWUQHlmXBU0).
      const worktree = await resolveWorktree((list) =>
        findTaskWorktree(list, task),
      );

      if (!worktree) {
        throw new Error(t("board.taskDetail.worktreeNotFound"));
      }

      const loadedDiff = await window.electronAPI.board.worktreeDiff({
        taskId: task.id,
        worktreePath: worktree.path,
        baseRef: worktree.baseRef,
      });
      setDiff(loadedDiff);
    } catch (err) {
      setDiffError(getErrorMessage(err, t("board.taskDetail.diffLoadFailed")));
    } finally {
      setDiffLoading(false);
    }
  };

  useEffect(() => {
    if (detailTab === "diff" && diff === null && !diffLoading && !diffError) {
      void loadDiff();
    }
  });

  const handleStatusChange = async (newStatus: TaskStatus) => {
    setStatusUpdating(true);
    try {
      await updateTaskStatus(task.id, newStatus);
      // Notify assigned agent about status change
      if (task.claimedBy) {
        const isCancelled = newStatus === "BLOCKED" || newStatus === "FAILED";
        window.electronAPI.bridge
          .injectMessage({
            targetAgent: task.claimedBy,
            tag: isCancelled ? "Task Cancelled" : "Task Status Changed",
            message: `상태 변경: ${task.status} → ${newStatus}`,
            taskId: task.id,
            taskTitle: task.title,
          })
          .catch(() => {});
      }
    } catch (err) {
      console.error("Failed to update status:", err);
    } finally {
      setStatusUpdating(false);
    }
  };

  const handleSendActivity = async () => {
    if (!newMessage.trim() || sending) return;
    setSending(true);
    try {
      if (detailTab === "comments") {
        await addComment(
          task.id,
          currentProject?.id || task.projectId,
          user?.uid || "anonymous",
          user?.displayName || "User",
          user?.photoURL || "",
          newMessage.trim(),
        );
      } else {
        await addActivity(task.id, "pm", newMessage.trim());
      }
      // Inject PM feedback into agent PTY (both comments and activity)
      if (task.claimedBy) {
        await updateTask(task.id, { hasPmFeedback: true });
        window.electronAPI.bridge
          .injectMessage({
            targetAgent: task.claimedBy,
            tag: "PM Feedback",
            message: newMessage.trim(),
            taskId: task.id,
            taskTitle: task.title,
          })
          .catch((err) => console.error("[PM Feedback] inject failed:", err));
      }
      setNewMessage("");
    } catch (err) {
      console.error("Failed to send:", err);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendActivity();
    }
  };

  const handleSaveEdit = async () => {
    if (!editTitle.trim()) return;
    try {
      const changes: string[] = [];
      if (editTitle.trim() !== task.title)
        changes.push(`제목: "${task.title}" → "${editTitle.trim()}"`);
      if (editDescription.trim() !== (task.description || ""))
        changes.push("설명 변경됨");
      if (editPriority !== task.priority)
        changes.push(`우선순위: ${task.priority} → ${editPriority}`);

      await updateTask(task.id, {
        title: editTitle.trim(),
        description: editDescription.trim(),
        priority: editPriority,
      });
      setEditing(false);

      // Notify assigned agent about changes
      if (task.claimedBy && changes.length > 0) {
        const isPriorityOnly =
          changes.length === 1 && editPriority !== task.priority;
        window.electronAPI.bridge
          .injectMessage({
            targetAgent: task.claimedBy,
            tag: isPriorityOnly ? "Priority Changed" : "Task Updated",
            message: changes.join("\n"),
            taskId: task.id,
            taskTitle: editTitle.trim(),
          })
          .catch(() => {});
      }
    } catch (err) {
      console.error("Failed to update task:", err);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteTask(task.id);
      onClose();
    } catch (err) {
      console.error("Failed to delete task:", err);
      setDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] rounded-lg bg-gray-800 border border-gray-700 shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-gray-700 px-5 py-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-gray-100 mb-2">
              {task.title}
            </h2>
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`inline-flex rounded px-2 py-0.5 text-xs font-medium text-white ${
                  STATUS_COLORS[task.status]
                }`}
              >
                {task.status}
              </span>
              <span
                className={`inline-flex rounded border px-2 py-0.5 text-xs font-medium ${roleColor}`}
              >
                {task.role}
              </span>
              <span className="text-xs text-gray-500">
                Priority: {task.priority}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1 ml-3 flex-shrink-0">
            <button
              onClick={() => setEditing(!editing)}
              className={`p-1.5 rounded transition-colors ${
                editing
                  ? "text-blue-400 bg-blue-500/20"
                  : "text-gray-400 hover:text-gray-200"
              }`}
              title={t("board.taskDetail.edit")}
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                />
              </svg>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-gray-200 transition-colors"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Edit Form */}
          {editing ? (
            <div className="rounded border border-blue-500/30 bg-blue-500/5 p-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-400 uppercase mb-1">
                  {t("board.taskDetail.titleLabel")}
                </label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full rounded bg-gray-700 border border-gray-600 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 uppercase mb-1">
                  {t("board.taskDetail.descriptionLabel")}
                </label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={4}
                  className="w-full rounded bg-gray-700 border border-gray-600 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none resize-none"
                  placeholder={t("board.taskDetail.descriptionPlaceholder")}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 uppercase mb-1">
                  {t("board.taskDetail.priorityLabel")}
                </label>
                <select
                  value={editPriority}
                  onChange={(e) => setEditPriority(Number(e.target.value))}
                  className="rounded bg-gray-700 border border-gray-600 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
                >
                  {[5, 4, 3, 2, 1].map((p) => (
                    <option key={p} value={p}>
                      P{p}{" "}
                      {p === 5
                        ? t("board.taskDetail.priorityUrgent")
                        : p === 1
                          ? t("board.taskDetail.priorityLow")
                          : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center justify-between pt-1">
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium text-red-400 border border-red-600/30 bg-red-600/10 hover:bg-red-600/20 transition-colors disabled:opacity-50"
                >
                  <svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                  {deleting
                    ? t("board.taskDetail.deleting")
                    : t("board.taskDetail.deleteTask")}
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setEditing(false);
                      setEditTitle(task.title);
                      setEditDescription(task.description || "");
                      setEditPriority(task.priority);
                    }}
                    className="rounded px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
                  >
                    {t("board.taskDetail.cancel")}
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    className="rounded bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-500 transition-colors"
                  >
                    {t("board.taskDetail.save")}
                  </button>
                </div>
              </div>
            </div>
          ) : /* Body (read-only, structured sections) */
          hasAnyBody(task) ? (
            <TaskBodySections task={task} />
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="w-full rounded border border-dashed border-gray-600 py-3 text-xs text-gray-500 hover:border-gray-500 hover:text-gray-400 transition-colors"
            >
              {t("board.taskDetail.addDescription")}
            </button>
          )}

          {/* Assign Agent */}
          <AgentAssign taskId={task.id} claimedBy={task.claimedBy} />

          {/* View this task's worktree — switches the left file tree + selects
              the agent in the bottom panel, no full-pane takeover. When no
              worktree matches, say so instead of rendering nothing: a silent
              miss reads as "the feature doesn't exist". */}
          {taskWorktree ? (
            <ViewWorktreeButton
              worktree={taskWorktree}
              agentId={resolveTaskAgentId(agents, task)}
              onClose={onClose}
            />
          ) : (
            <div
              className="flex items-center gap-2 rounded border border-gray-700/60 bg-gray-800/40 px-3 py-2 text-xs text-gray-500"
              title={t("board.taskDetail.noWorktreeTip")}
            >
              <span
                className={
                  !worktreesLoading && refind === "error"
                    ? "text-red-400"
                    : undefined
                }
              >
                {worktreesLoading
                  ? t("board.taskDetail.worktreeSearching")
                  : refind === "missed"
                    ? t("board.taskDetail.worktreeStillMissing")
                    : refind === "error"
                      ? t("board.taskDetail.worktreeRefindFailed")
                      : t("board.taskDetail.noWorktree")}
              </span>
              {!worktreesLoading && (
                <button
                  type="button"
                  onClick={handleRefind}
                  className="rounded px-1.5 py-0.5 text-gray-400 underline decoration-dotted underline-offset-2 hover:text-gray-200 transition-colors"
                >
                  {t("board.taskDetail.worktreeRefind")}
                </button>
              )}
            </div>
          )}

          {/* Open Agent Terminal */}
          <AgentTerminalButton
            claimedBy={task.claimedBy}
            onClose={onClose}
            onOpenAgentTerminal={onOpenAgentTerminal}
          />

          {/* Meta */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-gray-500">Claimed By:</span>{" "}
              <span className="text-gray-300">
                {task.claimedBy || "Unclaimed"}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Project:</span>{" "}
              <span className="text-gray-300 text-xs">{task.projectId}</span>
            </div>
            <div>
              <span className="text-gray-500">Created:</span>{" "}
              <span className="text-gray-300">
                {formatDate(task.createdAt)}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Updated:</span>{" "}
              <span className="text-gray-300">
                {formatDate(task.updatedAt)}
              </span>
            </div>
          </div>

          {/* Scope */}
          {Array.isArray(task.scope) && task.scope.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-gray-400 uppercase mb-1">
                Scope
              </h3>
              <div className="flex flex-wrap gap-1">
                {task.scope.map((s, i) => (
                  <span
                    key={i}
                    className="rounded bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 text-xs text-blue-400"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Dependencies */}
          {Array.isArray(task.dependsOn) && task.dependsOn.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-gray-400 uppercase mb-1">
                Dependencies
              </h3>
              <div className="flex flex-wrap gap-1">
                {task.dependsOn.map((depId) => (
                  <span
                    key={depId}
                    className="rounded bg-gray-700 px-2 py-0.5 text-xs text-gray-400"
                  >
                    🔗 {depId.slice(0, 8)}...
                  </span>
                ))}
              </div>
              <span
                className={`text-xs mt-1 inline-block ${
                  task.dependsOnCompleted ? "text-green-400" : "text-yellow-400"
                }`}
              >
                {task.dependsOnCompleted
                  ? "✓ All dependencies completed"
                  : "⏳ Waiting on dependencies"}
              </span>
            </div>
          )}

          {/* PR URL */}
          {task.prUrl && (
            <div>
              <h3 className="text-xs font-medium text-gray-400 uppercase mb-1">
                Pull Request
              </h3>
              <a
                href={task.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-400 hover:underline"
              >
                {task.prUrl}
              </a>
            </div>
          )}

          {/* Comment */}
          {task.comment && (
            <div>
              <h3 className="text-xs font-medium text-gray-400 uppercase mb-1">
                Comment
              </h3>
              <div className="rounded bg-gray-700/50 px-3 py-2 text-sm text-gray-300">
                {task.comment}
              </div>
            </div>
          )}

          {/* Status Actions */}
          {nextStatuses.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-gray-400 uppercase mb-2">
                Actions
              </h3>
              <div className="flex flex-wrap gap-2">
                {nextStatuses.map((st) => (
                  <button
                    key={st}
                    onClick={() => handleStatusChange(st)}
                    disabled={statusUpdating}
                    className={`rounded px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 ${STATUS_BUTTON_COLORS[st]}`}
                  >
                    → {st}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Comments / Activity Tabs */}
          <div>
            <div className="flex items-center gap-1 mb-2">
              <button
                onClick={() => setDetailTab("comments")}
                className={`px-3 py-1 text-xs font-semibold uppercase rounded-t transition-colors ${
                  detailTab === "comments"
                    ? "bg-gray-900/50 text-green-400 border-b-2 border-green-500"
                    : "text-gray-500 hover:text-gray-400"
                }`}
              >
                Comments ({comments.length})
              </button>
              <button
                onClick={() => setDetailTab("activity")}
                className={`px-3 py-1 text-xs font-semibold uppercase rounded-t transition-colors ${
                  detailTab === "activity"
                    ? "bg-gray-900/50 text-yellow-400 border-b-2 border-yellow-500"
                    : "text-gray-500 hover:text-gray-400"
                }`}
              >
                Activity ({activities.length})
              </button>
              <button
                onClick={() => setDetailTab("diff")}
                className={`px-3 py-1 text-xs font-semibold uppercase rounded-t transition-colors ${
                  detailTab === "diff"
                    ? "bg-gray-900/50 text-blue-400 border-b-2 border-blue-500"
                    : "text-gray-500 hover:text-gray-400"
                }`}
              >
                {t("board.taskDetail.diffTab")}
              </button>
            </div>

            <div
              className={`rounded bg-gray-900/50 border border-gray-700/50 ${
                detailTab === "diff" ? "p-2" : "max-h-64 overflow-y-auto"
              }`}
            >
              {detailTab === "diff" ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3 px-1">
                    <div className="min-w-0 text-xs text-gray-500">
                      {taskWorktree ? (
                        <>
                          <span className="text-gray-400">branch </span>
                          <span className="font-mono text-blue-300">
                            {taskWorktree.branch}
                          </span>
                        </>
                      ) : (
                        t("board.taskDetail.lookingUpWorktree")
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setDiff(null);
                        void loadDiff();
                      }}
                      disabled={diffLoading}
                      className="flex-shrink-0 rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-50"
                    >
                      {t("board.taskDetail.refresh")}
                    </button>
                  </div>
                  <DiffViewer
                    diff={diff ?? ""}
                    loading={diffLoading}
                    error={diffError}
                    onRetry={loadDiff}
                  />
                </div>
              ) : detailTab === "comments" ? (
                /* Comments Tab */
                comments.length === 0 ? (
                  <div className="px-3 py-4 text-center text-xs text-gray-600">
                    No comments yet
                  </div>
                ) : (
                  <div className="divide-y divide-gray-700/30">
                    {comments.map((comment) => (
                      <div
                        key={comment.id}
                        className="border-l-2 border-green-500/50 px-3 py-2"
                      >
                        <div className="flex items-center gap-2 mb-0.5">
                          {comment.authorPhotoURL ? (
                            <img
                              src={comment.authorPhotoURL}
                              alt=""
                              className="h-4 w-4 rounded-full"
                            />
                          ) : (
                            <div className="flex h-4 w-4 items-center justify-center rounded-full bg-green-600 text-[8px] font-bold text-white">
                              {comment.authorName.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <span className="text-xs font-medium text-green-400">
                            {comment.authorName}
                          </span>
                          <span className="ml-auto text-xs text-gray-600">
                            {timeAgo(comment.createdAt)}
                          </span>
                        </div>
                        <p className="text-sm text-gray-300">
                          {comment.content}
                        </p>
                      </div>
                    ))}
                  </div>
                )
              ) : /* Activity Tab */
              activities.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-gray-600">
                  No activities yet
                </div>
              ) : (
                <div className="divide-y divide-gray-700/30">
                  {activities.map((act) => (
                    <div
                      key={act.id}
                      className={`px-3 py-2 ${
                        act.agentId === "pm"
                          ? "border-l-2 border-yellow-500 bg-yellow-500/5"
                          : act.agentId === "system"
                            ? "bg-gray-700/20"
                            : "border-l-2 border-blue-500/50"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <span
                          className={`text-xs font-medium ${
                            act.agentId === "pm"
                              ? "text-yellow-400"
                              : "text-gray-400"
                          }`}
                        >
                          {act.agentId}
                        </span>
                        <span className="text-xs text-gray-600">
                          {timeAgo(act.createdAt)}
                        </span>
                      </div>
                      <p className="text-sm text-gray-300">{act.message}</p>
                    </div>
                  ))}
                </div>
              )}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>

        {/* Activity Input */}
        {detailTab !== "diff" && (
          <div className="border-t border-gray-700 px-5 py-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  detailTab === "comments"
                    ? "Add comment..."
                    : "Add PM activity..."
                }
                className={`flex-1 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none ${
                  detailTab === "comments"
                    ? "bg-green-500/5 border border-green-500/20 focus:border-green-500/50"
                    : "bg-yellow-500/5 border border-yellow-500/20 focus:border-yellow-500/50"
                }`}
              />
              <button
                onClick={handleSendActivity}
                disabled={!newMessage.trim() || sending}
                className={`rounded px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
                  detailTab === "comments"
                    ? "bg-green-600 hover:bg-green-500"
                    : "bg-yellow-600 hover:bg-yellow-500"
                }`}
              >
                Send
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
