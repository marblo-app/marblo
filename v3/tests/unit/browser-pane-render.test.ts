// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserPane } from "../../src/components/workspace/BrowserPane";
import { usePaneStore } from "../../src/stores/paneStore";

class ResizeObserverStub {
  observe(): void {}
  disconnect(): void {}
}

function makeState(url: string): BrowserPaneState {
  return {
    paneId: "pane-browser",
    url,
    title: "",
    isLoading: false,
    security: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: "persist:marblo-browser-tab",
    },
  };
}

function installElectronApiMock() {
  const listeners = new Set<(state: BrowserPaneState) => void>();
  const api: BrowserPaneAPI = {
    attach: vi.fn(async ({ url }) => ({ ok: true, state: makeState(url) })),
    navigate: vi.fn(async ({ url }) => ({ ok: true, state: makeState(url) })),
    reload: vi.fn(async () => ({
      ok: true,
      state: makeState("https://example.com"),
    })),
    setBounds: vi.fn(async () => ({ ok: true })),
    release: vi.fn(async () => ({ ok: true })),
    onState: vi.fn((callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    }),
  };

  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: {
      browserPane: api,
    },
  });
  return api;
}

beforeEach(() => {
  usePaneStore.getState().reset();
  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    value: ResizeObserverStub,
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function rect(this: HTMLElement) {
      if (this.dataset.testid === "browser-pane-native-anchor") {
        return {
          x: 20,
          y: 60,
          left: 20,
          top: 60,
          right: 820,
          bottom: 660,
          width: 800,
          height: 600,
          toJSON: () => ({}),
        };
      }
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 320,
        bottom: 120,
        width: 320,
        height: 120,
        toJSON: () => ({}),
      };
    },
  );
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(
    function rects(this: HTMLElement) {
      if (this.dataset.testid !== "browser-pane-native-anchor") {
        return {
          length: 0,
          item: () => null,
          [Symbol.iterator]: function* empty() {},
        };
      }
      const rect = this.getBoundingClientRect();
      return {
        0: rect,
        length: 1,
        item: (index: number) => (index === 0 ? rect : null),
        [Symbol.iterator]: function* one() {
          yield rect;
        },
      };
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("BrowserPane", () => {
  it("hides the native view when an ancestor tab wrapper is switched to display:none", async () => {
    // Regression coverage for the "웹탭이 코드 탭 위에 계속 떠있다" report: the
    // right-hand shell (WorkTabs/PaneGroup) keeps every tab mounted and hides
    // the inactive one via `style.display = "none"` on an ancestor, rather
    // than unmounting it — see WorkTabs.tsx and PaneGroup.tsx. BrowserPane's
    // own DOM anchor never changes, but `getClientRects()` on it must report
    // empty once an ancestor stops being rendered, and that must reach main
    // as `setBounds({ visible: false })`.
    let ancestorHidden = false;
    const api = installElectronApiMock();

    const getClientRectsSpy = vi.spyOn(HTMLElement.prototype, "getClientRects");
    getClientRectsSpy.mockImplementation(function rects(this: HTMLElement) {
      if (
        this.dataset.testid !== "browser-pane-native-anchor" ||
        ancestorHidden
      ) {
        return {
          length: 0,
          item: () => null,
          [Symbol.iterator]: function* empty() {},
        };
      }
      const rect = this.getBoundingClientRect();
      return {
        0: rect,
        length: 1,
        item: (index: number) => (index === 0 ? rect : null),
        [Symbol.iterator]: function* one() {
          yield rect;
        },
      };
    });

    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-testid", "tab-wrapper");
    document.body.appendChild(wrapper);

    render(
      createElement(BrowserPane, {
        paneId: "pane-browser",
        url: "https://example.com",
      }),
      { container: wrapper },
    );

    await waitFor(() =>
      expect(api.setBounds).toHaveBeenCalledWith(
        expect.objectContaining({ paneId: "pane-browser", visible: true }),
      ),
    );

    // Mount settles across a few effect/rAF churns (attach() resolving,
    // reportBounds's own dependency changing) before it goes quiet. Clearing
    // the mock before that churn finishes would let one of those in-flight
    // calls masquerade as the mutation-triggered one below.
    await new Promise((resolve) => setTimeout(resolve, 200));
    api.setBounds.mockClear();

    ancestorHidden = true;
    wrapper.style.display = "none";

    await waitFor(() =>
      expect(api.setBounds).toHaveBeenCalledWith(
        expect.objectContaining({ paneId: "pane-browser", visible: false }),
      ),
    );

    document.body.removeChild(wrapper);
  });

  it("reports visible native-view bounds for an active browser pane", async () => {
    const api = installElectronApiMock();

    render(
      createElement(BrowserPane, {
        paneId: "pane-browser",
        url: "https://example.com",
      }),
    );

    await waitFor(() =>
      expect(api.setBounds).toHaveBeenCalledWith({
        paneId: "pane-browser",
        visible: true,
        bounds: { x: 20, y: 60, width: 800, height: 600 },
        windowOrigin: { x: 0, y: 0 },
      }),
    );
  });

  it("hides the native view while a modal is present", async () => {
    const api = installElectronApiMock();
    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    document.body.appendChild(modal);

    render(
      createElement(BrowserPane, {
        paneId: "pane-browser",
        url: "https://example.com",
      }),
    );

    await waitFor(() =>
      expect(api.setBounds).toHaveBeenCalledWith({
        paneId: "pane-browser",
        visible: false,
        bounds: { x: 20, y: 60, width: 800, height: 600 },
        windowOrigin: { x: 0, y: 0 },
      }),
    );
  });
});
