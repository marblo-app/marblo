import "server-only";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { routing } from "@/i18n/routing";

/**
 * MDX blog content layer.
 *
 * Files live at `content/blog/<locale>/<slug>.mdx`. Each locale has its own
 * physical file (the localized body). `frontmatter.locales` declares every
 * locale the slug is published in — used to build hreflang. To avoid linking
 * empty translations, hreflang is always intersected with the locales whose
 * file actually exists on disk ({@link getPostLocales}).
 *
 * A post is exposed in a locale only when BOTH its file exists under that
 * locale's directory AND its `locales` frontmatter includes that locale.
 */

export type BlogFrontmatter = {
  title: string;
  description: string;
  date: string; // ISO (YYYY-MM-DD)
  updated?: string; // ISO
  category: string;
  locales: string[];
  ogImage?: string;
  author?: string;
};

export type BlogPostMeta = BlogFrontmatter & {
  slug: string;
  locale: string;
};

export type BlogPost = BlogPostMeta & {
  content: string; // raw MDX body
};

const BLOG_ROOT = path.join(process.cwd(), "content", "blog");
const DEFAULT_AUTHOR = "Marblo";

function localeDir(locale: string): string {
  return path.join(BLOG_ROOT, locale);
}

function isMdx(file: string): boolean {
  return file.endsWith(".mdx") || file.endsWith(".md");
}

function slugOf(file: string): string {
  return file.replace(/\.mdx?$/, "");
}

/** Read + parse one file. Returns null if missing or unparseable. */
function readPost(locale: string, slug: string): BlogPost | null {
  const dir = localeDir(locale);
  const full =
    [".mdx", ".md"]
      .map((ext) => path.join(dir, `${slug}${ext}`))
      .find((p) => fs.existsSync(p)) ?? null;
  if (!full) return null;

  const raw = fs.readFileSync(full, "utf8");
  const { data, content } = matter(raw);
  const fm = data as Partial<BlogFrontmatter>;

  // Required fields must be present, else skip (never emit an empty-field post).
  if (!fm.title || !fm.description || !fm.date || !fm.category) return null;
  const locales =
    Array.isArray(fm.locales) && fm.locales.length ? fm.locales : [locale];

  // A file must declare the locale of the directory it sits in.
  if (!locales.includes(locale)) return null;

  return {
    slug,
    locale,
    title: fm.title,
    description: fm.description,
    date: fm.date,
    updated: fm.updated,
    category: fm.category,
    locales,
    ogImage: fm.ogImage,
    author: fm.author ?? DEFAULT_AUTHOR,
    content,
  };
}

/** All posts published in `locale`, newest first. */
export function getAllPosts(locale: string): BlogPostMeta[] {
  const dir = localeDir(locale);
  if (!fs.existsSync(dir)) return [];
  const posts: BlogPostMeta[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!isMdx(file)) continue;
    const post = readPost(locale, slugOf(file));
    if (post) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { content, ...meta } = post;
      posts.push(meta);
    }
  }
  return posts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** Full post (with body) or null if not published in `locale`. */
export function getPost(locale: string, slug: string): BlogPost | null {
  return readPost(locale, slug);
}

/** Posts in `locale` filtered by category, newest first. */
export function getPostsByCategory(
  locale: string,
  category: string
): BlogPostMeta[] {
  return getAllPosts(locale).filter((p) => p.category === category);
}

/** Distinct categories present in `locale`, in first-seen (date desc) order. */
export function getCategories(locale: string): string[] {
  const seen = new Set<string>();
  for (const p of getAllPosts(locale)) seen.add(p.category);
  return [...seen];
}

/**
 * Locales in which `slug` is actually published — the intersection of the
 * post's declared `locales` and the locales whose file exists on disk. This is
 * the ONLY set that should drive hreflang, so we never link a missing page.
 */
export function getPostLocales(slug: string, declared?: string[]): string[] {
  const base = declared ?? [];
  const candidates = base.length
    ? base
    : (routing.locales as readonly string[]);
  return (routing.locales as readonly string[])
    .filter((l) => candidates.includes(l))
    .filter((l) => readPost(l, slug) !== null);
}

/**
 * Every (locale, slug) pair that resolves to a real post — for
 * `generateStaticParams` on the blog detail route.
 */
export function getAllPostParams(): { locale: string; slug: string }[] {
  const params: { locale: string; slug: string }[] = [];
  for (const locale of routing.locales) {
    for (const post of getAllPosts(locale)) {
      params.push({ locale, slug: post.slug });
    }
  }
  return params;
}
