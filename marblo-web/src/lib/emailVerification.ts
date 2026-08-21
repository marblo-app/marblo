/**
 * Email-verification helpers for Firebase Auth.
 *
 * Why this exists: `submitFounderFeedback` (v3/functions) rejects any caller
 * whose ID token has `email_verified !== true`. Google sign-in mints that claim
 * for free, but email/password accounts never did — the product had no code
 * path that called `sendEmailVerification`, so those founders could never
 * submit the survey that grants free Pro. The gate stays (it is what stops
 * someone from claiming Pro on an address they do not own); this module adds
 * the missing way *through* it.
 *
 * Split on purpose: the URL/cooldown/error-mapping logic below is pure and
 * unit-tested (`emailVerification.test.ts`); the Firebase calls are thin
 * wrappers at the bottom.
 */

import { sendEmailVerification, type User } from "firebase/auth";
import { sanitizeRedirect } from "./sanitizeRedirect";
import { localeHref } from "@/i18n/routing";

/** Fallback origin when `window` is unavailable (SSR) or the origin looks bogus. */
const FALLBACK_ORIGIN = "https://marblo.app";

/** Client-side resend guard. Firebase enforces the real limit server-side. */
export const RESEND_COOLDOWN_MS = 60_000;

const STORAGE_PREFIX = "marblo.emailVerifySentAt.";

/** Route that Firebase's verification link returns the user to. */
export function verifyPath(locale: string): string {
  return localeHref(locale, "/auth/verify");
}

/**
 * Builds the `continueUrl` handed to Firebase, i.e. where the user lands after
 * clicking the link in the email.
 *
 * The domain must be registered in Firebase Console → Authentication →
 * Settings → Authorized domains, otherwise Firebase rejects the send with
 * `auth/unauthorized-continue-uri`. We derive it from the live page origin
 * rather than hard-coding it so localhost dev and preview deploys work; a
 * non-http(s) or unparseable origin falls back to production.
 *
 * `redirect` is passed through `sanitizeRedirect` — it ends up in a URL the
 * user clicks from their inbox, so an unvalidated value would turn the
 * verification mail into an open-redirect phishing hop.
 */
export function buildVerifyContinueUrl(params: {
  origin: string | null | undefined;
  locale: string;
  redirect?: string | null;
}): string {
  const { origin, locale, redirect } = params;
  const base = normalizeOrigin(origin);
  const path = verifyPath(locale);
  const safeRedirect = sanitizeRedirect(redirect, "");
  // Self-referential redirects would bounce the user back to this same page
  // with no forward destination — drop them.
  if (!safeRedirect || safeRedirect === path) return `${base}${path}`;
  return `${base}${path}?redirect=${encodeURIComponent(safeRedirect)}`;
}

function normalizeOrigin(origin: string | null | undefined): string {
  if (!origin) return FALLBACK_ORIGIN;
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return FALLBACK_ORIGIN;
    }
    return url.origin;
  } catch {
    return FALLBACK_ORIGIN;
  }
}

/**
 * Milliseconds left on the resend cooldown, or 0 if a resend is allowed.
 *
 * Corrupt or future-dated timestamps (cleared storage, clock skew) resolve to
 * 0 rather than locking the user out: this guard exists to stop double-clicks
 * and impatient re-sends, not to enforce security. Abuse is bounded by
 * Firebase's own `auth/too-many-requests`, which no client state can bypass.
 */
export function resendCooldownRemainingMs(
  lastSentAt: number | null | undefined,
  now: number,
  cooldownMs: number = RESEND_COOLDOWN_MS
): number {
  if (typeof lastSentAt !== "number" || !Number.isFinite(lastSentAt)) return 0;
  const elapsed = now - lastSentAt;
  if (elapsed < 0) return 0;
  if (elapsed >= cooldownMs) return 0;
  return cooldownMs - elapsed;
}

/** Cooldown remaining rounded up to whole seconds, for display. */
export function cooldownSeconds(remainingMs: number): number {
  return Math.max(0, Math.ceil(remainingMs / 1000));
}

/** Maps a Firebase Auth error code to a key in the `emailVerify` namespace. */
export function verificationErrorKey(code: string | null | undefined): string {
  switch (code) {
    case "auth/too-many-requests":
      return "error_too_many";
    case "auth/network-request-failed":
      return "error_network";
    case "auth/user-token-expired":
    case "auth/user-disabled":
    case "auth/requires-recent-login":
    case "auth/invalid-user-token":
      return "error_session";
    default:
      return "error_generic";
  }
}

/** Continue-URL rejections we recover from by resending without one. */
export function isContinueUrlError(code: string | null | undefined): boolean {
  return (
    code === "auth/unauthorized-continue-uri" ||
    code === "auth/invalid-continue-uri" ||
    code === "auth/missing-continue-uri"
  );
}

function errorCodeOf(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

// ---------------------------------------------------------------------------
// Browser storage (per-uid, best effort)
// ---------------------------------------------------------------------------

/** Last send timestamp for `uid`, or null when unknown/unavailable. */
export function readLastSentAt(uid: string): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + uid);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    // Private mode / storage disabled — degrade to "no cooldown known".
    return null;
  }
}

/** Records a send so the cooldown survives a page navigation. */
export function recordSentAt(uid: string, at: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + uid, String(at));
  } catch {
    // Non-fatal: the cooldown just won't persist across reloads.
  }
}

// ---------------------------------------------------------------------------
// Firebase wrappers
// ---------------------------------------------------------------------------

/**
 * Sends the verification email and records the send for cooldown purposes.
 *
 * If Firebase rejects our `continueUrl` (domain not yet on the authorized list)
 * we retry without one: the user still lands on Firebase's own confirmation
 * page and still gets verified, they just don't get bounced back into the app.
 * Losing the return hop is much better than losing verification entirely.
 */
export async function sendVerification(
  user: User,
  options: { locale: string; redirect?: string | null; origin?: string | null }
): Promise<void> {
  const origin =
    options.origin ??
    (typeof window !== "undefined" ? window.location.origin : null);
  const url = buildVerifyContinueUrl({
    origin,
    locale: options.locale,
    redirect: options.redirect,
  });

  try {
    await sendEmailVerification(user, { url, handleCodeInApp: false });
  } catch (err) {
    if (!isContinueUrlError(errorCodeOf(err))) throw err;
    await sendEmailVerification(user);
  }
  recordSentAt(user.uid, Date.now());
}

/**
 * Re-reads verification state from the server and, once verified, force-mints a
 * fresh ID token.
 *
 * The token refresh is the load-bearing half: `submitFounderFeedback` reads
 * `email_verified` off the *token*, and a cached token keeps that claim false
 * for up to an hour after the user clicks the link. Without `getIdToken(true)`
 * the user verifies and the gate still rejects them.
 */
export async function refreshEmailVerified(user: User): Promise<boolean> {
  await user.reload();
  if (!user.emailVerified) return false;
  await user.getIdToken(true);
  return true;
}
