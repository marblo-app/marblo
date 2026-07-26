import { forwardRef, memo, useCallback, useState } from "react";
import type { Agent, ModelType, AgentStatus } from "../../types/agent";
import { useAgentSessionMap } from "../../stores/agentSessionMap";
import { useAgentFocusStore } from "../../stores/agentFocusStore";
import { useAgentStore } from "../../stores/agentStore";
import MiniTerminal from "./MiniTerminal";
import AgentStatusLabel from "./AgentStatusLabel";
import AttentionBadge from "./AttentionBadge";
import HarnessVersionBadge from "./HarnessVersionBadge";
import { useTranslation } from "../../lib/i18n";

const MODEL_ICONS: Record<ModelType, { icon: string; color: string }> = {
  claude: { icon: "🟣", color: "#a855f7" },
  gemini: { icon: "🔵", color: "#3b82f6" },
  gpt: { icon: "🟢", color: "#22c55e" },
  grok: { icon: "🔷", color: "#06b6d4" },
  custom: { icon: "⚪", color: "#6b7280" },
  antigravity: { icon: "🟠", color: "#f97316" },
  local: { icon: "⚫", color: "#737373" },
};

const STATUS_DOTS: Record<AgentStatus, { dot: string; textColor: string }> = {
  idle: { dot: "🟡", textColor: "text-yellow-400" },
  working: { dot: "🟢", textColor: "text-green-400" },
  error: { dot: "🔴", textColor: "text-red-400" },
  stopped: { dot: "⚫", textColor: "text-gray-500" },
};

interface AgentFleetCellProps {
  agent: Agent;
  /** add_activity 기반 마지막 메시지 — 없으면 PTY tail 로 fallback. */
  lastActivityMessage?: string;
  /** restart 뱃지용. */
  restartCount?: number;
  /** error 뱃지 details. */
  lastExitCode?: number | null;
  /** Roving tabindex 패턴 — 그리드에서 현재 포커스된 셀만 tabIndex=0. */
  isFocused?: boolean;
  /** 셀이 포커스되었을 때 (클릭/Tab) 부모 그리드의 focusedIndex 동기화용. */
  onFocus?: () => void;
}

const AgentFleetCellImpl = forwardRef<HTMLButtonElement, AgentFleetCellProps>(
  function AgentFleetCellImpl(
    {
      agent,
      lastActivityMessage,
      restartCount = 0,
      lastExitCode = null,
      isFocused = false,
      onFocus,
    },
    ref,
  ) {
    const { t } = useTranslation();
    const modelInfo = MODEL_ICONS[agent.model] ?? MODEL_ICONS.custom;
    const statusInfo = STATUS_DOTS[agent.status] ?? STATUS_DOTS.idle;

    // agentSessionMap 은 launch 시점에 등록 — 미등록이어도 deterministic
    // "agent-${id}" fallback 으로 떨어진다.
    const sessionId = useAgentSessionMap((s) => s.get(agent.id));

    const [pending, setPending] = useState<"start" | "delete" | null>(null);

    // 파일 매니저 패턴:
    //   - 단일 click  = select (focus) 만. onFocus 가 부모 그리드의 활성
    //     셀 인덱스를 동기화 → 이어지는 ←→↑↓ 가 자연스럽게 이어짐.
    //   - Enter / Space / 더블클릭 = "drill-in" → 하단 AgentListPanel 의
    //     FocusView 로 점프. setFocusedAgent 만 하면 패널이 자동 전환.
    //   - 별도 터미널 탭은 만들지 않음 (구 openTerminalForSession 경로는
    //     리스너가 사라져 no-op 이었고, 의미적으로도 그리드의 액션은
    //     하단 패널을 채우는 게 맞음).
    const drillIn = useCallback(() => {
      useAgentFocusStore.getState().setFocusedAgent(agent.id);
    }, [agent.id]);

    // button 의 native 핸들링: Enter/Space → onClick 발사. 그래서 onClick 을
    // drillIn 으로 라우팅하지 않고, click 만 별도로 no-op + focus 만 하도록
    // onKeyDown 에서 Enter/Space 를 명시적으로 drillIn 으로 라우팅. (단일
    // click 은 select 만, 키보드 Enter 는 drill-in 으로 구분하기 위함.)
    const handleClick = useCallback(() => {
      // 의도적 no-op — focus 는 브라우저 default 가 처리, drill-in 은 Enter /
      // 더블클릭 전용. 사용자가 키보드 네비를 시작하기 전 셀을 "선택"만
      // 해두고 싶을 때 single click 으로 끊고 마우스를 떼는 흐름을 보존.
    }, []);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLButtonElement>) => {
        if (e.key === "Enter" || e.key === " ") {
          // ↑↓←→ 는 부모 그리드(div) 핸들러에서 처리. preventDefault 가
          // 그리드 화살표를 막지 않도록 Enter / Space 만 가로챔.
          e.preventDefault();
          drillIn();
        }
      },
      [drillIn],
    );

    // Cell-level actions — 셀 click/focus 이벤트로 버블 안 되게 stopPropagation.
    // 직접 store 호출 (prop drilling 회피) — restartAgent / deleteAgent 는
    // 글로벌 액션이라 어차피 어디서든 같은 결과.
    const handleStart = useCallback(
      async (e: React.MouseEvent) => {
        e.stopPropagation();
        setPending("start");
        try {
          await useAgentStore.getState().restartAgent(agent.id);
        } catch (err) {
          console.error("[AgentFleetCell] start failed:", err);
        } finally {
          setPending(null);
        }
      },
      [agent.id],
    );

    const handleDelete = useCallback(
      async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm(t("agents.fleetCell.deleteConfirm", { name: agent.name })))
          return;
        setPending("delete");
        try {
          await useAgentStore.getState().deleteAgent(agent.id);
        } catch (err) {
          console.error("[AgentFleetCell] delete failed:", err);
          setPending(null);
        }
        // 성공 시 컴포넌트가 unmount 되므로 setPending(null) 생략 (race-safe).
      },
      [agent.id, agent.name, t],
    );

    // ▶ Start 버튼은 사용자가 의도적으로 깨워야 할 때만 노출 — running 중인
    // 에이전트에 다시 누르면 cold restart 되어 history 가 끊어진다.
    const canStart = agent.status === "stopped" || agent.status === "error";

    return (
      <div className="relative group">
        <button
          type="button"
          ref={ref}
          role="gridcell"
          tabIndex={isFocused ? 0 : -1}
          onClick={handleClick}
          onDoubleClick={drillIn}
          onKeyDown={handleKeyDown}
          onFocus={onFocus}
          aria-label={t("agents.fleetCell.ariaLabel", { name: agent.name })}
          data-session-id={sessionId}
          className="w-full text-left rounded-lg border border-[#313244] bg-[#181825] p-2.5 hover:border-[#585b70] hover:bg-[#1e1e2e] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#cba6f7]"
          style={{ borderLeftColor: modelInfo.color, borderLeftWidth: 3 }}
          title={t("agents.fleetCell.title", { name: agent.name })}
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-2 mb-1.5 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-sm">{modelInfo.icon}</span>
              <span className="text-xs font-medium text-[#cdd6f4] truncate">
                {agent.name}
              </span>
              <span
                className={`text-[9px] ${statusInfo.textColor} flex-shrink-0`}
                aria-label={agent.status}
              >
                {statusInfo.dot}
              </span>
            </div>
            <AttentionBadge
              status={agent.status}
              sessionId={sessionId}
              restartCount={restartCount}
              lastExitCode={lastExitCode}
            />
          </div>

          {/* Mini terminal preview */}
          <MiniTerminal sessionId={sessionId} maxLines={8} />

          {/* Status label */}
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="text-[9px] uppercase tracking-wider text-[#6c7086] flex-shrink-0">
              {agent.role}
            </span>
            <HarnessVersionBadge
              model={agent.model}
              className="flex-shrink-0"
            />
            <AgentStatusLabel
              agent={agent}
              sessionId={sessionId}
              lastActivityMessage={lastActivityMessage}
            />
          </div>
        </button>

        {/* Hover-/focus-revealed action toolbar — 상시 노출하면 AttentionBadge
            과 겹쳐서 시각 노이즈가 높아짐. 셀이 hover 또는 키보드로 focus 된
            상태에서만 표시해 평소엔 깔끔하게 두고 의도 시점에만 노출.
            absolute 로 카드 위 z-index 위에 띄워 AttentionBadge 자리를 덮음. */}
        <div className="absolute top-1.5 right-1.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity z-10">
          {canStart && (
            <button
              type="button"
              tabIndex={-1}
              onClick={handleStart}
              disabled={pending !== null}
              title={t("agents.fleetCell.startTitle")}
              aria-label={t("agents.fleetCell.startAria", { name: agent.name })}
              className="rounded border border-[#a6e3a1]/40 bg-[#11111b]/90 px-1.5 py-0.5 text-[10px] text-[#a6e3a1] transition-colors hover:bg-[#a6e3a1]/15 disabled:opacity-40"
            >
              {pending === "start" ? "…" : "▶ Start"}
            </button>
          )}
          <button
            type="button"
            tabIndex={-1}
            onClick={handleDelete}
            disabled={pending !== null}
            title={t("agents.fleetCell.deleteTitle")}
            aria-label={t("agents.fleetCell.deleteAria", { name: agent.name })}
            className="rounded border border-[#f38ba8]/40 bg-[#11111b]/90 px-1.5 py-0.5 text-[10px] text-[#f38ba8] transition-colors hover:bg-[#f38ba8]/15 disabled:opacity-40"
          >
            {pending === "delete" ? "…" : "🗑"}
          </button>
        </div>
      </div>
    );
  },
);

export const AgentFleetCell = memo(AgentFleetCellImpl);
export default AgentFleetCell;
