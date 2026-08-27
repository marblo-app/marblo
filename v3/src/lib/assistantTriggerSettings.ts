export type AssistantTriggerOutput = "slack" | "telegram";

export interface AssistantTriggerSettings {
  enabled: boolean;
  outputs: AssistantTriggerOutput[];
  schedule?: {
    enabled: boolean;
    cron: string;
    timezone?: string;
  };
  calendar?: {
    enabled: boolean;
    upcomingMinutes: number;
    pollMinutes: number;
  };
  gmail?: {
    enabled: boolean;
    query?: string;
    pollMinutes: number;
  };
  webhook?: {
    enabled: boolean;
    webhookId?: string;
    url?: string;
    secretMasked?: string;
    pollMinutes: number;
  };
}

export interface AssistantTriggerConnectorState {
  slackReady: boolean;
  telegramReady: boolean;
  calendarConnected: boolean;
  gmailConnected: boolean;
}

export type AssistantTriggerValidationIssue =
  | "no_trigger_enabled"
  | "outputs_required"
  | "slack_output_unavailable"
  | "telegram_output_unavailable"
  | "invalid_cron"
  | "calendar_connector_required"
  | "gmail_connector_required"
  | "calendar_poll_out_of_range"
  | "gmail_poll_out_of_range"
  | "webhook_poll_out_of_range"
  | "calendar_upcoming_out_of_range";

export interface AssistantTriggerValidationResult {
  ok: boolean;
  issues: AssistantTriggerValidationIssue[];
}

export const DEFAULT_ASSISTANT_TRIGGER_SETTINGS: AssistantTriggerSettings = {
  enabled: false,
  outputs: ["slack"],
  schedule: {
    enabled: false,
    cron: "0 9 * * 1-5",
    timezone: "Asia/Seoul",
  },
  calendar: {
    enabled: false,
    upcomingMinutes: 15,
    pollMinutes: 5,
  },
  gmail: {
    enabled: false,
    query: "in:inbox newer_than:1d",
    pollMinutes: 5,
  },
  webhook: {
    enabled: false,
    pollMinutes: 1,
  },
};

const MIN_POLL_MINUTES = 1;
const MAX_POLL_MINUTES = 60;
const MIN_UPCOMING_MINUTES = 1;
const MAX_UPCOMING_MINUTES = 24 * 60;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}

function parseOutputs(value: unknown): AssistantTriggerOutput[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_ASSISTANT_TRIGGER_SETTINGS.outputs];
  }
  return value.filter(
    (item): item is AssistantTriggerOutput =>
      item === "slack" || item === "telegram",
  );
}

export function normalizeAssistantTriggerSettings(
  raw: unknown,
): AssistantTriggerSettings {
  const record = isRecord(raw) ? raw : {};
  const schedule = isRecord(record.schedule) ? record.schedule : {};
  const calendar = isRecord(record.calendar) ? record.calendar : {};
  const gmail = isRecord(record.gmail) ? record.gmail : {};
  const webhook = isRecord(record.webhook) ? record.webhook : {};
  return {
    enabled: booleanValue(
      record.enabled,
      DEFAULT_ASSISTANT_TRIGGER_SETTINGS.enabled,
    ),
    outputs: parseOutputs(record.outputs),
    schedule: {
      enabled: booleanValue(
        schedule.enabled,
        DEFAULT_ASSISTANT_TRIGGER_SETTINGS.schedule?.enabled ?? false,
      ),
      cron: stringValue(
        schedule.cron,
        DEFAULT_ASSISTANT_TRIGGER_SETTINGS.schedule?.cron ?? "",
      ),
      timezone: stringValue(
        schedule.timezone,
        DEFAULT_ASSISTANT_TRIGGER_SETTINGS.schedule?.timezone ?? "",
      ),
    },
    calendar: {
      enabled: booleanValue(
        calendar.enabled,
        DEFAULT_ASSISTANT_TRIGGER_SETTINGS.calendar?.enabled ?? false,
      ),
      upcomingMinutes: numberValue(
        calendar.upcomingMinutes,
        DEFAULT_ASSISTANT_TRIGGER_SETTINGS.calendar?.upcomingMinutes ?? 15,
      ),
      pollMinutes: numberValue(
        calendar.pollMinutes,
        DEFAULT_ASSISTANT_TRIGGER_SETTINGS.calendar?.pollMinutes ?? 5,
      ),
    },
    gmail: {
      enabled: booleanValue(
        gmail.enabled,
        DEFAULT_ASSISTANT_TRIGGER_SETTINGS.gmail?.enabled ?? false,
      ),
      query: stringValue(
        gmail.query,
        DEFAULT_ASSISTANT_TRIGGER_SETTINGS.gmail?.query ?? "",
      ),
      pollMinutes: numberValue(
        gmail.pollMinutes,
        DEFAULT_ASSISTANT_TRIGGER_SETTINGS.gmail?.pollMinutes ?? 5,
      ),
    },
    webhook: {
      enabled: booleanValue(
        webhook.enabled,
        DEFAULT_ASSISTANT_TRIGGER_SETTINGS.webhook?.enabled ?? false,
      ),
      webhookId:
        typeof webhook.webhookId === "string" ? webhook.webhookId : undefined,
      url: typeof webhook.url === "string" ? webhook.url : undefined,
      secretMasked:
        typeof webhook.secretMasked === "string"
          ? webhook.secretMasked
          : undefined,
      pollMinutes: numberValue(
        webhook.pollMinutes,
        DEFAULT_ASSISTANT_TRIGGER_SETTINGS.webhook?.pollMinutes ?? 1,
      ),
    },
  };
}

function inIntegerRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

function validCronPart(part: string, min: number, max: number): boolean {
  return part.split(",").every((segment) => {
    const [rangePart, stepPart] = segment.trim().split("/");
    if (!rangePart) return false;
    if (stepPart !== undefined) {
      const step = Number.parseInt(stepPart, 10);
      if (!Number.isInteger(step) || step < 1) return false;
    }
    if (rangePart === "*") return true;
    const [startRaw, endRaw] = rangePart.split("-");
    const start = Number.parseInt(startRaw, 10);
    const end = endRaw === undefined ? start : Number.parseInt(endRaw, 10);
    return (
      Number.isInteger(start) &&
      Number.isInteger(end) &&
      start >= min &&
      end <= max &&
      start <= end
    );
  });
}

export function isValidCronExpression(expression: string): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  return (
    validCronPart(fields[0], 0, 59) &&
    validCronPart(fields[1], 0, 23) &&
    validCronPart(fields[2], 1, 31) &&
    validCronPart(fields[3], 1, 12) &&
    validCronPart(fields[4], 0, 7)
  );
}

export function validateAssistantTriggerSettings(
  settings: AssistantTriggerSettings,
  connectors: AssistantTriggerConnectorState,
): AssistantTriggerValidationResult {
  const issues: AssistantTriggerValidationIssue[] = [];
  if (!settings.enabled) return { ok: true, issues };

  const scheduleEnabled = settings.schedule?.enabled === true;
  const calendarEnabled = settings.calendar?.enabled === true;
  const gmailEnabled = settings.gmail?.enabled === true;
  const webhookEnabled = settings.webhook?.enabled === true;
  if (!scheduleEnabled && !calendarEnabled && !gmailEnabled && !webhookEnabled) {
    issues.push("no_trigger_enabled");
  }

  if (settings.outputs.length === 0) {
    issues.push("outputs_required");
  }
  if (settings.outputs.includes("slack") && !connectors.slackReady) {
    issues.push("slack_output_unavailable");
  }
  if (settings.outputs.includes("telegram") && !connectors.telegramReady) {
    issues.push("telegram_output_unavailable");
  }

  if (scheduleEnabled && !isValidCronExpression(settings.schedule?.cron ?? "")) {
    issues.push("invalid_cron");
  }
  if (calendarEnabled) {
    if (!connectors.calendarConnected) {
      issues.push("calendar_connector_required");
    }
    if (
      !inIntegerRange(
        settings.calendar?.pollMinutes ?? 0,
        MIN_POLL_MINUTES,
        MAX_POLL_MINUTES,
      )
    ) {
      issues.push("calendar_poll_out_of_range");
    }
    if (
      !inIntegerRange(
        settings.calendar?.upcomingMinutes ?? 0,
        MIN_UPCOMING_MINUTES,
        MAX_UPCOMING_MINUTES,
      )
    ) {
      issues.push("calendar_upcoming_out_of_range");
    }
  }
  if (gmailEnabled) {
    if (!connectors.gmailConnected) issues.push("gmail_connector_required");
    if (
      !inIntegerRange(
        settings.gmail?.pollMinutes ?? 0,
        MIN_POLL_MINUTES,
        MAX_POLL_MINUTES,
      )
    ) {
      issues.push("gmail_poll_out_of_range");
    }
  }
  if (
    webhookEnabled &&
    !inIntegerRange(
      settings.webhook?.pollMinutes ?? 0,
      MIN_POLL_MINUTES,
      MAX_POLL_MINUTES,
    )
  ) {
    issues.push("webhook_poll_out_of_range");
  }

  return { ok: issues.length === 0, issues };
}
