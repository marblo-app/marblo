import { describe, expect, it } from "vitest";
import {
  normalizeAssistantTriggerSettings,
  validateAssistantTriggerSettings,
  type AssistantTriggerConnectorState,
  type AssistantTriggerSettings,
} from "../../src/lib/assistantTriggerSettings";

const connectorsReady: AssistantTriggerConnectorState = {
  slackReady: true,
  telegramReady: true,
  calendarConnected: true,
  gmailConnected: true,
};

const validSettings: AssistantTriggerSettings = {
  enabled: true,
  outputs: ["slack"],
  schedule: { enabled: true, cron: "0 9 * * 1-5", timezone: "Asia/Seoul" },
  calendar: { enabled: false, upcomingMinutes: 15, pollMinutes: 5 },
  gmail: { enabled: false, query: "in:inbox", pollMinutes: 5 },
};

describe("validateAssistantTriggerSettings", () => {
  it("불법 cron 형식을 거부한다", () => {
    const result = validateAssistantTriggerSettings(
      {
        ...validSettings,
        schedule: { enabled: true, cron: "nope", timezone: "Asia/Seoul" },
      },
      connectorsReady,
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toContain("invalid_cron");
  });

  it("출력 채널 누락을 거부한다", () => {
    const result = validateAssistantTriggerSettings(
      { ...validSettings, outputs: [] },
      connectorsReady,
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toContain("outputs_required");
  });

  it("폴링 간격 범위를 검증한다", () => {
    const result = validateAssistantTriggerSettings(
      {
        ...validSettings,
        schedule: { enabled: false, cron: "0 9 * * 1-5" },
        calendar: { enabled: true, upcomingMinutes: 15, pollMinutes: 0 },
        gmail: { enabled: true, query: "in:inbox", pollMinutes: 61 },
      },
      connectorsReady,
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        "calendar_poll_out_of_range",
        "gmail_poll_out_of_range",
      ]),
    );
  });

  it("웹훅 조건은 커넥터 없이 켤 수 있지만 poll 범위는 검증한다", () => {
    const result = validateAssistantTriggerSettings(
      {
        ...validSettings,
        schedule: { enabled: false, cron: "0 9 * * 1-5" },
        webhook: { enabled: true, webhookId: "awh_test", pollMinutes: 0 },
      },
      {
        slackReady: true,
        telegramReady: false,
        calendarConnected: false,
        gmailConnected: false,
      },
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(["webhook_poll_out_of_range"]);
  });

  it("캘린더와 지메일 조건이 커넥터 없이 켜진 경우 거부한다", () => {
    const result = validateAssistantTriggerSettings(
      {
        ...validSettings,
        schedule: { enabled: false, cron: "0 9 * * 1-5" },
        calendar: { enabled: true, upcomingMinutes: 15, pollMinutes: 5 },
        gmail: { enabled: true, query: "in:inbox", pollMinutes: 5 },
      },
      {
        ...connectorsReady,
        calendarConnected: false,
        gmailConnected: false,
      },
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        "calendar_connector_required",
        "gmail_connector_required",
      ]),
    );
  });

  it("꺼진 설정은 fail-closed 저장을 허용한다", () => {
    expect(
      validateAssistantTriggerSettings(
        {
          ...validSettings,
          enabled: false,
          outputs: [],
          schedule: { enabled: false, cron: "broken" },
        },
        {
          slackReady: false,
          telegramReady: false,
          calendarConnected: false,
          gmailConnected: false,
        },
      ),
    ).toEqual({ ok: true, issues: [] });
  });
});

describe("normalizeAssistantTriggerSettings", () => {
  it("프로젝트 문서 값을 화면 폼 기본값으로 정규화한다", () => {
    const normalized = normalizeAssistantTriggerSettings({
      enabled: true,
      outputs: ["telegram", "unknown"],
      gmail: { enabled: true, pollMinutes: 3 },
    });

    expect(normalized.enabled).toBe(true);
    expect(normalized.outputs).toEqual(["telegram"]);
    expect(normalized.gmail?.enabled).toBe(true);
    expect(normalized.gmail?.pollMinutes).toBe(3);
    expect(normalized.webhook?.pollMinutes).toBe(1);
    expect(normalized.schedule?.cron).toBe("0 9 * * 1-5");
  });
});
