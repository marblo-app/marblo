import type { Metadata } from "next";
import { useTranslations, useLocale } from "next-intl";
import PricingSection from "@/components/PricingSection";
import { buildFAQPageSchema, buildProductOffersSchema } from "@/lib/schema";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Simple pricing plans for Marblo AI Agent Workspace. Free, Pro, Team, and Enterprise.",
};

export default function PricingPage() {
  const t = useTranslations("pricing");
  const locale = useLocale();

  // FAQ Q&A rendered visibly below; the same array drives the FAQPage JSON-LD so
  // the markup matches the on-screen content 1:1 (no invisible FAQ markup).
  const faqItems = t.raw("faq.items") as { q: string; a: string }[];
  const faqSchema = buildFAQPageSchema(
    faqItems.map((it) => ({ question: it.q, answer: it.a }))
  );
  const productSchema = buildProductOffersSchema(locale);

  return (
    <div className="py-24 px-4">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <div className="max-w-7xl mx-auto">
        <h1 className="text-4xl font-bold text-center">{t("title")}</h1>
        <p className="text-zinc-400 text-center mt-3 mb-4">{t("subtitle")}</p>
        <p className="text-center text-sm text-indigo-400 mb-8">
          {t("annual_discount")}
        </p>
        <PricingSection />

        {/* Pricing FAQ — visible, and mirrored in the FAQPage JSON-LD above. */}
        <section className="max-w-3xl mx-auto mt-24">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-8">
            {t("faq.title")}
          </h2>
          <dl className="space-y-4">
            {faqItems.map((item, i) => (
              <div
                key={i}
                className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6"
              >
                <dt className="text-lg font-semibold text-white">{item.q}</dt>
                <dd className="mt-2 text-zinc-400 leading-relaxed">{item.a}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  );
}
