import { describe, expect, it } from "vitest";
import {
  normalizeAssistantTriggerSettings,
  normalizeAssistantTriggerSettingsForSave,
  validateAssistantTriggerSettings,
  type AssistantTriggerConnectorState,
  type AssistantTriggerSettings,
} from "../../src/lib/assistantTriggerSettings";

const connectorsReady: AssistantTriggerConnectorState = {
  slackReady: true,
  telegramReady: true,
  calendarConnected: true,
  gmailConnected: true,
  sheetsConnected: true,
};

const validSettings: AssistantTriggerSettings = {
  enabled: true,
  outputs: ["slack"],
  schedule: { enabled: true, cron: "0 9 * * 1-5", timezone: "Asia/Seoul" },
  calendar: { enabled: false, upcomingMinutes: 15, pollMinutes: 5 },
  gmail: { enabled: false, query: "in:inbox", pollMinutes: 5 },
  sheets: {
    enabled: false,
    spreadsheetId: "",
    range: "A:Z",
    pollMinutes: 5,
  },
};

const sheetsOnly = (
  overrides: Partial<NonNullable<AssistantTriggerSettings["sheets"]>>,
): AssistantTriggerSettings => ({
  ...validSettings,
  schedule: { enabled: false, cron: "0 9 * * 1-5" },
  sheets: {
    enabled: true,
    spreadsheetId: "1BxiMVs0XRA5nFMdKvBd",
    range: "A:Z",
    pollMinutes: 5,
    ...overrides,
  },
});

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

  it("시트 조건은 스코프가 없으면 저장을 막는다 — 켜놓고 안 도는 상태를 만들지 않는다", () => {
    const result = validateAssistantTriggerSettings(sheetsOnly({}), {
      ...connectorsReady,
      sheetsConnected: false,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContain("sheets_connector_required");
  });

  it("시트 조건은 스프레드시트 지정을 요구한다", () => {
    const blank = validateAssistantTriggerSettings(
      sheetsOnly({ spreadsheetId: "   " }),
      connectorsReady,
    );
    expect(blank.issues).toContain("sheets_spreadsheet_required");

    // 시트가 아닌 구글 문서 URL 은 통과시키지 않는다.
    const wrongDoc = validateAssistantTriggerSettings(
      sheetsOnly({
        spreadsheetId: "https://docs.google.com/document/d/AAA/edit",
      }),
      connectorsReady,
    );
    expect(wrongDoc.issues).toContain("sheets_spreadsheet_required");

    // URL 을 붙여넣어도 유효하다.
    const fromUrl = validateAssistantTriggerSettings(
      sheetsOnly({
        spreadsheetId:
          "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBd/edit#gid=0",
      }),
      connectorsReady,
    );
    expect(fromUrl.ok).toBe(true);
  });

  it("시트 폴링 간격은 기존 gmail/calendar 와 같은 1~60분 규칙을 따른다", () => {
    expect(
      validateAssistantTriggerSettings(
        sheetsOnly({ pollMinutes: 0 }),
        connectorsReady,
      ).issues,
    ).toContain("sheets_poll_out_of_range");
    expect(
      validateAssistantTriggerSettings(
        sheetsOnly({ pollMinutes: 61 }),
        connectorsReady,
      ).issues,
    ).toContain("sheets_poll_out_of_range");
    expect(
      validateAssistantTriggerSettings(
        sheetsOnly({ pollMinutes: 1 }),
        connectorsReady,
      ).ok,
    ).toBe(true);
    expect(
      validateAssistantTriggerSettings(
        sheetsOnly({ pollMinutes: 60 }),
        connectorsReady,
      ).ok,
    ).toBe(true);
  });

  it("시트 조건만 켜도 트리거가 하나 켜진 것으로 센다", () => {
    const result = validateAssistantTriggerSettings(
      sheetsOnly({}),
      connectorsReady,
    );
    expect(result.issues).not.toContain("no_trigger_enabled");
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
          sheetsConnected: false,
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
    // 시트 기본값도 폼이 그릴 수 있게 채워진다.
    expect(normalized.sheets?.enabled).toBe(false);
    expect(normalized.sheets?.range).toBe("A:Z");
  });
});

describe("normalizeAssistantTriggerSettingsForSave", () => {
  it("저장 직전 스프레드시트 URL 을 ID 로 줄이고 빈 범위를 채운다", () => {
    const saved = normalizeAssistantTriggerSettingsForSave(
      sheetsOnly({
        spreadsheetId:
          "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBd/edit#gid=7",
        range: "  ",
      }),
    );

    expect(saved.sheets?.spreadsheetId).toBe("1BxiMVs0XRA5nFMdKvBd");
    expect(saved.sheets?.range).toBe("A:Z");
  });
});
