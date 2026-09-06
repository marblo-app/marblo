// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserPane } from "../../src/components/workspace/BrowserPane";
import { usePaneStore } from "../../src/stores/paneStore";

/**
 * Ticket nvrzSFU0xJMPuRqr0EeR — UI-side coverage that the "clear this site's
 * data" flow never fires `clearSiteData` without the owner explicitly
 * confirming in the modal, and that it targets one pane/origin, never the
 * whole partition.
 */

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

function installElectronApiMock(
  overrides: Partial<BrowserPaneAPI> = {},
): BrowserPaneAPI {
  const listeners = new Set<(state: BrowserPaneState) => void>();
  const api: BrowserPaneAPI = {
    attach: vi.fn(async ({ url }) => ({ ok: true, state: makeState(url) })),
    navigate: vi.fn(async ({ url }) => ({ ok: true, state: makeState(url) })),
    reload: vi.fn(async () => ({
      ok: true,
      state: makeState("https://naver.com"),
    })),
    setBounds: vi.fn(async () => ({ ok: true })),
    release: vi.fn(async () => ({ ok: true })),
    onState: vi.fn((callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    }),
    getSiteDataPreview: vi.fn(async () => ({
      ok: true,
      origin: "https://naver.com",
      host: "naver.com",
      cookies: [{ name: "NID_AUT", domain: ".naver.com", expiresAt: null }],
    })),
    clearSiteData: vi.fn(async () => ({
      ok: true,
      origin: "https://naver.com",
    })),
    ...overrides,
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
    },
  );
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(
    function rects(this: HTMLElement) {
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

describe("BrowserPane clear-site-data flow", () => {
  it("never calls clearSiteData just from opening the preview modal", async () => {
    const api = installElectronApiMock();

    render(
      createElement(BrowserPane, {
        paneId: "pane-browser",
        url: "https://naver.com",
      }),
    );

    fireEvent.click(await screen.findByTestId("clear-site-data-button"));

    await waitFor(() =>
      expect(api.getSiteDataPreview).toHaveBeenCalledWith("pane-browser"),
    );
    expect(api.clearSiteData).not.toHaveBeenCalled();
  });

  it("cancelling the modal never calls clearSiteData", async () => {
    const api = installElectronApiMock();

    render(
      createElement(BrowserPane, {
        paneId: "pane-browser",
        url: "https://naver.com",
      }),
    );

    fireEvent.click(await screen.findByTestId("clear-site-data-button"));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByText(/cancel|취소/i));

    expect(api.clearSiteData).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("only calls clearSiteData for this pane, with confirm:true, after the owner clicks confirm", async () => {
    const api = installElectronApiMock();

    render(
      createElement(BrowserPane, {
        paneId: "pane-browser",
        url: "https://naver.com",
      }),
    );

    fireEvent.click(await screen.findByTestId("clear-site-data-button"));
    await waitFor(() => expect(api.getSiteDataPreview).toHaveBeenCalled());
    // Preview resolved — cookie name/domain rendered, never a value field.
    await screen.findByText("NID_AUT");

    const confirmButton = await screen.findByText(
      /clear and reload|지우고 새로고침/i,
    );
    fireEvent.click(confirmButton);

    await waitFor(() =>
      expect(api.clearSiteData).toHaveBeenCalledWith({
        paneId: "pane-browser",
        confirm: true,
        expectedOrigin: "https://naver.com",
      }),
    );
    expect(api.clearSiteData).toHaveBeenCalledTimes(1);
  });

  // ★TOCTOU: the pane navigated to a different site between the preview the
  // owner saw and their confirm click. main.ts reports "origin-changed"; the
  // UI must never treat that as success and must re-preview instead of
  // silently retrying against whatever is loaded now.
  it("on origin-changed, shows an error and re-previews instead of treating it as success", async () => {
    const clearSiteData = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "origin-changed" });
    const getSiteDataPreview = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        origin: "https://naver.com",
        host: "naver.com",
        cookies: [{ name: "NID_AUT", domain: ".naver.com", expiresAt: null }],
      })
      .mockResolvedValueOnce({
        ok: true,
        origin: "https://evil.example.com",
        host: "evil.example.com",
        cookies: [],
      });
    const api = installElectronApiMock({ clearSiteData, getSiteDataPreview });

    render(
      createElement(BrowserPane, {
        paneId: "pane-browser",
        url: "https://naver.com",
      }),
    );

    fireEvent.click(await screen.findByTestId("clear-site-data-button"));
    await screen.findByText("NID_AUT");
    fireEvent.click(
      await screen.findByText(/clear and reload|지우고 새로고침/i),
    );

    await waitFor(() =>
      expect(clearSiteData).toHaveBeenCalledWith({
        paneId: "pane-browser",
        confirm: true,
        expectedOrigin: "https://naver.com",
      }),
    );
    // Re-previewed automatically — the second (post-navigation) origin shows.
    await waitFor(() => expect(getSiteDataPreview).toHaveBeenCalledTimes(2));
    await screen.findByText("evil.example.com", { exact: false });
    expect(clearSiteData).toHaveBeenCalledTimes(1);
    expect(api.clearSiteData).toBe(clearSiteData);
  });

  it("shows a preview error without ever having called clearSiteData", async () => {
    const api = installElectronApiMock({
      getSiteDataPreview: vi.fn(async () => ({
        ok: false,
        error: "boom",
      })),
    });

    render(
      createElement(BrowserPane, {
        paneId: "pane-browser",
        url: "https://naver.com",
      }),
    );

    fireEvent.click(await screen.findByTestId("clear-site-data-button"));
    await screen.findByText("boom");
    expect(api.clearSiteData).not.toHaveBeenCalled();
  });

  // Ticket zYzwb3Q5hKT6o3Nl9aZh, defect 1 — the owner's screenshot showed the
  // naver.com carousel painted OVER this exact modal. `ClearSiteDataModal`
  // renders as a normal child inside `BrowserPane`'s own root (not a portal),
  // so this reproduces the real nesting — unlike the pre-existing
  // "hides the native view while a modal is present" render test, which
  // appends its probe dialog straight to `document.body`, outside the pane,
  // and so never exercised the `owner.contains(node)` exclusion that hid
  // this bug.
  it("hides the native view once the clear-site-data modal opens (it renders inside this pane's own tree)", async () => {
    const api = installElectronApiMock();

    render(
      createElement(BrowserPane, {
        paneId: "pane-browser",
        url: "https://naver.com",
      }),
    );

    await waitFor(() =>
      expect(api.setBounds).toHaveBeenCalledWith(
        expect.objectContaining({ visible: true }),
      ),
    );
    api.setBounds.mockClear();

    fireEvent.click(await screen.findByTestId("clear-site-data-button"));
    await screen.findByRole("dialog");

    await waitFor(() =>
      expect(api.setBounds).toHaveBeenCalledWith(
        expect.objectContaining({ visible: false }),
      ),
    );
  });

  // Defect 2 — the modal must tell the owner *before* they confirm when
  // clearing reaches beyond this one host (see `broaderCookieDomains`).
  it("warns when a previewed cookie belongs to a broader domain than this pane's host", async () => {
    installElectronApiMock({
      getSiteDataPreview: vi.fn(async () => ({
        ok: true,
        origin: "https://recoshopping.naver.com",
        host: "recoshopping.naver.com",
        cookies: [
          { name: "NAC", domain: ".naver.com", expiresAt: null },
          {
            name: "SRT30",
            domain: "recoshopping.naver.com",
            expiresAt: null,
          },
        ],
      })),
    });

    render(
      createElement(BrowserPane, {
        paneId: "pane-browser",
        url: "https://recoshopping.naver.com",
      }),
    );

    fireEvent.click(await screen.findByTestId("clear-site-data-button"));
    const warning = await screen.findByTestId("clear-site-data-domain-warning");
    expect(warning.textContent).toContain("naver.com");
  });

  it("shows no domain-scope warning when every previewed cookie matches this pane's host", async () => {
    installElectronApiMock();

    render(
      createElement(BrowserPane, {
        paneId: "pane-browser",
        url: "https://naver.com",
      }),
    );

    fireEvent.click(await screen.findByTestId("clear-site-data-button"));
    await screen.findByText("NID_AUT");
    expect(screen.queryByTestId("clear-site-data-domain-warning")).toBeNull();
  });
});
