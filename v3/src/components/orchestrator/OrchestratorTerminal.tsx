import { useEffect, useRef, memo } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { patchTerminalForFastIME } from "../../lib/xtermIMEPatch";

interface OrchestratorTerminalProps {
  sessionId: string;
  panelHeight?: number;
}

export default memo(function OrchestratorTerminal({
  sessionId,
  panelHeight,
}: OrchestratorTerminalProps) {
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
        background: "#181825",
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

    let termOpened = false;
    let openRetries = 0;
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

        // WebGL renderer disabled by default — caused viewport scroll-up
        // glitch when typing on MacBook (358c623 originally disabled WebGL
        // for similar reason). DOM renderer is fast enough on modern hardware.
        // Opt-in via VITE_USE_WEBGL=1 if needed.
        if (import.meta.env.VITE_USE_WEBGL === "1") {
          try {
            const webglAddon = new WebglAddon();
            webglAddon.onContextLoss(() => webglAddon.dispose());
            terminal.loadAddon(webglAddon);
            console.log("[OrchestratorTerminal] WebGL renderer active");
          } catch (err) {
            console.warn(
              "[OrchestratorTerminal] WebGL init failed, using DOM renderer:",
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
        console.warn("[OrchestratorTerminal] xterm open failed:", err);
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
    // See TerminalView.tsx for the full rationale. Summary: previous
    // post-wheel-window + onScroll heuristic raced renderer-induced ydisp
    // jumps (slash menu redraws, agent CLI TUI escape sequences) and could
    // snap wantBottom back to true mid-gesture. This version derives
    // wantBottom only from definite user input (wheel deltaY sign, specific
    // keys, user typing). xterm's onScroll is not consulted.
    // ─────────────────────────────────────────────────────────────────────
    wantBottomRef.current = true;
    const checkRejoinBottom = () => {
      if (disposed) return;
      const buf = terminal.buffer.active;
      if (buf.viewportY >= buf.baseY) wantBottomRef.current = true;
    };

    window.electronAPI.pty.onData(sessionId, (data) => {
      if (disposed) return;
      if (!termOpened) {
        pendingData.push(data);
        return;
      }
      terminal.write(data);
      if (wantBottomRef.current) {
        // Defer past xterm's render frame so our scrollToBottom outlives the
        // renderer's row rebuild for this chunk.
        requestAnimationFrame(() => {
          if (disposed || !wantBottomRef.current) return;
          terminal.scrollToBottom();
        });
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

    // Terminal → PTY (direct passthrough) — user typing rejoins auto-follow
    terminal.onData((data) => {
      if (disposed) return;
      wantBottomRef.current = true;
      window.electronAPI.pty.write(sessionId, data);
    });

    // PTY exit
    window.electronAPI.pty.onExit(sessionId, (code) => {
      if (disposed) return;
      terminal.write(
        `\r\n\x1b[90m[Orchestrator exited with code ${code}]\x1b[0m\r\n`
      );
    });

    // Resize
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
          // Only re-stick to bottom if user wasn't scrolled-up.
          if (wantBottomRef.current) terminal.scrollToBottom();
        }
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("resize", handleResize);

    // User-input → wantBottom transitions (deterministic). See TerminalView.tsx.
    // Capture phase catches before xterm's internal handlers; .xterm-viewport
    // listener is belt-and-suspenders for paths where xterm consumes wheel.
    const wrapperEl = containerRef.current;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        wantBottomRef.current = false; // user scrolling up — pin position
      } else if (e.deltaY > 0) {
        requestAnimationFrame(checkRejoinBottom);
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

  // Refit when sessionId or panelHeight changes — debounced 50ms so fit() doesn't fire
  // every frame during panel-height drag (would force-resize PTY each frame).
  useEffect(() => {
    if (!fitAddonRef.current || !containerRef.current) return;
    const id = window.setTimeout(() => {
      try {
        if (containerRef.current && containerRef.current.clientWidth > 0) {
          fitAddonRef.current?.fit();
          // Preserve user's scroll position if they're manually scrolled-up.
          if (wantBottomRef.current) terminalRef.current?.scrollToBottom();
        }
      } catch {
        /* ignore */
      }
    }, 50);
    return () => window.clearTimeout(id);
  }, [sessionId, panelHeight]);

  // Stop composition + key/input events from bubbling to React root.
  // Korean (and other IME-based) typing fires 3-4 composition events plus
  // keydown/input per syllable. React 17+ intercepts these at its root
  // container — adding fiber-tree-walk overhead per event. xterm's handlers
  // are bound directly on the hidden textarea so they run first; by the time
  // bubble reaches our wrapper, xterm has processed the event. Stopping here
  // prevents React's synthetic event system from doing redundant work.
  // Marblo's hotkey handlers register on document, not on ancestors of the
  // terminal wrapper, so they're unaffected.
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
      className="absolute inset-0 overflow-hidden"
      style={{
        // Isolate terminal layout/paint — see TerminalView.tsx for rationale.
        contain: "layout style paint",
      }}
    >
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
});
