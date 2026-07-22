import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

// The page itself is a Client Component and cannot export metadata, so this
// server-only layout supplies the per-route title. Locale-aware via the shared
// nav label (다운로드 / Download / ダウンロード) so Korean/Japanese search sees a
// localized <title>; the parent title.template wraps it → "다운로드 | 마블로".
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "nav" });
  return { title: t("download") };
}

export default function DownloadLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
