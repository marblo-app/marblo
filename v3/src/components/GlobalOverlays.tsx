import { UpdateBanner } from "./UpdateBanner";
import { MarketingReconsentBanner } from "./legal/MarketingReconsentBanner";
import { PrivacyClarificationNotice } from "./legal/PrivacyClarificationNotice";
import { ProjectSetupBanners } from "./onboarding/ProjectSetupBanners";
import { RepoConnectModal } from "./collaboration/RepoConnectModal";
import { FirstSharedProjectModal } from "./collaboration/FirstSharedProjectModal";
import { FirstProjectSurvey } from "./onboarding/FirstProjectSurvey";
import { FundingGuideHost } from "./onboarding/FundingGuideHost";
import { OnrampGateHost } from "./onboarding/OnrampGateHost";
import { PrivacyConsentGate } from "./legal/PrivacyConsentGate";
import { TrainingConsentCard } from "./legal/TrainingConsentCard";
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
 *
 * ★ The two ONRAMP gates (FundingGuideHost = "signed in but unfunded",
 * OnrampGateHost = "not connected yet, so this can't run") ARE here, for the
 * opposite reason: they are the same guidance in every shell, and the one that
 * used to live inside CliSetupHost was invisible to the legacy Layout shell.
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

      {/* 처리방침 1회성 명확화 고지 — 동의를 받는 배너가 아니라 알리는 배너다
          (익명화 강화 + 사용량 기록 계정연결 고지). 아무것도 저장하지 않고,
          닫으면 이 기기에서 다시 뜨지 않는다. ★심플 셸도 같은 컴포넌트를 직접
          마운트한다(privacyClarificationSurfaceParity 테스트가 지킨다). */}
      <PrivacyClarificationNotice />

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

      {/* ── 온램프 사다리의 두 문(門) (v3/docs/onramp-ladder-design-2026-08-09.md) ──
          ★둘 다 여기 있는 이유는 **모드 파리티**다. 종전에 FundingGuideHost 는
          CliSetupHost 안에 있었는데, 그 호스트는 WorkspaceShell 만 마운트한다 —
          레거시 Layout 셸로 떨어지는 사용자는 "로그인은 됐는데 구독이 없다" 는
          같은 상태에서 아무 안내도 못 받았다(설계 §5-B 의 호스트 갭 N5). 셸이
          갈리는 안내는 셸-불가지 자리에 둔다.

          비기너 셸은 GlobalOverlays 를 마운트하지 않으므로 자기 사본을 따로
          든다(그쪽 CTA 는 원클릭 모달이라 목적지가 다르다). 두 셸이 동시에 뜨는
          일은 없으니 중복 노출은 생기지 않는다. */}
      <FundingGuideHost />
      <OnrampGateHost variant="workspace" />

      {/* PIPA consent — auto-shows on first launch / policy version bump */}
      <PrivacyConsentGate />

      {/* 학습데이터 기여 1회 옵트인 카드(선택). 비차단 코너 카드이고, PIPA 동의가
          끝난 뒤 · 프로젝트를 연결한 뒤에만 뜬다. ★심플 셸(BeginnerShell)은
          GlobalOverlays 를 마운트하지 않으므로 같은 카드를 자기 쪽에서 직접
          마운트한다 — 양쪽 배선은 trainingConsentSurfaceParity 테스트가 지킨다. */}
      <TrainingConsentCard />

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
