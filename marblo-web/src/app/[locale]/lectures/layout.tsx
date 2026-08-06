import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { buildAlternates } from "@/lib/seo";

// Client page → per-route title lives in this server-only layout. Locale-aware
// via the shared nav label (강의 / Lectures / 講座) so Korean/Japanese search
// sees a localized <title> → "강의 | 마블로". (The [slug] child overrides this
// with its own absolute lecture title.)
//
// `description` is set here too — without it this route inherited the site-wide
// description from the [locale] layout, identical to /download and /founders.
// The copy says the course is still in production, matching the visible
// "출시 예정" state (messages.lectures.coming_soon) and the deliberately lowered
// 0.5 sitemap priority. Promising a shipped course here would be a lie that
// search engines and answer engines would both repeat.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "nav" });
  const descriptions: Record<string, string> = {
    ko: "AI 에이전트 개발 강의. 마블로 v3 마스터클래스는 제작 중입니다 — 베타에 참여해 마블로를 먼저 사용하고 출시 알림을 받아보세요.",
    en: "Marblo lectures on AI agent development. The Marblo v3 masterclass is currently in production — join the beta to use Marblo now and get notified at launch.",
    ja: "AIエージェント開発の講座。Marblo v3 マスタークラスは制作中です — ベータに参加して Marblo をいち早く使い、リリース通知を受け取れます。",
  };
  return {
    title: t("lectures"),
    description: descriptions[locale] ?? descriptions.en,
    alternates: buildAlternates(locale, "/lectures"),
  };
}

export default function LecturesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
