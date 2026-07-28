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

export const XTERM_CJK_RENDER_OPTIONS = {
  allowProposedApi: true,
  rescaleOverlappingGlyphs: true,
} as const;
