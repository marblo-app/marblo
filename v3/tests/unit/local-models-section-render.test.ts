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
          paramBillions: 0.5,
          huggingFaceUrl: "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct",
          toolSupport: "chat-only",
          toolSupportLabel: "대화·업무 분배",
          installed: false,
          fits: true,
          action: "pull",
          memoryTier: "8",
          source: "catalog",
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

// ── eVe336EESa7azzfLvDZV — 큐레이션 UI 4종 ──────────────────────────

/** 카드 픽스처. 기본은 카탈로그 행이고, 필요한 축만 덮어쓴다. */
function card(over: Partial<LocalModelCard> & { id: string }): LocalModelCard {
  return {
    displayName: over.id,
    category: "general",
    categoryLabel: "범용",
    downloadSizeMB: 2_000,
    minRamGB: 8,
    contextTokens: 128_000,
    huggingFaceUrl: "https://huggingface.co/example/Example",
    paramBillions: 8,
    toolSupport: "chat-only",
    toolSupportLabel: "대화·업무 분배",
    fits: true,
    installed: false,
    action: "pull",
    memoryTier: "8",
    source: "catalog",
    ...over,
  } as LocalModelCard;
}

describe("LocalModelsSection — ★tool-use 배지 3티어", () => {
  it("경량 티어를 '대화 전용'으로 표시하지 않는다 (이분 분기 회귀)", async () => {
    installLocalModelsStub({
      cards: [
        card({
          id: "gemma3:27b",
          displayName: "Gemma 3 27B Vision",
          minRamGB: 48,
          paramBillions: 27,
          toolSupport: "tool-use-lite",
          toolSupportLabel: "도구 사용 가능(경량 주입)",
          memoryTier: "48plus",
          fits: false,
          action: "insufficient-ram",
        }),
      ],
    });
    render(createElement(LocalModelsSection));

    expect(
      await screen.findByText(ko["harness.store.local.badgeToolUseLite"]),
    ).toBeTruthy();
    // ★핵심 회귀: 경량 티어가 chat-only 배지로 새면 안 된다.
    expect(
      screen.queryByText(ko["harness.store.local.badgeChatOnly"]),
    ).toBeNull();
    expect(
      screen.queryByText(ko["harness.store.local.badgeToolUse"]),
    ).toBeNull();
  });

  it("세 티어가 서로 다른 배지를 낸다", async () => {
    installLocalModelsStub({
      cards: [
        card({ id: "qwen3:4b", toolSupport: "chat-only" }),
        card({
          id: "qwen3.8:27b",
          toolSupport: "tool-use-lite",
          minRamGB: 48,
          memoryTier: "48plus",
        }),
        card({
          id: "qwen3:32b",
          toolSupport: "tool-use",
          minRamGB: 48,
          memoryTier: "48plus",
        }),
      ],
    });
    render(createElement(LocalModelsSection));

    expect(
      await screen.findByText(ko["harness.store.local.badgeChatOnly"]),
    ).toBeTruthy();
    expect(
      screen.getByText(ko["harness.store.local.badgeToolUseLite"]),
    ).toBeTruthy();
    expect(
      screen.getByText(ko["harness.store.local.badgeToolUse"]),
    ).toBeTruthy();
  });

  it("설치됨 안내 문구도 3티어로 갈린다", async () => {
    installLocalModelsStub({
      cards: [
        card({
          id: "gemma3:27b",
          toolSupport: "tool-use-lite",
          installed: true,
          action: "installed",
          minRamGB: 48,
          memoryTier: "48plus",
        }),
      ],
    });
    render(createElement(LocalModelsSection));

    expect(
      await screen.findByText(
        ko["harness.store.local.installedHintToolUseLite"],
      ),
    ).toBeTruthy();
    expect(
      screen.queryByText(ko["harness.store.local.installedHintChatOnly"]),
    ).toBeNull();
  });
});

describe("LocalModelsSection — ★모델명 잘림", () => {
  it("가장 긴 태그도 truncate 없이 끝까지 그린다", async () => {
    const longId = "deepseek-r1:14b-qwen-distill-q4_K_M";
    installLocalModelsStub({
      cards: [
        card({
          id: longId,
          displayName: "DeepSeek-R1 Distill Qwen 14B",
          minRamGB: 24,
          memoryTier: "32",
        }),
      ],
    });
    render(createElement(LocalModelsSection));

    // 태그 전체가 한 노드에 그대로 있어야 한다(잘린 텍스트 노드가 아니라).
    const tag = await screen.findByText(longId);
    expect(tag.textContent).toBe(longId);
    // truncate 는 말줄임(...)으로 끝을 지운다 — 이름/태그 어느 쪽에도 없어야 한다.
    expect(tag.className).not.toContain("truncate");
    expect(tag.className).toContain("break-all");
    const name = screen.getByText("DeepSeek-R1 Distill Qwen 14B");
    expect(name.className).not.toContain("truncate");
  });
});

describe("LocalModelsSection — ★HuggingFace 링크", () => {
  it("카드에서 모델 원본으로 가는 외부 링크를 준다(OS 브라우저 처리 그대로)", async () => {
    installLocalModelsStub({
      cards: [
        card({
          id: "qwen3:8b",
          displayName: "Qwen 3 8B",
          huggingFaceUrl: "https://huggingface.co/Qwen/Qwen3-8B",
        }),
      ],
    });
    render(createElement(LocalModelsSection));

    const link = (await screen.findByText(
      `${ko["harness.store.local.huggingFace"]} ↗`,
    )) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(
      "https://huggingface.co/Qwen/Qwen3-8B",
    );
    // main 의 setWindowOpenHandler 가 https + _blank 를 shell.openExternal 로
    // 넘긴다 — 새 IPC 없이 OS 기본 브라우저로 열리는 기존 처리.
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.getAttribute("aria-label")).toContain("Qwen 3 8B");
  });

  it("원본 링크를 모르는 설치분(카탈로그 밖)은 링크를 지어내지 않는다", async () => {
    installLocalModelsStub({
      cards: [
        card({
          id: "mystery:7b",
          huggingFaceUrl: undefined,
          downloadSizeMB: undefined,
          contextTokens: undefined,
          minRamGB: 0,
          memoryTier: null,
          installed: true,
          action: "installed",
          source: "installed-outside-catalog",
        }),
      ],
    });
    render(createElement(LocalModelsSection));

    expect(
      await screen.findByText(ko["harness.store.local.outsideCatalogTitle"]),
    ).toBeTruthy();
    expect(
      screen.queryByText(`${ko["harness.store.local.huggingFace"]} ↗`),
    ).toBeNull();
    // 모르는 값을 0 으로 그리지 않는다.
    expect(document.body.textContent ?? "").not.toContain(
      `${ko["harness.store.local.minRam"]}: 0 GB`,
    );
  });
});

describe("LocalModelsSection — ★메모리 구간별 큐레이션", () => {
  it("구간별 섹션으로 묶고, 전부 도는 구간에만 '실행 가능' 칩을 단다", async () => {
    installLocalModelsStub({
      hardware: { totalMemGB: 16, platform: "darwin", unifiedMemory: true },
      cards: [
        card({ id: "qwen3:4b", memoryTier: "8", minRamGB: 8, fits: true }),
        card({ id: "qwen3:8b", memoryTier: "16", minRamGB: 12, fits: true }),
        card({
          id: "qwen3:32b",
          memoryTier: "48plus",
          minRamGB: 48,
          fits: false,
          action: "insufficient-ram",
        }),
      ],
    });
    render(createElement(LocalModelsSection));

    expect(
      await screen.findByText(ko["harness.store.local.memoryTierTitle.8"]),
    ).toBeTruthy();
    expect(
      screen.getByText(ko["harness.store.local.memoryTierTitle.16"]),
    ).toBeTruthy();
    expect(
      screen.getByText(ko["harness.store.local.memoryTierTitle.48plus"]),
    ).toBeTruthy();
    // 카드가 없는 구간(32GB)은 빈 헤더를 남기지 않는다.
    expect(
      screen.queryByText(ko["harness.store.local.memoryTierTitle.32"]),
    ).toBeNull();

    // 16GB 기기: 8/16 구간은 전부 실행 가능, 48GB+ 구간은 전부 부족.
    expect(
      screen.getAllByText(ko["harness.store.local.memoryTierRunnable"]),
    ).toHaveLength(2);
    expect(
      screen.getAllByText(ko["harness.store.local.memoryTierTooBig"]),
    ).toHaveLength(1);
  });

  it("일부만 도는 구간은 구간 칩을 달지 않는다(뭉뚱그린 거짓말 금지)", async () => {
    installLocalModelsStub({
      hardware: { totalMemGB: 24, platform: "darwin", unifiedMemory: true },
      cards: [
        card({ id: "qwen3:14b", memoryTier: "32", minRamGB: 24, fits: true }),
        card({
          id: "mistral-small:24b",
          memoryTier: "32",
          minRamGB: 32,
          fits: false,
          action: "insufficient-ram",
        }),
      ],
    });
    render(createElement(LocalModelsSection));

    expect(
      await screen.findByText(ko["harness.store.local.memoryTierTitle.32"]),
    ).toBeTruthy();
    expect(
      screen.queryByText(ko["harness.store.local.memoryTierRunnable"]),
    ).toBeNull();
    expect(
      screen.queryByText(ko["harness.store.local.memoryTierTooBig"]),
    ).toBeNull();
    // 카드별 배지는 여전히 정확한 답을 준다.
    expect(screen.getByText(ko["harness.store.local.fits"])).toBeTruthy();
  });
});
