import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import PromoBar from "@/components/PromoBar";
import PrivacyConsentGate from "@/components/PrivacyConsentGate";
import "../globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://marblo.app"),
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
  alternates: {
    languages: {
      ko: "https://marblo.app/ko",
      en: "https://marblo.app/en",
      ja: "https://marblo.app/ja",
      "x-default": "https://marblo.app",
    },
  },
  openGraph: {
    title: "Marblo - AI Agent Army Workspace",
    description:
      "Manage multiple AI agents on a kanban board. Run Claude, GPT, and Gemini simultaneously.",
    type: "website",
    siteName: "Marblo",
    url: "https://marblo.app",
    images: [{ url: "/images/hero-screenshot.png", width: 1920, height: 1080 }],
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
