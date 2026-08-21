/**
 * www.marblo.app → marblo.app canonicalization, in a SINGLE hop.
 *
 * The apex is the canonical origin everywhere else in the app: lib/seo.ts
 * `SITE_URL`, app/sitemap.ts `baseUrl`, app/robots.ts `host` + `sitemap`, and
 * app/layout.tsx `metadataBase`. Every www request therefore has to leave www.
 *
 * This used to be a catch-all `next.config.ts` redirect. next.config redirects
 * run BEFORE the proxy, so a locale-less www URL paid for the hostname swap and
 * the locale negotiation as two separate hops:
 *
 *     https://www.marblo.app/  →301→  https://marblo.app/  →307→  /en
 *
 * Running it inside src/proxy.ts instead lets us read next-intl's negotiated
 * destination and emit one redirect straight to the final apex URL. Redirect
 * chains dilute link equity and waste crawl budget, and Search Console reports
 * every hop of them under "Page with redirect".
 *
 * Kept deliberately free of `next/server` imports so it stays unit-testable.
 */

/** Canonical (apex) hostname. Never a redirect source — only ever a target. */
export const CANONICAL_HOST = "marblo.app";

/** The alias hostname that must always redirect to {@link CANONICAL_HOST}. */
export const WWW_HOST = "www.marblo.app";

/**
 * True only for the production www alias. Preview deployments
 * (`*.vercel.app`), localhost and the apex itself all return false, so the
 * redirect can never fire on a host that is not `www.marblo.app` — which is
 * what makes an infinite loop structurally impossible.
 */
export function isWwwHost(host: string | null | undefined): boolean {
  if (!host) return false;
  return host.split(":")[0].toLowerCase() === WWW_HOST;
}

export type CanonicalRedirect = { url: string; status: 301 | 307 };

/**
 * Build the one-hop apex target for a www request.
 *
 * `intlLocation` is the `Location` header next-intl's middleware produced for
 * this request, or null when it did not redirect (the path already carries a
 * locale prefix). Passing it in is the whole point: it folds next-intl's hop
 * into ours instead of chaining after it.
 *
 * Status code:
 *  - 301 when next-intl did not redirect. The destination is a pure hostname
 *    swap, identical for every visitor, so it is safe to cache permanently —
 *    and it is the same 301 this rule has always served.
 *  - 307 when next-intl DID redirect, because that destination was negotiated
 *    from Accept-Language / the NEXT_LOCALE cookie and therefore varies per
 *    visitor. A permanent redirect to `/en` would be cached by a Korean
 *    visitor's browser and pin them to English forever. Nothing is lost here:
 *    the chain this replaces already ended in next-intl's own 307, so search
 *    engines never saw an end-to-end permanent chain to begin with.
 *  - 301 again when `permanent` is set, which the proxy passes for the one
 *    locale redirect that is NOT negotiated: the `/ko/x` → `/x` default-prefix
 *    strip. Both halves of that hop (hostname and prefix) are structural, so
 *    www.marblo.app/ko/pricing reaches https://marblo.app/pricing in a single
 *    permanent redirect. See src/lib/localeRedirect.ts.
 */
export function canonicalTarget(
  requestUrl: string,
  intlLocation: string | null | undefined,
  permanent: boolean = false
): CanonicalRedirect {
  const request = new URL(requestUrl);
  const target = new URL(
    intlLocation || `${request.pathname}${request.search}`,
    request
  );

  // `hostname` + explicit `port` reset, never the `host` setter: per the URL
  // spec `host = "marblo.app"` leaves an existing port in place, so a request
  // to www on a non-default port would emit https://marblo.app:PORT/….
  target.protocol = "https:";
  target.hostname = CANONICAL_HOST;
  target.port = "";

  // next-intl preserves the query string, but a hand-written Location might
  // not — never drop the visitor's params (utm_*, ?redirect=, …).
  if (!target.search && request.search) target.search = request.search;

  return {
    url: target.toString(),
    status: intlLocation && !permanent ? 307 : 301,
  };
}
