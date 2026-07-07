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
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import PromoBar from "@/components/PromoBar";
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

  return {
    metadataBase: new URL(SITE_URL),
    title: {
      default: "Marblo - AI Agent Army Workspace",
      template: "%s | Marblo",
    },
    description:
      "Manage multiple AI agents on a kanban board. Run Claude, GPT/Codex, and Antigravity simultaneously with visual flow editor.",
    keywords: [
      "AI agent",
      "multi-agent",
      "kanban",
      "Claude",
      "GPT",
      "Antigravity",
      "developer tools",
      "AI orchestration",
      "Marblo",
    ],
    authors: [{ name: "Marblo" }],
    alternates,
    openGraph: {
      title: "Marblo - AI Agent Army Workspace",
      description:
        "Manage multiple AI agents on a kanban board. Run Claude, GPT/Codex, and Antigravity simultaneously.",
      type: "website",
      siteName: "Marblo",
      url: alternates.canonical,
      locale: og.locale,
      alternateLocale: og.alternateLocale,
      images: [{ url: "/images/product-demo.png", width: 2560, height: 1320 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Marblo - AI Agent Army Workspace",
      description: "Manage multiple AI agents on a kanban board.",
      images: ["/images/product-demo.png"],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, "max-image-preview": "large" },
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

  return (
    <html
      lang={locale}
      className={`dark ${spaceGrotesk.variable} ${inter.variable}`}
    >
      <body className="font-sans bg-zinc-950 text-white min-h-screen flex flex-col">
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
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
