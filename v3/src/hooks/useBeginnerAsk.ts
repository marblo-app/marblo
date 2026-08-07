import { useCallback, useRef, useState } from "react";
import {
  deliveryFromRoute,
  firstTicketView,
  type FirstTicketDelivery,
} from "../lib/firstTicketDelivery";
import { routeInstructionToOrchestrator } from "../services/orchestratorInstructionService";
import { useProjectStore } from "../stores/projectStore";
import telemetry from "../services/telemetryService";

/**
 * 비기너 챗의 "요청 보내기" 상태 하나 — 입력칸(BeginnerFirstAsk)과 막힘 안내의
 * 다시 보내기(BeginnerLiveStrip)가 **같은 전송**을 공유해야 해서 훅으로 뺐다.
 * 두 표면이 각자 상태를 들면 "다시 보내기" 가 마지막 문장을 모른다.
 *
 * ★중복 전송 가드(활성화 진단 §7 P1-2 ①): 한 번 `delivered` 되면 `locked` 가 서고
 * 폼이 잠긴다. 재전송은 **명시적** `resend()` 로만 — 8/4 유저가 14초 간격으로 같은
 * 프롬프트를 3번 주입한 그 지문의 직접 수리다.
 *
 * 전달 결과 3값(delivered/queued/failed) 해석은 `lib/firstTicketDelivery` 를 그대로
 * 재사용한다: 큐잉을 성공으로 접지 않는 규칙(F3)이 비기너에도 동일하게 적용되고,
 * 계측 어휘도 같아 기존 온보딩 퍼널과 한 축에서 조인된다.
 */
export interface BeginnerAsk {
  sending: boolean;
  delivery: FirstTicketDelivery | null;
  /** 전달 성공 후 폼을 잠갔는가. */
  locked: boolean;
  /** 오케가 실제로 받은 마지막 시각(ms). 0 = 아직. 라이브 스트립의 기준시각. */
  deliveredAt: number;
  send: (message: string) => Promise<void>;
  /** 마지막으로 보낸 문장을 그대로 다시 보낸다(막힘 안내의 CTA). */
  resend: () => Promise<void>;
}

export function useBeginnerAsk(): BeginnerAsk {
  const projectId = useProjectStore((s) => s.currentProject?.id ?? "");
  const [sending, setSending] = useState(false);
  const [delivery, setDelivery] = useState<FirstTicketDelivery | null>(null);
  const [deliveredAt, setDeliveredAt] = useState(0);
  const lastMessageRef = useRef("");
  // in-flight 가드는 ref 로 — setState 는 비동기라 빠른 연타 두 번이 같은
  // `sending === false` 를 읽고 둘 다 통과할 수 있다.
  const inFlightRef = useRef(false);

  const deliver = useCallback(
    async (message: string) => {
      if (!message || !projectId || inFlightRef.current) return;
      inFlightRef.current = true;
      lastMessageRef.current = message;
      setSending(true);
      let result: FirstTicketDelivery = "failed";
      try {
        result = deliveryFromRoute(
          await routeInstructionToOrchestrator({ projectId, message }),
        );
      } catch {
        result = "failed";
      }
      const view = firstTicketView(result);
      telemetry.cliSetupStep(
        "firstTicket",
        view.telemetry.phase,
        view.telemetry.reason,
      );
      setDelivery(result);
      // ★`completesStep` 일 때만 시각을 갱신한다. queued 는 오케가 받은 적이 없어
      // 진행 스트립의 기준시각이 될 수 없다(그걸로 시작하면 90초 뒤 "막혔어요" 가
      // 뜨는데, 정작 막힌 건 전송이 아니라 오케 부재다).
      if (view.completesStep) setDeliveredAt(Date.now());
      setSending(false);
      inFlightRef.current = false;
    },
    [projectId],
  );

  const send = useCallback(
    async (message: string) => deliver(message.trim()),
    [deliver],
  );

  const resend = useCallback(
    async () => deliver(lastMessageRef.current),
    [deliver],
  );

  return {
    sending,
    delivery,
    locked: delivery === "delivered",
    deliveredAt,
    send,
    resend,
  };
}
