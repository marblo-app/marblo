/**
 * 캘린더·Gmail 폴링 경로의 **되살렸을 때** 규칙.
 *
 * 스코프 0 (설계 §3.5)이 `calendar_trigger` · `gmail_trigger` 를 보류시키면서
 * `validateAssistantTriggerSettings` 의 두 분기가 조기 반환한다. ★그렇다고 옛
 * 규칙(커넥터 필요 · poll 1~60분 · upcoming 1~1440분)을 **지우지 않았다**
 * (#1267 규율: 삭제가 아니라 보류). 지우지 않았다면 지켜야 한다 — 안 지키면
 * 되살릴 때 조용히 썩어 있는 것을 발견하게 된다.
 *
 * 형제 파일 `assistant-trigger-settings-sheets-restored.test.ts` 가 시트에 대해
 * 하는 일을 이 파일이 캘린더·Gmail 에 대해 한다. vitest 의 mock 은 파일 단위라
 * `assistant-trigger-settings.test.ts` 의 보류 동작과 섞이지 않는다.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../electron/google-restricted-scopes", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../electron/google-restricted-scopes")
    >();
  return {
    ...actual,
    isCapabilityWithheld: (capability: string) =>
      capability === "calendar_trigger" || capability === "gmail_trigger"
        ? false
        : actual.isCapabilityWithheld(
            capability as Parameters<typeof actual.isCapabilityWithheld>[0],
          ),
  };
});

const { validateAssistantTriggerSettings } =
  await import("../../src/lib/assistantTriggerSettings");
type AssistantTriggerConnectorState =
  import("../../src/lib/assistantTriggerSettings").AssistantTriggerConnectorState;
type AssistantTriggerSettings =
  import("../../src/lib/assistantTriggerSettings").AssistantTriggerSettings;

const connectorsReady: AssistantTriggerConnectorState = {
  slackReady: true,
  telegramReady: true,
  calendarConnected: true,
  gmailConnected: true,
  sheetsConnected: true,
};

const base: AssistantTriggerSettings = {
  enabled: true,
  outputs: ["slack"],
  schedule: { enabled: false, cron: "0 9 * * 1-5" },
  calendar: { enabled: false, upcomingMinutes: 15, pollMinutes: 5 },
  gmail: { enabled: false, query: "in:inbox", pollMinutes: 5 },
  sheets: { enabled: false, spreadsheetId: "", range: "A:Z", pollMinutes: 5 },
};

const calendarOnly = (
  overrides: Partial<NonNullable<AssistantTriggerSettings["calendar"]>>,
): AssistantTriggerSettings => ({
  ...base,
  calendar: {
    enabled: true,
    upcomingMinutes: 15,
    pollMinutes: 5,
    ...overrides,
  },
});

const gmailOnly = (
  overrides: Partial<NonNullable<AssistantTriggerSettings["gmail"]>>,
): AssistantTriggerSettings => ({
  ...base,
  gmail: { enabled: true, query: "in:inbox", pollMinutes: 5, ...overrides },
});

describe("캘린더 폴링 보류가 풀리면 옛 규칙이 그대로 돌아온다", () => {
  it("스코프가 없으면 저장을 막는다 — 켜놓고 안 도는 상태를 만들지 않는다", () => {
    const result = validateAssistantTriggerSettings(calendarOnly({}), {
      ...connectorsReady,
      calendarConnected: false,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContain("calendar_connector_required");
    expect(result.issues).not.toContain("calendar_trigger_withheld");
  });

  it("poll 간격은 1~60분, 임박 범위는 1~1440분이다", () => {
    expect(
      validateAssistantTriggerSettings(
        calendarOnly({ pollMinutes: 0 }),
        connectorsReady,
      ).issues,
    ).toContain("calendar_poll_out_of_range");
    expect(
      validateAssistantTriggerSettings(
        calendarOnly({ pollMinutes: 61 }),
        connectorsReady,
      ).issues,
    ).toContain("calendar_poll_out_of_range");
    expect(
      validateAssistantTriggerSettings(
        calendarOnly({ upcomingMinutes: 0 }),
        connectorsReady,
      ).issues,
    ).toContain("calendar_upcoming_out_of_range");
    expect(
      validateAssistantTriggerSettings(
        calendarOnly({ upcomingMinutes: 1441 }),
        connectorsReady,
      ).issues,
    ).toContain("calendar_upcoming_out_of_range");
    expect(
      validateAssistantTriggerSettings(
        calendarOnly({ pollMinutes: 60, upcomingMinutes: 1440 }),
        connectorsReady,
      ).ok,
    ).toBe(true);
  });
});

describe("Gmail 폴링 보류가 풀리면 옛 규칙이 그대로 돌아온다", () => {
  it("스코프가 없으면 저장을 막는다", () => {
    const result = validateAssistantTriggerSettings(gmailOnly({}), {
      ...connectorsReady,
      gmailConnected: false,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContain("gmail_connector_required");
    expect(result.issues).not.toContain("gmail_trigger_withheld");
  });

  it("poll 간격은 1~60분이다", () => {
    expect(
      validateAssistantTriggerSettings(
        gmailOnly({ pollMinutes: 0 }),
        connectorsReady,
      ).issues,
    ).toContain("gmail_poll_out_of_range");
    expect(
      validateAssistantTriggerSettings(
        gmailOnly({ pollMinutes: 61 }),
        connectorsReady,
      ).issues,
    ).toContain("gmail_poll_out_of_range");
    expect(
      validateAssistantTriggerSettings(
        gmailOnly({ pollMinutes: 1 }),
        connectorsReady,
      ).ok,
    ).toBe(true);
  });
});

/**
 * ★시트는 이 파일에서 mock 되지 않는다 — 여기서 되살린 것은 캘린더·Gmail 뿐이고,
 * 셋이 **각각 독립된 스위치**라는 것이 `WITHHELD_CAPABILITIES` 를 집합으로 둔
 * 이유다(한꺼번에 되살릴 이유가 없다). 그 독립성을 여기서 확인한다.
 */
describe("보류는 트리거별로 독립이다", () => {
  it("캘린더·Gmail 을 되살려도 시트는 여전히 막힌다", () => {
    const result = validateAssistantTriggerSettings(
      {
        ...base,
        sheets: {
          enabled: true,
          spreadsheetId: "1BxiMVs0XRA5nFMdKvBd",
          range: "A:Z",
          pollMinutes: 5,
        },
      },
      connectorsReady,
    );

    expect(result.issues).toContain("sheets_trigger_withheld");
  });
});
