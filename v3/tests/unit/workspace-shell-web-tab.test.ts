// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Shell mount → open-target registration → a routed link becomes a visible
 * Web tab (ticket Gebe84T64LVUh1iO1hQR).
 *
 * The two halves of this path already had tests — `route-app-external-link`
 * for main's URL policy, `web-tab-link-open` for the renderer's
 * pane-then-ack ordering — and both stayed green while the CEO watched every
 * link leave for Chrome with "no app window was ready to host a Web tab".
 * Nothing covered the seam: does the shell that renders the Web tab actually
 * tell main it can host one, and does a message from main end up on screen.
 *
 * So this drives the REAL WorkspaceShell against a fake main, and asserts on
 * what the user can see: the URL in the Web tab's address bar.
 */

const shellHarness = vi.hoisted(() => ({
  openUrlListeners: new Set<
    (payload: { url: string; requestId: string }) => void
  >(),
}));

// The shell's heavy neighbours. None of them take part in link routing; the
// shell itself, its effects, and the real stores are what this exercises.
const stub = (name: string) => ({
  [name]: () => createElement("div", { "data-stub": name }),
});
vi.mock("../../src/components/Header", () => stub("Header"));
vi.mock("../../src/components/GlobalOverlays", () => stub("GlobalOverlays"));
vi.mock("../../src/components/onboarding/CliSetupHost", () =>
  stub("CliSetupHost"),
);
vi.mock("../../src/components/workspace/TerminalColumn", () =>
  stub("TerminalColumn"),
);
vi.mock("../../src/components/sidebar/Sidebar", () => stub("Sidebar"));
vi.mock("../../src/components/activity/ActivityStreamPanel", () =>
  stub("ActivityStreamPanel"),
);
vi.mock("../../src/hooks/useProjectKindSurface", () => ({
  useProjectKindSurface: () => {},
}));
vi.mock("../../src/hooks/useAppLifecycle", () => ({
  useAppLifecycle: () => ({
    projectSetup: { handleSelectDirectory: () => Promise.resolve() },
    isNewWindow: false,
    restoreSettled: true,
    rootPath: "/tmp/project",
  }),
}));

// The right-hand tab area. Real WorkTabs pulls in every tab in the app; what
// matters here is the one this ticket is about, and that it is shown only
// when the shell has actually switched to it. `web-tab-link-open.test.ts`
// pins that "browser" is a real entry in RIGHT_TABS.
vi.mock("../../src/components/workspace/WorkTabs", async () => {
  const { BrowserTab } = await import(
    "../../src/components/workspace/BrowserTab"
  );
  const { useSplitWorkspaceStore } = await import(
    "../../src/stores/splitWorkspaceStore"
  );
  return {
    WorkTabs: () => {
      const activeTab = useSplitWorkspaceStore((s) => s.activeTab);
      return activeTab === "browser"
        ? createElement(BrowserTab)
        : createElement("div", null, `tab:${activeTab}`);
    },
  };
});

const { WorkspaceShell } = await import(
  "../../src/components/workspace/WorkspaceShell"
);
const { usePaneStore } = await import("../../src/stores/paneStore");
const { useSplitWorkspaceStore } = await import(
  "../../src/stores/splitWorkspaceStore"
);

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/**
 * Stands in for main: it records `registerOpenTarget`, and can push a
 * `browserPane:openUrl` the way `routeAppExternalLink` does once it has
 * decided a click belongs in a Web tab.
 */
function fakeMain() {
  const registrations: boolean[] = [];
  const acks: string[] = [];
  return {
    registrations,
    acks,
    api: {
      registerOpenTarget: vi.fn((enabled: boolean) => {
        registrations.push(enabled);
        return Promise.resolve({ ok: true });
      }),
      ackOpenUrl: vi.fn((requestId: string) => {
        acks.push(requestId);
      }),
      onOpenUrl: (cb: (p: { url: string; requestId: string }) => void) => {
        shellHarness.openUrlListeners.add(cb);
        return () => shellHarness.openUrlListeners.delete(cb);
      },
      openExternal: vi.fn(() => Promise.resolve({ ok: true })),
      attach: vi.fn(() => Promise.resolve({ ok: false })),
      navigate: vi.fn(() => Promise.resolve({ ok: true })),
      reload: vi.fn(() => Promise.resolve({ ok: true })),
      setBounds: vi.fn(() => Promise.resolve({ ok: true })),
      release: vi.fn(() => Promise.resolve({ ok: true })),
      onState: () => () => {},
    },
    /** What main does after routeExternalLinkClick returns "open-in-tab". */
    routeLinkToTab(url: string, requestId: string) {
      act(() => {
        for (const cb of shellHarness.openUrlListeners) cb({ url, requestId });
      });
    },
  };
}

describe("the workspace shell as a Web tab host", () => {
  let main: ReturnType<typeof fakeMain>;

  beforeEach(() => {
    shellHarness.openUrlListeners.clear();
    usePaneStore.getState().reset();
    useSplitWorkspaceStore.setState({ activeTab: "board" });
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    main = fakeMain();
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      browserPane: main.api,
    };
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it("registers itself with main as soon as it mounts", () => {
    // Without this main's `browserPaneOpenTargets` is empty, `hasOpenTarget`
    // is false for every click, and every link leaves the app.
    render(createElement(WorkspaceShell));
    expect(main.registrations).toEqual([true]);
  });

  it("shows a routed link in the Web tab's address bar", () => {
    render(createElement(WorkspaceShell));
    expect(main.registrations).toEqual([true]);

    main.routeLinkToTab("https://github.com/melocream/marblo/pull/1412", "req-1");

    // The address bar is the user-visible proof: the pane was created, the
    // Web tab was brought to the front, and it is rendering that URL.
    expect(
      screen.getByDisplayValue("https://github.com/melocream/marblo/pull/1412"),
    ).toBeTruthy();
    expect(useSplitWorkspaceStore.getState().activeTab).toBe("browser");
    // Only after all of that may main be told the click was handled.
    expect(main.acks).toEqual(["req-1"]);
  });

  it("opens a second routed link as a second tab", () => {
    render(createElement(WorkspaceShell));
    main.routeLinkToTab("http://localhost:8791/demo.html", "req-1");
    main.routeLinkToTab("https://example.com/docs", "req-2");

    expect(screen.getByDisplayValue("https://example.com/docs")).toBeTruthy();
    expect(main.acks).toEqual(["req-1", "req-2"]);
  });

  it("withdraws its registration when it goes away", () => {
    // The reverse direction the ticket asks us not to break: with no shell
    // listening, main must fall back to the OS browser AND say why
    // (`no-tab-target`) rather than send a click into a dead window.
    const view = render(createElement(WorkspaceShell));
    view.unmount();
    expect(main.registrations).toEqual([true, false]);
  });
});
