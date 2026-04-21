import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import '../globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://marblo.net'),
  title: {
    default: 'Marblo - AI Agent Army Workspace',
    template: '%s | Marblo',
  },
  description: 'Manage multiple AI agents on a kanban board. Run Claude, GPT, and Gemini simultaneously with visual flow editor.',
  keywords: ['AI agent', 'multi-agent', 'kanban', 'Claude', 'GPT', 'Gemini', 'developer tools', 'AI orchestration', 'Marblo'],
  authors: [{ name: 'Marblo' }],
  openGraph: {
    title: 'Marblo - AI Agent Army Workspace',
    description: 'Manage multiple AI agents on a kanban board. Run Claude, GPT, and Gemini simultaneously.',
    type: 'website',
    siteName: 'Marblo',
    images: [{ url: '/images/hero-screenshot.png', width: 1920, height: 1080 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Marblo - AI Agent Army Workspace',
    description: 'Manage multiple AI agents on a kanban board.',
    images: ['/images/hero-screenshot.png'],
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
  if (!routing.locales.includes(locale as any)) {
    notFound();
  }
  const messages = await getMessages();

  return (
    <html lang={locale} className="dark">
      <body className="bg-zinc-950 text-white min-h-screen flex flex-col">
        <NextIntlClientProvider messages={messages}>
          <Header />
          <main className="flex-1">{children}</main>
          <Footer />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
