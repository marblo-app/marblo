import { routing } from "@/i18n/routing";

/** Canonical site origin used for all absolute SEO URLs. */
export const SITE_URL = "https://marblo.app";

/** next-intl locale → Open Graph locale (BCP-47-ish underscore form). */
const OG_LOCALE: Record<string, string> = {
  ko: "ko_KR",
  en: "en_US",
  ja: "ja_JP",
};

/**
 * Normalize a page path (the part after the `/[locale]` prefix) to either an
 * empty string (home) or a `/sub/path` with a single leading slash and no
 * trailing slash.
 */
function normalizePath(path: string): string {
  if (!path || path === "/") return "";
  let p = path.startsWith("/") ? path : `/${path}`;
  if (p.length > 1 && p.endsWith("/")) p = p.replace(/\/+$/, "");
  return p;
}

/**
 * Build per-page `alternates` metadata: a self-referencing canonical plus
 * hreflang `languages` for every supported locale and `x-default`.
 *
 * `path` is the route path WITHOUT the locale prefix (e.g. "/pricing" or ""
 * for the home page). This guarantees each page cross-references its OWN path
 * in every language instead of the locale root.
 */
export function buildAlternates(locale: string, path: string) {
  const clean = normalizePath(path);
  const languages: Record<string, string> = {};
  for (const l of routing.locales) {
    languages[l] = `${SITE_URL}/${l}${clean}`;
  }
  // x-default points at the default locale's version of this page (en).
  languages["x-default"] = `${SITE_URL}/${routing.defaultLocale}${clean}`;

  return {
    canonical: `${SITE_URL}/${locale}${clean}`,
    languages,
  };
}

/**
 * Build Open Graph locale fields: the current `og:locale` and the
 * `og:locale:alternate` list for the remaining supported locales.
 */
export function buildOpenGraphLocale(locale: string) {
  return {
    locale: OG_LOCALE[locale] ?? OG_LOCALE[routing.defaultLocale],
    alternateLocale: routing.locales
      .filter((l) => l !== locale)
      .map((l) => OG_LOCALE[l]),
  };
}

/**
 * Derive the locale-stripped page path from a full request pathname.
 * "/en/pricing" → "/pricing"; "/en" → "".
 */
export function pagePathFromPathname(pathname: string, locale: string): string {
  if (!pathname) return "";
  const prefix = `/${locale}`;
  if (pathname === prefix) return "";
  if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length);
  // Fallback: strip any known locale prefix.
  for (const l of routing.locales) {
    if (pathname === `/${l}`) return "";
    if (pathname.startsWith(`/${l}/`)) return pathname.slice(`/${l}`.length);
  }
  return normalizePath(pathname);
}
