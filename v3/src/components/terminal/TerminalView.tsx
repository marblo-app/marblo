import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import 'xterm/css/xterm.css';

interface TerminalViewProps {
  sessionId: string;
  isActive: boolean;
}

export default function TerminalView({ sessionId, isActive }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return;
    initializedRef.current = true;

    // Guard flag prevents StrictMode's first-mount rAF from firing after cleanup
    let disposed = false;

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1e1e2e',
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
      },
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    let openRetries = 0;
    let termOpened = false;
    const pendingData: string[] = [];

    // Clear any ghost xterm DOM from StrictMode's previous mount
    if (containerRef.current) {
      containerRef.current.innerHTML = '';
    }

    const openTerminal = (el: HTMLDivElement) => {
      if (disposed) return;
      try {
        terminal.open(el);
        termOpened = true;
        requestAnimationFrame(() => {
          if (disposed) return;
          try { fitAddon.fit(); } catch { /* ignore */ }
        });
      } catch (err) {
        console.warn('[TerminalView] xterm open failed:', err);
      }
    };

    const tryOpen = () => {
      if (disposed) return;
      const el = containerRef.current;
      if (!el || termOpened) return;
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        openTerminal(el);
      } else if (openRetries < 30) {
        openRetries++;
        requestAnimationFrame(tryOpen);
      } else {
        openTerminal(el);
      }
    };
    requestAnimationFrame(tryOpen);

    // Track whether user has scrolled up from the bottom
    let userScrolledUp = false;
    terminal.onScroll(() => {
      const buf = terminal.buffer.active;
      userScrolledUp = buf.viewportY < buf.baseY;
    });

    // PTY → Terminal (with session detection)
    let hasReceivedData = false;
    window.electronAPI.pty.onData(sessionId, (data) => {
      hasReceivedData = true;
      if (disposed) return;
      if (termOpened) {
        const shouldScroll = !userScrolledUp;
        terminal.write(data);
        if (shouldScroll) terminal.scrollToBottom();
      } else {
        pendingData.push(data);
      }
    });

    const replayTimer = window.setTimeout(() => {
      if (disposed) return;
      window.electronAPI.pty.replay(sessionId).then((buffered) => {
        if (disposed) return;
        if (buffered.length > 0) hasReceivedData = true;
        for (const chunk of buffered) {
          if (termOpened) {
            terminal.write(chunk);
          } else {
            pendingData.push(chunk);
          }
        }
        // If no data after replay, show "session not found" message
        if (!hasReceivedData && termOpened) {
          terminal.write('\r\n\x1b[33m  ⚠ 세션이 만료되었습니다.\x1b[0m\r\n');
          terminal.write('\x1b[90m  앱 재시작으로 PTY 세션이 종료되었습니다.\x1b[0m\r\n');
          terminal.write('\x1b[90m  Agents 탭에서 Restart 버튼으로 재시작하세요.\x1b[0m\r\n\r\n');
        }
      });
    }, 200);

    // Flush pending data once terminal opens
    const flushInterval = setInterval(() => {
      if (disposed) { clearInterval(flushInterval); return; }
      if (termOpened && pendingData.length > 0) {
        for (const d of pendingData) terminal.write(d);
        pendingData.length = 0;
        clearInterval(flushInterval);
      }
    }, 100);
    setTimeout(() => clearInterval(flushInterval), 10000);

    // Terminal → PTY (stdin)
    terminal.onData((data) => {
      if (disposed) return;
      window.electronAPI.pty.write(sessionId, data);
    });

    // Handle image paste (Cmd+V with image in clipboard)
    const handlePaste = async (e: ClipboardEvent) => {
      if (disposed) return;
      // Check if clipboard has image (not text)
      const hasImage = e.clipboardData?.types.includes('image/png')
        || e.clipboardData?.types.includes('image/jpeg');
      const hasText = e.clipboardData?.types.includes('text/plain');
      if (!hasImage || hasText) return; // Let xterm handle text paste

      e.preventDefault();
      const imagePath = await window.electronAPI.clipboard.getImagePath();
      if (imagePath) {
        window.electronAPI.pty.write(sessionId, imagePath);
        terminal.write(`\x1b[90m[Image pasted: ${imagePath}]\x1b[0m`);
      }
    };
    containerRef.current?.addEventListener('paste', handlePaste);

    // Handle PTY exit
    window.electronAPI.pty.onExit(sessionId, (code) => {
      if (disposed) return;
      terminal.write(`\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m\r\n`);
    });

    // Resize handler
    terminal.onResize(({ cols, rows }) => {
      if (disposed) return;
      window.electronAPI.pty.resize(sessionId, cols, rows);
    });

    const handleResize = () => {
      if (disposed) return;
      try {
        if (containerRef.current && containerRef.current.clientWidth > 0 && containerRef.current.clientHeight > 0) {
          fitAddon.fit();
        }
      } catch { /* ignore */ }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      disposed = true;
      window.clearTimeout(replayTimer);
      clearInterval(flushInterval);
      window.removeEventListener('resize', handleResize);
      containerRef.current?.removeEventListener('paste', handlePaste);
      window.electronAPI.pty.removeListeners(sessionId);
      terminal.dispose();
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
      terminalRef.current = null;
      fitAddonRef.current = null;
      initializedRef.current = false;
    };
  }, [sessionId]);

  // Re-fit when tab becomes active + scroll to bottom
  useEffect(() => {
    if (isActive && fitAddonRef.current && containerRef.current) {
      requestAnimationFrame(() => {
        try {
          if (containerRef.current && containerRef.current.clientWidth > 0) {
            fitAddonRef.current?.fit();
          }
        } catch { /* ignore */ }
        // Delay scrollToBottom to ensure fit has fully rendered
        requestAnimationFrame(() => {
          if (terminalRef.current) {
            terminalRef.current.scrollToBottom();
          }
        });
      });
    }
    if (isActive && terminalRef.current) {
      terminalRef.current.focus();
    }
  }, [isActive]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{ display: isActive ? 'block' : 'none' }}
    />
  );
}
