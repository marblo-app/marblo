import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { useProjectStore } from "../../stores/projectStore";

interface AgentSummary {
  id: string;
  name: string;
  model: string;
  role: string;
  status: string;
}

const ACCESS_LABEL: Record<ProjectConnection["accessMode"], string> = {
  read: "Read",
  write: "Write",
  pr: "PR",
  commit: "Commit",
};

const PERMISSIONS_LABEL: Record<ProjectConnection["permissionsState"], string> =
  {
    unknown: "미확인",
    pending: "대기",
    granted: "허용",
    denied: "거부",
  };

const CHECK_STATUS_STYLE: Record<
  ConnectionCheckItem["status"],
  { label: string; className: string }
> = {
  pass: {
    label: "통과",
    className: "bg-[#a6e3a1]/15 text-[#a6e3a1]",
  },
  warn: {
    label: "주의",
    className: "bg-[#f9e2af]/15 text-[#f9e2af]",
  },
  fail: {
    label: "실패",
    className: "bg-[#f38ba8]/15 text-[#f38ba8]",
  },
};

function formatDate(value: number | null): string {
  if (!value) return "기록 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function accessCapabilities(accessMode: ProjectConnection["accessMode"]) {
  if (accessMode === "commit") return ["Read", "Write", "PR", "Commit"];
  if (accessMode === "pr") return ["Read", "Write", "PR"];
  if (accessMode === "write") return ["Read", "Write"];
  return ["Read"];
}

function mcpStatus(connection: ProjectConnection): {
  label: string;
  className: string;
} {
  if (connection.permissionsState === "granted") {
    return { label: "사용 가능", className: "text-[#a6e3a1]" };
  }
  if (connection.permissionsState === "denied") {
    return { label: "권한 거부", className: "text-[#f38ba8]" };
  }
  if (connection.permissionsState === "pending") {
    return { label: "권한 대기", className: "text-[#f9e2af]" };
  }
  return { label: "미확인", className: "text-[#6c7086]" };
}

function checkIcon(status: ConnectionCheckItem["status"]) {
  if (status === "pass") return <CheckCircle2 className="h-3.5 w-3.5" />;
  if (status === "fail") return <XCircle className="h-3.5 w-3.5" />;
  return <AlertTriangle className="h-3.5 w-3.5" />;
}

export function ConnectionStatusPanel() {
  const currentProject = useProjectStore((s) => s.currentProject);
  const [connection, setConnection] = useState<ProjectConnection | null>(null);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<ConnectionCheckResult | null>(
    null,
  );

  const loadConnection = useCallback(async () => {
    if (!currentProject?.id) {
      setConnection(null);
      setAgents([]);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [nextConnection, nextAgents] = await Promise.all([
        window.electronAPI.connection.get(currentProject.id),
        window.electronAPI.agent.list(currentProject.id).catch(() => []),
      ]);
      setConnection(nextConnection);
      setAgents(nextAgents);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "연결 상태를 불러오지 못했습니다.",
      );
    } finally {
      setLoading(false);
    }
  }, [currentProject?.id]);

  useEffect(() => {
    void loadConnection();
  }, [loadConnection]);

  const activeAgents = useMemo(
    () => agents.filter((agent) => agent.status !== "stopped"),
    [agents],
  );

  const handleCheck = async () => {
    if (!currentProject?.id) return;
    setChecking(true);
    setError(null);
    setCheckResult(null);
    try {
      const result = await window.electronAPI.connection.check(
        currentProject.id,
      );
      setCheckResult(result);
      await loadConnection();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "연결 확인에 실패했습니다.",
      );
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="border-b border-[#313244] bg-[#181825] px-4 py-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-[#cdd6f4]">연결 상태</h3>
          <p className="text-xs text-[#6c7086]">
            {currentProject?.name ?? "프로젝트 미선택"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadConnection()}
            disabled={loading}
            title="연결 상태 새로고침"
            className="inline-flex h-8 w-8 items-center justify-center rounded border border-[#313244] text-[#bac2de] hover:border-[#45475a] hover:bg-[#313244] disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={handleCheck}
            disabled={!currentProject?.id || !connection || checking}
            className="inline-flex h-8 items-center gap-1.5 rounded bg-[#89b4fa]/20 px-3 text-xs font-medium text-[#89b4fa] hover:bg-[#89b4fa]/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {checking ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
            연결 확인
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded border border-[#f38ba8]/30 bg-[#f38ba8]/10 px-3 py-2 text-xs text-[#f38ba8]">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex h-28 items-center justify-center text-xs text-[#6c7086]">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          연결 상태 확인 중
        </div>
      ) : !connection ? (
        <div className="rounded border border-dashed border-[#45475a] px-3 py-4 text-sm text-[#bac2de]">
          연결된 repo가 없습니다.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            <StatusField
              label="Repo URL"
              value={connection.repoUrl ?? "미확인"}
            />
            <StatusField
              label="Default branch"
              value={connection.defaultBranch ?? "미확인"}
            />
            <StatusField label="Local path" value={connection.localPath} />
            <StatusField
              label="Connected harness"
              value={connection.connectedHarness ?? "미연결"}
            />
            <StatusField
              label="Connected agent"
              value={
                activeAgents.length > 0
                  ? activeAgents
                      .map((agent) => `${agent.name} (${agent.model})`)
                      .join(", ")
                  : "실행 중인 에이전트 없음"
              }
            />
            <StatusField
              label="Last successful run"
              value={formatDate(connection.lastRunAt)}
            />
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-[#bac2de]">
                Agent access
              </span>
              {accessCapabilities(connection.accessMode).map((capability) => (
                <span
                  key={capability}
                  className="rounded bg-[#313244] px-2 py-0.5 text-[11px] text-[#cdd6f4]"
                >
                  {capability}
                </span>
              ))}
              <span className="text-[11px] text-[#6c7086]">
                현재 모드: {ACCESS_LABEL[connection.accessMode]}
              </span>
            </div>
          </div>

          <McpStatusTable connection={connection} />

          {checkResult && (
            <div className="rounded border border-[#313244] bg-[#1e1e2e] p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[#bac2de]">
                  연결 확인 결과
                </span>
                <span
                  className={`rounded px-2 py-0.5 text-[11px] ${
                    checkResult.ok
                      ? "bg-[#a6e3a1]/15 text-[#a6e3a1]"
                      : "bg-[#f38ba8]/15 text-[#f38ba8]"
                  }`}
                >
                  {checkResult.ok ? "정상" : "확인 필요"}
                </span>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {checkResult.items.map((item) => {
                  const style = CHECK_STATUS_STYLE[item.status];
                  return (
                    <div
                      key={item.id}
                      className="rounded border border-[#313244] bg-[#181825] px-3 py-2"
                    >
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-[#cdd6f4]">
                          {item.label}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${style.className}`}
                        >
                          {checkIcon(item.status)}
                          {style.label}
                        </span>
                      </div>
                      <p className="text-[11px] leading-4 text-[#6c7086]">
                        {item.detail}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded border border-[#313244] bg-[#1e1e2e] px-3 py-2">
      <div className="mb-1 text-[11px] uppercase text-[#6c7086]">{label}</div>
      <div className="truncate text-xs text-[#cdd6f4]" title={value}>
        {value}
      </div>
    </div>
  );
}

function McpStatusTable({ connection }: { connection: ProjectConnection }) {
  const status = mcpStatus(connection);
  const mcps = connection.availableMcps;

  return (
    <div className="overflow-hidden rounded border border-[#313244] bg-[#1e1e2e]">
      <table className="w-full table-fixed text-left text-xs">
        <thead className="bg-[#313244]/60 text-[11px] uppercase text-[#6c7086]">
          <tr>
            <th className="w-1/4 px-3 py-2 font-medium">MCP명</th>
            <th className="w-1/4 px-3 py-2 font-medium">상태</th>
            <th className="w-1/4 px-3 py-2 font-medium">권한</th>
            <th className="w-1/4 px-3 py-2 font-medium">마지막사용</th>
          </tr>
        </thead>
        <tbody>
          {mcps.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-3 py-3 text-center text-[#6c7086]">
                사용 가능한 MCP가 없습니다.
              </td>
            </tr>
          ) : (
            mcps.map((mcp) => (
              <tr key={mcp} className="border-t border-[#313244]">
                <td className="truncate px-3 py-2 text-[#cdd6f4]" title={mcp}>
                  {mcp}
                </td>
                <td className={`px-3 py-2 ${status.className}`}>
                  {status.label}
                </td>
                <td className="px-3 py-2 text-[#bac2de]">
                  {PERMISSIONS_LABEL[connection.permissionsState]} /{" "}
                  {ACCESS_LABEL[connection.accessMode]}
                </td>
                <td className="px-3 py-2 text-[#6c7086]">
                  {formatDate(connection.lastRunAt)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
