/**
 * PII scrubber — sanitizes telemetry payloads BEFORE they leave the
 * machine. Implements the regex set documented in
 * docs/v3.1_런칭_마스터플랜.md §15.6 PII Scrubbing (P0-9 의무 — 동의와 별개).
 *
 * Even when a user has explicitly consented to telemetry, the following
 * patterns are still masked or blocked entirely. Consent is about whether
 * we send data at all; this layer is about what we send when we do.
 *
 * Pure function — no side effects, no I/O. Designed to be unit-tested
 * exhaustively (see tests/telemetry/scrub.test.mjs).
 */

const FILE_PATH =
  /(?:\/Users\/[^/\s"']+|\/home\/[^/\s"']+|C:\\Users\\[^\\\\\s"']+)/gi;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_KR = /\b01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}\b/g;
const PHONE_INTL = /\+\d{1,3}[-.\s]?\d{2,4}[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g;
// BYOK API keys. Order matters: sk-ant- before sk- so "sk-ant-..." doesn't
// get partially redacted as "<API_KEY>nt-...".
const ANTHROPIC_KEY = /sk-ant-[A-Za-z0-9_-]{20,}/g;
const OPENAI_KEY = /sk-[A-Za-z0-9_-]{20,}/g;
const GOOGLE_KEY = /AIza[A-Za-z0-9_-]{20,}/g;

// Env var keys we always want to redact when they appear in object payloads.
// Match by name (string includes / regex on key). Values are replaced with
// `<REDACTED>` regardless of content. Reasoning: env vars often hold
// secrets even when the value doesn't trip the BYOK/email patterns.
const SECRET_KEY_NAME =
  /(_KEY|_TOKEN|_SECRET|^MARBLO_|^ANTHROPIC_|^OPENAI_|^GOOGLE_)/i;

// Keys whose values are user-typed prose (orchestrator prompts, raw chat
// messages, free-form notes). Per spec these are blocked entirely — we
// drop the field rather than ship a redacted version, because partial
// scrubs of natural-language input are unreliable.
const USER_INPUT_KEY =
  /^(prompt|initialPrompt|message|userInput|content|raw_input)$/i;

const MAX_DEPTH = 8;

/** Scrub a string against every pattern, in order. */
export function scrubString(input: string): string {
  if (!input) return input;
  return input
    .replace(ANTHROPIC_KEY, "<API_KEY>")
    .replace(GOOGLE_KEY, "<API_KEY>")
    .replace(OPENAI_KEY, "<API_KEY>")
    .replace(EMAIL, "<EMAIL>")
    .replace(PHONE_KR, "<PHONE>")
    .replace(PHONE_INTL, "<PHONE>")
    .replace(FILE_PATH, "<USER_HOME>");
}

/**
 * Recursively scrub any value. Object keys are inspected:
 *   - SECRET_KEY_NAME match → value → `<REDACTED>`
 *   - USER_INPUT_KEY match → drop the field entirely
 *   - otherwise recurse
 *
 * Arrays / strings / numbers / booleans / null are passed through after
 * string scrubbing where applicable. Cycles guarded by depth cap, not a
 * Set — at MAX_DEPTH we stop and return a sentinel.
 */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "<TRUNCATED>";
  if (value === null || value === undefined) return value;

  if (typeof value === "string") return scrubString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    return value.map((v) => scrubValue(v, depth + 1));
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if (USER_INPUT_KEY.test(key)) {
        // Drop entirely — partial scrubs of free-form prose leak.
        continue;
      }
      if (SECRET_KEY_NAME.test(key)) {
        out[key] = "<REDACTED>";
        continue;
      }
      out[key] = scrubValue(v, depth + 1);
    }
    return out;
  }

  return value;
}

/**
 * Sentry `beforeSend` hook. Returns the scrubbed event or `null` to drop.
 * Drops the event entirely if its message matches the user-input fence
 * (prevents accidental prompt-text uploads).
 */
export function sentryBeforeSend<
  T extends {
    message?: string;
    extra?: unknown;
    tags?: unknown;
    user?: unknown;
  }
>(event: T): T {
  const scrubbed = { ...event };
  if (scrubbed.message) scrubbed.message = scrubString(scrubbed.message);
  if (scrubbed.extra) scrubbed.extra = scrubValue(scrubbed.extra) as T["extra"];
  if (scrubbed.tags) scrubbed.tags = scrubValue(scrubbed.tags) as T["tags"];
  // Strip user identifiers entirely — Sentry's user object is the wrong
  // place for PII when our policy is "no identifying data."
  if (scrubbed.user) scrubbed.user = undefined;
  return scrubbed;
}
