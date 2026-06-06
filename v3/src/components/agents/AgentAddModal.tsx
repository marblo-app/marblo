import { useState } from "react";
import type { ModelType } from "../../types/agent";
import type { Task } from "../../types/task";
import { useEditorStore } from "../../stores/editorStore";

interface AgentAddModalProps {
  projectId: string;
  ownerId: string;
  tasks?: Task[];
  onLaunch: (data: {
    name: string;
    model: ModelType;
    role: string;
    command: string;
    cwd: string;
    initialPrompt?: string;
    assignedTaskId?: string;
  }) => Promise<void>;
  onClose: () => void;
}

const MODEL_OPTIONS: {
  value: ModelType;
  label: string;
  icon: string;
  command: string;
  color: string;
  hint?: string;
}[] = [
  {
    value: "claude",
    label: "Claude Code",
    icon: "🟣",
    command: "claude",
    color: "#a855f7",
  },
  {
    value: "gpt",
    label: "Codex CLI (OpenAI)",
    icon: "🟢",
    command: "codex",
    color: "#10a37f",
  },
  {
    value: "antigravity",
    label: "Antigravity (agy)",
    icon: "🟠",
    command: "agy",
    color: "#f97316",
  },
  {
    value: "local",
    label: "Local Model (Ollama 등)",
    icon: "⚫",
    command: "ollama",
    color: "#737373",
    hint: "CLI 명령어를 ollama / lms / llama 등 본인 환경에 맞게 변경",
  },
  {
    value: "custom",
    label: "Custom (직접 입력)",
    icon: "⚪",
    command: "",
    color: "#6b7280",
  },
];

const ROLES = [
  "Backend",
  "Frontend",
  "Fullstack",
  "DevOps",
  "QA",
  "Data",
  "Design",
  "Other",
];

export default function AgentAddModal({
  tasks = [],
  onLaunch,
  onClose,
}: AgentAddModalProps) {
  // 사이드바에서 선택된 프로젝트 폴더를 기본 작업 디렉토리로 사용
  const rootPath = useEditorStore((s) => s.rootPath);

  const [name, setName] = useState("");
  const [model, setModel] = useState<ModelType>("claude");
  const [role, setRole] = useState("Backend");
  const [command, setCommand] = useState("claude");
  const [cwd, setCwd] = useState(rootPath || "");
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");
  const [launching, setLaunching] = useState(false);

  // Available tasks (TODO or CLAIMED, not already done)
  const availableTasks = tasks.filter(
    (t) => t.status === "TODO" || t.status === "CLAIMED",
  );

  const handleModelChange = (m: ModelType) => {
    setModel(m);
    const opt = MODEL_OPTIONS.find((o) => o.value === m);
    if (opt) setCommand(opt.command);
  };

  const handleLaunch = async () => {
    if (!name.trim() || !command.trim() || !cwd.trim()) return;
    setLaunching(true);

    // Build initial prompt from selected task or custom prompt
    let initialPrompt: string | undefined;
    const selectedTask = availableTasks.find((t) => t.id === selectedTaskId);
    if (selectedTask) {
      initialPrompt = `You are a ${role} agent. Your task:\n\nTitle: ${
        selectedTask.title
      }\nDescription: ${
        selectedTask.description || "No description"
      }\nPriority: ${
        selectedTask.priority
      }\n\nUse the Marblo MCP tools to update task status as you work. Task ID: ${
        selectedTask.id
      }\nStart by claiming the task with claim_task, then update status to IN_PROGRESS.`;
    } else if (customPrompt.trim()) {
      initialPrompt = `You are a ${role} agent. ${customPrompt.trim()}`;
    }

    try {
      await onLaunch({
        name: name.trim(),
        model,
        role,
        command: command.trim(),
        cwd: cwd.trim(),
        initialPrompt,
        assignedTaskId: selectedTaskId || undefined,
      });
      onClose();
    } catch {
      setLaunching(false);
    }
  };

  const isValid = name.trim() && command.trim() && cwd.trim();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-gray-800 shadow-2xl border border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-gray-100">New Agent</h2>
          <button
            className="text-gray-400 hover:text-gray-200 transition-colors"
            onClick={onClose}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M4 4l10 10M14 4L4 14" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              이름
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Backend-1"
              className="w-full rounded bg-gray-700 border border-gray-600 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Model Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              모델 선택
            </label>
            <div className="space-y-1.5">
              {MODEL_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded text-sm text-left transition-colors ${
                    model === opt.value
                      ? "bg-gray-600 border border-gray-500 text-gray-100"
                      : "bg-gray-750 border border-gray-700 text-gray-400 hover:bg-gray-700 hover:text-gray-300"
                  }`}
                  style={
                    model === opt.value
                      ? { borderLeftColor: opt.color, borderLeftWidth: 3 }
                      : undefined
                  }
                  onClick={() => handleModelChange(opt.value)}
                >
                  <span className="text-lg">{opt.icon}</span>
                  <span className="flex-1">{opt.label}</span>
                  {opt.hint && model === opt.value && (
                    <span className="text-[10px] text-gray-500 truncate max-w-[55%]">
                      {opt.hint}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Role */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              역할
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full rounded bg-gray-700 border border-gray-600 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          {/* CLI Command */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              CLI 명령어
              <span className="ml-1 text-xs text-gray-500">
                (모델에 따라 자동 설정, 수동 변경 가능)
              </span>
            </label>
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="claude"
              className="w-full rounded bg-gray-700 border border-gray-600 px-3 py-2 text-sm text-gray-100 font-mono placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Working Directory */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              작업 디렉토리
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder="/path/to/project"
                className="flex-1 rounded bg-gray-700 border border-gray-600 px-3 py-2 text-sm text-gray-100 font-mono placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={async () => {
                  try {
                    const dir = await window.electronAPI.fs.selectDirectory();
                    if (dir) setCwd(dir);
                  } catch {
                    /* user cancelled */
                  }
                }}
                className="flex-shrink-0 rounded bg-gray-600 border border-gray-500 px-3 py-2 text-sm text-gray-300 hover:bg-gray-500 transition-colors"
                title="폴더 선택"
              >
                📁
              </button>
            </div>
          </div>

          {/* Task Assignment */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              태스크 할당
              <span className="ml-1 text-xs text-gray-500">(선택)</span>
            </label>
            {availableTasks.length > 0 ? (
              <select
                value={selectedTaskId}
                onChange={(e) => setSelectedTaskId(e.target.value)}
                className="w-full rounded bg-gray-700 border border-gray-600 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">태스크 없이 시작 (대화형)</option>
                {availableTasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    [{t.status}] {t.title} (P{t.priority})
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-xs text-gray-500">
                할당 가능한 태스크가 없습니다. 보드에서 먼저 태스크를
                생성하세요.
              </p>
            )}
          </div>

          {/* Custom Prompt (when no task selected) */}
          {!selectedTaskId && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                초기 프롬프트
                <span className="ml-1 text-xs text-gray-500">
                  (선택, 비우면 대화형으로 시작)
                </span>
              </label>
              <textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="에이전트에게 시킬 작업을 입력하세요..."
                rows={2}
                className="w-full rounded bg-gray-700 border border-gray-600 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-700">
          <button
            className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
            onClick={onClose}
            disabled={launching}
          >
            Cancel
          </button>
          <button
            className="px-4 py-2 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            onClick={handleLaunch}
            disabled={!isValid || launching}
          >
            {launching ? (
              <span className="flex items-center gap-2">
                <svg
                  className="animate-spin h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                Launching...
              </span>
            ) : (
              "Launch Agent"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
