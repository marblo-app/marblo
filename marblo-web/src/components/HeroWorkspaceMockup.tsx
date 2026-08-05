"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";

const CLOSE_LABEL: Record<string, string> = {
  ko: "닫기",
  ja: "閉じる",
  en: "Close",
};

const MOCKUP_SRC = "/mockups/workspace-board.svg";

export default function HeroWorkspaceMockup() {
  const t = useTranslations("hero");
  const locale = useLocale();
  const closeLabel = CLOSE_LABEL[locale] ?? CLOSE_LABEL.en;
  const [isOpen, setIsOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const opener = openerRef.current;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      opener?.focus();
    };
  }, [isOpen]);

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        aria-haspopup="dialog"
        aria-label={t("clickToEnlarge")}
        className="group mx-auto mt-16 block w-full max-w-5xl cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
        style={{ perspective: "1200px" }}
        onClick={() => setIsOpen(true)}
      >
        <div
          className="overflow-hidden rounded-xl border border-zinc-800 shadow-2xl shadow-indigo-500/10 transition-transform duration-300 group-hover:scale-[1.01]"
          style={{
            transform: "rotateX(2deg)",
            transformOrigin: "bottom center",
          }}
        >
          <Image
            src={MOCKUP_SRC}
            alt=""
            width={1440}
            height={900}
            priority
            unoptimized
            className="block h-auto w-full"
          />
        </div>
        <p className="mt-3 text-center text-xs text-zinc-600">
          {t("clickToEnlarge")}
        </p>
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Marblo workspace"
          className="fixed inset-0 z-[100] flex cursor-pointer items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="relative w-full max-w-[95vw] md:max-w-6xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="overflow-hidden rounded-lg border border-zinc-800">
              <Image
                src={MOCKUP_SRC}
                alt=""
                width={1440}
                height={900}
                unoptimized
                className="block h-auto w-full"
              />
            </div>
            <button
              ref={closeRef}
              type="button"
              aria-label={closeLabel}
              className="absolute -right-3 -top-3 flex h-8 w-8 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800 text-zinc-400 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              onClick={() => setIsOpen(false)}
            >
              <svg
                aria-hidden="true"
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
