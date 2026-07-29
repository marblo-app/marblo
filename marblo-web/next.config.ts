import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // Domain canonicalization: www → apex. www.marblo.app is an alias domain
      // that Vercel was serving directly (200), so every page existed at two
      // hostnames. The self-referencing canonical in lib/seo.ts always points at
      // the apex, which is why this never became a duplicate-content problem —
      // but canonical is a hint, not a directive, and it still splits crawl
      // budget and any link equity pointed at the www form.
      //
      // This must stay ONE-directional (www → apex only). The apex is the
      // established canonical everywhere else: lib/seo.ts SITE_URL, sitemap.ts
      // baseUrl, robots.ts `host` + `sitemap`, and layout.tsx `metadataBase`.
      // Adding the mirror rule would produce an infinite redirect loop.
      //
      // 301 rather than the `permanent: true` (308) used by the path redirects
      // below: this site is verified with Naver Search Advisor and Korean is a
      // primary market, and Yeti's handling of 308 is not documented the way
      // 301 is. Google and Bing treat the two identically for canonicalization,
      // so 301 costs nothing and is the safer choice for the domain-level rule.
      //
      // Runs before src/proxy.ts locale negotiation (next.config redirects are
      // evaluated ahead of middleware), so www/guide canonicalizes to the apex
      // first and only then negotiates to /en/guide.
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.marblo.app" }],
        destination: "https://marblo.app/:path*",
        statusCode: 301,
      },
      // Public route renamed /foundation50 → /founders. Keep old links alive
      // with a permanent (308) redirect. The [locale] segment is part of the
      // actual URL path (next-intl always-prefix), so we capture it explicitly.
      {
        source: "/:locale/foundation50",
        destination: "/:locale/founders",
        permanent: true,
      },
      {
        source: "/:locale/foundation50/:path*",
        destination: "/:locale/founders/:path*",
        permanent: true,
      },
      // The founder survey moved to /beta-survey. The old /founders/feedback
      // route was a client-side JS redirect, which search engines crawl as a
      // thin 200 page (soft-404 / "page with redirect" noise). Serve a real
      // 308 at the routing layer instead so no crawlable page is emitted.
      {
        source: "/:locale/founders/feedback",
        destination: "/:locale/beta-survey",
        permanent: true,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
