"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import "./globals.css";

const LOCALES = ["ko", "en", "ja"] as const;
type Locale = typeof LOCALES[number];

const COPY: Record<
  Locale,
  { title: string; description: string; cta: string }
> = {
  ko: {
    title: "페이지를 찾을 수 없습니다",
    description: "요청하신 페이지가 존재하지 않거나 이동되었어요.",
    cta: "홈으로 돌아가기",
  },
  en: {
    title: "Page not found",
    description: "The page you are looking for does not exist or has moved.",
    cta: "Back to home",
  },
  ja: {
    title: "ページが見つかりません",
    description: "お探しのページは存在しないか、移動しました。",
    cta: "ホームへ戻る",
  },
};

export default function RootNotFound() {
  const pathname = usePathname() || "/";
  const seg = pathname.split("/")[1];
  const locale: Locale = (LOCALES as readonly string[]).includes(seg)
    ? (seg as Locale)
    : "ko";
  const copy = COPY[locale];

  return (
    <html lang={locale} className="dark">
      <body className="bg-zinc-950 text-white min-h-screen flex flex-col">
        <main className="flex-1 flex flex-col items-center justify-center px-4 py-28 text-center">
          <div className="relative max-w-md mx-auto">
            <p
              className="text-7xl md:text-8xl font-bold tracking-tight bg-gradient-to-r from-white to-zinc-500 bg-clip-text text-transparent"
              style={{
                fontFamily:
                  'var(--font-space-grotesk, "Space Grotesk", sans-serif)',
              }}
            >
              404
            </p>
            <h1 className="mt-6 text-2xl md:text-3xl font-bold text-white">
              {copy.title}
            </h1>
            <p className="mt-4 text-zinc-400 leading-relaxed">
              {copy.description}
            </p>
            <div className="mt-10">
              <Link
                href={`/${locale}`}
                className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-7 py-3.5 rounded-xl text-base font-semibold transition shadow-lg shadow-indigo-600/25"
              >
                {copy.cta}
              </Link>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
