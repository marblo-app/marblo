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
      // These two rules cover ONLY what src/proxy.ts cannot see: /api/*, Next
      // internals, and any path carrying a file extension (/sitemap.xml,
      // /robots.txt, /favicon.ico, /public assets). Everything else — every
      // HTML route — is canonicalized inside the proxy.
      //
      // That split is the fix for the redirect chain. next.config redirects run
      // BEFORE the proxy, so while this rule was a catch-all it fired first and
      // a locale-less www URL paid two hops:
      //
      //     https://www.marblo.app/  →301→  https://marblo.app/  →307→  /en
      //
      // The proxy can read next-intl's negotiated destination and emit a single
      // redirect straight to https://marblo.app/en. See src/lib/canonicalHost.ts.
      //
      // Both rules stay ONE-directional (www → apex only). The apex is the
      // established canonical everywhere else: lib/seo.ts SITE_URL, sitemap.ts
      // baseUrl, robots.ts `host` + `sitemap`, and layout.tsx `metadataBase`.
      // Adding the mirror rule would produce an infinite redirect loop.
      //
      // 301 rather than the `permanent: true` (308) used by the path redirects
      // below: this site is verified with Naver Search Advisor and Korean is a
      // primary market, and Yeti's handling of 308 is not documented the way
      // 301 is. Google and Bing treat the two identically for canonicalization,
      // so 301 costs nothing and is the safer choice for the domain-level rule.
      {
        source: "/api/:path*",
        has: [{ type: "host", value: "www.marblo.app" }],
        destination: "https://marblo.app/api/:path*",
        statusCode: 301,
      },
      {
        // Any path containing a dot — exactly the `.*\\..*` arm of the proxy
        // matcher's exclusion list. A single greedy param rather than
        // `/:path*.:ext` so it also spans nested asset paths (/img/a/b.png).
        source: "/:file(.*\\..*)",
        has: [{ type: "host", value: "www.marblo.app" }],
        destination: "https://marblo.app/:file",
        statusCode: 301,
      },
      // ── Renamed public routes ────────────────────────────────────────────
      // /foundation50 → /founders, and /founders/feedback → /beta-survey (the
      // old feedback route was a client-side JS redirect, which search engines
      // crawl as a thin 200 page — soft-404 / "page with redirect" noise).
      //
      // ★ Each rename needs THREE forms because `localePrefix: "as-needed"`
      // gives Korean no prefix (see src/i18n/routing.ts):
      //
      //   1. unprefixed  — the live Korean URL (/foundation50)
      //   2. /ko-prefixed — the stale Korean URL that is still in the index
      //   3. /:locale     — en and ja, which keep their prefix
      //
      // Order matters: Next takes the FIRST matching rule. The /ko forms are
      // listed ahead of the generic /:locale one so a stale /ko/foundation50
      // reaches /founders in ONE hop instead of 308-ing to /ko/founders and
      // then paying a second 301 in the proxy to lose the prefix.
      //
      // These stay `permanent: true` (308) like every other path-level
      // redirect here; only the host-level rules above use an explicit 301.
      {
        source: "/foundation50",
        destination: "/founders",
        permanent: true,
      },
      {
        source: "/foundation50/:path*",
        destination: "/founders/:path*",
        permanent: true,
      },
      {
        source: "/founders/feedback",
        destination: "/beta-survey",
        permanent: true,
      },
      {
        source: "/ko/foundation50",
        destination: "/founders",
        permanent: true,
      },
      {
        source: "/ko/foundation50/:path*",
        destination: "/founders/:path*",
        permanent: true,
      },
      {
        source: "/ko/founders/feedback",
        destination: "/beta-survey",
        permanent: true,
      },
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
      {
        source: "/:locale/founders/feedback",
        destination: "/:locale/beta-survey",
        permanent: true,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
