import { useTranslation } from "../../lib/i18n";
import type { PromotionTrigger } from "../../lib/beginnerMode";

/**
 * 승격 제안 — "이제 진짜 힘 좀 써볼까요?"
 *
 * 트리거 판정은 `lib/beginnerMode.shouldPromote` 가 하고, 이 모달은 그 결과를
 * 그리기만 한다. 두 버튼 다 **다시는 안 뜨게** 기록한다(`markPromotionShown`):
 * "지금은 그대로" 를 고른 유저를 며칠 뒤 또 붙잡는 건 조르는 것이고, 되돌아가는
 * 문(설정 토글)은 이미 열려 있다.
 */
export function BeginnerPromotionModal({
  trigger,
  completedTasks,
  onPromote,
  onLater,
}: {
  trigger: PromotionTrigger;
  completedTasks: number;
  onPromote: () => void;
  onLater: () => void;
}) {
  const { t } = useTranslation();

  const reason =
    trigger === "merged"
      ? t("beginner.promote.reason.merged")
      : trigger === "days"
        ? t("beginner.promote.reason.days")
        : t("beginner.promote.reason.completed", { count: completedTasks });

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div
        data-testid="beginner-promotion-modal"
        data-trigger={trigger}
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-xl border border-[#45475a] bg-[#181825] p-6 shadow-2xl"
      >
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#a6e3a1]">
          {reason}
        </p>
        <h2 className="mt-2 text-lg font-semibold text-[#cdd6f4]">
          {t("beginner.promote.title")}
        </h2>
        <p className="mt-1.5 text-sm leading-6 text-[#a6adc8]">
          {t("beginner.promote.body")}
        </p>

        <ul className="mt-4 space-y-2">
          {(
            [
              "beginner.promote.point1",
              "beginner.promote.point2",
              "beginner.promote.point3",
            ] as const
          ).map((key) => (
            <li key={key} className="flex gap-2 text-sm text-[#cdd6f4]">
              <span aria-hidden className="text-[#89b4fa]">
                ›
              </span>
              <span>{t(key)}</span>
            </li>
          ))}
        </ul>

        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            data-testid="beginner-promotion-accept"
            onClick={onPromote}
            className="w-full rounded-md bg-[#89b4fa] px-3 py-2.5 text-sm font-semibold text-[#1e1e2e] transition-colors hover:bg-[#74c7ec]"
          >
            {t("beginner.promote.cta")}
          </button>
          <button
            type="button"
            data-testid="beginner-promotion-later"
            onClick={onLater}
            className="w-full rounded-md border border-[#45475a] px-3 py-2 text-sm text-[#cdd6f4] transition-colors hover:bg-[#313244]"
          >
            {t("beginner.promote.later")}
          </button>
        </div>

        <p className="mt-3 text-center text-[11px] text-[#7f849c]">
          {t("beginner.promote.revertHint")}
        </p>
      </div>
    </div>
  );
}
