import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

// Client page → per-route title lives in this server-only layout. Locale-aware
// via the shared nav label (파운더 / Founders / ファウンダー) so Korean/Japanese
// search sees a localized <title> → "파운더 | 마블로".
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "nav" });
  return { title: t("foundation50") };
}

export default function FoundersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
