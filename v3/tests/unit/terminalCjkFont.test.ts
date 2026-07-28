import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, readFileSync } from "fs";
import path from "path";
import {
  MONO_FONT_FAMILY,
  TERMINAL_FONT_FAMILY,
  CJK_FONT_FAMILY,
  cjkFontSpec,
  isCjkFontLoaded,
  invalidateTerminalFontCaches,
  bindTerminalCjkFont,
  resetCjkFontLoadForTests,
  type FontCacheInvalidatable,
} from "../../src/lib/monoFont";

const V3 = path.resolve(__dirname, "../..");

/**
 * Records the order of every cache-invalidating call so the tests can assert
 * the *sequence*, not just that each call happened — order is load-bearing
 * here (see invalidateTerminalFontCaches).
 */
function fakeTerminal(fontSize = 13) {
  const calls: string[] = [];
  const term = {
    cols: 80,
    rows: 24,
    options: {
      fontSize,
      _fontFamily: TERMINAL_FONT_FAMILY,
      get fontFamily() {
        return this._fontFamily;
      },
      set fontFamily(v: string) {
        // Mirror xterm's OptionsService, which drops same-value writes:
        //   `rawOptions[key] !== value && (rawOptions[key] = value, fire())`
        if (this._fontFamily === v) return;
        this._fontFamily = v;
        calls.push(`fontFamily=${v}`);
      },
    },
    resize: (cols: number, rows: number) =>
      calls.push(`resize(${cols},${rows})`),
    clearTextureAtlas: () => calls.push("clearTextureAtlas"),
    refresh: (a: number, b: number) => calls.push(`refresh(${a},${b})`),
  };
  return { term: term as unknown as FontCacheInvalidatable, calls };
}

/**
 * Stand-in for `document.fonts`. When the face starts out unloaded, a
 * successful `load()` flips `check()` to true — the same transition the real
 * FontFaceSet makes, and the signal the rebuild is gated on.
 */
function installFontSet(check: boolean) {
  const fonts = {
    check: vi.fn().mockReturnValue(check),
    load: vi.fn(),
    ready: Promise.resolve(),
  };
  fonts.load.mockImplementation(async () => {
    fonts.check.mockReturnValue(true);
    return [];
  });
  (globalThis as { document?: unknown }).document = { fonts };
  return fonts;
}

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
  resetCjkFontLoadForTests();
  vi.restoreAllMocks();
});

describe("bundled CJK font asset", () => {
  // The #659 regression this guards: the .ttf was committed to `v3/public/`,
  // but vite.config.ts sets `root: "src"`, so Vite's publicDir is
  // `v3/src/public`. The font was copied nowhere — dev and packaged builds
  // both answered /fonts/... with the SPA index.html (Content-Type text/html),
  // which Chromium refuses to parse as a font. D2Coding never loaded at all.
  const publicDir = path.join(V3, "src", "public");
  const fontRelPath = "fonts/d2coding/D2Coding-Regular.ttf";

  it("sits inside Vite's publicDir so /fonts/... is actually served", () => {
    expect(existsSync(path.join(publicDir, fontRelPath))).toBe(true);
  });

  it("ships its OFL license next to the face", () => {
    expect(existsSync(path.join(publicDir, "fonts/d2coding/OFL.txt"))).toBe(
      true,
    );
  });

  it("is not left behind in the non-publicDir v3/public", () => {
    expect(existsSync(path.join(V3, "public", fontRelPath))).toBe(false);
  });

  it("@font-face src resolves to the served asset", () => {
    const css = readFileSync(path.join(V3, "src/index.css"), "utf-8");
    const face = /@font-face\s*{[^}]*Marblo D2Coding[^}]*}/.exec(css)?.[0];
    expect(face).toBeTruthy();
    const url = /url\(["']?([^"')]+)["']?\)/.exec(face!)?.[1];
    expect(url).toBe(`/${fontRelPath}`);
    // Absolute-from-root URL + publicDir placement must agree.
    expect(existsSync(path.join(publicDir, url!.replace(/^\//, "")))).toBe(
      true,
    );
  });

  it("is reachable from the shared monospace stack", () => {
    expect(MONO_FONT_FAMILY).toContain(`"${CJK_FONT_FAMILY}"`);
  });
});

describe("TERMINAL_FONT_FAMILY", () => {
  // Measured live at 13px: Menlo ASCII 7.827px → 2-cell slot 15.653px, while
  // D2Coding 한글 is 13.000px — 2.65px of dead space per syllable, which is
  // the residual 자간 even once the face loads. D2Coding's own ASCII is
  // 6.500px and 13.000 = exactly 2×, so it only lines up when the SAME face
  // supplies both. That means it has to win the stack, not close it.
  it("puts the bundled CJK face first so ASCII and 한글 share one face", () => {
    expect(TERMINAL_FONT_FAMILY.startsWith(`"${CJK_FONT_FAMILY}"`)).toBe(true);
  });

  it("keeps the original fallbacks behind it", () => {
    expect(TERMINAL_FONT_FAMILY).toContain(MONO_FONT_FAMILY);
    expect(TERMINAL_FONT_FAMILY.endsWith("monospace")).toBe(true);
  });

  it("leaves the Monaco/editor stack untouched", () => {
    // The editor has no two-cell CJK grid to keep aligned, so there is no
    // reason to change the face developers already see there.
    expect(MONO_FONT_FAMILY.startsWith(`"${CJK_FONT_FAMILY}"`)).toBe(false);
  });
});

describe("cjkFontSpec", () => {
  it("builds a quoted CSS font shorthand the Font Loading API accepts", () => {
    expect(cjkFontSpec(13)).toBe('13px "Marblo D2Coding"');
  });
});

describe("isCjkFontLoaded", () => {
  it("is false with no document (main process / node tests)", () => {
    expect(isCjkFontLoaded(13)).toBe(false);
  });

  it("asks the Font Loading API with Hangul sample text", () => {
    const fonts = installFontSet(true);
    expect(isCjkFontLoaded(13)).toBe(true);
    expect(fonts.check).toHaveBeenCalledWith('13px "Marblo D2Coding"', "가");
  });

  it("swallows a check() throw rather than breaking terminal init", () => {
    installFontSet(true).check.mockImplementation(() => {
      throw new Error("invalid shorthand");
    });
    expect(isCjkFontLoaded(13)).toBe(false);
  });
});

describe("invalidateTerminalFontCaches", () => {
  it("writes a genuinely different fontFamily before restoring it", () => {
    const { term, calls } = fakeTerminal();
    invalidateTerminalFontCaches(term);
    // A same-value write is a no-op in xterm, so the alias hop is the only
    // thing that makes CharSizeService / WidthCache / RenderService react.
    const familyWrites = calls.filter((c) => c.startsWith("fontFamily="));
    expect(familyWrites).toHaveLength(2);
    expect(familyWrites[0]).not.toBe(`fontFamily=${TERMINAL_FONT_FAMILY}`);
    expect(familyWrites[1]).toBe(`fontFamily=${TERMINAL_FONT_FAMILY}`);
  });

  it("leaves the terminal on the intended stack", () => {
    const { term } = fakeTerminal();
    invalidateTerminalFontCaches(term);
    expect(term.options.fontFamily).toBe(TERMINAL_FONT_FAMILY);
  });

  it("uses an alias that resolves to the same faces", () => {
    const { term, calls } = fakeTerminal();
    invalidateTerminalFontCaches(term);
    const alias = calls[0].replace("fontFamily=", "");
    // Appending to a stack already terminated by `monospace` cannot change
    // which face wins, so the intermediate state is visually identical.
    expect(alias.startsWith(TERMINAL_FONT_FAMILY)).toBe(true);
    expect(TERMINAL_FONT_FAMILY.endsWith("monospace")).toBe(true);
  });

  it("clears the atlas, reflows the full buffer, then refreshes the viewport", () => {
    const { term, calls } = fakeTerminal();
    invalidateTerminalFontCaches(term);
    // Ending back on the original family makes xterm re-acquire the same
    // process-wide cached atlas, so clearing first would be undone.
    expect(calls).toEqual([
      expect.stringMatching(/^fontFamily=/),
      `fontFamily=${TERMINAL_FONT_FAMILY}`,
      "clearTextureAtlas",
      "resize(81,24)",
      "resize(80,24)",
      "refresh(0,23)",
    ]);
  });

  it("never asks for a negative refresh range on a zero-row terminal", () => {
    const { term, calls } = fakeTerminal();
    (term as unknown as { rows: number }).rows = 0;
    invalidateTerminalFontCaches(term);
    expect(calls).toContain("refresh(0,0)");
  });

  it("skips the reflow when the terminal has no live grid", () => {
    const { term, calls } = fakeTerminal();
    (term as unknown as { cols: number; rows: number }).cols = 0;
    (term as unknown as { rows: number }).rows = 0;
    invalidateTerminalFontCaches(term);
    expect(calls).not.toContain("resize(81,0)");
    expect(calls).toContain("refresh(0,0)");
  });
});

describe("bindTerminalCjkFont", () => {
  beforeEach(() => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("rebuilds immediately when the face is already loaded", () => {
    // Second terminal mounted after the font landed: it can still inherit the
    // first terminal's fallback-baked (process-wide, shared) glyph atlas.
    installFontSet(true);
    const { term, calls } = fakeTerminal();
    const onRebuilt = vi.fn();
    bindTerminalCjkFont(term, {
      label: "T",
      isStale: () => false,
      onRebuilt,
    });
    expect(calls).toContain("clearTextureAtlas");
    expect(onRebuilt).toHaveBeenCalledTimes(1);
  });

  it("does not re-download when the face is already loaded", () => {
    const fonts = installFontSet(true);
    const { term } = fakeTerminal();
    bindTerminalCjkFont(term, { label: "T", isStale: () => false });
    expect(fonts.load).not.toHaveBeenCalled();
  });

  it("triggers the download and rebuilds once it settles", async () => {
    // load() is not just a timing probe: a webfont is only fetched when
    // matching text is rendered, and canvas ctx.font does not trigger that.
    const fonts = installFontSet(false);
    const { term, calls } = fakeTerminal();
    const onRebuilt = vi.fn();
    bindTerminalCjkFont(term, {
      label: "T",
      isStale: () => false,
      onRebuilt,
    });
    expect(calls).toEqual([]); // nothing synchronous while unloaded
    // Called on this task, not a microtask later — the fetch must not wait.
    expect(fonts.load).toHaveBeenCalledWith('13px "Marblo D2Coding"', "가");
    await vi.waitFor(() => expect(onRebuilt).toHaveBeenCalledTimes(1));
    expect(calls).toContain("clearTextureAtlas");
  });

  it("downloads once across several terminals", async () => {
    const fonts = installFontSet(false);
    const a = fakeTerminal();
    const b = fakeTerminal();
    bindTerminalCjkFont(a.term, { label: "A", isStale: () => false });
    bindTerminalCjkFont(b.term, { label: "B", isStale: () => false });
    await vi.waitFor(() => {
      expect(a.calls).toContain("clearTextureAtlas");
      expect(b.calls).toContain("clearTextureAtlas");
    });
    expect(fonts.load).toHaveBeenCalledTimes(1);
  });

  it("skips the rebuild when the terminal was torn down mid-load", async () => {
    installFontSet(false);
    const { term, calls } = fakeTerminal();
    bindTerminalCjkFont(term, { label: "T", isStale: () => true });
    await vi.waitFor(() => expect(calls).toEqual([]));
  });

  it("survives a rejected font load without rebuilding or throwing", async () => {
    const fonts = installFontSet(false);
    fonts.load.mockRejectedValue(new Error("network"));
    const { term, calls } = fakeTerminal();
    const onRebuilt = vi.fn();
    bindTerminalCjkFont(term, {
      label: "T",
      isStale: () => false,
      onRebuilt,
    });
    // The face never arrived, so rebaking would just re-bake the same
    // fallback — a wasted full refresh. Init must not blow up either.
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalled());
    expect(calls).toEqual([]);
    expect(onRebuilt).not.toHaveBeenCalled();
  });

  it("survives a synchronously throwing load()", async () => {
    const fonts = installFontSet(false);
    fonts.load.mockImplementation(() => {
      throw new Error("sync boom");
    });
    const { term, calls } = fakeTerminal();
    expect(() =>
      bindTerminalCjkFont(term, { label: "T", isStale: () => false }),
    ).not.toThrow();
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalled());
    expect(calls).toEqual([]);
  });

  it("is inert without a document (no throw, no calls)", () => {
    const { term, calls } = fakeTerminal();
    expect(() =>
      bindTerminalCjkFont(term, { label: "T", isStale: () => false }),
    ).not.toThrow();
    expect(calls).toEqual([]);
  });

  it("honours a non-default fontSize when probing", () => {
    const fonts = installFontSet(true);
    const { term } = fakeTerminal(16);
    bindTerminalCjkFont(term, { label: "T", isStale: () => false });
    expect(fonts.check).toHaveBeenCalledWith('16px "Marblo D2Coding"', "가");
  });
});
