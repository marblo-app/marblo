import { describe, expect, it } from "vitest";
import {
  activeAssistantProjects,
  formatCalendarTriggerPrompt,
  formatDailyBriefingPrompt,
  formatGmailTriggerPrompt,
  parseAssistantTriggerSettings,
  parseCronExpression,
} from "../../electron/assistant-triggers";

describe("assistant triggers", () => {
  it("assistant kind 프로젝트의 명시 설정만 활성화한다", () => {
    const active = activeAssistantProjects([
      {
        id: "dev",
        name: "Dev",
        kind: "dev",
        assistantTriggers: { enabled: true, schedule: { enabled: true, cron: "0 9 * * *" } },
      },
      {
        id: "assistant",
        name: "Assistant",
        kind: "assistant",
        assistantTriggers: {
          enabled: true,
          outputs: ["slack"],
          schedule: { enabled: true, cron: "0 9 * * *", timezone: "Asia/Seoul" },
          calendar: { enabled: true, upcomingMinutes: 20, pollMinutes: 2 },
          gmail: { enabled: true, query: "from:boss", pollMinutes: 3 },
        },
      },
    ]);
    expect(active).toHaveLength(1);
    expect(active[0].settings.outputs).toEqual(["slack"]);
    expect(active[0].settings.schedule?.timezone).toBe("Asia/Seoul");
    expect(active[0].settings.calendar?.upcomingMinutes).toBe(20);
    expect(active[0].settings.gmail?.query).toBe("from:boss");
  });

  it("enabled 플래그가 없으면 fail-closed 한다", () => {
    expect(
      parseAssistantTriggerSettings({
        schedule: { enabled: true, cron: "0 9 * * *" },
      }),
    ).toBeNull();
  });

  it("5-field cron expression을 매칭한다", () => {
    const matcher = parseCronExpression("*/15 9-10 * * 1-5");
    expect(matcher.matches(new Date("2026-08-13T09:30:00+09:00"))).toBe(true);
    expect(matcher.matches(new Date("2026-08-13T09:31:00+09:00"))).toBe(false);
    expect(matcher.matches(new Date("2026-08-15T09:30:00+09:00"))).toBe(false);
  });

  it("스케줄 프롬프트는 기존 전송 도구와 비용 규율을 명시한다", () => {
    const prompt = formatDailyBriefingPrompt({
      projectId: "P1",
      projectName: "비서",
      outputs: ["slack", "telegram"],
      now: new Date("2026-08-13T00:00:00.000Z"),
    });
    expect(prompt).toContain("calendar_list");
    expect(prompt).toContain("gmail_search");
    expect(prompt).toContain("send_slack_message");
    expect(prompt).toContain("send_telegram_message");
    expect(prompt).toContain("mission_billing_quota");
  });

  it("이벤트 프롬프트는 입력을 짧게 정규화한다", () => {
    const calendarPrompt = formatCalendarTriggerPrompt({
      projectId: "P1",
      projectName: "비서",
      now: new Date("2026-08-13T00:00:00.000Z"),
      outputs: ["slack"],
      event: {
        id: "E1",
        title: "Planning",
        start: "2026-08-13T09:00:00+09:00",
        end: "2026-08-13T10:00:00+09:00",
        attendees: [],
        description: "Prepare ".repeat(200),
      },
    });
    expect(calendarPrompt).toContain("Assistant calendar trigger");
    expect(calendarPrompt).toContain("send_slack_message");
    expect(calendarPrompt.length).toBeLessThan(1_600);

    const gmailPrompt = formatGmailTriggerPrompt({
      projectId: "P1",
      projectName: "비서",
      now: new Date("2026-08-13T00:00:00.000Z"),
      outputs: ["telegram"],
      message: {
        id: "M1",
        threadId: "T1",
        subject: "Hello",
        from: "a@example.com",
        date: "Thu, 13 Aug 2026 09:00:00 +0900",
        snippet: "short",
        body: "Body ".repeat(500),
        labelIds: ["INBOX"],
        truncated: false,
      },
    });
    expect(gmailPrompt).toContain("Assistant Gmail trigger");
    expect(gmailPrompt).toContain("send_telegram_message");
    expect(gmailPrompt.length).toBeLessThan(2_200);
  });
});
