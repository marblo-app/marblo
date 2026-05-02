import { useEffect, useRef, memo } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { patchTerminalForFastIME } from "../../lib/xtermIMEPatch";

interface TerminalViewProps {
  sessionId: string;
  isActive: boolean;
}

export default memo(function TerminalView({
  sessionId,
  isActive,
}: TerminalViewProps) {
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
        background: "#1e1e2e",
        foreground: "#cdd6f4",
        cursor: "#f5e0dc",
        selectionBackground: "#585b7066",
        black: "#45475a",
        red: "#f38ba8",
        green: "#a6e3a1",
        yellow: "#f9e2af",
        blue: "#89b4fa",
        magenta: "#f5c2e7",
        cyan: "#94e2d5",
        white: "#bac2de",
        brightBlack: "#585b70",
        brightRed: "#f38ba8",
        brightGreen: "#a6e3a1",
        brightYellow: "#f9e2af",
        brightBlue: "#89b4fa",
        brightMagenta: "#f5c2e7",
        brightCyan: "#94e2d5",
        brightWhite: "#a6adc8",
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
      containerRef.current.innerHTML = "";
    }

    const openTerminal = (el: HTMLDivElement) => {
      if (disposed) return;
      try {
        terminal.open(el);
        termOpened = true;
        patchTerminalForFastIME(terminal);

        // WebGL renderer disabled by default — see OrchestratorTerminal.tsx
        // for rationale (viewport scroll glitch on MacBook). Opt-in via
        // VITE_USE_WEBGL=1 if needed.
        if (import.meta.env.VITE_USE_WEBGL === "1") {
          try {
            const webglAddon = new WebglAddon();
            webglAddon.onContextLoss(() => webglAddon.dispose());
            terminal.loadAddon(webglAddon);
            console.log("[TerminalView] WebGL renderer active");
          } catch (err) {
            console.warn(
              "[TerminalView] WebGL init failed, using DOM renderer:",
              err,
            );
          }
        }
        requestAnimationFrame(() => {
          if (disposed) return;
          try {
            fitAddon.fit();
          } catch {
            /* ignore */
          }
        });
      } catch (err) {
        console.warn("[TerminalView] xterm open failed:", err);
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

    // PTY → Terminal — slash menu / large redraws can reset the xterm DOM
    // viewport scrollTop because the renderer rebuilds rows wholesale.
    // We latch a `wantBottom` flag that flips ONLY on user intent (wheel /
    // PageUp / Home → false; scroll back to baseY → true). Every write
    // re-sticks to bottom via rAF while wantBottom is true, so renderer
    // resets are corrected on the very next frame without oscillating.
    // See OrchestratorTerminal.tsx for the long-form rationale.
    let wantBottom = true;
    let userScrollingUntil = 0;
    const markUserScrolling = () => {
      userScrollingUntil = Date.now() + 300;
    };
    const isUserScrolling = () => Date.now() < userScrollingUntil;

    let hasReceivedData = false;
    window.electronAPI.pty.onData(sessionId, (data) => {
      hasReceivedData = true;
      if (disposed) return;
      if (!termOpened) {
        pendingData.push(data);
        return;
      }
      terminal.write(data);
      if (wantBottom) {
        requestAnimationFrame(() => {
          if (disposed || !wantBottom) return;
          terminal.scrollToBottom();
        });
      }
    });

    // wantBottom flips only on user-driven scroll changes. isUserScrolling()
    // is set briefly by wheel/keydown listeners; renderer-induced ydisp
    // jumps fire onScroll without that flag set, so we don't toggle on them.
    const onScrollDispose = terminal.onScroll(() => {
      if (disposed || !isUserScrolling()) return;
      const buf = terminal.buffer.active;
      wantBottom = buf.viewportY >= buf.baseY;
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
          terminal.write("\r\n\x1b[33m  ⚠ 세션이 만료되었습니다.\x1b[0m\r\n");
          terminal.write(
            "\x1b[90m  앱 재시작으로 PTY 세션이 종료되었습니다.\x1b[0m\r\n",
          );
          terminal.write(
            "\x1b[90m  Agents 탭에서 Restart 버튼으로 재시작하세요.\x1b[0m\r\n\r\n",
          );
        }
        if (termOpened) terminal.scrollToBottom();
      });
    }, 200);

    // Flush pending data once terminal opens
    const flushInterval = setInterval(() => {
      if (disposed) {
        clearInterval(flushInterval);
        return;
      }
      if (termOpened && pendingData.length > 0) {
        for (const d of pendingData) terminal.write(d);
        pendingData.length = 0;
        // Initial flush — user hasn't had a chance to scroll yet.
        terminal.scrollToBottom();
        clearInterval(flushInterval);
      }
    }, 100);
    setTimeout(() => clearInterval(flushInterval), 10000);

    // Terminal → PTY (stdin)
    terminal.onData((data) => {
      if (disposed) return;
      window.electronAPI.pty.write(sessionId, data);
    });

    // Handle PTY exit
    window.electronAPI.pty.onExit(sessionId, (code) => {
      if (disposed) return;
      terminal.write(
        `\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m\r\n`,
      );
    });

    // Resize handler
    terminal.onResize(({ cols, rows }) => {
      if (disposed) return;
      window.electronAPI.pty.resize(sessionId, cols, rows);
    });

    const handleResize = () => {
      if (disposed) return;
      try {
        if (
          containerRef.current &&
          containerRef.current.clientWidth > 0 &&
          containerRef.current.clientHeight > 0
        ) {
          fitAddon.fit();
        }
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("resize", handleResize);

    // User scroll-intent tracking: any wheel / Page key on the wrapper marks
    // the user as actively scrolling. The onScroll snap-back guard checks
    // this so we never override a deliberate scrollback action.
    const wrapperEl = containerRef.current;
    const onWheel = () => markUserScrolling();
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "PageUp" ||
        e.key === "PageDown" ||
        e.key === "Home" ||
        e.key === "End" ||
        (e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown"))
      ) {
        markUserScrolling();
      }
    };
    wrapperEl?.addEventListener("wheel", onWheel, { passive: true });
    wrapperEl?.addEventListener("keydown", onKeyDown);

    return () => {
      disposed = true;
      window.clearTimeout(replayTimer);
      clearInterval(flushInterval);
      window.removeEventListener("resize", handleResize);
      wrapperEl?.removeEventListener("wheel", onWheel);
      wrapperEl?.removeEventListener("keydown", onKeyDown);
      onScrollDispose.dispose();
      window.electronAPI.pty.removeListeners(sessionId);
      terminal.dispose();
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
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
        } catch {
          /* ignore */
        }
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

  // Stop composition + key/input events from bubbling to React root.
  // xterm's listeners are bound directly on the textarea so they fire first;
  // by the time bubble reaches our wrapper, xterm has already processed the
  // event. Stopping at wrapper prevents React's synthetic event system from
  // walking the fiber tree per keystroke (significant overhead during fast
  // Korean typing where compositionupdate + keydown + input fire 3-4× per
  // syllable). Marblo's hotkey handlers register on document, not on
  // ancestors of the terminal wrapper, so they're unaffected.
  useEffect(() => {
    const wrapper = containerRef.current;
    if (!wrapper) return;
    const stop = (e: Event) => e.stopPropagation();
    const types = [
      "compositionstart",
      "compositionupdate",
      "compositionend",
      "keydown",
      "keyup",
      "input",
    ];
    for (const t of types) wrapper.addEventListener(t, stop);
    return () => {
      for (const t of types) wrapper.removeEventListener(t, stop);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{
        display: isActive ? "block" : "none",
        // Isolate terminal layout/paint from the parent React/Tailwind tree.
        // xterm grid updates trigger DOM layout — without containment that
        // cascades through Sidebar, Header, etc. (~115ms per typing burst).
        contain: "layout style paint",
      }}
    />
  );
});
