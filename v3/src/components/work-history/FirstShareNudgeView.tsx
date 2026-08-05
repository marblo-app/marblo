import type { TFunction } from "../../lib/i18n";
import type { Mission } from "../../types/mission";
import type { FirstShareNudgeSurface } from "../../stores/firstMissionShareNudge";

const SHARE_COPY: Record<
  FirstShareNudgeSurface,
  {
    message: string;
    cta: string;
    dismiss: string;
  }
> = {
  mission: {
    message: "",
    cta: "",
    dismiss: "",
  },
  board: {
    message:
      "Board, completion history, and activity are shareable. Code stays local and moves through git.",
    cta: "Open project",
    dismiss: "Dismiss",
  },
  project: {
    message:
      "Invite teammates when the project is ready. They receive board, completion history, and activity context first.",
    cta: "Review sharing",
    dismiss: "Dismiss",
  },
};

export interface FirstMissionShareNudgeViewProps {
  /** 보여줄 첫 미션. `null` 이면 아무것도 그리지 않는다. */
  mission: Mission | null;
  surface?: FirstShareNudgeSurface;
  onOpenReplay?: (missionId: string) => void;
  onDismiss: () => void;
  t: TFunction;
}

/** 상태 → 화면. 구독/localStorage 를 모른다(테스트가 이 함수만 호출한다). */
export function FirstMissionShareNudgeView({
  mission,
  surface = "mission",
  onOpenReplay,
  onDismiss,
  t,
}: FirstMissionShareNudgeViewProps) {
  if (surface === "mission" && !mission) return null;

  const copy = surface === "mission" ? null : SHARE_COPY[surface];
  const message = copy?.message ?? t("workHistory.firstMissionNudge.message");
  const cta = copy?.cta ?? t("workHistory.firstMissionNudge.cta");
  const dismissLabel =
    copy?.dismiss ?? t("workHistory.firstMissionNudge.dismiss");

  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2"
    >
      <span aria-hidden className="text-base">
        🎉
      </span>
      <p className="min-w-0 flex-1 text-xs text-violet-100">{message}</p>
      <button
        type="button"
        onClick={() => {
          if (surface === "mission" && mission) {
            onOpenReplay?.(mission.id);
            return;
          }
          onDismiss();
        }}
        className="flex-shrink-0 rounded border border-violet-400/60 px-2 py-1 text-xs font-medium text-violet-200 transition hover:bg-violet-500/20"
      >
        {cta}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={dismissLabel}
        className="flex-shrink-0 text-violet-300/70 transition hover:text-violet-100"
      >
        ×
      </button>
    </div>
  );
}
