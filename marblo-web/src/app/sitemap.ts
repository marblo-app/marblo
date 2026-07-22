import type { MetadataRoute } from "next";
import { getAllPosts, getPostLocales } from "@/lib/blog";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = "https://marblo.app";
  const locales = ["ko", "en", "ja"];
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
    // Policy pages — real, indexable, trust-building routes that were missing
    // from the sitemap. Low priority (support content, not conversion pages).
    // /legal/business (사업자정보) is intentionally omitted here.
    "/legal/privacy",
    "/legal/terms",
    "/legal/refund",
  ];

  // Per-page hreflang cluster shared across every locale entry for that page.
  const languagesFor = (page: string): Record<string, string> => {
    const languages: Record<string, string> = {};
    for (const locale of locales) {
      languages[locale] = `${baseUrl}/${locale}${page}`;
    }
    languages["x-default"] = `${baseUrl}/en${page}`;
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
    return 0.8;
  };

  const changeFrequencyFor = (
    page: string
  ): "weekly" | "monthly" | "yearly" => {
    if (page === "") return "weekly";
    if (page.startsWith("/legal")) return "yearly";
    return "monthly";
  };

  const entries: MetadataRoute.Sitemap = [];

  for (const locale of locales) {
    for (const page of pages) {
      entries.push({
        url: `${baseUrl}/${locale}${page}`,
        lastModified: new Date(),
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
      const xDefault = available.includes("en") ? "en" : available[0];
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
