import type { Metadata } from "next";
import { useTranslations, useLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import PricingSection from "@/components/PricingSection";
import {
  buildFAQPageSchema,
  buildSoftwareApplicationSchema,
} from "@/lib/schema";

// Locale-aware metadata. The title segment reuses the existing nav label
// (가격 / Pricing / 料金) so Korean/Japanese search sees a localized <title>
// ("가격 | 마블로") instead of the previous hardcoded English "Pricing".
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "nav" });
  const descriptions: Record<string, string> = {
    ko: "마블로 요금제 — Free(무료)·Pro·Team·Enterprise. 여러 AI 에이전트를 칸반 보드에서 동시에 운용하는 데스크톱 워크스페이스의 가격을 확인하세요.",
    en: "Marblo pricing — Free, Pro, Team, and Enterprise plans for the desktop workspace that runs multiple AI agents simultaneously on a kanban board.",
    ja: "Marblo料金 — Free・Pro・Team・Enterprise。複数のAIエージェントをカンバンボードで同時運用するデスクトップワークスペースの価格。",
  };
  return {
    title: t("pricing"),
    description: descriptions[locale] ?? descriptions.en,
  };
}

export default function PricingPage() {
  const t = useTranslations("pricing");
  const locale = useLocale();

  // FAQ Q&A rendered visibly below; the same array drives the FAQPage JSON-LD so
  // the markup matches the on-screen content 1:1 (no invisible FAQ markup).
  const faqItems = t.raw("faq.items") as { q: string; a: string }[];
  const faqSchema = buildFAQPageSchema(
    faqItems.map((it) => ({ question: it.q, answer: it.a }))
  );
  // Emit the SoftwareApplication node (not a Product) so the pricing page's
  // plan Offers attach to the correct entity type for a SaaS desktop app. A
  // Product node here tripped Google's Merchant listing checks (shipping /
  // return policy / brand type / review) — SoftwareApplication carries the same
  // Free/Pro Offers without inviting those e-commerce requirements.
  const productSchema = buildSoftwareApplicationSchema(locale);

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
        <p className="text-center text-sm text-indigo-400 mb-4">
          {t("annual_discount")}
        </p>
        {/* Honest BYOK reframe — AI usage not included; agents run on the
            user's own existing Claude Code/Codex accounts they connect. */}
        <p className="mx-auto mb-8 max-w-2xl text-center text-sm text-zinc-400 leading-relaxed">
          {t("byokNotice")}
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
