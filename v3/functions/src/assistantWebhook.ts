import * as crypto from "crypto";
import { timingSafeEqualHex } from "./webhookVerify";
import type { RateRule } from "./rateLimitCore";

export const ASSISTANT_WEBHOOK_SECRET_BYTES = 32;
export const ASSISTANT_WEBHOOK_ID_BYTES = 16;
export const ASSISTANT_WEBHOOK_MAX_RAW_BODY_BYTES = 32 * 1024;
export const ASSISTANT_WEBHOOK_MAX_PAYLOAD_FIELDS = 20;
export const ASSISTANT_WEBHOOK_MAX_STRING_CHARS = 2_000;
export const ASSISTANT_WEBHOOK_MAX_TOTAL_TEXT_CHARS = 8_000;
export const ASSISTANT_WEBHOOK_EVENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const ASSISTANT_WEBHOOK_RATE_RULES_IP: RateRule[] = [
  { windowSeconds: 60, max: 30 },
  { windowSeconds: 600, max: 120 },
];

export const ASSISTANT_WEBHOOK_RATE_RULES_WEBHOOK: RateRule[] = [
  { windowSeconds: 60, max: 10 },
  { windowSeconds: 600, max: 60 },
];

export type AssistantWebhookRejectedReason =
  | "method_not_allowed"
  | "missing_webhook_id"
  | "payload_too_large"
  | "missing_signature"
  | "invalid_signature"
  | "invalid_json"
  | "invalid_payload"
  | "rate_limited";

export interface AssistantWebhookPayload {
  event: string;
  source?: string;
  payload: Record<string, string | number | boolean | null>;
}

export interface AssistantWebhookValidatedPayload
  extends AssistantWebhookPayload {
  rawBodyBytes: number;
}

export interface AssistantWebhookPayloadResult {
  ok: boolean;
  reason?: AssistantWebhookRejectedReason;
  value?: AssistantWebhookValidatedPayload;
}

export function generateAssistantWebhookId(): string {
  return `awh_${crypto
    .randomBytes(ASSISTANT_WEBHOOK_ID_BYTES)
    .toString("base64url")}`;
}

export function generateAssistantWebhookSecret(): string {
  return crypto
    .randomBytes(ASSISTANT_WEBHOOK_SECRET_BYTES)
    .toString("base64url");
}

export function maskAssistantWebhookSecret(secret: string): string {
  if (secret.length <= 8) return "****";
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}

export function assistantWebhookUrl(
  functionsBaseUrl: string,
  webhookId: string,
): string {
  const base = functionsBaseUrl.replace(/\/+$/, "");
  return `${base}/assistantWebhook?webhookId=${encodeURIComponent(webhookId)}`;
}

export function signAssistantWebhookBody(input: {
  rawBody: Buffer;
  secret: string;
  timestampSeconds: number;
}): string {
  const h1 = crypto
    .createHmac("sha256", input.secret)
    .update(`${input.timestampSeconds}:${input.rawBody.toString("utf8")}`)
    .digest("hex");
  return `ts=${input.timestampSeconds};h1=${h1}`;
}

export function verifyAssistantWebhookSignature(
  signatureHeader: string | undefined,
  rawBody: Buffer | undefined,
  secret: string,
): boolean {
  if (!secret || !signatureHeader || !rawBody) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(";").map((kv) => {
      const idx = kv.indexOf("=");
      if (idx < 0) return [kv.trim(), ""];
      return [kv.slice(0, idx).trim(), kv.slice(idx + 1).trim()];
    }),
  );
  const ts = parts["ts"];
  const h1 = parts["h1"];
  if (!ts || !h1) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${ts}:${rawBody.toString("utf8")}`)
    .digest("hex");
  return timingSafeEqualHex(h1, expected);
}

function isPlainPayloadValue(
  value: unknown,
): value is string | number | boolean | null {
  if (value === null) return true;
  if (typeof value === "string") {
    return value.length <= ASSISTANT_WEBHOOK_MAX_STRING_CHARS;
  }
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "boolean";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compactString(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function validateAssistantWebhookPayload(
  body: unknown,
  rawBodyBytes: number,
): AssistantWebhookPayloadResult {
  if (rawBodyBytes > ASSISTANT_WEBHOOK_MAX_RAW_BODY_BYTES) {
    return { ok: false, reason: "payload_too_large" };
  }
  if (!isRecord(body)) return { ok: false, reason: "invalid_payload" };

  const event = typeof body.event === "string" ? compactString(body.event) : "";
  if (!event || event.length > 120) {
    return { ok: false, reason: "invalid_payload" };
  }

  const source =
    typeof body.source === "string" && compactString(body.source)
      ? compactString(body.source).slice(0, 120)
      : undefined;

  const payload = isRecord(body.payload) ? body.payload : {};
  const entries = Object.entries(payload);
  if (entries.length > ASSISTANT_WEBHOOK_MAX_PAYLOAD_FIELDS) {
    return { ok: false, reason: "invalid_payload" };
  }

  let totalTextChars = event.length + (source?.length ?? 0);
  const sanitized: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of entries) {
    const cleanKey = compactString(key);
    if (!cleanKey || cleanKey.length > 80 || !isPlainPayloadValue(value)) {
      return { ok: false, reason: "invalid_payload" };
    }
    sanitized[cleanKey] =
      typeof value === "string" ? compactString(value) : value;
    if (typeof sanitized[cleanKey] === "string") {
      totalTextChars += sanitized[cleanKey].length;
    }
  }
  if (totalTextChars > ASSISTANT_WEBHOOK_MAX_TOTAL_TEXT_CHARS) {
    return { ok: false, reason: "payload_too_large" };
  }

  return {
    ok: true,
    value: {
      event,
      ...(source ? { source } : {}),
      payload: sanitized,
      rawBodyBytes,
    },
  };
}

export function shouldAcceptAssistantWebhookRateLimit(checks: Array<{
  allowed: boolean;
}>): boolean {
  return checks.every((check) => check.allowed);
}
