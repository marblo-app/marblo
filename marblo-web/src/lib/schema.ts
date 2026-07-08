import { SITE_URL } from "@/lib/seo";

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

/** Stable node identifiers so nodes can cross-reference via `@id`. */
export const ORG_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;
export const APP_ID = `${SITE_URL}/#software`;

type Locale = "ko" | "en" | "ja";

const pick = <T>(locale: string, map: Record<Locale, T>): T =>
  map[(locale as Locale) in map ? (locale as Locale) : "en"];

const ORG_DESCRIPTION: Record<Locale, string> = {
  ko: "Marblo(마블로)는 여러 AI 코딩 에이전트를 칸반 보드에서 동시에 오케스트레이션하는 데스크톱 워크스페이스입니다. 개발사는 주식회사 하이프마크(HYPEMARC).",
  en: "Marblo is a desktop workspace that orchestrates multiple AI coding agents simultaneously on a kanban board. Built by HYPEMARC.",
  ja: "Marblo(マブロ)は複数のAIコーディングエージェントをカンバンボードで同時にオーケストレーションするデスクトップワークスペースです。開発はHYPEMARC。",
};

const APP_DESCRIPTION: Record<Locale, string> = {
  ko: "Marblo는 Claude·GPT/Codex·Antigravity 등 이종 AI 에이전트를 하나의 칸반 보드에서 동시에 운용하는 데스크톱 앱입니다. 중앙 오케스트레이터가 태스크를 분할·할당하고, MCP 프로토콜을 네이티브 지원하며, 모든 실행이 로컬에서 이루어집니다. macOS·Windows 지원.",
  en: "Marblo is a desktop app that runs heterogeneous AI agents — Claude, GPT/Codex, Antigravity — simultaneously on a single kanban board. A central orchestrator splits and assigns tasks, MCP is supported natively, and everything runs locally. Available for macOS and Windows.",
  ja: "MarbloはClaude・GPT/Codex・Antigravityなどの異種AIエージェントを一つのカンバンボードで同時に運用するデスクトップアプリです。中央オーケストレーターがタスクを分割・割り当て、MCPプロトコルをネイティブ対応し、すべての実行はローカルで行われます。macOS・Windows対応。",
};

/**
 * Organization node. `sameAs` is optional — pass only genuine official
 * profiles (omit rather than link a weak/unofficial page).
 */
export function buildOrganizationSchema(opts?: { sameAs?: string[] }) {
  const sameAs = (opts?.sameAs ?? []).filter(Boolean);
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": ORG_ID,
    name: "Marblo",
    legalName: "HYPEMARC",
    url: SITE_URL,
    logo: {
      "@type": "ImageObject",
      url: `${SITE_URL}/marblo-mark.svg`,
    },
    description: ORG_DESCRIPTION.en,
    email: "team@marblo.app",
    ...(sameAs.length ? { sameAs } : {}),
  };
}

/** WebSite node. Publisher references the Organization by `@id`. */
export function buildWebSiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    url: SITE_URL,
    name: "Marblo",
    description: ORG_DESCRIPTION.en,
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
    downloadUrl: `${SITE_URL}/${locale}/download`,
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
 * Product node with the live pricing tiers as Offers, for the /pricing page.
 * Kept distinct from the SoftwareApplication node (APP_ID) so the pricing page
 * can expose plan Offers without redefining the app entity. Brand references
 * the Organization by `@id`. Prices are the real KRW values (Free ₩0, Pro
 * ₩19,000).
 */
export function buildProductOffersSchema(locale: string) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${SITE_URL}/#product`,
    name: "Marblo",
    description: pick(locale, APP_DESCRIPTION),
    brand: { "@id": ORG_ID },
    url: `${SITE_URL}/${locale}/pricing`,
    offers: [
      {
        "@type": "Offer",
        name: "Free",
        price: "0",
        priceCurrency: "KRW",
        url: `${SITE_URL}/${locale}/pricing`,
        availability: "https://schema.org/InStock",
      },
      {
        "@type": "Offer",
        name: "Pro",
        price: "19000",
        priceCurrency: "KRW",
        url: `${SITE_URL}/${locale}/pricing`,
        availability: "https://schema.org/InStock",
      },
    ],
  };
}
