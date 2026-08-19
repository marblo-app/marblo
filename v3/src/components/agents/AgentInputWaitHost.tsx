import { useCallback, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "../../lib/i18n";
import { useAgentFocusStore } from "../../stores/agentFocusStore";
import { useAgentNotificationSettingsStore } from "../../stores/agentNotificationSettingsStore";
import { useAgentStore } from "../../stores/agentStore";
import { useNavigationStore } from "../../stores/navigationStore";
import { useProjectStore } from "../../stores/projectStore";
import {
  selectWaitingAgents,
  useAgentAttentionStore,
  type AgentInputWait,
} from "../../stores/agentAttentionStore";

/**
 * 우상단 "에이전트가 입력을 기다립니다" 알림.
 *
 * 왜 이게 있어야 하는가: 심플 모드에는 터미널이 **화면에 없다**. 그래서 에이전트가
 * 프롬프트 앞에서 멈추면 사용자에게 남는 단서가 하나도 없다 — 출력도, 에러도,
 * 완료도 없고 카드만 안 움직인다. 무엇이 잘못됐는지가 아니라 **누가 자기를 부르고
 * 있다는 사실 자체**가 안 보이는 상태다. 이 알림이 그 사실을 화면으로 끌어올리고,
 * 클릭 한 번으로 답할 수 있는 자리(그 에이전트의 터미널)까지 데려간다.
 *
 * 엑스퍼트 모드에도 같은 알림을 건다. 터미널이 보이긴 하지만 여러 개가 동시에
 * 돌고 여러 탭 뒤에 있으므로, "어느 터미널이 나를 기다리는가" 는 여전히 찾아야
 * 아는 정보다.
 *
 * ★알림은 에이전트당 하나다 — 스토어가 agentId 맵이라 구조적으로 보장된다
 * (agentAttentionStore 주석 참조).
 *
 * ★클릭 목적지만 셸마다 다르다. 심플은 에이전트 터미널 모달, 엑스퍼트는
 * AgentListPanel 의 FocusView + (레거시 셸이면) Agents 탭. 그래서 `onOpen` 을
 * 주입받고, 안 주면 엑스퍼트 기본 동작을 쓴다.
 */

interface AgentInputWaitHostProps {
  /**
   * 알림을 눌렀을 때 그 에이전트의 터미널을 여는 방법. 생략하면
   * `focusAgentTerminal`(엑스퍼트 셸 공통 동작).
   */
  onOpen?: (agentId: string) => void;
}

/**
 * 엑스퍼트 셸 기본 동작 — 두 배선을 함께 친다.
 *   • agentFocusStore: AgentListPanel 을 그 에이전트의 FocusView(=터미널)로.
 *     WorkspaceShell(좌측 터미널 열)·레거시 Layout(하단 패널) 둘 다 이 패널을
 *     그리므로 한 번의 set 으로 양쪽이 같은 곳에 선다.
 *   • navigationStore: 그 패널이 지금 안 보일 수 있다 — 레거시 셸은 Agents 탭으로
 *     전환하고, WorkspaceShell 은 접혀 있던 터미널 열을 편다. 두 셸이 이미
 *     `type:"agent"` 점프를 그렇게 해석한다(새 배선 없음).
 */
export function focusAgentTerminal(agentId: string): void {
  useAgentFocusStore.getState().setFocusedAgent(agentId);
  useNavigationStore.getState().requestJump({ type: "agent", id: agentId });
}

function reasonLabel(
  reason: AgentInputWait["reason"],
): "agents.inputWait.confirmBody" | "agents.inputWait.promptBody" {
  return reason === "confirm"
    ? "agents.inputWait.confirmBody"
    : "agents.inputWait.promptBody";
}

export function AgentInputWaitHost({ onOpen }: AgentInputWaitHostProps) {
  const { t } = useTranslation();
  const waiting = useAgentAttentionStore((s) => s.waiting);
  const apply = useAgentAttentionStore((s) => s.apply);
  const dismiss = useAgentAttentionStore((s) => s.dismiss);
  const clearAll = useAgentAttentionStore((s) => s.clearAll);
  const popupsEnabled = useAgentNotificationSettingsStore(
    (s) => s.inputWaitPopupsEnabled,
  );
  const projectId = useProjectStore((s) => s.currentProject?.id ?? null);

  // main 의 전이 신호를 받는 유일한 자리. 셸은 서로 배타라(심플 XOR 엑스퍼트)
  // 이 호스트는 창당 하나만 마운트된다 — 리스너가 겹치지 않는다.
  useEffect(() => {
    const api = window.electronAPI?.agent;
    if (!api?.onInputWait) return;
    api.onInputWait((data) => apply(data));
    return () => {
      api.offInputWait?.();
    };
  }, [apply]);

  // 프로젝트가 바뀌면 이전 보드의 기다림은 이 화면의 것이 아니다. main 이
  // 프로젝트 단위로 이벤트를 라우팅하지만, 철회 이벤트는 **전이일 때만** 오므로
  // 전환 시점에 서 있던 알림은 스스로 사라지지 않는다.
  useEffect(() => {
    clearAll();
  }, [projectId, clearAll]);

  const open = useCallback(
    (agentId: string) => {
      (onOpen ?? focusAgentTerminal)(agentId);
      // 열어 준 뒤에는 알림이 할 일이 끝났다. 여기서 지우지 않으면 사용자가
      // 답을 입력할 때까지 카드가 터미널 위에 그대로 남는다.
      dismiss(agentId);
    },
    [onOpen, dismiss],
  );

  const agents = useAgentStore((s) => s.agents);
  const agentById = useMemo(() => {
    const map = new Map(agents.map((a) => [a.id, a]));
    return map;
  }, [agents]);

  // Defense in depth: once cleanup_agents / remove drops the agent (or it goes
  // terminal), drop any sticky badge even if a retract event was missed.
  useEffect(() => {
    for (const id of Object.keys(waiting)) {
      const agent = agentById.get(id);
      if (!agent || agent.status === "stopped" || agent.status === "error") {
        dismiss(id);
      }
    }
  }, [agentById, waiting, dismiss]);

  const items = selectWaitingAgents({ waiting }).filter((item) => {
    const agent = agentById.get(item.agentId);
    return !!agent && agent.status !== "stopped" && agent.status !== "error";
  });
  if (!popupsEnabled || items.length === 0 || typeof document === "undefined")
    return null;

  return createPortal(
    <div
      data-testid="agent-input-wait-host"
      className="pointer-events-none fixed right-4 top-14 z-[1000] flex w-[20rem] max-w-[calc(100vw-2rem)] flex-col gap-2"
    >
      {items.map((item) => (
        <div
          key={item.agentId}
          data-testid={`agent-input-wait-${item.agentId}`}
          className="pointer-events-auto flex items-start gap-2 rounded-lg border border-[#f9e2af]/50 bg-[#181825]/95 p-3 shadow-2xl shadow-black/40 backdrop-blur"
        >
          <span
            aria-hidden
            className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[#f9e2af]/15 text-sm text-[#f9e2af]"
          >
            ⏸
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-[#cdd6f4]">
              {t("agents.inputWait.title", { name: item.agentName })}
            </p>
            <p className="mt-0.5 text-xs leading-5 text-[#a6adc8]">
              {t(reasonLabel(item.reason))}
            </p>
            <button
              type="button"
              data-testid={`agent-input-wait-open-${item.agentId}`}
              onClick={() => open(item.agentId)}
              className="mt-2 inline-flex h-7 items-center rounded-md border border-[#f9e2af]/40 bg-[#f9e2af]/10 px-2.5 text-xs font-medium text-[#f9e2af] transition-colors hover:border-[#f9e2af] hover:bg-[#f9e2af]/20"
            >
              {t("agents.inputWait.open")}
            </button>
          </div>
          <button
            type="button"
            aria-label={t("agents.inputWait.dismiss")}
            title={t("agents.inputWait.dismiss")}
            onClick={() => dismiss(item.agentId)}
            className="-mr-1 -mt-1 rounded p-1 text-[#585b70] transition-colors hover:text-[#cdd6f4]"
          >
            ✕
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}

export default AgentInputWaitHost;
