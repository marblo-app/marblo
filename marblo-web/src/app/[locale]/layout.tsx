import type { Metadata } from "next";
import { Suspense } from "react";
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
      "Manage multiple AI agents on a kanban board. Run Claude, GPT, and Gemini simultaneously with visual flow editor.",
    keywords: [
      "AI agent",
      "multi-agent",
      "kanban",
      "Claude",
      "GPT",
      "Gemini",
      "developer tools",
      "AI orchestration",
      "Marblo",
    ],
    authors: [{ name: "Marblo" }],
    alternates,
    openGraph: {
      title: "Marblo - AI Agent Army Workspace",
      description:
        "Manage multiple AI agents on a kanban board. Run Claude, GPT, and Gemini simultaneously.",
      type: "website",
      siteName: "Marblo",
      url: alternates.canonical,
      locale: og.locale,
      alternateLocale: og.alternateLocale,
      images: [
        { url: "/images/hero-screenshot.png", width: 1920, height: 1080 },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "Marblo - AI Agent Army Workspace",
      description: "Manage multiple AI agents on a kanban board.",
      images: ["/images/hero-screenshot.png"],
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
    <html lang={locale} className="dark">
      <body className="bg-zinc-950 text-white min-h-screen flex flex-col">
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
