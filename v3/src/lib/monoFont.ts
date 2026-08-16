/**
 * Shared monospace stack for every code surface — the xterm terminals
 * (orchestrator + agent) and the Monaco code editor.
 *
 * Why a constant: the terminals previously hardcoded
 * `Menlo, Monaco, "Courier New", monospace`. Menlo and Monaco are macOS-only,
 * so on Windows the stack fell straight through to Courier New — a thin,
 * serif-ish face that breaks the box-drawing glyphs in Claude Code's TUI and
 * makes the Catppuccin palette look washed out (read on Windows as both the
 * "font" and "colors" feeling off). Monaco set no fontFamily at all, so the
 * editor used its per-platform default (Consolas on Windows) and looked
 * different from the terminals. One source of truth fixes both and keeps the
 * whole app's monospace consistent.
 *
 * Order is Windows-first but leaves macOS behavior unchanged:
 *   - Cascadia Code / Cascadia Mono  → ship with VS Code & Windows Terminal,
 *     excellent box-drawing, what most Windows devs already have installed
 *   - Menlo / Monaco / SF Mono       → native macOS faces (Mac unchanged)
 *   - Consolas                       → guaranteed on every Windows install,
 *     the real floor so we never hit Courier New again
 *   - DejaVu / Liberation Mono       → common Linux faces
 *   - Marblo D2Coding                → bundled OFL Korean coding font used
 *     when the OS stack lacks a CJK monospace face
 */
export const MONO_FONT_FAMILY =
  '"Cascadia Code", "Cascadia Mono", Menlo, Monaco, "SF Mono", Consolas, "DejaVu Sans Mono", "Liberation Mono", "Marblo D2Coding", monospace';

/**
 * Terminal-only stack: the bundled Korean face FIRST, then the same fallbacks.
 *
 * A terminal is a grid. xterm sizes its cell from the ASCII advance of the
 * first resolvable face and gives every Hangul syllable exactly two cells. If
 * ASCII and Hangul come from *different* faces, those two numbers stop
 * agreeing — and the leftover is drawn as space between characters. Measured
 * in the real app at 13px:
 *
 *   Menlo ASCII      7.827px  → 2-cell slot 15.653px
 *   D2Coding 한글     13.000px  → 2.65px of dead space per syllable
 *   system fallback  11.245px  → 4.41px  (what #659 actually shipped)
 *   D2Coding ASCII    6.500px  → 13.000 = exactly 2× — self-consistent
 *
 * So the residual 자간 is a metric mismatch, not a rasterisation problem:
 * putting D2Coding first makes the cell 6.5px and Hangul exactly two of them,
 * which closes the gap to zero. D2Coding is a coding face (fixed-width Latin,
 * box drawing), so it is a legitimate primary for a terminal — and because it
 * is bundled, every platform now gets identical terminal metrics.
 *
 * MONO_FONT_FAMILY is deliberately left alone: the Monaco editor has no
 * two-cell CJK grid to keep aligned, so there is no reason to change the face
 * developers already see there.
 */
export const TERMINAL_FONT_FAMILY = `"Marblo D2Coding", ${MONO_FONT_FAMILY}`;

export const XTERM_CJK_RENDER_OPTIONS = {
  allowProposedApi: true,
  rescaleOverlappingGlyphs: true,
} as const;

// ───────────────────────────────────────────────────────────────────────────
// Bundled-CJK-face load barrier.
//
// Bundling D2Coding and turning on rescaleOverlappingGlyphs (#659) was not
// enough: Korean scrollback still rendered with broken spacing. The reason is
// a timing hole, not a font-selection one.
//
// `Marblo D2Coding` is a webfont (@font-face in index.css). xterm 5.5.0 has
// zero awareness of the CSS Font Loading API — grep the bundle, there is not a
// single `document.fonts` reference. Every font-derived cache it keeps is
// therefore filled once, at `terminal.open()` time, from whatever faces are
// resolvable at that instant. A webfont is generally not one of them:
//
//   - the canvas/WebGL renderers bake a glyph texture atlas on first draw, so
//     Hangul gets rasterised from a proportional system fallback and stays
//     that way for the life of the atlas;
//   - the DOM renderer (the default for the agent terminals) fills a
//     `WidthCache` and derives the row container's **CSS letter-spacing** from
//     it — `letterSpacing = cell.width - widthCache.get("W")`. That is quite
//     literally the reported 자간 symptom, computed from the wrong face;
//   - `CharSizeService` measures the cell box from the same stale stack.
//
// Worse, canvas glyph atlases are cached process-wide and shared between
// terminals with an identical config, so a second terminal mounted long after
// the font landed still inherits the first one's fallback-baked atlas.
//
// And `document.fonts.load()` is not merely a timing probe here: a webfont is
// only fetched when something that matches it is *rendered*, and painting text
// through a canvas `ctx.font` does not count. Without an explicit load the
// canvas renderers may never trigger the download at all.
//
// So: wait for the face, then force every cache to drop.

/** Family name of the bundled OFL Korean coding face (see index.css). */
export const CJK_FONT_FAMILY = "Marblo D2Coding";

/**
 * Sample text used when asking the Font Loading API about the CJK face.
 * `check()`/`load()` default to a single space, which every fallback can
 * render; a Hangul syllable makes the query unambiguous.
 */
const CJK_SAMPLE_TEXT = "가";

/**
 * Build a family string that resolves to exactly the same faces as `family`
 * but is a *different string*.
 *
 * xterm's `OptionsService` guards its setter with `rawOptions[key] !== value`,
 * so re-assigning the identical family is a silent no-op — and every
 * invalidation we need hangs off that option-change event. Appending a
 * generic that any stack already ends in cannot change which face wins, so
 * alias → original is a round trip with no visual consequence. Both writes
 * happen in one synchronous task, so no frame is painted in between.
 *
 * Derived from the terminal's *current* family rather than a constant, so this
 * cannot drift from whatever stack a given terminal was constructed with.
 */
function aliasOf(family: string): string {
  return `${family}, monospace`;
}

/** CSS font shorthand naming the bundled CJK face at `fontSize` px. */
export function cjkFontSpec(fontSize: number): string {
  return `${fontSize}px "${CJK_FONT_FAMILY}"`;
}

function fontSet(): FontFaceSet | undefined {
  return typeof document === "undefined" ? undefined : document.fonts;
}

/** True once the bundled CJK face can actually render Hangul. */
export function isCjkFontLoaded(fontSize: number): boolean {
  try {
    return fontSet()?.check(cjkFontSpec(fontSize), CJK_SAMPLE_TEXT) ?? false;
  } catch {
    // Malformed shorthand would throw; treat as "not available".
    return false;
  }
}

// One download per renderer process, shared by every terminal that mounts.
let cjkFontLoad: Promise<boolean> | null = null;

/**
 * Fetch the bundled CJK face (once per renderer process).
 *
 * Resolves to whether the face ended up actually usable. A failed fetch is not
 * an error worth propagating — the terminal still works on the system stack —
 * but callers must not rebuild their caches for a face that never arrived.
 */
export function loadCjkFont(fontSize: number): Promise<boolean> {
  const fonts = fontSet();
  if (!fonts) return Promise.resolve(false);
  if (!cjkFontLoad) {
    // async IIFE, not `Promise.resolve().then(...)`: the body runs
    // synchronously up to the first await, so the fetch starts on this task
    // instead of a microtask later, while `try` still catches a sync throw.
    cjkFontLoad = (async () => {
      try {
        await fonts.load(cjkFontSpec(fontSize), CJK_SAMPLE_TEXT);
        // `ready` also covers any other face still in flight, so caches get
        // rebuilt against the final font state rather than a partial one.
        await fonts.ready;
      } catch (err) {
        console.warn("[monoFont] CJK font load failed:", err);
      }
      return isCjkFontLoaded(fontSize);
    })();
  }
  return cjkFontLoad;
}

/**
 * Barrier for xterm's first measurement pass.
 *
 * `terminal.open()` synchronously measures character cells and renderer
 * widths. If it runs before the bundled CJK face is usable, xterm caches the
 * fallback metrics and the terminal keeps the visible Hangul spacing gap until
 * every cache is explicitly rebuilt. Await this before `open()` whenever the
 * caller controls terminal creation.
 */
export function waitForTerminalCjkFontBeforeOpen(
  fontSize: number,
): Promise<boolean> {
  return loadCjkFont(fontSize);
}

/** Test seam — drops the memoised load so each case starts clean. */
export function resetCjkFontLoadForTests(): void {
  cjkFontLoad = null;
}

/**
 * Minimal surface of `Terminal` this module drives. Declared structurally so
 * the invalidation can be unit-tested without a DOM or a real xterm instance.
 */
export interface FontCacheInvalidatable {
  options: { fontFamily?: string; fontSize?: number };
  cols: number;
  rows: number;
  buffer?: { active?: { type?: string } };
  resize(cols: number, rows: number): void;
  clearTextureAtlas(): void;
  refresh(start: number, end: number): void;
}

export interface TerminalFontCacheRepairResult {
  activeBufferType: string;
  isAlternateScreen: boolean;
  cols: number;
  rows: number;
}

/**
 * Drop every font-derived cache in an already-opened terminal.
 *
 * Order matters. The `fontFamily` change is what invalidates `CharSizeService`
 * (cell box), the DOM renderer's `WidthCache` + letter-spacing, and triggers
 * RenderService's clear/resize/full-refresh. It does *not* clear the canvas
 * glyph atlas — and because the family ends up back at its original value, the
 * renderer re-acquires the very same process-wide cached atlas. So
 * `clearTextureAtlas()` has to come after, never before.
 *
 * `refresh()` only dirties rows currently owned by the viewport. The DOM renderer can keep
 * already-scrolled rows alive with their old inline spacing until a buffer reflow occurs. A
 * one-column xterm resize round trip reflows the complete normal buffer, so those scrollback
 * rows are laid out with the freshly measured WidthCache.
 *
 * That xterm-only resize is deliberately limited to the normal buffer. An alt-screen TUI
 * (Grok/Ink/etc.) owns the live frame itself; xterm can clear atlases but cannot re-layout the
 * TUI's cells. Callers must turn an alternate-buffer rebuild into a real PTY resize so the
 * child process receives SIGWINCH and redraws its current frame.
 */
export function invalidateTerminalFontCaches(
  terminal: FontCacheInvalidatable,
): TerminalFontCacheRepairResult {
  const activeBufferType = terminal.buffer?.active?.type ?? "normal";
  const isAlternateScreen = activeBufferType === "alternate";
  const family = terminal.options.fontFamily ?? TERMINAL_FONT_FAMILY;
  terminal.options.fontFamily = aliasOf(family);
  terminal.options.fontFamily = family;
  // No-op on the DOM renderer (it has no atlas); clears canvas/WebGL pages.
  terminal.clearTextureAtlas();
  const cols = terminal.cols;
  const rows = terminal.rows;
  if (cols > 0 && rows > 0) {
    // xterm's buffer resize is the public path that reflows every scrollback line. Restore the
    // original grid immediately so the PTY and the visible terminal keep their actual size.
    terminal.resize(cols + 1, rows);
    terminal.resize(cols, rows);
  }
  terminal.refresh(0, Math.max(0, terminal.rows - 1));
  return { activeBufferType, isAlternateScreen, cols, rows };
}

/**
 * Re-apply the CJK cache rebuild only after the bundled face is known-good.
 *
 * Completion/idle UI updates can trigger a renderer reflow long after the
 * initial font-load barrier ran. This gives callers a cheap guard for those
 * lifecycle nudges without kicking off font downloads or rebaking fallback
 * metrics when the face is unavailable.
 */
export function repairTerminalCjkFontCachesIfLoaded(
  terminal: FontCacheInvalidatable,
): TerminalFontCacheRepairResult | null {
  const fontSize = terminal.options.fontSize ?? 13;
  if (!isCjkFontLoaded(fontSize)) return null;
  return invalidateTerminalFontCaches(terminal);
}

interface BindCjkFontOptions {
  /** Prefix for the debug/warn logs, e.g. "OrchestratorTerminal". */
  label: string;
  /** True when the terminal has been torn down — skip the rebuild. */
  isStale: () => boolean;
  /** Run after a successful rebuild (cell metrics may have changed → refit). */
  onRebuilt?: (result: TerminalFontCacheRepairResult) => void;
}

/**
 * Call right after `terminal.open()`. Rebuilds the terminal's font caches once
 * the bundled CJK face is available — immediately if a previously mounted
 * terminal already pulled it in (that terminal may have left a stale shared
 * atlas behind), otherwise when the load settles.
 */
export function bindTerminalCjkFont(
  terminal: FontCacheInvalidatable,
  { label, isStale, onRebuilt }: BindCjkFontOptions,
): void {
  if (!fontSet()) return;
  const fontSize = terminal.options.fontSize ?? 13;

  const rebuild = (why: string) => {
    if (isStale()) return;
    try {
      const result = repairTerminalCjkFontCachesIfLoaded(terminal);
      if (result) {
        onRebuilt?.(result);
        console.debug(`[${label}] CJK glyph caches rebuilt (${why})`);
      }
    } catch (err) {
      console.warn(`[${label}] CJK glyph cache rebuild failed:`, err);
    }
  };

  if (isCjkFontLoaded(fontSize)) {
    rebuild("font already loaded");
    return;
  }
  // Only rebuild if the face genuinely arrived — rebaking against the same
  // fallback we already have would just be a wasted full refresh.
  void loadCjkFont(fontSize).then((loaded) => {
    if (loaded) rebuild("font finished loading");
  });
}
