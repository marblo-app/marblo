import { useEffect, useRef, memo } from 'react';
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import xtermCss from '@xterm/xterm/css/xterm.css?inline';

/**
 * Mounts xterm.js inside an iframe to isolate its layout work from the parent
 * React/Tailwind tree. This eliminates the 100-200ms inputDelay on Korean (IME)
 * input that was caused by xterm's CompositionHelper triggering forced layout
 * flushes against the heavy parent document.
 *
 * See `docs/04_terminal_iframe_isolation_prd.md` for full rationale.
 */

export interface TerminalIframeProps {
  sessionId: string;
  /** Theme background color — also applied to iframe body for seamless edges. */
  background: string;
  theme: ITheme;
  /** When this changes, terminal refits (debounced). Both heights and isActive count as resize triggers. */
  resizeKey?: string | number;
  /** When true (or undefined), focus the terminal on mount/activation. */
  focusOnActive?: boolean;
  /** Custom message to write when PTY replay returns no buffered data and no live data has arrived (TerminalView only). */
  emptyReplayMessage?: string;
  /** Custom message to write when PTY exits. */
  exitMessage?: (code: number) => string;
}

const FONT_FAMILY = 'Menlo, Monaco, "Courier New", monospace';
const FONT_SIZE = 13;

export default memo(function TerminalIframe({
  sessionId,
  background,
  theme,
  resizeKey,
  focusOnActive = true,
  emptyReplayMessage,
  exitMessage,
}: TerminalIframeProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const containerInIframeRef = useRef<HTMLDivElement | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || initializedRef.current) return;
    initializedRef.current = true;

    let disposed = false;
    let termOpened = false;
    let openRetries = 0;
    const pendingData: string[] = [];
    let hasReceivedData = false;

    const setup = () => {
      if (disposed) return;
      const doc = iframe.contentDocument;
      const win = iframe.contentWindow;
      if (!doc || !win) return;

      // Reset doc styles + inject xterm CSS
      doc.documentElement.style.cssText = 'width:100%;height:100%;margin:0;padding:0;overflow:hidden;';
      doc.body.style.cssText = `width:100%;height:100%;margin:0;padding:0;overflow:hidden;background:${background};`;

      const styleEl = doc.createElement('style');
      styleEl.textContent = xtermCss;
      doc.head.appendChild(styleEl);

      const container = doc.createElement('div');
      container.style.cssText = 'position:absolute;inset:0;';
      doc.body.appendChild(container);
      containerInIframeRef.current = container;

      const terminal = new Terminal({
        cursorBlink: false,
        fontSize: FONT_SIZE,
        fontFamily: FONT_FAMILY,
        theme,
        documentOverride: doc,
      });

      const fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon();
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(webLinksAddon);

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;

      const openTerminal = () => {
        if (disposed) return;
        try {
          terminal.open(container);
          termOpened = true;
          requestAnimationFrame(() => {
            if (disposed) return;
            try { fitAddon.fit(); } catch { /* ignore */ }
          });
        } catch (err) {
          console.warn('[TerminalIframe] xterm open failed:', err);
        }
      };

      const tryOpen = () => {
        if (disposed) return;
        if (termOpened) return;
        if (container.clientWidth > 0 && container.clientHeight > 0) {
          openTerminal();
        } else if (openRetries < 30) {
          openRetries++;
          requestAnimationFrame(tryOpen);
        } else {
          openTerminal();
        }
      };
      requestAnimationFrame(tryOpen);

      // PTY → Terminal
      window.electronAPI.pty.onData(sessionId, (data) => {
        hasReceivedData = true;
        if (disposed) return;
        if (termOpened) {
          terminal.write(data);
        } else {
          pendingData.push(data);
        }
      });

      // Replay buffered early output (delayed for StrictMode safety)
      const replayTimer = win.setTimeout(() => {
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
          if (!hasReceivedData && termOpened && emptyReplayMessage) {
            terminal.write(emptyReplayMessage);
          }
        });
      }, 200);

      // Flush pending data once terminal opens
      const flushInterval = win.setInterval(() => {
        if (disposed) { win.clearInterval(flushInterval); return; }
        if (termOpened && pendingData.length > 0) {
          for (const d of pendingData) terminal.write(d);
          pendingData.length = 0;
          win.clearInterval(flushInterval);
        }
      }, 100);
      win.setTimeout(() => win.clearInterval(flushInterval), 10000);

      // Terminal → PTY
      terminal.onData((data) => {
        if (disposed) return;
        window.electronAPI.pty.write(sessionId, data);
      });

      // PTY exit
      window.electronAPI.pty.onExit(sessionId, (code) => {
        if (disposed) return;
        if (exitMessage) terminal.write(exitMessage(code));
      });

      // PTY resize on terminal resize (cols/rows changed)
      terminal.onResize(({ cols, rows }) => {
        if (disposed) return;
        window.electronAPI.pty.resize(sessionId, cols, rows);
      });

      // Refit when iframe element resizes (parent container size change)
      const ro = new ResizeObserver(() => {
        if (disposed) return;
        try { fitAddon.fit(); } catch { /* ignore */ }
      });
      ro.observe(iframe);

      // Cleanup
      cleanupRef.current = () => {
        disposed = true;
        win.clearTimeout(replayTimer);
        win.clearInterval(flushInterval);
        ro.disconnect();
        window.electronAPI.pty.removeListeners(sessionId);
        terminal.dispose();
        terminalRef.current = null;
        fitAddonRef.current = null;
        containerInIframeRef.current = null;
      };

      console.log('[TerminalIframe] xterm mounted in iframe for session', sessionId);

      // Install INP measurement INSIDE the iframe context so we capture events
      // on the iframe's hidden textarea (the parent observer can't see these).
      try {
        const ifWin = win as Window & { PerformanceObserver?: typeof PerformanceObserver };
        if (ifWin.PerformanceObserver) {
          type InpEntry = { duration: number; inputDelay: number };
          const buf: InpEntry[] = [];
          new ifWin.PerformanceObserver((list) => {
            for (const entry of list.getEntries() as Array<PerformanceEntry & { processingStart?: number; processingEnd?: number }>) {
              if (entry.duration <= 100) continue;
              if (entry.entryType !== 'event') continue;
              if (entry.name !== 'keydown' && entry.name !== 'keyup' && entry.name !== 'input') continue;
              const inputDelay = (entry.processingStart ?? 0) - entry.startTime;
              buf.push({ duration: entry.duration, inputDelay });
            }
          }).observe({ type: 'event', durationThreshold: 100, buffered: true } as PerformanceObserverInit);
          win.setInterval(() => {
            if (buf.length === 0) return;
            const samples = buf.splice(0, buf.length);
            const dur = samples.map((s) => s.duration).sort((a, b) => a - b);
            const inDel = samples.map((s) => s.inputDelay);
            const p50 = dur[Math.floor(dur.length / 2)];
            const p95 = dur[Math.floor(dur.length * 0.95)] ?? dur[dur.length - 1];
            const max = dur[dur.length - 1];
            const avg = (inDel.reduce((a, b) => a + b, 0) / inDel.length).toFixed(0);
            console.warn(`[IFRAME-INP-5s] count=${samples.length} p50=${p50?.toFixed(0)}ms p95=${p95?.toFixed(0)}ms max=${max?.toFixed(0)}ms | avgInputDelay=${avg}ms`);
          }, 5000);
        }
      } catch (err) {
        console.warn('[TerminalIframe] PerformanceObserver in iframe failed:', err);
      }
    };

    const cleanupRef = { current: () => {} };

    // Wait for iframe load (about:blank usually loads before this useEffect runs,
    // but be defensive — it could still be in 'loading' state on first mount).
    const onLoad = () => setup();
    if (iframe.contentDocument && iframe.contentDocument.readyState !== 'loading') {
      setup();
    } else {
      iframe.addEventListener('load', onLoad);
    }

    return () => {
      iframe.removeEventListener('load', onLoad);
      cleanupRef.current();
      initializedRef.current = false;
    };
  }, [sessionId, background, theme, emptyReplayMessage, exitMessage]);

  // Refit on external resize trigger (debounced) + scroll-to-bottom anti-jump
  useEffect(() => {
    if (!fitAddonRef.current) return;
    const id = window.setTimeout(() => {
      try {
        fitAddonRef.current?.fit();
        terminalRef.current?.scrollToBottom();
      } catch { /* ignore */ }
    }, 50);
    return () => window.clearTimeout(id);
  }, [resizeKey]);

  // Focus management
  useEffect(() => {
    if (!focusOnActive) return;
    const t = terminalRef.current;
    const iframe = iframeRef.current;
    if (!t || !iframe) return;
    requestAnimationFrame(() => {
      try {
        iframe.contentWindow?.focus();
        t.focus();
      } catch { /* ignore */ }
    });
  }, [focusOnActive, resizeKey]);

  return (
    <iframe
      ref={iframeRef}
      title={`terminal-${sessionId}`}
      style={{
        width: '100%',
        height: '100%',
        border: 0,
        display: 'block',
        background,
      }}
    />
  );
});
