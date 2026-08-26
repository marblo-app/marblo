// 로그인 전 익명 텔레메트리 정책 — 순수 로직(BQ/Firestore 무의존).
//
// 배경: 광고 클릭 -> 설치 -> 첫 실행/데모/로그인 실패는 모두 로그인 전 구간이다.
// 기존 logTelemetryBatch 의 auth 게이트는 anti-abuse 용도였지만, 이 구간의 분자를
// 영구히 잃게 만들었다. 대체 후보 판단:
// - Firebase App Check: 좋은 1차 장벽이지만 현재 렌더러 Firebase 초기화가
//   functions/app-check 미사용이라고 명시한다(v3/src/lib/firebase.ts). 지금 채택하면
//   제품 초기화/배포 설정까지 새 표면이 생긴다.
// - 설치 clientId 기준 레이트리밋: 같은 설치의 재시도 루프를 직접 막는다. 단,
//   clientId 는 클라 생성값이라 IP 한도와 함께 써야 한다.
// - 전용 익명 endpoint + 좁은 스키마: 전체 이벤트를 열지 않고 광고 측정 구간만
//   받는다. 이 파일의 허용목록/metadata 스키마/계정식별자 차단이 그 보안 경계다.
//
// 결론: 전용 익명 endpoint 를 만들고 IP+clientId 레이트리밋을 같이 적용한다.
// App Check 는 초기화/운영 준비가 끝난 뒤 이 경로 위에 추가할 수 있는 보강재다.

export const ANONYMOUS_TELEMETRY_RECEIPTS_COLLECTION =
  "anonymousTelemetryReceipts";

export const ANONYMOUS_TELEMETRY_EVENTS = [
  "app:first_run",
  "auth:login_attempt",
  "auth:login_failed",
  "onboarding:demo_started",
  "onboarding:demo_completed",
  "onboarding:demo_cta_click",
] as const;

export type AnonymousTelemetryEvent =
  (typeof ANONYMOUS_TELEMETRY_EVENTS)[number];

export interface AnonymousTelemetryRow {
  event: AnonymousTelemetryEvent;
  clientId: string;
  clientEventId: string;
  appVersion: string | null;
  durationMs: number | null;
  success: boolean | null;
  errorCategory: string | null;
  errorMessage: string | null;
  metadata: Record<string, unknown> | null;
  timestamp: string;
}

export type AnonymousTelemetryRejectReason =
  | "events_array_required"
  | "max_100_events"
  | "event_object_required"
  | "event_not_allowed"
  | "bad_client_id"
  | "bad_client_event_id"
  | "duplicate_client_event_id"
  | "mixed_client_ids"
  | "forbidden_top_level_field"
  | "metadata_object_required"
  | "metadata_account_identifier"
  | "metadata_key_not_allowed"
  | "metadata_value_not_scalar";

export type AnonymousTelemetryParseResult =
  | { ok: true; rows: AnonymousTelemetryRow[]; clientId: string }
  | { ok: false; reason: AnonymousTelemetryRejectReason };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const MAX_STRING_FIELD = 100;
const MAX_ERROR_MESSAGE = 500;
const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F]/g;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_KR_RE = /\b01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}\b/g;
const PHONE_INTL_RE =
  /\+\d{1,3}[-.\s]?\d{2,4}[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g;

const ACCOUNT_IDENTIFIER_KEYS = [
  "accountId",
  "accountUserId",
  "authUserId",
  "email",
  "phone",
  "senderId",
  "uid",
  "userId",
] as const;

// 익명 endpoint 는 설치 축만 남긴다. 이 조인키들은 계정식별자 자체는 아니어도
// cost_logs 와 결합될 수 있는 원시 작업 축이라 로그인 전 익명 스키마에서는 거부한다.
const FORBIDDEN_TOP_LEVEL_FIELDS = [
  ...ACCOUNT_IDENTIFIER_KEYS,
  "agentId",
  "flowId",
  "parentAgentId",
  "projectId",
  "retryOf",
  "taskId",
] as const;

const ALLOWED_TOP_LEVEL_FIELDS = [
  "event",
  "clientId",
  "clientEventId",
  "appVersion",
  "durationMs",
  "success",
  "errorCategory",
  "errorMessage",
  "metadata",
] as const;

const ALLOWED_METADATA_KEYS: Record<AnonymousTelemetryEvent, readonly string[]> =
  {
    "app:first_run": ["platform"],
    "auth:login_attempt": ["method"],
    "auth:login_failed": ["method"],
    "onboarding:demo_started": ["surface"],
    "onboarding:demo_completed": ["reason"],
    "onboarding:demo_cta_click": [],
  };

export function isAnonymousTelemetryEvent(
  event: unknown
): event is AnonymousTelemetryEvent {
  return (
    typeof event === "string" &&
    (ANONYMOUS_TELEMETRY_EVENTS as readonly string[]).includes(event)
  );
}

function cleanString(raw: unknown, maxLength = MAX_STRING_FIELD): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .replace(CONTROL_CHARS_RE, "")
    .replace(EMAIL_RE, "<EMAIL>")
    .replace(PHONE_KR_RE, "<PHONE>")
    .replace(PHONE_INTL_RE, "<PHONE>")
    .trim()
    .slice(0, maxLength);
  return cleaned.length > 0 ? cleaned : null;
}

function cleanOptionalNumber(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0
    ? raw
    : null;
}

function cleanOptionalBoolean(raw: unknown): boolean | null {
  return typeof raw === "boolean" ? raw : null;
}

function normalizeUuid(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  return UUID_RE.test(value) ? value : null;
}

function hasForbiddenTopLevelField(row: Record<string, unknown>): boolean {
  for (const key of FORBIDDEN_TOP_LEVEL_FIELDS) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") {
      return true;
    }
  }
  for (const key of Object.keys(row)) {
    if (!(ALLOWED_TOP_LEVEL_FIELDS as readonly string[]).includes(key)) {
      return true;
    }
  }
  return false;
}

function containsAccountIdentifierKey(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some((entry) => containsAccountIdentifierKey(entry));
  }
  for (const [key, nested] of Object.entries(value)) {
    if ((ACCOUNT_IDENTIFIER_KEYS as readonly string[]).includes(key)) {
      return true;
    }
    if (containsAccountIdentifierKey(nested)) return true;
  }
  return false;
}

function parseMetadata(
  event: AnonymousTelemetryEvent,
  raw: unknown
):
  | { ok: true; metadata: Record<string, unknown> | null }
  | { ok: false; reason: AnonymousTelemetryRejectReason } {
  if (raw === undefined || raw === null) return { ok: true, metadata: null };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "metadata_object_required" };
  }
  if (containsAccountIdentifierKey(raw)) {
    return { ok: false, reason: "metadata_account_identifier" };
  }

  const allowedKeys = ALLOWED_METADATA_KEYS[event];
  const metadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!allowedKeys.includes(key)) {
      return { ok: false, reason: "metadata_key_not_allowed" };
    }
    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean" &&
      value !== null
    ) {
      return { ok: false, reason: "metadata_value_not_scalar" };
    }
    metadata[key] = typeof value === "string" ? cleanString(value) : value;
  }

  return {
    ok: true,
    metadata: Object.keys(metadata).length > 0 ? metadata : null,
  };
}

export function anonymousTelemetryReceiptDocId(
  clientId: string,
  clientEventId: string
): string {
  return `${clientId}_${clientEventId}`;
}

export function parseAnonymousTelemetryBatch(
  data: unknown,
  nowIso: string
): AnonymousTelemetryParseResult {
  const payload = data as { events?: unknown } | null | undefined;
  const events = payload?.events;
  if (!Array.isArray(events) || events.length === 0) {
    return { ok: false, reason: "events_array_required" };
  }
  if (events.length > 100) return { ok: false, reason: "max_100_events" };

  const rows: AnonymousTelemetryRow[] = [];
  const seenEventIds = new Set<string>();
  let batchClientId: string | null = null;

  for (const raw of events) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, reason: "event_object_required" };
    }
    const row = raw as Record<string, unknown>;
    if (hasForbiddenTopLevelField(row)) {
      return { ok: false, reason: "forbidden_top_level_field" };
    }
    if (!isAnonymousTelemetryEvent(row.event)) {
      return { ok: false, reason: "event_not_allowed" };
    }

    const clientId = normalizeUuid(row.clientId);
    if (!clientId) return { ok: false, reason: "bad_client_id" };
    if (batchClientId === null) {
      batchClientId = clientId;
    } else if (batchClientId !== clientId) {
      return { ok: false, reason: "mixed_client_ids" };
    }

    const clientEventId = normalizeUuid(row.clientEventId);
    if (!clientEventId) return { ok: false, reason: "bad_client_event_id" };
    if (seenEventIds.has(clientEventId)) {
      return { ok: false, reason: "duplicate_client_event_id" };
    }
    seenEventIds.add(clientEventId);

    const metadata = parseMetadata(row.event, row.metadata);
    if (!metadata.ok) return metadata;

    rows.push({
      event: row.event,
      clientId,
      clientEventId,
      appVersion: cleanString(row.appVersion),
      durationMs: cleanOptionalNumber(row.durationMs),
      success: cleanOptionalBoolean(row.success),
      errorCategory: cleanString(row.errorCategory),
      errorMessage: cleanString(row.errorMessage, MAX_ERROR_MESSAGE),
      metadata: metadata.metadata,
      timestamp: nowIso,
    });
  }

  return { ok: true, rows, clientId: batchClientId ?? "" };
}

export function filterAlreadyLoggedAnonymousEvents<T extends {
  clientId?: string;
  clientEventId?: string;
}>(
  events: readonly T[],
  existingReceiptIds: ReadonlySet<string>
): { fresh: T[]; skipped: number } {
  const fresh: T[] = [];
  let skipped = 0;
  for (const event of events) {
    if (
      typeof event.clientId === "string" &&
      typeof event.clientEventId === "string" &&
      existingReceiptIds.has(
        anonymousTelemetryReceiptDocId(event.clientId, event.clientEventId)
      )
    ) {
      skipped += 1;
      continue;
    }
    fresh.push(event);
  }
  return { fresh, skipped };
}
