import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  GitBranch,
  Link2,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { useTranslation } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";
import {
  ConnectorGuidePanel,
  ConnectorGuideStep,
  ConnectorGuideSteps,
} from "./ConnectorGuidePanel";

/**
 * Harness 탭 GitHub 연결 패널 — 티켓 leyZnPBHbHUl3H9sRTDF.
 *
 * ★필수 온보딩이 아니다. 협업/private repo 용 선택 연결이며 Harness 탭에만
 * 상시 노출한다. device OAuth 로 먼저 연결하고, 이후 GitHub App 권한은 같은
 * 신원 경로에서 자동 상속되는 엔드게임 모델을 가이드로 설명한다.
 *
 * ★시크릿 미수신: status 는 connected 불리언만. access token 은 IPC 응답에 없다.
 */

interface DeviceSession {
  sessionId: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  intervalSeconds: number;
}

interface GitHubConnectionPanelProps {
  embedded?: boolean;
}

function github(): GitHubAPI {
  return window.electronAPI.github;
}

function statusBadge(connected: boolean): {
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

export function GitHubConnectionPanel({
  embedded = false,
}: GitHubConnectionPanelProps) {
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

  const badge = useMemo(() => statusBadge(connected), [connected]);

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

  // device OAuth 폴링 — RepoConnectModal 과 동일 계약.
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
    <div
      className={
        embedded
          ? "rounded border border-[#313244] bg-[#1e1e2e] p-3"
          : "border-b border-[#313244] bg-[#181825] px-4 py-3"
      }
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-[#cdd6f4]" aria-hidden />
            <h3
              className={
                embedded
                  ? "text-xs font-medium text-[#bac2de]"
                  : "text-sm font-semibold text-[#cdd6f4]"
              }
            >
              {t("harness.github.title")}
            </h3>
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

      <div className="mb-1 flex items-center gap-2 rounded border border-[#313244] bg-[#1e1e2e] px-3 py-2 text-xs">
        <span className="text-[11px] uppercase text-[#6c7086]">
          {t("harness.github.account")}
        </span>
        {connected ? (
          <span className="flex items-center gap-1.5 text-[#cdd6f4]">
            <CheckCircle2 className="h-3.5 w-3.5 text-[#a6e3a1]" />
            {t("harness.github.accountConnected")}
          </span>
        ) : deviceSession ? (
          <span className="text-[#f9e2af]">{t("harness.github.waitingAuth")}</span>
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
