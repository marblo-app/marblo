import { useState, useRef, useEffect } from "react";
import { useTaskStore } from "../../stores/taskStore";
import { useProjectStore } from "../../stores/projectStore";
import { useTranslation } from "../../lib/i18n";
import { TaskPreview } from "./TaskPreview";
import { DecompositionResult } from "./DecompositionResult";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  result?: {
    projectName: string;
    tasks: DecomposedTaskDTO[];
    dag: { nodes: string[]; edges: [string, string][] };
    layers: number[][];
  };
}

interface OrchestratorChatProps {
  onClose: () => void;
}

export function OrchestratorChat({ onClose }: OrchestratorChatProps) {
  const { t } = useTranslation();
  const currentProject = useProjectStore((s) => s.currentProject);
  const createTask = useTaskStore((s) => s.createTask);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editableTasks, setEditableTasks] = useState<
    DecomposedTaskDTO[] | null
  >(null);
  const [editableDag, setEditableDag] = useState<{
    nodes: string[];
    edges: [string, string][];
  } | null>(null);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Whether the user is currently parked near the bottom of the log.
  // Captured on scroll (i.e. before new streamed content arrives) so that
  // scrolling up to read past logs suppresses the auto-scroll. Defaults to
  // true so the first messages stick to the bottom.
  const isAtBottomRef = useRef(true);

  const handleScroll = () => {
    const el = messagesContainerRef.current;
    if (!el) return;
    isAtBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el || !isAtBottomRef.current) return;
    // Set scrollTop directly (instant) on the message container itself —
    // avoids smooth-animation accumulation during streaming and prevents the
    // scroll from propagating to ancestor scroll containers (the whole panel).
    el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);
    setEditableTasks(null);
    setEditableDag(null);

    try {
      const result = await window.electronAPI.orchestrator.decompose(text);
      const layers = computeLayers(result.tasks, result.dag);

      setEditableTasks(result.tasks);
      setEditableDag(result.dag);

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: t("orchestrator.chat.decomposed", {
            project: result.projectName,
            count: result.tasks.length,
            layers: layers.length,
          }),
          result: {
            projectName: result.projectName,
            tasks: result.tasks,
            dag: result.dag,
            layers,
          },
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: t("orchestrator.chat.error", {
            error:
              err instanceof Error
                ? err.message
                : t("orchestrator.chat.unknownError"),
          }),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAll = async () => {
    if (!editableTasks || !currentProject || creating) return;
    setCreating(true);

    try {
      for (const task of editableTasks) {
        await createTask({
          projectId: currentProject.id,
          contextId: "board",
          title: task.title,
          description: task.description,
          status: "TODO",
          role: task.role,
          priority: task.priority,
          dependsOn: task.depends_on,
          dependsOnCompleted: false,
          claimedBy: null,
          claimedAt: null,
          scope: task.scope,
          comment: "",
          prUrl: "",
          hasPmFeedback: false,
        });
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: t("orchestrator.chat.created", {
            count: editableTasks.length,
          }),
        },
      ]);
      setEditableTasks(null);
      setEditableDag(null);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: t("orchestrator.chat.createError", {
            error:
              err instanceof Error
                ? err.message
                : t("orchestrator.chat.unknownError"),
          }),
        },
      ]);
    } finally {
      setCreating(false);
    }
  };

  const handleTasksUpdate = (updated: DecomposedTaskDTO[]) => {
    setEditableTasks(updated);
    // Rebuild DAG for updated tasks
    const nodes = updated.map(
      (_, i) => `TASK-${String(i + 1).padStart(3, "0")}`
    );
    const edges: [string, string][] = [];
    for (let i = 0; i < updated.length; i++) {
      const nodeId = nodes[i];
      for (const dep of updated[i].depends_on) {
        edges.push([dep.toUpperCase(), nodeId]);
      }
    }
    setEditableDag({ nodes, edges });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="relative flex h-[85vh] w-full max-w-3xl flex-col rounded-lg border border-gray-700 bg-gray-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
          <div className="flex items-center gap-2">
            <svg
              className="h-5 w-5 text-blue-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
            <h2 className="text-sm font-semibold text-white">
              {t("orchestrator.aiDecompose")}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-white"
          >
            <svg
              className="h-5 w-5"
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

        {/* Messages */}
        <div
          ref={messagesContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-4 space-y-4"
        >
          {messages.length === 0 && (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <svg
                  className="mx-auto h-12 w-12 text-gray-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
                <p className="mt-3 text-sm text-gray-400">
                  {t("orchestrator.chat.emptyTitle")}
                </p>
                <p className="mt-1 text-xs text-gray-600">
                  {t("orchestrator.chat.emptySubtitle")}
                </p>
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${
                msg.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-4 py-2.5 ${
                  msg.role === "user"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-800 text-gray-200"
                }`}
              >
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>

                {msg.result && (
                  <div className="mt-3">
                    <DecompositionResult
                      projectName={msg.result.projectName}
                      tasks={msg.result.tasks}
                      dag={msg.result.dag}
                      layers={msg.result.layers}
                    />
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="rounded-lg bg-gray-800 px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-600 border-t-blue-400" />
                  <span className="text-sm text-gray-400">
                    {t("orchestrator.chat.decomposing")}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Editable Task Preview */}
        {editableTasks && editableDag && (
          <div className="border-t border-gray-700 max-h-[40vh] overflow-y-auto p-4">
            <TaskPreview
              tasks={editableTasks}
              dag={editableDag}
              onUpdate={handleTasksUpdate}
              onCreateAll={handleCreateAll}
              creating={creating}
            />
          </div>
        )}

        {/* Input */}
        <form onSubmit={handleSubmit} className="border-t border-gray-700 p-4">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("orchestrator.chat.inputPlaceholder")}
              rows={2}
              className="flex-1 resize-none rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="rounded-lg bg-blue-600 p-2 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                />
              </svg>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Compute parallel execution layers from DAG using Kahn's algorithm */
function computeLayers(
  tasks: DecomposedTaskDTO[],
  dag: { nodes: string[]; edges: [string, string][] }
): number[][] {
  const n = tasks.length;
  if (n === 0) return [];

  const inDegree = new Array(n).fill(0);
  const adj: number[][] = Array.from({ length: n }, () => []);

  for (const [from, to] of dag.edges) {
    const fi = parseInt(from.replace(/^TASK-/i, ""), 10) - 1;
    const ti = parseInt(to.replace(/^TASK-/i, ""), 10) - 1;
    if (fi >= 0 && fi < n && ti >= 0 && ti < n) {
      adj[fi].push(ti);
      inDegree[ti]++;
    }
  }

  const layers: number[][] = [];
  let queue = inDegree.map((d, i) => (d === 0 ? i : -1)).filter((i) => i >= 0);

  while (queue.length > 0) {
    layers.push(queue);
    const next: number[] = [];
    for (const node of queue) {
      for (const neighbor of adj[node]) {
        inDegree[neighbor]--;
        if (inDegree[neighbor] === 0) {
          next.push(neighbor);
        }
      }
    }
    queue = next;
  }

  return layers;
}
