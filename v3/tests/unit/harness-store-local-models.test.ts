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
  EnvSwapVendorSection: () =>
    createElement("div", { "data-testid": "env-swap-section" }, "EnvSwap"),
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
  (
    globalThis as unknown as { window: { electronAPI: unknown } }
  ).window.electronAPI = {
    harness: {
      list: vi.fn(async () => []),
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
  it("기본(전체) 필터에서 EnvSwap 옆 LocalModelsSection(showSectionChrome)을 그린다", async () => {
    render(createElement(HarnessStore));

    expect(await screen.findByTestId("env-swap-section")).toBeTruthy();
    const local = await screen.findByTestId("local-models-section");
    expect(local.getAttribute("data-chrome")).toBe("1");
    expect(localModelsSpy).toHaveBeenCalledWith(
      expect.objectContaining({ showSectionChrome: true }),
    );
  });

  it("envswap 필터에서도 로컬모델 섹션이 보인다", async () => {
    render(createElement(HarnessStore));

    fireEvent.click(screen.getByText(ko["harness.store.cat.envswap"]));

    expect(await screen.findByTestId("local-models-section")).toBeTruthy();
    expect(screen.getByTestId("env-swap-section")).toBeTruthy();
  });

  it("cli 필터에서는 로컬모델·env-swap 섹션을 접는다", async () => {
    render(createElement(HarnessStore));

    fireEvent.click(screen.getByText(ko["harness.store.cat.cli"]));

    expect(screen.queryByTestId("local-models-section")).toBeNull();
    expect(screen.queryByTestId("env-swap-section")).toBeNull();
  });
});
