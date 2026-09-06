// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Clicking a link in a terminal (ticket Gebe84T64LVUh1iO1hQR).
 *
 * This is the click the CEO actually made — the links an agent prints into
 * the orchestrator/agent PTY. It was the one link surface in the app that did
 * NOT go through `window.open(url, "_blank")`.
 *
 * `new WebLinksAddon()` with no handler uses the library's default, which
 * opens a link in two steps:
 *
 *     const w = window.open();   // no url → about:blank
 *     w.location.href = uri;     // navigate it afterwards
 *
 * Under Electron the first step is a `window.open` whose url is blank, which
 * `isInternalNavigationUrl` classifies as internal → `{action:"allow"}` → a
 * stray default 800×600 BrowserWindow ("니가 보내준 링크들 … 새로 뜨는 조그만
 * 창하나로 열리거나해"). The second step then surfaces the real navigation on
 * that stray window's webContents, which has never registered a Web tab
 * surface, so the link left for the OS browser with the
 * "no app window was ready to host a Web tab" notice.
 *
 * The fix is to give the addon an explicit handler. This test drives the real
 * TerminalView, takes the handler it installs, and runs it — so it fails if
 * the handler is dropped, or if it ever goes back to opening a blank window.
 */

const captured = vi.hoisted(() => ({
  handlers: [] as Array<((event: MouseEvent, uri: string) => void) | undefined>,
}));

class FakeTerminal {
  options: Record<string, unknown> = {};
  buffer = {
    active: { cursorY: 0, viewportY: 0, length: 0, getLine: () => null },
  };
  cols = 80;
  rows = 24;
  element: HTMLElement | null = null;
  onData() {
    return { dispose() {} };
  }
  onResize() {
    return { dispose() {} };
  }
  onKey() {
    return { dispose() {} };
  }
  onSelectionChange() {
    return { dispose() {} };
  }
  onRender() {
    return { dispose() {} };
  }
  onWriteParsed() {
    return { dispose() {} };
  }
  attachCustomKeyEventHandler() {}
  registerLinkProvider() {
    return { dispose() {} };
  }
  loadAddon() {}
  open(el: HTMLElement) {
    this.element = el;
  }
  write() {}
  writeln() {}
  clear() {}
  reset() {}
  resize() {}
  refresh() {}
  scrollToBottom() {}
  focus() {}
  blur() {}
  dispose() {}
  paste() {}
  hasSelection() {
    return false;
  }
  getSelection() {
    return "";
  }
  select() {}
  clearSelection() {}
}

vi.mock("@xterm/xterm", () => ({ Terminal: FakeTerminal }));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    proposeDimensions() {
      return { cols: 80, rows: 24 };
    }
    fit() {}
  },
}));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    onContextLoss() {
      return { dispose() {} };
    }
    dispose() {}
  },
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {
    constructor(handler?: (event: MouseEvent, uri: string) => void) {
      captured.handlers.push(handler);
    }
    activate() {}
    dispose() {}
  },
}));
vi.mock("../../src/lib/xtermIMEPatch", () => ({
  patchTerminalForFastIME: () => {},
}));
vi.mock("../../src/lib/monoFont", () => ({
  TERMINAL_FONT_FAMILY: "monospace",
  XTERM_CJK_RENDER_OPTIONS: {},
  cjkFontSpec: () => "monospace",
  bindTerminalCjkFont: () => {},
  repairTerminalCjkFontCachesIfLoaded: () => null,
  waitForTerminalCjkFontBeforeOpen: () => Promise.resolve(),
}));
vi.mock("../../src/utils/clipboardImage", () => ({
  resolveClipboardForTerminal: () => Promise.resolve(null),
}));
vi.mock("../../src/stores/agentSessionMap", () => ({
  useAgentSessionMap: Object.assign(
    (selector: (s: unknown) => unknown) => selector({ map: {} }),
    { getState: () => ({ map: {} }) },
  ),
}));
vi.mock("../../src/stores/agentStore", () => ({
  useAgentStore: Object.assign(
    (selector: (s: unknown) => unknown) =>
      selector({ agents: [], hydrated: true }),
    { getState: () => ({ agents: [], hydrated: true }) },
  ),
}));
vi.mock("../../src/stores/projectStore", () => ({
  useProjectStore: Object.assign(
    (selector: (s: unknown) => unknown) =>
      selector({ currentProject: { id: "p1" }, machineId: "m1" }),
    { getState: () => ({ currentProject: { id: "p1" }, machineId: "m1" }) },
  ),
}));

const TerminalView = (
  await import("../../src/components/terminal/TerminalView")
).default;

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function stubPtyApi() {
  return {
    pty: {
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      replay: vi.fn(() => Promise.resolve("")),
      isAlive: vi.fn(() => Promise.resolve(true)),
      removeListeners: vi.fn(),
    },
  };
}

describe("a link clicked in a terminal", () => {
  let opened: Array<[unknown, unknown, unknown]>;

  beforeEach(() => {
    captured.handlers.length = 0;
    opened = [];
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("electronAPI", undefined);
    (window as unknown as { electronAPI: unknown }).electronAPI = stubPtyApi();
    window.open = vi.fn((...args: unknown[]) => {
      opened.push(args as [unknown, unknown, unknown]);
      return null;
    }) as unknown as typeof window.open;
    render(createElement(TerminalView, { sessionId: "pty-1", isActive: true }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  function terminalLinkHandler() {
    const handler = captured.handlers.at(-1);
    if (!handler) {
      throw new Error(
        "TerminalView installed no link handler — the addon's default one " +
          "opens a blank window first, which Electron turns into a stray " +
          "BrowserWindow and a homeless navigation.",
      );
    }
    return handler;
  }

  it("hands the real URL to window.open, so the app can route it to a Web tab", () => {
    terminalLinkHandler()(
      new MouseEvent("click"),
      "https://github.com/melocream/marblo/pull/1412",
    );

    expect(opened).toHaveLength(1);
    const [url, target] = opened[0]!;
    expect(url).toBe("https://github.com/melocream/marblo/pull/1412");
    // "_blank" is what reaches main's setWindowOpenHandler as an external
    // link click; without it there is nothing for the policy to classify.
    expect(target).toBe("_blank");
  });

  it("never opens a blank window first", () => {
    // The exact shape of the regression: any window.open whose url is empty
    // or about:blank becomes a stray 800x600 BrowserWindow the user has to
    // close by hand.
    terminalLinkHandler()(
      new MouseEvent("click"),
      "http://localhost:8791/demo",
    );

    for (const [url] of opened) {
      expect(url).toBeTruthy();
      expect(url).not.toBe("about:blank");
    }
  });
});

/**
 * A known, real limitation surfaced while investigating ticket
 * `MXA0mMmF9IHqrMzvkRqH` ("재시작 후 클로드 아티팩트 링크가 에러로 뜬다") — NOT
 * confirmed as that incident's cause (the CEO's exact error text turned out to
 * match claude.ai's own logged-out 404 for a private artifact, unrelated to
 * this). Recorded here because it is real regardless.
 *
 * `TerminalView.tsx` gives `WebLinksAddon` a custom click handler but never
 * overrides `urlRegex`, so the library's bundled default regex decides what
 * substring of the terminal line counts as "the link" — our handler only ever
 * sees whatever that regex already matched, with no access to the raw line to
 * recover more. That default regex (`@xterm/addon-web-links` — version pinned
 * below, re-check this test if the package is upgraded) excludes `(` and `)`
 * from the matched body, not just from the trailing edge. A URL that embeds a
 * balanced parenthetical anywhere in its own path or query — not merely one a
 * surrounding markdown/prose wrapper adds — gets silently cut at the first
 * `(`, and the handler (and therefore `window.open`, and therefore whatever
 * the app routes) receives a truncated URL with no signal that anything was
 * lost.
 *
 * A hand-rolled "balanced parens" replacement regex was prototyped while
 * investigating this ticket and it reproduced the exact same truncation on
 * the very case it was meant to fix (see the ticket's activity log) — a
 * concrete demonstration that this is harder to get right than it looks, not
 * a reason to leave it broken forever. This test exists so a real fix has
 * something to turn red, and so nobody re-discovers this by tracing a live
 * clipped link again.
 */
describe("xterm's default urlRegex truncates URLs with embedded parens (known limitation, unfixed)", () => {
  const ADDON_VERSION = "0.11.0";

  it("is still running the version this limitation was verified against", () => {
    const require = createRequire(import.meta.url);
    const pkg = JSON.parse(
      readFileSync(
        require.resolve("@xterm/addon-web-links/package.json"),
        "utf8",
      ),
    ) as { version: string };
    expect(pkg.version).toBe(ADDON_VERSION);
  });

  // Extracted verbatim from the addon's bundled default (source string in
  // node_modules/@xterm/addon-web-links/lib/addon-web-links.js, the
  // unexported `r` regex literal used when no `urlRegex` option is given).
  const DEFAULT_URL_REGEX =
    /(https?|HTTPS?):[/]{2}[^\s"'!*(){}|\\^<>`]*[^\s"':,.!?{}|\\^~[\]`()<>]/;

  it("matches a plain URL fully — the common case is unaffected", () => {
    const line = "See https://claude.ai/public/artifacts/abc-123 for details.";
    const match = DEFAULT_URL_REGEX.exec(line);
    expect(match?.[0]).toBe("https://claude.ai/public/artifacts/abc-123");
  });

  it("correctly excludes a markdown-style trailing paren wrapper", () => {
    const line = "[artifact](https://claude.ai/public/artifacts/abc-123)";
    const match = DEFAULT_URL_REGEX.exec(line);
    expect(match?.[0]).toBe("https://claude.ai/public/artifacts/abc-123");
  });

  it("★truncates when the URL itself contains a balanced paren mid-path", () => {
    const line = "https://en.wikipedia.org/wiki/Bracket_(disambiguation)";
    const match = DEFAULT_URL_REGEX.exec(line);
    // The bug: this is NOT the full URL. A user clicking this link in a
    // Marblo terminal would be routed to the truncated address below, not
    // the page they actually wanted.
    expect(match?.[0]).toBe("https://en.wikipedia.org/wiki/Bracket_");
    expect(match?.[0]).not.toBe(line);
  });
});
