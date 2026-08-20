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

    const commands = [...document.querySelectorAll("[data-testid^='first-spawn-guide-cmd-']")]
      .map((element) => element.getAttribute("data-testid")?.replace("first-spawn-guide-cmd-", ""));
    expect(commands).toEqual(GUIDE_COMMANDS);
    expect(GUIDE_COMMANDS.every((command) => SLASH_COMMANDS.some((item) => item.command === command))).toBe(true);
    expect(commands).not.toContain("/tf-spawn");
  });

  it("접어도 사라지지 않고, 다시 펼칠 수 있다", () => {
    render(createElement(FirstSpawnGuide));

    const toggle = screen.getByTestId("first-spawn-guide-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("first-spawn-guide-body")).toBeNull();
    expect(storage.get(COLLAPSED_KEY)).toBe("1");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("first-spawn-guide-body")).toBeTruthy();
  });

  it("칩 클릭은 보이는 명령 자체를 오케스트레이터에 삽입한다", async () => {
    const writeAndSubmit = vi.fn(async () => undefined);
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { pty: { writeAndSubmit } },
    });
    useOrchestratorStore.setState({ ptySessionId: "orch-1" });

    render(createElement(FirstSpawnGuide));
    fireEvent.click(screen.getByTestId("first-spawn-guide-cmd-/tf-start"));

    await vi.waitFor(() => {
      expect(writeAndSubmit).toHaveBeenCalledWith("orch-1", "/tf-start");
    });
  });

  it("처음 한 번만 펄스를 표시한다", () => {
    const { container } = render(createElement(FirstSpawnGuide));
    expect(storage.get(SEEN_KEY)).toBe("1");
    expect(container.firstElementChild?.className).toContain("shadow-[0_0_0_3px");
  });
});
