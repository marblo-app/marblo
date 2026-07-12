/**
 * Sentry init wrapper (renderer side). Four principles:
 *
 *   1. **Opt-in.** Never initializes unless the user has consented via the
 *      onboarding modal / Settings. Consent state is read from
 *      privacyConsentStore and passed in as `consented`.
 *   2. **DSN-gated.** Even with consent, we never init without a configured
 *      DSN (`VITE_SENTRY_DSN`). No DSN → complete no-op. This is the
 *      regression guard: until the Sentry project/DSN exists, shipping this
 *      code changes nothing at runtime.
 *   3. **PII-scrubbed.** Every event passes through `sentryBeforeSend`
 *      (lib/telemetry/scrub.ts) before leaving the machine. Defense in
 *      depth — consent gates whether we send at all; scrubbing is always-on.
 *   4. **Desktop-standard SDK.** We use `@sentry/electron` (not `@sentry/react`):
 *      main + renderer + native crash capture. The renderer SDK is a thin
 *      client — DSN/release/environment live in the *main* process init
 *      (those options are deprecated on the renderer side and inherited over
 *      IPC), so we drive `window.electronAPI.sentry.initMain(...)` first, then
 *      init the renderer SDK. The renderer module is dynamically imported so
 *      it stays out of the main bundle until Sentry is actually turned on.
 *
 * Toggle behavior is one-shot per session: opt-in flips Sentry on; a
 * subsequent opt-out does NOT tear down the SDK in this session (Sentry
 * doesn't expose a clean close), but `enabled = false` short-circuits
 * `captureException` so no further events ship until the next launch.
 */
import { sentryBeforeSend } from "./scrub";

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;

// Release + environment for grouping crashes by app version. __APP_VERSION__
// is injected by vite.config.ts `define` (undefined outside a Vite build,
// e.g. in unit tests — guarded so we don't throw).
const RELEASE =
  typeof __APP_VERSION__ !== "undefined"
    ? `marblo@${__APP_VERSION__}`
    : undefined;
const ENVIRONMENT =
  (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined) ||
  (import.meta.env.PROD ? "production" : "development");

let initialized = false;
let enabled = false;

interface SentryRendererSdk {
  init: (opts: Record<string, unknown>) => void;
  captureException: (err: unknown) => void;
  captureMessage: (msg: string) => void;
}

let sdk: SentryRendererSdk | null = null;

async function loadSdk(): Promise<SentryRendererSdk | null> {
  if (sdk) return sdk;
  try {
    // Dynamic import → Vite code-splits @sentry/electron/renderer into its own
    // chunk that only loads once Sentry is turned on. Zero bundle cost (and
    // zero runtime cost) on the no-consent / no-DSN path.
    const mod = (await import("@sentry/electron/renderer")) as unknown as
      | Partial<SentryRendererSdk>
      | undefined;
    if (mod && typeof mod.init === "function") {
      sdk = mod as SentryRendererSdk;
      return sdk;
    }
  } catch (err) {
    console.warn("[Sentry] renderer SDK not available:", err);
  }
  return null;
}

/**
 * Initialize Sentry IFF the user has consented AND a DSN is configured.
 * Idempotent. Any other case is a complete no-op (no main init, no renderer
 * init, no network) — PIPA-compliant and regression-safe.
 */
export async function maybeInitSentry(consented: boolean): Promise<void> {
  if (initialized) {
    // Already live this session — just flip the per-call send gate.
    enabled = consented;
    return;
  }
  if (!consented) return;
  if (!DSN) {
    console.info("[Sentry] VITE_SENTRY_DSN not set — skipping init.");
    return;
  }

  // Bring up the main-process SDK first (native crashes + IPC transport that
  // renderer events forward through). DSN/release/environment live here — the
  // renderer inherits them over IPC. If the bridge is unavailable (older
  // main/preload), skip entirely: a renderer-only init has no transport.
  const initMain = window.electronAPI?.sentry?.initMain;
  if (!initMain) {
    console.warn("[Sentry] main-process bridge unavailable — skipping init.");
    return;
  }
  try {
    const res = await initMain({
      dsn: DSN,
      release: RELEASE,
      environment: ENVIRONMENT,
    });
    if (!res?.ok) {
      console.warn(
        "[Sentry] main init did not confirm — skipping renderer init.",
      );
      return;
    }
  } catch (err) {
    console.warn("[Sentry] main init failed:", err);
    return;
  }

  const s = await loadSdk();
  if (!s) return;
  s.init({
    // dsn/release/environment intentionally omitted — deprecated on the
    // renderer SDK; inherited from the main-process init over IPC.
    // Sample heavily during baseline; bump after launch when we have real
    // volume signals.
    tracesSampleRate: 0.1,
    // Every event must pass through the scrubber, even after consent.
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
