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
  // Shared scroll-follow state — user-input-driven (see effect for details).
  const wantBottomRef = useRef(true);

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
              err
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

    // ─────────────────────────────────────────────────────────────────────
    // Scroll-follow state machine — purely user-input-driven (deterministic).
    //
    // Previous iterations toggled wantBottom via a post-wheel time window
    // plus an `onScroll` heuristic (viewportY >= baseY → wantBottom = true).
    // That heuristic raced renderer-induced ydisp jumps (slash menu redraws,
    // cursor-position escape sequences from agent CLIs): if a renderer reset
    // hit within the user-scrolling window, onScroll fired with viewportY
    // happening to == baseY → wantBottom incorrectly snapped back to true →
    // next PTY chunk scrolled to bottom, undoing the user's scroll-up. This
    // was the bug users observed during agent work.
    //
    // This iteration: wantBottomRef.current is mutated ONLY by definite user
    // input handlers (wheel deltaY sign, specific keys, user typing).
    // xterm's onScroll is NOT consulted — no heuristic can be fooled by
    // renderer activity. Every PTY chunk does `if (wantBottom) scrollBottom`,
    // and every other unconditional scrollToBottom callsite is guarded too.
    // ─────────────────────────────────────────────────────────────────────
    wantBottomRef.current = true;
    const checkRejoinBottom = () => {
      if (disposed) return;
      const buf = terminal.buffer.active;
      if (buf.viewportY >= buf.baseY) wantBottomRef.current = true;
    };

    let hasReceivedData = false;
    window.electronAPI.pty.onData(sessionId, (data) => {
      hasReceivedData = true;
      if (disposed) return;
      if (!termOpened) {
        pendingData.push(data);
        return;
      }
      terminal.write(data);
      if (wantBottomRef.current) {
        requestAnimationFrame(() => {
          if (disposed || !wantBottomRef.current) return;
          terminal.scrollToBottom();
        });
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
          terminal.write("\r\n\x1b[33m  ⚠ 세션이 만료되었습니다.\x1b[0m\r\n");
          terminal.write(
            "\x1b[90m  앱 재시작으로 PTY 세션이 종료되었습니다.\x1b[0m\r\n"
          );
          terminal.write(
            "\x1b[90m  Agents 탭에서 Restart 버튼으로 재시작하세요.\x1b[0m\r\n\r\n"
          );
        }
        if (termOpened && wantBottomRef.current) terminal.scrollToBottom();
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
        // Initial flush — user hasn't had a chance to scroll yet, but guard
        // anyway in case data and a user wheel race at mount.
        if (wantBottomRef.current) terminal.scrollToBottom();
        clearInterval(flushInterval);
      }
    }, 100);
    setTimeout(() => clearInterval(flushInterval), 10000);

    // Terminal → PTY (stdin) — user typing means "rejoin auto-follow"
    terminal.onData((data) => {
      if (disposed) return;
      wantBottomRef.current = true;
      window.electronAPI.pty.write(sessionId, data);
    });

    // Handle PTY exit
    window.electronAPI.pty.onExit(sessionId, (code) => {
      if (disposed) return;
      terminal.write(
        `\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m\r\n`
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

    // User-input → wantBottom transitions (deterministic, no heuristics).
    // Capture phase ensures we run before xterm's internal handlers, even if
    // xterm calls stopPropagation. We also re-attach on .xterm-viewport
    // (created after xterm.open()) as belt-and-suspenders — wrapper-level
    // capture alone catches every wheel/key path in practice.
    const wrapperEl = containerRef.current;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        wantBottomRef.current = false; // user scrolling up — pin position
      } else if (e.deltaY > 0) {
        requestAnimationFrame(checkRejoinBottom); // rejoin if landed at baseY
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "PageUp":
        case "Home":
          wantBottomRef.current = false;
          break;
        case "End":
          wantBottomRef.current = true;
          break;
        case "PageDown":
          requestAnimationFrame(checkRejoinBottom);
          break;
        case "ArrowUp":
        case "ArrowDown":
          if (e.shiftKey) {
            if (e.key === "ArrowUp") wantBottomRef.current = false;
            else requestAnimationFrame(checkRejoinBottom);
          }
          break;
      }
    };
    const wheelOpts: AddEventListenerOptions = { capture: true, passive: true };
    const keyOpts: AddEventListenerOptions = { capture: true };
    wrapperEl?.addEventListener("wheel", onWheel, wheelOpts);
    wrapperEl?.addEventListener("keydown", onKeyDown, keyOpts);
    // .xterm-viewport is created after xterm.open() — attach next frame.
    let viewportEl: HTMLElement | null = null;
    requestAnimationFrame(() => {
      viewportEl =
        wrapperEl?.querySelector<HTMLElement>(".xterm-viewport") ?? null;
      viewportEl?.addEventListener("wheel", onWheel, wheelOpts);
      viewportEl?.addEventListener("keydown", onKeyDown, keyOpts);
    });

    return () => {
      disposed = true;
      window.clearTimeout(replayTimer);
      clearInterval(flushInterval);
      window.removeEventListener("resize", handleResize);
      wrapperEl?.removeEventListener("wheel", onWheel, wheelOpts);
      wrapperEl?.removeEventListener("keydown", onKeyDown, keyOpts);
      viewportEl?.removeEventListener("wheel", onWheel, wheelOpts);
      viewportEl?.removeEventListener("keydown", onKeyDown, keyOpts);
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
        // Delay scrollToBottom to ensure fit has fully rendered.
        // Only scroll if user wasn't manually scrolled-up — preserves position.
        requestAnimationFrame(() => {
          if (terminalRef.current && wantBottomRef.current) {
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
