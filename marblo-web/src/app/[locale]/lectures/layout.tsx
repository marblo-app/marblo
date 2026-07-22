import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

// Client page → per-route title lives in this server-only layout. Locale-aware
// via the shared nav label (강의 / Lectures / 講座) so Korean/Japanese search
// sees a localized <title> → "강의 | 마블로". (The [slug] child overrides this
// with its own absolute lecture title.)
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "nav" });
  return { title: t("lectures") };
}

export default function LecturesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
