import { useEffect, useState } from "react";
import type { Agent } from "../../types/agent";
import AgentFleetCell from "./AgentFleetCell";

interface AgentFleetGridProps {
  agents: Agent[];
  /** Agent id → 마지막 activity 메시지 (옵션). 부모가 ActivityFeed 로부터 매핑. */
  activityByAgent?: Record<string, string>;
}

/**
 * Agents 탭의 그리드 뷰. CSS grid auto-fill — 컨테이너 폭에 따라 N×M 자동
 * 배치. 컨테이너가 좁아져 셀이 한 줄에 1개만 들어갈 정도라면 카드 뷰로 자동
 * fallback 하는 게 사용성에 좋아서, breakpoint 를 본 컴포넌트가 직접 측정.
 */
export default function AgentFleetGrid({
  agents,
  activityByAgent,
}: AgentFleetGridProps) {
  const [tooNarrow, setTooNarrow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(max-width: 640px)");
    const update = () => setTooNarrow(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  if (agents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-[#6c7086]">
        <p className="text-sm">에이전트가 없습니다</p>
        <p className="text-xs mt-1">상단 Add Agent 버튼으로 추가하세요</p>
      </div>
    );
  }

  // 좁은 화면에선 단일 열 (=카드 한 줄). 같은 컴포넌트를 1열로 그려도 정보
  // 손실은 없지만, 진짜 좁다면 부모(Dashboard) 가 List 뷰로 자동 전환하는
  // 게 더 자연스럽다 — 그리드는 데이터를 1열로만 떨어트린다.
  const columnStyle = tooNarrow
    ? { gridTemplateColumns: "1fr" }
    : { gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" };

  return (
    <div className="grid gap-2.5 p-3" style={columnStyle}>
      {agents.map((agent) => (
        <AgentFleetCell
          key={agent.id}
          agent={agent}
          lastActivityMessage={activityByAgent?.[agent.id]}
        />
      ))}
    </div>
  );
}
