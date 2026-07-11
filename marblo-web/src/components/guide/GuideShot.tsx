"use client";

import { useState } from "react";
import { ImageIcon } from "lucide-react";

/**
 * Renders a guide screenshot mockup (a self-contained SVG under
 * /public/images/guide). Text (alt / "coming soon" label) arrives
 * pre-translated as props so this stays i18n-free.
 *
 * Graceful degradation: if the asset is missing or fails to decode, the
 * component falls back to the original dashed "screenshot coming soon"
 * placeholder instead of showing a broken image — matching the look this
 * page shipped with before real art existed.
 */
export default function GuideShot({
  src,
  alt,
  comingLabel,
}: {
  src: string;
  alt: string;
  comingLabel: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <figure
        data-screenshot-src={src}
        className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-700 bg-zinc-900/40 px-6 py-10 text-center"
      >
        <ImageIcon className="h-7 w-7 text-zinc-600" aria-hidden />
        <figcaption className="text-sm text-zinc-500">{alt}</figcaption>
        <span className="text-xs text-zinc-600">{comingLabel}</span>
      </figure>
    );
  }

  return (
    <figure
      data-screenshot-src={src}
      className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40 shadow-lg shadow-black/20"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- decorative
          self-contained SVG mockup; no next/image optimization needed. */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="block h-auto w-full max-w-full"
      />
      <figcaption className="border-t border-zinc-800/70 px-4 py-2.5 text-center text-xs text-zinc-500">
        {alt}
      </figcaption>
    </figure>
  );
}
