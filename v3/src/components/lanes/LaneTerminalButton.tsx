import { useAgentSessionMap } from "../../stores/agentSessionMap";
import { useTerminalStore } from "../../stores/terminalStore";
import { useAgentFocusStore } from "../../stores/agentFocusStore";
import { harnessIcon } from "../../lib/laneVisuals";
import { useTranslation } from "../../lib/i18n";
import type { Agent } from "../../types/agent";

/**
 * "터미널" 버튼 — 이미 실행 중인 lane 에이전트의 PTY 를 연다.
 *
 * attachSession 의 id 는 반드시 진짜 ptySessionId 여야 한다(표시명 X). lane
 * 에이전트의 ptySessionId 는 launch 시점에 agentSessionMap 에 등록되며, 본
 * 컴포넌트가 reactive 셀렉터로 그 매핑을 읽는다. 아직 매핑이 없으면(=세션
 * 미생성/미등록) 잘못된 id 를 넘기는 대신 버튼을 비활성화한다. AgentStatusCard /
 * TaskDetailModal 이 쓰는 패턴과 동일.
 *
 * LanesTab 지역 컴포넌트였으나 상세 드로우도 같은 버튼이 필요해 파일로 뺐다 —
 * 두 표면이 각자 attach 로직을 갖는 순간 한쪽만 죽은 채널을 붙이게 된다.
 */
export function LaneTerminalButton({
  agent,
  onOpened,
}: {
  agent: Agent;
  /** 터미널을 연 뒤 호출(드로우를 닫아 터미널이 실제로 보이게). */
  onOpened?: () => void;
}) {
  const { t } = useTranslation();
  // agentSessionMap 에 launch 시 등록된 진짜 ptySessionId. 미등록이면 undefined
  // (store 의 deterministic "agent-${id}" fallback 은 의도적으로 우회 — 죽은
  // 채널을 attach 하지 않기 위함).
  const ptySessionId = useAgentSessionMap((s) => s.map[agent.id]);
  // 실제로 attach 가능한 세션이 이 윈도우에 존재하는지(=라이브 PTY) 교차 확인.
  const hasLiveSession = useTerminalStore((s) =>
    ptySessionId ? s.sessions.some((sess) => sess.id === ptySessionId) : false,
  );
  const canOpen = Boolean(ptySessionId);

  const label = `${harnessIcon(agent.model)} ${agent.name}`;

  return (
    <button
      type="button"
      disabled={!canOpen}
      title={
        canOpen
          ? hasLiveSession
            ? t("lanes.terminal.view")
            : t("lanes.terminal.connect")
          : t("lanes.terminal.noSession")
      }
      onClick={() => {
        if (!ptySessionId) return;
        useTerminalStore.getState().openTerminalForSession(ptySessionId, label);
        useAgentFocusStore.getState().setFocusedAgent(agent.id);
        onOpened?.();
      }}
      className="rounded bg-gray-700 px-2 py-0.5 text-[11px] text-gray-200 hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {t("lanes.terminal.label")}
      {canOpen && !hasLiveSession && (
        <span className="ml-1 text-[10px] text-gray-400">
          {t("lanes.terminal.connectBadge")}
        </span>
      )}
    </button>
  );
}
