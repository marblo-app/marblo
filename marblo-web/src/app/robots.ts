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
        // Routes are locale-prefixed (/ko/auth/, /en/my/, …), so match both the
        // bare paths and the "/*/segment" form that covers every locale prefix.
        disallow: ["/auth/", "/my/", "/api/", "/*/auth/", "/*/my/", "/*/admin"],
      },
    ],
    sitemap: "https://marblo.app/sitemap.xml",
    host: "https://marblo.app",
  };
}
