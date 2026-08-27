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
  Webhook,
} from "lucide-react";
import { useTranslation } from "../../lib/i18n";
import {
  normalizeAssistantTriggerSettings,
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

type TriggerTab = "schedule" | "conditions" | "outputs";

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

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
    case "calendar_connector_required":
      return "agents.triggers.validation.calendarConnectorRequired";
    case "gmail_connector_required":
      return "agents.triggers.validation.gmailConnectorRequired";
    case "calendar_poll_out_of_range":
      return "agents.triggers.validation.calendarPollOutOfRange";
    case "gmail_poll_out_of_range":
      return "agents.triggers.validation.gmailPollOutOfRange";
    case "webhook_poll_out_of_range":
      return "agents.triggers.webhook.pollOutOfRange";
    case "calendar_upcoming_out_of_range":
      return "agents.triggers.validation.calendarUpcomingOutOfRange";
    default:
      return "agents.triggers.validation.default";
  }
}

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
    { label: "Calendar", ready: connectors.calendarConnected },
    { label: "Gmail", ready: connectors.gmailConnected },
  ];
}

export function AssistantTriggerSettingsPanel({
  project,
}: AssistantTriggerSettingsPanelProps) {
  const { t } = useTranslation();
  const updateProject = useProjectStore((s) => s.updateProject);
  const [settings, setSettings] = useState<AssistantTriggerSettings>(() =>
    normalizeAssistantTriggerSettings(project.assistantTriggers),
  );
  const [connectors, setConnectors] = useState<AssistantTriggerConnectorState>({
    slackReady: false,
    telegramReady: false,
    calendarConnected: false,
    gmailConnected: false,
  });
  const [loadingConnectors, setLoadingConnectors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [provisioningWebhook, setProvisioningWebhook] = useState(false);
  const [revealedWebhookSecret, setRevealedWebhookSecret] = useState<
    string | null
  >(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TriggerTab>("schedule");

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

  const validation = useMemo(
    () => validateAssistantTriggerSettings(settings, connectors),
    [connectors, settings],
  );

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
      await updateProject(project.id, { assistantTriggers: settings });
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

      <div className="mb-4 grid gap-2 md:grid-cols-4">
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
            </div>
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
                className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-blue-500"
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
                className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
            </label>
          </section>

          <section className="rounded border border-gray-700 bg-gray-900 p-4">
            <div className="mb-3 flex items-center gap-2">
              <Mail size={17} className="text-purple-300" />
              <h3 className="text-sm font-semibold">
                {t("agents.triggers.gmail.title")}
              </h3>
            </div>
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
                className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-blue-500"
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
                className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-blue-500"
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
