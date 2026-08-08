import { useTranslation } from "../../lib/i18n";
import { useOnboardingPreviewStore } from "../../stores/onboardingPreviewStore";

/**
 * 프리뷰가 켜져 있는 동안 **항상** 서 있는 개발용 띠.
 *
 * 두 가지 일을 한다:
 *  ① 지금 보이는 화면이 시뮬이라는 사실을 화면에서 못 숨기게 한다. 프리뷰 플래그는
 *    persist 되므로(재시작을 넘겨 살아남는다), 이 띠가 없으면 "왜 내 워크스페이스가
 *    사라졌지" 가 된다. 여기 있는 [종료] 가 그 자리에서의 탈출구다.
 *  ② 시연 조작 — [처음부터] 로 흐름을 되감고, [다음 단계] 로 대기 시간을 건너뛴다.
 *    이 조작을 모달/게이트 **안**에 넣지 않은 것이 중요하다: 그 화면들은 신규
 *    유저가 보는 것과 픽셀 단위로 같아야 시연이 성립한다.
 */
export function OnboardingPreviewBanner() {
  const { t } = useTranslation();
  const enabled = useOnboardingPreviewStore((s) => s.enabled);
  const stage = useOnboardingPreviewStore((s) => s.stage);
  const restart = useOnboardingPreviewStore((s) => s.restart);
  const advance = useOnboardingPreviewStore((s) => s.advance);
  const setEnabled = useOnboardingPreviewStore((s) => s.setEnabled);

  if (!enabled) return null;

  const btn =
    "rounded border border-[#f9e2af]/40 px-2 py-0.5 text-[11px] font-medium text-[#f9e2af] transition-colors hover:bg-[#f9e2af]/15";

  return (
    <div
      data-testid="onboarding-preview-banner"
      data-stage={stage}
      className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-[#f9e2af]/30 bg-[#f9e2af]/10 px-4 py-1.5"
    >
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#f9e2af]">
        {t("beginner.preview.badge")}
      </span>
      <span className="min-w-0 truncate text-[11px] text-[#f9e2af]/90">
        {t("beginner.preview.bannerBody")}
      </span>
      <span
        data-testid="onboarding-preview-stage"
        className="rounded bg-[#f9e2af]/15 px-1.5 py-0.5 font-mono text-[10px] text-[#f9e2af]"
      >
        {stage}
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          data-testid="onboarding-preview-restart"
          onClick={restart}
          className={btn}
        >
          {t("beginner.preview.restart")}
        </button>
        <button
          type="button"
          data-testid="onboarding-preview-advance"
          onClick={advance}
          disabled={stage === "done"}
          className={`${btn} disabled:cursor-not-allowed disabled:opacity-40`}
        >
          {t("beginner.preview.advance")}
        </button>
        <button
          type="button"
          data-testid="onboarding-preview-exit"
          onClick={() => setEnabled(false)}
          className={btn}
        >
          {t("beginner.preview.exit")}
        </button>
      </div>
    </div>
  );
}
