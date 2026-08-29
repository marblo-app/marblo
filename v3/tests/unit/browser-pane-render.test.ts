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
      }),
    );
  });
});
