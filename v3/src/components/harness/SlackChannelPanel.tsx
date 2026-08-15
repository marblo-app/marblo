import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import { useProjectStore } from "../../stores/projectStore";
import { useTranslation } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";
import {
  ConnectorGuidePanel,
  ConnectorGuideStep,
  ConnectorGuideSteps,
} from "./ConnectorGuidePanel";

type InboundCapability = "read" | "trigger";

interface SlackChannelPreflight {
  ok: boolean;
  hasBotToken: boolean;
  hasAppToken: boolean;
  hasChannelId: boolean;
  botTokenValid: boolean;
  appTokenValid: boolean;
  channelIdValid: boolean;
  issues: string[];
}

// ★시크릿 원문 미포함 — botToken/appToken 은 hasBotToken/hasAppToken 불리언으로만
// 존재를 알린다. 렌더러가 저장된 토큰 값을 알 방법이 없다(#936 IPC 계약).
interface SlackChannelStatus {
  projectId: string;
  enabled: boolean;
  hasBotToken: boolean;
  hasAppToken: boolean;
  hasChannelId: boolean;
  channelId: string | null;
  inboundCapability: InboundCapability;
  preflight: SlackChannelPreflight;
  canEnable: boolean;
  active: boolean;
  secretsEncrypted: boolean;
}

interface SlackHealth {
  ok: boolean;
  botUserId: string | null;
  teamId: string | null;
  appTokenOk: boolean;
  error?: string;
}

interface SlackProbeResult extends SlackHealth {
  status?: SlackChannelStatus;
}

interface SlackChannelHealthReport {
  projectId: string;
  health: SlackHealth;
}

interface SlackChannelSetInput {
  projectId: string;
  botToken?: string | null;
  appToken?: string | null;
  channelId?: string | null;
  enabled?: boolean;
  inboundCapability?: InboundCapability;
}

interface SlackChannelAPI {
  list: () => Promise<SlackChannelStatus[]>;
  set: (input: SlackChannelSetInput) => Promise<SlackChannelStatus>;
  status: (projectId: string) => Promise<SlackChannelStatus>;
  remove: (projectId: string) => Promise<boolean>;
  probe: (projectId: string) => Promise<SlackProbeResult>;
  onHealth: (callback: (report: SlackChannelHealthReport) => void) => void;
  offHealth: () => void;
}

function slackChannel(): SlackChannelAPI {
  return (window.electronAPI as ElectronAPI & { slackChannel: SlackChannelAPI })
    .slackChannel;
}

function statusBadge(status: SlackChannelStatus | null): {
  labelKey: MessageKey;
  className: string;
} {
  if (!status) {
    return {
      labelKey: "harness.slack.status.idle",
      className: "bg-[#313244] text-[#6c7086]",
    };
  }
  if (status.active) {
    return {
      labelKey: "harness.slack.status.connected",
      className: "bg-[#a6e3a1]/15 text-[#a6e3a1]",
    };
  }
  if (status.enabled && !status.canEnable) {
    return {
      labelKey: "harness.slack.status.needsCheck",
      className: "bg-[#f9e2af]/15 text-[#f9e2af]",
    };
  }
  return {
    labelKey: "harness.slack.status.disconnected",
    className: "bg-[#313244] text-[#bac2de]",
  };
}

export function SlackChannelPanel() {
  const { t } = useTranslation();
  const currentProject = useProjectStore((s) => s.currentProject);
  const [status, setStatus] = useState<SlackChannelStatus | null>(null);
  const [channelId, setChannelId] = useState("");
  const [botToken, setBotToken] = useState("");
  const [appToken, setAppToken] = useState("");
  const [health, setHealth] = useState<SlackChannelHealthReport | null>(null);
  const [probeResult, setProbeResult] = useState<SlackProbeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const projectId = currentProject?.id;

  const loadChannel = useCallback(async () => {
    if (!projectId) {
      setStatus(null);
      setChannelId("");
      setError(null);
      setMessage(null);
      setProbeResult(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const nextStatus = await slackChannel().status(projectId);
      setStatus(nextStatus);
      setChannelId(nextStatus.channelId ?? "");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("harness.slack.loadError"),
      );
    } finally {
      setLoading(false);
    }
    // ★`t` 는 useTranslation() 렌더마다 새 함수 참조라, deps 에 넣으면 매
    // 렌더 loadChannel 이 재생성 → 아래 effect 가 매번 재실행되는 무한
    // 로딩 루프가 된다(텔레그램 패널과 동일하게 의도적으로 제외).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    void loadChannel();
    // 토큰 입력란은 write-only — 프로젝트가 바뀌면 이전 프로젝트에 입력해 둔
    // 값이 새 프로젝트로 새어 들어가면 안 된다.
    setBotToken("");
    setAppToken("");
    setProbeResult(null);
  }, [loadChannel]);

  useEffect(() => {
    if (!projectId) return;
    const api = slackChannel();
    const handleHealth = (report: SlackChannelHealthReport) => {
      if (report.projectId !== projectId) return;
      setHealth(report);
    };
    api.onHealth(handleHealth);
    return () => api.offHealth();
  }, [projectId]);

  const badge = useMemo(() => statusBadge(status), [status]);
  const trimmedChannelId = channelId.trim();
  const trimmedBotToken = botToken.trim();
  const trimmedAppToken = appToken.trim();
  const canToggleOn = !!trimmedChannelId && !!status?.canEnable;
  const toggleBlockedReason = !trimmedChannelId
    ? t("harness.slack.needChannelId")
    : status && !status.canEnable
      ? status.preflight.issues.join(" ")
      : "";

  const saveChannel = useCallback(
    async (nextEnabled = status?.enabled ?? false) => {
      if (!projectId) return;
      setSaving(true);
      setError(null);
      setMessage(null);
      try {
        const input: SlackChannelSetInput = {
          projectId,
          channelId: trimmedChannelId || null,
          enabled: nextEnabled,
          inboundCapability: status?.inboundCapability ?? "trigger",
        };
        // 빈 입력란은 "지운다"가 아니라 "기존값 유지"다 — 토큰 필드는 저장 뒤
        // 항상 비워지는 write-only 라, 여길 항상 보내면 다른 필드 저장(예: 토글)
        // 만 해도 매번 토큰이 날아간다.
        if (trimmedBotToken) input.botToken = trimmedBotToken;
        if (trimmedAppToken) input.appToken = trimmedAppToken;

        const nextStatus = await slackChannel().set(input);
        setStatus(nextStatus);
        setChannelId(nextStatus.channelId ?? "");
        setBotToken("");
        setAppToken("");
        setProbeResult(null);
        setMessage(t("harness.slack.saved"));
      } catch (err) {
        setError(
          err instanceof Error ? err.message : t("harness.slack.saveError"),
        );
      } finally {
        setSaving(false);
      }
    },
    [
      projectId,
      status?.enabled,
      status?.inboundCapability,
      t,
      trimmedAppToken,
      trimmedBotToken,
      trimmedChannelId,
    ],
  );

  const toggleEnabled = useCallback(async () => {
    if (!status || saving) return;
    const nextEnabled = !status.enabled;
    if (nextEnabled && !canToggleOn) return;
    await saveChannel(nextEnabled);
  }, [canToggleOn, saveChannel, saving, status]);

  const probeChannel = useCallback(async () => {
    if (!projectId || probing) return;
    setProbing(true);
    setError(null);
    setMessage(null);
    setProbeResult(null);
    try {
      const result = await slackChannel().probe(projectId);
      setProbeResult(result);
      if (!result.ok) {
        setError(result.error ?? t("harness.slack.probeFailed"));
      } else {
        setMessage(t("harness.slack.probeOk"));
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("harness.slack.probeFailed"),
      );
    } finally {
      setProbing(false);
    }
  }, [probing, projectId, t]);

  const removeChannel = useCallback(async () => {
    if (!projectId || removing) return;
    const confirmed = window.confirm(t("harness.slack.removeConfirm"));
    if (!confirmed) return;
    setRemoving(true);
    setError(null);
    setMessage(null);
    try {
      await slackChannel().remove(projectId);
      setStatus(null);
      setChannelId("");
      setBotToken("");
      setAppToken("");
      setProbeResult(null);
      setHealth(null);
      setMessage(t("harness.slack.removed"));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("harness.slack.removeError"),
      );
    } finally {
      setRemoving(false);
    }
  }, [projectId, removing, t]);

  return (
    <div className="border-b border-[#313244] bg-[#181825] px-4 py-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-[#cdd6f4]">
              {t("harness.slack.title")}
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
            title={t("harness.slack.refreshTitle")}
            className="inline-flex h-8 w-8 items-center justify-center rounded border border-[#313244] text-[#bac2de] hover:border-[#45475a] hover:bg-[#313244] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={() => void probeChannel()}
            disabled={probing || loading || !projectId || !status?.hasBotToken}
            title={t("harness.slack.probeTitle")}
            className="inline-flex h-8 items-center gap-1.5 rounded border border-[#313244] px-2.5 text-xs text-[#bac2de] hover:border-[#45475a] hover:bg-[#313244] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {probing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5" />
            )}
            {t("harness.slack.probe")}
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
            title={toggleBlockedReason || t("harness.slack.enableTitle")}
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
              ? t("harness.slack.enabled")
              : t("harness.slack.disabled")}
          </button>
          {status && (
            <button
              type="button"
              onClick={() => void removeChannel()}
              disabled={removing || saving || loading}
              title={t("harness.slack.remove")}
              className="inline-flex h-8 w-8 items-center justify-center rounded border border-[#313244] text-[#f38ba8] hover:border-[#f38ba8]/40 hover:bg-[#f38ba8]/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {removing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
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

      {loading ? (
        <div className="flex h-24 items-center justify-center text-xs text-[#6c7086]">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {t("harness.slack.loading")}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase text-[#6c7086]">
              Channel ID
            </span>
            <input
              type="text"
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              disabled={!projectId || saving}
              placeholder={t("harness.slack.channelIdPlaceholder")}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className="h-9 w-full rounded border border-[#313244] bg-[#1e1e2e] px-2.5 text-xs text-[#cdd6f4] placeholder:text-[#6c7086] focus:border-[#89b4fa] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>
          <label className="block">
            <span className="mb-1 flex items-center gap-1 text-[11px] uppercase text-[#6c7086]">
              Bot Token
              {status?.hasBotToken && (
                <CheckCircle2 className="h-3 w-3 text-[#a6e3a1]" />
              )}
            </span>
            <input
              type="password"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              disabled={!projectId || saving}
              placeholder={
                status?.hasBotToken
                  ? t("harness.slack.tokenSavedPlaceholder")
                  : "xoxb-..."
              }
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className="h-9 w-full rounded border border-[#313244] bg-[#1e1e2e] px-2.5 text-xs text-[#cdd6f4] placeholder:text-[#6c7086] focus:border-[#89b4fa] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>
          <label className="block">
            <span className="mb-1 flex items-center gap-1 text-[11px] uppercase text-[#6c7086]">
              App Token
              {status?.hasAppToken && (
                <CheckCircle2 className="h-3 w-3 text-[#a6e3a1]" />
              )}
            </span>
            <input
              type="password"
              value={appToken}
              onChange={(e) => setAppToken(e.target.value)}
              disabled={!projectId || saving}
              placeholder={
                status?.hasAppToken
                  ? t("harness.slack.tokenSavedPlaceholder")
                  : "xapp-..."
              }
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
              {t("harness.slack.save")}
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
      {status?.hasBotToken && !status.secretsEncrypted && (
        <p className="mt-2 text-[11px] leading-4 text-[#f9e2af]">
          {t("harness.slack.secretsNotEncrypted")}
        </p>
      )}

      {probeResult && (
        <div
          className={`mt-3 rounded border px-3 py-2 text-[11px] leading-5 ${
            probeResult.ok
              ? "border-[#a6e3a1]/30 bg-[#a6e3a1]/10 text-[#a6e3a1]"
              : "border-[#f38ba8]/30 bg-[#f38ba8]/10 text-[#f38ba8]"
          }`}
        >
          <p className="font-medium">
            {probeResult.ok
              ? t("harness.slack.probeResultOk")
              : t("harness.slack.probeResultFail")}
          </p>
          {probeResult.ok && (
            <p className="mt-1 text-[#bac2de]">
              {t("harness.slack.probeTeam", {
                team: probeResult.teamId ?? "?",
                bot: probeResult.botUserId ?? "?",
              })}
              {" · "}
              {probeResult.appTokenOk
                ? t("harness.slack.probeAppTokenOk")
                : t("harness.slack.probeAppTokenSkipped")}
            </p>
          )}
          {probeResult.error && <p className="mt-1">{probeResult.error}</p>}
        </div>
      )}

      {health && health.projectId === projectId && !health.health.ok && (
        <p className="mt-2 text-[11px] leading-4 text-[#f9e2af]">
          {t("harness.slack.healthError", {
            error: health.health.error ?? "",
          })}
        </p>
      )}

      <ConnectorGuidePanel toggleLabel={t("harness.slack.guide.toggle")}>
        <ConnectorGuideSteps>
          <ConnectorGuideStep>
            1. {t("harness.slack.guide.step1Before")}
            <a
              href="https://api.slack.com/apps"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#89b4fa] hover:underline"
            >
              api.slack.com/apps
            </a>
            {t("harness.slack.guide.step1After")}
          </ConnectorGuideStep>
          <ConnectorGuideStep>
            2. {t("harness.slack.guide.step2")}
          </ConnectorGuideStep>
          <ConnectorGuideStep>
            3. {t("harness.slack.guide.step3")}
          </ConnectorGuideStep>
          <ConnectorGuideStep>
            4. {t("harness.slack.guide.step4")}
          </ConnectorGuideStep>
          <ConnectorGuideStep>
            5. {t("harness.slack.guide.step5")}
          </ConnectorGuideStep>
          <ConnectorGuideStep>
            6. {t("harness.slack.guide.step6")}
          </ConnectorGuideStep>
          <ConnectorGuideStep>
            7. {t("harness.slack.guide.step7")}
          </ConnectorGuideStep>
        </ConnectorGuideSteps>
        <div className="rounded border border-[#313244] bg-[#181825] px-3 py-2">
          <p className="mb-1 text-xs font-medium text-[#cdd6f4]">
            {t("harness.slack.channelIdGuide.title")}
          </p>
          <p>{t("harness.slack.channelIdGuide.body")}</p>
        </div>
      </ConnectorGuidePanel>
    </div>
  );
}
