import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { buildAlternates } from "@/lib/seo";

// The page itself is a Client Component and cannot export metadata, so this
// server-only layout supplies the per-route title. Locale-aware via the shared
// nav label (다운로드 / Download / ダウンロード) so Korean/Japanese search sees a
// localized <title>; the parent title.template wraps it → "다운로드 | 마블로".
//
// `description` is set here too. Without it the route inherited the site-wide
// description from the [locale] layout verbatim, so /download, /founders and
// /lectures all shipped byte-identical descriptions — a duplicate-meta signal,
// and worse for GEO: an answer engine had nothing distinguishing this page from
// the home page. Copy mirrors what the page actually says (messages.download):
// macOS Universal now, Windows coming soon, CLI accounts connected after install.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "nav" });
  const descriptions: Record<string, string> = {
    ko: "마블로 데스크톱(베타) 다운로드. macOS 유니버설(인텔·애플 실리콘) 지금 지원, 윈도우는 준비 중. 설치 후 AI CLI 계정을 연결하면 에이전트가 로컬에서 실행됩니다.",
    en: "Download Marblo Desktop (Beta). macOS Universal (Intel + Apple Silicon) available now; Windows coming soon. Connect your AI CLI accounts and run agents locally.",
    ja: "Marblo デスクトップ（ベータ）をダウンロード。macOS ユニバーサル（Intel・Apple Silicon）に対応、Windows は準備中。AI CLI アカウントを接続すればエージェントがローカルで実行されます。",
  };
  return {
    title: t("download"),
    description: descriptions[locale] ?? descriptions.en,
    alternates: buildAlternates(locale, "/download"),
  };
}

export default function DownloadLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
