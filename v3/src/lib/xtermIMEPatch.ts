import type { Terminal } from '@xterm/xterm';

/**
 * Korean/CJK IME latency fix — v4.3.
 *
 * v4.2 cleared textarea.value at compositionstart to keep the visible compose
 * strip showing only the current syllable. Race: original compositionend uses
 * setTimeout(0) (waitForPropagation pattern) to read textarea.value asynchronously.
 * If the user types fast enough that the next compositionstart fires before
 * the previous finalize setTimeout fires, our compositionstart clear wipes
 * the textarea before the previous syllable was read — committing the wrong
 * character (or nothing) to PTY.
 *
 * v4.3 makes compositionend fully synchronous: read textarea.value at
 * compositionend (Chromium reliably has it updated by then), call
 * triggerDataEvent, then clear textarea. No setTimeout pattern, no race.
 * Removes the compositionstart clear (no longer needed since compositionend
 * cleans up).
 *
 * Visual changes (per user request):
 *   - Remove dark backdrop (transparent background)
 *   - Larger font (1.3× terminal size)
 *   - More vertical padding (1.5× cell height)
 *   - Slightly higher off bottom edge
 */
export function patchTerminalForFastIME(terminal: Terminal): void {
  type Helper = {
    _isComposing: boolean;
    _compositionPosition: { start: number; end: number };
    _isSendingComposition: boolean;
    _dataAlreadySent: string;
    _textarea: HTMLTextAreaElement;
    _compositionView: HTMLElement;
    _bufferService: { buffer: { x: number; y: number; isCursorInViewport: boolean }; cols: number };
    _renderService: { dimensions: { css: { cell: { width: number; height: number } } } };
    _optionsService: { rawOptions: { fontFamily: string; fontSize: number; theme?: { foreground?: string; background?: string } } };
    _coreService: { triggerDataEvent: (data: string, fromUser: boolean) => void };
    compositionstart: () => void;
    compositionupdate: (ev: { data: string }) => void;
    compositionend: () => void;
    updateCompositionElements: (dontRecurse?: boolean) => void;
  };

  type Core = {
    _compositionHelper?: Helper;
    _helperContainer?: HTMLElement;
    element?: HTMLElement;
  };

  const core = (terminal as unknown as { _core?: Core })._core;
  const helper = core?._compositionHelper;
  const termElement = core?.element;

  if (!helper) {
    console.warn('[xtermIMEPatch] _compositionHelper not found — skipping patch');
    return;
  }

  // Inject CSS once. xterm's DOM renderer styles the cursor by adding the
  // .xterm-cursor (and one of -block, -bar, -underline, -outline) class to
  // the cell at cursor position; the visual block is the cell's BG color
  // matching the FG color (inversion). To hide it we have to override those
  // bg/color rules — visibility:hidden alone doesn't always win against
  // the cell's own painted background.
  const STYLE_ID = 'xterm-ime-patch-styles';
  if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
.xterm.ime-composing .xterm-cursor,
.xterm.ime-composing .xterm-cursor-block,
.xterm.ime-composing .xterm-cursor-bar,
.xterm.ime-composing .xterm-cursor-underline,
.xterm.ime-composing .xterm-cursor-outline {
  background-color: transparent !important;
  background: transparent !important;
  color: inherit !important;
  text-shadow: none !important;
  box-shadow: none !important;
  outline: none !important;
  border: none !important;
}
.xterm.ime-composing .xterm-cursor-blink { animation: none !important; }
`;
    document.head.appendChild(style);
  }

  // No helpers-container resizing — strip removed in v4.11. textarea stays
  // at its default xterm position (synced to cursor by _syncTextArea, hidden
  // via opacity:0 + z-index:-5). Reverting our v4.1 expansion eliminates
  // the large layout-invalidation surface that was being repainted during
  // composition.

  helper.updateCompositionElements = function () {
    /* no-op: compose strip handled in compositionstart/end below */
  };

  // Strip lifecycle state across composition cycles.
  //   fadeOutTimer: set after fade triggers; clears inline styles when fade ends.
  //   pendingFade:  true between compositionend and PTY echo arrival. Strip stays
  //                 fully visible during this window so the user sees the
  //                 committed syllable until the grid actually shows it.
  //   fadeFallbackTimer: safety net in case PTY echo doesn't arrive (e.g., the
  //                 shell is processing slowly). Forces fade after 400ms.
  let fadeOutTimer: number | null = null;
  let pendingFade = false;
  let fadeFallbackTimer: number | null = null;

  const triggerFadeOut = () => {
    // textarea is no longer styled as a strip — nothing to fade. Kept as a
    // function so the existing call sites stay consistent; if we add visual
    // strip back, this is where it'd reset.
  };

  // Cursor-position overlay: shows the in-progress / committed character at
  // the actual cursor location. Updated on each compositionupdate so the user
  // sees ㅎ→하→한 progress at the cursor in real time — not just after
  // commit. xterm's grid stays clean (no local echo collision); the overlay
  // is a DOM element on top, removed when the grid catches up via PTY echo.
  const showCursorOverlay = (input: string) => {
    const buffer = helper._bufferService.buffer;
    if (!buffer.isCursorInViewport) return;

    const opts = helper._optionsService.rawOptions;
    const cell = helper._renderService.dimensions.css.cell;
    const cursorX = Math.min(buffer.x, helper._bufferService.cols - 1);
    const cursorTop = buffer.y * cell.height;
    const cursorLeft = cursorX * cell.width;
    const widthCells = (input.charCodeAt(0) > 0xFF) ? 2 : 1;
    const fg = opts.theme?.foreground || '#cdd6f4';
    const bg = opts.theme?.background || '#1e1e2e';

    const view = helper._compositionView;
    view.textContent = input;
    view.style.left = cursorLeft + 'px';
    view.style.top = cursorTop + 'px';
    view.style.width = widthCells * cell.width + 'px';
    view.style.height = cell.height + 'px';
    view.style.lineHeight = cell.height + 'px';
    view.style.fontFamily = opts.fontFamily;
    view.style.fontSize = opts.fontSize + 'px';
    view.style.color = fg;
    view.style.background = bg;
    view.style.zIndex = '1000';
    view.style.transition = 'opacity 100ms ease-out';
    view.style.opacity = '1';
    view.style.padding = '0';
    view.style.margin = '0';
    view.classList.add('active');
  };

  const hideCursorOverlay = () => {
    const view = helper._compositionView;
    view.style.opacity = '0';
    window.setTimeout(() => {
      view.classList.remove('active');
      view.textContent = '';
      view.style.left = '';
      view.style.top = '';
      view.style.width = '';
      view.style.height = '';
      view.style.lineHeight = '';
      view.style.fontFamily = '';
      view.style.fontSize = '';
      view.style.color = '';
      view.style.background = '';
      view.style.zIndex = '';
      view.style.transition = '';
      view.style.opacity = '';
      view.style.padding = '';
      view.style.margin = '';
    }, 110);
  };

  // Hook xterm's onWriteParsed: fires after a write chunk is parsed (i.e., the
  // grid has been updated with PTY echo). When we're in the post-compositionend
  // window, this is our cue that the committed syllable is now visible in the
  // grid — so the strip can fade out with no perceptual gap. Without this,
  // fade fires on a fixed timer and may finish before or after PTY echo,
  // causing either premature blanking or strip/grid double-display.
  terminal.onWriteParsed(() => {
    if (pendingFade) {
      pendingFade = false;
      if (fadeFallbackTimer !== null) {
        clearTimeout(fadeFallbackTimer);
        fadeFallbackTimer = null;
      }
      triggerFadeOut();
      hideCursorOverlay();
      // Restore xterm cursor only if no composition is currently active.
      // For fast typing, a new composition may have started before the
      // previous syllable's echo arrived — keep cursor hidden until idle.
      if (!helper._isComposing && termElement) {
        termElement.classList.remove('ime-composing');
      }
    }
  });

  helper.compositionstart = function () {
    // Cancel anything in-flight from the previous composition.
    if (fadeOutTimer !== null) {
      clearTimeout(fadeOutTimer);
      fadeOutTimer = null;
    }
    if (fadeFallbackTimer !== null) {
      clearTimeout(fadeFallbackTimer);
      fadeFallbackTimer = null;
    }
    pendingFade = false;
    hideCursorOverlay();

    // Hide xterm's cursor while the overlay is showing — prevents cursor from
    // rendering through the overlay character. Removed in onWriteParsed when
    // grid catches up (cursor naturally re-emerges at advanced position).
    if (termElement) termElement.classList.add('ime-composing');

    this._isComposing = true;
    this._compositionPosition.start = this._textarea.value.length;
    this._dataAlreadySent = '';

    // No textarea styling — we keep textarea hidden (xterm's default opacity:0,
    // z-index:-5). The cursor-position overlay (compositionView) handles all
    // visible feedback. Previously v4.5–v4.10 styled the textarea as a visible
    // compose strip, but that triggered expensive style recalc + paint on
    // every composition update (Performance profile flagged the textarea as
    // hot). Overlay alone gives the same UX with much lower main-thread cost.
  };

  helper.compositionupdate = function (ev) {
    setTimeout(() => {
      this._compositionPosition.end = this._textarea.value.length;
    }, 0);

    // Show in-progress char at cursor in real time. ev.data is the current
    // composition string (e.g., "ㅎ" → "하" → "한" as user types each jamo).
    // User sees char build up at cursor without waiting for compositionend.
    if (ev.data) {
      showCursorOverlay(ev.data);
    }
  };

  helper.compositionend = function () {
    // Synchronous finalize. Chromium has textarea.value fully updated by the
    // time compositionend fires (xterm's setTimeout pattern was for browsers
    // where this isn't true — not Electron's Chromium). Read sync, send sync,
    // clear sync. No setTimeout means no race with subsequent compositionstart.
    this._compositionView.classList.remove('active');
    this._isComposing = false;
    this._isSendingComposition = false;

    const start = this._compositionPosition.start + this._dataAlreadySent.length;
    const value = this._textarea.value;
    const input = value.substring(start);

    if (input.length > 0) {
      // Send to PTY (no local echo to grid — that collides with TUI redraws).
      this._coreService.triggerDataEvent(input, true);
      // Show overlay at cursor position immediately. xterm grid stays clean;
      // the overlay is a DOM layer on top, removed when grid catches up.
      // Gives "real-time at cursor" feel without grid corruption.
      showCursorOverlay(input);
    }

    this._textarea.value = '';
    this._compositionPosition.start = 0;
    this._compositionPosition.end = 0;

    // Defer fade until PTY echo updates the grid. If shell is slow or echo
    // never comes, fall back to fading after 400ms so strip doesn't hang.
    pendingFade = true;
    fadeFallbackTimer = window.setTimeout(() => {
      fadeFallbackTimer = null;
      if (pendingFade) {
        pendingFade = false;
        triggerFadeOut();
        hideCursorOverlay();
        if (!helper._isComposing && termElement) {
          termElement.classList.remove('ime-composing');
        }
      }
    }, 400);
  };
}
