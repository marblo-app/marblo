"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import Image from "next/image";

const CLOSE_LABEL: Record<string, string> = {
  ko: "닫기",
  ja: "閉じる",
  en: "Close",
};

export default function HeroScreenshot() {
  const t = useTranslations("hero");
  const locale = useLocale();
  const closeLabel = CLOSE_LABEL[locale] ?? CLOSE_LABEL.en;
  const [isOpen, setIsOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Lightbox: close on Escape, lock scroll, manage focus.
  useEffect(() => {
    if (!isOpen) return;

    const opener = openerRef.current;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Move focus into the dialog.
    closeRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      // Restore focus to the opener when the lightbox closes.
      opener?.focus();
    };
  }, [isOpen]);

  return (
    <>
      {/* Mockup — keyboard-operable opener */}
      <button
        ref={openerRef}
        type="button"
        aria-haspopup="dialog"
        aria-label={t("clickToEnlarge")}
        className="mt-16 mx-auto block w-full max-w-5xl cursor-pointer group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
        style={{ perspective: "1200px" }}
        onClick={() => setIsOpen(true)}
      >
        <div
          className="rounded-xl shadow-2xl shadow-indigo-500/10 border border-zinc-800 overflow-hidden transition-transform duration-300 group-hover:scale-[1.01]"
          style={{
            transform: "rotateX(2deg)",
            transformOrigin: "bottom center",
          }}
        >
          {/* Mac-style title bar */}
          <div className="flex items-center gap-2 px-4 py-3 bg-zinc-800 border-b border-zinc-700">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <div className="w-3 h-3 rounded-full bg-yellow-500" />
              <div className="w-3 h-3 rounded-full bg-green-500" />
            </div>
            <span className="ml-auto mr-auto text-sm text-zinc-400 font-medium">
              Marblo v3
            </span>
          </div>
          {/* Screenshot */}
          <div className="relative w-full bg-zinc-900">
            <Image
              src="/images/hero-screenshot.png"
              alt="Marblo v3 App Screenshot"
              width={2560}
              height={1440}
              className="w-full h-auto"
              priority
            />
          </div>
        </div>
        <p className="text-center text-zinc-600 text-xs mt-3">
          {t("clickToEnlarge")}
        </p>
      </button>

      {/* Lightbox */}
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Marblo v3 App Screenshot"
          className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="relative max-w-[95vw] max-h-[95vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <Image
              src="/images/hero-screenshot.png"
              alt="Marblo v3 App Screenshot"
              width={2560}
              height={1440}
              className="w-full h-auto rounded-lg"
              quality={95}
            />
            <button
              ref={closeRef}
              type="button"
              aria-label={closeLabel}
              className="absolute -top-3 -right-3 w-8 h-8 bg-zinc-800 border border-zinc-700 rounded-full flex items-center justify-center text-zinc-400 hover:text-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              onClick={() => setIsOpen(false)}
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  );
}
