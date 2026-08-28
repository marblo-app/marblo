/**
 * 시트 폴링 경로의 **되살렸을 때** 규칙.
 *
 * 스코프 0 (설계 §3.5 · 티켓 kJbIsaRPjMnGQTvDbR1V)이 `sheets_trigger` 를 보류
 * 시키면서 `validateAssistantTriggerSettings` 의 시트 분기가 조기 반환한다.
 * ★그렇다고 옛 규칙(스코프 필요 · 스프레드시트 필수 · 1~60분)을 **지우지
 * 않았다**(#1267 규율: 삭제가 아니라 보류). 지우지 않았다면 지켜야 한다 —
 * 안 지키면 되살릴 때 조용히 썩어 있는 것을 발견하게 된다.
 *
 * 그래서 이 파일은 `isCapabilityWithheld` 만 뒤집어 그 분기를 열고, 원래
 * 티켓(#1259)이 세운 검사 셋을 그대로 지킨다. vitest 의 mock 은 파일 단위라
 * 형제 테스트(`assistant-trigger-settings.test.ts`)의 보류 동작과 섞이지 않는다.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../electron/google-restricted-scopes", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../electron/google-restricted-scopes")
  >();
  return {
    ...actual,
    isCapabilityWithheld: (capability: string) =>
      capability === "sheets_trigger" ? false : actual.isCapabilityWithheld(
        capability as Parameters<typeof actual.isCapabilityWithheld>[0],
      ),
  };
});

const { validateAssistantTriggerSettings } = await import(
  "../../src/lib/assistantTriggerSettings"
);
type AssistantTriggerConnectorState = import(
  "../../src/lib/assistantTriggerSettings"
).AssistantTriggerConnectorState;
type AssistantTriggerSettings = import(
  "../../src/lib/assistantTriggerSettings"
).AssistantTriggerSettings;

const connectorsReady: AssistantTriggerConnectorState = {
  slackReady: true,
  telegramReady: true,
  calendarConnected: true,
  gmailConnected: true,
  sheetsConnected: true,
};

const sheetsOnly = (
  overrides: Partial<NonNullable<AssistantTriggerSettings["sheets"]>>,
): AssistantTriggerSettings => ({
  enabled: true,
  outputs: ["slack"],
  schedule: { enabled: false, cron: "0 9 * * 1-5" },
  calendar: { enabled: false, upcomingMinutes: 15, pollMinutes: 5 },
  gmail: { enabled: false, query: "in:inbox", pollMinutes: 5 },
  sheets: {
    enabled: true,
    spreadsheetId: "1BxiMVs0XRA5nFMdKvBd",
    range: "A:Z",
    pollMinutes: 5,
    ...overrides,
  },
});

describe("시트 폴링 보류가 풀리면 옛 규칙이 그대로 돌아온다", () => {
  it("스코프가 없으면 저장을 막는다 — 켜놓고 안 도는 상태를 만들지 않는다", () => {
    const result = validateAssistantTriggerSettings(sheetsOnly({}), {
      ...connectorsReady,
      sheetsConnected: false,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContain("sheets_connector_required");
    expect(result.issues).not.toContain("sheets_trigger_withheld");
  });

  it("스프레드시트 지정을 요구한다", () => {
    expect(
      validateAssistantTriggerSettings(
        sheetsOnly({ spreadsheetId: "   " }),
        connectorsReady,
      ).issues,
    ).toContain("sheets_spreadsheet_required");

    // 시트가 아닌 구글 문서 URL 은 통과시키지 않는다.
    expect(
      validateAssistantTriggerSettings(
        sheetsOnly({
          spreadsheetId: "https://docs.google.com/document/d/AAA/edit",
        }),
        connectorsReady,
      ).issues,
    ).toContain("sheets_spreadsheet_required");

    // URL 을 붙여넣어도 유효하다.
    expect(
      validateAssistantTriggerSettings(
        sheetsOnly({
          spreadsheetId:
            "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBd/edit#gid=0",
        }),
        connectorsReady,
      ).ok,
    ).toBe(true);
  });

  it("폴링 간격은 gmail/calendar 와 같은 1~60분 규칙을 따른다", () => {
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
});
