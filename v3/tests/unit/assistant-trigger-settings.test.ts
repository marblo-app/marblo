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

  it("폴링 간격 범위를 검증한다 — 보류되지 않은 웹훅 경로에서", () => {
    const result = validateAssistantTriggerSettings(
      {
        ...validSettings,
        schedule: { enabled: false, cron: "0 9 * * 1-5" },
        webhook: { enabled: true, webhookId: "awh_test", pollMinutes: 61 },
      },
      connectorsReady,
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toContain("webhook_poll_out_of_range");
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

  /**
   * ★이 티켓이 고친 비대칭. 시트는 회수를 감지해 저장을 막고 있었는데
   * 캘린더·Gmail 은 스코프가 살아 있는 척 통과시켰다 — 사용자는 걸어놨다고
   * 믿고, 트리거는 영원히 돌지 않았다. 조용히 저장되는 것이 조용히 실패하는
   * 것보다 나쁘다.
   *
   * 커넥터가 붙어 있든 아니든 결과가 같아야 한다는 것이 요점이다. 지금 막는
   * 이유는 연결이 아니라 우리가 회수한 스코프이기 때문이다.
   */
  it("캘린더·Gmail 조건은 회수됐다 — 커넥터가 붙어 있어도 '연결 필요' 가 아니라 '회수' 로 막는다", () => {
    const result = validateAssistantTriggerSettings(
      {
        ...validSettings,
        schedule: { enabled: false, cron: "0 9 * * 1-5" },
        calendar: { enabled: true, upcomingMinutes: 15, pollMinutes: 5 },
        gmail: { enabled: true, query: "in:inbox", pollMinutes: 5 },
      },
      connectorsReady,
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        "calendar_trigger_withheld",
        "gmail_trigger_withheld",
      ]),
    );
    expect(result.issues).not.toContain("calendar_connector_required");
    expect(result.issues).not.toContain("gmail_connector_required");
  });

  it("커넥터가 없어도 같은 이슈를 낸다 — 판정 근거가 연결이 아니기 때문이다", () => {
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

    expect(result.issues).toEqual([
      "calendar_trigger_withheld",
      "gmail_trigger_withheld",
    ]);
  });

  it("보류 중에는 캘린더·Gmail 형식 오류를 겹쳐 띄우지 않는다", () => {
    const result = validateAssistantTriggerSettings(
      {
        ...validSettings,
        schedule: { enabled: false, cron: "0 9 * * 1-5" },
        calendar: { enabled: true, upcomingMinutes: 0, pollMinutes: 0 },
        gmail: { enabled: true, query: "in:inbox", pollMinutes: 61 },
      },
      connectorsReady,
    );

    expect(result.issues).toEqual([
      "calendar_trigger_withheld",
      "gmail_trigger_withheld",
    ]);
  });

  /**
   * ★회수된 값 자체는 지우지 않는다 — 보류이지 삭제가 아니다. 검증은 순수
   * 함수이므로 입력을 건드릴 수 없어야 하고, 그 계약을 여기서 못박는다.
   */
  it("저장된 값을 지우지 않는다", () => {
    const settings: AssistantTriggerSettings = {
      ...validSettings,
      schedule: { enabled: false, cron: "0 9 * * 1-5" },
      calendar: { enabled: true, upcomingMinutes: 30, pollMinutes: 7 },
      gmail: { enabled: true, query: "in:inbox label:vip", pollMinutes: 9 },
    };
    const snapshot = JSON.parse(JSON.stringify(settings));

    validateAssistantTriggerSettings(settings, connectorsReady);

    expect(settings).toEqual(snapshot);
  });

  /**
   * 세 트리거가 같은 규율 아래 있는지 한자리에서 본다 — 하나만 빠져 있던 것이
   * 이 티켓의 결함이었으므로, 셋을 함께 보는 테스트가 그 재발을 막는다.
   */
  it("세 구글 트리거(sheets·gmail·calendar) 모두 회수 상태에서 이슈가 뜬다", () => {
    const result = validateAssistantTriggerSettings(
      {
        ...validSettings,
        schedule: { enabled: false, cron: "0 9 * * 1-5" },
        calendar: { enabled: true, upcomingMinutes: 15, pollMinutes: 5 },
        gmail: { enabled: true, query: "in:inbox", pollMinutes: 5 },
        sheets: {
          enabled: true,
          spreadsheetId: "1BxiMVs0XRA5nFMdKvBd",
          range: "A:Z",
          pollMinutes: 5,
        },
      },
      connectorsReady,
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        "calendar_trigger_withheld",
        "gmail_trigger_withheld",
        "sheets_trigger_withheld",
      ]),
    );
  });

  /**
   * ★스코프 0 (설계 §3.5 · 티켓 kJbIsaRPjMnGQTvDbR1V) 이후의 시트 조건.
   *
   * 스코프가 붙어 있든 아니든 **폴링 경로는 보류**다. 그래서 여기서 확인하는
   * 것은 "연결이 없다" 가 아니라 "방식이 바뀌었다" 쪽 이슈가 나오는지다 —
   * 두 이슈를 나눠 둔 이유가 문구이므로, 어느 쪽이 나오는지가 곧 계약이다.
   *
   * 보류가 풀렸을 때의 옛 규칙(스코프·스프레드시트·주기)은 지우지 않고
   * `assistant-trigger-settings-sheets-restored.test.ts` 가 그대로 지킨다.
   */
  it("시트 조건은 보류됐다 — 스코프가 있어도 '연결 필요' 가 아니라 '방식이 바뀜' 으로 막는다", () => {
    const result = validateAssistantTriggerSettings(
      sheetsOnly({
        spreadsheetId:
          "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBd/edit#gid=0",
      }),
      connectorsReady,
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toContain("sheets_trigger_withheld");
    expect(result.issues).not.toContain("sheets_connector_required");
  });

  it("보류 중에는 형식 오류를 겹쳐 띄우지 않는다 — 할 일 한 문장이 잡음에 묻히지 않게", () => {
    const result = validateAssistantTriggerSettings(
      sheetsOnly({ spreadsheetId: "   ", pollMinutes: 0 }),
      { ...connectorsReady, sheetsConnected: false },
    );

    expect(result.issues).toEqual(["sheets_trigger_withheld"]);
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
