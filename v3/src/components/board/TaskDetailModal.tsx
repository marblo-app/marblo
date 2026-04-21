import { useEffect, useRef, useState } from 'react';
import type { Task, TaskStatus } from '../../types/task';
import type { Activity } from '../../types/activity';
import type { TaskComment } from '../../types/chat';
import { updateTask, updateTaskStatus, deleteTask } from '../../services/taskService';
import { addActivity, subscribeToActivities } from '../../services/activityService';
import { addComment, subscribeToComments } from '../../services/commentService';
import { getNextStatuses } from '../../services/stateMachine';
import { useAgentStore } from '../../stores/agentStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { useProjectStore } from '../../stores/projectStore';
import { useAuth } from '../../hooks/useAuth';

type DetailTab = 'comments' | 'activity';

const STATUS_COLORS: Record<TaskStatus, string> = {
  TODO: 'bg-gray-600',
  CLAIMED: 'bg-yellow-600',
  IN_PROGRESS: 'bg-blue-600',
  REVIEW: 'bg-purple-600',
  BLOCKED: 'bg-orange-600',
  FAILED: 'bg-red-600',
  DONE: 'bg-green-600',
};

const STATUS_BUTTON_COLORS: Record<TaskStatus, string> = {
  TODO: 'bg-gray-600 hover:bg-gray-500',
  CLAIMED: 'bg-yellow-600 hover:bg-yellow-500',
  IN_PROGRESS: 'bg-blue-600 hover:bg-blue-500',
  REVIEW: 'bg-purple-600 hover:bg-purple-500',
  BLOCKED: 'bg-orange-600 hover:bg-orange-500',
  FAILED: 'bg-red-600 hover:bg-red-500',
  DONE: 'bg-green-600 hover:bg-green-500',
};

const ROLE_COLORS: Record<string, string> = {
  backend: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  frontend: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  test: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  devops: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
};

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDate(date: Date): string {
  return date.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const MODEL_ICONS: Record<string, string> = {
  claude: '🟣', gemini: '🔵', gpt: '🟢', custom: '⚪',
};

function AgentAssign({ taskId, claimedBy }: { taskId: string; claimedBy: string | null }) {
  const agents = useAgentStore((s) => s.agents);

  if (agents.length === 0) return null;

  const handleAssign = async (agentName: string) => {
    const prevAgent = claimedBy;
    await updateTask(taskId, { claimedBy: agentName });
    // Notify new agent
    window.electronAPI.bridge.injectMessage({
      targetAgent: agentName,
      tag: 'Task Reassigned',
      message: `이 태스크가 당신에게 배정되었습니다.${prevAgent ? ` (이전: ${prevAgent})` : ''}`,
      taskId,
    }).catch(() => {});
    // Notify previous agent
    if (prevAgent) {
      window.electronAPI.bridge.injectMessage({
        targetAgent: prevAgent,
        tag: 'Task Reassigned',
        message: `이 태스크가 ${agentName}에게 재배정되었습니다. 작업을 중단하세요.`,
        taskId,
      }).catch(() => {});
    }
  };

  const handleUnassign = async () => {
    const prevAgent = claimedBy;
    await updateTask(taskId, { claimedBy: null });
    if (prevAgent) {
      window.electronAPI.bridge.injectMessage({
        targetAgent: prevAgent,
        tag: 'Task Reassigned',
        message: '이 태스크의 배정이 해제되었습니다. 작업을 중단하세요.',
        taskId,
      }).catch(() => {});
    }
  };

  return (
    <div>
      <h3 className="text-xs font-medium text-gray-400 uppercase mb-2">Assign Agent</h3>
      <div className="flex flex-wrap gap-2">
        {agents.map((agent) => {
          const isAssigned = claimedBy === agent.name || claimedBy === agent.id;
          return (
            <button
              key={agent.id}
              onClick={() => isAssigned ? handleUnassign() : handleAssign(agent.name)}
              className={`flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs transition-colors ${
                isAssigned
                  ? 'border-blue-500 bg-blue-500/20 text-blue-400'
                  : 'border-gray-600 bg-gray-700/50 text-gray-400 hover:border-gray-500 hover:text-gray-300'
              }`}
            >
              <span>{MODEL_ICONS[agent.model] || '⚪'}</span>
              <span>{agent.name}</span>
              {isAssigned && <span className="text-[10px]">✓</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AgentTerminalButton({ claimedBy, onClose }: { claimedBy: string | null; onClose: () => void }) {
  const agents = useAgentStore((s) => s.agents);
  const terminalSessions = useTerminalStore((s) => s.sessions);
  const attachSession = useTerminalStore((s) => s.attachSession);

  if (!claimedBy) return null;

  // Find matching agent
  const agent = agents.find((a) => a.name === claimedBy || a.id === claimedBy);
  if (!agent) return null;

  // Check if terminal session exists for this agent
  const ptySessionId = `agent-${agent.id}`;
  const hasSession = terminalSessions.some((s) => s.id === ptySessionId);

  const handleOpenTerminal = () => {
    const icon = MODEL_ICONS[agent.model] || '⚪';
    attachSession(ptySessionId, `${icon} ${agent.name}`);
    onClose(); // Close modal to show terminal
  };

  return (
    <div>
      <button
        onClick={handleOpenTerminal}
        className="flex items-center gap-2 rounded border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-blue-400 hover:bg-blue-500/20 transition-colors"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        {MODEL_ICONS[agent.model] || '⚪'} {agent.name} 터미널 보기
        {!hasSession && <span className="text-[10px] text-gray-500">(연결)</span>}
      </button>
    </div>
  );
}

interface TaskDetailModalProps {
  task: Task;
  onClose: () => void;
}

export function TaskDetailModal({ task, onClose }: TaskDetailModalProps) {
  const { user } = useAuth();
  const currentProject = useProjectStore((s) => s.currentProject);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [detailTab, setDetailTab] = useState<DetailTab>('comments');
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(task.title);
  const [editDescription, setEditDescription] = useState(task.description || '');
  const [editPriority, setEditPriority] = useState(task.priority);
  const [deleting, setDeleting] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const nextStatuses = getNextStatuses(task.status);
  const roleColor = ROLE_COLORS[task.role] ?? 'bg-gray-500/20 text-gray-400 border-gray-500/30';

  useEffect(() => {
    const unsubscribe = subscribeToActivities(task.id, setActivities);
    return unsubscribe;
  }, [task.id]);

  useEffect(() => {
    const unsubscribe = subscribeToComments(task.id, setComments);
    return unsubscribe;
  }, [task.id]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activities, comments]);

  const handleStatusChange = async (newStatus: TaskStatus) => {
    setStatusUpdating(true);
    try {
      await updateTaskStatus(task.id, newStatus);
      // Notify assigned agent about status change
      if (task.claimedBy) {
        const isCancelled = newStatus === 'BLOCKED' || newStatus === 'FAILED';
        window.electronAPI.bridge.injectMessage({
          targetAgent: task.claimedBy,
          tag: isCancelled ? 'Task Cancelled' : 'Task Status Changed',
          message: `상태 변경: ${task.status} → ${newStatus}`,
          taskId: task.id,
          taskTitle: task.title,
        }).catch(() => {});
      }
    } catch (err) {
      console.error('Failed to update status:', err);
    } finally {
      setStatusUpdating(false);
    }
  };

  const handleSendActivity = async () => {
    if (!newMessage.trim() || sending) return;
    setSending(true);
    try {
      if (detailTab === 'comments') {
        await addComment(
          task.id,
          currentProject?.id || task.projectId,
          user?.uid || 'anonymous',
          user?.displayName || 'User',
          user?.photoURL || '',
          newMessage.trim(),
        );
      } else {
        await addActivity(task.id, 'pm', newMessage.trim());
      }
      // Inject PM feedback into agent PTY (both comments and activity)
      if (task.claimedBy) {
        await updateTask(task.id, { hasPmFeedback: true });
        window.electronAPI.bridge.injectMessage({
          targetAgent: task.claimedBy,
          tag: 'PM Feedback',
          message: newMessage.trim(),
          taskId: task.id,
          taskTitle: task.title,
        }).catch((err) => console.error('[PM Feedback] inject failed:', err));
      }
      setNewMessage('');
    } catch (err) {
      console.error('Failed to send:', err);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendActivity();
    }
  };

  const handleSaveEdit = async () => {
    if (!editTitle.trim()) return;
    try {
      const changes: string[] = [];
      if (editTitle.trim() !== task.title) changes.push(`제목: "${task.title}" → "${editTitle.trim()}"`);
      if (editDescription.trim() !== (task.description || '')) changes.push('설명 변경됨');
      if (editPriority !== task.priority) changes.push(`우선순위: ${task.priority} → ${editPriority}`);

      await updateTask(task.id, {
        title: editTitle.trim(),
        description: editDescription.trim(),
        priority: editPriority,
      });
      setEditing(false);

      // Notify assigned agent about changes
      if (task.claimedBy && changes.length > 0) {
        const isPriorityOnly = changes.length === 1 && editPriority !== task.priority;
        window.electronAPI.bridge.injectMessage({
          targetAgent: task.claimedBy,
          tag: isPriorityOnly ? 'Priority Changed' : 'Task Updated',
          message: changes.join('\n'),
          taskId: task.id,
          taskTitle: editTitle.trim(),
        }).catch(() => {});
      }
    } catch (err) {
      console.error('Failed to update task:', err);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteTask(task.id);
      onClose();
    } catch (err) {
      console.error('Failed to delete task:', err);
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[85vh] rounded-lg bg-gray-800 border border-gray-700 shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-gray-700 px-5 py-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-gray-100 mb-2">{task.title}</h2>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium text-white ${STATUS_COLORS[task.status]}`}>
                {task.status}
              </span>
              <span className={`inline-flex rounded border px-2 py-0.5 text-xs font-medium ${roleColor}`}>
                {task.role}
              </span>
              <span className="text-xs text-gray-500">Priority: {task.priority}</span>
            </div>
          </div>
          <div className="flex items-center gap-1 ml-3 flex-shrink-0">
            <button
              onClick={() => setEditing(!editing)}
              className={`p-1.5 rounded transition-colors ${editing ? 'text-blue-400 bg-blue-500/20' : 'text-gray-400 hover:text-gray-200'}`}
              title="수정"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-gray-200 transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
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
                <label className="block text-xs font-medium text-gray-400 uppercase mb-1">제목</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full rounded bg-gray-700 border border-gray-600 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 uppercase mb-1">설명</label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={4}
                  className="w-full rounded bg-gray-700 border border-gray-600 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none resize-none"
                  placeholder="태스크 설명, 에이전트에게 전달할 상세 프롬프트..."
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 uppercase mb-1">우선순위</label>
                <select
                  value={editPriority}
                  onChange={(e) => setEditPriority(Number(e.target.value))}
                  className="rounded bg-gray-700 border border-gray-600 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
                >
                  {[5, 4, 3, 2, 1].map((p) => (
                    <option key={p} value={p}>P{p} {p === 5 ? '(긴급)' : p === 1 ? '(낮음)' : ''}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center justify-between pt-1">
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium text-red-400 border border-red-600/30 bg-red-600/10 hover:bg-red-600/20 transition-colors disabled:opacity-50"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  {deleting ? '삭제 중...' : '태스크 삭제'}
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setEditing(false);
                      setEditTitle(task.title);
                      setEditDescription(task.description || '');
                      setEditPriority(task.priority);
                    }}
                    className="rounded px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
                  >
                    취소
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    className="rounded bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-500 transition-colors"
                  >
                    저장
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* Description (read-only) */
            task.description ? (
              <div>
                <h3 className="text-xs font-medium text-gray-400 uppercase mb-1">Description</h3>
                <p className="text-sm text-gray-300 whitespace-pre-wrap">{task.description}</p>
              </div>
            ) : (
              <button
                onClick={() => setEditing(true)}
                className="w-full rounded border border-dashed border-gray-600 py-3 text-xs text-gray-500 hover:border-gray-500 hover:text-gray-400 transition-colors"
              >
                + 설명 추가 (클릭하여 편집)
              </button>
            )
          )}

          {/* Assign Agent */}
          <AgentAssign taskId={task.id} claimedBy={task.claimedBy} />

          {/* Open Agent Terminal */}
          <AgentTerminalButton claimedBy={task.claimedBy} onClose={onClose} />

          {/* Meta */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-gray-500">Claimed By:</span>{' '}
              <span className="text-gray-300">{task.claimedBy || 'Unclaimed'}</span>
            </div>
            <div>
              <span className="text-gray-500">Project:</span>{' '}
              <span className="text-gray-300 text-xs">{task.projectId}</span>
            </div>
            <div>
              <span className="text-gray-500">Created:</span>{' '}
              <span className="text-gray-300">{formatDate(task.createdAt)}</span>
            </div>
            <div>
              <span className="text-gray-500">Updated:</span>{' '}
              <span className="text-gray-300">{formatDate(task.updatedAt)}</span>
            </div>
          </div>

          {/* Scope */}
          {Array.isArray(task.scope) && task.scope.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-gray-400 uppercase mb-1">Scope</h3>
              <div className="flex flex-wrap gap-1">
                {task.scope.map((s, i) => (
                  <span key={i} className="rounded bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 text-xs text-blue-400">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Dependencies */}
          {Array.isArray(task.dependsOn) && task.dependsOn.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-gray-400 uppercase mb-1">Dependencies</h3>
              <div className="flex flex-wrap gap-1">
                {task.dependsOn.map((depId) => (
                  <span key={depId} className="rounded bg-gray-700 px-2 py-0.5 text-xs text-gray-400">
                    🔗 {depId.slice(0, 8)}...
                  </span>
                ))}
              </div>
              <span className={`text-xs mt-1 inline-block ${task.dependsOnCompleted ? 'text-green-400' : 'text-yellow-400'}`}>
                {task.dependsOnCompleted ? '✓ All dependencies completed' : '⏳ Waiting on dependencies'}
              </span>
            </div>
          )}

          {/* PR URL */}
          {task.prUrl && (
            <div>
              <h3 className="text-xs font-medium text-gray-400 uppercase mb-1">Pull Request</h3>
              <a href={task.prUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-400 hover:underline">
                {task.prUrl}
              </a>
            </div>
          )}

          {/* Comment */}
          {task.comment && (
            <div>
              <h3 className="text-xs font-medium text-gray-400 uppercase mb-1">Comment</h3>
              <div className="rounded bg-gray-700/50 px-3 py-2 text-sm text-gray-300">
                {task.comment}
              </div>
            </div>
          )}

          {/* Status Actions */}
          {nextStatuses.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-gray-400 uppercase mb-2">Actions</h3>
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
                onClick={() => setDetailTab('comments')}
                className={`px-3 py-1 text-xs font-semibold uppercase rounded-t transition-colors ${
                  detailTab === 'comments'
                    ? 'bg-gray-900/50 text-green-400 border-b-2 border-green-500'
                    : 'text-gray-500 hover:text-gray-400'
                }`}
              >
                Comments ({comments.length})
              </button>
              <button
                onClick={() => setDetailTab('activity')}
                className={`px-3 py-1 text-xs font-semibold uppercase rounded-t transition-colors ${
                  detailTab === 'activity'
                    ? 'bg-gray-900/50 text-yellow-400 border-b-2 border-yellow-500'
                    : 'text-gray-500 hover:text-gray-400'
                }`}
              >
                Activity ({activities.length})
              </button>
            </div>

            <div className="max-h-64 overflow-y-auto rounded bg-gray-900/50 border border-gray-700/50">
              {detailTab === 'comments' ? (
                /* Comments Tab */
                comments.length === 0 ? (
                  <div className="px-3 py-4 text-center text-xs text-gray-600">No comments yet</div>
                ) : (
                  <div className="divide-y divide-gray-700/30">
                    {comments.map((comment) => (
                      <div key={comment.id} className="border-l-2 border-green-500/50 px-3 py-2">
                        <div className="flex items-center gap-2 mb-0.5">
                          {comment.authorPhotoURL ? (
                            <img src={comment.authorPhotoURL} alt="" className="h-4 w-4 rounded-full" />
                          ) : (
                            <div className="flex h-4 w-4 items-center justify-center rounded-full bg-green-600 text-[8px] font-bold text-white">
                              {comment.authorName.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <span className="text-xs font-medium text-green-400">{comment.authorName}</span>
                          <span className="ml-auto text-xs text-gray-600">{timeAgo(comment.createdAt)}</span>
                        </div>
                        <p className="text-sm text-gray-300">{comment.content}</p>
                      </div>
                    ))}
                  </div>
                )
              ) : (
                /* Activity Tab */
                activities.length === 0 ? (
                  <div className="px-3 py-4 text-center text-xs text-gray-600">No activities yet</div>
                ) : (
                  <div className="divide-y divide-gray-700/30">
                    {activities.map((act) => (
                      <div
                        key={act.id}
                        className={`px-3 py-2 ${
                          act.agentId === 'pm'
                            ? 'border-l-2 border-yellow-500 bg-yellow-500/5'
                            : act.agentId === 'system'
                              ? 'bg-gray-700/20'
                              : 'border-l-2 border-blue-500/50'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-0.5">
                          <span className={`text-xs font-medium ${
                            act.agentId === 'pm' ? 'text-yellow-400' : 'text-gray-400'
                          }`}>
                            {act.agentId}
                          </span>
                          <span className="text-xs text-gray-600">{timeAgo(act.createdAt)}</span>
                        </div>
                        <p className="text-sm text-gray-300">{act.message}</p>
                      </div>
                    ))}
                  </div>
                )
              )}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>

        {/* Activity Input */}
        <div className="border-t border-gray-700 px-5 py-3">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={detailTab === 'comments' ? 'Add comment...' : 'Add PM activity...'}
              className={`flex-1 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none ${
                detailTab === 'comments'
                  ? 'bg-green-500/5 border border-green-500/20 focus:border-green-500/50'
                  : 'bg-yellow-500/5 border border-yellow-500/20 focus:border-yellow-500/50'
              }`}
            />
            <button
              onClick={handleSendActivity}
              disabled={!newMessage.trim() || sending}
              className={`rounded px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
                detailTab === 'comments'
                  ? 'bg-green-600 hover:bg-green-500'
                  : 'bg-yellow-600 hover:bg-yellow-500'
              }`}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
