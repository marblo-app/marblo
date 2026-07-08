import type { MetadataRoute } from "next";
import { getAllPosts, getPostLocales } from "@/lib/blog";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = "https://marblo.app";
  const locales = ["ko", "en", "ja"];
  const pages = [
    "",
    "/lectures",
    "/lectures/marblo-v3-masterclass",
    "/pricing",
    "/download",
    "/founders",
    "/blog",
    "/faq",
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

  const entries: MetadataRoute.Sitemap = [];

  for (const locale of locales) {
    for (const page of pages) {
      entries.push({
        url: `${baseUrl}/${locale}${page}`,
        lastModified: new Date(),
        changeFrequency: page === "" ? "weekly" : "monthly",
        priority: page === "" ? 1.0 : page.includes("lectures") ? 0.9 : 0.8,
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
