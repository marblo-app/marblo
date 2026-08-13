import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Database,
  FileText,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useProjectStore } from "../../stores/projectStore";
import { useTranslation } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";

const PAGE_SIZE = 20;

function notion(): NotionAPI {
  return window.electronAPI.notion;
}

function statusBadge(
  connected: boolean,
  bound: boolean,
): { labelKey: MessageKey; className: string } {
  if (!connected) {
    return {
      labelKey: "harness.notion.status.disconnected",
      className: "bg-[#313244] text-[#bac2de]",
    };
  }
  if (!bound) {
    return {
      labelKey: "harness.notion.status.needsBinding",
      className: "bg-[#f9e2af]/15 text-[#f9e2af]",
    };
  }
  return {
    labelKey: "harness.notion.status.bound",
    className: "bg-[#a6e3a1]/15 text-[#a6e3a1]",
  };
}

export function NotionConnectionPanel() {
  const { t } = useTranslation();
  const currentProject = useProjectStore((s) => s.currentProject);
  const projectId = currentProject?.id;

  const [status, setStatus] = useState<NotionConnectionStatus | null>(null);
  const [binding, setBinding] = useState<NotionProjectBinding | null>(null);
  const [token, setToken] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NotionObjectMeta[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [searching, setSearching] = useState(false);
  const [savingBinding, setSavingBinding] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const connected = status?.connected === true;
  const badge = useMemo(
    () => statusBadge(connected, !!binding),
    [connected, binding],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await notion().status());
      setBinding(projectId ? await notion().binding.get(projectId) : null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("harness.notion.loadError"),
      );
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    void load();
    setResults(null);
    setQuery("");
    setMessage(null);
  }, [load]);

  const connect = useCallback(async () => {
    if (connecting) return;
    setConnecting(true);
    setError(null);
    setMessage(null);
    try {
      const result = await notion().connect({
        accessToken: token,
        workspaceName: workspaceName.trim() || undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setStatus(result.status);
      setToken("");
      setMessage(t("harness.notion.connected"));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("harness.notion.connectFailed"),
      );
    } finally {
      setConnecting(false);
    }
  }, [connecting, t, token, workspaceName]);

  const disconnect = useCallback(async () => {
    if (!window.confirm(t("harness.notion.disconnectConfirm"))) return;
    setError(null);
    setMessage(null);
    try {
      const result = await notion().disconnect();
      if (!result.ok) {
        setError(result.error ?? t("harness.notion.disconnectFailed"));
        return;
      }
      setStatus({ connected: false });
      setResults(null);
      setMessage(t("harness.notion.disconnected"));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("harness.notion.disconnectFailed"),
      );
    }
  }, [t]);

  const search = useCallback(async () => {
    if (searching || !connected) return;
    setSearching(true);
    setError(null);
    setMessage(null);
    try {
      const result = await notion().search({
        query: query.trim() || undefined,
        pageSize: PAGE_SIZE,
      });
      if (!result.ok) {
        setError(result.error);
        setResults([]);
        return;
      }
      setResults(result.result.results);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("harness.notion.loadError"),
      );
    } finally {
      setSearching(false);
    }
  }, [connected, query, searching, t]);

  const bind = useCallback(
    async (item: NotionObjectMeta) => {
      if (!projectId) {
        setError(t("harness.notion.needProject"));
        return;
      }
      setSavingBinding(true);
      setError(null);
      setMessage(null);
      try {
        const result = await notion().binding.set({
          projectId,
          objectId: item.id,
          objectKind: item.object,
          title: item.title,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setBinding(result.binding);
        setResults(null);
        setMessage(
          `${t("harness.notion.bound")} ${t(
            "harness.notion.appliesImmediately",
          )}`,
        );
      } catch (err) {
        setError(
          err instanceof Error ? err.message : t("harness.notion.bindFailed"),
        );
      } finally {
        setSavingBinding(false);
      }
    },
    [projectId, t],
  );

  const clear = useCallback(async () => {
    if (!projectId) return;
    if (!window.confirm(t("harness.notion.clearConfirm"))) return;
    setError(null);
    setMessage(null);
    try {
      const result = await notion().binding.clear(projectId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setBinding(null);
      setMessage(t("harness.notion.cleared"));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("harness.notion.clearFailed"),
      );
    }
  }, [projectId, t]);

  const preview = useCallback(async () => {
    if (!projectId || previewing) return;
    setPreviewing(true);
    setError(null);
    setMessage(null);
    try {
      const result = await notion().search({
        scope: "project",
        projectId,
        pageSize: PAGE_SIZE,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const count = result.result.results.length;
      setMessage(
        count === 0
          ? t("harness.notion.previewEmpty")
          : t("harness.notion.previewOk", { count: String(count) }),
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("harness.notion.loadError"),
      );
    } finally {
      setPreviewing(false);
    }
  }, [previewing, projectId, t]);

  const boundLabel = binding
    ? `${binding.objectKind === "database" ? "DB" : "Page"} · ${
        binding.title ?? binding.objectId
      }`
    : null;

  return (
    <div className="border-b border-[#313244] bg-[#181825] px-4 py-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-[#cdd6f4]">
              {t("harness.notion.title")}
            </h3>
            <span
              className={`rounded px-2 py-0.5 text-[11px] ${badge.className}`}
            >
              {t(badge.labelKey)}
            </span>
          </div>
          <p className="text-xs text-[#6c7086]">
            {t("harness.notion.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            title={t("harness.notion.refreshTitle")}
            className="inline-flex h-8 w-8 items-center justify-center rounded border border-[#313244] text-[#bac2de] hover:border-[#45475a] hover:bg-[#313244] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          {connected && (
            <button
              type="button"
              onClick={() => void disconnect()}
              disabled={loading}
              title={t("harness.notion.disconnect")}
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

      <div className="mb-3 rounded border border-[#313244] bg-[#1e1e2e] px-3 py-2.5">
        <div className="mb-2 flex items-center gap-2 text-xs">
          <span className="text-[11px] uppercase text-[#6c7086]">
            {t("harness.notion.account")}
          </span>
          {connected ? (
            <span className="flex items-center gap-1.5 text-[#cdd6f4]">
              <CheckCircle2 className="h-3.5 w-3.5 text-[#a6e3a1]" />
              {status?.workspaceName ?? "Notion"}
            </span>
          ) : (
            <span className="text-[#6c7086]">
              {t("harness.notion.accountNone")}
            </span>
          )}
        </div>
        <div className="grid gap-2 md:grid-cols-[1fr_180px_auto]">
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={t("harness.notion.tokenPlaceholder")}
            spellCheck={false}
            className="h-9 rounded border border-[#313244] bg-[#181825] px-2.5 text-xs text-[#cdd6f4] placeholder:text-[#6c7086] focus:border-[#89b4fa] focus:outline-none"
          />
          <input
            type="text"
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
            placeholder={t("harness.notion.workspacePlaceholder")}
            spellCheck={false}
            className="h-9 rounded border border-[#313244] bg-[#181825] px-2.5 text-xs text-[#cdd6f4] placeholder:text-[#6c7086] focus:border-[#89b4fa] focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void connect()}
            disabled={connecting || !token.trim()}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded border border-[#313244] px-3 text-xs text-[#bac2de] hover:border-[#45475a] hover:bg-[#313244] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {connecting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Link2 className="h-3.5 w-3.5" />
            )}
            {connected
              ? t("harness.notion.reconnect")
              : t("harness.notion.connect")}
          </button>
        </div>
      </div>

      <div className="rounded border border-[#313244] bg-[#1e1e2e] px-3 py-2.5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[11px] uppercase text-[#6c7086]">
              {t("harness.notion.bindingSection")}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs">
              {binding?.objectKind === "database" ? (
                <Database className="h-3.5 w-3.5 text-[#89b4fa]" />
              ) : (
                <FileText className="h-3.5 w-3.5 text-[#89b4fa]" />
              )}
              {boundLabel ? (
                <span className="text-[#cdd6f4]">{boundLabel}</span>
              ) : (
                <span className="text-[#6c7086]">
                  {projectId
                    ? t("harness.notion.bindingNone")
                    : t("harness.notion.needProject")}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {binding && (
              <button
                type="button"
                onClick={() => void preview()}
                disabled={previewing || !connected}
                title={t("harness.notion.previewTitle")}
                className="inline-flex h-8 items-center gap-1.5 rounded border border-[#313244] px-2.5 text-xs text-[#bac2de] hover:border-[#45475a] hover:bg-[#313244] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {previewing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5" />
                )}
                {t("harness.notion.preview")}
              </button>
            )}
            {binding && (
              <button
                type="button"
                onClick={() => void clear()}
                title={t("harness.notion.clearBinding")}
                className="inline-flex h-8 w-8 items-center justify-center rounded border border-[#313244] text-[#f38ba8] hover:border-[#f38ba8]/40 hover:bg-[#f38ba8]/10"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        <p className="mb-2 text-[11px] text-[#6c7086]">
          {t("harness.notion.bindingHint")}
        </p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void search();
            }}
            disabled={!connected || !projectId}
            placeholder={t("harness.notion.searchPlaceholder")}
            spellCheck={false}
            className="h-9 flex-1 rounded border border-[#313244] bg-[#181825] px-2.5 text-xs text-[#cdd6f4] placeholder:text-[#6c7086] focus:border-[#89b4fa] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void search()}
            disabled={!connected || !projectId || searching}
            className="inline-flex h-9 items-center gap-1.5 rounded border border-[#313244] px-3 text-xs text-[#bac2de] hover:border-[#45475a] hover:bg-[#313244] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {searching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
            {searching
              ? t("harness.notion.searching")
              : t("harness.notion.search")}
          </button>
        </div>
        {results !== null && (
          <ul className="mt-2 max-h-48 overflow-y-auto rounded border border-[#313244]">
            {results.length === 0 ? (
              <li className="px-3 py-2 text-xs text-[#6c7086]">
                {t("harness.notion.noResults")}
              </li>
            ) : (
              results.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-2 border-b border-[#313244] px-3 py-2 last:border-b-0"
                >
                  <span className="flex min-w-0 items-center gap-1.5 text-xs text-[#cdd6f4]">
                    {item.object === "database" ? (
                      <Database className="h-3.5 w-3.5 shrink-0 text-[#89b4fa]" />
                    ) : (
                      <FileText className="h-3.5 w-3.5 shrink-0 text-[#89b4fa]" />
                    )}
                    <span className="truncate">{item.title}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void bind(item)}
                    disabled={savingBinding || item.id === binding?.objectId}
                    className="shrink-0 rounded border border-[#313244] px-2 py-1 text-[11px] text-[#bac2de] hover:border-[#89b4fa]/40 hover:bg-[#89b4fa]/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t("harness.notion.select")}
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
