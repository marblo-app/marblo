import {
  isSearchLocale,
  localeHref,
  routing,
  searchLocales,
  xDefaultLocale,
} from "@/i18n/routing";

/** Canonical site origin used for all absolute SEO URLs. */
export const SITE_URL = "https://marblo.app";

/**
 * Absolute counterpart of {@link localeHref}: the canonical, apex-hosted URL of
 * `path` in `locale`.
 *
 *     localeUrl("ko", "/pricing")  →  "https://marblo.app/pricing"
 *     localeUrl("en", "/pricing")  →  "https://marblo.app/en/pricing"
 *     localeUrl("ko")              →  "https://marblo.app/"
 *
 * Use it for every absolute URL we publish — canonical, hreflang, sitemap,
 * JSON-LD, RSS. Hardcoding `${SITE_URL}/${locale}${path}` was correct under
 * always-prefix routing and is now wrong for the default locale: it would emit
 * https://marblo.app/ko/pricing, which 301s.
 */
export function localeUrl(locale: string, path: string = ""): string {
  const href = localeHref(locale, path);
  // The home page is `${SITE_URL}` with no trailing slash, not `${SITE_URL}/`.
  // Both are the same URL to a crawler, but Next normalizes the root canonical
  // it stamps into <head> to the bare origin, and app/sitemap.ts promises in
  // its invariant comment that the two agree character-for-character. Emitting
  // "https://marblo.app/" here would have made the sitemap and the canonical
  // disagree on the single most important URL on the site.
  return href === "/" ? SITE_URL : `${SITE_URL}${href}`;
}

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
 * hreflang `languages` for every SEARCH-VISIBLE locale and `x-default`.
 *
 * `path` is the route path WITHOUT the locale prefix (e.g. "/pricing" or ""
 * for the home page). This guarantees each page cross-references its OWN path
 * in every language instead of the locale root.
 *
 * The cluster is built from `searchLocales`, not `routing.locales`, so a locale
 * that is withheld from search (currently ja) stops being advertised. Its pages
 * keep their own self-referencing `canonical` and carry no `noindex`, so they
 * stay reachable and keep any index entry they already have — we simply stop
 * pointing crawlers at them. See i18n/routing.ts for how to restore one.
 */
export function buildAlternates(locale: string, path: string) {
  const clean = normalizePath(path);
  const languages: Record<string, string> = {};
  for (const l of searchLocales) {
    languages[l] = localeUrl(l, clean);
  }
  languages["x-default"] = localeUrl(xDefaultLocale, clean);

  return {
    canonical: localeUrl(locale, clean),
    languages,
  };
}

/**
 * Build Open Graph locale fields: the current `og:locale` and the
 * `og:locale:alternate` list for the remaining supported locales.
 *
 * Intentionally driven by `routing.locales`, NOT `searchLocales`: og:locale is
 * read by social/chat unfurlers to pick a translation, not by search crawlers
 * to build an hreflang cluster. Withholding ja from search is no reason to hide
 * the Japanese page from someone sharing the link in Japanese.
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
 * Build `alternates` for a blog post. Unlike {@link buildAlternates}, hreflang
 * `languages` are limited to `availableLocales` — the locales where the post
 * actually exists — so we never point search engines at a missing translation.
 * That set is then narrowed to `searchLocales`, so a withheld locale is not
 * advertised even for a post that has a translation in it.
 *
 * A post that exists ONLY in withheld locales ends up with an empty cluster; we
 * emit no `languages` at all rather than inventing an x-default that points at
 * a page we are not advertising. The self-referencing `canonical` still stands,
 * so the post remains indexable on its own.
 */
export function buildBlogAlternates(
  locale: string,
  slug: string,
  availableLocales: string[]
) {
  const post = `/blog/${slug}`;
  const canonical = localeUrl(locale, post);
  const langs = availableLocales.filter(isSearchLocale);
  if (langs.length === 0) return { canonical };

  const languages: Record<string, string> = {};
  for (const l of langs) {
    languages[l] = localeUrl(l, post);
  }
  const xDefault = langs.includes(xDefaultLocale) ? xDefaultLocale : langs[0];
  languages["x-default"] = localeUrl(xDefault, post);

  return { canonical, languages };
}

/**
 * Derive the locale-stripped page path from a full request pathname.
 * "/en/pricing" → "/pricing"; "/en" → ""; "/pricing" → "/pricing" (the default
 * locale carries no prefix under `as-needed`, so there is nothing to strip).
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
