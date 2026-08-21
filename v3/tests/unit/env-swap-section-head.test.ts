/**
 * @vitest-environment jsdom
 *
 * 하네스탭 **env-swap 섹션 머리** — 제목 + 한 줄, 그 이상 서지 않는다.
 *
 * ── 어쩌다 세 줄이 됐나 ─────────────────────────────────────────────────
 * #1066 은 카드마다 반복되던 "띄우는 법" 라벨을 섹션으로 한 번만 올렸다. 반복은
 * 사라졌지만 이번엔 **섹션 머리**가 제목 · 설명 · "띄우는 법" 세 줄이 됐다. 그
 * 라벨이 하던 일은 아래 스니펫이 어디에 쓰는 것인지 말해 주는 것 하나뿐이라,
 * 설명 한 줄의 꼬리("모델을 명시해서 오케에게 요청해보세요")로 합쳤다.
 *
 * ── ★이 테스트가 진짜로 막는 것 ─────────────────────────────────────────
 * 합치면서 `onboarding.startHere.vendors.dispatchLabel` **원문을 갈면** 온보딩 두
 * 곳(시작하기 탭 `VendorModelsSection` · ②단계 `ByomStartSection`)이 같이 바뀐다 —
 * 둘 다 같은 `VendorCard` 를 `density="full"` 로 쓰고, full 은 그 키를 그린다.
 * #1066 에서 이미 한 번 걸린 지점이다. 그래서 여기서 **하네스탭(안 뜬다)과
 * 온보딩(뜬다)을 한 파일에서 동시에** 못박는다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";

// VendorCard → CliSetupRows → … → services/firestore 로 firebase 초기화까지
// 끌려온다. 이 테스트가 보는 것은 그려진 문구뿐이라 그 끝단만 막는다.
vi.mock("../../src/lib/firebase", () => ({
  app: {},
  auth: {},
  db: {},
  functions: {},
  FIREBASE_FUNCTIONS_REGION: "us-central1",
  isPackagedLoopbackAuth: false,
}));

const option = {
  vendor: "zai",
  label: "Z.ai GLM",
  harness: "claude" as const,
  command: "claude",
  kind: "envSwap" as const,
  status: "ready" as const,
  requiredEnvKeys: ["ZAI_API_KEY"],
  missingEnvKeys: [] as string[],
  modelIds: ["glm-4.6"],
  exampleModelId: "glm-4.6",
  cliRowId: null,
  canHostOrchestrator: false,
};

vi.mock("../../src/hooks/useByomOptions", () => ({
  useByomOptions: () => ({
    options: [option, { ...option, vendor: "minimax", label: "MiniMax" }],
    gate: { satisfied: false, reason: null },
    status: "ready",
    reloadCatalog: vi.fn(),
    recheckKeys: vi.fn(),
  }),
}));

import { EnvSwapVendorSection } from "../../src/components/harness/EnvSwapVendorSection";
import { VendorCard } from "../../src/components/onboarding/VendorCard";
import type { VendorSetupCard } from "../../src/lib/vendorOnboarding";
import { useLocaleStore } from "../../src/lib/i18n";
import { ko } from "../../src/locales/ko";
import { en } from "../../src/locales/en";

// ★locale 을 **매 테스트 앞에서** 못박는다. 초기값은 `detectInitialLocale()` 이라
// jsdom 에서 en 으로 시작한다 — afterEach 로만 ko 를 돌려놓으면 첫 테스트만 en 으로
// 그려지고, ko 원문을 찾는 단언이 "못 찾았으니 통과" 로 새어 나간다(실제로 겪었다).
beforeEach(() => {
  useLocaleStore.setState({ locale: "ko" });
});

afterEach(() => {
  cleanup();
  useLocaleStore.setState({ locale: "ko" });
});

describe("하네스탭 env-swap 섹션 머리 — 세 줄에서 두 줄로", () => {
  it("★'띄우는 법' 라벨 줄이 섹션에 서지 않는다(라이브 경로: showSectionChrome={false})", () => {
    render(createElement(EnvSwapVendorSection, { showSectionChrome: false }));

    expect(
      screen.queryByText(ko["onboarding.startHere.vendors.dispatchLabel"]),
    ).toBeNull();
    // 라벨이 없어도 카드마다 다른 것(모델 id 스니펫)은 그대로 남는다.
    expect(screen.getAllByText(/glm-4\.6/).length).toBeGreaterThan(0);
  });

  it("chrome 을 켜도 설명은 한 줄뿐이고, 바깥 헤더와 **같은 키**를 쓴다", () => {
    render(createElement(EnvSwapVendorSection, { showSectionChrome: true }));

    expect(
      screen.getByText(ko["harness.store.section.envSwapDesc"]),
    ).toBeTruthy();
    expect(
      screen.queryByText(ko["onboarding.startHere.vendors.dispatchLabel"]),
    ).toBeNull();
  });

  it("en 도 같다 — 한쪽만 고치면 로케일마다 줄 수가 달라진다", () => {
    useLocaleStore.setState({ locale: "en" });
    render(createElement(EnvSwapVendorSection, { showSectionChrome: false }));

    expect(
      screen.queryByText(en["onboarding.startHere.vendors.dispatchLabel"]),
    ).toBeNull();
  });
});

describe("합친 한 줄이 실제로 '요청 가이드' 이고, 더 짧다", () => {
  // 라벨을 그냥 지우면 아래 코드블록이 어디에 붙여넣는 것인지 화면 어디에도 없다.
  it("★ko/en 모두 '어느 모델을' + '오케에게 요청' 을 말한다", () => {
    expect(ko["harness.store.section.envSwapDesc"]).toMatch(/모델/);
    expect(ko["harness.store.section.envSwapDesc"]).toMatch(/오케.*요청/);
    expect(en["harness.store.section.envSwapDesc"]).toMatch(/model/i);
    expect(en["harness.store.section.envSwapDesc"]).toMatch(/orchestrator/i);
  });

  it("★덜어내는 작업이다 — 합친 뒤가 합치기 전 두 줄 합보다 짧다", () => {
    for (const dict of [ko, en]) {
      const merged = dict["harness.store.section.envSwapDesc"].length;
      const before =
        merged + dict["onboarding.startHere.vendors.dispatchLabel"].length;
      expect(merged).toBeLessThan(before);
      // 한 줄에 두 문장까지다. 더 담기 시작하면 다시 길어진다.
      expect(merged).toBeLessThanOrEqual(110);
    }
  });
});

describe("★온보딩 두 곳(full)은 흔들리지 않는다", () => {
  function fullCard(over: Partial<VendorSetupCard> = {}) {
    return render(
      createElement(VendorCard, {
        card: { ...option, ...over } as VendorSetupCard,
        onOpenKeySettings: vi.fn(),
        onRecheckKeys: vi.fn(),
      }),
    );
  }

  it("시작하기 탭·②단계가 쓰는 density=full 카드에는 dispatchLabel 이 그대로 선다", () => {
    fullCard();
    expect(
      screen.getByText(ko["onboarding.startHere.vendors.dispatchLabel"]),
    ).toBeTruthy();
  });

  it("en 도 그대로", () => {
    useLocaleStore.setState({ locale: "en" });
    fullCard();
    expect(
      screen.getByText(en["onboarding.startHere.vendors.dispatchLabel"]),
    ).toBeTruthy();
  });

  it("두 문구는 서로 다른 키다 — 하네스탭 문구를 고쳐도 온보딩 원문은 안 따라온다", () => {
    expect(ko["onboarding.startHere.vendors.dispatchLabel"]).toBe(
      "띄우는 법 — 오케스트레이터에게 이렇게 말하세요",
    );
    expect(en["onboarding.startHere.vendors.dispatchLabel"]).toBe(
      "How to launch it — say this to the orchestrator",
    );
  });
});
