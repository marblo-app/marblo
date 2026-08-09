import {
  planOnrampBlockUi,
  type OnrampBlockPlan,
  type OnrampBlockTrigger,
} from "../lib/onrampGate";
import type { OrchestratorNeedsAuth } from "../lib/orchestratorLaunchBlock";
import { useCliSetupStore } from "../stores/cliSetupStore";
import { useOnrampStore } from "../stores/onrampStore";
import telemetry from "./telemetryService";

/**
 * "실행이 막혔다" 를 **한 곳에서** 판정·계측·방송한다 (설계 §5-A).
 *
 * ★왜 호출부마다 분기하지 않고 여기로 모으는가: 스폰 차단을 해석하는 화면이
 * 이미 넷(AgentsTab · LanesTab · OrchestratorPanel · useAgentReconnect)이고
 * 오케 자동기동까지 다섯이다. 그 다섯이 각자 "띄울까 말까" 를 정하면 세션 상한
 * (설계 §5-A: 2회)이 다섯 벌로 갈라져 유저는 열 번을 본다. 사내 규율
 * (`spawn_gates_must_sit_at_spawnnewagent_chokepoint`)이 게이트를 초크포인트에
 * 두라고 한 것과 같은 이유를 화면 쪽에 적용한 것이다.
 *
 * 이 파일은 부수효과 담당이고, **판정 규칙 자체는 순수 모듈**(`lib/onrampGate`)에
 * 있다. 여기서 하는 일은 셋뿐이다: 스토어에서 맥락을 읽고 → 규칙에 물어보고 →
 * 결과를 계측하고 방송한다.
 */

/** 호스트(`OnrampGateHost`)가 듣는 창 이벤트. */
export const ONRAMP_BLOCKED_EVENT = "marblo:onramp-blocked";

export type OnrampBlockedEvent = CustomEvent<OnrampBlockPlan>;

/**
 * 스폰 차단 봉투를 온램프 축으로 보고한다.
 *
 * ★억제된 차단도 **계측은 한다**(설계 §9-A). "몇 번 말을 걸 기회를 스스로
 * 버렸나" 를 모르면 세션 상한을 조일지 풀지 정할 근거가 없다.
 */
export function reportOnrampExecBlocked(
  needsAuth: OrchestratorNeedsAuth,
  trigger: OnrampBlockTrigger,
): OnrampBlockPlan {
  const onramp = useOnrampStore.getState();
  const plan = planOnrampBlockUi(needsAuth, trigger, {
    ready: useCliSetupStore.getState().ready,
    shownThisSession: onramp.blockShownThisSession,
  });

  telemetry.onrampExecBlocked({
    trigger,
    model: plan.model,
    installed: plan.installed,
    shown: plan.show,
    suppressedReason: plan.suppressedReason,
  });

  if (plan.show) {
    onramp.markBlockShown();
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(ONRAMP_BLOCKED_EVENT, { detail: plan }),
      );
    }
  }

  return plan;
}
