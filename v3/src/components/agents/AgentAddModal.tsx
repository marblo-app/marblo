import { useEffect, useState } from "react";
import type { ModelType } from "../../types/agent";
import type { Task } from "../../types/task";
import { useEditorStore } from "../../stores/editorStore";
import { useTranslation } from "../../lib/i18n";

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
    /**
     * 구체 모델 핀(`<modelId>`) — 현재는 local(Ollama)에서만 쓴다. `ollama list`
     * 실측 목록에서 고른 값만 들어오므로 미설치 id 가 핀되는 일이 없다
     * (유령비용 방지). 메인 프로세스가 레지스트리로 재검증한다.
     */
    modelPin?: string;
  }) => Promise<void>;
  onClose: () => void;
}

const MODEL_OPTIONS: {
  value: ModelType;
  label: string;
  icon: string;
  command: string;
  color: string;
  hint?: boolean;
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
    value: "grok",
    label: "Grok Build (xAI)",
    icon: "🔷",
    command: "grok",
    color: "#06b6d4",
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
    label: "Local Model",
    icon: "⚫",
    command: "ollama",
    color: "#737373",
    hint: true,
  },
  {
    value: "custom",
    label: "Custom",
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
  const { t } = useTranslation();
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
  // local(Ollama) 전용: `ollama list` 실측 목록. null = 아직 미조회.
  const [localModels, setLocalModels] = useState<string[] | null>(null);
  const [selectedLocalModel, setSelectedLocalModel] = useState("");

  // local 선택 시에만 설치된 로컬 모델을 실측한다 — 이 목록이 곧 핀 후보의
  // 전부다(스토어 pull 완료분 포함, 미설치 id 는 후보에 없다).
  useEffect(() => {
    if (model !== "local" || localModels !== null) return;
    let cancelled = false;
    void window.electronAPI.localModels
      .info()
      .then((info) => {
        if (cancelled) return;
        setLocalModels(info.installedIds);
        setSelectedLocalModel((prev) => prev || (info.installedIds[0] ?? ""));
      })
      .catch(() => {
        if (!cancelled) setLocalModels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [model, localModels]);

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
        // local 은 설치 실측 목록에서 고른 모델만 핀한다. 다른 모델 타입은
        // 종전대로 핀 없음(complexity 티어 정책 / CLI 기본 모델).
        modelPin:
          model === "local" && selectedLocalModel
            ? selectedLocalModel
            : undefined,
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
              {t("agents.addModal.name")}
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
              {t("agents.addModal.modelSelect")}
            </label>
            <div className="space-y-1.5">
              {MODEL_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded text-sm text-left transition-colors ${
                    model === opt.value
                      ? "bg-gray-600 border border-gray-500 text-gray-100"
                      : "bg-gray-700/50 border border-gray-700 text-gray-400 hover:bg-gray-700 hover:text-gray-300"
                  }`}
                  style={
                    model === opt.value
                      ? { borderLeftColor: opt.color, borderLeftWidth: 3 }
                      : undefined
                  }
                  onClick={() => handleModelChange(opt.value)}
                >
                  <span className="text-lg">{opt.icon}</span>
                  <span className="flex-1">
                    {opt.value === "local" || opt.value === "custom"
                      ? t(`agents.addModal.model.${opt.value}`)
                      : opt.label}
                  </span>
                  {opt.hint && model === opt.value && (
                    <span className="text-[10px] text-gray-500 truncate max-w-[55%]">
                      {t("agents.addModal.localHint")}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Local(Ollama) 설치 모델 선택 — `ollama list` 실측 목록만 후보다.
              스토어 '로컬 모델' 탭에서 pull 한 모델이 여기 나타난다. */}
          {model === "local" && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                {t("agents.addModal.localModel")}
                <span className="ml-1 text-xs text-gray-500">
                  {t("agents.addModal.localModelHint")}
                </span>
              </label>
              {localModels === null ? (
                <p className="text-xs text-gray-500">
                  {t("agents.addModal.localModelLoading")}
                </p>
              ) : localModels.length > 0 ? (
                <select
                  value={selectedLocalModel}
                  onChange={(e) => setSelectedLocalModel(e.target.value)}
                  className="w-full rounded bg-gray-700 border border-gray-600 px-3 py-2 text-sm text-gray-100 font-mono focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {localModels.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-xs text-gray-500">
                  {t("agents.addModal.localModelNone")}
                </p>
              )}
            </div>
          )}

          {/* Role */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              {t("agents.addModal.role")}
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
              {t("agents.addModal.command")}
              <span className="ml-1 text-xs text-gray-500">
                {t("agents.addModal.commandHint")}
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
              {t("agents.addModal.cwd")}
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
                title={t("agents.addModal.selectFolder")}
              >
                📁
              </button>
            </div>
          </div>

          {/* Task Assignment */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              {t("agents.addModal.taskAssign")}
              <span className="ml-1 text-xs text-gray-500">
                {t("agents.addModal.optional")}
              </span>
            </label>
            {availableTasks.length > 0 ? (
              <select
                value={selectedTaskId}
                onChange={(e) => setSelectedTaskId(e.target.value)}
                className="w-full rounded bg-gray-700 border border-gray-600 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">{t("agents.addModal.noTask")}</option>
                {availableTasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    [{t.status}] {t.title} (P{t.priority})
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-xs text-gray-500">
                {t("agents.addModal.noTasksAvail")}
              </p>
            )}
          </div>

          {/* Custom Prompt (when no task selected) */}
          {!selectedTaskId && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                {t("agents.addModal.initPrompt")}
                <span className="ml-1 text-xs text-gray-500">
                  {t("agents.addModal.initPromptHint")}
                </span>
              </label>
              <textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder={t("agents.addModal.promptPlaceholder")}
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
