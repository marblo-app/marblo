import type { MetadataRoute } from "next";
import { getAllPosts, getPostLocales } from "@/lib/blog";
import { routing } from "@/i18n/routing";
import { SITE_URL } from "@/lib/seo";

/**
 * ⚠️ INVARIANT: every URL emitted here must return 200 on the apex.
 *
 * Never add the bare root `https://marblo.app/`. Under next-intl always-prefix
 * routing the root is a 307 to the negotiated locale, and a sitemap must not
 * list URLs that redirect — Google reports them as "Page with redirect" and
 * drops them, which makes the sitemap look broken rather than making the root
 * indexable. The root only becomes eligible if it is ever made a real 200 page
 * (see docs/SEO-REDIRECT-CHAIN-2026-08-21.md §B, where that was weighed and
 * declined). The same rule kills the other redirect sources: /foundation50,
 * /founders/feedback, and any www.* host.
 *
 * This is why every entry below is built as `${baseUrl}/${locale}${page}` —
 * the locale prefix is what makes the URL a 200.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  // Derived from the single source of truth, never re-declared. `lib/seo.ts`
  // builds the <head> hreflang cluster from `routing`; this file builds the
  // sitemap one. Google treats the HTML, HTTP-header, and sitemap methods as
  // equivalent, so the two must agree — a hardcoded copy here meant that
  // changing `routing.defaultLocale` would silently move x-default in <head>
  // while leaving the sitemap pointing at the old locale, emitting two
  // conflicting x-default targets for the same cluster.
  const baseUrl = SITE_URL;
  const locales = routing.locales;
  const pages = [
    "",
    "/guide",
    "/lectures",
    "/lectures/marblo-v3-masterclass",
    "/pricing",
    "/download",
    "/founders",
    "/blog",
    "/faq",
    // Founder-programme FAQ — public content with its own copy, previously
    // reachable and indexable but absent from the sitemap.
    "/founders/faq",
    // Policy pages — real, indexable, trust-building routes. Low priority
    // (support content, not conversion pages). /legal/business (사업자정보) is
    // a legally mandated public disclosure page and renders `index: true`, so
    // it belongs here too: leaving an indexable page out of the sitemap is
    // what produces "Discovered - currently not indexed" in Search Console.
    "/legal/privacy",
    "/legal/terms",
    "/legal/refund",
    "/legal/business",
  ];

  // Per-page hreflang cluster shared across every locale entry for that page.
  const languagesFor = (page: string): Record<string, string> => {
    const languages: Record<string, string> = {};
    for (const locale of locales) {
      languages[locale] = `${baseUrl}/${locale}${page}`;
    }
    languages["x-default"] = `${baseUrl}/${routing.defaultLocale}${page}`;
    return languages;
  };

  // Priority reflects real business importance, not page depth. The home page
  // is the primary entry (1.0); conversion pages (pricing/download/founders/
  // guide/blog/faq) sit at 0.8. Lectures are "출시 예정"(coming soon) — genuine
  // content but not yet a conversion path, so they must NOT outrank core pages
  // (previously 0.9). Policy pages are support content (0.3).
  const priorityFor = (page: string): number => {
    if (page === "") return 1.0;
    if (page.startsWith("/legal")) return 0.3;
    if (page.includes("/lectures")) return 0.5;
    // Sub-pages of a campaign landing page (/founders/faq) support it rather
    // than compete with it.
    if (page.split("/").length > 2) return 0.5;
    return 0.8;
  };

  const changeFrequencyFor = (
    page: string
  ): "weekly" | "monthly" | "yearly" => {
    if (page === "") return "weekly";
    if (page.startsWith("/legal")) return "yearly";
    return "monthly";
  };

  // `lastModified` is emitted ONLY where a truthful date exists (blog posts,
  // and the blog index which tracks its newest post). Static pages previously
  // used `new Date()`, which stamps every deploy time onto every URL and tells
  // Google the whole site changed whenever anything did. Google discards
  // lastmod values it judges unreliable, so a wrong date is strictly worse
  // than no date — the field is simply omitted for those pages.
  const newestPostDate = (): Date | undefined => {
    const times = locales
      .flatMap((l) => getAllPosts(l))
      .map((p) => new Date(p.updated ?? p.date).getTime())
      .filter((t) => Number.isFinite(t));
    return times.length ? new Date(Math.max(...times)) : undefined;
  };
  const blogIndexModified = newestPostDate();

  const entries: MetadataRoute.Sitemap = [];

  for (const locale of locales) {
    for (const page of pages) {
      const lastModified = page === "/blog" ? blogIndexModified : undefined;
      entries.push({
        url: `${baseUrl}/${locale}${page}`,
        ...(lastModified ? { lastModified } : {}),
        changeFrequency: changeFrequencyFor(page),
        priority: priorityFor(page),
        alternates: {
          languages: languagesFor(page),
        },
      });
    }
  }

  // Blog posts — added per locale, with hreflang limited to the locales in which
  // each post actually exists (never link a missing translation).
  for (const locale of locales) {
    for (const post of getAllPosts(locale)) {
      const available = getPostLocales(post.slug, post.locales);
      const languages: Record<string, string> = {};
      for (const l of available) {
        languages[l] = `${baseUrl}/${l}/blog/${post.slug}`;
      }
      // Mirrors buildBlogAlternates() in lib/seo.ts: prefer the default locale,
      // fall back to the first locale the post actually exists in, so we never
      // point x-default at a translation that was never written.
      const xDefault = available.includes(routing.defaultLocale)
        ? routing.defaultLocale
        : available[0];
      if (xDefault) {
        languages["x-default"] = `${baseUrl}/${xDefault}/blog/${post.slug}`;
      }
      entries.push({
        url: `${baseUrl}/${locale}/blog/${post.slug}`,
        lastModified: new Date(post.updated ?? post.date),
        changeFrequency: "monthly",
        priority: 0.7,
        alternates: { languages },
      });
    }
  }

  return entries;
}
