import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";
import type { WizardStep } from "../../lib/cliSetupGate";
import { shouldRevealOrchestrator } from "../../lib/oneClickSetup";
import { useCliSetupStore } from "../../stores/cliSetupStore";
import { useProjectStore } from "../../stores/projectStore";
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

  // ★설치+인증이 끝나면 오케스트레이터를 실제로 **보여준다**.
  //
  // `marblo:cli-auth-ready` 는 이미 useOrchestratorAutoLaunch 의 재개 신호다
  // (오케 프로세스는 그쪽이 띄운다). 빠져 있던 건 화면이었다: 방금 인증을 끝낸
  // 사용자는 여전히 체크리스트 탭에 서 있고, 터미널 열은 접혀 있을 수 있어
  // "다 했는데 아무 일도 안 일어난다" 로 읽혔다. 여기서 터미널 열을 펴고 작업
  // 뷰를 보드로 옮겨, 방금 뜬 오케가 눈에 들어오게 한다.
  //
  // ★이 이벤트는 **이미 인증된 사용자의 콜드 스타트에서도** 뜬다(probe 가
  // false 에서 시작해 true 로 뒤집히는 같은 엣지 — bRABKQX7/nB4eenxP 의 원인).
  // 그래서 shouldRevealOrchestrator 가 "이 세션에서 우리 원클릭 버튼을 눌렀나"
  // (setupInitiated)를 요구한다: 매 재시작마다 사용자의 탭/접힘 상태를 앱이
  // 마음대로 되돌리는 일은 없다.
  useEffect(() => {
    const onReady = () => {
      const decision = shouldRevealOrchestrator({
        ready: useCliSetupStore.getState().ready,
        hasProject: !!useProjectStore.getState().currentProject?.folderPath,
        setupInitiated: useCliSetupStore.getState().setupInitiated,
      });
      if (!decision) return;
      const split = useSplitWorkspaceStore.getState();
      split.setTerminalCollapsed(false);
      if (split.activeTab === "startHere") split.setActiveTab("board");
      setNeedStep(null);
    };
    window.addEventListener("marblo:cli-auth-ready", onReady);
    return () => window.removeEventListener("marblo:cli-auth-ready", onReady);
  }, []);

  // Already standing in the tab → the banner would be redundant noise.
  //
  // ★자금 안내(FundingGuideHost)는 더 이상 여기 있지 않다 — `GlobalOverlays` 로
  // 올라갔다. 이 호스트를 마운트하는 셸은 WorkspaceShell 하나뿐이라, 여기 두면
  // 레거시 Layout 셸 사용자는 "로그인은 됐는데 구독이 없다" 는 같은 상태에서
  // 아무 안내도 못 받는다(온램프 설계 #886 §5-B 의 호스트 갭). 안내가 다루는
  // 국면이 이 배너(=설정이 덜 됐다)와 다르다는 종전 판단은 그대로 유효하고,
  // 그래서 배너의 유무와 무관하게 서 있어야 한다는 결론도 같다.
  if (!needStep || activeTab === "startHere") return null;

  return (
    <>
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
    </>
  );
}
