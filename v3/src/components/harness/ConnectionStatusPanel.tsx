import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  Link2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Unlink,
  XCircle,
} from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { useProjectStore } from "../../stores/projectStore";
import { useTranslation, useLocaleStore, t as translate } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";
import {
  ConnectorGuidePanel,
  ConnectorGuideStep,
  ConnectorGuideSteps,
} from "./ConnectorGuidePanel";

/** 리포 연결 성공 후 1회성 워크트리 안내 팝업 — localStorage 키. */
export const WORKTREE_GUIDE_POPUP_KEY = "marblo:worktreeGuidePopupSeen";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function safeLocalStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 팝업을 이미 본 적 있으면 true. storage 미사용 가능 시 true(재노출 안 함). */
export function hasSeenWorktreeGuidePopup(
  storage: StorageLike | null = safeLocalStorage(),
): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(WORKTREE_GUIDE_POPUP_KEY) === "1";
  } catch {
    return true;
  }
}

export function markWorktreeGuidePopupSeen(
  storage: StorageLike | null = safeLocalStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(WORKTREE_GUIDE_POPUP_KEY, "1");
  } catch {
    // 비영속 — 세션 상태(showPopup)로만 막는다.
  }
}

/**
 * 리포 연결 성공 직후 1회성 안내를 띄울지 결정한다.
 * 이미 본 적 있으면 false. 처음이면 표시 기록 후 true.
 */
export function consumeWorktreeGuidePopup(
  storage: StorageLike | null = safeLocalStorage(),
): boolean {
  if (hasSeenWorktreeGuidePopup(storage)) return false;
  markWorktreeGuidePopupSeen(storage);
  return true;
}

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

interface DeviceSession {
  sessionId: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  intervalSeconds: number;
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

function github(): GitHubAPI {
  return window.electronAPI.github;
}

function githubStatusBadge(connected: boolean): {
  labelKey: MessageKey;
  className: string;
} {
  if (connected) {
    return {
      labelKey: "harness.github.status.connected",
      className: "bg-[#a6e3a1]/15 text-[#a6e3a1]",
    };
  }
  return {
    labelKey: "harness.github.status.disconnected",
    className: "bg-[#313244] text-[#bac2de]",
  };
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
  // 리포 연결 성공 시 1회성 독립 워크트리 안내 팝업 (YTpcEK5Ow5LIldkJJzQc).
  const [showWorktreeGuide, setShowWorktreeGuide] = useState(false);

  const revealWorktreeGuideIfNeeded = useCallback(() => {
    if (consumeWorktreeGuidePopup()) setShowWorktreeGuide(true);
  }, []);

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
  // isFirstConnect: 기존 연결이 없을 때만 1회성 워크트리 안내 팝업을 연다
  // (재동기화 버튼으로는 팝업을 띄우지 않는다).
  const handleConnect = useCallback(async () => {
    const projectId = currentProject?.id;
    const localPath = currentProject?.folderPath;
    if (!projectId || !localPath) return;

    const isFirstConnect = !connection;
    setConnecting(true);
    setError(null);
    try {
      await window.electronAPI.connection.upsert({ projectId, localPath });
      await loadConnection();
      if (isFirstConnect) revealWorktreeGuideIfNeeded();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : translate("harness.conn.createError"),
      );
    } finally {
      setConnecting(false);
    }
  }, [
    connection,
    currentProject?.id,
    currentProject?.folderPath,
    loadConnection,
    revealWorktreeGuideIfNeeded,
  ]);

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
                onConnected={async () => {
                  await loadConnection();
                  revealWorktreeGuideIfNeeded();
                }}
              />
              <WorktreeGuideNote />
              <GitHubAccountConnectionSection />
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

          {/* 리포 연결 섹션 아래 상시 안내 — 연결 후에도 계속 보인다. */}
          <WorktreeGuideNote />

          {!connection.repoUrl && (
            <ManualConnectForm
              projectId={connection.projectId}
              localPath={connection.localPath}
              onConnected={async () => {
                await loadConnection();
                revealWorktreeGuideIfNeeded();
              }}
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

          <GitHubAccountConnectionSection />

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

      {showWorktreeGuide && (
        <WorktreeGuidePopup onClose={() => setShowWorktreeGuide(false)} />
      )}
    </div>
  );
}

/** 리포 연결 섹션 아래 상시 노출 — 팝업 본문과 같은 메시지. */
export function WorktreeGuideNote() {
  const { t } = useTranslation();
  return (
    <div
      data-testid="worktree-guide-note"
      className="rounded border border-[#89b4fa]/30 bg-[#89b4fa]/10 px-3 py-2"
    >
      <div className="flex items-center gap-1.5">
        <GitBranch className="h-3.5 w-3.5 shrink-0 text-[#89b4fa]" aria-hidden />
        <span className="text-[11px] font-semibold text-[#89b4fa]">
          {t("harness.conn.worktreeGuide.badge")}
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-4 text-[#bac2de]">
        {t("harness.conn.worktreeGuide.body")}
      </p>
    </div>
  );
}

/** 리포 연결 성공 직후 1회성 모달. */
export function WorktreeGuidePopup({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="worktree-guide-popup-title"
        data-testid="worktree-guide-popup"
        className="w-full max-w-md rounded-lg border border-[#313244] bg-[#1e1e2e] shadow-2xl"
      >
        <div className="border-b border-[#313244] px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#89b4fa]">
            {t("harness.conn.worktreeGuide.badge")}
          </p>
          <h2
            id="worktree-guide-popup-title"
            className="mt-1 text-base font-semibold text-[#cdd6f4]"
          >
            {t("harness.conn.worktreeGuide.popupTitle")}
          </h2>
        </div>
        <div className="space-y-4 px-5 py-4">
          <p className="text-sm leading-6 text-[#bac2de]">
            {t("harness.conn.worktreeGuide.popupBody")}
          </p>
          <div className="flex justify-end">
            <button
              type="button"
              data-testid="worktree-guide-popup-dismiss"
              onClick={onClose}
              className="inline-flex h-9 items-center rounded bg-[#89b4fa] px-4 text-sm font-semibold text-[#1e1e2e] hover:bg-[#74a8f5]"
            >
              {t("harness.conn.worktreeGuide.gotIt")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function GitHubAccountConnectionSection() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const userId = user?.uid;

  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [deviceSession, setDeviceSession] = useState<DeviceSession | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const badge = useMemo(() => githubStatusBadge(connected), [connected]);

  const load = useCallback(async () => {
    if (!userId) {
      setConnected(false);
      setDeviceSession(null);
      setError(null);
      setMessage(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await github().status(userId);
      setConnected(result.connected === true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("harness.github.loadError"),
      );
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    void load();
    setDeviceSession(null);
    setMessage(null);
  }, [load]);

  useEffect(() => {
    if (!deviceSession) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void github()
        .devicePoll(deviceSession.sessionId)
        .then((result) => {
          if (cancelled) return;
          if (result.kind === "pending" || result.kind === "slow_down") {
            setDeviceSession({
              ...deviceSession,
              intervalSeconds:
                result.nextIntervalSeconds ?? deviceSession.intervalSeconds,
            });
            return;
          }
          setDeviceSession(null);
          setConnecting(false);
          if (result.kind === "success") {
            setConnected(true);
            setMessage(t("harness.github.connected"));
          } else if (result.kind === "denied") {
            setError(t("harness.github.denied"));
          } else if (result.kind === "expired") {
            setError(t("harness.github.expired"));
          } else {
            setError(result.message ?? t("harness.github.connectFailed"));
          }
        })
        .catch(() => {
          if (cancelled) return;
          setDeviceSession(null);
          setConnecting(false);
          setError(t("harness.github.connectFailed"));
        });
    }, deviceSession.intervalSeconds * 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [deviceSession, t]);

  const startConnect = useCallback(async () => {
    if (!userId || connecting) return;
    setConnecting(true);
    setError(null);
    setMessage(null);
    try {
      const result = await github().deviceStart(userId);
      if (
        !result.ok ||
        !result.sessionId ||
        !result.userCode ||
        !result.verificationUri ||
        !result.interval
      ) {
        setError(result.error ?? t("harness.github.connectFailed"));
        setConnecting(false);
        return;
      }
      setDeviceSession({
        sessionId: result.sessionId,
        userCode: result.userCode,
        verificationUri: result.verificationUri,
        verificationUriComplete: result.verificationUriComplete,
        intervalSeconds: result.interval,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("harness.github.connectFailed"),
      );
      setConnecting(false);
    }
  }, [connecting, t, userId]);

  const disconnect = useCallback(async () => {
    if (!userId) return;
    if (!window.confirm(t("harness.github.disconnectConfirm"))) return;
    setError(null);
    setMessage(null);
    try {
      const result = await github().disconnect(userId);
      if (!result.ok) {
        setError(t("harness.github.disconnectFailed"));
        return;
      }
      setConnected(false);
      setDeviceSession(null);
      setConnecting(false);
      setMessage(t("harness.github.disconnected"));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("harness.github.disconnectFailed"),
      );
    }
  }, [t, userId]);

  return (
    <div className="mt-3 rounded border border-[#313244] bg-[#1e1e2e] p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <GitBranch className="h-3.5 w-3.5 text-[#bac2de]" aria-hidden />
            <h4 className="text-xs font-medium text-[#bac2de]">
              {t("harness.github.title")}
            </h4>
            <span
              className={`rounded px-2 py-0.5 text-[11px] ${badge.className}`}
            >
              {t(badge.labelKey)}
            </span>
            <span className="rounded bg-[#313244] px-2 py-0.5 text-[10px] uppercase text-[#6c7086]">
              {t("harness.github.optionalBadge")}
            </span>
          </div>
          <p className="text-xs text-[#6c7086]">
            {t("harness.github.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || !userId}
            title={t("harness.github.refreshTitle")}
            className="inline-flex h-8 w-8 items-center justify-center rounded border border-[#313244] text-[#bac2de] hover:border-[#45475a] hover:bg-[#313244] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          {!connected && !deviceSession && (
            <button
              type="button"
              onClick={() => void startConnect()}
              disabled={connecting || loading || !userId}
              className="inline-flex h-8 items-center gap-1.5 rounded border border-[#313244] px-2.5 text-xs text-[#bac2de] hover:border-[#45475a] hover:bg-[#313244] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {connecting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Link2 className="h-3.5 w-3.5" />
              )}
              {t("harness.github.connect")}
            </button>
          )}
          {connected && (
            <button
              type="button"
              onClick={() => void disconnect()}
              disabled={loading || !userId}
              title={t("harness.github.disconnect")}
              className="inline-flex h-8 w-8 items-center justify-center rounded border border-[#313244] text-[#f38ba8] hover:border-[#f38ba8]/40 hover:bg-[#f38ba8]/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded border border-[#f38ba8]/30 bg-[#f38ba8]/10 px-3 py-2 text-xs text-[#f38ba8]">
          {error}
        </div>
      )}
      {message && (
        <div className="mb-3 rounded border border-[#a6e3a1]/30 bg-[#a6e3a1]/10 px-3 py-2 text-xs text-[#a6e3a1]">
          {message}
        </div>
      )}

      {!userId && (
        <p className="mb-3 text-[11px] leading-4 text-[#f9e2af]">
          {t("harness.github.needLogin")}
        </p>
      )}

      <div className="mb-1 flex items-center gap-2 rounded border border-[#313244] bg-[#181825] px-3 py-2 text-xs">
        <span className="text-[11px] uppercase text-[#6c7086]">
          {t("harness.github.account")}
        </span>
        {connected ? (
          <span className="flex items-center gap-1.5 text-[#cdd6f4]">
            <CheckCircle2 className="h-3.5 w-3.5 text-[#a6e3a1]" />
            {t("harness.github.accountConnected")}
          </span>
        ) : deviceSession ? (
          <span className="text-[#f9e2af]">
            {t("harness.github.waitingAuth")}
          </span>
        ) : (
          <span className="text-[#6c7086]">
            {t("harness.github.accountNone")}
          </span>
        )}
      </div>

      {deviceSession && (
        <div className="mt-3 space-y-2 rounded border border-[#89b4fa]/30 bg-[#89b4fa]/10 px-3 py-3 text-xs text-[#cdd6f4]">
          <p>
            {t("harness.github.deviceCodeLabel")}{" "}
            <strong className="font-mono text-base tracking-wider text-[#cdd6f4]">
              {deviceSession.userCode}
            </strong>
          </p>
          <a
            href={
              deviceSession.verificationUriComplete ??
              deviceSession.verificationUri
            }
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[#89b4fa] hover:underline"
          >
            {t("harness.github.openGithub")}
          </a>
          <p className="text-[11px] text-[#bac2de]">
            {t("harness.github.deviceCodeHint")}
          </p>
        </div>
      )}

      <ConnectorGuidePanel toggleLabel={t("harness.github.guide.toggle")}>
        <ConnectorGuideSteps>
          <ConnectorGuideStep>
            1. {t("harness.github.guide.step1")}
          </ConnectorGuideStep>
          <ConnectorGuideStep>
            2. {t("harness.github.guide.step2Before")}
            <a
              href="https://github.com/login/device"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#89b4fa] hover:underline"
            >
              github.com/login/device
            </a>
            {t("harness.github.guide.step2After")}
          </ConnectorGuideStep>
          <ConnectorGuideStep>
            3. {t("harness.github.guide.step3")}
          </ConnectorGuideStep>
          <ConnectorGuideStep>
            4. {t("harness.github.guide.step4")}
          </ConnectorGuideStep>
          <ConnectorGuideStep>
            5. {t("harness.github.guide.step5")}
          </ConnectorGuideStep>
          <ConnectorGuideStep>
            6. {t("harness.github.guide.step6")}
          </ConnectorGuideStep>
        </ConnectorGuideSteps>
        <div className="rounded border border-[#313244] bg-[#181825] px-3 py-2">
          <p className="mb-1 text-xs font-medium text-[#cdd6f4]">
            {t("harness.github.guide.appTitle")}
          </p>
          <p>{t("harness.github.guide.appBody")}</p>
        </div>
      </ConnectorGuidePanel>
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
