import { defineRouting } from "next-intl/routing";

/**
 * How locale prefixes appear in URLs. THE single source of truth — nothing in
 * this repo may hardcode a `/ko` prefix or the absence of one; derive it from
 * {@link localeHref} (relative) or `lib/seo.ts`'s `localeUrl` (absolute).
 *
 * `as-needed` means the DEFAULT locale drops its prefix and every other locale
 * keeps it:
 *
 *     ko (default)  →  /            /pricing        /blog/what-is-marblo
 *     en            →  /en          /en/pricing     /en/blog/what-is-marblo
 *     ja            →  /ja          /ja/pricing     /ja/blog/what-is-marblo
 *
 * Why: the site root has to be a real 200 page, and it has to be the language
 * that carries revenue. Under the previous `always` mode `marblo.app/` was a
 * 307 to a negotiated locale — a redirect, so it could not be listed in the
 * sitemap, could not accumulate link equity, and was the URL every backlink and
 * every share would ever point at.
 *
 * ⚠️ This DOES move URLs — /ko/pricing becomes /pricing. See
 * docs/SEO-LOCALE-AS-NEEDED-2026-08-21.md for the measured before/after and for
 * why the 301s in src/proxy.ts are what makes the move safe.
 */
export const LOCALE_PREFIX = "as-needed" as const;

export const routing = defineRouting({
  locales: ["ko", "en", "ja"],
  // Korean is the site default. Revenue is Korean (Toss payments, Korean
  // lectures, Korean legal pages), so the locale we fall back to when we know
  // nothing about the visitor should be Korean too — and under `as-needed`
  // above, "the default locale" is also "the locale that owns the site root".
  //
  // Googlebot normally sends no Accept-Language at all, so this fallback IS
  // Googlebot's path: it lands on `/` and gets a Korean 200.
  //
  // Runtime language detection is untouched: next-intl matches Accept-Language
  // (and the NEXT_LOCALE cookie) first, so en-* visitors still land on /en and
  // ja-* on /ja. Only the *unmatched* case (de, fr, no header at all) resolves
  // to Korean.
  defaultLocale: "ko",
  localePrefix: LOCALE_PREFIX,
  // SEO hreflang is emitted by Next metadata + app/sitemap.ts. next-intl's
  // response Link header derives x-default from the locale-less request path
  // (`/pricing`) while the canonical site default is `/pricing` served as
  // Korean, producing a conflicting hreflang cluster for crawlers that read
  // HTTP headers.
  alternateLinks: false,
});

/** A locale this app actually serves. */
export type Locale = (typeof routing.locales)[number];

/** next-intl's default locale cookie name. Keep the toggle in sync with proxy negotiation. */
export const LOCALE_COOKIE_NAME = "NEXT_LOCALE";

/**
 * The locales advertised to search engines — sitemap entries and hreflang
 * `alternates`. Deliberately a SUBSET of `routing.locales`.
 *
 * Japanese is currently withheld. Search Console listed every /ja/* URL as
 * "Discovered - currently not indexed" with last-crawl "N/A" — Google had
 * never read a single one — while pushing a third locale diluted the crawl
 * budget of the two that carry revenue.
 *
 * ⚠️ WITHHELD, NOT REMOVED. /ja/* pages still build, still route, still render,
 * and are still reachable from the language toggle; a Japanese browser hitting
 * /ja gets a working Japanese site. There is deliberately NO `noindex` on them
 * either — that would drop any /ja URL Google has already indexed, and this is
 * meant to be temporary.
 *
 * ★ TO RESTORE JAPANESE SEO: put "ja" back in this array. That is the entire
 *   revert — app/sitemap.ts and lib/seo.ts both derive from it, and nothing
 *   else needs to change.
 */
export const searchLocales = ["ko", "en"] as const satisfies readonly Locale[];

/** A locale we advertise to search engines. */
export type SearchLocale = (typeof searchLocales)[number];

/** True when `locale` is advertised to search engines. */
export function isSearchLocale(locale: string): locale is SearchLocale {
  return (searchLocales as readonly string[]).includes(locale);
}

/**
 * The locale `x-default` points at: the site default, clamped to the locales we
 * actually advertise. Deriving it (rather than hardcoding a second string) is
 * what keeps sitemap.xml and the per-page <link rel="alternate"> tags from
 * declaring two different x-defaults if either setting above is edited.
 */
export const xDefaultLocale: SearchLocale = isSearchLocale(routing.defaultLocale)
  ? routing.defaultLocale
  : searchLocales[0];

/**
 * True when `locale` carries a prefix in URLs. False only for the default
 * locale under `as-needed` — which is exactly the locale that owns `/`.
 */
export function localeHasPrefix(locale: string): boolean {
  if (LOCALE_PREFIX !== "as-needed") return true;
  return locale !== routing.defaultLocale;
}

/**
 * Build an internal href for `path` in `locale`.
 *
 * `path` is the route path WITHOUT any locale prefix — "/pricing", "" or "/"
 * for the home page, and it may carry a query string or hash ("/checkout?plan=
 * pro", "/#features"). Never pass a path that already starts with a locale.
 *
 *     localeHref("ko", "/pricing")  →  "/pricing"
 *     localeHref("en", "/pricing")  →  "/en/pricing"
 *     localeHref("ko")              →  "/"
 *     localeHref("ja")              →  "/ja"
 *
 * ★ Every internal link, router.push, redirect target and absolute SEO URL must
 * go through this (or `localeUrl` in lib/seo.ts). A hand-written `/${locale}
 * /pricing` still "works" — it 301s — but a link that redirects is a page
 * Search Console files under "Page with redirect", and it is link equity spent
 * on a hop. The whole point of this migration is to have zero of them.
 */
export function localeHref(locale: string, path: string = ""): string {
  const suffix = path === "/" ? "" : path;
  const prefix = localeHasPrefix(locale) ? `/${locale}` : "";
  return `${prefix}${suffix}` || "/";
}

/**
 * Cookie write used by the language toggle before navigating to an `as-needed`
 * default-locale URL. This mirrors next-intl's default cookie settings for this
 * app: session cookie, path=/, SameSite=Lax.
 */
export function localeCookieAssignment(locale: Locale): string {
  return `${LOCALE_COOKIE_NAME}=${encodeURIComponent(locale)}; path=/; SameSite=Lax`;
}
