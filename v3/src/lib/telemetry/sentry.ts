/**
 * Sentry init wrapper. Three principles:
 *
 *   1. **Opt-in.** Never initializes unless the user has consented via the
 *      onboarding modal. Consent state is read from privacyConsentStore.
 *   2. **PII-scrubbed.** Even when initialized, every event passes through
 *      `sentryBeforeSend` (lib/telemetry/scrub.ts) before leaving the
 *      machine. Defense in depth — consent is necessary, scrubbing is
 *      always-on.
 *   3. **Optional dep.** `@sentry/react` may not be installed in every
 *      build (e.g. dev). We dynamic-import; if the package is missing we
 *      no-op so the app still runs. Production builds will install the
 *      SDK at npm time.
 *
 * Toggle behavior is one-shot per session: opt-in flips Sentry on; a
 * subsequent opt-out does NOT tear down the SDK in this session (Sentry
 * doesn't expose a clean close), but `enabled = false` short-circuits
 * `captureException` so no further events ship until the next launch.
 */
import { sentryBeforeSend } from "./scrub";

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;

let initialized = false;
let enabled = false;

interface SentryLike {
  init: (opts: Record<string, unknown>) => void;
  captureException: (err: unknown) => void;
  captureMessage: (msg: string) => void;
}

let sdk: SentryLike | null = null;

async function loadSdk(): Promise<SentryLike | null> {
  if (sdk) return sdk;
  try {
    // Dynamic import keeps Sentry out of the bundle when not in use and
    // makes the dependency truly optional. The string is intentionally
    // not statically analyzable so Vite doesn't try to pre-resolve it
    // when the package isn't installed.
    // Compute the spec at runtime so TS doesn't try to resolve the module
    // statically (the package is an optional peer dep — may not be
    // installed). The @vite-ignore tells the bundler to leave it alone.
    const spec = ["@sentry", "react"].join("/");
    const mod: Record<string, unknown> = await import(
      /* @vite-ignore */ spec
    ).catch(() => ({}) as Record<string, unknown>);
    if (typeof (mod as { init?: unknown }).init === "function") {
      sdk = mod as unknown as SentryLike;
      return sdk;
    }
  } catch (err) {
    console.warn("[Sentry] SDK not available:", err);
  }
  return null;
}

/** Initialize Sentry IF user has consented AND DSN is configured. Idempotent. */
export async function maybeInitSentry(consented: boolean): Promise<void> {
  if (initialized) {
    enabled = consented;
    return;
  }
  if (!consented) return;
  if (!DSN) {
    console.info("[Sentry] VITE_SENTRY_DSN not set — skipping init.");
    return;
  }
  const s = await loadSdk();
  if (!s) return;
  s.init({
    dsn: DSN,
    // Sample heavily during baseline; bump after launch when we have
    // real volume signals.
    tracesSampleRate: 0.1,
    // Every event must go through the scrubber, even after consent.
    beforeSend: sentryBeforeSend,
  });
  initialized = true;
  enabled = true;
}

/** Push a runtime error. No-ops if SDK absent or user opted out. */
export function captureException(err: unknown): void {
  if (!enabled || !sdk) return;
  try {
    sdk.captureException(err);
  } catch {
    // Sentry SDK errors should never break the host app.
  }
}

/** Push a message. Same gating as captureException. */
export function captureMessage(msg: string): void {
  if (!enabled || !sdk) return;
  try {
    sdk.captureMessage(msg);
  } catch {
    // ignore
  }
}
