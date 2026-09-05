import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, Save, XCircle } from "lucide-react";
import { useProjectStore } from "../../stores/projectStore";
import { useTranslation } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";
import {
  ConnectorGuidePanel,
  ConnectorGuideStep,
  ConnectorGuideSteps,
} from "./ConnectorGuidePanel";

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

/**
 * ★지금 이 봇을 누가 물고 있는가 (티켓 hAzP05kOTxggd8LhZGwT).
 *
 * 두 맥이 같은 봇을 동시에 폴링하면 서로를 409 로 강탈해 인바운드가 동전던지기가
 * 된다. 그 사실이 지금까지는 electron 콘솔의 log.warn 으로만 나가서 사용자가
 * 전혀 볼 수 없었다 — 이 타입이 그것을 화면까지 실어 온다. 토큰도 chatId 도
 * 들어 있지 않다.
 */
type TelegramContentionKind = "none" | "other-device" | "foreign-consumer";

interface TelegramContention {
  projectId: string;
  kind: TelegramContentionKind;
  /** other-device 일 때 상대 기기 이름. */
  hostLabel: string | null;
  /** other-device 일 때 상대 리스의 마지막 갱신 시각(epoch ms). */
  renewedAt: number | null;
  consecutive409: number;
  since409: number | null;
  /** 기기 간 리스 가드가 꺼진 채 돌고 있는가(리스를 읽지 못함). */
  leaseFailOpen: boolean;
  leasePhase: "unknown" | "owner" | "fail-open" | "blocked";
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
  contention: (projectId: string) => Promise<TelegramContention>;
}

function telegramChannel(): TelegramChannelAPI {
  return (
    window.electronAPI as ElectronAPI & { telegramChannel: TelegramChannelAPI }
  ).telegramChannel;
}

function statusBadge(
  status: ChannelStatus | null,
  contention: TelegramContention | null,
): {
  labelKey: MessageKey;
  className: string;
} {
  // ★경합은 "연결됨" 보다 우선한다. 다른 기기가 물고 있는 동안에도 설정은
  // 멀쩡히 enabled/active 이므로, 그것만 보면 배지가 초록으로 남아 "연결돼
  // 있는데 왜 메시지가 안 오지"가 된다 — 그게 정확히 이 티켓의 증상이다.
  if (contention && contention.kind !== "none") {
    return {
      labelKey:
        contention.kind === "other-device"
          ? "harness.telegram.status.otherDevice"
          : "harness.telegram.status.foreignConsumer",
      className: "bg-[#f9e2af]/15 text-[#f9e2af]",
    };
  }
  if (!status) {
    return {
      labelKey: "harness.telegram.status.idle",
      className: "bg-[#313244] text-[#6c7086]",
    };
  }
  if (status.active) {
    return {
      labelKey: "harness.telegram.status.connected",
      className: "bg-[#a6e3a1]/15 text-[#a6e3a1]",
    };
  }
  if (status.enabled && !status.canEnable) {
    return {
      labelKey: "harness.telegram.status.needsCheck",
      className: "bg-[#f9e2af]/15 text-[#f9e2af]",
    };
  }
  return {
    labelKey: "harness.telegram.status.disconnected",
    className: "bg-[#313244] text-[#bac2de]",
  };
}

export function TelegramChannelPanel() {
  const { t } = useTranslation();
  const currentProject = useProjectStore((s) => s.currentProject);
  const [config, setConfig] = useState<TelegramChannelConfig | null>(null);
  const [status, setStatus] = useState<ChannelStatus | null>(null);
  const [chatId, setChatId] = useState("");
  const [botToken, setBotToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [contention, setContention] = useState<TelegramContention | null>(null);

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
        err instanceof Error ? err.message : t("harness.telegram.loadError"),
      );
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadChannel();
  }, [loadChannel]);

  /**
   * ★경합 상태 폴링 (티켓 hAzP05kOTxggd8LhZGwT). 상태 배지/배너가 읽는 값이며
   * 메인의 리스 게이트가 사실상의 단일 진실원이다. 15초 주기인 이유: 리스 갱신이
   * 30초, 만료가 90초라 그보다 촘촘하면 배너가 실제 상태보다 앞서 흔들리고,
   * 더 성기면 다른 기기가 꺼진 뒤 "이제 이 기기가 받는다"가 늦게 보인다.
   */
  useEffect(() => {
    if (!projectId) {
      setContention(null);
      return;
    }
    let cancelled = false;
    const read = async () => {
      try {
        const next = await telegramChannel().contention(projectId);
        if (!cancelled) setContention(next);
      } catch {
        // 경합 조회 실패가 패널 전체를 에러로 만들면 안 된다 — 부가 정보다.
        if (!cancelled) setContention(null);
      }
    };
    void read();
    const timer = setInterval(() => void read(), 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [projectId]);

  const badge = useMemo(
    () => statusBadge(status, contention),
    [status, contention],
  );

  /** 배너 문구. 경합이 없으면 null — 평소에는 아무 것도 뜨지 않는다. */
  const contentionNotice = useMemo(() => {
    if (!contention || contention.kind === "none") return null;
    if (contention.kind === "other-device") {
      return t("harness.telegram.contention.otherDevice", {
        host: contention.hostLabel ?? t("harness.telegram.contention.unknownHost"),
        at: contention.renewedAt
          ? new Date(contention.renewedAt).toLocaleTimeString()
          : "-",
      });
    }
    return t("harness.telegram.contention.foreignConsumer", {
      count: contention.consecutive409,
    });
  }, [contention, t]);
  const trimmedChatId = chatId.trim();
  const trimmedBotToken = botToken.trim();
  const canToggleOn = !!trimmedChatId && !!status?.canEnable;
  const toggleBlockedReason = !trimmedChatId
    ? t("harness.telegram.needChatId")
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
        setMessage(t("harness.telegram.saved"));
      } catch (err) {
        setError(
          err instanceof Error ? err.message : t("harness.telegram.saveError"),
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
            <h3 className="text-sm font-semibold text-[#cdd6f4]">
              {t("harness.telegram.title")}
            </h3>
            <span
              className={`rounded px-2 py-0.5 text-[11px] ${badge.className}`}
            >
              {t(badge.labelKey)}
            </span>
          </div>
          <p className="text-xs text-[#6c7086]">
            {currentProject?.name ?? t("harness.conn.noProject")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadChannel()}
            disabled={loading || saving || !projectId}
            title={t("harness.telegram.refreshTitle")}
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
            title={toggleBlockedReason || t("harness.telegram.enableTitle")}
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
            {status?.enabled
              ? t("harness.telegram.enabled")
              : t("harness.telegram.disabled")}
          </button>
        </div>
      </div>

      {/*
        ★경합 배너 (티켓 hAzP05kOTxggd8LhZGwT). 두 문구를 반드시 구분한다 —
        대응이 정반대이기 때문이다. 다른 마블로 기기가 물고 있으면 사용자가
        할 일은 없다(그 기기가 받고 있고, 꺼지면 자동으로 넘어온다). 리스 밖의
        제3자면 사용자가 그 프로세스를 직접 찾아 꺼야 한다.
      */}
      {contentionNotice && (
        <div className="mb-3 rounded border border-[#f9e2af]/30 bg-[#f9e2af]/10 px-3 py-2 text-xs leading-5 text-[#f9e2af]">
          {contentionNotice}
        </div>
      )}
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
          {t("harness.telegram.loading")}
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
              placeholder={t("harness.telegram.chatIdPlaceholder")}
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
              {t("harness.telegram.save")}
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

      <ConnectorGuidePanel toggleLabel={t("harness.telegram.guide.toggle")}>
        <ConnectorGuideSteps>
          <ConnectorGuideStep>
            1. {t("harness.telegram.guide.step1Before")}
            <a
              href="https://t.me/BotFather"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#89b4fa] hover:underline"
            >
              @BotFather
            </a>
            {t("harness.telegram.guide.step1After")}
          </ConnectorGuideStep>
          <ConnectorGuideStep>
            2. {t("harness.telegram.guide.step2")}
          </ConnectorGuideStep>
          <ConnectorGuideStep>
            3. {t("harness.telegram.guide.step3")}
          </ConnectorGuideStep>
          <ConnectorGuideStep>
            4. {t("harness.telegram.guide.step4")}
          </ConnectorGuideStep>
        </ConnectorGuideSteps>
        <div className="rounded border border-[#313244] bg-[#181825] px-3 py-2">
          <p className="mb-1 text-xs font-medium text-[#cdd6f4]">
            {t("harness.telegram.chatIdGuide.title")}
          </p>
          <p className="mb-2">{t("harness.telegram.chatIdGuide.before")}</p>
          <pre className="overflow-x-auto rounded bg-[#11111b] px-3 py-2 text-[11px] leading-5 text-[#cdd6f4]">
            <code>{`curl -s "https://api.telegram.org/bot<BOT_TOKEN>/getUpdates"`}</code>
          </pre>
          <p className="mt-2">{t("harness.telegram.chatIdGuide.after")}</p>
        </div>
        <div className="rounded border border-[#313244] bg-[#181825] px-3 py-2">
          <p className="mb-1 text-xs font-medium text-[#cdd6f4]">
            {t("harness.telegram.plugin.title")}
          </p>
          <p>
            <code className="rounded bg-[#313244] px-1.5 py-0.5 text-[#cdd6f4]">
              --channels plugin:telegram@claude-plugins-official
            </code>
            {t("harness.telegram.plugin.descAfter")}
          </p>
        </div>
      </ConnectorGuidePanel>
    </div>
  );
}
