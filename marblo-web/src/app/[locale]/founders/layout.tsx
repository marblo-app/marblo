import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { buildAlternates } from "@/lib/seo";

// Client page → per-route title lives in this server-only layout. Locale-aware
// via the shared nav label (파운더 / Founders / ファウンダー) so Korean/Japanese
// search sees a localized <title> → "파운더 | 마블로".
//
// `description` is set here too — without it this route inherited the site-wide
// description from the [locale] layout, identical to /download and /lectures.
// Copy states only what the page itself promises (messages.foundation50): free
// beta access, up to 6 months of Pro for survey feedback, selective admission.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "nav" });
  const descriptions: Record<string, string> = {
    ko: "마블로 파운더 모집 — 정식 출시 전 전 기능 무료 베타, 설문 회신 시 마블로 Pro 최대 6개월 무료. 선착순이 아니라 모든 신청서를 검토해 선별합니다.",
    en: "Marblo Founders — free beta access to every feature before launch, plus up to 6 months of Marblo Pro for your feedback. Selective: we review every application.",
    ja: "Marblo ファウンダー募集 — 正式リリース前に全機能を無料ベータで開放、フィードバック回答で Marblo Pro を最大6か月無料。先着ではなく全ての応募を審査する選考制です。",
  };
  return {
    title: t("foundation50"),
    description: descriptions[locale] ?? descriptions.en,
    alternates: buildAlternates(locale, "/founders"),
  };
}

export default function FoundersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
