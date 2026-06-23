import { useEffect, useRef, memo } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { CanvasAddon } from "@xterm/addon-canvas";
import "@xterm/xterm/css/xterm.css";
import { patchTerminalForFastIME } from "../../lib/xtermIMEPatch";
import { resolveClipboardForTerminal } from "../../utils/clipboardImage";

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

    // Cmd/Ctrl+V — paste explicitly. The native menu paste does not reliably
    // reach xterm's hidden textarea after an OAuth browser round-trip (typing
    // works, paste is lost), which broke pasting auth tokens (e.g. Antigravity
    // `agy` login). Read the clipboard ourselves and inject via
    // terminal.paste(), which respects bracketed-paste mode.
    terminal.attachCustomKeyEventHandler((e) => {
      if (
        e.type === "keydown" &&
        (e.key === "v" || e.key === "V") &&
        (e.metaKey || e.ctrlKey) &&
        !e.altKey
      ) {
        e.preventDefault();
        void resolveClipboardForTerminal()
          .then((data) => {
            if (data) terminal.paste(data);
          })
          .catch(() => {});
        return false;
      }
      return true;
    });

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

        // Renderer selection — fixes the "Welcome to Claude Code!" box
        // flickering during work, especially at small panel heights.
        //
        // Root cause: when the panel is short, Claude Code's Ink TUI can't fit
        // its frame in the available rows, so it falls back to full-frame
        // redraws every tick instead of incremental updates. The xterm DOM
        // renderer rebuilds row <span>s on each full redraw → visible white
        // flash. The canvas renderer paints the same redraws onto a single 2D
        // canvas → no flash. (Making the panel bigger also stops it, because
        // Ink then does incremental updates — but canvas fixes it at any size.)
        //
        // Canvas is a distinct renderer from WebGL and does NOT share the
        // viewport scroll-up-on-type glitch that got WebGL disabled (2d0001d),
        // so it's the safe default here.
        //   VITE_USE_WEBGL=1       → opt into WebGL instead of canvas
        //   VITE_TERM_RENDERER=dom → force the legacy DOM renderer
        if (import.meta.env.VITE_TERM_RENDERER !== "dom") {
          if (import.meta.env.VITE_USE_WEBGL === "1") {
            try {
              const webglAddon = new WebglAddon();
              webglAddon.onContextLoss(() => webglAddon.dispose());
              terminal.loadAddon(webglAddon);
              console.debug("[OrchestratorTerminal] WebGL renderer active");
            } catch (err) {
              console.warn(
                "[OrchestratorTerminal] WebGL init failed, falling back to canvas:",
                err
              );
              try {
                terminal.loadAddon(new CanvasAddon());
              } catch {
                /* DOM renderer remains active */
              }
            }
          } else {
            try {
              terminal.loadAddon(new CanvasAddon());
              console.debug("[OrchestratorTerminal] Canvas renderer active");
            } catch (err) {
              console.warn(
                "[OrchestratorTerminal] Canvas init failed, using DOM renderer:",
                err
              );
            }
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

    // ─────────────────────────────────────────────────────────────────────
    // Slash-menu viewport hold. Typing `/` on an empty composer opens Claude
    // Code's command menu. Claude renders the menu as a tall block — the `> /`
    // input prompt at the top, the (long) command list below it, and the
    // terminal cursor parked on an empty line at the very bottom. xterm's
    // auto-follow (BufferService.scroll: `isUserScrolling || ydisp = ybase`)
    // tracks that bottom cursor, so the viewport lands ~20+ lines below the
    // prompt — you see the middle of the command list and your `> /` input has
    // scrolled off the top. That's the "jumps to the bottom of the list" report.
    //
    // Fix: while the menu is open, find the prompt line by scanning the buffer
    // for the active `> ` row and pin the viewport there, so the prompt sits at
    // the top with the menu below it — like a normal terminal keeping the prompt
    // in view. We can't capture the line up front: Claude's render pushes new
    // scrollback, so the prompt's absolute index shifts (≈5 → ≈36 here) between
    // the keystroke and the menu paint. So we re-scan on every flush; it also
    // tracks the prompt as the menu grows/shrinks while filtering. scrollToLine
    // also flips xterm's isUserScrolling flag so the menu's own redraws stop
    // auto-following. Self-clearing: the hold resets the moment the composer
    // empties (backspace / Esc / Ctrl-C / submit), so follow can't get stuck off.
    // inputLen mirrors TerminalView's stdin estimator (we never see Claude's
    // real input buffer).
    let inputLen = 0;
    let slashComposer = false;
    // Highest-indexed line that looks like Claude's input prompt (`> ` after
    // optional leading whitespace / box border). The active prompt is always
    // the last such row above the parked cursor; earlier `> …` rows are
    // submitted history in scrollback (lower indices), so max-index wins.
    const PROMPT_RE = /^\s*(?:[│|]\s*)?>\s/;
    const findPromptLine = (): number | null => {
      const buf = terminal.buffer.active;
      const bottom = buf.length - 1;
      const limit = Math.max(0, bottom - 200);
      for (let i = bottom; i >= limit; i--) {
        const s = buf.getLine(i)?.translateToString(true) ?? "";
        if (PROMPT_RE.test(s)) return i;
      }
      return null;
    };
    const trackComposer = (data: string) => {
      if (data.startsWith("\x1b")) {
        // Bare Esc closes the menu / clears the line; arrow keys (\x1b[A …)
        // navigate it and must NOT reset the hold.
        if (data === "\x1b") {
          inputLen = 0;
          slashComposer = false;
        }
        return;
      }
      if (data === "\r" || data === "\n") {
        inputLen = 0;
        slashComposer = false;
      } else if (data === "\x7f" || data === "\b") {
        inputLen = Math.max(0, inputLen - 1);
        if (inputLen === 0) slashComposer = false;
      } else if (data === "\x03" || data === "\x15") {
        inputLen = 0;
        slashComposer = false;
      } else {
        if (inputLen === 0 && data === "/") slashComposer = true;
        inputLen += data.length;
      }
    };

    // Settle-window batching for live PTY chunks — mirrors TerminalView so
    // the orchestrator terminal behaves identically to the agent terminals.
    // Claude Code emits a SINGLE logical redraw (e.g. a streamed message
    // update) as several stdout flushes spaced 5-40ms apart. Writing +
    // scrolling on every flush makes the viewport lurch up/down between the
    // partial frames. Instead: queue chunks, flush after SETTLE_MS of silence,
    // hard-cap at MAX_DELAY_MS so echo never lags on a continuous stream.
    const SETTLE_MS = 28;
    const MAX_DELAY_MS = 80;
    let liveQueue: string[] = [];
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let maxTimer: ReturnType<typeof setTimeout> | null = null;

    // ─────────────────────────────────────────────────────────────────────
    // Cold-start repaint. Opening the panel ('PTY 보기' / attention auto-open)
    // showed a blank terminal until the user pressed a key. Two independent
    // causes, two fixes:
    //
    //   1. Canvas renderer first paint. The CanvasAddon batches paints into the
    //      rAF render loop and only repaints rows the core marked dirty. A bulk
    //      replay write (or a flush of data queued before open) applies all at
    //      once right after open(); with no further input, that first frame can
    //      stay blank until a later write (the Enter echo) drives another render
    //      cycle. terminal.refresh() re-marks the viewport dirty so the next
    //      frame actually paints it. ensureFirstPaint() does this exactly once —
    //      after the renderer is warm, normal writes paint on their own, so we
    //      keep it off the hot live-stream path.
    //
    //   2. Alternate-screen TUI re-emit. The orchestrator is Claude Code's Ink
    //      TUI in alternate-screen mode. On (re)attach it does not redraw its
    //      current frame, and the replay ring buffer may no longer hold the
    //      alt-screen-enter sequence, so the reconstructed frame can be stale or
    //      partial (e.g. a waiting-for-human prompt). A terminal resize delivers
    //      SIGWINCH, which makes Ink repaint the whole frame. fit() already
    //      resizes on mount, but only when xterm's dims actually change — a
    //      re-mount at the same panel size sends nothing, so the stale frame
    //      survives. We force the issue by bumping cols by one and restoring it;
    //      the kernel only signals on a real size change, so a same-size resize
    //      would be a no-op.
    //
    //   ORDERING: main's pty:resize clears the pre-replay output buffer while it
    //   still exists, so the nudge MUST run only AFTER pty:replay has drained +
    //   deleted that buffer. nudgePtyRepaint() is therefore called solely from
    //   the replay completion path below.
    let firstPaintDone = false;
    const forceRepaint = () => {
      if (disposed || !termOpened) return;
      try {
        terminal.refresh(0, terminal.rows - 1);
      } catch {
        /* ignore */
      }
    };
    const ensureFirstPaint = () => {
      if (firstPaintDone) return;
      firstPaintDone = true;
      forceRepaint();
    };
    let nudgeRestoreTimer: ReturnType<typeof setTimeout> | null = null;
    const nudgePtyRepaint = () => {
      if (disposed || !termOpened) return;
      const cols = terminal.cols;
      const rows = terminal.rows;
      if (!cols || !rows) return;
      try {
        window.electronAPI.pty.resize(sessionId, cols + 1, rows);
        nudgeRestoreTimer = setTimeout(() => {
          nudgeRestoreTimer = null;
          if (disposed) return;
          window.electronAPI.pty.resize(sessionId, cols, rows);
        }, 50);
      } catch {
        /* ignore */
      }
    };
    // Focus so the user can answer immediately, but never steal focus from a
    // field they're actively typing in elsewhere (auto-open can fire anytime).
    const focusIfIdle = () => {
      if (disposed || !termOpened) return;
      const active = document.activeElement as HTMLElement | null;
      const typingElsewhere =
        !!active &&
        active !== document.body &&
        !containerRef.current?.contains(active) &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.isContentEditable);
      if (typingElsewhere) return;
      try {
        terminal.focus();
      } catch {
        /* ignore */
      }
    };

    const flushLive = () => {
      if (settleTimer) clearTimeout(settleTimer);
      if (maxTimer) clearTimeout(maxTimer);
      settleTimer = null;
      maxTimer = null;
      if (disposed) return;
      if (liveQueue.length === 0) return;
      const joined = liveQueue.join("");
      liveQueue = [];
      // Scroll in write()'s completion callback, NOT synchronously after it:
      // xterm parses writes asynchronously, so right after terminal.write() the
      // buffer (and the prompt position findPromptLine looks for) is still the
      // PRE-write state. scrollToBottom tolerated this because xterm auto-follows
      // once parsing finishes, but a computed scrollToLine would read stale rows
      // and land wrong. The callback runs after the data is applied.
      terminal.write(joined, () => {
        if (disposed) return;
        // First live chunk warms the canvas renderer if replay didn't (e.g. a
        // re-mount whose replay buffer was already drained). One-shot.
        ensureFirstPaint();
        if (!wantBottomRef.current) return;
        // Slash menu open → pin the `> ` prompt to the top so it stays visible
        // with the command list below it (xterm otherwise follows the parked
        // cursor to the bottom of the list). Else → follow the bottom normally.
        const promptLine = slashComposer ? findPromptLine() : null;
        if (promptLine !== null) {
          terminal.scrollToLine(promptLine);
        } else {
          terminal.scrollToBottom();
        }
      });
    };

    window.electronAPI.pty.onData(sessionId, (data) => {
      if (disposed) return;
      if (!termOpened) {
        pendingData.push(data);
        return;
      }
      liveQueue.push(data);
      // Reset settle timer on every chunk; flush once the stream goes quiet.
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(flushLive, SETTLE_MS);
      // Hard cap: flush no later than MAX_DELAY_MS after the first queued chunk.
      if (!maxTimer) {
        maxTimer = setTimeout(flushLive, MAX_DELAY_MS);
      }
    });

    // Replay buffered data — delayed to survive React StrictMode double-mount
    const replayTimer = window.setTimeout(() => {
      if (disposed) return;
      window.electronAPI.pty.replay(sessionId).then((buffered) => {
        if (disposed) return;
        if (!termOpened) {
          // Terminal hasn't opened yet (container had zero size) — hand the
          // backlog to the pendingData flush path, which repaints on flush.
          for (const chunk of buffered) pendingData.push(chunk);
          return;
        }
        const joined = buffered.join("");
        if (joined.length > 0) {
          // Single write; scroll + force the canvas's first paint in the
          // completion callback. Writes parse asynchronously, so the buffer is
          // only settled (and the repaint targets the right rows) once it runs.
          terminal.write(joined, () => {
            if (disposed) return;
            if (wantBottomRef.current) terminal.scrollToBottom();
            ensureFirstPaint();
          });
        }
        // Focus for immediate interaction, then nudge the alt-screen TUI to
        // re-emit its current frame. The nudge also covers the re-mount case
        // where the replay buffer was already drained (joined === "") — a
        // SIGWINCH-driven repaint is then the only way to recover the live frame.
        focusIfIdle();
        nudgePtyRepaint();
      });
    }, 200);

    // Flush pending data once terminal opens
    const flushInterval = setInterval(() => {
      if (disposed) {
        clearInterval(flushInterval);
        return;
      }
      if (termOpened && pendingData.length > 0) {
        // Single write + repaint in the completion callback, mirroring the
        // replay path. Data routed here — the replay backlog when the container
        // opened late (see the early-return above), or live chunks queued
        // before open — is the first thing the canvas renderer sees, so it
        // needs the one-shot first-paint kick too; otherwise the backlog can
        // sit blank until a later write drives another render cycle.
        const joined = pendingData.join("");
        pendingData.length = 0;
        terminal.write(joined, () => {
          if (disposed) return;
          // Initial flush — user hasn't had a chance to scroll yet, but guard
          // anyway in case data and a user wheel race at mount.
          if (wantBottomRef.current) terminal.scrollToBottom();
          ensureFirstPaint();
        });
        clearInterval(flushInterval);
      }
    }, 100);
    setTimeout(() => clearInterval(flushInterval), 10000);

    // Terminal → PTY (direct passthrough) — user typing rejoins auto-follow
    terminal.onData((data) => {
      if (disposed) return;
      wantBottomRef.current = true;
      trackComposer(data);
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

    let fitScheduled = false;
    const handleResize = () => {
      if (disposed || fitScheduled) return;
      fitScheduled = true;
      requestAnimationFrame(() => {
        fitScheduled = false;
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
      });
    };
    window.addEventListener("resize", handleResize);

    // ResizeObserver — mirrors TerminalView. The bottom panel can be
    // drag-resized and the sidebar / activity panel can collapse; all change
    // xterm's container size WITHOUT firing window.resize. Without this,
    // xterm.cols/rows go stale and Claude Code's Ink TUI renders into the rows
    // it *thinks* it has while the actual display is a different size →
    // previous frames stay visible / the viewport jumps up and down on each
    // message update (exactly the reported symptom).
    let resizeObserver: ResizeObserver | null = null;
    if (containerRef.current && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(containerRef.current);
    }

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
      if (settleTimer) clearTimeout(settleTimer);
      if (maxTimer) clearTimeout(maxTimer);
      if (nudgeRestoreTimer) clearTimeout(nudgeRestoreTimer);
      window.removeEventListener("resize", handleResize);
      resizeObserver?.disconnect();
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
