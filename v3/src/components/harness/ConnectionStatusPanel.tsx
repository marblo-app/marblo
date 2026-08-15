import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  Link2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Unlink,
  XCircle,
} from "lucide-react";
import { useProjectStore } from "../../stores/projectStore";
import { useTranslation, useLocaleStore, t as translate } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";
import { GitHubConnectionPanel } from "./GitHubConnectionPanel";

// spawn-node preflight 결과 — main 프로세스 resolveNodeBinary 의 실제 실행
// 검증 결과를 그대로 받는다. ok=false 면 깨진 node 로 MCP/에이전트 자식이
// 침묵 -32000 으로 죽을 위험이므로 행동가능 배너를 띄운다.
interface NodeSpawnPreflight {
  ok: boolean;
  command: string;
  source: string;
  version: string;
  error?: string;
}

declare global {
  interface ConnectionAPI {
    setAccess: (input: {
      projectId: string;
      accessMode: ConnectionAccessMode;
    }) => Promise<ProjectConnection>;
    remove: (projectId: string) => Promise<boolean>;
  }
  // 전역 SystemAPI 에 node 헬스 preflight 채널을 머지한다(선언 병합).
  interface SystemAPI {
    nodeHealth?: () => Promise<NodeSpawnPreflight>;
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

// Permission-state display label (enum value stays English; only the label is
// translated). Read locale at call time via the pure t().
function permissionsLabel(
  state: ProjectConnection["permissionsState"],
): string {
  return translate(`harness.perm.${state}` as MessageKey);
}

// Connection-check item status → tone className (language-neutral). The label
// is translated separately via t("harness.checkStatus.*").
const CHECK_STATUS_CLASS: Record<ConnectionCheckItem["status"], string> = {
  pass: "bg-[#a6e3a1]/15 text-[#a6e3a1]",
  warn: "bg-[#f9e2af]/15 text-[#f9e2af]",
  fail: "bg-[#f38ba8]/15 text-[#f38ba8]",
};

function formatDate(value: number | null): string {
  if (!value) return translate("harness.conn.noRecord");
  const locale = useLocaleStore.getState().locale === "ko" ? "ko-KR" : "en-US";
  return new Intl.DateTimeFormat(locale, {
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
    return {
      label: translate("harness.mcp.available"),
      className: "text-[#a6e3a1]",
    };
  }
  if (connection.permissionsState === "denied") {
    return {
      label: translate("harness.mcp.denied"),
      className: "text-[#f38ba8]",
    };
  }
  if (connection.permissionsState === "pending") {
    return {
      label: translate("harness.mcp.pending"),
      className: "text-[#f9e2af]",
    };
  }
  return {
    label: translate("harness.mcp.unknown"),
    className: "text-[#6c7086]",
  };
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
  const { t } = useTranslation();
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
    null,
  );
  const [nodePreflight, setNodePreflight] = useState<NodeSpawnPreflight | null>(
    null,
  );

  // 하네스 진입 시 spawn-node 를 실제로 실행 검증한다. 실패하면 침묵 -32000
  // 대신 행동가능 배너를 띄운다. nodeHealth IPC 가 없는 구버전 preload 와도
  // 안전하게 동작하도록 옵셔널 호출 + try/catch 로 감싼다.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const probe = await window.electronAPI.system.nodeHealth?.();
        if (!cancelled && probe) setNodePreflight(probe);
      } catch {
        // preflight 자체 실패는 무시 — 배너 미표시(기존 동작 유지).
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
        err instanceof Error
          ? err.message
          : translate("harness.conn.loadError"),
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
        err instanceof Error
          ? err.message
          : translate("harness.conn.createError"),
      );
    } finally {
      setConnecting(false);
    }
  }, [currentProject?.id, currentProject?.folderPath, loadConnection]);

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
        err instanceof Error
          ? err.message
          : translate("harness.conn.checkError"),
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
        err instanceof Error
          ? err.message
          : translate("harness.conn.accessError"),
      );
    } finally {
      setApplyingAccess(false);
    }
  }, [accessModeDraft, connection, currentProject?.id, loadConnection]);

  const handleRemoveConnection = useCallback(async () => {
    const projectId = currentProject?.id;
    if (!projectId || !connection) return;

    const confirmed = window.confirm(translate("harness.conn.removeConfirm"));
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
        err instanceof Error
          ? err.message
          : translate("harness.conn.removeError"),
      );
    } finally {
      setRemovingConnection(false);
    }
  }, [connection, currentProject?.id]);

  return (
    <div className="border-b border-[#313244] bg-[#181825] px-4 py-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-[#cdd6f4]" aria-hidden />
            <h3 className="text-sm font-semibold text-[#cdd6f4]">
              {t("harness.conn.title")}
            </h3>
          </div>
          <p className="text-xs text-[#6c7086]">
            {currentProject?.name ?? t("harness.conn.noProject")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadConnection()}
            disabled={loading}
            title={t("harness.conn.refreshTitle")}
            className="inline-flex h-8 w-8 items-center justify-center rounded border border-[#313244] text-[#bac2de] hover:border-[#45475a] hover:bg-[#313244] disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          {connection && (
            <button
              type="button"
              onClick={() => void handleConnect()}
              disabled={!currentProject?.folderPath || connecting}
              title={t("harness.conn.resyncTitle")}
              className="inline-flex h-8 items-center gap-1.5 rounded border border-[#313244] px-3 text-xs font-medium text-[#bac2de] hover:border-[#45475a] hover:bg-[#313244] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {connecting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Link2 className="h-3.5 w-3.5" />
              )}
              {t("harness.conn.resync")}
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
            {t("harness.conn.check")}
          </button>
        </div>
      </div>

      {nodePreflight && !nodePreflight.ok && (
        <div className="mb-3 flex items-start gap-2 rounded border border-[#f38ba8]/40 bg-[#f38ba8]/10 px-3 py-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#f38ba8]" />
          <div className="min-w-0">
            <span className="inline-flex items-center rounded bg-[#f38ba8]/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#f38ba8]">
              {t("harness.conn.nodeBadge")}
            </span>
            <p className="mt-1 text-[11px] leading-4 text-[#f38ba8]">
              {nodePreflight.error ?? t("harness.conn.nodeError")}{" "}
              {t("harness.conn.nodeHintBefore")}{" "}
              <code className="rounded bg-[#f38ba8]/20 px-1">
                brew reinstall node
              </code>{" "}
              {t("harness.conn.nodeHintAfter")}
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-3 rounded border border-[#f38ba8]/30 bg-[#f38ba8]/10 px-3 py-2 text-xs text-[#f38ba8]">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex h-28 items-center justify-center text-xs text-[#6c7086]">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {t("harness.conn.loading")}
        </div>
      ) : !connection ? (
        <div className="rounded border border-dashed border-[#45475a] px-3 py-4">
          <p className="mb-1 text-sm text-[#bac2de]">
            {t("harness.conn.noRepo")}
          </p>
          {currentProject?.folderPath ? (
            <>
              <p className="mb-3 text-xs text-[#6c7086]">
                {t("harness.conn.autoFillHint")}
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
                {connecting
                  ? t("harness.conn.connecting")
                  : t("harness.conn.connect")}
              </button>
              <ManualConnectForm
                projectId={currentProject.id}
                localPath={currentProject.folderPath}
                onConnected={loadConnection}
              />
              <div className="mt-3">
                <GitHubConnectionPanel embedded />
              </div>
            </>
          ) : (
            <p className="text-xs text-[#6c7086]">
              {currentProject
                ? t("harness.conn.noFolderPath")
                : t("harness.conn.selectProjectFirst")}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            <StatusField
              label="Repo URL"
              value={connection.repoUrl ?? t("harness.conn.unknown")}
            />
            <StatusField
              label="Default branch"
              value={connection.defaultBranch ?? t("harness.conn.unknown")}
            />
            <StatusField label="Local path" value={connection.localPath} />
            <StatusField
              label="Connected harness"
              value={
                connection.connectedHarness ?? t("harness.conn.notConnected")
              }
            />
            <StatusField
              label="Connected agent"
              value={
                activeAgents.length > 0
                  ? activeAgents
                      .map((agent) => `${agent.name} (${agent.model})`)
                      .join(", ")
                  : t("harness.conn.noActiveAgents")
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
                {t("harness.conn.currentMode", {
                  mode: ACCESS_LABEL[connection.accessMode],
                })}
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
                {t("harness.conn.applyAccess")}
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
                {t("harness.conn.disconnect")}
              </button>
            </div>
          </div>

          <McpStatusTable connection={connection} />

          <GitHubConnectionPanel embedded />

          {checkResult && (
            <div className="rounded border border-[#313244] bg-[#1e1e2e] p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[#bac2de]">
                  {t("harness.conn.checkResult")}
                </span>
                <span
                  className={`rounded px-2 py-0.5 text-[11px] ${
                    checkResult.ok
                      ? "bg-[#a6e3a1]/15 text-[#a6e3a1]"
                      : "bg-[#f38ba8]/15 text-[#f38ba8]"
                  }`}
                >
                  {checkResult.ok
                    ? t("harness.conn.ok")
                    : t("harness.conn.needsCheck")}
                </span>
              </div>
              {(() => {
                // 'Repo match' 항목이 실패면 = 로컬 origin ↔ 저장 repoUrl 불일치.
                // 잘못된 repo 에 작업할 위험이라 항목 그리드 위에 눈에 띄는
                // 'Repo Mismatch' 배지·원인을 별도로 띄운다(기존 렌더링 확장).
                const mismatch = checkResult.items.find(
                  (it) => it.label === "Repo match" && it.status === "fail",
                );
                if (!mismatch) return null;
                return (
                  <div className="mb-2 flex items-start gap-2 rounded border border-[#f38ba8]/40 bg-[#f38ba8]/10 px-3 py-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#f38ba8]" />
                    <div className="min-w-0">
                      <span className="inline-flex items-center rounded bg-[#f38ba8]/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#f38ba8]">
                        Repo Mismatch
                      </span>
                      <p className="mt-1 text-[11px] leading-4 text-[#f38ba8]">
                        {mismatch.detail}
                      </p>
                    </div>
                  </div>
                );
              })()}
              <div className="grid gap-2 md:grid-cols-2">
                {checkResult.items.map((item) => {
                  const statusClass = CHECK_STATUS_CLASS[item.status];
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
                          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${statusClass}`}
                        >
                          {checkIcon(item.status)}
                          {t(
                            `harness.checkStatus.${item.status}` as MessageKey,
                          )}
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
  const { t } = useTranslation();
  const [repoUrl, setRepoUrl] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    const trimmedUrl = repoUrl.trim();
    if (!isValidRepoUrl(trimmedUrl)) {
      setError(translate("harness.conn.invalidUrl"));
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
        err instanceof Error
          ? err.message
          : translate("harness.conn.manualError"),
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
          {t("harness.conn.manualTitle")}
        </span>
      </div>
      <p className="mb-2 text-[11px] leading-4 text-[#6c7086]">
        {t("harness.conn.manualHint")}
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
          placeholder={t("harness.conn.branchPlaceholder")}
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
        {submitting
          ? t("harness.conn.connecting")
          : t("harness.conn.manualConnect")}
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
  const { t } = useTranslation();
  const status = mcpStatus(connection);
  const mcps = connection.availableMcps;

  return (
    <div className="overflow-hidden rounded border border-[#313244] bg-[#1e1e2e]">
      <table className="w-full table-fixed text-left text-xs">
        <thead className="bg-[#313244]/60 text-[11px] uppercase text-[#6c7086]">
          <tr>
            <th className="w-1/4 px-3 py-2 font-medium">
              {t("harness.mcp.colName")}
            </th>
            <th className="w-1/4 px-3 py-2 font-medium">
              {t("harness.mcp.colStatus")}
            </th>
            <th className="w-1/4 px-3 py-2 font-medium">
              {t("harness.mcp.colPerm")}
            </th>
            <th className="w-1/4 px-3 py-2 font-medium">
              {t("harness.mcp.colLastUsed")}
            </th>
          </tr>
        </thead>
        <tbody>
          {mcps.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-3 py-3 text-center text-[#6c7086]">
                {t("harness.mcp.empty")}
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
                  {permissionsLabel(connection.permissionsState)} /{" "}
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
