import { X } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "../../lib/i18n";

export const ORCHESTRATION_DEMO_SECONDS = 90;
export const ORCHESTRATION_DEMO_VIDEO_SRC = "/media/orchestration-demo.mp4";
export const ORCHESTRATION_DEMO_POSTER_SRC =
  "/media/orchestration-demo-poster.jpg";

export interface VideoDemoModalProps {
  surface: "start_here_tab" | "beginner_connect";
  onClose: () => void;
}

export function VideoDemoModal({ surface, onClose }: VideoDemoModalProps) {
  const { t } = useTranslation();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      data-testid="orchestration-video-demo-modal"
      data-surface={surface}
      className="fixed inset-0 z-[90] flex items-center justify-center bg-[#11111b]/85 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t("onboarding.videoDemo.title")}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="w-full max-w-5xl overflow-hidden rounded-lg border border-[#45475a] bg-[#181825] shadow-2xl shadow-black/40">
        <div className="flex items-center justify-between gap-3 border-b border-[#313244] px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#89b4fa]">
              {t("onboarding.videoDemo.kicker", {
                seconds: ORCHESTRATION_DEMO_SECONDS,
              })}
            </p>
            <h2 className="mt-1 truncate text-base font-semibold text-[#cdd6f4]">
              {t("onboarding.videoDemo.title")}
            </h2>
          </div>
          <button
            type="button"
            data-testid="orchestration-video-demo-close"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#45475a] text-[#a6adc8] transition-colors hover:bg-[#313244] hover:text-[#cdd6f4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#89b4fa]"
            aria-label={t("common.close")}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="bg-black">
          <video
            data-testid="orchestration-video-demo-player"
            className="aspect-video h-full w-full object-contain"
            src={ORCHESTRATION_DEMO_VIDEO_SRC}
            poster={ORCHESTRATION_DEMO_POSTER_SRC}
            controls
            autoPlay
            playsInline
            preload="metadata"
          />
        </div>
      </section>
    </div>
  );
}
