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
 * 비기너 대화창의 "보내기" 상태 하나 — 컴포저(BeginnerChatBar)와 막힘 안내의
 * 다시 보내기(BeginnerLiveStrip)가 **같은 전송**을 공유해야 해서 훅으로 뺐다.
 * 두 표면이 각자 상태를 들면 "다시 보내기" 가 마지막 문장을 모른다.
 *
 * ★중복 전송 가드(활성화 진단 §7 P1-2 ①)의 **형태가 바뀌었다.**
 *
 * 예전에는 한 번 `delivered` 되면 입력칸째 사라졌다(일회성 첫 요청). 그 잠금이
 * 8/4 유저의 "같은 프롬프트 14초 간격 3연타" 를 막긴 했지만, 대신 첫 질문 뒤에
 * 유저가 오케에게 **이어서 말할 곳**을 없앴다. 시연에서 사장님이 짚은 자리가
 * 정확히 그것이다 — 상단은 대화창이어야 한다.
 *
 * 그래서 잠금을 걷고 가드를 여기로 옮긴다: **같은 문장**을 짧은 간격
 * (`BEGINNER_DUP_WINDOW_MS`)으로 다시 보내면 주입하지 않는다. 막으려던 건
 * "대화" 가 아니라 "같은 지시의 반복 주입" 이었으므로, 다른 문장은 몇 번이든
 * 통과한다.
 *
 * 가드의 기준시각은 **실제 전달된** 순간만이다: 실패한 전송은 오케가 받은 적이
 * 없으니 같은 문장으로 곧바로 재시도할 수 있어야 한다.
 *
 * 전달 결과 3값(delivered/queued/failed) 해석은 `lib/firstTicketDelivery` 를 그대로
 * 재사용한다: 큐잉을 성공으로 접지 않는 규칙(F3)이 비기너에도 동일하게 적용되고,
 * 계측 어휘도 같아 기존 온보딩 퍼널과 한 축에서 조인된다.
 */

/** 같은 문장을 다시 보내도 주입하지 않는 창(ms). */
export const BEGINNER_DUP_WINDOW_MS = 30_000;

export interface BeginnerAsk {
  sending: boolean;
  delivery: FirstTicketDelivery | null;
  /**
   * 첫 전달이 성립했는가. 이제 입력을 **잠그지 않고** 안내문(제목·예시 칩)을
   * 접는 데만 쓴다 — "무엇을 쳐야 하나" 는 처음 한 번만 필요한 안내다.
   */
  locked: boolean;
  /** 오케가 실제로 받은 마지막 시각(ms). 0 = 아직. 라이브 스트립의 기준시각. */
  deliveredAt: number;
  /** 실제로 전달된 횟수. 2 이상 = 유저가 첫 질문 뒤에도 대화를 이어갔다. */
  sentCount: number;
  /** 직전과 같은 문장을 너무 빨리 다시 보내려다 막혔는가(안내 한 줄용). */
  duplicateBlocked: boolean;
  send: (message: string) => Promise<void>;
  /** 마지막으로 보낸 문장을 그대로 다시 보낸다(막힘 안내의 CTA — 가드 우회). */
  resend: () => Promise<void>;
  /** 하단 오케 PTY 에 사용자가 직접 제출한 턴을 라이브 스트립 기준시각으로 기록한다. */
  markTerminalSubmit: (message: string) => void;
}

export function useBeginnerAsk(): BeginnerAsk {
  const projectId = useProjectStore((s) => s.currentProject?.id ?? "");
  const [sending, setSending] = useState(false);
  const [delivery, setDelivery] = useState<FirstTicketDelivery | null>(null);
  const [deliveredAt, setDeliveredAt] = useState(0);
  const [sentCount, setSentCount] = useState(0);
  const [duplicateBlocked, setDuplicateBlocked] = useState(false);
  const lastMessageRef = useRef("");
  /** 마지막으로 **전달에 성공한** 문장과 그 시각 — 중복 가드의 유일한 기준. */
  const lastDeliveredRef = useRef({ message: "", at: 0 });
  // in-flight 가드는 ref 로 — setState 는 비동기라 빠른 연타 두 번이 같은
  // `sending === false` 를 읽고 둘 다 통과할 수 있다.
  const inFlightRef = useRef(false);

  const deliver = useCallback(
    async (message: string, force = false) => {
      if (!message || !projectId || inFlightRef.current) return;
      if (
        !force &&
        message === lastDeliveredRef.current.message &&
        Date.now() - lastDeliveredRef.current.at < BEGINNER_DUP_WINDOW_MS
      ) {
        setDuplicateBlocked(true);
        return;
      }
      setDuplicateBlocked(false);
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
      if (view.completesStep) {
        const at = Date.now();
        setDeliveredAt(at);
        setSentCount((n) => n + 1);
        lastDeliveredRef.current = { message, at };
      }
      setSending(false);
      inFlightRef.current = false;
    },
    [projectId],
  );

  const send = useCallback(
    async (message: string) => deliver(message.trim()),
    [deliver],
  );

  // 막힘 안내의 "다시 보내기" 는 **의도된** 재주입이라 가드를 지나간다.
  const resend = useCallback(
    async () => deliver(lastMessageRef.current, true),
    [deliver],
  );

  const markTerminalSubmit = useCallback((message: string) => {
    const trimmed = message.trim();
    if (!trimmed) return;
    const at = Date.now();
    lastMessageRef.current = trimmed;
    lastDeliveredRef.current = { message: trimmed, at };
    setDuplicateBlocked(false);
    setDelivery("delivered");
    setDeliveredAt(at);
    setSentCount((n) => n + 1);
  }, []);

  return {
    sending,
    delivery,
    locked: sentCount > 0,
    deliveredAt,
    sentCount,
    duplicateBlocked,
    send,
    resend,
    markTerminalSubmit,
  };
}
