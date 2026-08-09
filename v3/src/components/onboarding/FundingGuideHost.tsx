import { useEffect, useRef } from "react";
import {
  onboardingAuthState,
  shouldShowFundingGuide,
} from "../../lib/fundingProbe";
import { useCliSetupStore } from "../../stores/cliSetupStore";
import { useOnboardingSetup } from "../../hooks/useOnboardingSetup";
import telemetry from "../../services/telemetryService";
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

  const visible =
    shouldShowFundingGuide({ state, dismissed }) &&
    // shouldShowFundingGuide 가 true 인 시점의 state 는 두 값 중 하나다.
    (state === "authedButUnfunded" || state === "authedButBlocked");

  // ★스톨 계측(티켓 9dXgBdkGn1LyJokShh1g): 모달이 **실제로 떴다** = 사용자가 눈으로
  // 막힌 순간. 판정(funding_probe)과 따로 세는 이유는 둘이 갈리기 때문이다 —
  // 판정이 unfunded 라도 이미 닫았으면(dismissed) 모달은 안 뜬다. 온램프가 고쳐야
  // 하는 숫자는 "본 사람" 쪽이다.
  //
  // 판정 종류마다 한 번만 남긴다(리렌더·재표시로 부풀지 않게). 모달이 뜰 수 있는
  // 상태는 둘뿐이라 한 세션에서 최대 2건이다.
  const reportedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!visible) return;
    if (reportedRef.current === state) return;
    reportedRef.current = state;
    telemetry.fundingGuideShown(
      state as "authedButUnfunded" | "authedButBlocked",
      setup.funding.outcome?.model,
    );
  }, [visible, state, setup.funding.outcome?.model]);

  if (!visible) return null;
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
