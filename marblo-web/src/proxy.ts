import createMiddleware from "next-intl/middleware";
import { NextResponse } from "next/server";
import { routing } from "./i18n/routing";
import { canonicalTarget, isWwwHost } from "./lib/canonicalHost";

const intlMiddleware = createMiddleware(routing);

export function proxy(request: import("next/server").NextRequest) {
  const response = intlMiddleware(request);

  // www → apex in ONE hop. next-intl has already decided this request's final
  // path (a locale redirect, or nothing when the path is already prefixed), so
  // we fold the hostname swap into that decision instead of chaining after it.
  // See src/lib/canonicalHost.ts for why, and for the 301/307 split.
  //
  // Only paths this matcher covers reach here; the routes it excludes (/api,
  // Next internals, anything with a file extension such as /sitemap.xml and
  // /robots.txt) are canonicalized by the redirects in next.config.ts, which
  // run ahead of the proxy.
  if (isWwwHost(request.headers.get("host"))) {
    const { url, status } = canonicalTarget(
      request.url,
      response.headers.get("location")
    );
    return NextResponse.redirect(url, status);
  }

  // Expose the current pathname so Server Components (the [locale] layout's
  // generateMetadata) can build per-page canonical/hreflang URLs.
  response.headers.set("x-pathname", request.nextUrl.pathname);
  return response;
}

// Match every request except Next internals, API routes, and anything with a
// file extension. That last exclusion is what keeps the metadata routes
// (/sitemap.xml, /robots.txt, /favicon.ico) and /public assets out of the
// locale-negotiation path — they must keep serving their own bytes.
//
// The previous matcher only covered "/" and already-prefixed "/(ko|en|ja)/…",
// so a locale-less URL such as /pricing fell through to a hard 404. Any
// external or legacy link to an unprefixed path (and every path that predates
// the always-prefix migration) therefore reported as "Not found (404)" in
// Search Console. With this matcher next-intl negotiates the locale and issues
// a redirect to /en/pricing instead.
export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
