import { memo } from "react";
import TerminalView from "../terminal/TerminalView";

interface OrchestratorTerminalProps {
  sessionId: string;
  panelHeight?: number;
  status?: string;
}

export default memo(function OrchestratorTerminal({
  sessionId,
  status,
}: OrchestratorTerminalProps) {
  return <TerminalView sessionId={sessionId} isActive activityState={status} />;
});
