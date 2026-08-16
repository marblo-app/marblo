"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";
import type { SyntheticEvent } from "react";

export default function FeatureVideoSection() {
  const t = useTranslations("featureVideo");
  const setDemoPlaybackRate = useCallback(
    (event: SyntheticEvent<HTMLVideoElement>) => {
      event.currentTarget.playbackRate = 1.5;
    },
    [],
  );

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
          <video
            className="absolute inset-0 h-full w-full object-cover"
            src="/media/orchestration-demo.mp4"
            poster="/media/orchestration-demo-poster.jpg"
            title={t("iframeTitle")}
            onLoadedMetadata={setDemoPlaybackRate}
            onPlay={setDemoPlaybackRate}
            controls
            playsInline
          />
        </div>
      </div>
    </section>
  );
}
