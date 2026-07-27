import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

const intlMiddleware = createMiddleware(routing);

export function proxy(request: import("next/server").NextRequest) {
  const response = intlMiddleware(request);
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
