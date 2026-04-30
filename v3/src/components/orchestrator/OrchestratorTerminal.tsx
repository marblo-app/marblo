import { memo } from 'react';
import type { ITheme } from '@xterm/xterm';
import TerminalIframe from '../terminal/TerminalIframe';

interface OrchestratorTerminalProps {
  sessionId: string;
  panelHeight?: number;
}

// Module-level constants — keep object identity stable so TerminalIframe's
// useEffect doesn't see new theme/callback references on each parent render.
const ORCH_BG = '#181825';

const ORCH_THEME: ITheme = {
  background: ORCH_BG,
  foreground: '#cdd6f4',
  cursor: '#f5e0dc',
  selectionBackground: '#585b7066',
  black: '#45475a',
  red: '#f38ba8',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  blue: '#89b4fa',
  magenta: '#f5c2e7',
  cyan: '#94e2d5',
  white: '#bac2de',
  brightBlack: '#585b70',
  brightRed: '#f38ba8',
  brightGreen: '#a6e3a1',
  brightYellow: '#f9e2af',
  brightBlue: '#89b4fa',
  brightMagenta: '#f5c2e7',
  brightCyan: '#94e2d5',
  brightWhite: '#a6adc8',
};

const exitMessage = (code: number) =>
  `\r\n\x1b[90m[Orchestrator exited with code ${code}]\x1b[0m\r\n`;

export default memo(function OrchestratorTerminal({ sessionId, panelHeight }: OrchestratorTerminalProps) {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <TerminalIframe
        sessionId={sessionId}
        background={ORCH_BG}
        theme={ORCH_THEME}
        resizeKey={panelHeight}
        exitMessage={exitMessage}
      />
    </div>
  );
});
