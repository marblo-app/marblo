import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, Save, XCircle } from "lucide-react";
import { useProjectStore } from "../../stores/projectStore";

type InboundCapability = "read" | "trigger";

interface TelegramChannelConfig {
  projectId: string;
  botToken: string | null;
  chatId: string | null;
  enabled: boolean;
  inboundCapability: InboundCapability;
  updatedAt: number;
}

interface ChannelStatus {
  projectId: string;
  enabled: boolean;
  hasBotToken: boolean;
  hasChatId: boolean;
  preflight: {
    ok: boolean;
    hasBotToken: boolean;
    hasChatId: boolean;
    botTokenValid: boolean;
    chatIdValid: boolean;
    issues: string[];
  };
  canEnable: boolean;
  active: boolean;
}

interface TelegramChannelAPI {
  get: (projectId: string) => Promise<TelegramChannelConfig | null>;
  set: (input: {
    projectId: string;
    botToken?: string | null;
    chatId?: string | null;
    enabled?: boolean;
    inboundCapability?: InboundCapability;
  }) => Promise<ChannelStatus>;
  status: (projectId: string) => Promise<ChannelStatus>;
}

function telegramChannel(): TelegramChannelAPI {
  return (
    window.electronAPI as ElectronAPI & { telegramChannel: TelegramChannelAPI }
  ).telegramChannel;
}

function statusBadge(status: ChannelStatus | null): {
  label: string;
  className: string;
} {
  if (!status) {
    return { label: "대기", className: "bg-[#313244] text-[#6c7086]" };
  }
  if (status.active) {
    return { label: "연결", className: "bg-[#a6e3a1]/15 text-[#a6e3a1]" };
  }
  if (status.enabled && !status.canEnable) {
    return { label: "확인 필요", className: "bg-[#f9e2af]/15 text-[#f9e2af]" };
  }
  return { label: "미연결", className: "bg-[#313244] text-[#bac2de]" };
}

export function TelegramChannelPanel() {
  const currentProject = useProjectStore((s) => s.currentProject);
  const [config, setConfig] = useState<TelegramChannelConfig | null>(null);
  const [status, setStatus] = useState<ChannelStatus | null>(null);
  const [chatId, setChatId] = useState("");
  const [botToken, setBotToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const projectId = currentProject?.id;

  const loadChannel = useCallback(async () => {
    if (!projectId) {
      setConfig(null);
      setStatus(null);
      setChatId("");
      setBotToken("");
      setError(null);
      setMessage(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [nextConfig, nextStatus] = await Promise.all([
        telegramChannel().get(projectId),
        telegramChannel().status(projectId),
      ]);
      setConfig(nextConfig);
      setStatus(nextStatus);
      setChatId(nextConfig?.chatId ?? "");
      setBotToken(nextConfig?.botToken ?? "");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "텔레그램 채널 상태를 불러오지 못했습니다.",
      );
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadChannel();
  }, [loadChannel]);

  const badge = useMemo(() => statusBadge(status), [status]);
  const trimmedChatId = chatId.trim();
  const trimmedBotToken = botToken.trim();
  const canToggleOn = !!trimmedChatId && !!status?.canEnable;
  const toggleBlockedReason = !trimmedChatId
    ? "chatId 를 저장해야 활성화할 수 있습니다."
    : status && !status.canEnable
      ? status.preflight.issues.join(" ")
      : "";

  const refreshAfterSave = useCallback(async () => {
    if (!projectId) return;
    const [nextConfig, nextStatus] = await Promise.all([
      telegramChannel().get(projectId),
      telegramChannel().status(projectId),
    ]);
    setConfig(nextConfig);
    setStatus(nextStatus);
    setChatId(nextConfig?.chatId ?? "");
    setBotToken(nextConfig?.botToken ?? "");
  }, [projectId]);

  const saveChannel = useCallback(
    async (nextEnabled = status?.enabled ?? false) => {
      if (!projectId) return;
      setSaving(true);
      setError(null);
      setMessage(null);
      try {
        await telegramChannel().set({
          projectId,
          chatId: trimmedChatId || null,
          botToken: trimmedBotToken || null,
          enabled: nextEnabled,
          inboundCapability: config?.inboundCapability ?? "trigger",
        });
        await refreshAfterSave();
        setMessage("채널 설정을 저장했습니다.");
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "채널 설정 저장에 실패했습니다.",
        );
      } finally {
        setSaving(false);
      }
    },
    [
      config?.inboundCapability,
      projectId,
      refreshAfterSave,
      status?.enabled,
      trimmedBotToken,
      trimmedChatId,
    ],
  );

  const toggleEnabled = useCallback(async () => {
    if (!status || saving) return;
    const nextEnabled = !status.enabled;
    if (nextEnabled && !canToggleOn) return;
    await saveChannel(nextEnabled);
  }, [canToggleOn, saveChannel, saving, status]);

  return (
    <div className="border-b border-[#313244] bg-[#181825] px-4 py-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-[#cdd6f4]">채널 연결</h3>
            <span
              className={`rounded px-2 py-0.5 text-[11px] ${badge.className}`}
            >
              {badge.label}
            </span>
          </div>
          <p className="text-xs text-[#6c7086]">
            {currentProject?.name ?? "프로젝트 미선택"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadChannel()}
            disabled={loading || saving || !projectId}
            title="채널 상태 새로고침"
            className="inline-flex h-8 w-8 items-center justify-center rounded border border-[#313244] text-[#bac2de] hover:border-[#45475a] hover:bg-[#313244] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={status?.enabled ?? false}
            onClick={() => void toggleEnabled()}
            disabled={
              saving ||
              loading ||
              !projectId ||
              (status?.enabled ? false : !canToggleOn)
            }
            title={toggleBlockedReason || "텔레그램 채널 활성화"}
            className={`inline-flex h-8 items-center gap-2 rounded border px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              status?.enabled
                ? "border-[#a6e3a1]/40 bg-[#a6e3a1]/15 text-[#a6e3a1]"
                : "border-[#313244] text-[#bac2de] hover:border-[#45475a] hover:bg-[#313244]"
            }`}
          >
            {status?.enabled ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <XCircle className="h-3.5 w-3.5" />
            )}
            {status?.enabled ? "활성" : "비활성"}
          </button>
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

      {loading ? (
        <div className="flex h-24 items-center justify-center text-xs text-[#6c7086]">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          채널 상태 확인 중
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase text-[#6c7086]">
              Chat ID
            </span>
            <input
              type="text"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              disabled={!projectId || saving}
              placeholder="@channel 또는 chatId"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className="h-9 w-full rounded border border-[#313244] bg-[#1e1e2e] px-2.5 text-xs text-[#cdd6f4] placeholder:text-[#6c7086] focus:border-[#89b4fa] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase text-[#6c7086]">
              Bot Token
            </span>
            <input
              type="password"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              disabled={!projectId || saving}
              placeholder="123456:ABC..."
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className="h-9 w-full rounded border border-[#313244] bg-[#1e1e2e] px-2.5 text-xs text-[#cdd6f4] placeholder:text-[#6c7086] focus:border-[#89b4fa] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => void saveChannel()}
              disabled={!projectId || saving}
              className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded bg-[#89b4fa]/20 px-3 text-xs font-medium text-[#89b4fa] hover:bg-[#89b4fa]/30 disabled:cursor-not-allowed disabled:opacity-50 md:w-auto"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              저장
            </button>
          </div>
        </div>
      )}

      {toggleBlockedReason && !status?.enabled && (
        <p className="mt-2 text-[11px] leading-4 text-[#f9e2af]">
          {toggleBlockedReason}
        </p>
      )}
      {status?.preflight.issues.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {status.preflight.issues.map((issue) => (
            <span
              key={issue}
              className="rounded bg-[#313244] px-2 py-0.5 text-[11px] text-[#bac2de]"
            >
              {issue}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
