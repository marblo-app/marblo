import { useEffect, useMemo, useState } from "react";
import type {
  MissionAccessMode,
  MissionTargetRepository,
  MissionTemplateId,
} from "../../types/mission";
import { TEMPLATE_META, listTemplates } from "./templates";

interface MissionLaunchDialogProps {
  projectId: string;
  initialTemplateId?: MissionTemplateId;
  onCancel: () => void;
  onLaunch: (input: {
    goal: string;
    templateId: MissionTemplateId;
    targetRepository?: MissionTargetRepository;
    targetBranch?: string;
    targetAccessMode?: MissionAccessMode;
  }) => Promise<void>;
}

type LaunchConnection = ProjectConnection;

const ACCESS_MODE_OPTIONS: Array<{
  value: MissionAccessMode;
  label: string;
  description: string;
}> = [
  {
    value: "read",
    label: "Read only",
    description: "Inspect repository state without file changes.",
  },
  {
    value: "write",
    label: "Write files",
    description: "Allow local working tree edits.",
  },
  {
    value: "pr",
    label: "Create PR",
    description: "Allow branch work and pull request creation.",
  },
  {
    value: "commit",
    label: "Direct commit",
    description: "Allow committing directly to the target branch.",
  },
];

function repoLabel(conn: LaunchConnection): string {
  if (conn.repoUrl) {
    const trimmed = conn.repoUrl.replace(/\/$/, "");
    return (
      trimmed
        .split(/[/:]/)
        .pop()
        ?.replace(/\.git$/, "") || conn.repoUrl
    );
  }
  return conn.localPath.split("/").filter(Boolean).pop() || conn.localPath;
}

function toMissionTarget(
  conn: LaunchConnection | null,
): MissionTargetRepository | undefined {
  if (!conn) return undefined;
  return {
    projectId: conn.projectId,
    localPath: conn.localPath,
    repoUrl: conn.repoUrl,
    defaultBranch: conn.defaultBranch,
  };
}

export function MissionLaunchDialog({
  projectId,
  initialTemplateId,
  onCancel,
  onLaunch,
}: MissionLaunchDialogProps) {
  const [goal, setGoal] = useState("");
  const [templateId, setTemplateId] = useState<MissionTemplateId>(
    initialTemplateId ?? "feature",
  );
  const [connections, setConnections] = useState<LaunchConnection[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [targetBranch, setTargetBranch] = useState("");
  const [targetAccessMode, setTargetAccessMode] =
    useState<MissionAccessMode>("read");
  const [loadingConnections, setLoadingConnections] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadConnections = async () => {
      setLoadingConnections(true);
      setConnectionError(null);
      try {
        const api = window.electronAPI?.connection;
        if (!api) {
          if (!cancelled) setConnections([]);
          return;
        }
        const [current, list] = await Promise.all([
          api.get(projectId).catch(() => null),
          api.list().catch(() => []),
        ]);
        if (cancelled) return;
        const merged = current
          ? [
              current,
              ...list.filter((conn) => conn.projectId !== current.projectId),
            ]
          : list;
        setConnections(merged);
        const selected = current ?? merged[0] ?? null;
        setSelectedProjectId(selected?.projectId ?? "");
        setTargetBranch(selected?.defaultBranch ?? "");
        setTargetAccessMode(selected?.accessMode ?? "read");
      } catch (e) {
        if (!cancelled) {
          setConnections([]);
          setConnectionError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoadingConnections(false);
      }
    };
    void loadConnections();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const selectedConnection = useMemo(
    () =>
      connections.find((conn) => conn.projectId === selectedProjectId) ?? null,
    [connections, selectedProjectId],
  );

  const handleLaunch = async () => {
    if (!goal.trim()) {
      setError("미션의 목표를 한 줄로 적어주세요.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onLaunch({
        goal: goal.trim(),
        templateId,
        targetRepository: toMissionTarget(selectedConnection),
        targetBranch: selectedConnection
          ? targetBranch.trim() || selectedConnection.defaultBranch || undefined
          : undefined,
        targetAccessMode: selectedConnection ? targetAccessMode : undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  };

  const template = TEMPLATE_META[templateId];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-xl border border-gray-700 bg-gray-800 shadow-2xl">
        <div className="border-b border-gray-700 px-6 py-4">
          <h3 className="text-base font-semibold text-gray-100">
            🚀 Launch Mission
          </h3>
          <p className="mt-1 text-xs text-gray-400">
            한 줄 목표와 템플릿을 고르면 orchestrator 가 끝까지 책임지고
            진행합니다.
          </p>
        </div>
        <div className="space-y-5 px-6 py-5">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-400">
              목표 (한 줄)
            </label>
            <input
              type="text"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !submitting) handleLaunch();
              }}
              placeholder='예: "로그인 페이지 만들어줘"'
              className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-400">
              템플릿
            </label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-5">
              {listTemplates().map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTemplateId(t.id)}
                  className={`flex flex-col items-start gap-1 rounded-lg border p-2.5 text-left text-xs transition-colors ${
                    templateId === t.id
                      ? "border-blue-500 bg-blue-500/10 text-blue-100"
                      : "border-gray-700 bg-gray-900/60 text-gray-300 hover:border-gray-600"
                  }`}
                >
                  <span className="text-base">{t.emoji}</span>
                  <span className="font-medium">{t.label}</span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-gray-500">
              {template.description} · {template.steps.length} step
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)]">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-400">
                Target repository
              </label>
              <select
                value={selectedProjectId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  const next = connections.find(
                    (conn) => conn.projectId === nextId,
                  );
                  setSelectedProjectId(nextId);
                  setTargetBranch(next?.defaultBranch ?? "");
                  setTargetAccessMode(next?.accessMode ?? "read");
                }}
                disabled={
                  submitting || loadingConnections || connections.length === 0
                }
                className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none disabled:opacity-60"
              >
                {connections.length === 0 ? (
                  <option value="">
                    {loadingConnections
                      ? "Loading connected repositories..."
                      : "No connected repositories"}
                  </option>
                ) : (
                  connections.map((conn) => (
                    <option key={conn.projectId} value={conn.projectId}>
                      {repoLabel(conn)}
                      {conn.defaultBranch ? ` · ${conn.defaultBranch}` : ""}
                    </option>
                  ))
                )}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                {selectedConnection
                  ? selectedConnection.repoUrl || selectedConnection.localPath
                  : connectionError
                    ? `Connection load failed: ${connectionError}`
                    : "연결된 repo가 없으면 미션만 생성됩니다."}
              </p>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-400">
                Target branch
              </label>
              <input
                type="search"
                value={targetBranch}
                onChange={(e) => setTargetBranch(e.target.value)}
                placeholder="main"
                disabled={submitting || !selectedConnection}
                className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none disabled:opacity-60"
              />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-400">
              Agent access mode
            </label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-4">
              {ACCESS_MODE_OPTIONS.map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  onClick={() => setTargetAccessMode(mode.value)}
                  disabled={submitting || !selectedConnection}
                  title={mode.description}
                  className={`rounded-lg border p-2.5 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                    targetAccessMode === mode.value
                      ? "border-blue-500 bg-blue-500/10 text-blue-100"
                      : "border-gray-700 bg-gray-900/60 text-gray-300 hover:border-gray-600"
                  }`}
                >
                  <span className="font-medium">{mode.label}</span>
                </button>
              ))}
            </div>
          </div>
          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">
              {error}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-gray-700 px-6 py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="rounded-lg border border-gray-600 bg-gray-700/30 px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-700/60 disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleLaunch}
            disabled={submitting || !goal.trim()}
            className="rounded-lg border border-blue-500/50 bg-blue-500/20 px-4 py-2 text-sm font-medium text-blue-100 transition-colors hover:bg-blue-500/30 disabled:opacity-50"
          >
            {submitting ? "시작 중..." : "🚀 Launch Mission"}
          </button>
        </div>
      </div>
    </div>
  );
}
