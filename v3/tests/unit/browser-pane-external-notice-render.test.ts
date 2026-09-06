// @vitest-environment jsdom
/**
 * The dead end this pins shut (사장님 2026-09-06: "이건 안 들어가져").
 *
 * A Web tab on a sign-in page whose OAuth button leaves for the system
 * browser used to become an error card with one action — "open in the system
 * browser", which the app had already done by itself. The page was still
 * loaded one dismiss away, and nothing on screen went back to it, so the
 * site's OWN email sign-in (the path that does persist in this tab) was
 * unreachable.
 */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserPane } from "../../src/components/workspace/BrowserPane";
import { usePaneStore } from "../../src/stores/paneStore";

class ResizeObserverStub {
  observe(): void {}
  disconnect(): void {}
}

const PANE_ID = "pane-browser";
const URL = "https://claude.ai/login";

function makeState(notice?: BrowserPaneState["notice"]): BrowserPaneState {
  return {
    paneId: PANE_ID,
    url: URL,
    title: "",
    isLoading: false,
    notice,
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
    attach: vi.fn(async () => ({ ok: true, state: makeState() })),
    navigate: vi.fn(async () => ({ ok: true, state: makeState() })),
    reload: vi.fn(async () => ({ ok: true, state: makeState() })),
    setBounds: vi.fn(async () => ({ ok: true })),
    release: vi.fn(async () => ({ ok: true })),
    onState: vi.fn((callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    }),
  };
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: { browserPane: api },
  });
  return {
    api,
    emit: (state: BrowserPaneState) => {
      act(() => {
        for (const listener of listeners) listener(state);
      });
    },
  };
}

/** The pane must have been visible once for "back to the page" to mean anything. */
function stubLayout() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function rect(this: HTMLElement) {
      const box =
        this.dataset.testid === "browser-pane-native-anchor"
          ? { x: 20, y: 60, width: 800, height: 600 }
          : { x: 0, y: 0, width: 320, height: 120 };
      return {
        ...box,
        left: box.x,
        top: box.y,
        right: box.x + box.width,
        bottom: box.y + box.height,
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
}

beforeEach(() => {
  usePaneStore.getState().reset();
  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    value: ResizeObserverStub,
  });
  stubLayout();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("BrowserPane — externalized sign-in", () => {
  it("offers a way back to the page the OAuth click never left", async () => {
    const { api, emit } = installElectronApiMock();
    render(createElement(BrowserPane, { paneId: PANE_ID, url: URL }));

    // The pane loaded and was revealed once — that is what makes the page
    // "still behind the block" when the notice arrives.
    await waitFor(() =>
      expect(api.setBounds).toHaveBeenCalledWith(
        expect.objectContaining({ visible: true }),
      ),
    );

    emit(
      makeState({
        code: "google-auth-external",
        message: "Google blocks sign-in inside embedded browsers.",
      }),
    );

    const back = await screen.findByTestId("browser-pane-back-to-page");

    // The native view is hidden while the notice stands, so the block is
    // what the user sees.
    await waitFor(() =>
      expect(api.setBounds).toHaveBeenCalledWith(
        expect.objectContaining({ visible: false }),
      ),
    );

    api.setBounds.mockClear();
    act(() => back.click());

    // Dismissing puts the still-loaded sign-in page back on screen — no
    // navigate() call, because the pane never moved.
    await waitFor(() =>
      expect(api.setBounds).toHaveBeenCalledWith(
        expect.objectContaining({ visible: true }),
      ),
    );
    expect(api.navigate).not.toHaveBeenCalled();
    expect(screen.queryByTestId("browser-pane-back-to-page")).toBeNull();
  });

  it("does not offer a way back when the pane has no page behind the block", async () => {
    const { emit } = installElectronApiMock();
    render(createElement(BrowserPane, { paneId: PANE_ID, url: "about:blank" }));

    emit({
      ...makeState({
        code: "google-auth-external",
        message: "Google blocks sign-in inside embedded browsers.",
      }),
      url: "about:blank",
    });

    await waitFor(() =>
      expect(screen.queryByTestId("browser-pane-back-to-page")).toBeNull(),
    );
  });
});
