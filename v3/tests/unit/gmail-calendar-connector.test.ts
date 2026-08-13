import { describe, expect, it } from "vitest";
import {
  buildGmailListParams,
  createGmailConnector,
  parseGmailMessage,
  parseGmailSearchResult,
  type GmailFetchLike,
} from "../../electron/gmail-connector";
import {
  buildCalendarListParams,
  createCalendarConnector,
  parseCalendarEvent,
  parseCalendarListResult,
  type CalendarFetchLike,
} from "../../electron/calendar-connector";

function b64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

describe("gmail connector", () => {
  it("검색 파라미터를 Gmail REST 형태로 만든다", () => {
    const params = buildGmailListParams({
      query: "from:a newer_than:7d",
      labelIds: ["INBOX", " "],
      pageSize: 500,
      pageToken: "NEXT",
    });
    expect(params.get("q")).toBe("from:a newer_than:7d");
    expect(params.getAll("labelIds")).toEqual(["INBOX"]);
    expect(params.get("maxResults")).toBe("50");
    expect(params.get("pageToken")).toBe("NEXT");
  });

  it("messages.list 응답에서 깨진 항목을 버린다", () => {
    expect(
      parseGmailSearchResult({
        nextPageToken: "N2",
        resultSizeEstimate: 3,
        messages: [
          { id: "M1", threadId: "T1" },
          { id: "BROKEN" },
          { id: "M2", threadId: "T2" },
        ],
      }),
    ).toEqual({
      messages: [
        { id: "M1", threadId: "T1" },
        { id: "M2", threadId: "T2" },
      ],
      nextPageToken: "N2",
      resultSizeEstimate: 3,
    });
  });

  it("messages.get 응답에서 제목/발신자/날짜/본문을 뽑는다", () => {
    const parsed = parseGmailMessage({
      id: "M1",
      threadId: "T1",
      labelIds: ["INBOX"],
      snippet: "hello",
      payload: {
        headers: [
          { name: "Subject", value: "Quarterly plan" },
          { name: "From", value: "a@example.com" },
          { name: "Date", value: "Thu, 13 Aug 2026 09:00:00 +0900" },
        ],
        parts: [
          {
            mimeType: "text/html",
            body: { data: b64url("<p>ignored html</p>") },
          },
          {
            mimeType: "text/plain",
            body: { data: b64url("plain body") },
          },
        ],
      },
    });
    expect(parsed).toMatchObject({
      id: "M1",
      threadId: "T1",
      subject: "Quarterly plan",
      from: "a@example.com",
      body: "plain body",
      labelIds: ["INBOX"],
      truncated: false,
    });
  });

  it("요청 토큰은 Authorization 헤더에만 싣는다", async () => {
    const calls: Array<{ url: string; authorization?: string }> = [];
    const fetchImpl: GmailFetchLike = async (url, init) => {
      calls.push({ url, authorization: init?.headers?.Authorization });
      return {
        ok: true,
        status: 200,
        json: async () => ({ messages: [{ id: "M1", threadId: "T1" }] }),
      } as unknown as Response;
    };
    const connector = createGmailConnector({
      getAccessToken: async () => "ACCESS",
      fetchImpl,
    });
    await connector.search({ query: "x" });
    expect(calls[0].authorization).toBe("Bearer ACCESS");
    expect(calls[0].url).not.toContain("ACCESS");
  });
});

describe("calendar connector", () => {
  it("events.list 파라미터를 기간 조회 형태로 만든다", () => {
    const params = buildCalendarListParams({
      timeMin: "2026-08-13T00:00:00.000Z",
      timeMax: "2026-08-14T00:00:00.000Z",
      query: "planning",
      maxResults: 500,
      pageToken: "NEXT",
    });
    expect(params.get("singleEvents")).toBe("true");
    expect(params.get("orderBy")).toBe("startTime");
    expect(params.get("maxResults")).toBe("50");
    expect(params.get("timeMin")).toBe("2026-08-13T00:00:00.000Z");
    expect(params.get("timeMax")).toBe("2026-08-14T00:00:00.000Z");
    expect(params.get("q")).toBe("planning");
    expect(params.get("pageToken")).toBe("NEXT");
  });

  it("일정에서 제목/시간/참석자를 뽑는다", () => {
    expect(
      parseCalendarEvent({
        id: "E1",
        summary: "Planning",
        start: { dateTime: "2026-08-13T09:00:00+09:00" },
        end: { dateTime: "2026-08-13T10:00:00+09:00" },
        attendees: [
          { email: "a@example.com", responseStatus: "accepted" },
          { displayName: "No Email" },
        ],
      }),
    ).toMatchObject({
      id: "E1",
      title: "Planning",
      start: "2026-08-13T09:00:00+09:00",
      end: "2026-08-13T10:00:00+09:00",
      attendees: [
        { email: "a@example.com", responseStatus: "accepted" },
        { displayName: "No Email" },
      ],
    });
  });

  it("events.list 응답에서 깨진 항목을 버린다", () => {
    expect(
      parseCalendarListResult({
        nextPageToken: "N2",
        items: [
          {
            id: "E1",
            summary: "Daily",
            start: { date: "2026-08-13" },
            end: { date: "2026-08-14" },
          },
          { id: "BROKEN" },
        ],
      }),
    ).toEqual({
      events: [
        {
          id: "E1",
          title: "Daily",
          start: "2026-08-13",
          end: "2026-08-14",
          attendees: [],
          description: undefined,
          htmlLink: undefined,
          location: undefined,
          organizer: undefined,
          status: undefined,
          updated: undefined,
        },
      ],
      nextPageToken: "N2",
    });
  });

  it("요청 토큰은 Authorization 헤더에만 싣는다", async () => {
    const calls: Array<{ url: string; authorization?: string }> = [];
    const fetchImpl: CalendarFetchLike = async (url, init) => {
      calls.push({ url, authorization: init?.headers?.Authorization });
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [] }),
      } as unknown as Response;
    };
    const connector = createCalendarConnector({
      getAccessToken: async () => "ACCESS",
      fetchImpl,
    });
    await connector.list({ timeMin: "2026-08-13T00:00:00.000Z" });
    expect(calls[0].authorization).toBe("Bearer ACCESS");
    expect(calls[0].url).not.toContain("ACCESS");
  });
});
