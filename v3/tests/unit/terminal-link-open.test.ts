// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
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
  buffer = { active: { cursorY: 0, viewportY: 0, length: 0, getLine: () => null } };
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
    render(
      createElement(TerminalView, { sessionId: "pty-1", isActive: true }),
    );
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
    terminalLinkHandler()(new MouseEvent("click"), "http://localhost:8791/demo");

    for (const [url] of opened) {
      expect(url).toBeTruthy();
      expect(url).not.toBe("about:blank");
    }
  });
});
