"use client";

import { useEffect, useCallback, useRef, useId } from "react";
import { useTranslations, useLocale } from "next-intl";
import Image from "next/image";
import { X } from "lucide-react";

const featureImages: Record<string, string> = {
  multiagent: "/images/feature-multiagent.png",
  kanban: "/images/feature-kanban.png",
  flow: "/images/feature-flow.png",
  orchestrator: "/images/feature-orchestrator.png",
  mcp: "/images/feature-mcp.png",
  privacy: "/images/feature-privacy.png",
};

interface FeatureModalProps {
  featureKey: string;
  onClose: () => void;
}

export default function FeatureModal({
  featureKey,
  onClose,
}: FeatureModalProps) {
  const t = useTranslations("features");
  const locale = useLocale();
  const closeLabel =
    locale === "ko" ? "닫기" : locale === "ja" ? "閉じる" : "Close";
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Focus trap: keep Tab focus within the dialog
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, a[href], input, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [onClose]
  );

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
      // Restore focus to the element that opened the modal
      previouslyFocused?.focus?.();
    };
  }, [handleKeyDown]);

  const imageSrc = featureImages[featureKey];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative bg-gray-900 border border-gray-700 rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          className="absolute top-4 right-4 z-10 p-2 rounded-lg bg-gray-800/80 hover:bg-gray-700 transition text-gray-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Screenshot area */}
        <div className="relative w-full aspect-video rounded-t-2xl overflow-hidden bg-zinc-800">
          <ImageOrPlaceholder src={imageSrc} alt={t(`${featureKey}.title`)} />
        </div>

        {/* Content */}
        <div className="p-8">
          <h3 id={titleId} className="text-2xl font-bold mb-2">
            {t(`${featureKey}.title`)}
          </h3>
          <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-indigo-600/20 text-indigo-400 mb-4">
            {t(`${featureKey}.highlight`)}
          </span>
          <p className="text-gray-300 leading-relaxed whitespace-pre-line">
            {t(`${featureKey}.detail`)}
          </p>
        </div>
      </div>
    </div>
  );
}

function ImageOrPlaceholder({ src, alt }: { src: string; alt: string }) {
  return (
    <>
      <div className="absolute inset-0 flex items-center justify-center bg-zinc-800">
        <span className="text-gray-500 text-sm">Screenshot</span>
      </div>
      <Image
        src={src}
        alt={alt}
        fill
        className="object-cover relative z-[1]"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
    </>
  );
}
