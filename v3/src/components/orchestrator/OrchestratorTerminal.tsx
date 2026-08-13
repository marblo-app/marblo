import { memo } from "react";
import TerminalView from "../terminal/TerminalView";

interface OrchestratorTerminalProps {
  sessionId: string;
  panelHeight?: number;
}

export default memo(function OrchestratorTerminal({
  sessionId,
}: OrchestratorTerminalProps) {
  return <TerminalView sessionId={sessionId} isActive />;
});
