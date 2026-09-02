import { localeHref } from "@/i18n/routing";

export type HeroCtaAuthState = "pending" | "anon" | "authed";

/**
 * Pure: given the resolved auth state, decide the CTA's destination, label,
 * and whether it's still waiting on Firebase. Kept in its own module (no
 * `firebase/auth` import anywhere in this file's dependency graph) so tests
 * can exercise the exact branching that caused the original bug — a
 * signed-in visitor landing on /auth/signup — without initializing Firebase.
 */
export function resolveHeroCta(
  state: HeroCtaAuthState,
  locale: string,
  labels: { signup: string; download: string }
): { href: string; label: string; pending: boolean } {
  if (state === "authed") {
    return {
      href: localeHref(locale, "/download"),
      label: labels.download,
      pending: false,
    };
  }
  if (state === "anon") {
    return {
      href: localeHref(locale, "/auth/signup"),
      label: labels.signup,
      pending: false,
    };
  }
  return {
    href: localeHref(locale, "/auth/signup"),
    label: labels.signup,
    pending: true,
  };
}
