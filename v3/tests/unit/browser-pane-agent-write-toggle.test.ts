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
 * Ticket 8ssBnDzFll0eHDKNYqZB: Stage 3a (#1482) built the agent write-access
 * IPC (`browserPane:setAgentWriteAccess`/`getAgentWriteAccess`) and the
 * policy that enforces it, but nothing in the renderer ever called it — no
 * toggle existed for the owner to reach. This file locks in the toggle this
 * ticket adds, and the completion criteria the ticket states explicitly:
 * default off, independent from the read toggle, and reset by the global
 * stop broadcast.
 */

class ResizeObserverStub {
  observe(): void {}
  disconnect(): void {}
}

function makeState(
  url: string,
  overrides: Partial<BrowserPaneState> = {},
): BrowserPaneState {
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
    ...overrides,
  };
}

function installElectronApiMock(options?: {
  readGranted?: boolean;
  writeGranted?: boolean;
}) {
  const stateListeners = new Set<(state: BrowserPaneState) => void>();
  const activityListeners = new Set<(event: AgentReadActivityEvent) => void>();
  let readGranted = options?.readGranted ?? false;
  let writeGranted = options?.writeGranted ?? false;

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
      stateListeners.add(callback);
      return () => stateListeners.delete(callback);
    }),
    setAgentReadAccess: vi.fn(async ({ granted }) => {
      readGranted = granted;
      return { ok: true, granted: readGranted };
    }),
    getAgentReadAccess: vi.fn(async () => ({ ok: true, granted: readGranted })),
    setAgentWriteAccess: vi.fn(async ({ granted }) => {
      writeGranted = granted;
      return { ok: true, granted: writeGranted };
    }),
    getAgentWriteAccess: vi.fn(async () => ({
      ok: true,
      granted: writeGranted,
    })),
    setGlobalAgentStop: vi.fn(async () => ({ ok: true, suspended: false })),
    getGlobalAgentStop: vi.fn(async () => ({ ok: true, suspended: false })),
    onAgentReadActivity: vi.fn((callback) => {
      activityListeners.add(callback);
      return () => activityListeners.delete(callback);
    }),
  };

  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: { browserPane: api },
  });

  return {
    api,
    emitState: (state: BrowserPaneState) => {
      for (const listener of stateListeners) listener(state);
    },
    emitGlobalStop: () => {
      const event: AgentReadActivityEvent = {
        agentId: "*",
        paneId: "*",
        url: "",
        status: "aborted",
        reason: "global-stop:1",
        at: Date.now(),
      };
      for (const listener of activityListeners) listener(event);
    },
  };
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

describe("BrowserPane agent write-access toggle", () => {
  it("defaults to off before the access-check IPC round-trip resolves — completion criterion: 기본은 꺼짐", () => {
    // Mock the backend as already-granted on purpose: if the component's
    // `useState` default were flipped to `true`, this test must still catch
    // it, because checking only the post-fetch value (which would also be
    // `true` here) can't tell "defaults on" apart from "correctly fetched
    // on". The assertion below runs with no `await` in between, so it reads
    // the render's initial synchronous state, before the mocked async
    // `getAgentWriteAccess` promise has had a chance to resolve.
    installElectronApiMock({ writeGranted: true });
    render(
      createElement(BrowserPane, {
        paneId: "pane-browser",
        url: "https://example.com",
      }),
    );

    const toggle = screen.getByTestId("agent-write-access-toggle");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.textContent).toContain("에이전트 쓰기");
    expect(screen.queryByTestId("agent-write-access-banner")).toBeNull();
  });

  it("fetches and reflects the backend's off state once getAgentWriteAccess resolves", async () => {
    const { api } = installElectronApiMock({ writeGranted: false });
    render(
      createElement(BrowserPane, {
        paneId: "pane-browser",
        url: "https://example.com",
      }),
    );

    await waitFor(() => expect(api.getAgentWriteAccess).toHaveBeenCalled());
    const toggle = screen.getByTestId("agent-write-access-toggle");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
  });

  it("turns on and calls setAgentWriteAccess with granted:true, and shows the scope banner", async () => {
    const { api } = installElectronApiMock();
    render(
      createElement(BrowserPane, {
        paneId: "pane-browser",
        url: "https://example.com",
      }),
    );
    await waitFor(() => expect(api.getAgentWriteAccess).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId("agent-write-access-toggle"));

    await waitFor(() =>
      expect(api.setAgentWriteAccess).toHaveBeenCalledWith({
        paneId: "pane-browser",
        granted: true,
      }),
    );
    const toggle = screen.getByTestId("agent-write-access-toggle");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.textContent).toContain("쓰기 허용됨");
    // Banner copy is i18n'd (t()) — assert it renders non-empty content
    // rather than pinning a locale-specific string here.
    expect(
      screen.getByTestId("agent-write-access-banner").textContent,
    ).toBeTruthy();
  });

  // Completion criterion: 읽기 권한과 독립임이 테스트로 고정 — 하나를 켜도
  // 다른 하나가 안 켜진다.
  it("is independent from the read toggle — turning write on leaves read off, and vice versa", async () => {
    const { api } = installElectronApiMock();
    render(
      createElement(BrowserPane, {
        paneId: "pane-browser",
        url: "https://example.com",
      }),
    );
    await waitFor(() => expect(api.getAgentWriteAccess).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId("agent-write-access-toggle"));
    await waitFor(() =>
      expect(
        screen
          .getByTestId("agent-write-access-toggle")
          .getAttribute("aria-pressed"),
      ).toBe("true"),
    );
    expect(
      screen
        .getByTestId("agent-read-access-toggle")
        .getAttribute("aria-pressed"),
    ).toBe("false");
    expect(api.setAgentReadAccess).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("agent-read-access-toggle"));
    await waitFor(() =>
      expect(
        screen
          .getByTestId("agent-read-access-toggle")
          .getAttribute("aria-pressed"),
      ).toBe("true"),
    );
    // Write must still be on — toggling read must not have touched it.
    expect(
      screen
        .getByTestId("agent-write-access-toggle")
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  // Completion criterion: 전역 stop 뒤 화면이 꺼짐으로 보인다.
  it("resets both toggles to off when the global-stop broadcast arrives", async () => {
    const { api, emitGlobalStop } = installElectronApiMock({
      readGranted: true,
      writeGranted: true,
    });
    render(
      createElement(BrowserPane, {
        paneId: "pane-browser",
        url: "https://example.com",
      }),
    );

    await waitFor(() =>
      expect(
        screen
          .getByTestId("agent-write-access-toggle")
          .getAttribute("aria-pressed"),
      ).toBe("true"),
    );
    expect(
      screen
        .getByTestId("agent-read-access-toggle")
        .getAttribute("aria-pressed"),
    ).toBe("true");

    emitGlobalStop();

    await waitFor(() =>
      expect(
        screen
          .getByTestId("agent-write-access-toggle")
          .getAttribute("aria-pressed"),
      ).toBe("false"),
    );
    expect(
      screen
        .getByTestId("agent-read-access-toggle")
        .getAttribute("aria-pressed"),
    ).toBe("false");
    expect(screen.queryByTestId("agent-write-access-banner")).toBeNull();
    expect(api.onAgentReadActivity).toHaveBeenCalled();
  });

  // Completion criterion (§구글은 제외): 켰는데 조용히 아무 일도 안 나는
  // 상태를 만들지 마라— the banner must say so on a Google host.
  it("warns that writes do not apply on a Google host while the toggle is on", async () => {
    const { api, emitState } = installElectronApiMock({ writeGranted: true });
    render(
      createElement(BrowserPane, {
        paneId: "pane-browser",
        url: "https://mail.google.com/",
      }),
    );
    await waitFor(() =>
      expect(
        screen
          .getByTestId("agent-write-access-toggle")
          .getAttribute("aria-pressed"),
      ).toBe("true"),
    );

    emitState(makeState("https://mail.google.com/"));

    await waitFor(() =>
      expect(
        screen.getByTestId("agent-write-google-host-warning"),
      ).toBeTruthy(),
    );
    expect(api.getAgentWriteAccess).toHaveBeenCalled();
  });

  it("does not show the Google-host warning on a non-Google page", async () => {
    const { emitState } = installElectronApiMock({ writeGranted: true });
    render(
      createElement(BrowserPane, {
        paneId: "pane-browser",
        url: "https://claude.ai/",
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("agent-write-access-banner")).toBeTruthy(),
    );

    emitState(makeState("https://claude.ai/"));

    expect(screen.queryByTestId("agent-write-google-host-warning")).toBeNull();
  });
});
