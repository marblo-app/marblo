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
};
