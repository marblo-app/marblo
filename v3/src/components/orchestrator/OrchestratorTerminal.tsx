import { memo } from "react";
import TerminalView from "../terminal/TerminalView";

interface OrchestratorTerminalProps {
  sessionId: string;
  panelHeight?: number;
  status?: string;
  onUserSubmit?: (text: string) => void;
}

export default memo(function OrchestratorTerminal({
  sessionId,
  status,
  onUserSubmit,
}: OrchestratorTerminalProps) {
  return (
    <TerminalView
      sessionId={sessionId}
      isActive
      activityState={status}
      onUserSubmit={onUserSubmit}
    />
  );
});
