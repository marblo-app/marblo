import type { MetadataRoute } from "next";

/**
 * robots.txt — generated at /robots.txt by Next.js metadata routing.
 * Explicit allow + sitemap pointer. Crawl budget unconstrained for launch;
 * if PH/HN spike causes load issues we can add Disallow rules later.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Keep auth flows and private user pages out of search results.
        disallow: ["/auth/", "/my/", "/api/"],
      },
    ],
    sitemap: "https://marblo.app/sitemap.xml",
    host: "https://marblo.app",
  };
}
