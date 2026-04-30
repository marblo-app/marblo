import { memo } from 'react';
import type { ITheme } from '@xterm/xterm';
import TerminalIframe from './TerminalIframe';

interface TerminalViewProps {
  sessionId: string;
  isActive: boolean;
}

const TERM_BG = '#1e1e2e';

const TERM_THEME: ITheme = {
  background: TERM_BG,
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

const EMPTY_REPLAY_MESSAGE =
  '\r\n\x1b[33m  ⚠ 세션이 만료되었습니다.\x1b[0m\r\n' +
  '\x1b[90m  앱 재시작으로 PTY 세션이 종료되었습니다.\x1b[0m\r\n' +
  '\x1b[90m  Agents 탭에서 Restart 버튼으로 재시작하세요.\x1b[0m\r\n\r\n';

const exitMessage = (code: number) =>
  `\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m\r\n`;

export default memo(function TerminalView({ sessionId, isActive }: TerminalViewProps) {
  return (
    <div
      className="absolute inset-0"
      style={{ display: isActive ? 'block' : 'none' }}
    >
      <TerminalIframe
        sessionId={sessionId}
        background={TERM_BG}
        theme={TERM_THEME}
        resizeKey={isActive ? 'active' : 'inactive'}
        focusOnActive={isActive}
        emptyReplayMessage={EMPTY_REPLAY_MESSAGE}
        exitMessage={exitMessage}
      />
    </div>
  );
});
