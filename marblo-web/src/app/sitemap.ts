import type { MetadataRoute } from "next";
import { getAllPosts, getPostLocales } from "@/lib/blog";
import { isSearchLocale, searchLocales, xDefaultLocale } from "@/i18n/routing";
import { localeUrl } from "@/lib/seo";
import { FEATURED_SLUGS } from "@/data/featuredPosts";

/**
 * ⚠️ INVARIANT: every URL emitted here must return 200 on the apex.
 *
 * A sitemap must not list URLs that redirect — Google files them under "Page
 * with redirect" and drops them, which makes the sitemap look broken rather
 * than making the redirecting URL indexable. That rules out /foundation50,
 * /founders/feedback, any www.* host, and — since the move to
 * `localePrefix: "as-needed"` — every /ko/* URL, which now 301s to its
 * unprefixed form.
 *
 * ★ The bare root `https://marblo.app/` IS listed now, and that is a change.
 * Under the previous always-prefix routing the root was a 307 to a negotiated
 * locale and was correctly excluded (see docs/SEO-REDIRECT-CHAIN-2026-08-21.md
 * §B, where making it a real page was weighed and declined at the time). It is
 * now the Korean home page, served 200 to any visitor whose Accept-Language
 * does not match en or ja — which includes Googlebot, since it sends no
 * Accept-Language at all. The condition that comment set has been met; see
 * docs/SEO-LOCALE-AS-NEEDED-2026-08-21.md for the measured proof.
 *
 * This is why no entry below is built by hand. `localeUrl()` (lib/seo.ts, over
 * `localeHref()` in i18n/routing.ts) is the single place that knows which
 * locales carry a prefix, so the sitemap cannot drift from the <link
 * rel="canonical"> tags the pages themselves emit.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  // Only the locales we advertise to search engines — NOT every locale the app
  // serves. ja is currently withheld, so /ja/* is absent from this file while
  // still building, routing and rendering normally. Single source of truth (and
  // the one-line revert) lives in src/i18n/routing.ts.
  const locales: readonly string[] = searchLocales;
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
      languages[locale] = localeUrl(locale, page);
    }
    // Derived, never hardcoded: a literal "en" here would silently disagree
    // with the x-default that lib/seo.ts stamps into each page's
    // <link rel="alternate"> the moment defaultLocale changes, and two
    // conflicting x-defaults are a signal crawlers are entitled to ignore.
    languages["x-default"] = localeUrl(xDefaultLocale, page);
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
    const times = searchLocales
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
        url: localeUrl(locale, page),
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
  // each post actually exists (never link a missing translation) AND that we
  // advertise to search engines.
  //
  // ★정직하게 적어둔다: `priority` 와 `changeFrequency` 는 구글이 공개적으로
  // "쓰지 않는다" 고 밝힌 필드다. 아래 0.7/0.5 구분은 **우리 의도의 기록**이지
  // 크롤 예산을 움직이는 장치가 아니다. 실제로 크롤 순서를 바꾸는 건 내부 링크
  // 구조이고, 그건 이 PR 의 Footer/홈/관련 글 변경이 담당한다.
  //
  // `lastmod` 는 다르다 — 이건 구글이 실제로 쓰고, 신뢰할 수 없다고 판단하면
  // 사이트 전체에서 무시한다. 그래서 값이 정확해야 한다. frontmatter 의
  // `updated ?? date` 가 본문 최종 수정일과 일치하는지는
  // `npm run check:lastmod` 가 git 이력으로 검증한다.
  for (const locale of locales) {
    for (const post of getAllPosts(locale)) {
      const available = getPostLocales(post.slug, post.locales).filter(
        isSearchLocale
      );
      const languages: Record<string, string> = {};
      for (const l of available) {
        languages[l] = localeUrl(l, `/blog/${post.slug}`);
      }
      // Mirrors buildBlogAlternates() in lib/seo.ts: prefer the x-default
      // locale, fall back to the first locale the post actually exists in, so
      // we never point x-default at a translation that was never written.
      const xDefault = available.includes(xDefaultLocale)
        ? xDefaultLocale
        : available[0];
      if (xDefault) {
        languages["x-default"] = localeUrl(xDefault, `/blog/${post.slug}`);
      }
      entries.push({
        url: localeUrl(locale, `/blog/${post.slug}`),
        lastModified: new Date(post.updated ?? post.date),
        changeFrequency: "monthly",
        // 추천 글(내부 링크를 몰아준 4편)만 블로그 상단 티어로 둔다. 나머지를
        // 0.5 로 내리는 건 순위 강등이 아니라 "우리가 어디에 집중했는지" 의
        // 자기기록이다. 위 주석대로 구글은 이 값을 읽지 않는다.
        priority: FEATURED_SLUGS.has(post.slug) ? 0.7 : 0.5,
        alternates: { languages },
      });
    }
  }

  return entries;
}
