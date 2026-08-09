import { useCallback, useEffect, useState } from "react";
import {
  onboardingAuthState,
  shouldShowFundingGuide,
} from "../../lib/fundingProbe";
import type { OnrampBlockPlan } from "../../lib/onrampGate";
import { ONRAMP_BLOCKED_EVENT } from "../../services/onrampBlockSignal";
import { useCliSetupStore } from "../../stores/cliSetupStore";
import { useSplitWorkspaceStore } from "../../stores/splitWorkspaceStore";
import { useOnboardingSetup } from "../../hooks/useOnboardingSetup";
import { OnrampBlockModal } from "./OnrampBlockModal";

/**
 * M1 모달을 **띄우는 자리** (설계 §5-A).
 *
 * `FundingGuideHost` 와 같은 형태이고 같은 이유다: 인증이 성립하는 순간 연결
 * 게이트가 통째로 갈아치워지므로, 모달을 게이트 안에 두면 뜨자마자 언마운트된다.
 * 호스트는 셸이 살아 있는 한 계속 서 있는다.
 *
 * ★두 모달의 **배타**가 이 파일의 핵심 규율이다. M1("계정을 연결하세요")과
 * M2(`SubscriptionNeededModal` — "연결은 됐는데 구독이 없어요")는 사용자에게
 * 서로 다른 지시를 준다. 겹쳐 뜨면 Esc 한 번이 어느 쪽을 닫는지도 모르는 데다,
 * 무엇보다 **이미 연결한 사람에게 연결하라고 말하게 된다.**
 * 규칙 자체는 `lib/onrampGate.planOnrampBlockUi` 가 `ready === true` 에서
 * 억제하는 것으로 이미 막지만, 판정과 렌더 사이에 인증이 성립하는 찰나가 있어
 * 여기서 한 번 더 확인한다(방어적 이중 가드).
 */

export interface OnrampGateHostProps {
  /**
   * 어느 셸인가. 문구가 아니라 **CTA 의 목적지**가 갈린다:
   *  - beginner: 원클릭 모달(셸이 든다)을 연다. 비기너에는 설정 탭도 BYOM 표면도
   *    없으므로 "다른 방법 보기" 는 그리지 않는다(설계 §6-B).
   *  - workspace: 기존 `marblo:open-cli-setup` 이벤트(배너 + 시작하기 탭). BYOM 은
   *    그 탭의 `ByomStartSection` 이라 "다른 방법 보기" 가 갈 곳이 있다.
   */
  variant: "beginner" | "workspace";
  /** beginner 전용 — 원클릭 모달 열기. */
  onConnect?: () => void;
}

export function OnrampGateHost({ variant, onConnect }: OnrampGateHostProps) {
  const [plan, setPlan] = useState<OnrampBlockPlan | null>(null);
  const setup = useOnboardingSetup();
  const dismissedFunding = useCliSetupStore((s) => s.fundingGuideDismissed);
  const setActiveTab = useSplitWorkspaceStore((s) => s.setActiveTab);

  useEffect(() => {
    const onBlocked = (event: Event) => {
      const detail = (event as CustomEvent<OnrampBlockPlan>).detail;
      if (detail?.show) setPlan(detail);
    };
    window.addEventListener(ONRAMP_BLOCKED_EVENT, onBlocked);
    return () => window.removeEventListener(ONRAMP_BLOCKED_EVENT, onBlocked);
  }, []);

  // 인증이 성립하면 이 모달의 전제가 사라진다 — 스스로 닫는다. 유저가 다른
  // 창에서 로그인을 끝냈을 때 낡은 안내가 남아 있지 않게.
  useEffect(() => {
    if (setup.ready) setPlan(null);
  }, [setup.ready]);

  const close = useCallback(() => setPlan(null), []);

  const connect = useCallback(() => {
    setPlan(null);
    if (variant === "beginner") {
      onConnect?.();
      return;
    }
    window.dispatchEvent(new CustomEvent("marblo:open-cli-setup"));
  }, [variant, onConnect]);

  // "다른 방법 보기" = BYOK. 어드밴스드의 시작하기 탭에만 그 표면이 있다.
  const alternatives = useCallback(() => {
    setPlan(null);
    setActiveTab("startHere");
  }, [setActiveTab]);

  if (!plan) return null;
  // 이미 연결된 사람에게는 절대 그리지 않는다.
  if (setup.ready) return null;
  // M2(자금 안내)가 뜰 상태라면 그쪽이 이긴다 — 더 나중 국면의 안내다.
  const fundingState = onboardingAuthState({
    ready: setup.ready,
    funding: setup.funding,
  });
  if (
    shouldShowFundingGuide({
      state: fundingState,
      dismissed: dismissedFunding,
    })
  ) {
    return null;
  }

  return (
    <OnrampBlockModal
      plan={plan}
      onConnect={connect}
      onAlternatives={variant === "workspace" ? alternatives : undefined}
      onClose={close}
    />
  );
}
