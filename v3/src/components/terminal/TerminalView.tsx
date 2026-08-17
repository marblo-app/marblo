import { useEffect, useRef, memo } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { patchTerminalForFastIME } from "../../lib/xtermIMEPatch";
import { resolveClipboardForTerminal } from "../../utils/clipboardImage";
import {
  TERMINAL_FONT_FAMILY,
  XTERM_CJK_RENDER_OPTIONS,
  bindTerminalCjkFont,
  repairTerminalCjkFontCachesIfLoaded,
  waitForTerminalCjkFontBeforeOpen,
} from "../../lib/monoFont";
import { t } from "../../lib/i18n";

interface TerminalViewProps {
  sessionId: string;
  isActive: boolean;
  activityState?: string;
  // Mimics Claude `/agents` view: pressing ← with an empty input line
  // drills out of the focused agent back to the list. We track keystrokes
  // sent via `terminal.onData` to estimate input length — when it's 0,
  // ArrowLeft is captured (xterm won't send `\x1b[D` to PTY) and this
  // callback fires instead.
  onLeftWhenEmpty?: () => void;
}

interface TerminalDebugSnapshot {
  sessionId: string;
  cols: number;
  rows: number;
  activeBufferType: string;
  fontFamily: string;
  fontSize: number;
}

type TerminalDebugRegistry = Record<string, () => TerminalDebugSnapshot | null>;

declare global {
  interface Window {
    __marbloTerminalDebug?: TerminalDebugRegistry;
  }
}

export default memo(function TerminalView({
  sessionId,
  isActive,
  activityState,
  onLeftWhenEmpty,
}: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const initializedRef = useRef(false);
  const repairCjkCachesRef = useRef<(reason: string) => void>(() => {});
  const resumeRenderRef = useRef<(reason: string) => void>(() => {});
  const lastActivityStateRef = useRef<string | undefined>(activityState);
  // Shared scroll-follow state — user-input-driven (see effect for details).
  const wantBottomRef = useRef(true);
  // Best-effort estimate of the user's current input line length. Reset to
  // 0 on Enter / Ctrl-C / Ctrl-U; we don't see Claude's actual input box
  // state, but the tracker is good enough to gate the "← drills out when
  // empty" behavior (false positives would be momentary — user types one
  // char and tracker leaves 0).
  const inputLenRef = useRef(0);
  // Keep callback in a ref so a fresh prop reference doesn't tear down
  // the entire terminal init effect.
  const onLeftWhenEmptyRef = useRef(onLeftWhenEmpty);
  useEffect(() => {
    onLeftWhenEmptyRef.current = onLeftWhenEmpty;
  }, [onLeftWhenEmpty]);

  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return;
    initializedRef.current = true;

    // Guard flag prevents StrictMode's first-mount rAF from firing after cleanup
    let disposed = false;

    const terminal = new Terminal({
      ...XTERM_CJK_RENDER_OPTIONS,
      cursorBlink: false, // periodic redraw was contributing to RAF queue saturation
      // 숨긴 탭도 버퍼를 메모리에 유지하므로(visibility 토글, 언마운트 아님)
      // 에이전트가 많을수록 누적된다. 기본 1000줄 → 500줄로 캡해 renderer
      // RAM 을 낮춘다(스크롤 히스토리 길이만 단축, 기능 무해).
      scrollback: 500,
      fontSize: 13,
      fontFamily: TERMINAL_FONT_FAMILY,
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

    if (window.electronAPI?.testMode?.bypassAuth) {
      window.__marbloTerminalDebug ??= {};
      window.__marbloTerminalDebug[sessionId] = () => ({
        sessionId,
        cols: terminal.cols,
        rows: terminal.rows,
        activeBufferType: terminal.buffer.active.type,
        fontFamily: terminal.options.fontFamily ?? "",
        fontSize: terminal.options.fontSize ?? 13,
      });
    }

    const refitTerminal = () => {
      try {
        fitAddon.fit();
      } catch {
        /* ignore */
      }
    };
    const refreshTerminal = () => {
      try {
        terminal.refresh(0, Math.max(0, terminal.rows - 1));
      } catch {
        /* ignore */
      }
    };
    let nudgeRestoreTimer: ReturnType<typeof setTimeout> | null = null;
    let nudgePtyRepaint: (reason?: string) => void = () => {};
    let cjkRepairFrame: number | null = null;
    const scheduleCjkCacheRepair = (reason: string) => {
      if (disposed || cjkRepairFrame !== null) return;
      cjkRepairFrame = requestAnimationFrame(() => {
        cjkRepairFrame = null;
        if (disposed || !termOpened) return;
        try {
          const repair = repairTerminalCjkFontCachesIfLoaded(terminal);
          if (repair) {
            refitTerminal();
            if (repair.isAlternateScreen) {
              nudgePtyRepaint(`CJK font repair ${reason}`);
            }
            console.debug(
              `[TerminalView] CJK glyph caches repaired (${reason})`,
            );
          }
        } catch (err) {
          console.warn("[TerminalView] CJK glyph cache repair failed:", err);
        }
      });
    };
    repairCjkCachesRef.current = scheduleCjkCacheRepair;

    let resumeRenderFrame: number | null = null;
    const scheduleResumeRender = (reason: string) => {
      if (disposed || resumeRenderFrame !== null) return;
      resumeRenderFrame = requestAnimationFrame(() => {
        resumeRenderFrame = null;
        if (disposed || !termOpened) return;
        refitTerminal();
        refreshTerminal();
        scheduleCjkCacheRepair(`resume ${reason}`);
      });
    };
    resumeRenderRef.current = scheduleResumeRender;

    // Drill-out gate: plain ArrowLeft with no modifiers AND an empty
    // estimated input line fires onLeftWhenEmpty instead of sending
    // `\x1b[D` to the PTY. Returning false from this handler stops xterm
    // from emitting the data event for this keystroke. Any modifier
    // (shift/alt/meta/ctrl) is left to xterm so power-user combos still
    // reach the CLI (e.g., Claude's word-jump bindings).
    terminal.attachCustomKeyEventHandler((e) => {
      if (
        e.type === "keydown" &&
        e.key === "ArrowLeft" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey &&
        inputLenRef.current === 0 &&
        onLeftWhenEmptyRef.current
      ) {
        onLeftWhenEmptyRef.current();
        return false;
      }
      // Cmd/Ctrl+V — paste explicitly. The native menu paste does not
      // reliably reach xterm's hidden textarea after an OAuth browser
      // round-trip (typing works, paste is lost), which broke pasting auth
      // tokens (e.g. Antigravity `agy` login). Read the clipboard ourselves
      // and inject via terminal.paste(), which respects bracketed-paste mode.
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

    let openRetries = 0;
    let termOpened = false;
    const pendingData: string[] = [];
    let initialResumeTimer: ReturnType<typeof setTimeout> | null = null;
    // Alt-screen TUI re-emit nudge. A resumed agent (claude --continue /
    // --resume after an app restart) reattaches to a LIVE pty, but its Ink TUI
    // runs in alternate-screen mode and does NOT redraw its current frame on
    // reattach — and the replay ring no longer holds the alt-screen-enter
    // sequence, so there's nothing to reconstruct the frame from either. The
    // terminal therefore stays blank until the user presses a key. Bumping
    // cols by one and restoring delivers a real SIGWINCH (the kernel only
    // signals on an actual size change), which makes Ink repaint the whole
    // frame. We also reuse it after CJK font cache rebuilds: xterm's internal
    // resize only reflows the normal buffer, while alt-screen TUIs must redraw
    // their own cells after the renderer switches from fallback to D2Coding.
    nudgePtyRepaint = (reason = "pty repaint nudge") => {
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
          scheduleResumeRender(reason);
        }, 50);
      } catch {
        /* ignore */
      }
    };

    // Clear any ghost xterm DOM from StrictMode's previous mount
    if (containerRef.current) {
      containerRef.current.innerHTML = "";
    }

    let openInFlight = false;
    const openTerminal = async (el: HTMLDivElement) => {
      if (disposed || openInFlight || termOpened) return;
      openInFlight = true;
      try {
        await waitForTerminalCjkFontBeforeOpen(terminal.options.fontSize ?? 13);
        if (disposed || termOpened) return;
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
            console.debug("[TerminalView] WebGL renderer active");
          } catch (err) {
            console.warn(
              "[TerminalView] WebGL init failed, using DOM renderer:",
              err,
            );
          }
        }

        // Agent terminals run the DOM renderer by default, whose row
        // letter-spacing is derived from a WidthCache filled at open() — with
        // the bundled Korean webfont still unloaded, that is exactly the
        // broken 한글 자간 in scrollback. Rebuild once the face lands.
        // See lib/monoFont.ts.
        bindTerminalCjkFont(terminal, {
          label: "TerminalView",
          isStale: () => disposed || !termOpened,
          // Cell metrics can change with the face, so cols/rows must be
          // recomputed (and the PTY told) rather than left at the old grid.
          onRebuilt: (repair) => {
            refitTerminal();
            if (repair.isAlternateScreen) {
              nudgePtyRepaint("CJK font rebuild");
            }
          },
        });

        scheduleResumeRender("initial open");
        initialResumeTimer = setTimeout(() => {
          initialResumeTimer = null;
          if (disposed || !termOpened) return;
          scheduleResumeRender("initial settle");
          nudgePtyRepaint("initial open");
        }, 80);
      } catch (err) {
        console.warn("[TerminalView] xterm open failed:", err);
      } finally {
        openInFlight = false;
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
    // Settle-window batching for live PTY chunks. Busy TUI apps (Gemini Ink,
    // Claude Code streaming) emit a SINGLE logical redraw (e.g. arrow-key
    // menu navigation) as several stdout flushes spaced 5-40ms apart. With
    // pure rAF batching the first flush rendered the "cleared" frame and the
    // following flush(es) rendered the new content one frame later → user
    // saw a flash of blank between them on every keypress.
    //
    // Strategy: queue chunks and wait SETTLE_MS of silence before flushing.
    // If silence never comes (continuous stream), force-flush at MAX_DELAY_MS
    // so terminal echo never exceeds that. Empirically 28ms settle / 80ms cap
    // eliminates Gemini menu-navigation flicker while keeping echo invisible
    // for AI-agent streaming.
    const SETTLE_MS = 28;
    const MAX_DELAY_MS = 80;
    let liveQueue: string[] = [];
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let maxTimer: ReturnType<typeof setTimeout> | null = null;
    const flushLive = () => {
      if (settleTimer) clearTimeout(settleTimer);
      if (maxTimer) clearTimeout(maxTimer);
      settleTimer = null;
      maxTimer = null;
      if (disposed) return;
      if (liveQueue.length === 0) return;
      const joined = liveQueue.join("");
      liveQueue = [];
      terminal.write(joined);
      if (wantBottomRef.current) terminal.scrollToBottom();
    };
    window.electronAPI.pty.onData(sessionId, (data) => {
      hasReceivedData = true;
      if (disposed) return;
      if (!termOpened) {
        pendingData.push(data);
        return;
      }
      liveQueue.push(data);
      // Reset settle timer on every new chunk; flush once the stream goes
      // quiet for SETTLE_MS.
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(flushLive, SETTLE_MS);
      // Hard cap: even with continuous chunks, flush no later than
      // MAX_DELAY_MS after the first queued chunk.
      if (!maxTimer) {
        maxTimer = setTimeout(flushLive, MAX_DELAY_MS);
      }
    });

    const replayTimer = window.setTimeout(() => {
      if (disposed) return;
      window.electronAPI.pty.replay(sessionId).then(async (buffered) => {
        if (disposed) return;
        if (buffered.length > 0) hasReceivedData = true;
        for (const chunk of buffered) {
          if (termOpened) {
            terminal.write(chunk);
          } else {
            pendingData.push(chunk);
          }
        }
        // Empty buffer can mean two things:
        //   (a) PTY is genuinely dead (e.g. after app restart) → warn.
        //   (b) PTY is alive but this is a re-mount (collapse + reopen in
        //       AgentListPanel) OR a resumed agent whose buffer was already
        //       drained. The buffer is length 0 even though the pty is fine.
        // Probe pty:exists to disambiguate: warn for case (a), nudge a repaint
        // for case (b) so a resumed alt-screen TUI re-emits its frame instead
        // of sitting blank until the user presses a key.
        if (!hasReceivedData && termOpened) {
          const alive = await window.electronAPI.pty
            .exists(sessionId)
            .catch(() => false);
          if (disposed) return;
          if (!alive) {
            terminal.write(
              `\r\n\x1b[33m  ⚠ ${t("terminal.session.expired")}\x1b[0m\r\n`,
            );
            terminal.write(
              `\x1b[90m  ${t("terminal.session.expiredReason")}\x1b[0m\r\n`,
            );
            terminal.write(
              `\x1b[90m  ${t("terminal.session.restartHint")}\x1b[0m\r\n\r\n`,
            );
          } else {
            nudgePtyRepaint("alive silent replay");
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

    // Terminal → PTY (stdin) — user typing means "rejoin auto-follow"
    terminal.onData((data) => {
      if (disposed) return;
      wantBottomRef.current = true;
      // Track input line length so onLeftWhenEmpty can gate the drill-out
      // shortcut. We never see the CLI's actual prompt buffer, so this is
      // a heuristic over what was sent on stdin since the last submit /
      // line-clear. Escape sequences (cursor moves, arrows, function keys)
      // start with ESC and shouldn't count as typed characters.
      if (!data.startsWith("\x1b")) {
        if (data === "\r" || data === "\n") {
          inputLenRef.current = 0;
        } else if (data === "\x7f" || data === "\b") {
          // DEL or BS — single-char backspace
          inputLenRef.current = Math.max(0, inputLenRef.current - 1);
        } else if (data === "\x03" || data === "\x15") {
          // Ctrl-C (SIGINT) or Ctrl-U (kill line) — input cleared
          inputLenRef.current = 0;
        } else {
          // Treat anything else (printable runs, paste, Tab) as typed
          // input. Tab might insert N completion chars; we approximate by
          // the data length sent. False-high by a small amount is fine —
          // the gate only fires when len exactly equals 0.
          inputLenRef.current += data.length;
        }
      }
      window.electronAPI.pty.write(sessionId, data);
    });

    // Handle PTY exit
    window.electronAPI.pty.onExit(sessionId, (code) => {
      if (disposed) return;
      terminal.write(
        `\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m\r\n`,
      );
      scheduleCjkCacheRepair("pty exit");
    });

    // Resize handler
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
            refreshTerminal();
            scheduleCjkCacheRepair("container resize");
          }
        } catch {
          /* ignore */
        }
      });
    };
    window.addEventListener("resize", handleResize);

    // ResizeObserver — the bottom panel can be drag-resized and the sidebar
    // can collapse; both change xterm's container size without firing
    // window.resize. Without this, xterm.cols/rows go stale and Gemini's
    // Ink TUI renders into "rows it thinks it has" while the actual display
    // is larger → previous frames stay visible above the new render
    // (observed: two stacked copies of the input box + footer).
    let resizeObserver: ResizeObserver | null = null;
    if (containerRef.current && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(containerRef.current);
    }

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
      if (settleTimer) clearTimeout(settleTimer);
      if (maxTimer) clearTimeout(maxTimer);
      if (nudgeRestoreTimer) clearTimeout(nudgeRestoreTimer);
      if (initialResumeTimer) clearTimeout(initialResumeTimer);
      if (cjkRepairFrame !== null) cancelAnimationFrame(cjkRepairFrame);
      if (resumeRenderFrame !== null) cancelAnimationFrame(resumeRenderFrame);
      window.removeEventListener("resize", handleResize);
      resizeObserver?.disconnect();
      wrapperEl?.removeEventListener("wheel", onWheel, wheelOpts);
      wrapperEl?.removeEventListener("keydown", onKeyDown, keyOpts);
      viewportEl?.removeEventListener("wheel", onWheel, wheelOpts);
      viewportEl?.removeEventListener("keydown", onKeyDown, keyOpts);
      window.electronAPI.pty.removeListeners(sessionId);
      terminal.dispose();
      if (window.__marbloTerminalDebug?.[sessionId]) {
        delete window.__marbloTerminalDebug[sessionId];
      }
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
      terminalRef.current = null;
      fitAddonRef.current = null;
      repairCjkCachesRef.current = () => {};
      resumeRenderRef.current = () => {};
      initializedRef.current = false;
    };
  }, [sessionId]);

  useEffect(() => {
    const previous = lastActivityStateRef.current;
    lastActivityStateRef.current = activityState;
    if (!activityState || previous === activityState) return;

    const prev = previous?.toLowerCase();
    const next = activityState.toLowerCase();
    const wasBusy =
      prev === "starting" ||
      prev === "running" ||
      prev === "working" ||
      prev === "in_progress";
    const isBusy =
      next === "starting" ||
      next === "running" ||
      next === "working" ||
      next === "in_progress";
    if (wasBusy && !isBusy) {
      repairCjkCachesRef.current(`activity ${previous}->${activityState}`);
    }
  }, [activityState]);

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
        resumeRenderRef.current("tab active");
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
        // Use visibility (not display:none) so the element retains
        // dimensions while hidden — xterm.open() needs clientWidth/Height
        // to size its grid, and AgentListPanel now keeps a TerminalView
        // mounted per session across focus card switches / list↔focus
        // transitions (state persistence like Claude's /agents view).
        // display:none would zero clientWidth and break the initial open.
        visibility: isActive ? "visible" : "hidden",
        pointerEvents: isActive ? "auto" : "none",
        // Isolate terminal layout/paint from the parent React/Tailwind tree.
        // xterm grid updates trigger DOM layout — without containment that
        // cascades through Sidebar, Header, etc. (~115ms per typing burst).
        contain: "layout style paint",
      }}
    />
  );
});
