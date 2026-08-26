import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Loader2,
  Mail,
  RefreshCw,
  Save,
  Send,
} from "lucide-react";
import {
  normalizeAssistantTriggerSettings,
  validateAssistantTriggerSettings,
  type AssistantTriggerConnectorState,
  type AssistantTriggerOutput,
  type AssistantTriggerSettings,
  type AssistantTriggerValidationIssue,
} from "../../lib/assistantTriggerSettings";
import { useProjectStore } from "../../stores/projectStore";
import type { Project } from "../../types/project";

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

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

function issueText(issue: AssistantTriggerValidationIssue): string {
  switch (issue) {
    case "no_trigger_enabled":
      return "켜진 트리거가 없습니다.";
    case "outputs_required":
      return "출력 채널을 하나 이상 선택해야 합니다.";
    case "slack_output_unavailable":
      return "Slack 채널 연결이 준비되지 않았습니다.";
    case "telegram_output_unavailable":
      return "Telegram 채널 연결이 준비되지 않았습니다.";
    case "invalid_cron":
      return "cron은 5필드 형식이어야 합니다. 예: 0 9 * * 1-5";
    case "calendar_connector_required":
      return "Calendar 트리거를 켜려면 Google Calendar scope가 필요합니다.";
    case "gmail_connector_required":
      return "Gmail 트리거를 켜려면 Gmail readonly scope가 필요합니다.";
    case "calendar_poll_out_of_range":
      return "Calendar poll 간격은 1~60분이어야 합니다.";
    case "gmail_poll_out_of_range":
      return "Gmail poll 간격은 1~60분이어야 합니다.";
    case "calendar_upcoming_out_of_range":
      return "임박 일정 범위는 1~1440분이어야 합니다.";
    default:
      return "트리거 설정을 저장할 수 없습니다.";
  }
}

function outputLabel(output: AssistantTriggerOutput): string {
  return output === "slack" ? "Slack" : "Telegram";
}

function outputTools(outputs: AssistantTriggerOutput[]): string {
  if (outputs.length === 0) return "선택 안 됨";
  return outputs
    .map((output) =>
      output === "slack" ? "send_slack_message" : "send_telegram_message",
    )
    .join(" / ");
}

function connectorBadge(ready: boolean): string {
  return ready ? "준비됨" : "연결 필요";
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
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isAssistantProject = project.kind === "assistant";

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
          : "커넥터 상태를 불러오지 못했습니다.",
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
      setError(
        "현재 엔진은 kind=assistant 프로젝트만 폴링합니다. 비서 프로젝트에서 켜 주세요.",
      );
      return;
    }
    if (!validation.ok) {
      setError(validation.issues.map(issueText).join(" "));
      return;
    }
    setSaving(true);
    try {
      await updateProject(project.id, { assistantTriggers: settings });
      setMessage("프로젝트 트리거 설정을 저장했습니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 text-gray-100">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">스케줄·조건 트리거</h2>
          <p className="mt-1 max-w-3xl text-sm text-gray-400">
            저장 범위는 프로젝트입니다. 기존 엔진은 projects 문서의
            assistantTriggers를 읽고, assistant 프로젝트의 오케스트레이터에
            주기·조건 메시지를 주입합니다.
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
          연결 상태 새로고침
        </button>
      </div>

      {!isAssistantProject && (
        <div className="mb-4 flex items-start gap-2 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <span>
            이 프로젝트는 assistant 프로젝트가 아닙니다. 설정은 볼 수 있지만,
            엔진은 assistant 프로젝트에서만 활성화됩니다.
          </span>
        </div>
      )}

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
            <div className="mt-0.5">{connectorBadge(ready)}</div>
          </div>
        ))}
      </div>

      <section className="mb-4 rounded border border-gray-700 bg-gray-900 p-4">
        <label className="flex items-center justify-between gap-3">
          <span>
            <span className="block text-sm font-semibold">
              트리거 엔진 사용
            </span>
            <span className="mt-0.5 block text-xs text-gray-500">
              꺼두면 assistantTriggers.enabled=false로 저장됩니다.
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

      <div className="grid gap-4 xl:grid-cols-3">
        <section className="rounded border border-gray-700 bg-gray-900 p-4">
          <div className="mb-3 flex items-center gap-2">
            <CalendarClock size={17} className="text-blue-300" />
            <h3 className="text-sm font-semibold">정시 스케줄</h3>
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
            매칭되는 분마다 일일 브리핑 실행
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

        <section className="rounded border border-gray-700 bg-gray-900 p-4">
          <div className="mb-3 flex items-center gap-2">
            <CalendarClock size={17} className="text-emerald-300" />
            <h3 className="text-sm font-semibold">Calendar 조건</h3>
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
            임박 일정 감지
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
            <h3 className="text-sm font-semibold">Gmail 조건</h3>
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
            메일 조건 감지
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
      </div>

      <section className="mt-4 rounded border border-gray-700 bg-gray-900 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Send size={17} className="text-blue-300" />
          <h3 className="text-sm font-semibold">출력 채널</h3>
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
          엔진은 선택된 채널에 대해 {outputTools(settings.outputs)} MCP 도구를
          호출하도록 오케스트레이터에 지시합니다.
        </p>
      </section>

      {!validation.ok && settings.enabled && (
        <div className="mt-4 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {validation.issues.map(issueText).join(" ")}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          {validation.ok ? (
            <CheckCircle2 size={14} className="text-emerald-300" />
          ) : (
            <AlertTriangle size={14} className="text-amber-300" />
          )}
          기존 엔진 필드: schedule, calendar, gmail, outputs
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
          저장
        </button>
      </div>
    </div>
  );
}
