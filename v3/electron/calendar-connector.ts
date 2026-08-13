/**
 * Google Calendar 읽기 전용 커넥터.
 *
 * events.list 만 감싼다. 토큰은 Authorization 헤더에만 들어가고, 반환형은
 * 에이전트/렌더러가 쓰기 쉬운 일정 중립형으로 줄인다.
 */

export type CalendarFetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<Response>;

export const CALENDAR_EVENTS_ENDPOINT =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events";

export const CALENDAR_EVENTS_FIELDS =
  "nextPageToken,items(id,summary,description,location,htmlLink,start,end,attendees(email,displayName,responseStatus),organizer(email,displayName),updated,status)";

const MAX_EVENTS = 50;
const DEFAULT_MAX_EVENTS = 10;

export interface CalendarListParams {
  timeMin?: string;
  timeMax?: string;
  query?: string;
  maxResults?: number;
  pageToken?: string;
}

export interface CalendarAttendee {
  email?: string;
  displayName?: string;
  responseStatus?: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  attendees: CalendarAttendee[];
  location?: string;
  description?: string;
  htmlLink?: string;
  organizer?: CalendarAttendee;
  updated?: string;
  status?: string;
}

export interface CalendarListResult {
  events: CalendarEvent[];
  nextPageToken?: string;
}

export interface CalendarConnectorOptions {
  getAccessToken: () => Promise<string>;
  fetchImpl?: CalendarFetchLike;
}

export interface CalendarConnector {
  list(params: CalendarListParams): Promise<CalendarListResult>;
}

export class CalendarApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "CalendarApiError";
    this.status = status;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function clampMaxResults(maxResults?: number): number {
  if (!maxResults || !Number.isFinite(maxResults)) return DEFAULT_MAX_EVENTS;
  return Math.min(Math.max(Math.trunc(maxResults), 1), MAX_EVENTS);
}

export function buildCalendarListParams(
  params: CalendarListParams,
): URLSearchParams {
  const search = new URLSearchParams({
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(clampMaxResults(params.maxResults)),
    fields: CALENDAR_EVENTS_FIELDS,
  });
  const timeMin = params.timeMin?.trim();
  const timeMax = params.timeMax?.trim();
  const query = params.query?.trim();
  if (timeMin) search.set("timeMin", timeMin);
  if (timeMax) search.set("timeMax", timeMax);
  if (query) search.set("q", query);
  if (params.pageToken) search.set("pageToken", params.pageToken);
  return search;
}

function attendeeFrom(raw: unknown): CalendarAttendee | null {
  const record = asRecord(raw);
  if (!record) return null;
  const email = stringField(record.email);
  const displayName = stringField(record.displayName);
  const responseStatus = stringField(record.responseStatus);
  if (!email && !displayName && !responseStatus) return null;
  return { email, displayName, responseStatus };
}

function eventTime(raw: unknown): string | undefined {
  const record = asRecord(raw);
  return stringField(record?.dateTime) ?? stringField(record?.date);
}

export function parseCalendarEvent(raw: unknown): CalendarEvent | null {
  const record = asRecord(raw);
  const id = stringField(record?.id);
  if (!id) return null;
  const start = eventTime(record?.start);
  const end = eventTime(record?.end);
  if (!start || !end) return null;
  const attendees = Array.isArray(record?.attendees)
    ? record.attendees
        .map((attendee) => attendeeFrom(attendee))
        .filter((attendee): attendee is CalendarAttendee => attendee !== null)
    : [];
  return {
    id,
    title: stringField(record?.summary) ?? "(제목 없음)",
    start,
    end,
    attendees,
    location: stringField(record?.location),
    description: stringField(record?.description),
    htmlLink: stringField(record?.htmlLink),
    organizer: attendeeFrom(record?.organizer) ?? undefined,
    updated: stringField(record?.updated),
    status: stringField(record?.status),
  };
}

export function parseCalendarListResult(raw: unknown): CalendarListResult {
  const record = asRecord(raw);
  const rawItems = record && Array.isArray(record.items) ? record.items : [];
  return {
    events: rawItems
      .map((item) => parseCalendarEvent(item))
      .filter((event): event is CalendarEvent => event !== null),
    nextPageToken: stringField(record?.nextPageToken),
  };
}

export function calendarErrorMessage(status: number, body: unknown): string {
  const error = asRecord(asRecord(body)?.error);
  const detail = stringField(error?.message);
  if (status === 401) {
    return "Google Calendar 인증이 만료되었습니다. Harness 탭에서 Google 계정을 다시 연결해 주세요.";
  }
  if (status === 403) {
    return `Calendar 읽기 권한이 없거나 Calendar API 가 활성화되지 않았습니다${detail ? `: ${detail}` : "."}`;
  }
  if (status === 429) {
    return "Calendar 요청 한도를 넘었습니다. 잠시 후 다시 시도하세요.";
  }
  return `Calendar 오류 (HTTP ${status})${detail ? `: ${detail}` : ""}`;
}

export function createCalendarConnector(
  options: CalendarConnectorOptions,
): CalendarConnector {
  const doFetch: CalendarFetchLike = options.fetchImpl ?? fetch;

  async function authorizedFetch(url: string): Promise<Response> {
    const accessToken = await options.getAccessToken();
    return doFetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }

  return {
    async list(params: CalendarListParams): Promise<CalendarListResult> {
      const search = buildCalendarListParams(params);
      const response = await authorizedFetch(
        `${CALENDAR_EVENTS_ENDPOINT}?${search}`,
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new CalendarApiError(
          response.status,
          calendarErrorMessage(response.status, body),
        );
      }
      return parseCalendarListResult(await response.json());
    },
  };
}
