import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { buildAlternates, localeUrl } from "@/lib/seo";
import {
  buildFAQPageSchema,
  buildBreadcrumbSchema,
  stringifyJsonLd,
} from "@/lib/schema";
import { localeHref } from "@/i18n/routing";

type FaqItem = { q: string; a: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "faq" });
  return {
    title: t("title"),
    description: t("subtitle"),
    alternates: buildAlternates(locale, "/faq"),
    openGraph: {
      title: `${t("title")} | Marblo`,
      description: t("subtitle"),
      url: localeUrl(locale, "/faq"),
      type: "website",
    },
  };
}

export default async function FaqPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "faq" });
  const items = t.raw("items") as FaqItem[];

  // FAQPage mirrors the visible accordion 1:1 (Google: only mark up FAQ that is
  // visible to users). BreadcrumbList: Home → FAQ.
  const faqSchema = buildFAQPageSchema(
    items.map((it) => ({ question: it.q, answer: it.a }))
  );
  const breadcrumbSchema = buildBreadcrumbSchema([
    { name: t("home"), url: localeUrl(locale) },
    { name: t("title"), url: localeUrl(locale, "/faq") },
  ]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-16 sm:py-20">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: stringifyJsonLd(faqSchema) }}
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
        <span className="text-zinc-400">{t("title")}</span>
      </nav>

      <header className="mb-10">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
          {t("title")}
        </h1>
        <p className="mt-4 text-lg text-zinc-400">{t("subtitle")}</p>
      </header>

      <dl className="space-y-3">
        {items.map((item, i) => (
          <details
            key={i}
            className="group rounded-2xl border border-zinc-800 bg-zinc-900/40 [&_summary]:list-none"
          >
            <summary className="flex cursor-pointer items-center justify-between gap-4 p-5 text-lg font-semibold text-white">
              <dt>{item.q}</dt>
              <span
                className="shrink-0 text-zinc-500 transition-transform group-open:rotate-45"
                aria-hidden
              >
                +
              </span>
            </summary>
            <dd className="px-5 pb-5 -mt-1 text-zinc-400 leading-relaxed">
              {item.a}
            </dd>
          </details>
        ))}
      </dl>
    </div>
  );
}
