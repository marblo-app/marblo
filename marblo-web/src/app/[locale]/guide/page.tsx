import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Info,
  Lightbulb,
} from "lucide-react";
import { SITE_URL, buildAlternates } from "@/lib/seo";
import { buildBreadcrumbSchema, stringifyJsonLd } from "@/lib/schema";
import {
  GUIDE_ANCHOR_IDS,
  GUIDE_STEPS,
  type GuideBlock,
  type GuideStep,
} from "@/lib/guideContent";
import GuideSidebar, {
  type GuideSidebarSection,
} from "@/components/guide/GuideSidebar";
import CopyButton from "@/components/guide/CopyButton";
import GuideShot from "@/components/guide/GuideShot";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "guide" });
  return {
    title: t("meta.title"),
    description: t("meta.description"),
    alternates: buildAlternates(locale, "/guide"),
    openGraph: {
      title: `${t("meta.title")} | Marblo`,
      description: t("meta.description"),
      url: `${SITE_URL}/${locale}/guide`,
      type: "article",
    },
  };
}

/** Callout variant → color + icon. */
const CALLOUT_STYLES = {
  note: {
    wrap: "border-brand-500/30 bg-brand-500/5",
    icon: "text-brand-300",
    Icon: Info,
  },
  tip: {
    wrap: "border-emerald-500/30 bg-emerald-500/5",
    icon: "text-emerald-300",
    Icon: Lightbulb,
  },
  warn: {
    wrap: "border-amber-500/30 bg-amber-500/5",
    icon: "text-amber-300",
    Icon: AlertTriangle,
  },
} as const;

type T = Awaited<ReturnType<typeof getTranslations>>;

function renderBlock(
  block: GuideBlock,
  key: number,
  t: T,
  locale: string
): React.ReactNode {
  switch (block.kind) {
    case "text":
      return (
        <p key={key} className="text-zinc-400 leading-relaxed">
          {t(block.key)}
        </p>
      );

    case "code":
      return (
        <div
          key={key}
          className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/70"
        >
          <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-4 py-2">
            <span className="font-mono text-xs text-zinc-500">
              {block.captionKey ? t(block.captionKey) : "shell"}
            </span>
            <CopyButton
              text={block.code}
              copyLabel={t("meta.copy")}
              copiedLabel={t("meta.copied")}
            />
          </div>
          <pre className="overflow-x-auto px-4 py-3.5 text-sm leading-relaxed">
            <code className="font-mono text-zinc-200">{block.code}</code>
          </pre>
        </div>
      );

    case "callout": {
      const s = CALLOUT_STYLES[block.variant];
      return (
        <div
          key={key}
          className={`flex gap-3 rounded-xl border p-4 ${s.wrap}`}
          role="note"
        >
          <s.Icon className={`h-5 w-5 shrink-0 ${s.icon}`} aria-hidden />
          <p className="text-sm leading-relaxed text-zinc-300">
            {t(block.key)}
          </p>
        </div>
      );
    }

    case "shot":
      // Hand-authored SVG mockups of the desktop app UI live under
      // /public/images/guide. GuideShot renders the real asset and falls back
      // to the original dashed "coming soon" placeholder on load error.
      return (
        <GuideShot
          key={key}
          src={block.src}
          alt={t(block.altKey)}
          comingLabel={t("meta.screenshotComing")}
        />
      );

    case "links":
      return (
        <div key={key} className="flex flex-wrap gap-3">
          {block.items.map((item) => (
            <Link
              key={item.href}
              href={`/${locale}${item.href}`}
              className="inline-flex items-center gap-1.5 rounded-button border border-brand-500/40 bg-brand-500/10 px-4 py-2 text-sm font-medium text-brand-200 transition hover:border-brand-400 hover:bg-brand-500/20"
            >
              {t(item.key)}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          ))}
        </div>
      );

    default:
      return null;
  }
}

function StepSection({
  step,
  t,
  locale,
}: {
  step: GuideStep;
  t: T;
  locale: string;
}) {
  const prev = GUIDE_STEPS[step.num - 2];
  const next = GUIDE_STEPS[step.num];

  return (
    <section
      id={step.id}
      className="scroll-mt-24 border-t border-zinc-800/60 pt-14 first:border-t-0 first:pt-0"
    >
      <div className="flex items-center gap-2 text-sm font-medium text-brand-300">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-500/15 text-xs font-semibold">
          {step.num}
        </span>
        {t("meta.stepLabel", { num: step.num, total: GUIDE_STEPS.length })}
      </div>
      <h2 className="mt-3 text-3xl font-bold tracking-tight text-white">
        {t(step.titleKey)}
      </h2>
      <p className="mt-3 text-lg text-zinc-400 leading-relaxed">
        {t(step.introKey)}
      </p>

      <div className="mt-8 space-y-10">
        {step.substeps.map((sub) => (
          <div key={sub.id} id={sub.id} className="scroll-mt-24">
            <h3 className="flex items-center gap-2 text-xl font-semibold text-white">
              <ChevronRight className="h-4 w-4 text-brand-400" aria-hidden />
              {t(sub.titleKey)}
            </h3>
            <div className="mt-4 space-y-4">
              {sub.blocks.map((block, i) => renderBlock(block, i, t, locale))}
            </div>
          </div>
        ))}
      </div>

      {/* Per-step previous / next navigation */}
      <nav
        className="mt-10 flex items-center justify-between gap-4"
        aria-label={t("meta.stepNav")}
      >
        {prev ? (
          <a
            href={`#${prev.id}`}
            className="group flex flex-1 flex-col rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3 transition hover:border-zinc-700"
          >
            <span className="flex items-center gap-1 text-xs text-zinc-500">
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              {t("meta.prev")}
            </span>
            <span className="mt-0.5 truncate text-sm font-medium text-zinc-300 group-hover:text-white">
              {t(prev.titleKey)}
            </span>
          </a>
        ) : (
          <span className="flex-1" />
        )}
        {next ? (
          <a
            href={`#${next.id}`}
            className="group flex flex-1 flex-col items-end rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3 text-right transition hover:border-zinc-700"
          >
            <span className="flex items-center gap-1 text-xs text-zinc-500">
              {t("meta.next")}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </span>
            <span className="mt-0.5 truncate text-sm font-medium text-zinc-300 group-hover:text-white">
              {t(next.titleKey)}
            </span>
          </a>
        ) : (
          <span className="flex-1" />
        )}
      </nav>
    </section>
  );
}

export default async function GuidePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "guide" });

  // Pre-translate the sidebar tree so the client component stays i18n-free.
  const sidebarSections: GuideSidebarSection[] = GUIDE_STEPS.map((step) => ({
    id: step.id,
    num: step.num,
    title: t(step.titleKey),
    substeps: step.substeps.map((sub) => ({
      id: sub.id,
      title: t(sub.titleKey),
    })),
  }));

  const breadcrumbSchema = buildBreadcrumbSchema([
    { name: t("meta.breadcrumbHome"), url: `${SITE_URL}/${locale}` },
    { name: t("meta.breadcrumbGuide"), url: `${SITE_URL}/${locale}/guide` },
  ]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: stringifyJsonLd(breadcrumbSchema) }}
      />

      <nav className="mb-8 text-sm text-zinc-500" aria-label="Breadcrumb">
        <Link href={`/${locale}`} className="hover:text-zinc-300">
          {t("meta.breadcrumbHome")}
        </Link>
        <span className="mx-2" aria-hidden>
          /
        </span>
        <span className="text-zinc-400">{t("meta.breadcrumbGuide")}</span>
      </nav>

      <header className="mb-12 max-w-3xl">
        <p className="text-sm font-semibold uppercase tracking-wider text-brand-400">
          {t("meta.eyebrow")}
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight md:text-5xl">
          {t("meta.heading")}
        </h1>
        <p className="mt-4 text-lg text-zinc-400 leading-relaxed">
          {t("meta.subheading")}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-x-12 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <GuideSidebar
          sections={sidebarSections}
          anchorIds={GUIDE_ANCHOR_IDS}
          tocTitle={t("meta.tocTitle")}
        />

        <article className="min-w-0 max-w-3xl space-y-14">
          {GUIDE_STEPS.map((step) => (
            <StepSection key={step.id} step={step} t={t} locale={locale} />
          ))}
        </article>
      </div>
    </div>
  );
}
