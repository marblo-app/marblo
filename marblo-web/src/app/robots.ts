import type { MetadataRoute } from "next";

/**
 * robots.txt — generated at /robots.txt by Next.js metadata routing.
 * Explicit allow + sitemap pointer. Crawl budget unconstrained for launch;
 * if PH/HN spike causes load issues we can add Disallow rules later.
 *
 * ⚠️ /auth, /my and /admin are deliberately NOT disallowed here. They are kept
 * out of the index with a `robots: { index: false }` meta tag in their route
 * layouts instead — that is the only mechanism that actually removes a URL
 * from search results. robots.txt does the opposite: it stops the crawler from
 * ever reading the noindex, so a blocked URL that someone links to gets
 * indexed URL-only and reported as "Indexed, though blocked by robots.txt".
 *
 * The previous rules also silently missed their targets: `/*​/my/` (trailing
 * slash) does not match `/ko/my`, and the unprefixed `/auth/` and `/my/` forms
 * never exist at all under next-intl always-prefix routing.
 *
 * /api/ stays blocked: those responses are not HTML, so they cannot carry a
 * meta robots tag.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/"],
      },
    ],
    sitemap: "https://marblo.app/sitemap.xml",
    host: "https://marblo.app",
  };
}
