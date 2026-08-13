import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  CalendarDays,
  FolderOpen,
  Link2,
  Loader2,
  Mail,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useProjectStore } from "../../stores/projectStore";
import { useTranslation } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";

/**
 * Google Drive 위키 연결 패널 — 티켓 MCTHALmNAWPpilTFwe8o.
 *
 * ── ★한 패널, 두 축 ──────────────────────────────────────────────────────
 * 위 절반은 **유저 축**(Google 계정 연결 — 기기당 한 번), 아래 절반은
 * **프로젝트 축**(이 프로젝트의 위키 = 어느 폴더). 이걸 한 화면에 둔 이유는
 * 사용자의 머릿속에서 두 단계가 하나의 과업("드라이브 연결하기")이기 때문이고,
 * 그럼에도 시각적으로 갈라 둔 이유는 프로젝트를 바꾸면 **아래만** 바뀐다는
 * 사실을 화면이 스스로 설명해야 하기 때문이다.
 *
 * ★시크릿 미수신: 이 컴포넌트가 받는 것은 연결 여부·이메일·스코프 이름뿐이다.
 * OAuth 토큰은 IPC 응답 어디에도 없다(#938 계약 유지).
 *
 * 배치는 Slack/Telegram 패널과 같은 하네스탭 "연동" 섹션 — 데이터 소스도 결국
 * 이 앱에 뭘 붙이는 일이고, 발견 가능성이 Settings 깊은 곳보다 낫다.
 */

const FOLDER_MIME = "application/vnd.google-apps.folder";
/** 폴더 후보 목록 길이 — 고르는 화면이라 한 화면에 들어와야 한다. */
const FOLDER_PAGE_SIZE = 20;
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

function drive(): DriveAPI {
  return window.electronAPI.drive;
}

interface FolderOption {
  id: string;
  title: string;
  modifiedTime?: string;
}

function statusBadge(
  connected: boolean,
  bound: boolean,
): { labelKey: MessageKey; className: string } {
  if (!connected) {
    return {
      labelKey: "harness.drive.status.disconnected",
      className: "bg-[#313244] text-[#bac2de]",
    };
  }
  if (!bound) {
    return {
      labelKey: "harness.drive.status.needsFolder",
      className: "bg-[#f9e2af]/15 text-[#f9e2af]",
    };
  }
  return {
    labelKey: "harness.drive.status.bound",
    className: "bg-[#a6e3a1]/15 text-[#a6e3a1]",
  };
}

export function DriveConnectionPanel() {
  const { t } = useTranslation();
  const currentProject = useProjectStore((s) => s.currentProject);
  const projectId = currentProject?.id;

  const [status, setStatus] = useState<DriveConnectionStatus | null>(null);
  const [binding, setBinding] = useState<DriveProjectBinding | null>(null);
  const [folders, setFolders] = useState<FolderOption[] | null>(null);
  const [folderQuery, setFolderQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [searching, setSearching] = useState(false);
  const [savingBinding, setSavingBinding] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const connected = status?.connected === true;
  const scopes = status?.scopes ?? [];
  const gmailConnected = connected && scopes.includes(GMAIL_SCOPE);
  const calendarConnected = connected && scopes.includes(CALENDAR_SCOPE);
  const badge = useMemo(
    () => statusBadge(connected, !!binding),
    [connected, binding],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextStatus = await drive().status();
      setStatus(nextStatus);
      // 바인딩은 프로젝트 축이라 프로젝트가 없으면 물어볼 대상 자체가 없다.
      setBinding(projectId ? await drive().binding.get(projectId) : null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("harness.drive.loadError"),
      );
    } finally {
      setLoading(false);
    }
    // ★`t` 는 렌더마다 새 참조라 deps 에 넣으면 effect 가 매 렌더 재실행된다
    // (Slack/Telegram 패널과 동일하게 의도적으로 제외).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    void load();
    // 프로젝트가 바뀌면 이전 프로젝트를 위해 띄워 둔 폴더 후보·안내문은 버린다 —
    // 남겨 두면 "지금 이 프로젝트에 지정된 것" 으로 오해된다.
    setFolders(null);
    setFolderQuery("");
    setMessage(null);
  }, [load]);

  const connectAccount = useCallback(async () => {
    if (connecting) return;
    setConnecting(true);
    setError(null);
    setMessage(null);
    try {
      const result = await drive().connect();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setStatus(result.status);
      setMessage(t("harness.drive.connected"));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("harness.drive.connectFailed"),
      );
    } finally {
      setConnecting(false);
    }
  }, [connecting, t]);

  const disconnectAccount = useCallback(async () => {
    if (!window.confirm(t("harness.drive.disconnectConfirm"))) return;
    setError(null);
    setMessage(null);
    try {
      const result = await drive().disconnect();
      if (!result.ok) {
        setError(result.error ?? t("harness.drive.disconnectFailed"));
        return;
      }
      setStatus({ connected: false });
      setFolders(null);
      setMessage(t("harness.drive.disconnected"));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("harness.drive.disconnectFailed"),
      );
    }
  }, [t]);

  const searchFolders = useCallback(async () => {
    if (searching || !connected) return;
    setSearching(true);
    setError(null);
    setMessage(null);
    try {
      // ★폴더 피커는 **비스코프** 조회다(scope 미지정). 사람이 자기 드라이브에서
      // 위키로 쓸 폴더를 고르는 화면이라, 여기에 프로젝트 스코프를 걸면 아직
      // 존재하지 않는 바인딩 때문에 아무것도 고를 수 없다.
      const result = await drive().search({
        nameContains: folderQuery.trim() || undefined,
        mimeTypes: [FOLDER_MIME],
        includeFolders: true,
        pageSize: FOLDER_PAGE_SIZE,
      });
      if (!result.ok) {
        setError(result.error);
        setFolders([]);
        return;
      }
      setFolders(
        result.result.files
          .filter((f) => f.isFolder)
          .map((f) => ({
            id: f.id,
            title: f.title,
            modifiedTime: f.modifiedTime,
          })),
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("harness.drive.loadError"),
      );
    } finally {
      setSearching(false);
    }
  }, [connected, folderQuery, searching, t]);

  const bindFolder = useCallback(
    async (folder: FolderOption) => {
      if (!projectId) {
        setError(t("harness.drive.needProject"));
        return;
      }
      setSavingBinding(true);
      setError(null);
      setMessage(null);
      try {
        const result = await drive().binding.set({
          projectId,
          folderId: folder.id,
          folderName: folder.title,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setBinding(result.binding);
        setFolders(null);
        setMessage(
          `${t("harness.drive.bound")} ${t(
            "harness.drive.appliesImmediately",
          )}`,
        );
      } catch (err) {
        setError(
          err instanceof Error ? err.message : t("harness.drive.bindFailed"),
        );
      } finally {
        setSavingBinding(false);
      }
    },
    [projectId, t],
  );

  const clearFolder = useCallback(async () => {
    if (!projectId) return;
    if (!window.confirm(t("harness.drive.clearConfirm"))) return;
    setError(null);
    setMessage(null);
    try {
      const result = await drive().binding.clear(projectId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setBinding(null);
      setMessage(t("harness.drive.cleared"));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("harness.drive.clearFailed"),
      );
    }
  }, [projectId, t]);

  /**
   * 에이전트가 보는 것과 **똑같은 경로**(scope: "project")로 한 번 조회해 본다.
   * 패널이 "저장됨" 만 말하고 실제 조회가 되는지는 devtools 로 확인해야 했던 게
   * 이 티켓 이전의 상태였다 — 그 확인을 화면 안으로 들여온다.
   */
  const previewScope = useCallback(async () => {
    if (!projectId || previewing) return;
    setPreviewing(true);
    setError(null);
    setMessage(null);
    try {
      const result = await drive().search({
        scope: "project",
        projectId,
        pageSize: FOLDER_PAGE_SIZE,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const count = result.result.files.length;
      const truncated = result.scope?.truncated
        ? ` ${t("harness.drive.previewTruncated", {
            count: String(result.scope.folderCount),
          })}`
        : "";
      setMessage(
        (count === 0
          ? t("harness.drive.previewEmpty")
          : t("harness.drive.previewOk", { count: String(count) })) + truncated,
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("harness.drive.loadError"),
      );
    } finally {
      setPreviewing(false);
    }
  }, [previewing, projectId, t]);

  return (
    <div className="border-b border-[#313244] bg-[#181825] px-4 py-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-[#cdd6f4]">
              {t("harness.drive.title")}
            </h3>
            <span
              className={`rounded px-2 py-0.5 text-[11px] ${badge.className}`}
            >
              {t(badge.labelKey)}
            </span>
          </div>
          <p className="text-xs text-[#6c7086]">
            {t("harness.drive.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            title={t("harness.drive.refreshTitle")}
            className="inline-flex h-8 w-8 items-center justify-center rounded border border-[#313244] text-[#bac2de] hover:border-[#45475a] hover:bg-[#313244] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={() => void connectAccount()}
            disabled={connecting || loading}
            className="inline-flex h-8 items-center gap-1.5 rounded border border-[#313244] px-2.5 text-xs text-[#bac2de] hover:border-[#45475a] hover:bg-[#313244] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {connecting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Link2 className="h-3.5 w-3.5" />
            )}
            {connecting
              ? t("harness.drive.connecting")
              : connected
                ? t("harness.drive.reconnect")
                : t("harness.drive.connect")}
          </button>
          {connected && (
            <button
              type="button"
              onClick={() => void disconnectAccount()}
              disabled={loading}
              title={t("harness.drive.disconnect")}
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

      {/* ── 유저 축: 어떤 구글 계정이 붙어 있는가 ── */}
      <div className="mb-3 flex items-center gap-2 rounded border border-[#313244] bg-[#1e1e2e] px-3 py-2 text-xs">
        <span className="text-[11px] uppercase text-[#6c7086]">
          {t("harness.drive.account")}
        </span>
        {connected ? (
          <span className="flex items-center gap-1.5 text-[#cdd6f4]">
            <CheckCircle2 className="h-3.5 w-3.5 text-[#a6e3a1]" />
            {status?.email ?? "Google"}
          </span>
        ) : (
          <span className="text-[#6c7086]">
            {t("harness.drive.accountNone")}
          </span>
        )}
      </div>

      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        <div className="flex items-center gap-2 rounded border border-[#313244] bg-[#1e1e2e] px-3 py-2 text-xs">
          <Mail className="h-3.5 w-3.5 text-[#89b4fa]" />
          <span className="text-[#bac2de]">{t("harness.drive.gmail")}</span>
          <span
            className={`ml-auto rounded px-2 py-0.5 text-[11px] ${
              gmailConnected
                ? "bg-[#a6e3a1]/15 text-[#a6e3a1]"
                : "bg-[#313244] text-[#bac2de]"
            }`}
          >
            {gmailConnected
              ? t("harness.drive.scopeReady")
              : t("harness.drive.scopeNeedsReconnect")}
          </span>
        </div>
        <div className="flex items-center gap-2 rounded border border-[#313244] bg-[#1e1e2e] px-3 py-2 text-xs">
          <CalendarDays className="h-3.5 w-3.5 text-[#cba6f7]" />
          <span className="text-[#bac2de]">{t("harness.drive.calendar")}</span>
          <span
            className={`ml-auto rounded px-2 py-0.5 text-[11px] ${
              calendarConnected
                ? "bg-[#a6e3a1]/15 text-[#a6e3a1]"
                : "bg-[#313244] text-[#bac2de]"
            }`}
          >
            {calendarConnected
              ? t("harness.drive.scopeReady")
              : t("harness.drive.scopeNeedsReconnect")}
          </span>
        </div>
      </div>

      {/* ── 프로젝트 축: 이 프로젝트의 위키 폴더 ── */}
      <div className="rounded border border-[#313244] bg-[#1e1e2e] px-3 py-2.5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[11px] uppercase text-[#6c7086]">
              {t("harness.drive.folderSection")}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs">
              <FolderOpen className="h-3.5 w-3.5 text-[#89b4fa]" />
              {binding ? (
                <span className="text-[#cdd6f4]">
                  {binding.folderName ?? binding.folderId}
                </span>
              ) : (
                <span className="text-[#6c7086]">
                  {projectId
                    ? t("harness.drive.folderNone")
                    : t("harness.drive.needProject")}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {binding && (
              <button
                type="button"
                onClick={() => void previewScope()}
                disabled={previewing || !connected}
                title={t("harness.drive.previewTitle")}
                className="inline-flex h-8 items-center gap-1.5 rounded border border-[#313244] px-2.5 text-xs text-[#bac2de] hover:border-[#45475a] hover:bg-[#313244] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {previewing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5" />
                )}
                {t("harness.drive.preview")}
              </button>
            )}
            {binding && (
              <button
                type="button"
                onClick={() => void clearFolder()}
                title={t("harness.drive.clearFolder")}
                className="inline-flex h-8 w-8 items-center justify-center rounded border border-[#313244] text-[#f38ba8] hover:border-[#f38ba8]/40 hover:bg-[#f38ba8]/10"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <p className="mb-2 text-[11px] text-[#6c7086]">
          {t("harness.drive.folderHint")}
        </p>

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={folderQuery}
            onChange={(e) => setFolderQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void searchFolders();
            }}
            disabled={!connected || !projectId}
            placeholder={t("harness.drive.searchPlaceholder")}
            spellCheck={false}
            className="h-9 flex-1 rounded border border-[#313244] bg-[#181825] px-2.5 text-xs text-[#cdd6f4] placeholder:text-[#6c7086] focus:border-[#89b4fa] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void searchFolders()}
            disabled={!connected || !projectId || searching}
            className="inline-flex h-9 items-center gap-1.5 rounded border border-[#313244] px-3 text-xs text-[#bac2de] hover:border-[#45475a] hover:bg-[#313244] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {searching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
            {searching
              ? t("harness.drive.searching")
              : t("harness.drive.searchFolders")}
          </button>
        </div>

        {folders !== null && (
          <ul className="mt-2 max-h-48 overflow-y-auto rounded border border-[#313244]">
            {folders.length === 0 ? (
              <li className="px-3 py-2 text-xs text-[#6c7086]">
                {t("harness.drive.noFolders")}
              </li>
            ) : (
              folders.map((folder) => (
                <li
                  key={folder.id}
                  className="flex items-center justify-between gap-2 border-b border-[#313244] px-3 py-2 last:border-b-0"
                >
                  <span className="flex min-w-0 items-center gap-1.5 text-xs text-[#cdd6f4]">
                    <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[#89b4fa]" />
                    <span className="truncate">{folder.title}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void bindFolder(folder)}
                    disabled={savingBinding || folder.id === binding?.folderId}
                    className="shrink-0 rounded border border-[#313244] px-2 py-1 text-[11px] text-[#bac2de] hover:border-[#89b4fa]/40 hover:bg-[#89b4fa]/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t("harness.drive.select")}
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
