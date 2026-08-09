import {
  onboardingAuthState,
  shouldShowFundingGuide,
} from "../../lib/fundingProbe";
import { useCliSetupStore } from "../../stores/cliSetupStore";
import { useOnboardingSetup } from "../../hooks/useOnboardingSetup";
import { SubscriptionNeededModal } from "../beginner/SubscriptionNeededModal";

/**
 * "구독이 필요해요" 가이드 모달을 **띄울지 말지**만 판정하는 자리
 * (티켓 sVdwTsiGq6qZVAmSkwZB).
 *
 * 모달을 셸이 아니라 이 호스트가 드는 이유는 원클릭 모달과 같다: 인증이 성립하는
 * 순간 연결 게이트가 통째로 갈아치워지므로, 게이트 안에 두면 안내가 뜨자마자
 * 언마운트된다. 여기는 셸이 살아 있는 한 계속 서 있다.
 *
 * 두 셸이 같은 컴포넌트를 마운트한다(비기너 셸 / 워크스페이스 셸의 CliSetupHost).
 * 한쪽에만 달면 그 셸을 쓰는 사용자만 조용히 막히는데, 그 사각이 정확히 이
 * 티켓이 없애려는 것이다. 두 셸이 동시에 뜨는 일은 없다(workspaceMode 토글).
 */
export function FundingGuideHost() {
  const setup = useOnboardingSetup();
  const dismissed = useCliSetupStore((s) => s.fundingGuideDismissed);
  const dismiss = useCliSetupStore((s) => s.dismissFundingGuide);

  const state = onboardingAuthState({
    ready: setup.ready,
    funding: setup.funding,
  });

  if (!shouldShowFundingGuide({ state, dismissed })) return null;
  // shouldShowFundingGuide 가 true 인 시점의 state 는 두 값 중 하나다.
  if (state !== "authedButUnfunded" && state !== "authedButBlocked")
    return null;

  return (
    <SubscriptionNeededModal
      state={state}
      outcome={setup.funding.outcome}
      checking={setup.funding.checking}
      onRecheck={setup.recheckFunding}
      onClose={dismiss}
    />
  );
}
