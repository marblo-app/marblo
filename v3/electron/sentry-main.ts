/**
 * Sentry init for the Electron **main** process (native crashes + release
 * stability + the IPC transport that renderer events forward through).
 *
 * Gating discipline mirrors the renderer wrapper (src/lib/telemetry/sentry.ts):
 *   - Consent-gated: init is driven lazily by the renderer over IPC
 *     (`sentry:init-main`) and only fires once the user has opted in. We never
 *     init at app boot, so native crash handlers are NOT installed until the
 *     user consents — no data before consent, PIPA-compliant.
 *   - DSN-gated: no DSN → complete no-op (regression guard).
 *   - PII-scrubbed: a `beforeSend` scrubber strips file paths / emails / API
 *     keys and drops identifying data (user, server_name) from every event.
 *
 * The `@sentry/electron/main` module is dynamically imported inside `init` so
 * requiring it (and installing crash handlers) is deferred until consent.
 *
 * NOTE ON DUPLICATION: the scrub regexes below intentionally mirror the
 * canonical scrubber in `src/lib/telemetry/scrub.ts`. `electron/` and `src/`
 * have separate tsconfig rootDirs and cannot cross-import, so the small pure
 * helpers are duplicated here. Keep them in sync.
 */

let initialized = false;

export interface SentryMainInitOptions {
  dsn?: string;
  release?: string;
  environment?: string;
}

// ── PII scrub (mirror of src/lib/telemetry/scrub.ts) ─────────────────────
const ANTHROPIC_KEY = /sk-ant-[A-Za-z0-9_-]{20,}/g;
const OPENAI_KEY = /sk-[A-Za-z0-9_-]{20,}/g;
const GOOGLE_KEY = /AIza[A-Za-z0-9_-]{20,}/g;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_KR = /\b01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}\b/g;
const PHONE_INTL = /\+\d{1,3}[-.\s]?\d{2,4}[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g;
const FILE_PATH =
  /(?:\/Users\/[^/\s"']+|\/home\/[^/\s"']+|C:\\Users\\[^\\\s"']+)/gi;

function scrubString(input: string): string {
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

const SECRET_KEY_NAME =
  /(_KEY|_TOKEN|_SECRET|^MARBLO_|^ANTHROPIC_|^OPENAI_|^GOOGLE_)/i;
const USER_INPUT_KEY =
  /^(prompt|initialPrompt|message|userInput|content|raw_input)$/i;
const MAX_DEPTH = 8;

function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "<TRUNCATED>";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return scrubString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if (USER_INPUT_KEY.test(key)) continue; // drop free-form prose entirely
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
 * `beforeSend` for main-process events. Scrubs message / exception values /
 * breadcrumb messages / extra / tags and strips identifying data. Typed
 * loosely (unknown) to avoid coupling to the SDK's Event type at compile time.
 */
function scrubMainEvent(event: unknown): unknown {
  if (!event || typeof event !== "object") return event;
  const e = event as Record<string, unknown>;

  if (typeof e.message === "string") e.message = scrubString(e.message);
  if (e.extra) e.extra = scrubValue(e.extra);
  if (e.tags) e.tags = scrubValue(e.tags);

  // Strip identifiers entirely — our policy is "no identifying data".
  if (e.user) e.user = undefined;
  if (e.server_name) e.server_name = undefined; // hostname often = username

  const exception = e.exception as { values?: unknown } | undefined;
  if (exception && Array.isArray(exception.values)) {
    exception.values = exception.values.map((v) => {
      if (v && typeof v === "object") {
        const val = v as Record<string, unknown>;
        if (typeof val.value === "string") val.value = scrubString(val.value);
      }
      return v;
    });
  }

  if (Array.isArray(e.breadcrumbs)) {
    e.breadcrumbs = e.breadcrumbs.map((b) => {
      if (b && typeof b === "object") {
        const bc = b as Record<string, unknown>;
        if (typeof bc.message === "string")
          bc.message = scrubString(bc.message);
        if (bc.data) bc.data = scrubValue(bc.data);
      }
      return b;
    });
  }

  return e;
}

/**
 * Initialize main-process Sentry. Idempotent; no-op without a DSN. Called from
 * the `sentry:init-main` IPC handler once the renderer confirms consent.
 * Returns true if the SDK is (now or already) initialized.
 */
export async function initMainSentry(
  opts: SentryMainInitOptions,
): Promise<boolean> {
  if (initialized) return true;
  if (!opts?.dsn) return false; // no DSN → complete no-op (regression guard)

  try {
    const Sentry = await import("@sentry/electron/main");
    Sentry.init({
      dsn: opts.dsn,
      release: opts.release,
      environment: opts.environment,
      // Baseline sampling; bump after launch when we have real volume.
      tracesSampleRate: 0.1,
      // Never attach automatic PII (IP, cookies, etc.).
      sendDefaultPii: false,
      beforeSend: (event) =>
        scrubMainEvent(event) as ReturnType<
          NonNullable<Parameters<typeof Sentry.init>[0]["beforeSend"]>
        >,
    });
    initialized = true;
    return true;
  } catch (err) {
    console.warn("[Sentry:main] init failed:", err);
    return false;
  }
}

/** Test/introspection helper. */
export function isMainSentryInitialized(): boolean {
  return initialized;
}
