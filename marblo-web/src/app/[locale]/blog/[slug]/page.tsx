import type { Metadata } from "next";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";
import { getTranslations } from "next-intl/server";
import { getPost, getPostLocales, getAllPostParams } from "@/lib/blog";
import { SITE_URL, buildBlogAlternates } from "@/lib/seo";
import { buildBlogPostingSchema, buildBreadcrumbSchema } from "@/lib/schema";
import Comments from "@/components/Comments";

const OG_LOCALE: Record<string, string> = {
  ko: "ko_KR",
  en: "en_US",
  ja: "ja_JP",
};

export function generateStaticParams() {
  return getAllPostParams();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const post = getPost(locale, slug);
  if (!post) return {};

  const url = `${SITE_URL}/${locale}/blog/${slug}`;
  const available = getPostLocales(slug, post.locales);
  const ogImage = post.ogImage ?? "/images/product-demo.png";

  return {
    title: post.title,
    description: post.description,
    alternates: buildBlogAlternates(locale, slug, available),
    openGraph: {
      title: post.title,
      description: post.description,
      url,
      type: "article",
      publishedTime: post.date,
      modifiedTime: post.updated ?? post.date,
      locale: OG_LOCALE[locale] ?? OG_LOCALE.en,
      images: [{ url: ogImage }],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
      images: [ogImage],
    },
  };
}

// Shared dark-theme chrome for figures/diagrams. Used by both the `figure` /
// `figcaption` MDX overrides (markdown-generated figures) AND the <Diagram>
// component below, so everything reads with one consistent tone.
const FIGURE_CLS =
  "my-8 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-6";
const FIGCAPTION_CLS = "mt-3 text-center text-sm leading-relaxed text-zinc-500";

// Reusable inline-SVG diagram wrapper. Posts write:
//   <Diagram caption="…"><svg role="img" aria-label="…" …/></Diagram>
// A *capitalized* component is used on purpose: MDX compiles author-written
// literal <figure> tags to host elements that bypass the components map, so a
// literal <figure> would never pick up FIGURE_CLS. A <Diagram> does resolve
// through the map, giving us a single styling source. See docs/blog-diagrams.md.
function Diagram({
  caption,
  children,
}: {
  caption: ReactNode;
  children: ReactNode;
}) {
  return (
    <figure className={FIGURE_CLS}>
      {children}
      <figcaption className={FIGCAPTION_CLS}>{caption}</figcaption>
    </figure>
  );
}

// Dark-theme prose renderers. Tailwind v4 here has no typography plugin, so MDX
// elements are styled explicitly — keeps everything in this route, no global CSS.
const mdxComponents = {
  Diagram,
  h2: (props: ComponentPropsWithoutRef<"h2">) => (
    <h2 className="mt-10 mb-4 text-2xl font-bold text-white" {...props} />
  ),
  h3: (props: ComponentPropsWithoutRef<"h3">) => (
    <h3 className="mt-8 mb-3 text-xl font-semibold text-white" {...props} />
  ),
  p: (props: ComponentPropsWithoutRef<"p">) => (
    <p className="my-4 leading-relaxed text-zinc-300" {...props} />
  ),
  ul: (props: ComponentPropsWithoutRef<"ul">) => (
    <ul className="my-4 list-disc pl-6 space-y-2 text-zinc-300" {...props} />
  ),
  ol: (props: ComponentPropsWithoutRef<"ol">) => (
    <ol className="my-4 list-decimal pl-6 space-y-2 text-zinc-300" {...props} />
  ),
  li: (props: ComponentPropsWithoutRef<"li">) => (
    <li className="leading-relaxed" {...props} />
  ),
  a: (props: ComponentPropsWithoutRef<"a">) => (
    <a
      className="text-indigo-400 underline underline-offset-2 hover:text-indigo-300"
      {...props}
    />
  ),
  strong: (props: ComponentPropsWithoutRef<"strong">) => (
    <strong className="font-semibold text-white" {...props} />
  ),
  code: (props: ComponentPropsWithoutRef<"code">) => (
    <code
      className="rounded bg-zinc-800 px-1.5 py-0.5 text-sm text-indigo-200"
      {...props}
    />
  ),
  pre: (props: ComponentPropsWithoutRef<"pre">) => (
    <pre
      className="my-6 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-sm [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-zinc-200"
      {...props}
    />
  ),
  blockquote: (props: ComponentPropsWithoutRef<"blockquote">) => (
    <blockquote
      className="my-6 border-l-2 border-indigo-500 pl-4 italic text-zinc-400"
      {...props}
    />
  ),
  // Applies to markdown-generated figures. Inline SVG diagrams use <Diagram>
  // (see above) — literal <figure> tags in MDX bypass this map.
  figure: (props: ComponentPropsWithoutRef<"figure">) => (
    <figure className={FIGURE_CLS} {...props} />
  ),
  figcaption: (props: ComponentPropsWithoutRef<"figcaption">) => (
    <figcaption className={FIGCAPTION_CLS} {...props} />
  ),
  img: (props: ComponentPropsWithoutRef<"img">) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img
      className="mx-auto my-6 h-auto max-w-full rounded-lg border border-zinc-800"
      {...props}
    />
  ),
};

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const post = getPost(locale, slug);
  if (!post) notFound();

  const t = await getTranslations({ locale, namespace: "blog" });
  const url = `${SITE_URL}/${locale}/blog/${slug}`;
  const dateFmt = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const categoryLabel = (() => {
    const key = `categories.${post.category}`;
    const label = t(key);
    return label === key ? post.category : label;
  })();

  const postingSchema = buildBlogPostingSchema({
    url,
    title: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.updated,
    authorName: post.author ?? "Marblo",
    image: post.ogImage ?? "/images/product-demo.png",
    inLanguage: locale,
  });

  const breadcrumbSchema = buildBreadcrumbSchema([
    { name: t("home"), url: `${SITE_URL}/${locale}` },
    { name: t("title"), url: `${SITE_URL}/${locale}/blog` },
    { name: post.title, url },
  ]);

  return (
    <article className="max-w-3xl mx-auto px-4 py-16 sm:py-20">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(postingSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />

      <nav className="mb-8 text-sm text-zinc-500" aria-label="Breadcrumb">
        <Link href={`/${locale}`} className="hover:text-zinc-300">
          {t("home")}
        </Link>
        <span className="mx-2" aria-hidden>
          /
        </span>
        <Link href={`/${locale}/blog`} className="hover:text-zinc-300">
          {t("title")}
        </Link>
      </nav>

      <header className="mb-8">
        <div className="flex items-center gap-3 text-sm text-zinc-500 mb-3">
          <span className="text-indigo-400">{categoryLabel}</span>
          <span aria-hidden>·</span>
          <time dateTime={post.date}>
            {dateFmt.format(new Date(post.date))}
          </time>
        </div>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight leading-tight">
          {post.title}
        </h1>
        <p className="mt-4 text-lg text-zinc-400">{post.description}</p>
      </header>

      <div className="text-[1.05rem]">
        <MDXRemote source={post.content} components={mdxComponents} />
      </div>

      <footer className="mt-14 border-t border-zinc-800 pt-8">
        <Link
          href={`/${locale}/blog`}
          className="text-indigo-400 hover:text-indigo-300"
        >
          ← {t("backToList")}
        </Link>
      </footer>

      <Comments term={slug} locale={locale} />
    </article>
  );
}
