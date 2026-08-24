import type { Metadata } from "next";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";
import { getTranslations } from "next-intl/server";
import {
  getPost,
  getPostLocales,
  getAllPostParams,
  getRelatedPosts,
} from "@/lib/blog";
import { buildBlogAlternates, localeUrl } from "@/lib/seo";
import {
  buildBlogPostingSchema,
  buildBreadcrumbSchema,
  stringifyJsonLd,
} from "@/lib/schema";
import Comments from "@/components/Comments";
import { localeHref } from "@/i18n/routing";

type MdxNode = {
  type?: string;
  name?: string;
  children?: MdxNode[];
};

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

  const url = localeUrl(locale, `/blog/${slug}`);
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

function remarkUnwrapSvgTextParagraphs() {
  return (tree: MdxNode) => {
    function visit(node: MdxNode) {
      if (!node.children) return;

      if (
        node.type === "mdxJsxFlowElement" &&
        (node.name === "text" || node.name === "tspan")
      ) {
        node.children = node.children.flatMap((child) =>
          child.type === "paragraph" && child.children
            ? child.children
            : [child]
        );
      }

      for (const child of node.children) visit(child);
    }

    visit(tree);
  };
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
  const url = localeUrl(locale, `/blog/${slug}`);
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

  // 관련 글 — 글끼리 서로 링크가 하나도 없던 상태를 메운다(2026-08-21 실측).
  // 크롤러 입장에서 글 상세는 막다른 골목이었다: 나가는 링크가 홈·목록뿐이라
  // 한 편을 읽어도 다음 글로 이어질 길이 없었다. 세 칸 중 최소 한 칸은 추천
  // 글에 배정된다(@/lib/blog getRelatedPosts 참조).
  const related = getRelatedPosts(locale, slug);

  const breadcrumbSchema = buildBreadcrumbSchema([
    { name: t("home"), url: localeUrl(locale) },
    { name: t("title"), url: localeUrl(locale, "/blog") },
    { name: post.title, url },
  ]);

  return (
    <article className="max-w-3xl mx-auto px-4 py-16 sm:py-20">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: stringifyJsonLd(postingSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: stringifyJsonLd(breadcrumbSchema) }}
      />

      <nav className="mb-8 text-sm text-zinc-500" aria-label="Breadcrumb">
        <Link href={localeHref(locale)} className="hover:text-zinc-300">
          {t("home")}
        </Link>
        <span className="mx-2" aria-hidden>
          /
        </span>
        <Link
          href={localeHref(locale, "/blog")}
          className="hover:text-zinc-300"
        >
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
        <MDXRemote
          source={post.content}
          components={mdxComponents}
          options={{
            mdxOptions: {
              remarkPlugins: [remarkUnwrapSvgTextParagraphs],
            },
          }}
        />
      </div>

      {related.length > 0 && (
        <section
          className="mt-14 border-t border-zinc-800 pt-8"
          aria-labelledby="related-posts"
        >
          <h2
            id="related-posts"
            className="text-lg font-semibold text-white mb-5"
          >
            {t("related")}
          </h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {related.map((p) => (
              <li key={p.slug}>
                <Link
                  href={localeHref(locale, `/blog/${p.slug}`)}
                  className="block h-full rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 transition hover:border-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                >
                  <span className="block text-xs text-indigo-400 mb-1">
                    {(() => {
                      const key = `categories.${p.category}`;
                      const label = t(key);
                      return label === key ? p.category : label;
                    })()}
                  </span>
                  <span className="block font-medium text-white leading-snug">
                    {p.title}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-10 border-t border-zinc-800 pt-8">
        <Link
          href={localeHref(locale, "/blog")}
          className="text-indigo-400 hover:text-indigo-300"
        >
          ← {t("backToList")}
        </Link>
      </footer>

      <Comments term={slug} locale={locale} />
    </article>
  );
}
