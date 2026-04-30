import { useEffect, useRef, memo } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
// import { WebglAddon } from '@xterm/addon-webgl'; // disabled — see openTerminal()
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

        // Patch xterm's CompositionHelper to eliminate the layout-flush cost.
        // Original updateCompositionElements writes 6+ styles to _compositionView
        // then calls getBoundingClientRect on it — that read is a forced layout
        // flush (browser has to apply pending style invalidations before returning
        // accurate geometry). On a heavy React+Tailwind tree like Marblo's, the
        // flush is 30-50ms; multiplied across composition events per Korean
        // syllable plus per-render onRender invocations it produces 100-200ms
        // inputDelay. VS Code/Cursor have lighter DOM trees so the same code is
        // cheap there.
        //
        // Two-part patch:
        //   (1) Override _compositionView.getBoundingClientRect with a no-flush
        //       implementation that computes width/height from the renderer's
        //       cached cell dimensions and the composition text. xterm only
        //       reads .width and .height from this rect, so accurate values for
        //       those are sufficient. Wide-char (CJK) counted as 2 cells.
        //   (2) Skip updateCompositionElements when not composing (eliminates
        //       per-render onRender invocations during English typing) and
        //       suppress the setTimeout(0) self-reschedule (halves call count
        //       during composition).
        try {
          type CompositionHelper = {
            updateCompositionElements?: (skip?: boolean) => void;
            _isComposing?: boolean;
            _compositionView?: HTMLElement;
          };
          type CoreInternals = {
            _compositionHelper?: CompositionHelper;
            _renderService?: { dimensions?: { css?: { cell?: { width: number; height: number } } } };
          };
          const core = (terminal as unknown as { _core?: CoreInternals })._core;
          const ch = core?._compositionHelper;
          const view = ch?._compositionView;

          if (view) {
            // (1) No-flush getBoundingClientRect for the composition view.
            const noFlushRect = function (this: HTMLElement): DOMRect {
              const text = this.textContent || '';
              const cell = core?._renderService?.dimensions?.css?.cell;
              let cellCount = 0;
              for (const c of text) cellCount += c.charCodeAt(0) > 0xFF ? 2 : 1;
              const w = (cell?.width ?? 9) * Math.max(cellCount, 1);
              const h = cell?.height ?? 16;
              const top = parseFloat(this.style.top) || 0;
              const left = parseFloat(this.style.left) || 0;
              return {
                width: w, height: h,
                top, left, right: left + w, bottom: top + h,
                x: left, y: top,
                toJSON() { return { width: w, height: h, top, left, right: left + w, bottom: top + h, x: left, y: top }; },
              } as DOMRect;
            };
            view.getBoundingClientRect = noFlushRect;
          }

          if (ch && typeof ch.updateCompositionElements === 'function') {
            // (2) Skip when idle + no recursion when composing.
            const orig = ch.updateCompositionElements.bind(ch);
            ch.updateCompositionElements = function () {
              if (!ch._isComposing) return;
              return orig(true);
            };
            console.log('[OrchestratorTerminal] CompositionHelper patched (no-flush rect + idle skip + no recursion)');
          }
        } catch (err) {
          console.warn('[OrchestratorTerminal] CompositionHelper patch failed:', err);
        }

        // EXPERIMENT: WebGL disabled, using xterm's default DOM renderer.
        // try {
        //   const webglAddon = new WebglAddon();
        //   webglAddon.onContextLoss(() => webglAddon.dispose());
        //   terminal.loadAddon(webglAddon);
        // } catch (err) { /* fall back to DOM */ }
        console.log('[OrchestratorTerminal] DOM renderer active (WebGL disabled for input-latency test)');
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

  // Korean (and other IME-based) typing fires 3-4 composition events per syllable.
  // React 17+ intercepts these at its root container to manage composition state for
  // controlled inputs — adding fiber-tree-walk overhead per event. Per syllable this
  // accumulates as visible "stuck-then-flush" latency. xterm's own composition
  // handling is bound directly on the hidden textarea, so we can safely stop
  // propagation at the wrapper boundary AFTER xterm's listeners have run.
  // (English/ASCII typing doesn't trigger compositions; this only affects IME paths.)
  useEffect(() => {
    const wrapper = containerRef.current;
    if (!wrapper) return;
    const stop = (e: Event) => e.stopPropagation();
    const types = ['compositionstart', 'compositionupdate', 'compositionend'];
    for (const t of types) wrapper.addEventListener(t, stop);
    return () => {
      for (const t of types) wrapper.removeEventListener(t, stop);
    };
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden">
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
});
