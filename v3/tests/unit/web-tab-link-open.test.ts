// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserTab } from "../../src/components/workspace/BrowserTab";
import { openLinkInWebTab } from "../../src/lib/openLinkInWebTab";
import { RIGHT_TABS } from "../../src/lib/splitWorkspaceLayout";
import { usePaneStore } from "../../src/stores/paneStore";
import { useSplitWorkspaceStore } from "../../src/stores/splitWorkspaceStore";

/**
 * The renderer half of the link-click path (ticket pmpcvaEsswlsOLJDwer6).
 *
 * Main can route a click "into an app tab" all it likes; that only means
 * anything if the renderer turns the message into a pane, puts that pane on
 * screen, and only then tells main it worked. Before this ticket it did the
 * first, skipped the second — nothing in the app rendered the pane tree at
 * all — and still did the third, so main recorded a success for a click that
 * visibly did nothing.
 */

class ResizeObserverStub {
  observe(): void {}
  disconnect(): void {}
}

describe("openLinkInWebTab", () => {
  beforeEach(() => {
    usePaneStore.getState().reset();
    useSplitWorkspaceStore.setState({ activeTab: "board" });
  });

  function realDeps(ack: (id: string) => void) {
    return {
      addPane: usePaneStore.getState().addPane,
      setActiveTab: useSplitWorkspaceStore.getState().setActiveTab,
      ack,
    };
  }

  it("puts the URL in a new browser pane and makes it the active one", () => {
    const paneId = openLinkInWebTab(realDeps(vi.fn()), {
      url: "https://github.com/melocream/marblo",
      requestId: "req-1",
    });

    const { panes, layout } = usePaneStore.getState();
    expect(panes[paneId]).toMatchObject({
      kind: "browser",
      url: "https://github.com/melocream/marblo",
    });
    expect(layout.type).toBe("group");
    if (layout.type !== "group") return;
    expect(layout.activePaneId).toBe(paneId);
  });

  it("brings the Web tab to the front, so the new tab is actually visible", () => {
    openLinkInWebTab(realDeps(vi.fn()), {
      url: "https://example.com",
      requestId: "req-2",
    });
    expect(useSplitWorkspaceStore.getState().activeTab).toBe("browser");
  });

  it("acknowledges the open only after the pane exists and the tab is up", () => {
    const seen: string[] = [];
    openLinkInWebTab(
      {
        addPane: (kind, opts) => {
          seen.push(`addPane:${kind}:${opts?.url}`);
          return "pane-x";
        },
        setActiveTab: (tab) => seen.push(`setActiveTab:${tab}`),
        ack: (id) => seen.push(`ack:${id}`),
      },
      { url: "https://example.com", requestId: "req-3" },
    );

    expect(seen).toEqual([
      "addPane:browser:https://example.com",
      "setActiveTab:browser",
      "ack:req-3",
    ]);
  });

  it("does not acknowledge when the pane could not be created", () => {
    // No ack means main's delivery timeout fires, which opens the OS browser
    // and tells the user why. Acking here would turn a recoverable failure
    // into a click that vanishes.
    const ack = vi.fn();
    expect(() =>
      openLinkInWebTab(
        {
          addPane: () => {
            throw new Error("pane tree unavailable");
          },
          setActiveTab: vi.fn(),
          ack,
        },
        { url: "https://example.com", requestId: "req-4" },
      ),
    ).toThrow();
    expect(ack).not.toHaveBeenCalled();
  });

  it("opens several links as several tabs in the same group", () => {
    const first = openLinkInWebTab(realDeps(vi.fn()), {
      url: "http://localhost:8791/demo.html",
      requestId: "req-5",
    });
    const second = openLinkInWebTab(realDeps(vi.fn()), {
      url: "https://github.com/melocream/marblo",
      requestId: "req-6",
    });

    const { layout } = usePaneStore.getState();
    expect(layout.type).toBe("group");
    if (layout.type !== "group") return;
    // The initial empty pane plus the two opened links.
    expect(layout.paneIds).toHaveLength(3);
    expect(layout.paneIds).toContain(first);
    expect(layout.paneIds).toContain(second);
    expect(layout.activePaneId).toBe(second);
  });
});

describe("the Web tab surface", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    usePaneStore.getState().reset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("is a real tab in the shell's tab bar", () => {
    // Without this the pane tree is unreachable no matter what main routes:
    // that was the state of the app before this ticket.
    expect(RIGHT_TABS as readonly string[]).toContain("browser");
  });

  it("renders the pane a routed link creates", () => {
    openLinkInWebTab(
      {
        addPane: usePaneStore.getState().addPane,
        setActiveTab: () => {},
        ack: () => {},
      },
      { url: "https://github.com/melocream/marblo", requestId: "req-7" },
    );

    render(createElement(BrowserTab));

    // BrowserPane's address bar carries the URL, so finding it on screen
    // proves the routed link reached a mounted, visible pane.
    const address = screen.getByDisplayValue(
      "https://github.com/melocream/marblo",
    );
    expect(address).toBeTruthy();
  });
});
