import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clipboard,
  Loader2,
  Mail,
  RefreshCw,
  Save,
  Send,
  Sheet,
  Webhook,
} from "lucide-react";
import {
  APPS_SCRIPT_ALLOWED_INTERVAL_MINUTES,
  buildSheetsAppsScript,
  type AppsScriptIntervalMinutes,
} from "../../../electron/apps-script-sheets-trigger";
import type {
  AssistantTriggerDeliveryFailure,
  AssistantTriggerFailureReason,
  AssistantTriggerKind,
} from "../../../electron/assistant-trigger-delivery";
import { isCapabilityWithheld } from "../../../electron/google-restricted-scopes";
import { useTranslation } from "../../lib/i18n";
import {
  normalizeAssistantTriggerSettings,
  normalizeAssistantTriggerSettingsForSave,
  validateAssistantTriggerSettings,
  type AssistantTriggerConnectorState,
  type AssistantTriggerOutput,
  type AssistantTriggerSettings,
  type AssistantTriggerValidationIssue,
} from "../../lib/assistantTriggerSettings";
import type { MessageKey } from "../../locales/ko";
import { provisionAssistantWebhook } from "../../services/assistantWebhookService";
import { useProjectStore } from "../../stores/projectStore";
import type { Project } from "../../types/project";
import { SlackChannelPanel } from "../harness/SlackChannelPanel";
import { TelegramChannelPanel } from "../harness/TelegramChannelPanel";

interface AssistantTriggerSettingsPanelProps {
  project: Project;
}

interface ChannelStatus {
  canEnable: boolean;
  active: boolean;
}

interface SlackChannelStatusAPI {
  status: (projectId: string) => Promise<ChannelStatus>;
}

interface TelegramChannelStatusAPI {
  status: (projectId: string) => Promise<ChannelStatus>;
}

/** preload 의 `assistantTriggers` 창구. 구독은 해지 함수를 돌려준다. */
interface AssistantTriggerDeliveryAPI {
  deliveryFailures: () => Promise<AssistantTriggerDeliveryFailure[]>;
  onDeliveryFailure: (
    callback: (failure: AssistantTriggerDeliveryFailure) => void,
  ) => () => void;
  onDeliveryRecovered: (callback: (projectId: string) => void) => () => void;
}

type TriggerTab = "schedule" | "conditions" | "outputs";

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

/**
 * ★시트 폴링 경로의 보류 여부(설계 §3.5 · 티켓 kJbIsaRPjMnGQTvDbR1V).
 *
 * 판정은 `google-restricted-scopes.ts` 단일 진실원이 들고, 화면은 읽기만 한다.
 * 보류가 풀리면 이 화면의 분기 셋(배지 · 잠금 안내 · 입력 비활성)이 한 번에
 * 원상 복귀한다.
 */
const SHEETS_TRIGGER_WITHHELD = isCapabilityWithheld("sheets_trigger");

/**
 * ★캘린더·Gmail 폴링 경로의 보류 여부. 시트와 같은 모양이다 — 판정은
 * `google-restricted-scopes.ts` 단일 진실원이 들고 화면은 읽기만 한다.
 *
 * 시트와 다른 점은 대체 경로뿐이다. 시트는 Apps Script 가 이미 배선돼 있어
 * 문구가 "방식이 바뀌었다" 로 끝나지만, 이 둘은 macOS 전용 대체(애플 캘린더·
 * 애플 메일)가 아직 붙지 않았고 Windows·Linux 에는 대체가 없다. 그 사실을
 * 숨기지 않는 것이 heldNotice 의 일이다(설계 §6.1 능력표).
 */
const CALENDAR_TRIGGER_WITHHELD = isCapabilityWithheld("calendar_trigger");
const GMAIL_TRIGGER_WITHHELD = isCapabilityWithheld("gmail_trigger");

function issueKey(issue: AssistantTriggerValidationIssue): MessageKey {
  switch (issue) {
    case "no_trigger_enabled":
      return "agents.triggers.validation.noTriggerEnabled";
    case "outputs_required":
      return "agents.triggers.validation.outputsRequired";
    case "slack_output_unavailable":
      return "agents.triggers.validation.slackOutputUnavailable";
    case "telegram_output_unavailable":
      return "agents.triggers.validation.telegramOutputUnavailable";
    case "invalid_cron":
      return "agents.triggers.validation.invalidCron";
    case "invalid_timezone":
      return "agents.triggers.validation.invalidTimezone";
    case "webhook_not_issued":
      return "agents.triggers.validation.webhookNotIssued";
    case "calendar_connector_required":
      return "agents.triggers.validation.calendarConnectorRequired";
    case "gmail_connector_required":
      return "agents.triggers.validation.gmailConnectorRequired";
    case "calendar_trigger_withheld":
      return "agents.triggers.validation.calendarTriggerWithheld";
    case "gmail_trigger_withheld":
      return "agents.triggers.validation.gmailTriggerWithheld";
    case "calendar_poll_out_of_range":
      return "agents.triggers.validation.calendarPollOutOfRange";
    case "gmail_poll_out_of_range":
      return "agents.triggers.validation.gmailPollOutOfRange";
    case "webhook_poll_out_of_range":
      return "agents.triggers.webhook.pollOutOfRange";
    case "sheets_connector_required":
      return "agents.triggers.validation.sheetsConnectorRequired";
    case "sheets_trigger_withheld":
      return "agents.triggers.validation.sheetsTriggerWithheld";
    case "sheets_spreadsheet_required":
      return "agents.triggers.validation.sheetsSpreadsheetRequired";
    case "sheets_poll_out_of_range":
      return "agents.triggers.validation.sheetsPollOutOfRange";
    case "calendar_upcoming_out_of_range":
      return "agents.triggers.validation.calendarUpcomingOutOfRange";
    default:
      return "agents.triggers.validation.default";
  }
}

/**
 * 사유 → 문구 키. ★`Record` 로 잡아 **사유를 추가하면 컴파일이 깨지게** 한다 —
 * default 로 뭉개면 새 사유가 조용히 "그 외 실패" 로 흘러가 이 티켓이 다시 열린다.
 */
const DELIVERY_REASON_KEYS: Record<
  AssistantTriggerFailureReason,
  { reason: MessageKey; action: MessageKey }
> = {
  "orchestrator-offline": {
    reason: "agents.triggers.delivery.reason.orchestratorOffline",
    action: "agents.triggers.delivery.action.orchestratorOffline",
  },
  "orchestrator-folder-missing": {
    reason: "agents.triggers.delivery.reason.orchestratorFolderMissing",
    action: "agents.triggers.delivery.action.orchestratorFolderMissing",
  },
  "orchestrator-auth-blocked": {
    reason: "agents.triggers.delivery.reason.orchestratorAuthBlocked",
    action: "agents.triggers.delivery.action.orchestratorAuthBlocked",
  },
  "orchestrator-mcp-blocked": {
    reason: "agents.triggers.delivery.reason.orchestratorMcpBlocked",
    action: "agents.triggers.delivery.action.orchestratorMcpBlocked",
  },
  "orchestrator-vendor-blocked": {
    reason: "agents.triggers.delivery.reason.orchestratorVendorBlocked",
    action: "agents.triggers.delivery.action.orchestratorVendorBlocked",
  },
  "composer-busy": {
    reason: "agents.triggers.delivery.reason.composerBusy",
    action: "agents.triggers.delivery.action.composerBusy",
  },
  "delivery-failed": {
    reason: "agents.triggers.delivery.reason.deliveryFailed",
    action: "agents.triggers.delivery.action.deliveryFailed",
  },
};

const DELIVERY_TRIGGER_KEYS: Record<AssistantTriggerKind, MessageKey> = {
  schedule: "agents.triggers.delivery.trigger.schedule",
  calendar: "agents.triggers.delivery.trigger.calendar",
  gmail: "agents.triggers.delivery.trigger.gmail",
  webhook: "agents.triggers.delivery.trigger.webhook",
  sheets: "agents.triggers.delivery.trigger.sheets",
  notice: "agents.triggers.delivery.trigger.notice",
};

function outputLabel(output: AssistantTriggerOutput): string {
  return output === "slack" ? "Slack" : "Telegram";
}

function outputTools(
  outputs: AssistantTriggerOutput[],
  fallback: string,
): string {
  if (outputs.length === 0) return fallback;
  return outputs
    .map((output) =>
      output === "slack" ? "send_slack_message" : "send_telegram_message",
    )
    .join(" / ");
}

function connectorBadgeClass(ready: boolean): string {
  return ready
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
    : "border-amber-500/30 bg-amber-500/10 text-amber-200";
}

function connectorRows(connectors: AssistantTriggerConnectorState): Array<{
  label: string;
  ready: boolean;
}> {
  return [
    { label: "Slack", ready: connectors.slackReady },
    { label: "Telegram", ready: connectors.telegramReady },
    // ★시트와 같은 이유로 내린다. 앰버 "Calendar"·"Gmail" 배지는 화면에서
    // "연결이 필요하다" 로 읽히는데, 지금 막고 있는 것은 연결이 아니라 우리가
    // 회수한 스코프다. 보류가 풀리면 이 배지들도 그대로 돌아온다.
    ...(CALENDAR_TRIGGER_WITHHELD
      ? []
      : [{ label: "Calendar", ready: connectors.calendarConnected }]),
    ...(GMAIL_TRIGGER_WITHHELD
      ? []
      : [{ label: "Gmail", ready: connectors.gmailConnected }]),
    // ★시트 폴링이 보류된 동안은 이 배지를 내린다. 앰버 "Sheets" 배지는 화면에서
    // "연결이 필요하다" 로 읽히는데, 지금 필요한 것은 연결이 아니라 Apps Script 다.
    // 스코프가 복구되면 이 배지도 그대로 돌아온다.
    ...(SHEETS_TRIGGER_WITHHELD
      ? []
      : [{ label: "Sheets", ready: connectors.sheetsConnected }]),
  ];
}

export function AssistantTriggerSettingsPanel({
  project,
}: AssistantTriggerSettingsPanelProps) {
  const { t, locale } = useTranslation();
  const updateProject = useProjectStore((s) => s.updateProject);
  const [settings, setSettings] = useState<AssistantTriggerSettings>(() =>
    normalizeAssistantTriggerSettings(project.assistantTriggers),
  );
  const [connectors, setConnectors] = useState<AssistantTriggerConnectorState>({
    slackReady: false,
    telegramReady: false,
    calendarConnected: false,
    gmailConnected: false,
    sheetsConnected: false,
  });
  const [loadingConnectors, setLoadingConnectors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [provisioningWebhook, setProvisioningWebhook] = useState(false);
  const [revealedWebhookSecret, setRevealedWebhookSecret] = useState<
    string | null
  >(null);
  const [appsScriptSheetName, setAppsScriptSheetName] = useState("");
  /**
   * ★스크립트가 시트를 보는 주기는 **더 이상 우리 상태가 아니다.** 값이 실제로
   * 사는 곳은 사용자가 붙여넣은 스크립트 안이고, 사용자가 거기서 직접 고칠 수도
   * 있다. 우리 DB 에 저장해 두면 "우리가 이 주기를 통제한다" 는 거짓말이 된다.
   * 그래서 저장하지 않고 생성 시점의 선택으로만 둔다.
   */
  const [appsScriptInterval, setAppsScriptInterval] =
    useState<AppsScriptIntervalMinutes>(5);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TriggerTab>("schedule");
  /**
   * ★"발화했는데 오케에 안 닿았다" 의 현재 상태. 메인이 들고 있는 사실을 그대로
   * 비춘다 — 발화는 사용자가 자리를 비운 새벽에도 일어나므로, 이벤트만으로는
   * 부족하고 패널을 열 때 처음부터 다시 읽어야 한다.
   */
  const [deliveryFailure, setDeliveryFailure] =
    useState<AssistantTriggerDeliveryFailure | null>(null);

  const isAssistantProject = project.kind === "assistant";
  const tabs: Array<{ id: TriggerTab; label: string }> = [
    { id: "schedule", label: t("agents.triggers.tabs.schedule") },
    { id: "conditions", label: t("agents.triggers.tabs.conditions") },
    { id: "outputs", label: t("agents.triggers.tabs.outputs") },
  ];

  useEffect(() => {
    setSettings(normalizeAssistantTriggerSettings(project.assistantTriggers));
    setMessage(null);
    setError(null);
  }, [project.id, project.assistantTriggers]);

  const loadConnectors = useCallback(async () => {
    setLoadingConnectors(true);
    try {
      const api = window.electronAPI as ElectronAPI & {
        slackChannel: SlackChannelStatusAPI;
        telegramChannel: TelegramChannelStatusAPI;
      };
      const [driveStatus, slackStatus, telegramStatus] = await Promise.all([
        api.drive.status(),
        api.slackChannel.status(project.id),
        api.telegramChannel.status(project.id),
      ]);
      const scopes = driveStatus.scopes ?? [];
      setConnectors({
        slackReady: slackStatus.active || slackStatus.canEnable,
        telegramReady: telegramStatus.active || telegramStatus.canEnable,
        calendarConnected: scopes.includes(CALENDAR_SCOPE),
        gmailConnected: scopes.includes(GMAIL_SCOPE),
        // ★기존 사용자는 이 스코프 없이 이미 연결돼 있다. 그 사실을 숨기지 않고
        // "연결 필요" 배지 + 저장 차단으로 드러낸다(켜놓고 안 도는 상태 방지).
        sheetsConnected: scopes.includes(SHEETS_SCOPE),
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("agents.triggers.errors.loadConnectorsFailed"),
      );
    } finally {
      setLoadingConnectors(false);
    }
  }, [project.id]);

  useEffect(() => {
    void loadConnectors();
  }, [loadConnectors]);

  useEffect(() => {
    const api = (
      window.electronAPI as ElectronAPI & {
        assistantTriggers?: AssistantTriggerDeliveryAPI;
      }
    )?.assistantTriggers;
    // preload 가 없는 환경(테스트·웹 프리뷰)에서는 조용히 아무것도 안 그린다.
    if (!api) return;
    let alive = true;
    setDeliveryFailure(null);
    void api
      .deliveryFailures()
      .then((failures) => {
        if (!alive) return;
        setDeliveryFailure(
          failures.find((f) => f.projectId === project.id) ?? null,
        );
      })
      .catch(() => undefined);
    const offFailure = api.onDeliveryFailure((failure) => {
      if (failure.projectId !== project.id) return;
      setDeliveryFailure(failure);
    });
    const offRecovered = api.onDeliveryRecovered((projectId) => {
      if (projectId !== project.id) return;
      setDeliveryFailure(null);
    });
    return () => {
      alive = false;
      offFailure();
      offRecovered();
    };
  }, [project.id]);

  const validation = useMemo(
    () => validateAssistantTriggerSettings(settings, connectors),
    [connectors, settings],
  );

  /**
   * 붙여넣을 Apps Script 전문.
   *
   * ★시크릿 **원문**이 필요하므로 발급·재발급 직후에만 만들어진다. 서버는
   * `provisionAssistantWebhook` 응답에서만 원문을 주고 그 뒤로는 마스킹만
   * 돌려준다 — 그래서 여기서 없는 값을 지어내지 않고, 없으면 "재발급하면 된다"
   * 를 그대로 말한다(`needsSecret` 문구). 이것이 이 흐름에서 제일 큰 마찰이다.
   *
   * 주기는 아래 select 가 고른 값이다. `webhook.pollMinutes` 를 쓰지 않는 것이
   * 요점 — 그것은 "우리가 받은 이벤트를 얼마나 자주 읽나" 이고, 여기서 필요한
   * 것은 "시트가 자기를 얼마나 자주 보나" 라서 서로 다른 값이다.
   */
  const appsScriptSource = useMemo(() => {
    const url = settings.webhook?.url;
    if (!url || !revealedWebhookSecret) return null;
    return buildSheetsAppsScript({
      webhookUrl: url,
      secret: revealedWebhookSecret,
      sheetName: appsScriptSheetName,
      pollMinutes: appsScriptInterval,
      locale,
    });
  }, [
    appsScriptInterval,
    appsScriptSheetName,
    locale,
    revealedWebhookSecret,
    settings.webhook?.url,
  ]);

  const setOutput = (output: AssistantTriggerOutput, checked: boolean) => {
    setSettings((prev) => ({
      ...prev,
      outputs: checked
        ? Array.from(new Set([...prev.outputs, output]))
        : prev.outputs.filter((item) => item !== output),
    }));
  };

  const save = async () => {
    setMessage(null);
    setError(null);
    if (settings.enabled && !isAssistantProject) {
      setError(t("agents.triggers.errors.assistantProjectRequired"));
      return;
    }
    if (!validation.ok) {
      setError(validation.issues.map((issue) => t(issueKey(issue))).join(" "));
      return;
    }
    setSaving(true);
    try {
      const normalized = normalizeAssistantTriggerSettingsForSave(settings);
      setSettings(normalized);
      await updateProject(project.id, { assistantTriggers: normalized });
      setMessage(t("agents.triggers.saved"));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("agents.triggers.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const issueWebhook = async (rotate: boolean) => {
    setMessage(null);
    setError(null);
    setProvisioningWebhook(true);
    try {
      const result = await provisionAssistantWebhook(project.id, rotate);
      setSettings((prev) => ({
        ...prev,
        webhook: {
          ...(prev.webhook ?? { enabled: false, pollMinutes: 1 }),
          webhookId: result.webhookId,
          url: result.url,
          secretMasked: result.secretMasked,
        },
      }));
      setRevealedWebhookSecret(result.secret);
      setMessage(
        rotate
          ? t("agents.triggers.webhook.rotated")
          : t("agents.triggers.webhook.issued"),
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("agents.triggers.webhook.issueFailed"),
      );
    } finally {
      setProvisioningWebhook(false);
    }
  };

  const copyText = async (value: string, copiedMessage: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(copiedMessage);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("agents.triggers.copyFailed"),
      );
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 text-gray-100">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            {t("agents.triggers.title")}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-gray-400">
            {t("agents.triggers.description")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadConnectors()}
          disabled={loadingConnectors}
          className="inline-flex items-center gap-1.5 rounded border border-gray-700 px-3 py-1.5 text-sm text-gray-200 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw
            size={14}
            className={loadingConnectors ? "animate-spin" : ""}
          />
          {t("agents.triggers.refreshConnectors")}
        </button>
      </div>

      {/*
        ★저장 시점에 이미 아는 것과 발화 시점에만 아는 것을 가른다.
        폴더 유무는 지금 당장 알 수 있으므로 발화를 기다리지 않고 먼저 말한다.
        (막지는 않는다 — 설정은 기기 간 공유라 다른 기기에서는 정상일 수 있다.)
      */}
      {settings.enabled && !project.folderPath && (
        <div
          data-testid="assistant-trigger-folder-preflight"
          className="mb-4 flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100"
        >
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <span>{t("agents.triggers.delivery.preflight.folderMissing")}</span>
        </div>
      )}

      {deliveryFailure && (
        <div
          role="alert"
          data-testid="assistant-trigger-delivery-failure"
          className="mb-4 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-100"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
            <div className="min-w-0">
              <div className="font-semibold">
                {t("agents.triggers.delivery.title")}
              </div>
              <div className="mt-1">
                {t(DELIVERY_REASON_KEYS[deliveryFailure.reason].reason)}
              </div>
              {/* ★사유 다음 줄은 반드시 "무엇을 하면 되는지" 다. */}
              <div className="mt-1 text-red-200/90">
                {t(DELIVERY_REASON_KEYS[deliveryFailure.reason].action)}
              </div>
              <div className="mt-1 text-xs text-red-200/70">
                {t("agents.triggers.delivery.retryNote")}
              </div>
              <div className="mt-1 text-xs text-red-200/60">
                {t("agents.triggers.delivery.meta", {
                  trigger: t(DELIVERY_TRIGGER_KEYS[deliveryFailure.trigger]),
                  count: deliveryFailure.count,
                  time: new Date(deliveryFailure.lastAt).toLocaleString(locale),
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      <div
        className={`mb-4 flex items-start gap-2 rounded border px-3 py-2 text-sm ${
          isAssistantProject
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
            : "border-amber-500/40 bg-amber-500/10 text-amber-100"
        }`}
      >
        {isAssistantProject ? (
          <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0" />
        ) : (
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
        )}
        <span>
          {t("agents.triggers.engineNoticePrefix")}{" "}
          <code>kind === "assistant"</code>{" "}
          {t("agents.triggers.engineNoticeSuffix")}{" "}
          <code>{project.kind ?? "unknown"}</code>
          {isAssistantProject
            ? t("agents.triggers.engineNoticeEnabled")
            : t("agents.triggers.engineNoticeDisabled")}
        </span>
      </div>

      {(message || error) && (
        <div
          className={`mb-4 rounded border px-3 py-2 text-sm ${
            error
              ? "border-red-500/40 bg-red-500/10 text-red-200"
              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
          }`}
        >
          {error || message}
        </div>
      )}

      <div className="mb-4 grid gap-2 md:grid-cols-3 xl:grid-cols-5">
        {connectorRows(connectors).map(({ label, ready }) => (
          <div
            key={label}
            className={`rounded border px-3 py-2 text-xs ${connectorBadgeClass(ready)}`}
          >
            <div className="font-medium">{label}</div>
            <div className="mt-0.5">
              {t(
                ready
                  ? "agents.triggers.connectorReady"
                  : "agents.triggers.connectorNeedsConnection",
              )}
            </div>
          </div>
        ))}
      </div>

      <section className="mb-4 rounded border border-gray-700 bg-gray-900 p-4">
        <label className="flex items-center justify-between gap-3">
          <span>
            <span className="block text-sm font-semibold">
              {t("agents.triggers.enableLabel")}
            </span>
            <span className="mt-0.5 block text-xs text-gray-500">
              {t("agents.triggers.enableHint")}
            </span>
          </span>
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) =>
              setSettings((prev) => ({
                ...prev,
                enabled: event.target.checked,
              }))
            }
            className="h-5 w-5 rounded border-gray-600 bg-gray-950"
          />
        </label>
      </section>

      <div
        role="tablist"
        aria-label={t("agents.triggers.tabsAria")}
        className="mb-4 flex flex-wrap gap-1 border-b border-gray-700"
      >
        {tabs.map((tab) => {
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActiveTab(tab.id)}
              className={`border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
                selected
                  ? "border-blue-500 text-gray-100"
                  : "border-transparent text-gray-500 hover:text-gray-300"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "schedule" && (
        <section className="rounded border border-gray-700 bg-gray-900 p-4">
          <div className="mb-3 flex items-center gap-2">
            <CalendarClock size={17} className="text-blue-300" />
            <h3 className="text-sm font-semibold">
              {t("agents.triggers.schedule.title")}
            </h3>
          </div>
          <label className="mb-3 flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={settings.schedule?.enabled ?? false}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  schedule: {
                    ...(prev.schedule ?? { cron: "0 9 * * 1-5" }),
                    enabled: event.target.checked,
                  },
                }))
              }
              className="h-4 w-4 rounded border-gray-600 bg-gray-950"
            />
            {t("agents.triggers.schedule.enable")}
          </label>
          <label className="mb-3 block">
            <span className="mb-1 block text-xs text-gray-400">cron</span>
            <input
              value={settings.schedule?.cron ?? ""}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  schedule: {
                    ...(prev.schedule ?? { enabled: false }),
                    cron: event.target.value,
                  },
                }))
              }
              className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-gray-400">timezone</span>
            <input
              value={settings.schedule?.timezone ?? ""}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  schedule: {
                    ...(prev.schedule ?? { enabled: false, cron: "" }),
                    timezone: event.target.value,
                  },
                }))
              }
              className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
          </label>
        </section>
      )}

      {activeTab === "conditions" && (
        <div className="grid gap-4 xl:grid-cols-2">
          <section className="rounded border border-gray-700 bg-gray-900 p-4">
            <div className="mb-3 flex items-center gap-2">
              <CalendarClock size={17} className="text-emerald-300" />
              <h3 className="text-sm font-semibold">
                {t("agents.triggers.calendar.title")}
              </h3>
              {CALENDAR_TRIGGER_WITHHELD && (
                <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-100">
                  {t("agents.triggers.calendar.heldBadge")}
                </span>
              )}
            </div>
            {/*
              ★"연결 필요" 가 아니라 "권한을 회수했다 · 대체는 이렇다" 로 말한다.
              이미 이 조건을 켜 둔 사용자는 이 안내로 자기 설정이 왜 안 도는지를
              알게 된다 — 설정 자체는 건드리지 않는다(사용자 데이터).
            */}
            {CALENDAR_TRIGGER_WITHHELD && (
              <p className="mb-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                {t("agents.triggers.calendar.heldNotice")}
              </p>
            )}
            <label className="mb-3 flex items-center gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={settings.calendar?.enabled ?? false}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    calendar: {
                      ...(prev.calendar ?? {
                        upcomingMinutes: 15,
                        pollMinutes: 5,
                      }),
                      enabled: event.target.checked,
                    },
                  }))
                }
                className="h-4 w-4 rounded border-gray-600 bg-gray-950"
              />
              {t("agents.triggers.calendar.enable")}
            </label>
            <label className="mb-3 block">
              <span className="mb-1 block text-xs text-gray-400">
                upcomingMinutes
              </span>
              <input
                type="number"
                min={1}
                max={1440}
                value={settings.calendar?.upcomingMinutes ?? 15}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    calendar: {
                      ...(prev.calendar ?? { enabled: false, pollMinutes: 5 }),
                      upcomingMinutes: Number(event.target.value),
                    },
                  }))
                }
                disabled={CALENDAR_TRIGGER_WITHHELD}
                className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-gray-400">
                pollMinutes
              </span>
              <input
                type="number"
                min={1}
                max={60}
                value={settings.calendar?.pollMinutes ?? 5}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    calendar: {
                      ...(prev.calendar ?? {
                        enabled: false,
                        upcomingMinutes: 15,
                      }),
                      pollMinutes: Number(event.target.value),
                    },
                  }))
                }
                disabled={CALENDAR_TRIGGER_WITHHELD}
                className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </label>
          </section>

          <section className="rounded border border-gray-700 bg-gray-900 p-4">
            <div className="mb-3 flex items-center gap-2">
              <Mail size={17} className="text-purple-300" />
              <h3 className="text-sm font-semibold">
                {t("agents.triggers.gmail.title")}
              </h3>
              {GMAIL_TRIGGER_WITHHELD && (
                <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-100">
                  {t("agents.triggers.gmail.heldBadge")}
                </span>
              )}
            </div>
            {GMAIL_TRIGGER_WITHHELD && (
              <p className="mb-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                {t("agents.triggers.gmail.heldNotice")}
              </p>
            )}
            <label className="mb-3 flex items-center gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={settings.gmail?.enabled ?? false}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    gmail: {
                      ...(prev.gmail ?? {
                        query: "in:inbox newer_than:1d",
                        pollMinutes: 5,
                      }),
                      enabled: event.target.checked,
                    },
                  }))
                }
                className="h-4 w-4 rounded border-gray-600 bg-gray-950"
              />
              {t("agents.triggers.gmail.enable")}
            </label>
            <label className="mb-3 block">
              <span className="mb-1 block text-xs text-gray-400">query</span>
              <input
                value={settings.gmail?.query ?? ""}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    gmail: {
                      ...(prev.gmail ?? { enabled: false, pollMinutes: 5 }),
                      query: event.target.value,
                    },
                  }))
                }
                disabled={GMAIL_TRIGGER_WITHHELD}
                className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-gray-400">
                pollMinutes
              </span>
              <input
                type="number"
                min={1}
                max={60}
                value={settings.gmail?.pollMinutes ?? 5}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    gmail: {
                      ...(prev.gmail ?? {
                        enabled: false,
                        query: "in:inbox newer_than:1d",
                      }),
                      pollMinutes: Number(event.target.value),
                    },
                  }))
                }
                disabled={GMAIL_TRIGGER_WITHHELD}
                className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </label>
          </section>

          <section className="rounded border border-gray-700 bg-gray-900 p-4">
            <div className="mb-3 flex items-center gap-2">
              <Webhook size={17} className="text-cyan-300" />
              <h3 className="text-sm font-semibold">
                {t("agents.triggers.webhook.title")}
              </h3>
            </div>
            <label className="mb-3 flex items-center gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={settings.webhook?.enabled ?? false}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    webhook: {
                      ...(prev.webhook ?? { pollMinutes: 1 }),
                      enabled: event.target.checked,
                    },
                  }))
                }
                className="h-4 w-4 rounded border-gray-600 bg-gray-950"
              />
              {t("agents.triggers.webhook.enable")}
            </label>
            <label className="mb-3 block">
              <span className="mb-1 block text-xs text-gray-400">
                {t("agents.triggers.webhook.pollMinutes")}
              </span>
              <input
                type="number"
                min={1}
                max={60}
                value={settings.webhook?.pollMinutes ?? 1}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    webhook: {
                      ...(prev.webhook ?? { enabled: false }),
                      pollMinutes: Number(event.target.value),
                    },
                  }))
                }
                className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
            </label>
            <div className="mb-3 rounded border border-gray-700 bg-gray-950/60 p-3">
              <div className="mb-2 text-xs font-medium text-gray-300">
                {t("agents.triggers.webhook.url")}
              </div>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={settings.webhook?.url ?? ""}
                  placeholder={t("agents.triggers.webhook.notIssued")}
                  className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-300 outline-none"
                />
                <button
                  type="button"
                  onClick={() =>
                    void copyText(
                      settings.webhook?.url ?? "",
                      t("agents.triggers.webhook.urlCopied"),
                    )
                  }
                  disabled={!settings.webhook?.url}
                  className="inline-flex items-center gap-1 rounded border border-gray-700 px-2.5 py-2 text-xs text-gray-200 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Clipboard size={14} />
                  {t("agents.triggers.copy")}
                </button>
              </div>
            </div>
            <div className="mb-3 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => void issueWebhook(false)}
                disabled={provisioningWebhook}
                className="inline-flex items-center justify-center gap-1.5 rounded border border-gray-700 px-3 py-2 text-sm text-gray-200 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {provisioningWebhook ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Webhook size={14} />
                )}
                {t("agents.triggers.webhook.issue")}
              </button>
              <button
                type="button"
                onClick={() => void issueWebhook(true)}
                disabled={provisioningWebhook || !settings.webhook?.webhookId}
                className="inline-flex items-center justify-center gap-1.5 rounded border border-amber-500/40 px-3 py-2 text-sm text-amber-100 hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw size={14} />
                {t("agents.triggers.webhook.rotate")}
              </button>
            </div>
            <div className="rounded border border-gray-700 bg-gray-950/40 p-3 text-xs text-gray-400">
              <div>
                {t("agents.triggers.webhook.secretMasked", {
                  secret: settings.webhook?.secretMasked ?? "-",
                })}
              </div>
              {revealedWebhookSecret && (
                <div className="mt-2 flex gap-2">
                  <input
                    readOnly
                    value={revealedWebhookSecret}
                    className="min-w-0 flex-1 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      void copyText(
                        revealedWebhookSecret,
                        t("agents.triggers.webhook.secretCopied"),
                      )
                    }
                    className="inline-flex items-center gap-1 rounded border border-amber-500/40 px-2.5 py-2 text-xs text-amber-100 hover:bg-amber-500/10"
                  >
                    <Clipboard size={14} />
                    {t("agents.triggers.copy")}
                  </button>
                </div>
              )}
              <p className="mt-2">
                {t("agents.triggers.webhook.signatureHint")}
              </p>
            </div>

            {/*
              ★Apps Script 안내가 시트 섹션이 아니라 **웹훅 섹션 안**에 있는 이유:
              이 스크립트가 부르는 것은 시트 커넥터가 아니라 위에서 방금 발급한
              웹훅 URL 이고, 시크릿 원문도 바로 위 버튼에서만 나온다. 두 화면으로
              쪼개면 사용자가 URL·시크릿을 들고 이동해야 한다.
            */}
            <div className="mt-4 rounded border border-lime-500/30 bg-lime-500/5 p-3">
              <div className="mb-2 flex items-center gap-2">
                <Sheet size={15} className="text-lime-300" />
                <h4 className="text-sm font-semibold text-lime-100">
                  {t("agents.triggers.appsScript.title")}
                </h4>
              </div>
              <p className="text-xs text-gray-300">
                {t("agents.triggers.appsScript.description")}
              </p>
              {/* 마찰을 숨기지 않는다 — 몇 단계인지 먼저 말한다. */}
              <p className="mt-1 text-xs font-medium text-lime-200">
                {t("agents.triggers.appsScript.stepCount")}
              </p>

              {!settings.webhook?.url ? (
                <p className="mt-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                  {t("agents.triggers.appsScript.needsWebhook")}
                </p>
              ) : !appsScriptSource ? (
                <p className="mt-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                  {t("agents.triggers.appsScript.needsSecret")}
                </p>
              ) : (
                <>
                  <label className="mt-3 block">
                    <span className="mb-1 block text-xs text-gray-400">
                      {t("agents.triggers.appsScript.sheetName")}
                    </span>
                    <input
                      value={appsScriptSheetName}
                      onChange={(event) =>
                        setAppsScriptSheetName(event.target.value)
                      }
                      className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-lime-500"
                    />
                    <span className="mt-1 block text-xs text-gray-500">
                      {t("agents.triggers.appsScript.sheetNameHint")}
                    </span>
                  </label>
                  <label className="mt-3 block">
                    <span className="mb-1 block text-xs text-gray-400">
                      {t("agents.triggers.appsScript.interval")}
                    </span>
                    <select
                      value={appsScriptInterval}
                      onChange={(event) =>
                        setAppsScriptInterval(
                          Number(
                            event.target.value,
                          ) as AppsScriptIntervalMinutes,
                        )
                      }
                      className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-lime-500"
                    >
                      {APPS_SCRIPT_ALLOWED_INTERVAL_MINUTES.map((minutes) => (
                        <option key={minutes} value={minutes}>
                          {t("agents.triggers.appsScript.intervalOption", {
                            minutes: String(minutes),
                          })}
                        </option>
                      ))}
                    </select>
                    <span className="mt-1 block text-xs text-gray-500">
                      {t("agents.triggers.appsScript.intervalHint")}
                    </span>
                  </label>
                  <div className="mt-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-xs text-gray-400">
                        {t("agents.triggers.appsScript.script")}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          void copyText(
                            appsScriptSource,
                            t("agents.triggers.appsScript.copied"),
                          )
                        }
                        className="inline-flex items-center gap-1 rounded border border-lime-500/40 px-2.5 py-1.5 text-xs text-lime-100 hover:bg-lime-500/10"
                      >
                        <Clipboard size={14} />
                        {t("agents.triggers.appsScript.copy")}
                      </button>
                    </div>
                    <textarea
                      readOnly
                      spellCheck={false}
                      value={appsScriptSource}
                      rows={10}
                      className="w-full resize-y rounded border border-gray-700 bg-gray-950 px-3 py-2 font-mono text-[11px] leading-relaxed text-gray-300 outline-none"
                    />
                  </div>
                  {/* 시크릿 원문이 이 텍스트 안에 있다는 사실을 말한다. */}
                  <p className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                    {t("agents.triggers.appsScript.secretWarning")}
                  </p>
                </>
              )}

              <div className="mt-3 text-xs text-gray-300">
                <div className="font-medium text-gray-200">
                  {t("agents.triggers.appsScript.stepsTitle")}
                </div>
                <ol className="mt-1 list-decimal space-y-1 pl-5 text-gray-400">
                  <li>{t("agents.triggers.appsScript.step1")}</li>
                  <li>{t("agents.triggers.appsScript.step2")}</li>
                  <li>{t("agents.triggers.appsScript.step3")}</li>
                  <li>{t("agents.triggers.appsScript.step4")}</li>
                  <li>{t("agents.triggers.appsScript.step5")}</li>
                </ol>
              </div>

              <details className="mt-3 rounded border border-gray-700 bg-gray-950/40">
                <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-gray-200">
                  {t("agents.triggers.appsScript.frictionTitle")}
                </summary>
                <ul className="list-disc space-y-1 border-t border-gray-700 px-3 py-2 pl-7 text-xs text-gray-400">
                  <li>{t("agents.triggers.appsScript.friction1")}</li>
                  <li>{t("agents.triggers.appsScript.friction2")}</li>
                  <li>{t("agents.triggers.appsScript.friction3")}</li>
                </ul>
              </details>

              <details className="mt-2 rounded border border-gray-700 bg-gray-950/40">
                <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-gray-200">
                  {t("agents.triggers.appsScript.troubleshootTitle")}
                </summary>
                <ul className="list-disc space-y-1 border-t border-gray-700 px-3 py-2 pl-7 text-xs text-gray-400">
                  <li>{t("agents.triggers.appsScript.troubleshoot401")}</li>
                  <li>{t("agents.triggers.appsScript.troubleshoot403")}</li>
                  <li>{t("agents.triggers.appsScript.troubleshoot429")}</li>
                </ul>
              </details>
            </div>
          </section>

          <section className="rounded border border-gray-700 bg-gray-900 p-4">
            <div className="mb-3 flex items-center gap-2">
              <Sheet size={17} className="text-lime-300" />
              <h3 className="text-sm font-semibold">
                {t("agents.triggers.sheets.title")}
              </h3>
              {SHEETS_TRIGGER_WITHHELD && (
                <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-100">
                  {t("agents.triggers.sheets.heldBadge")}
                </span>
              )}
            </div>
            {/*
              ★"연결 필요" 가 아니라 "방식이 바뀌었다" 로 말한다. 없는 연결을
              찾아다니게 만드는 것이 이 경로의 가장 비싼 실패다(설계 §6.2).
            */}
            {SHEETS_TRIGGER_WITHHELD && (
              <p className="mb-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                {t("agents.triggers.sheets.heldNotice")}
              </p>
            )}
            <label className="mb-3 flex items-center gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={settings.sheets?.enabled ?? false}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    sheets: {
                      ...(prev.sheets ?? {
                        spreadsheetId: "",
                        range: "A:Z",
                        pollMinutes: 5,
                      }),
                      enabled: event.target.checked,
                    },
                  }))
                }
                className="h-4 w-4 rounded border-gray-600 bg-gray-950"
              />
              {t("agents.triggers.sheets.enable")}
            </label>
            <label className="mb-3 block">
              <span className="mb-1 block text-xs text-gray-400">
                {t("agents.triggers.sheets.spreadsheet")}
              </span>
              <input
                value={settings.sheets?.spreadsheetId ?? ""}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    sheets: {
                      ...(prev.sheets ?? {
                        enabled: false,
                        range: "A:Z",
                        pollMinutes: 5,
                      }),
                      spreadsheetId: event.target.value,
                    },
                  }))
                }
                disabled={SHEETS_TRIGGER_WITHHELD}
                className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              />
              <span className="mt-1 block text-xs text-gray-500">
                {t("agents.triggers.sheets.spreadsheetHint")}
              </span>
            </label>
            <label className="mb-3 block">
              <span className="mb-1 block text-xs text-gray-400">
                {t("agents.triggers.sheets.range")}
              </span>
              <input
                value={settings.sheets?.range ?? ""}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    sheets: {
                      ...(prev.sheets ?? {
                        enabled: false,
                        spreadsheetId: "",
                        pollMinutes: 5,
                      }),
                      range: event.target.value,
                    },
                  }))
                }
                disabled={SHEETS_TRIGGER_WITHHELD}
                className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              />
              <span className="mt-1 block text-xs text-gray-500">
                {t("agents.triggers.sheets.rangeHint")}
              </span>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-gray-400">
                {t("agents.triggers.sheets.pollMinutes")}
              </span>
              <input
                type="number"
                min={1}
                max={60}
                value={settings.sheets?.pollMinutes ?? 5}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    sheets: {
                      ...(prev.sheets ?? {
                        enabled: false,
                        spreadsheetId: "",
                        range: "A:Z",
                      }),
                      pollMinutes: Number(event.target.value),
                    },
                  }))
                }
                disabled={SHEETS_TRIGGER_WITHHELD}
                className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </label>
            <p className="mt-3 text-xs text-gray-500">
              {t("agents.triggers.sheets.detectionHint")}
            </p>
          </section>
        </div>
      )}

      {activeTab === "outputs" && (
        <section className="rounded border border-gray-700 bg-gray-900 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Send size={17} className="text-blue-300" />
            <h3 className="text-sm font-semibold">
              {t("agents.triggers.outputs.title")}
            </h3>
          </div>
          <div className="mb-3 flex flex-wrap gap-3">
            {(["slack", "telegram"] as const).map((output) => (
              <label
                key={output}
                className="flex items-center gap-2 rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-300"
              >
                <input
                  type="checkbox"
                  checked={settings.outputs.includes(output)}
                  onChange={(event) => setOutput(output, event.target.checked)}
                  className="h-4 w-4 rounded border-gray-600 bg-gray-950"
                />
                {outputLabel(output)}
              </label>
            ))}
          </div>
          <p className="text-xs text-gray-500">
            {t("agents.triggers.outputs.description", {
              tools: outputTools(
                settings.outputs,
                t("agents.triggers.outputs.none"),
              ),
            })}
          </p>
          <details className="mt-4 rounded border border-gray-700 bg-gray-950/40">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-gray-200">
              {t("agents.triggers.outputs.slackGuide")}
            </summary>
            <div className="border-t border-gray-700">
              <SlackChannelPanel />
            </div>
          </details>
          <details className="mt-3 rounded border border-gray-700 bg-gray-950/40">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-gray-200">
              {t("agents.triggers.outputs.telegramGuide")}
            </summary>
            <div className="border-t border-gray-700">
              <TelegramChannelPanel />
            </div>
          </details>
        </section>
      )}

      {!validation.ok && settings.enabled && (
        <div className="mt-4 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {validation.issues.map((issue) => t(issueKey(issue))).join(" ")}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          {validation.ok ? (
            <CheckCircle2 size={14} className="text-emerald-300" />
          ) : (
            <AlertTriangle size={14} className="text-amber-300" />
          )}
          {t("agents.triggers.engineFields")}
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Save size={14} />
          )}
          {t("agents.triggers.save")}
        </button>
      </div>
    </div>
  );
}
