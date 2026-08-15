"use client";

import { useState } from "react";
import Image from "next/image";
import { Play } from "lucide-react";
import { useTranslations } from "next-intl";

const YOUTUBE_ID = "vsWPkl8hzq4";

export default function FeatureVideoSection() {
  const t = useTranslations("featureVideo");
  const [isLoaded, setIsLoaded] = useState(false);

  return (
    <section id="feature-video" className="scroll-mt-24 px-4 pt-2 pb-14 md:pb-20">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-8 md:mb-10">
          <span className="inline-flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/20 rounded-full px-4 py-1.5 mb-5 text-sm text-indigo-400 font-medium">
            {t("badge")}
          </span>
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight leading-tight">
            {t("title")}
          </h2>
          <p className="mt-4 text-lg text-zinc-400 max-w-2xl mx-auto leading-relaxed">
            {t("subtitle")}
          </p>
        </div>

        <div className="relative aspect-video overflow-hidden rounded-2xl border border-zinc-700/50 bg-zinc-900 shadow-2xl shadow-indigo-900/10">
          {isLoaded ? (
            <iframe
              className="absolute inset-0 h-full w-full"
              src={`https://www.youtube-nocookie.com/embed/${YOUTUBE_ID}?autoplay=1&rel=0&modestbranding=1&playsinline=1`}
              title={t("iframeTitle")}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          ) : (
            <button
              type="button"
              className="group absolute inset-0 flex h-full w-full items-center justify-center overflow-hidden text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
              aria-label={t("playLabel")}
              onClick={() => setIsLoaded(true)}
            >
              <Image
                src="/images/product-demo.webp"
                alt=""
                fill
                sizes="(min-width: 1024px) 1024px, 100vw"
                className="object-cover object-top opacity-80 transition duration-500 group-hover:scale-[1.02] group-hover:opacity-90"
                priority={false}
              />
              <span className="absolute inset-0 bg-gradient-to-br from-zinc-950/40 via-zinc-950/10 to-indigo-950/50" />
              <span className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-zinc-950/80 to-transparent" />
              <span className="relative flex h-18 w-18 items-center justify-center rounded-full border border-white/20 bg-white/15 text-white shadow-2xl shadow-black/40 backdrop-blur transition group-hover:scale-105 group-hover:bg-white/20">
                <Play className="ml-1 h-8 w-8 fill-current" />
              </span>
              <span className="sr-only">{t("playLabel")}</span>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
