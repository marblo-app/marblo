import type { Metadata } from "next";
import { Suspense } from "react";
import { Space_Grotesk, Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { routing } from "@/i18n/routing";
import {
  SITE_URL,
  buildAlternates,
  buildOpenGraphLocale,
  pagePathFromPathname,
} from "@/lib/seo";
import { buildOrganizationSchema, buildWebSiteSchema } from "@/lib/schema";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import PromoBar from "@/components/PromoBar";
import FounderSurveyGate from "@/components/FounderSurveyGate";
import PrivacyConsentGate from "@/components/PrivacyConsentGate";
import GoogleAnalytics from "@/components/GoogleAnalytics";
import "../globals.css";

// Self-hosted fonts (next/font/google → no runtime request to Google, no CLS).
// Space Grotesk = display/headings; Inter = body. Each exposes a CSS variable
// that globals.css maps to --font-display / --font-sans (see @theme inline).
// Both are variable fonts, so no explicit `weight` is needed.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-space-grotesk",
});

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

// Per-locale SEO copy. Korean/Japanese search (Naver, Google KR/JP) rank the
// localized <title>/<meta description>, so these must NOT be English on /ko|/ja.
// Facts are identical across languages: multi-agent (Claude · GPT/Codex ·
// Antigravity) kanban orchestration, central orchestrator, native MCP, local
// execution. No "flow editor" — Flow/Mission are inactive and removed sitewide.
type MetaCopy = {
  titleDefault: string;
  titleTemplate: string;
  description: string;
  keywords: string[];
  ogTitle: string;
  ogDescription: string;
  twTitle: string;
  twDescription: string;
};

const SITE_METADATA: Record<"ko" | "en" | "ja", MetaCopy> = {
  ko: {
    titleDefault: "마블로 — AI 에이전트 군단 워크스페이스",
    titleTemplate: "%s | 마블로",
    description:
      "Claude, GPT/Codex, Antigravity 에이전트를 칸반 보드에서 동시에 운용하세요. 중앙 오케스트레이터가 태스크를 나눠 배치하고, MCP를 네이티브로 지원하며, 모든 실행은 로컬에서 이뤄집니다.",
    keywords: [
      "AI 에이전트",
      "멀티 에이전트",
      "칸반",
      "Claude",
      "GPT",
      "Codex",
      "Antigravity",
      "AI 오케스트레이션",
      "개발자 도구",
      "마블로",
      "MCP",
    ],
    ogTitle: "마블로 — AI 에이전트 군단 워크스페이스",
    ogDescription:
      "여러 AI 에이전트를 칸반 보드에서 동시에. 중앙 오케스트레이터 · MCP 네이티브 · 로컬 실행.",
    twTitle: "마블로 — AI 에이전트 군단 워크스페이스",
    twDescription:
      "여러 AI 에이전트를 칸반 보드에서 동시에 운용하는 데스크톱 워크스페이스.",
  },
  en: {
    titleDefault: "Marblo - AI Agent Army Workspace",
    titleTemplate: "%s | Marblo",
    description:
      "Run Claude, GPT/Codex, and Antigravity agents simultaneously on a kanban board. A central orchestrator splits and assigns tasks, MCP is supported natively, and everything runs locally.",
    keywords: [
      "AI agent",
      "multi-agent",
      "kanban",
      "Claude",
      "GPT",
      "Codex",
      "Antigravity",
      "AI orchestration",
      "developer tools",
      "Marblo",
      "MCP",
    ],
    ogTitle: "Marblo - AI Agent Army Workspace",
    ogDescription:
      "Run multiple AI agents at once on a kanban board. Central orchestrator, native MCP, local execution.",
    twTitle: "Marblo - AI Agent Army Workspace",
    twDescription:
      "A desktop workspace that runs multiple AI agents simultaneously on a kanban board.",
  },
  ja: {
    titleDefault: "Marblo — AIエージェント軍団ワークスペース",
    titleTemplate: "%s | Marblo",
    description:
      "Claude・GPT/Codex・Antigravityのエージェントをカンバンボードで同時に運用。中央オーケストレーターがタスクを分割・割り当て、MCPをネイティブ対応し、すべての実行はローカルで行われます。",
    keywords: [
      "AIエージェント",
      "マルチエージェント",
      "カンバン",
      "Claude",
      "GPT",
      "Codex",
      "Antigravity",
      "AIオーケストレーション",
      "開発者ツール",
      "Marblo",
      "MCP",
    ],
    ogTitle: "Marblo — AIエージェント軍団ワークスペース",
    ogDescription:
      "複数のAIエージェントをカンバンで同時運用。中央オーケストレーター・MCPネイティブ・ローカル実行。",
    twTitle: "Marblo — AIエージェント軍団ワークスペース",
    twDescription:
      "複数のAIエージェントをカンバンボードで同時に運用するデスクトップワークスペース。",
  },
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  // x-pathname is injected by the middleware (src/proxy.ts) so we can build
  // self-referencing per-page canonical + hreflang for every route, including
  // client-component pages that cannot export their own generateMetadata.
  const pathname = (await headers()).get("x-pathname") ?? `/${locale}`;
  const pagePath = pagePathFromPathname(pathname, locale);
  const alternates = buildAlternates(locale, pagePath);
  const og = buildOpenGraphLocale(locale);
  const googleVerification = process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION;
  // Naver Search Advisor ownership token. This is a PUBLIC verification value
  // (not a secret — it is meant to appear in page source), so it is safe to
  // hardcode as a fallback: the site passes Naver verification on deploy with
  // no env config. An env var still overrides it if set. Google has no token
  // yet, so it stays env-only (no meta tag until NEXT_PUBLIC_GOOGLE_... is set).
  const naverVerification =
    process.env.NEXT_PUBLIC_NAVER_SITE_VERIFICATION ??
    "1b3b54314bdb622f396e50166d8b845ff077fc62";
  // Localized copy for the current locale (fall back to English for anything
  // outside ko/en/ja). Only the text fields vary — alternates/robots/OG-locale
  // logic below stays shared.
  const copy = SITE_METADATA[locale as "ko" | "en" | "ja"] ?? SITE_METADATA.en;

  return {
    metadataBase: new URL(SITE_URL),
    title: {
      default: copy.titleDefault,
      template: copy.titleTemplate,
    },
    description: copy.description,
    keywords: copy.keywords,
    authors: [{ name: "Marblo" }],
    alternates,
    openGraph: {
      title: copy.ogTitle,
      description: copy.ogDescription,
      type: "website",
      siteName: "Marblo",
      url: alternates.canonical,
      locale: og.locale,
      alternateLocale: og.alternateLocale,
      images: [{ url: "/images/product-demo.png", width: 2560, height: 1320 }],
    },
    twitter: {
      card: "summary_large_image",
      title: copy.twTitle,
      description: copy.twDescription,
      images: ["/images/product-demo.png"],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, "max-image-preview": "large" },
    },
    // Search-console ownership verification. Each key is included only when its
    // env var is set, so an unset var emits NO meta tag (rather than an empty
    // one) — the codebase ships the wiring, the operator supplies the codes.
    verification: {
      ...(googleVerification ? { google: googleVerification } : {}),
      ...(naverVerification
        ? { other: { "naver-site-verification": naverVerification } }
        : {}),
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!(routing.locales as readonly string[]).includes(locale)) {
    notFound();
  }
  const messages = await getMessages();

  // Site-wide entity graph (Organization + WebSite). Rendered on every route so
  // the brand entity resolves consistently for search engines and LLM crawlers.
  // sameAs points at the official public release repository (only genuine
  // external presence — omit weak links rather than pad this).
  const organizationSchema = buildOrganizationSchema({
    sameAs: ["https://github.com/melocream/marblo-releases"],
  });
  const websiteSchema = buildWebSiteSchema();

  return (
    <html
      lang={locale}
      className={`dark ${spaceGrotesk.variable} ${inter.variable}`}
    >
      <body className="font-sans bg-zinc-950 text-white min-h-screen flex flex-col">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(organizationSchema),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }}
        />
        {/* GA4 로더 + 자동 pageview (측정ID 없으면 no-op). useSearchParams 사용 → Suspense 필수 */}
        <Suspense fallback={null}>
          <GoogleAnalytics />
        </Suspense>
        <NextIntlClientProvider messages={messages}>
          <PromoBar />
          <Header />
          <main className="flex-1">{children}</main>
          <Footer />
          {/* PIPA 동의 게이트 — 로그인했지만 필수 동의가 없으면 차단 모달 */}
          <PrivacyConsentGate />
          {/* 파운더 설문 넛지 — 선정 파운더 중 미회신자에게 "회신 시 Pro 최대
              3개월" 안내(dismiss 가능). 기본 OFF, 플래그로만 노출. */}
          <FounderSurveyGate />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
