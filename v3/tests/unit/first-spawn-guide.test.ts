/**
 * @vitest-environment jsdom
 *
 * FirstSpawnGuide — connect 직후 오케스트레이터 창 위의 인라인 재진입 안내.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { FirstSpawnGuide } from "../../src/components/onboarding/FirstSpawnGuide";
import { SLASH_COMMANDS } from "../../src/components/orchestrator/SlashCommandPopup";
import { useLocaleStore } from "../../src/lib/i18n";
import { useOrchestratorStore } from "../../src/stores/orchestratorStore";

const COLLAPSED_KEY = "marblo.firstSpawnGuide.collapsed";
const SEEN_KEY = "marblo.firstSpawnGuide.seen";
const GUIDE_COMMANDS = [
  "/tf-add",
  "/tf-spawn-agents",
  "/tf-plan",
  "/tf-start",
  "/tf-guide",
];

function installMemoryStorage(): Map<string, string> {
  const map = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => map.set(key, value),
      removeItem: (key: string) => map.delete(key),
    },
  });
  return map;
}

let storage: Map<string, string>;

beforeEach(() => {
  storage = installMemoryStorage();
  useLocaleStore.setState({ locale: "ko" });
  useOrchestratorStore.setState({ ptySessionId: null });
});

afterEach(() => {
  cleanup();
  storage.clear();
  vi.restoreAllMocks();
});

describe("FirstSpawnGuide", () => {
  it("작은 일·큰 일·도움말의 정확한 번들 명령만, 순서대로 표시한다", () => {
    render(createElement(FirstSpawnGuide));

    fireEvent.click(screen.getByTestId("first-spawn-guide-toggle"));

    const commands = [...document.querySelectorAll("[data-testid^='first-spawn-guide-cmd-']")]
      .map((element) => element.getAttribute("data-testid")?.replace("first-spawn-guide-cmd-", ""));
    expect(commands).toEqual(GUIDE_COMMANDS);
    expect(GUIDE_COMMANDS.every((command) => SLASH_COMMANDS.some((item) => item.command === command))).toBe(true);
    expect(commands).not.toContain("/tf-spawn");
  });

  it("첫 진입은 접힌 한 줄이고, 펼침 선택을 다시 열어도 기억한다", () => {
    const firstRender = render(createElement(FirstSpawnGuide));

    const toggle = screen.getByTestId("first-spawn-guide-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("first-spawn-guide-body")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(storage.get(COLLAPSED_KEY)).toBe("0");

    firstRender.unmount();
    render(createElement(FirstSpawnGuide));
    expect(screen.getByTestId("first-spawn-guide-toggle").getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(screen.getByTestId("first-spawn-guide-toggle"));
    expect(screen.getByTestId("first-spawn-guide-toggle").getAttribute("aria-expanded")).toBe("false");
    expect(storage.get(COLLAPSED_KEY)).toBe("1");
  });

  it("펼친 본문은 위쪽 absolute 오버레이여서 레일의 레이아웃 높이를 바꾸지 않는다", () => {
    render(createElement(FirstSpawnGuide));

    const guide = screen.getByTestId("first-spawn-guide");
    const rail = screen.getByTestId("first-spawn-guide-rail");
    fireEvent.click(screen.getByTestId("first-spawn-guide-toggle"));
    const body = screen.getByTestId("first-spawn-guide-body");

    expect(guide.dataset.layout).toBe("upward-overlay");
    expect(body.parentElement).toBe(guide);
    expect(body.className).toContain("absolute");
    expect(body.className).toContain("bottom-full");
    expect(rail.nextElementSibling).toBe(body);
  });

  it("바깥 클릭과 Escape로 펼친 패널을 닫는다", () => {
    render(createElement(FirstSpawnGuide));
    const toggle = screen.getByTestId("first-spawn-guide-toggle");

    fireEvent.click(toggle);
    fireEvent.pointerDown(document.body);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("칩 클릭은 보이는 명령 자체를 오케스트레이터에 삽입한다", async () => {
    const writeAndSubmit = vi.fn(async () => undefined);
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { pty: { writeAndSubmit } },
    });
    useOrchestratorStore.setState({ ptySessionId: "orch-1" });

    render(createElement(FirstSpawnGuide));
    fireEvent.click(screen.getByTestId("first-spawn-guide-toggle"));
    fireEvent.click(screen.getByTestId("first-spawn-guide-cmd-/tf-start"));

    await vi.waitFor(() => {
      expect(writeAndSubmit).toHaveBeenCalledWith("orch-1", "/tf-start");
    });
  });

  it("처음 한 번만 펄스를 표시한다", () => {
    render(createElement(FirstSpawnGuide));
    expect(storage.get(SEEN_KEY)).toBe("1");
    expect(screen.getByTestId("first-spawn-guide-rail").className).toContain("shadow-[0_0_0_3px");
  });
});
