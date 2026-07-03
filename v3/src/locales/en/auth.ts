/**
 * English — `auth.*` namespace. Typed against the ko counterpart so key drift
 * is a compile-time error.
 */
import type { auth as koAuth } from "../ko/auth";

export const auth: Record<keyof typeof koAuth, string> = {
  "auth.error.google": "Google sign-in failed.",
  "auth.error.github": "GitHub sign-in failed.",
  "auth.error.email": "Email sign-in failed.",
  "auth.error.signup": "Sign-up failed.",
  "auth.error.logout": "Sign-out failed.",
  "auth.init.timeout.title": "Can't connect",
  "auth.init.timeout.message":
    "We couldn't reach the authentication service. Check your network connection. If this keeps happening the app may be misconfigured — try reinstalling or contact support.",
  "auth.init.timeout.retry": "Try again",
};
