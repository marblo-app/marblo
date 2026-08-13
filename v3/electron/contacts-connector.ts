/**
 * Google Contacts 읽기 전용 커넥터.
 *
 * People API people.connections.list 만 사용한다. 토큰은 Authorization 헤더에만
 * 들어가고, 이름/이메일 검색은 받아온 연락처의 정규화된 필드에서 수행한다.
 */

export type ContactsFetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string> }
) => Promise<Response>;

export const CONTACTS_CONNECTIONS_ENDPOINT =
  "https://people.googleapis.com/v1/people/me/connections";

export const CONTACTS_PERSON_FIELDS =
  "names,emailAddresses,phoneNumbers,organizations";

export const CONTACTS_RESPONSE_FIELDS =
  "nextPageToken,connections(resourceName,names(displayName,givenName,familyName),emailAddresses(value,type),phoneNumbers(value,canonicalForm,type),organizations(name,title,department))";

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 1000;
const DEFAULT_MAX_RESULTS = 20;
const MAX_RESULTS = 100;
const DEFAULT_MAX_PAGES = 10;

export interface ContactsSearchParams {
  query: string;
  pageSize?: number;
  maxResults?: number;
}

export interface ContactEmail {
  value: string;
  type?: string;
}

export interface ContactPhone {
  value: string;
  type?: string;
}

export interface ContactOrganization {
  name?: string;
  title?: string;
  department?: string;
}

export interface ContactPerson {
  resourceName: string;
  names: string[];
  emails: ContactEmail[];
  phones: ContactPhone[];
  organizations: ContactOrganization[];
}

export interface ContactsSearchResult {
  contacts: ContactPerson[];
  totalScanned: number;
  truncated: boolean;
}

export interface ContactsConnectorOptions {
  getAccessToken: () => Promise<string>;
  fetchImpl?: ContactsFetchLike;
}

export interface ContactsConnector {
  search(params: ContactsSearchParams): Promise<ContactsSearchResult>;
}

export class ContactsApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ContactsApiError";
    this.status = status;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function clampInt(value: number | undefined, fallback: number, max: number) {
  if (!value || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), max);
}

export function buildContactsListParams(
  pageSize?: number,
  pageToken?: string
): URLSearchParams {
  const search = new URLSearchParams({
    personFields: CONTACTS_PERSON_FIELDS,
    fields: CONTACTS_RESPONSE_FIELDS,
    pageSize: String(clampInt(pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)),
  });
  if (pageToken) search.set("pageToken", pageToken);
  return search;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))];
}

function parseContact(raw: unknown): ContactPerson | null {
  const record = asRecord(raw);
  const resourceName = stringField(record?.resourceName);
  if (!resourceName) return null;

  const names = Array.isArray(record?.names)
    ? uniqueStrings(
        record.names.map((rawName) => {
          const name = asRecord(rawName);
          return (
            stringField(name?.displayName) ??
            uniqueStrings([
              stringField(name?.givenName),
              stringField(name?.familyName),
            ]).join(" ")
          );
        })
      )
    : [];

  const emails = Array.isArray(record?.emailAddresses)
    ? record.emailAddresses
        .map((rawEmail): ContactEmail | null => {
          const email = asRecord(rawEmail);
          const value = stringField(email?.value);
          return value ? { value, type: stringField(email?.type) } : null;
        })
        .filter((email): email is ContactEmail => email !== null)
    : [];

  const phones = Array.isArray(record?.phoneNumbers)
    ? record.phoneNumbers
        .map((rawPhone): ContactPhone | null => {
          const phone = asRecord(rawPhone);
          const value =
            stringField(phone?.canonicalForm) ?? stringField(phone?.value);
          return value ? { value, type: stringField(phone?.type) } : null;
        })
        .filter((phone): phone is ContactPhone => phone !== null)
    : [];

  const organizations = Array.isArray(record?.organizations)
    ? record.organizations
        .map((rawOrg): ContactOrganization | null => {
          const org = asRecord(rawOrg);
          const parsed = {
            name: stringField(org?.name),
            title: stringField(org?.title),
            department: stringField(org?.department),
          };
          return parsed.name || parsed.title || parsed.department
            ? parsed
            : null;
        })
        .filter((org): org is ContactOrganization => org !== null)
    : [];

  if (names.length === 0 && emails.length === 0) return null;
  return { resourceName, names, emails, phones, organizations };
}

export function parseContactsPage(raw: unknown): {
  contacts: ContactPerson[];
  nextPageToken?: string;
} {
  const record = asRecord(raw);
  const rawConnections =
    record && Array.isArray(record.connections) ? record.connections : [];
  return {
    contacts: rawConnections
      .map((connection) => parseContact(connection))
      .filter((contact): contact is ContactPerson => contact !== null),
    nextPageToken: stringField(record?.nextPageToken),
  };
}

function matchesContact(contact: ContactPerson, normalizedQuery: string) {
  const haystack = [
    ...contact.names,
    ...contact.emails.map((email) => email.value),
  ]
    .join("\n")
    .toLocaleLowerCase();
  return haystack.includes(normalizedQuery);
}

export function contactsErrorMessage(status: number, body: unknown): string {
  const error = asRecord(asRecord(body)?.error);
  const detail = stringField(error?.message);
  if (status === 401) {
    return "Google Contacts 인증이 만료되었습니다. Harness 탭에서 Google 계정을 다시 연결해 주세요.";
  }
  if (status === 403) {
    return `Contacts 읽기 권한이 없거나 People API 가 활성화되지 않았습니다${
      detail ? `: ${detail}` : "."
    }`;
  }
  if (status === 429) {
    return "Contacts 요청 한도를 넘었습니다. 잠시 후 다시 시도하세요.";
  }
  return `Contacts 오류 (HTTP ${status})${detail ? `: ${detail}` : ""}`;
}

export function createContactsConnector(
  options: ContactsConnectorOptions
): ContactsConnector {
  const doFetch: ContactsFetchLike = options.fetchImpl ?? fetch;

  async function authorizedFetch(url: string): Promise<Response> {
    const accessToken = await options.getAccessToken();
    return doFetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }

  async function listPage(
    pageSize: number | undefined,
    pageToken?: string
  ): Promise<{ contacts: ContactPerson[]; nextPageToken?: string }> {
    const search = buildContactsListParams(pageSize, pageToken);
    const response = await authorizedFetch(
      `${CONTACTS_CONNECTIONS_ENDPOINT}?${search}`
    );
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new ContactsApiError(
        response.status,
        contactsErrorMessage(response.status, body)
      );
    }
    return parseContactsPage(await response.json());
  }

  return {
    async search(params: ContactsSearchParams): Promise<ContactsSearchResult> {
      const normalizedQuery = params.query.trim().toLocaleLowerCase();
      if (!normalizedQuery) {
        return { contacts: [], totalScanned: 0, truncated: false };
      }

      const maxResults = clampInt(
        params.maxResults,
        DEFAULT_MAX_RESULTS,
        MAX_RESULTS
      );
      const contacts: ContactPerson[] = [];
      let totalScanned = 0;
      let pageToken: string | undefined;
      let pages = 0;

      do {
        const page = await listPage(params.pageSize, pageToken);
        pages += 1;
        totalScanned += page.contacts.length;
        contacts.push(
          ...page.contacts
            .filter((contact) => matchesContact(contact, normalizedQuery))
            .slice(0, maxResults - contacts.length)
        );
        pageToken = page.nextPageToken;
      } while (
        pageToken &&
        contacts.length < maxResults &&
        pages < DEFAULT_MAX_PAGES
      );

      return {
        contacts,
        totalScanned,
        truncated: Boolean(pageToken),
      };
    },
  };
}
