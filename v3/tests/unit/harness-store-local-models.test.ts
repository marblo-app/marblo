/**
 * @vitest-environment jsdom
 *
 * HarnessStore — 로컬모델(Ollama) 섹션을 EnvSwapVendorSection 옆에 노출.
 * 심플/엑스퍼트 모두 같은 HarnessStore 인라인을 쓰므로 여기 배선만 검증.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const localModelsSpy = vi.fn(
  ({ showSectionChrome }: { showSectionChrome?: boolean }) =>
    createElement(
      "div",
      {
        "data-testid": "local-models-section",
        "data-chrome": showSectionChrome ? "1" : "0",
      },
      "LocalModelsSection",
    ),
);

vi.mock("../../src/components/store/LocalModelsSection", () => ({
  LocalModelsSection: (props: { showSectionChrome?: boolean }) =>
    localModelsSpy(props),
}));

vi.mock("../../src/components/harness/EnvSwapVendorSection", () => ({
  EnvSwapVendorSection: (props: { showSectionChrome?: boolean }) =>
    createElement(
      "div",
      {
        "data-testid": "env-swap-section",
        "data-chrome": props.showSectionChrome === false ? "0" : "1",
      },
      "EnvSwap",
    ),
}));

vi.mock("../../src/components/harness/ConnectionStatusPanel", () => ({
  ConnectionStatusPanel: () => null,
}));
vi.mock("../../src/components/harness/TelegramChannelPanel", () => ({
  TelegramChannelPanel: () => null,
}));
vi.mock("../../src/components/harness/SlackChannelPanel", () => ({
  SlackChannelPanel: () => null,
}));
vi.mock("../../src/components/harness/DriveConnectionPanel", () => ({
  DriveConnectionPanel: () => null,
}));
vi.mock("../../src/components/harness/NotionConnectionPanel", () => ({
  NotionConnectionPanel: () => null,
}));

import { HarnessStore } from "../../src/components/harness/HarnessStore";
import { useLocaleStore } from "../../src/lib/i18n";
import { ko } from "../../src/locales/ko";

function installHarnessStub() {
  const packages: HarnessPackage[] = [
    {
      id: "cli-claude-code",
      name: "Claude Code CLI",
      description: "Claude CLI",
      type: "cli",
      category: "required",
      install: { kind: "shell", source: "https://example.com/install.sh" },
      detect: { binary: "claude" },
      status: "not-installed",
    },
    {
      id: "marblo-mcp",
      name: "Marblo MCP",
      description: "Dashboard MCP",
      type: "mcp",
      category: "required",
      install: { kind: "bundled" },
      detect: { mcpKey: "marblo" },
      status: "installed",
    },
  ];
  (
    globalThis as unknown as { window: { electronAPI: unknown } }
  ).window.electronAPI = {
    harness: {
      list: vi.fn(async () => packages),
      versions: vi.fn(async () => ({})),
      install: vi.fn(),
      uninstall: vi.fn(),
      cliAuthCheck: vi.fn(),
    },
  };
}

beforeEach(() => {
  useLocaleStore.setState({ locale: "ko" });
  localModelsSpy.mockClear();
  installHarnessStub();
});

afterEach(cleanup);

describe("HarnessStore — 로컬모델 섹션 노출", () => {
  it("기본(전체) 필터에서 세 설치 영역을 헤더와 구분선 아래로 나눠 그린다", async () => {
    render(createElement(HarnessStore));

    expect(
      await screen.findByText(ko["harness.store.section.cli"]),
    ).toBeTruthy();
    expect(
      screen.getAllByText(ko["harness.store.envSwap.title"]).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(ko["harness.store.local.title"])).toBeTruthy();
    expect(screen.getByText("Claude Code CLI")).toBeTruthy();
    expect(screen.queryByText("Marblo MCP")).toBeNull();

    const envSwap = await screen.findByTestId("env-swap-section");
    expect(envSwap.getAttribute("data-chrome")).toBe("0");
    const local = await screen.findByTestId("local-models-section");
    expect(local.getAttribute("data-chrome")).toBe("0");
  });

  it("envswap 필터에서도 로컬모델 섹션이 보인다", async () => {
    render(createElement(HarnessStore));

    fireEvent.click(screen.getAllByText(ko["harness.store.cat.envswap"])[0]);

    expect(await screen.findByTestId("local-models-section")).toBeTruthy();
    expect(screen.getByTestId("env-swap-section")).toBeTruthy();
    expect(screen.queryByText(ko["harness.store.section.cli"])).toBeNull();
  });

  it("cli 필터에서는 로컬모델·env-swap 섹션을 접는다", async () => {
    render(createElement(HarnessStore));

    await screen.findByText("Claude Code CLI");
    fireEvent.click(screen.getByText(ko["harness.store.cat.cli"]));

    expect(
      await screen.findByText(ko["harness.store.section.cli"]),
    ).toBeTruthy();
    expect(screen.queryByTestId("local-models-section")).toBeNull();
    expect(screen.queryByTestId("env-swap-section")).toBeNull();
  });
});
