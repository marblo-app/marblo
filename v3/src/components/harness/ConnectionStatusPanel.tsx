import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Link2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Unlink,
  XCircle,
} from "lucide-react";
import { useProjectStore } from "../../stores/projectStore";

declare global {
  interface ConnectionAPI {
    setAccess: (input: {
      projectId: string;
      accessMode: ConnectionAccessMode;
    }) => Promise<ProjectConnection>;
    remove: (projectId: string) => Promise<boolean>;
  }
}

interface AgentSummary {
  id: string;
  name: string;
  model: string;
  role: string;
  status: string;
}

const ACCESS_MODES: ProjectConnection["accessMode"][] = [
  "read",
  "write",
  "pr",
  "commit",
];

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

// GitHub repo URL 형식 검증 — https://host/owner/repo(.git) 또는
// git@host:owner/repo(.git) 만 허용한다. 백엔드 connect() 는 입력 repoUrl 을
// 그대로 보존하므로(merge: 입력 > 기존 > git 자동채움) 잘못된 값이 저장되지
// 않도록 프론트에서 1차로 거른다.
function isValidRepoUrl(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  // https://github.com/owner/repo  (옵션: .git, 끝 슬래시)
  const httpsForm = /^https?:\/\/[^/\s]+\/[^/\s]+\/[^/\s]+?(?:\.git)?\/?$/;
  // git@github.com:owner/repo  (옵션: .git)
  const sshForm = /^[\w.-]+@[^:\s]+:[^/\s]+\/[^/\s]+?(?:\.git)?$/;
  return httpsForm.test(v) || sshForm.test(v);
}

export function ConnectionStatusPanel() {
  const currentProject = useProjectStore((s) => s.currentProject);
  const [connection, setConnection] = useState<ProjectConnection | null>(null);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [accessModeDraft, setAccessModeDraft] =
    useState<ProjectConnection["accessMode"]>("read");
  const [applyingAccess, setApplyingAccess] = useState(false);
  const [removingConnection, setRemovingConnection] = useState(false);
  const [checkResult, setCheckResult] = useState<ConnectionCheckResult | null>(
    null
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
        err instanceof Error ? err.message : "연결 상태를 불러오지 못했습니다."
      );
    } finally {
      setLoading(false);
    }
  }, [currentProject?.id]);

  useEffect(() => {
    void loadConnection();
  }, [loadConnection]);

  useEffect(() => {
    setAccessModeDraft(connection?.accessMode ?? "read");
  }, [connection]);

  // 현재 프로젝트(id+folderPath)로 연결을 생성/재동기화한다. upsert 는
  // connect()→deriveGitRepoMeta 로 repoUrl·defaultBranch 를 git 에서 자동
  // 채우므로 사용자가 URL 을 직접 입력하지 않아도 동작한다(OAuth UI 없음).
  // accessMode 는 일부러 비워 둔다 — 신규 연결은 store 기본값 'read', 재동기화는
  // 기존 모드를 그대로 보존한다(merge: 입력 > 기존 > 기본).
  const handleConnect = useCallback(async () => {
    const projectId = currentProject?.id;
    const localPath = currentProject?.folderPath;
    if (!projectId || !localPath) return;

    setConnecting(true);
    setError(null);
    try {
      await window.electronAPI.connection.upsert({ projectId, localPath });
      await loadConnection();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "연결 생성에 실패했습니다."
      );
    } finally {
      setConnecting(false);
    }
  }, [currentProject?.id, currentProject?.folderPath, loadConnection]);

  const activeAgents = useMemo(
    () => agents.filter((agent) => agent.status !== "stopped"),
    [agents]
  );

  const handleCheck = async () => {
    if (!currentProject?.id) return;
    setChecking(true);
    setError(null);
    setCheckResult(null);
    try {
      const result = await window.electronAPI.connection.check(
        currentProject.id
      );
      setCheckResult(result);
      await loadConnection();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "연결 확인에 실패했습니다."
      );
    } finally {
      setChecking(false);
    }
  };

  const handleApplyAccess = useCallback(async () => {
    const projectId = currentProject?.id;
    if (!projectId || !connection) return;

    setApplyingAccess(true);
    setError(null);
    try {
      await window.electronAPI.connection.setAccess({
        projectId,
        accessMode: accessModeDraft,
      });
      await loadConnection();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "권한 적용에 실패했습니다."
      );
    } finally {
      setApplyingAccess(false);
    }
  }, [accessModeDraft, connection, currentProject?.id, loadConnection]);

  const handleRemoveConnection = useCallback(async () => {
    const projectId = currentProject?.id;
    if (!projectId || !connection) return;

    const confirmed = window.confirm(
      "현재 프로젝트의 repo 연결을 해제하시겠습니까?"
    );
    if (!confirmed) return;

    setRemovingConnection(true);
    setError(null);
    try {
      await window.electronAPI.connection.remove(projectId);
      setConnection(null);
      setCheckResult(null);
      setAccessModeDraft("read");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "연결 해제에 실패했습니다."
      );
    } finally {
      setRemovingConnection(false);
    }
  }, [connection, currentProject?.id]);

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
          {connection && (
            <button
              type="button"
              onClick={() => void handleConnect()}
              disabled={!currentProject?.folderPath || connecting}
              title="git 메타(repo URL·기본 브랜치) 재동기화"
              className="inline-flex h-8 items-center gap-1.5 rounded border border-[#313244] px-3 text-xs font-medium text-[#bac2de] hover:border-[#45475a] hover:bg-[#313244] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {connecting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Link2 className="h-3.5 w-3.5" />
              )}
              재동기화
            </button>
          )}
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
        <div className="rounded border border-dashed border-[#45475a] px-3 py-4">
          <p className="mb-1 text-sm text-[#bac2de]">연결된 repo가 없습니다.</p>
          {currentProject?.folderPath ? (
            <>
              <p className="mb-3 text-xs text-[#6c7086]">
                현재 프로젝트의 로컬 경로로 연결을 만들면 repo URL·기본 브랜치를
                git 에서 자동으로 채웁니다.
              </p>
              <button
                type="button"
                onClick={() => void handleConnect()}
                disabled={connecting}
                className="inline-flex h-8 items-center gap-1.5 rounded bg-[#89b4fa] px-3 text-xs font-medium text-[#1e1e2e] hover:bg-[#74a8f5] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {connecting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Link2 className="h-3.5 w-3.5" />
                )}
                {connecting ? "연결 중" : "연결하기"}
              </button>
              <ManualConnectForm
                projectId={currentProject.id}
                localPath={currentProject.folderPath}
                onConnected={loadConnection}
              />
            </>
          ) : (
            <p className="text-xs text-[#6c7086]">
              {currentProject
                ? "프로젝트에 로컬 경로(folderPath)가 없어 연결할 수 없습니다. 프로젝트 설정에서 경로를 지정하세요."
                : "프로젝트를 먼저 선택하세요."}
            </p>
          )}
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

          {!connection.repoUrl && (
            <ManualConnectForm
              projectId={connection.projectId}
              localPath={connection.localPath}
              onConnected={loadConnection}
            />
          )}

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
            <div className="flex flex-wrap items-center gap-2 rounded border border-[#313244] bg-[#1e1e2e] p-2">
              <div className="inline-flex overflow-hidden rounded border border-[#313244]">
                {ACCESS_MODES.map((mode) => {
                  const selected = accessModeDraft === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setAccessModeDraft(mode)}
                      disabled={applyingAccess || removingConnection}
                      aria-pressed={selected}
                      className={`h-8 px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                        selected
                          ? "bg-[#89b4fa] text-[#1e1e2e]"
                          : "bg-[#181825] text-[#bac2de] hover:bg-[#313244]"
                      }`}
                    >
                      {ACCESS_LABEL[mode]}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => void handleApplyAccess()}
                disabled={
                  applyingAccess ||
                  removingConnection ||
                  accessModeDraft === connection.accessMode
                }
                className="inline-flex h-8 items-center gap-1.5 rounded bg-[#a6e3a1]/20 px-3 text-xs font-medium text-[#a6e3a1] hover:bg-[#a6e3a1]/30 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {applyingAccess ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5" />
                )}
                권한 적용
              </button>
              <button
                type="button"
                onClick={() => void handleRemoveConnection()}
                disabled={applyingAccess || removingConnection}
                className="inline-flex h-8 items-center gap-1.5 rounded border border-[#f38ba8]/40 px-3 text-xs font-medium text-[#f38ba8] hover:bg-[#f38ba8]/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {removingConnection ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Unlink className="h-3.5 w-3.5" />
                )}
                연결 해제
              </button>
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

// git remote 가 없거나 자동 도출되지 않은 프로젝트를 위한 수동 연결 폼.
// repo URL(필수)·기본 브랜치(선택)를 직접 입력해 connection 을 생성/갱신한다.
// 자동 '연결하기'(git 도출)와 공존하며, repoUrl 이 비어 있을 때 보조/오버라이드로
// 노출된다. 입력 repoUrl 은 백엔드 connect() 가 그대로 보존한다.
function ManualConnectForm({
  projectId,
  localPath,
  onConnected,
}: {
  projectId: string;
  localPath: string;
  onConnected: () => Promise<void> | void;
}) {
  const [repoUrl, setRepoUrl] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    const trimmedUrl = repoUrl.trim();
    if (!isValidRepoUrl(trimmedUrl)) {
      setError(
        "올바른 repo URL 형식이 아닙니다. 예: https://github.com/owner/repo 또는 git@github.com:owner/repo.git"
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const trimmedBranch = defaultBranch.trim();
      await window.electronAPI.connection.upsert({
        projectId,
        localPath,
        repoUrl: trimmedUrl,
        ...(trimmedBranch ? { defaultBranch: trimmedBranch } : {}),
      });
      await onConnected();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "수동 연결에 실패했습니다."
      );
    } finally {
      setSubmitting(false);
    }
  }, [repoUrl, defaultBranch, projectId, localPath, onConnected]);

  return (
    <div className="mt-3 rounded border border-[#313244] bg-[#1e1e2e] p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <Link2 className="h-3.5 w-3.5 text-[#bac2de]" />
        <span className="text-xs font-medium text-[#bac2de]">
          repo URL 직접 입력
        </span>
      </div>
      <p className="mb-2 text-[11px] leading-4 text-[#6c7086]">
        git remote 가 없거나 자동으로 도출되지 않은 경우 repo URL 을 직접 입력해
        연결할 수 있습니다.
      </p>
      <div className="space-y-2">
        <input
          type="text"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          placeholder="https://github.com/owner/repo"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="w-full rounded border border-[#313244] bg-[#181825] px-2.5 py-1.5 text-xs text-[#cdd6f4] placeholder:text-[#6c7086] focus:border-[#89b4fa] focus:outline-none"
        />
        <input
          type="text"
          value={defaultBranch}
          onChange={(e) => setDefaultBranch(e.target.value)}
          placeholder="기본 브랜치 (선택, 예: main)"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="w-full rounded border border-[#313244] bg-[#181825] px-2.5 py-1.5 text-xs text-[#cdd6f4] placeholder:text-[#6c7086] focus:border-[#89b4fa] focus:outline-none"
        />
      </div>
      {error && (
        <p className="mt-2 text-[11px] leading-4 text-[#f38ba8]">{error}</p>
      )}
      <button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={submitting || !repoUrl.trim()}
        className="mt-2 inline-flex h-8 items-center gap-1.5 rounded border border-[#313244] px-3 text-xs font-medium text-[#bac2de] hover:border-[#45475a] hover:bg-[#313244] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Link2 className="h-3.5 w-3.5" />
        )}
        {submitting ? "연결 중" : "수동 연결"}
      </button>
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
