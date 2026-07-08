import { getAllPosts } from "@/lib/blog";
import { SITE_URL } from "@/lib/seo";
import { routing } from "@/i18n/routing";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ locale: string }> }
) {
  const { locale } = await params;
  if (!(routing.locales as readonly string[]).includes(locale)) {
    return new Response("Not found", { status: 404 });
  }

  const posts = getAllPosts(locale).slice(0, 20);
  const feedUrl = `${SITE_URL}/${locale}/blog/rss.xml`;
  const blogUrl = `${SITE_URL}/${locale}/blog`;
  const now = new Date().toUTCString();

  const items = posts
    .map((post) => {
      const link = `${SITE_URL}/${locale}/blog/${post.slug}`;
      const pubDate = new Date(post.updated ?? post.date).toUTCString();
      return `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <description>${escapeXml(post.description)}</description>
      <category>${escapeXml(post.category)}</category>
      <pubDate>${pubDate}</pubDate>
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Marblo Blog (${locale})</title>
    <link>${blogUrl}</link>
    <atom:link href="${feedUrl}" rel="self" type="application/rss+xml" />
    <description>AI agents, MCP, and multi-agent orchestration — from the Marblo team.</description>
    <language>${locale}</language>
    <lastBuildDate>${now}</lastBuildDate>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
