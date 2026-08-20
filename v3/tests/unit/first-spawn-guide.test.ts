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
import { ko } from "../../src/locales/ko";
import { useOrchestratorStore } from "../../src/stores/orchestratorStore";

const COLLAPSED_KEY = "marblo.firstSpawnGuide.collapsed";
const SEEN_KEY = "marblo.firstSpawnGuide.seen";
const RAIL_COMMANDS = [
  "/tf-add",
  "/tf-spawn-agents",
  "/tf-plan",
  "/tf-start",
];
const GUIDE_COMMANDS = [...RAIL_COMMANDS, "/tf-guide"];

function commandsIn(scope: ParentNode): (string | undefined)[] {
  return [...scope.querySelectorAll("[data-testid^='first-spawn-guide-cmd-']")].map(
    (element) => element.getAttribute("data-testid")?.replace("first-spawn-guide-cmd-", ""),
  );
}

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

    const commands = commandsIn(document);
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

  it("★접힌 상태에서도 실행 명령 넷이 바 위에 보이고, 덜 급한 안내는 펼침 안에 있다", () => {
    render(createElement(FirstSpawnGuide));

    const rail = screen.getByTestId("first-spawn-guide-rail");
    expect(screen.getByTestId("first-spawn-guide-toggle").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("first-spawn-guide-body")).toBeNull();

    // 명령어 문자열 자체가 접힌 상태에 노출된다 — 칩 순서도 작은일→큰일.
    expect(commandsIn(rail)).toEqual(RAIL_COMMANDS);
    for (const command of RAIL_COMMANDS) {
      expect(screen.getByTestId(`first-spawn-guide-cmd-${command}`).textContent).toContain(command);
    }

    // 한 줄 계약: 바는 줄바꿈하지 않는다. 폭이 모자라면 칩 줄이 가로로
    // 스크롤될 뿐, 칩 자체는 줄어들거나 잘리지 않는다.
    expect(rail.className).toContain("flex-nowrap");
    expect(rail.className).toContain("overflow-hidden");
    const chipRow = screen.getByTestId("first-spawn-guide-rail-commands");
    expect(chipRow.className).toContain("overflow-x-auto");
    for (const command of RAIL_COMMANDS) {
      const chip = screen.getByTestId(`first-spawn-guide-cmd-${command}`);
      expect(chip.className).toContain("shrink-0");
      expect(chip.className).toContain("whitespace-nowrap");
    }

    // 가장 덜 급한 '전체 목록 / tf-guide' 안내는 접힌 바에 없다.
    const allCommands = ko["onboarding.firstSpawn.allCommands"];
    expect(rail.textContent).not.toContain(allCommands);
    fireEvent.click(screen.getByTestId("first-spawn-guide-toggle"));
    expect(screen.getByTestId("first-spawn-guide-body").textContent).toContain(allCommands);
  });

  it("접힌 채로 칩을 눌러도 펼치지 않고 곧바로 오케에 삽입한다", async () => {
    const writeAndSubmit = vi.fn(async () => undefined);
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { pty: { writeAndSubmit } },
    });
    useOrchestratorStore.setState({ ptySessionId: "orch-1" });

    render(createElement(FirstSpawnGuide));
    fireEvent.click(screen.getByTestId("first-spawn-guide-cmd-/tf-spawn-agents"));

    await vi.waitFor(() => {
      expect(writeAndSubmit).toHaveBeenCalledWith("orch-1", "/tf-spawn-agents");
    });
    expect(screen.getByTestId("first-spawn-guide-toggle").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("first-spawn-guide-body")).toBeNull();
  });

  it("처음 한 번만 펄스를 표시한다", () => {
    render(createElement(FirstSpawnGuide));
    expect(storage.get(SEEN_KEY)).toBe("1");
    expect(screen.getByTestId("first-spawn-guide-rail").className).toContain("shadow-[0_0_0_3px");
  });
});
