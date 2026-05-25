import { memo } from "react";
import type { AgentStatus } from "../../types/agent";
import { usePtyMirrorStore } from "../../stores/ptyMirrorStore";
import { isAwaitingInput } from "../../lib/attentionDetect";

interface AttentionBadgeProps {
  status: AgentStatus;
  sessionId: string;
  /** 부모가 알려주는 재시작 횟수 (AgentStatusCard 와 동일 신호). */
  restartCount?: number;
  /** 부모가 알려주는 마지막 exit code (status==='error' 일 때 의미 있음). */
  lastExitCode?: number | null;
}

const EMPTY: string[] = [];

/**
 * 우선순위: error > 입력대기 > restart > 없음.
 * 셀에 한 번에 한 뱃지만 노출 — 시각적 노이즈 최소화.
 */
function AttentionBadgeImpl({
  status,
  sessionId,
  restartCount = 0,
  lastExitCode = null,
}: AttentionBadgeProps) {
  const lines = usePtyMirrorStore((s) => s.buffers[sessionId]?.lines ?? EMPTY);

  if (status === "error") {
    return (
      <span
        className="text-[10px] text-[#f38ba8] bg-[#f38ba8]/10 px-1.5 py-0.5 rounded font-medium"
        title={
          lastExitCode !== null
            ? `Crashed (exit ${lastExitCode})`
            : "Agent error"
        }
      >
        ⚠ Error
      </span>
    );
  }

  if (isAwaitingInput(lines)) {
    return (
      <span
        className="text-[10px] text-[#f9e2af] bg-[#f9e2af]/10 px-1.5 py-0.5 rounded font-medium"
        title="에이전트가 사용자 입력을 기다리고 있습니다"
      >
        ⏸ 입력 대기
      </span>
    );
  }

  if (restartCount > 0) {
    return (
      <span
        className="text-[10px] text-[#fab387] bg-[#fab387]/10 px-1.5 py-0.5 rounded font-medium"
        title={`Restarted ${restartCount}x`}
      >
        ↻ {restartCount}
      </span>
    );
  }

  return null;
}

export const AttentionBadge = memo(AttentionBadgeImpl);
export default AttentionBadge;
