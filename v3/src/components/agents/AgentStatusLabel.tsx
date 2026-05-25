import { memo } from "react";
import type { Agent } from "../../types/agent";
import { usePtyMirrorStore } from "../../stores/ptyMirrorStore";
import { inferLabelForAgent } from "../../lib/statusInfer";

interface AgentStatusLabelProps {
  agent: Pick<Agent, "id" | "status" | "model">;
  sessionId: string;
  /** add_activity 기반 마지막 메시지 (옵션). 부모가 reactive 하게 전달. */
  lastActivityMessage?: string;
  className?: string;
}

const EMPTY: string[] = [];

function AgentStatusLabelImpl({
  agent,
  sessionId,
  lastActivityMessage,
  className,
}: AgentStatusLabelProps) {
  // 한 셀당 마지막 줄만 보면 충분. selector 단위 구독으로 다른 셀 출력 변화에
  // 본 컴포넌트는 재렌더되지 않음.
  const recentLines = usePtyMirrorStore(
    (s) => s.buffers[sessionId]?.lines ?? EMPTY,
  );

  const label = inferLabelForAgent(agent, {
    lastActivityMessage,
    recentLines,
  });

  return (
    <div
      className={
        className ??
        "text-[10px] text-[#a6adc8] truncate font-medium tracking-tight"
      }
      title={label}
    >
      {label}
    </div>
  );
}

export const AgentStatusLabel = memo(AgentStatusLabelImpl);
export default AgentStatusLabel;
