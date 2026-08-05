import { UpdateBanner } from "./UpdateBanner";
import { MarketingReconsentBanner } from "./legal/MarketingReconsentBanner";
import { ProjectSetupBanners } from "./onboarding/ProjectSetupBanners";
import { RepoConnectModal } from "./collaboration/RepoConnectModal";
import { FirstSharedProjectModal } from "./collaboration/FirstSharedProjectModal";
import { FirstProjectSurvey } from "./onboarding/FirstProjectSurvey";
import { PrivacyConsentGate } from "./legal/PrivacyConsentGate";
import { ChatToastHost } from "./chat/ChatToastHost";
import { BugReportNoticeToast } from "./chat/BugReportNoticeToast";
import { UpgradeModal } from "./settings/UpgradeModal";
import { useUiStore } from "../stores/uiStore";
import type { ProjectSetup } from "../hooks/useProjectSetup";

export interface GlobalOverlaysProps {
  /** Passed straight to ProjectSetupBanners — each shell owns its own
   * useProjectSetup() (or useAppLifecycle()) call, so the hook state has to
   * come in as a prop rather than being called again in here. */
  projectSetup: ProjectSetup;
}

/**
 * Shell-agnostic global overlays — every banner/modal/toast that Layout and
 * WorkspaceShell must BOTH mount, in one place, so adding a new one here
 * automatically reaches both shells (ticket djYMmyNksWmjdiWhQN8j).
 *
 * Split into two groups by CSS positioning, not by kind:
 *  - In-flow banners (UpdateBanner / MarketingReconsentBanner /
 *    ProjectSetupBanners) render inside normal document flow, so this
 *    component must be mounted right after <Header/> and before the body —
 *    same slot Layout always used for them.
 *  - Fixed-position modals/toasts (RepoConnectModal, FirstProjectSurvey,
 *    PrivacyConsentGate, ChatToastHost, BugReportNoticeToast, UpgradeModal)
 *    use `position: fixed`, so their place in the DOM doesn't affect where
 *    they paint — safe to bundle alongside the banners here.
 *
 * ★ CliSetupGate (Layout) / CliSetupHost (WorkspaceShell) are deliberately
 * NOT here — they are two different onboarding surfaces by design (modal vs.
 * non-blocking banner + tab, see CliSetupHost's own doc comment), not a
 * drifted duplicate. Each shell keeps mounting its own.
 */
export function GlobalOverlays({ projectSetup }: GlobalOverlaysProps) {
  const upgradeModal = useUiStore((s) => s.upgradeModal);
  const hideUpgrade = useUiStore((s) => s.hideUpgrade);

  return (
    <>
      {/* Auto-update banner — silent when no update; sticky when one is
          available / downloading / downloaded. */}
      <UpdateBanner />

      {/* 기존 파운더 재동의 배너 — 마케팅 동의가 아직 unknown 인 파운더에게만
          뜨는 얇은 opt-in 줄. */}
      <MarketingReconsentBanner />

      {/* Project-setup prompts (register-or-browse choice, name-your-project). */}
      <ProjectSetupBanners {...projectSetup} />

      {/* 팀 멤버 저장소 연결 — 초대 수락한 멤버가 rootPath 미연결 프로젝트에
          진입하면 Clone & 연결 원클릭 모달. 이미 연결된 멤버에겐 렌더되지
          않는다(픽셀 불변). */}
      <RepoConnectModal />

      {/* 공유받는 멤버의 첫 프로젝트 진입 맥락 — 공유 범위와 로컬 코드 원칙. */}
      <FirstSharedProjectModal />

      {/* First project completion micro-survey */}
      <FirstProjectSurvey />

      {/* PIPA consent — auto-shows on first launch / policy version bump */}
      <PrivacyConsentGate />

      {/* Global team-chat listener and transient top notification. */}
      <ChatToastHost />

      {/* One-time first-run beta notice. */}
      <BugReportNoticeToast />

      {/* Global plan-limit upgrade modal — triggered from anywhere (agent /
          project limits) via uiStore.showUpgrade. Its CTA routes to
          Settings → Billing. */}
      {upgradeModal && (
        <UpgradeModal
          feature={upgradeModal.feature}
          requiredPlan={upgradeModal.requiredPlan}
          onClose={hideUpgrade}
        />
      )}
    </>
  );
}
