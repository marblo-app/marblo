/**
 * Deciding when a locale redirect is PERMANENT.
 *
 * Under `localePrefix: "as-needed"` next-intl redirects `/ko/pricing` → `/pricing`
 * itself, but it uses 307 for every locale redirect it emits — correct for the
 * ones it makes, wrong for this one:
 *
 *  - `/pricing` → `/en/pricing` is negotiated from Accept-Language / the
 *    NEXT_LOCALE cookie. It varies per visitor and MUST stay 307, or a Korean
 *    visitor's browser caches "this URL is English" forever.
 *  - `/ko/pricing` → `/pricing` is not negotiated at all. The prefix is pinned
 *    by the path, so the destination is the same for every visitor and every
 *    crawler, forever. That is the definition of a 301 — and 301 is what moves
 *    an existing index entry to the new URL. A 307 tells Google the old URL is
 *    still the real one and to keep it indexed.
 *
 * `/ko/*` URLs are already indexed (`/ko`, `/ko/download`, `/ko/pricing`,
 * `/ko/lectures`), so getting this status code right is the entire reason the
 * migration is safe.
 *
 * Kept free of `next/server` and next-intl imports so it stays unit-testable.
 */

/**
 * The path a stale default-locale-prefixed URL collapses to, or null when
 * `pathname` does not carry that prefix.
 *
 *     stripDefaultLocalePrefix("/ko/pricing", "ko")  →  "/pricing"
 *     stripDefaultLocalePrefix("/ko", "ko")          →  "/"
 *     stripDefaultLocalePrefix("/en/pricing", "ko")  →  null
 *     stripDefaultLocalePrefix("/pricing", "ko")     →  null
 *
 * Trailing slashes are normalized away (`/ko/pricing/` → `/pricing`) to match
 * next-intl's own normalization, so the comparison in
 * {@link isPermanentLocaleRedirect} does not miss because of one.
 */
export function stripDefaultLocalePrefix(
  pathname: string,
  defaultLocale: string
): string | null {
  const prefix = `/${defaultLocale}`;
  let rest: string;
  if (pathname === prefix) rest = "/";
  else if (pathname.startsWith(`${prefix}/`))
    rest = pathname.slice(prefix.length);
  else return null;
  if (rest.length > 1 && rest.endsWith("/")) rest = rest.replace(/\/+$/, "");
  return rest;
}

/**
 * True when the redirect next-intl just produced is the default-locale prefix
 * strip, and therefore permanent.
 *
 * Deliberately verifies the destination rather than trusting the request path
 * alone: if next-intl ever redirects a `/ko/…` URL somewhere else (a locale
 * that is no longer the default, a `pathnames` rewrite), the destination will
 * not match the stripped path and we fall back to next-intl's 307. Guessing
 * "permanent" wrong is the one mistake here that cannot be walked back — a 301
 * lives in browser caches indefinitely.
 *
 * @param pathname  the incoming request pathname
 * @param location  the `Location` header next-intl produced, or null
 * @param requestUrl the absolute request URL, used to resolve `location`
 * @param defaultLocale the locale that carries no prefix
 */
export function isPermanentLocaleRedirect(
  pathname: string,
  location: string | null | undefined,
  requestUrl: string,
  defaultLocale: string
): boolean {
  if (!location) return false;
  const stripped = stripDefaultLocalePrefix(pathname, defaultLocale);
  if (stripped === null) return false;
  try {
    return new URL(location, requestUrl).pathname === stripped;
  } catch {
    return false;
  }
}
