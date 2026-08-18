/**
 * @vitest-environment jsdom
 *
 * ConnectorGuidePanel — 접힘/열림 + storageKey 기억.
 *
 * 이 러너의 jsdom 은 localStorage 를 노출하지 않아(node --localstorage-file
 * 미지정) 인메모리 stub 을 심는다.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import {
  ConnectorGuidePanel,
  ConnectorGuideStep,
} from "../../src/components/harness/ConnectorGuidePanel";

const STORAGE_KEY = "marblo.test.connectorGuide.open";

function installMemoryStorage(): Map<string, string> {
  const map = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, value);
      },
      removeItem: (key: string) => {
        map.delete(key);
      },
    },
  });
  return map;
}

let storage: Map<string, string>;

beforeEach(() => {
  storage = installMemoryStorage();
});

afterEach(() => {
  cleanup();
  storage.clear();
});

describe("ConnectorGuidePanel", () => {
  it("기본값은 접힘이고, 토글하면 본문이 펼쳐진다", () => {
    render(
      createElement(
        ConnectorGuidePanel,
        { toggleLabel: "가이드 열기" },
        createElement(ConnectorGuideStep, null, "단계 본문"),
      ),
    );

    const toggle = screen.getByText("가이드 열기").closest("button")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("단계 본문")).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("단계 본문")).toBeTruthy();
  });

  it("storageKey 가 있으면 열림 상태를 localStorage 에 기억한다", () => {
    const { unmount } = render(
      createElement(
        ConnectorGuidePanel,
        { toggleLabel: "기억 가이드", storageKey: STORAGE_KEY },
        createElement(ConnectorGuideStep, null, "기억된 본문"),
      ),
    );

    fireEvent.click(screen.getByText("기억 가이드"));
    expect(storage.get(STORAGE_KEY)).toBe("1");
    unmount();

    render(
      createElement(
        ConnectorGuidePanel,
        { toggleLabel: "기억 가이드", storageKey: STORAGE_KEY },
        createElement(ConnectorGuideStep, null, "기억된 본문"),
      ),
    );

    const toggle = screen.getByText("기억 가이드").closest("button")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("기억된 본문")).toBeTruthy();
  });

  it("storageKey 가 없으면 기본 접힘이며 스토리지에 쓰지 않는다", () => {
    render(
      createElement(
        ConnectorGuidePanel,
        { toggleLabel: "비기억" },
        createElement(ConnectorGuideStep, null, "본문"),
      ),
    );

    fireEvent.click(screen.getByText("비기억"));
    expect(storage.get(STORAGE_KEY)).toBeUndefined();
  });
});
