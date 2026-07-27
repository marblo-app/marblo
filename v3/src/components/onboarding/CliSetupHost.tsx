import { useCallback, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";
import type { WizardStep } from "../../lib/cliSetupGate";
import { useSplitWorkspaceStore } from "../../stores/splitWorkspaceStore";
import { useOnboardingProgressStore } from "../../stores/onboardingProgressStore";
import { useCliSetupEngine } from "../../hooks/useCliSetupEngine";

/**
 * The split shell's replacement for the CLI setup MODAL.
 *
 * Two jobs:
 *  1. Run the CLI setup engine exactly once per window (probe, background
 *     auto-install, sign-in auto-recheck, `marblo:cli-auth-ready`). The Start
 *     Here tab is lazily mounted, so the engine cannot live there — this host
 *     is always mounted by WorkspaceShell.
 *  2. Turn every "setup is needed" request into a NON-blocking inline banner
 *     that deep-links to the 시작하기 tab, instead of an overlay that steals
 *     the screen. `marblo:open-cli-setup` (dispatched by the spawn guard, the
 *     orchestrator auto-launch, AgentsTab, and the agent:needsAuth backstop)
 *     therefore now means "point the user at the tab", not "open a modal".
 *
 * We deliberately do NOT force-switch tabs here: the user may be mid-work in
 * Code or Board, and yanking them away is exactly the modal behavior we're
 * removing. The banner is the deep link; clicking it is the user's choice.
 *
 * ★ The ✕ has to PERSIST that choice. It used to only clear local state, so a
 * signed-in user with no folder yet saw the banner again on every single
 * restart — the post-auth branch re-fires on each cold start and nothing
 * remembered the dismissal (activation barrier F2). It now writes the one
 * dismissal record (`onboardingProgress.dismissed`), which is also what the
 * Start Here tab's "앱을 켤 때 이 탭으로 시작하지 않기" toggle reads and writes,
 * so the user can turn the guidance back on from one obvious place.
 */
export function CliSetupHost() {
  const { t } = useTranslation();
  const [needStep, setNeedStep] = useState<WizardStep | null>(null);
  const setActiveTab = useSplitWorkspaceStore((s) => s.setActiveTab);
  const activeTab = useSplitWorkspaceStore((s) => s.activeTab);
  const setDismissed = useOnboardingProgressStore((s) => s.setDismissed);

  const openAt = useCallback((step: WizardStep) => setNeedStep(step), []);
  /**
   * Setup stopped being needed on its own (auth completed mid-session). NOT a
   * user decision, so it must not record a dismissal — only the ✕ does that.
   */
  const close = useCallback(() => setNeedStep(null), []);
  const dismiss = useCallback(() => {
    setNeedStep(null);
    setDismissed(true);
  }, [setDismissed]);

  useCliSetupEngine({ openAt, close, showPostAuth: openAt });

  // Already standing in the tab → the banner would be redundant noise.
  if (!needStep || activeTab === "startHere") return null;

  return (
    <div
      data-testid="cli-setup-banner"
      className="flex items-center gap-3 border-b border-[#f9e2af]/30 bg-[#f9e2af]/10 px-4 py-2"
    >
      <span className="text-sm">⚠️</span>
      <span className="min-w-0 flex-1 truncate text-xs text-[#f9e2af]">
        {/* Title follows the step the banner is actually about — a fixed
            "CLI 인증이 필요합니다" contradicted the body for every step but
            auth (barrier F2). */}
        <span data-testid="cli-setup-banner-title">
          {t(`onboarding.startHere.banner.title.${needStep}` as MessageKey)}
        </span>
        <span className="ml-2 text-[#a6adc8]">
          {t(`onboarding.startHere.why.${needStep}` as MessageKey)}
        </span>
      </span>
      <button
        type="button"
        onClick={() => {
          setActiveTab("startHere");
          setNeedStep(null);
        }}
        className="shrink-0 rounded-md bg-[#f9e2af] px-2.5 py-1 text-xs font-semibold text-[#1e1e2e] transition-colors hover:bg-[#f5e0a3]"
      >
        {t("onboarding.startHere.banner.cta")}
      </button>
      <button
        type="button"
        data-testid="cli-setup-banner-dismiss"
        onClick={dismiss}
        aria-label={t("onboarding.startHere.banner.dismiss")}
        title={t("onboarding.startHere.banner.dismiss")}
        className="shrink-0 rounded px-1.5 py-1 text-xs text-[#a6adc8] transition-colors hover:text-[#cdd6f4]"
      >
        ✕
      </button>
    </div>
  );
}
