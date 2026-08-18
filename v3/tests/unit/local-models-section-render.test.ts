/**
 * @vitest-environment jsdom
 *
 * LocalModelsSection — Ollama 설치 가이드 접힘/열림 + 하네스탭 섹션 크롬.
 * ConnectorGuidePanel(#939) 패턴: 기본 접힘, 토글 시 설치→pull→스폰 단계 노출.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { LocalModelsSection } from "../../src/components/store/LocalModelsSection";
import { useLocaleStore } from "../../src/lib/i18n";
import { ko } from "../../src/locales/ko";

function installLocalModelsStub(
  overrides: Partial<LocalModelsInfoResponse> = {},
) {
  const info: LocalModelsInfoResponse = {
    hardware: { totalMemGB: 16, platform: "darwin", unifiedMemory: true },
    ollama: { installed: true, daemonRunning: true, version: "0.6.0" },
    installedIds: [],
    cards: [],
    ...overrides,
  };
  let progressHandler: ((ev: LocalModelsPullEvent) => void) | null = null;
  const api = {
    info: vi.fn(async () => info),
    pull: vi.fn(
      async () =>
        new Promise<{ success: boolean; cancelled?: boolean; error?: string }>(
          () => undefined,
        ),
    ),
    cancelPull: vi.fn(async () => ({ success: true })),
    onPullProgress: vi.fn((cb: (ev: LocalModelsPullEvent) => void) => {
      progressHandler = cb;
    }),
    offPullProgress: vi.fn(),
    emitProgress: (ev: LocalModelsPullEvent) => progressHandler?.(ev),
  };
  (
    globalThis as unknown as { window: { electronAPI: unknown } }
  ).window.electronAPI = { localModels: api };
  return api;
}

beforeEach(() => {
  useLocaleStore.setState({ locale: "ko" });
});

afterEach(cleanup);

describe("LocalModelsSection — Ollama 가이드 (접힘/열림)", () => {
  it("기본값은 접힘이고, 토글하면 설치→pull→스폰 단계가 펼쳐진다", async () => {
    installLocalModelsStub();
    render(createElement(LocalModelsSection));

    const toggle = await screen.findByText(
      ko["harness.store.local.guide.toggle"],
    );
    const toggleButton = toggle.closest("button") as HTMLButtonElement;
    expect(toggleButton.getAttribute("aria-expanded")).toBe("false");
    expect(document.body.textContent ?? "").not.toContain(
      ko["harness.store.local.guide.step2"],
    );

    fireEvent.click(toggleButton);

    expect(toggleButton.getAttribute("aria-expanded")).toBe("true");
    const bodyText = document.body.textContent ?? "";
    expect(bodyText).toContain(ko["harness.store.local.guide.step1Before"]);
    expect(bodyText).toContain(ko["harness.store.local.guide.step2"]);
    expect(bodyText).toContain(ko["harness.store.local.guide.step3"]);
    expect(bodyText).toContain(ko["harness.store.local.guideRam"]);
    expect(bodyText).toContain(ko["harness.store.local.guideToolUse"]);

    fireEvent.click(toggleButton);
    expect(toggleButton.getAttribute("aria-expanded")).toBe("false");
    expect(document.body.textContent ?? "").not.toContain(
      ko["harness.store.local.guide.step2"],
    );
  });

  it("1단계 링크는 ollama.com/download 를 새 탭으로 연다", async () => {
    installLocalModelsStub();
    render(createElement(LocalModelsSection));

    fireEvent.click(
      await screen.findByText(ko["harness.store.local.guide.toggle"]),
    );

    const link = screen.getByText("ollama.com/download") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("https://ollama.com/download");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });
});

describe("LocalModelsSection — 하네스탭 섹션 크롬", () => {
  it("showSectionChrome 이면 title/subtitle 헤더를 그린다", async () => {
    installLocalModelsStub();
    render(createElement(LocalModelsSection, { showSectionChrome: true }));

    expect(
      await screen.findByText(ko["harness.store.local.title"]),
    ).toBeTruthy();
    expect(screen.getByText(ko["harness.store.local.subtitle"])).toBeTruthy();
  });

  it("기본(스토어탭 임베드)에서는 섹션 title 을 그리지 않는다", async () => {
    installLocalModelsStub();
    render(createElement(LocalModelsSection));

    await screen.findByText(ko["harness.store.local.guide.toggle"]);
    expect(screen.queryByText(ko["harness.store.local.title"])).toBeNull();
  });
});

describe("LocalModelsSection — Ollama pull CTA", () => {
  it("pull 가능한 모델은 primary 버튼으로 표시하고 진행률을 progressbar로 보여준다", async () => {
    const api = installLocalModelsStub({
      cards: [
        {
          id: "qwen2.5:0.5b",
          displayName: "Qwen 2.5 0.5B",
          category: "general",
          categoryLabel: "범용",
          downloadSizeMB: 397,
          minRamGB: 4,
          contextTokens: 32768,
          toolSupport: "chat-only",
          toolSupportLabel: "대화 전용",
          installed: false,
          fits: true,
          action: "pull",
        },
      ],
    });
    render(createElement(LocalModelsSection));

    const pull = await screen.findByRole("button", {
      name: ko["harness.store.local.pull"],
    });
    expect(pull.className).toContain("bg-[#89b4fa]");

    fireEvent.click(pull);
    api.emitProgress({
      id: "qwen2.5:0.5b",
      phase: "progress",
      percent: 42,
    });

    expect(
      await screen.findByText(ko["harness.store.local.installing"]),
    ).toBeTruthy();
    expect(screen.getByText("42%")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "42",
    );
  });
});
