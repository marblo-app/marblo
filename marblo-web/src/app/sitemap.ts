import type { MetadataRoute } from "next";

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

  return entries;
}
