import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = 'https://marblo.net';
  const locales = ['ko', 'en', 'ja'];
  const pages = ['', '/lectures', '/lectures/marblo-v3-masterclass', '/pricing', '/download'];

  const entries: MetadataRoute.Sitemap = [];

  for (const locale of locales) {
    for (const page of pages) {
      entries.push({
        url: `${baseUrl}/${locale}${page}`,
        lastModified: new Date(),
        changeFrequency: page === '' ? 'weekly' : 'monthly',
        priority: page === '' ? 1.0 : page.includes('lectures') ? 0.9 : 0.8,
      });
    }
  }

  return entries;
}
