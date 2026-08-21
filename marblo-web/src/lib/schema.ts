import { SITE_URL, localeUrl } from "@/lib/seo";

/**
 * Schema.org JSON-LD builders for SEO + GEO (generative-engine optimization).
 *
 * Every builder returns a plain object that the caller renders inside a
 * `<script type="application/ld+json">` tag. Stable `@id` anchors let the
 * Organization / WebSite / SoftwareApplication nodes reference each other so
 * search engines (and LLM crawlers) resolve them into one entity graph.
 *
 * Source of truth for the site origin is {@link SITE_URL} (https://marblo.app,
 * no `www`) — do not hardcode the domain here.
 *
 * ⚠️ Only encode facts that are true and visible to humans. No invented
 * ratings, no unreleased features (Mission/Flow are intentionally excluded).
 */

export function stringifyJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/** Stable node identifiers so nodes can cross-reference via `@id`. */
export const ORG_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;
export const APP_ID = `${SITE_URL}/#software`;

type Locale = "ko" | "en" | "ja";

const pick = <T>(locale: string, map: Record<Locale, T>): T =>
  map[(locale as Locale) in map ? (locale as Locale) : "en"];

const ORG_DESCRIPTION: Record<Locale, string> = {
  ko: "Marblo(마블로)는 Claude Code와 Codex 같은 코딩 에이전트를 엔지니어링 팀처럼 조율하는 데스크톱 워크스페이스입니다. 개발사는 주식회사 하이프마크(HYPEMARC).",
  en: "Marblo is a desktop workspace that turns coding agents such as Claude Code and Codex into an engineering team. Built by HYPEMARC.",
  ja: "Marblo(マブロ)はClaude CodeやCodexなどのコーディングエージェントをエンジニアリングチームとして調整するデスクトップワークスペースです。開発はHYPEMARC。",
};

const APP_DESCRIPTION: Record<Locale, string> = {
  ko: "Marblo는 Claude Code·Codex 등 이종 코딩 에이전트를 조율하는 데스크톱 앱입니다. 중앙 오케스트레이터가 태스크 귀속, 격리 워크트리, 진행 상태, 리뷰·머지 게이트를 한 흐름으로 묶고, MCP 프로토콜을 네이티브 지원하며, 모든 실행이 로컬에서 이루어집니다. macOS·Windows 지원.",
  en: "Marblo is a desktop app that coordinates heterogeneous coding agents such as Claude Code and Codex. A central orchestrator ties task ownership, isolated worktrees, progress state, and review/merge gates into one workflow, supports MCP natively, and runs locally. Available for macOS and Windows.",
  ja: "MarbloはClaude Code・Codexなどの異種コーディングエージェントを調整するデスクトップアプリです。中央オーケストレーターがタスク所有、隔離ワークツリー、進捗状態、レビュー・マージゲートを一つの流れに束ね、MCPプロトコルにネイティブ対応し、すべてローカルで実行されます。macOS・Windows対応。",
};

/**
 * Organization node. `sameAs` is optional — pass only genuine official
 * profiles (omit rather than link a weak/unofficial page).
 *
 * `locale` selects the description language. Previously this always emitted
 * the English text, so the /ko and /ja pages described the brand entity in a
 * language their own content is not written in — the opposite of what an
 * answer engine needs to cite the right sentence back to a Korean or Japanese
 * asker.
 *
 * `contactPoint` and `address` carry the same values already published to
 * humans on /legal/business (the 전자상거래법 disclosure page). Nothing here is
 * new information — it is the existing, verifiable business record restated in
 * a machine-readable form so the entity resolves.
 */
export function buildOrganizationSchema(opts?: {
  locale?: string;
  sameAs?: string[];
}) {
  const sameAs = (opts?.sameAs ?? []).filter(Boolean);
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": ORG_ID,
    name: "Marblo",
    // Localized brand names so search engines resolve Hangul/Katakana brand
    // queries ("마블로", "マブロ") to this same entity as the Latin "Marblo".
    alternateName: ["마블로", "マブロ"],
    legalName: "HYPEMARC",
    url: SITE_URL,
    logo: {
      "@type": "ImageObject",
      url: `${SITE_URL}/marblo-mark.svg`,
    },
    description: pick(opts?.locale ?? "en", ORG_DESCRIPTION),
    email: "team@marblo.app",
    // `telephone` is deliberately absent. The number on /legal/business is a
    // personal mobile, published there because 전자상거래법 requires it on that
    // one disclosure page. Putting it in site-wide JSON-LD is a different act:
    // it invites search engines to surface it in knowledge panels and AI
    // answers on every page. That is the owner's call to make, not a side
    // effect of an SEO change — see docs/SEO-GSC-INDEXING-AUDIT.md.
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: "team@marblo.app",
      areaServed: ["KR", "JP", "US"],
      availableLanguage: ["ko", "en", "ja"],
    },
    address: {
      "@type": "PostalAddress",
      streetAddress: "2F, 16 Baekjegobun-ro 50-gil",
      addressLocality: "Songpa-gu",
      addressRegion: "Seoul",
      addressCountry: "KR",
    },
    ...(sameAs.length ? { sameAs } : {}),
  };
}

/** WebSite node. Publisher references the Organization by `@id`. */
export function buildWebSiteSchema(locale?: string) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    url: SITE_URL,
    name: "Marblo",
    alternateName: ["마블로", "マブロ"],
    description: pick(locale ?? "en", ORG_DESCRIPTION),
    inLanguage: ["ko", "en", "ja"],
    publisher: { "@id": ORG_ID },
  };
}

/**
 * SoftwareApplication node for the Marblo desktop app. Offers reflect the
 * live pricing tiers (Free ₩0, Pro ₩19,000/mo). No aggregateRating is emitted
 * because there is no real review data to back it.
 */
export function buildSoftwareApplicationSchema(locale: string) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": APP_ID,
    name: "Marblo",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "macOS, Windows",
    url: SITE_URL,
    downloadUrl: localeUrl(locale, "/download"),
    description: pick(locale, APP_DESCRIPTION),
    publisher: { "@id": ORG_ID },
    offers: [
      {
        "@type": "Offer",
        name: "Free",
        price: "0",
        priceCurrency: "KRW",
        category: "free",
      },
      {
        "@type": "Offer",
        name: "Pro",
        price: "19000",
        priceCurrency: "KRW",
        category: "subscription",
      },
    ],
  };
}

/**
 * FAQPage node. Pass answer-first Q&A pairs (already localized by the caller).
 * Entries with an empty question or answer are dropped so the emitted schema
 * never contains blank fields.
 */
export function buildFAQPageSchema(
  faqs: Array<{ question: string; answer: string }>
) {
  const mainEntity = faqs
    .filter((f) => f.question?.trim() && f.answer?.trim())
    .map((f) => ({
      "@type": "Question",
      name: f.question.trim(),
      acceptedAnswer: {
        "@type": "Answer",
        text: f.answer.trim(),
      },
    }));

  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity,
  };
}

/**
 * BlogPosting node for a single blog article. `publisher` references the
 * Organization by `@id` (defined in {@link buildOrganizationSchema}), so the
 * article joins the same entity graph. `dateModified` falls back to
 * `datePublished` when the post has no explicit update date.
 */
export function buildBlogPostingSchema(opts: {
  url: string;
  title: string;
  description: string;
  datePublished: string;
  dateModified?: string;
  authorName: string;
  image?: string;
  inLanguage: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "@id": `${opts.url}#article`,
    mainEntityOfPage: { "@type": "WebPage", "@id": opts.url },
    url: opts.url,
    headline: opts.title,
    description: opts.description,
    datePublished: opts.datePublished,
    dateModified: opts.dateModified || opts.datePublished,
    inLanguage: opts.inLanguage,
    author: { "@type": "Organization", name: opts.authorName },
    publisher: { "@id": ORG_ID },
    ...(opts.image
      ? {
          image: opts.image.startsWith("http")
            ? opts.image
            : `${SITE_URL}${opts.image}`,
        }
      : {}),
  };
}

/**
 * BreadcrumbList node. Pass ordered { name, url } items (Home → Blog → Post).
 * Empty-named items are dropped so the emitted schema never has blank fields.
 */
export function buildBreadcrumbSchema(
  items: Array<{ name: string; url: string }>
) {
  const itemListElement = items
    .filter((i) => i.name?.trim() && i.url)
    .map((i, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      name: i.name.trim(),
      item: i.url,
    }));
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement,
  };
}

/**
 * Blog + ItemList node for the blog index — lists the posts so crawlers see the
 * collection. `posts` are ordered newest-first by the caller.
 */
export function buildBlogListSchema(opts: {
  url: string;
  name: string;
  description: string;
  posts: Array<{ url: string; title: string }>;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Blog",
    "@id": `${opts.url}#blog`,
    url: opts.url,
    name: opts.name,
    description: opts.description,
    publisher: { "@id": ORG_ID },
    blogPost: opts.posts.map((p) => ({
      "@type": "BlogPosting",
      headline: p.title,
      url: p.url,
    })),
  };
}

/**
 * The /pricing page intentionally has no dedicated Product node. Marblo is a
 * SaaS desktop app, so its plan Offers attach to the {@link
 * buildSoftwareApplicationSchema} node (`SoftwareApplication`, APP_ID) — the
 * type Google expects for software. A prior `Product` node here tripped
 * Merchant listing warnings (shipping details, return policy, brand type,
 * aggregateRating/review) that only make sense for physical/retail goods; those
 * fields cannot be filled with real data for a downloadable app, so the node
 * was removed rather than padded with fabricated e-commerce metadata.
 */
