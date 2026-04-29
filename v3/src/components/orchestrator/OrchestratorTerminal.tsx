import { useEffect, useRef, memo } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';

interface OrchestratorTerminalProps {
  sessionId: string;
  panelHeight?: number;
}

export default memo(function OrchestratorTerminal({ sessionId, panelHeight }: OrchestratorTerminalProps) {
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
      cursorBlink: false, // periodic redraw was contributing to RAF queue saturation
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#181825',
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

    let termOpened = false;
    let openRetries = 0;
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
        // WebGL renderer (xterm.js recommended). Must be loaded AFTER terminal.open().
        // Falls back to DOM on failure.
        try {
          const webglAddon = new WebglAddon();
          webglAddon.onContextLoss(() => webglAddon.dispose());
          terminal.loadAddon(webglAddon);
          console.log('[OrchestratorTerminal] WebGL renderer active');
        } catch (err) {
          console.warn('[OrchestratorTerminal] WebGL renderer unavailable, using DOM fallback:', err);
        }
        requestAnimationFrame(() => {
          if (disposed) return;
          try { fitAddon.fit(); } catch { /* ignore */ }
        });
      } catch (err) {
        console.warn('[OrchestratorTerminal] xterm open failed:', err);
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

    // PTY → Terminal — xterm auto-scrolls when viewport is at bottom; no manual tracking needed
    window.electronAPI.pty.onData(sessionId, (data) => {
      if (disposed) return;
      if (termOpened) {
        terminal.write(data);
      } else {
        pendingData.push(data);
      }
    });

    // Replay buffered data — delayed to survive React StrictMode double-mount
    const replayTimer = window.setTimeout(() => {
      if (disposed) return;
      window.electronAPI.pty.replay(sessionId).then((buffered) => {
        if (disposed) return;
        for (const chunk of buffered) {
          if (termOpened) {
            terminal.write(chunk);
          } else {
            pendingData.push(chunk);
          }
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

    // Terminal → PTY (direct passthrough, no slash detection)
    terminal.onData((data) => {
      if (disposed) return;
      window.electronAPI.pty.write(sessionId, data);
    });

    // PTY exit
    window.electronAPI.pty.onExit(sessionId, (code) => {
      if (disposed) return;
      terminal.write(`\r\n\x1b[90m[Orchestrator exited with code ${code}]\x1b[0m\r\n`);
    });

    // Resize
    terminal.onResize(({ cols, rows }) => {
      if (disposed) return;
      window.electronAPI.pty.resize(sessionId, cols, rows);
    });

    const handleResize = () => {
      if (disposed) return;
      try {
        if (containerRef.current && containerRef.current.clientWidth > 0 && containerRef.current.clientHeight > 0) {
          fitAddon.fit();
          terminal.scrollToBottom();
        }
      } catch { /* ignore */ }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      disposed = true;
      window.clearTimeout(replayTimer);
      clearInterval(flushInterval);
      window.removeEventListener('resize', handleResize);
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

  // Refit when sessionId or panelHeight changes — debounced 50ms so fit() doesn't fire
  // every frame during panel-height drag (would force-resize PTY each frame).
  useEffect(() => {
    if (!fitAddonRef.current || !containerRef.current) return;
    const id = window.setTimeout(() => {
      try {
        if (containerRef.current && containerRef.current.clientWidth > 0) {
          fitAddonRef.current?.fit();
          // Prevent scroll jumping to top after resize
          terminalRef.current?.scrollToBottom();
        }
      } catch { /* ignore */ }
    }, 50);
    return () => window.clearTimeout(id);
  }, [sessionId, panelHeight]);

  return (
    <div className="absolute inset-0 overflow-hidden">
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
});
