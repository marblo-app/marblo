import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getAllPosts, getCategories } from "@/lib/blog";
import { buildAlternates, localeUrl } from "@/lib/seo";
import { buildBlogListSchema, stringifyJsonLd } from "@/lib/schema";
import { localeHref } from "@/i18n/routing";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "blog" });
  return {
    title: t("title"),
    description: t("subtitle"),
    // `types` adds <link rel="alternate" type="application/rss+xml">. The feed
    // at /[locale]/blog/rss.xml was already built and served with the right
    // content-type, but nothing on the page pointed at it, so feed readers and
    // the crawlers that use autodiscovery could not find it from the blog index.
    alternates: {
      ...buildAlternates(locale, "/blog"),
      types: {
        "application/rss+xml": localeUrl(locale, "/blog/rss.xml"),
      },
    },
    openGraph: {
      title: `${t("title")} | Marblo`,
      description: t("subtitle"),
      url: localeUrl(locale, "/blog"),
      type: "website",
    },
  };
}

export default async function BlogIndexPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ category?: string }>;
}) {
  const { locale } = await params;
  const { category } = await searchParams;
  const t = await getTranslations({ locale, namespace: "blog" });

  const allPosts = getAllPosts(locale);
  const categories = getCategories(locale);
  const activeCategory =
    category && categories.includes(category) ? category : null;
  const posts = activeCategory
    ? allPosts.filter((p) => p.category === activeCategory)
    : allPosts;

  const categoryLabel = (c: string) => {
    const key = `categories.${c}`;
    const label = t(key);
    return label === key ? c : label;
  };

  const blogSchema = buildBlogListSchema({
    url: localeUrl(locale, "/blog"),
    name: t("title"),
    description: t("subtitle"),
    posts: allPosts.map((p) => ({
      url: localeUrl(locale, `/blog/${p.slug}`),
      title: p.title,
    })),
  });

  const dateFmt = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <div className="max-w-4xl mx-auto px-4 py-16 sm:py-20">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: stringifyJsonLd(blogSchema) }}
      />
      <header className="mb-10">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
          {t("title")}
        </h1>
        <p className="mt-4 text-lg text-zinc-400">{t("subtitle")}</p>
      </header>

      {categories.length > 0 && (
        <nav className="mb-10 flex flex-wrap gap-2" aria-label={t("title")}>
          <Link
            href={localeHref(locale, "/blog")}
            className={`px-3 py-1.5 rounded-full text-sm border transition ${
              activeCategory === null
                ? "bg-indigo-600 border-indigo-500 text-white"
                : "border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500"
            }`}
          >
            {t("all")}
          </Link>
          {categories.map((c) => (
            <Link
              key={c}
              href={localeHref(locale, `/blog?category=${c}`)}
              className={`px-3 py-1.5 rounded-full text-sm border transition ${
                activeCategory === c
                  ? "bg-indigo-600 border-indigo-500 text-white"
                  : "border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500"
              }`}
            >
              {categoryLabel(c)}
            </Link>
          ))}
        </nav>
      )}

      <ul className="space-y-6">
        {posts.map((post) => (
          <li key={post.slug}>
            <Link
              href={localeHref(locale, `/blog/${post.slug}`)}
              className="block rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 hover:border-zinc-600 transition"
            >
              <div className="flex items-center gap-3 text-sm text-zinc-500 mb-2">
                <span className="text-indigo-400">
                  {categoryLabel(post.category)}
                </span>
                <span aria-hidden>·</span>
                <time dateTime={post.date}>
                  {dateFmt.format(new Date(post.date))}
                </time>
              </div>
              <h2 className="text-xl font-semibold text-white">{post.title}</h2>
              <p className="mt-2 text-zinc-400 line-clamp-2">
                {post.description}
              </p>
            </Link>
          </li>
        ))}
      </ul>

      {posts.length === 0 && <p className="text-zinc-500">{t("empty")}</p>}
    </div>
  );
}
