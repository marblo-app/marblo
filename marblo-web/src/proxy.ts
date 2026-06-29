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

export const config = {
  matcher: ["/", "/(ko|en|ja)/:path*"],
};
