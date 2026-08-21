/**
 * @vitest-environment jsdom
 *
 * `VendorCard` 표시 밀도 — 하네스탭(compact)과 온보딩(full)이 **같은 카드**를 쓰되
 * 서로 다른 밀도로 그린다.
 *
 * ── 무엇을 막는 테스트인가 ──────────────────────────────────────────────
 * 이 카드는 세 화면이 공유한다(시작하기 탭 / ②단계 BYOM / 하네스탭). 하네스탭은
 * env-swap 벤더만 담고 섹션 헤더가 "API 키만 등록해 claude 하네스로 쓰는 벤더" 라고
 * 이미 말하지만, 온보딩 두 곳은 목록에 자체 CLI 벤더(Grok)가 섞여 있어 그 문장을
 * 카드가 직접 말해야 한다. 하네스탭 기준으로 문구를 지우면 온보딩 첫인상이 같이
 * 사라지므로, 여기서 **양쪽을 한 파일에서 동시에** 못박는다.
 *
 * 그리고 줄이더라도 **지우면 안 되는 것**(키 입력·keychain 고지·정확한 model id·
 * Re-check/고급설정·Ready 배지와 그 원문)이 compact 에서도 여전히 닿는지 확인한다.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

// VendorCard → CliSetupRows → cliSetupActions → projectStore → services/firestore
// 로 firebase 초기화까지 끌려온다. 이 테스트가 보는 것은 카드가 그리는 문구뿐이라
// 그 끝단만 막는다(렌더 트리 자체는 실제 컴포넌트 그대로 둔다).
vi.mock("../../src/lib/firebase", () => ({
  app: {},
  auth: {},
  db: {},
  functions: {},
  FIREBASE_FUNCTIONS_REGION: "us-central1",
  isPackagedLoopbackAuth: false,
}));

import { VendorCard } from "../../src/components/onboarding/VendorCard";
import type { VendorSetupCard } from "../../src/lib/vendorOnboarding";
import { useLocaleStore } from "../../src/lib/i18n";
import { useVendorSecretsStore } from "../../src/stores/vendorSecretsStore";
import { ko } from "../../src/locales/ko";
import { en } from "../../src/locales/en";

function card(over: Partial<VendorSetupCard> = {}): VendorSetupCard {
  return {
    vendor: "zai",
    label: "Z.ai GLM",
    harness: "claude",
    command: "claude",
    kind: "envSwap",
    status: "ready",
    requiredEnvKeys: ["ZAI_API_KEY"],
    missingEnvKeys: [],
    modelIds: ["glm-4.6", "glm-4.5-air"],
    exampleModelId: "glm-4.6",
    cliRowId: null,
    ...over,
  };
}

function renderCard(over: Partial<VendorSetupCard>, density?: "compact") {
  return render(
    createElement(VendorCard, {
      card: card(over),
      onOpenKeySettings: vi.fn(),
      onRecheckKeys: vi.fn(),
      density,
    }),
  );
}

/** ko 원문에서 `{...}` 자리를 뺀, 어느 벤더에서나 같은 고정 조각. */
const KIND_FIXED = "새 CLI 없이 구독키만 등록하면 켜집니다";

afterEach(() => {
  cleanup();
  useLocaleStore.setState({ locale: "ko" });
});

describe("VendorCard — 하네스탭(compact)에서 카드마다 반복되던 문장을 덜어낸다", () => {
  it("안내 문장이 한 줄도 서지 않는다(ready): 벤더 공통 문구·Ready 중복 문장·dispatch 라벨", () => {
    renderCard({}, "compact");

    // 섹션 헤더가 이미 한 말 — 카드 수만큼 반복시키지 않는다.
    expect(screen.queryByText(new RegExp(KIND_FIXED))).toBeNull();
    // `Ready` 배지가 같은 말을 한다.
    expect(
      screen.queryByText(
        new RegExp(ko["onboarding.startHere.vendors.key.ready"].slice(0, 12)),
      ),
    ).toBeNull();
    // 바로 아래 스니펫 + Copy 가 이미 그 뜻이고, 라벨은 섹션이 한 번만 말한다.
    expect(
      screen.queryByText(ko["onboarding.startHere.vendors.dispatchLabel"]),
    ).toBeNull();
  });

  it("카드마다 실제로 다른 것(어느 바이너리로 도는지)은 남고, 공통 문장은 hover 로 닿는다", () => {
    renderCard({ command: "codex" }, "compact");

    const chip = screen.getByText("codex");
    expect(chip.getAttribute("title")).toContain(KIND_FIXED);
  });

  it("★Ready 배지와 그 원문(새로 스폰하는 에이전트부터 적용)이 여전히 도달 가능하다", () => {
    renderCard({}, "compact");

    const badge = screen.getByText(
      ko["onboarding.startHere.vendors.status.ready"],
    );
    expect(badge.getAttribute("title")).toBe(
      ko["onboarding.startHere.vendors.key.ready"],
    );
  });

  it("★키 입력·keychain 고지·Re-check·고급설정은 compact 에서도 그대로 남는다", () => {
    renderCard(
      { status: "needsKey", missingEnvKeys: ["ZAI_API_KEY"] },
      "compact",
    );

    expect(screen.getByLabelText("ZAI_API_KEY")).toBeTruthy();
    expect(
      screen.getByText(/OS 키체인에 암호화 저장되고 화면으로 다시 나오지/),
    ).toBeTruthy();
    expect(
      screen.getByText(ko["onboarding.startHere.vendors.key.save"]),
    ).toBeTruthy();
    expect(
      screen.getByText(ko["onboarding.startHere.vendors.key.recheck"]),
    ).toBeTruthy();
    expect(
      screen.getByText(ko["onboarding.startHere.vendors.key.settings"]),
    ).toBeTruthy();
  });

  it("★모델 칩과 Copy 가 복사하는 정확한 model id 는 밀도와 무관하게 남는다", () => {
    renderCard({}, "compact");

    expect(screen.getByText("glm-4.6")).toBeTruthy();
    expect(screen.getByText("glm-4.5-air")).toBeTruthy();
    expect(screen.getByText(/model="glm-4\.6"/)).toBeTruthy();
  });

  it("needsKey 카드에 남는 안내 문장은 keychain 고지 한 줄뿐이다", () => {
    const { container } = renderCard(
      { status: "needsKey", missingEnvKeys: ["ZAI_API_KEY"] },
      "compact",
    );

    // 문단(<p>)으로 서는 안내 줄만 센다 — 버튼/코드/칩은 문장이 아니다.
    const paragraphs = [...container.querySelectorAll("p")].filter((p) =>
      (p.textContent ?? "").trim(),
    );
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0].textContent).toContain("필요한 키: ZAI_API_KEY");
  });

  it("ready 카드에는 안내 문장이 하나도 남지 않는다", () => {
    const { container } = renderCard({}, "compact");

    const paragraphs = [...container.querySelectorAll("p")].filter((p) =>
      (p.textContent ?? "").trim(),
    );
    expect(paragraphs).toHaveLength(0);
  });
});

describe("VendorCard — 숨긴 ready 문장이 '방금 저장한 그 순간' 에는 뜬다", () => {
  it("키를 저장해 ready 로 뒤집히면 '새로 스폰하는 에이전트부터 적용' 안내가 그때 한 번 보인다", async () => {
    const saveSecret = vi.fn(async () => {});
    useVendorSecretsStore.setState({ saveSecret });

    const props = {
      onOpenKeySettings: vi.fn(),
      onRecheckKeys: vi.fn(),
      density: "compact" as const,
    };
    const { rerender } = render(
      createElement(VendorCard, {
        card: card({ status: "needsKey", missingEnvKeys: ["ZAI_API_KEY"] }),
        ...props,
      }),
    );

    fireEvent.change(screen.getByLabelText("ZAI_API_KEY"), {
      target: { value: "sk-test" },
    });
    fireEvent.click(
      screen.getByText(ko["onboarding.startHere.vendors.key.save"]),
    );
    await waitFor(() =>
      expect(saveSecret).toHaveBeenCalledWith("ZAI_API_KEY", "sk-test"),
    );

    // 저장이 성공하면 스냅샷이 갱신되며 카드가 ready 로 다시 그려진다 —
    // 그 순간 입력 UI(와 그 아래 "안전 저장했습니다")가 통째로 사라지므로,
    // 확인은 ready 쪽에서 이어받아야 한다.
    rerender(
      createElement(VendorCard, { card: card({ status: "ready" }), ...props }),
    );

    await waitFor(() =>
      expect(
        screen.getByText(
          new RegExp(ko["onboarding.startHere.vendors.key.ready"].slice(0, 12)),
        ),
      ).toBeTruthy(),
    );
  });
});

describe("VendorCard — 온보딩(full, 기본값)은 첫인상 문구를 그대로 유지한다", () => {
  it("★'새 CLI 없이 구독키만' 문장이 카드에 남는다(이 목록엔 CLI 벤더가 섞여 섹션이 대신 말해주지 않는다)", () => {
    renderCard({});

    expect(screen.getByText(new RegExp(KIND_FIXED))).toBeTruthy();
    expect(
      screen.getByText(ko["onboarding.startHere.vendors.dispatchLabel"]),
    ).toBeTruthy();
  });

  it("en 로케일에서도 같은 자리에 같은 정보가 선다(한쪽만 고치면 문장이 깨진다)", () => {
    useLocaleStore.setState({ locale: "en" });
    renderCard({});

    expect(
      screen.getByText(/no new CLI, just a subscription key/),
    ).toBeTruthy();
    expect(
      screen.getByText(en["onboarding.startHere.vendors.dispatchLabel"]),
    ).toBeTruthy();
  });

  it("en compact 도 ko compact 와 같은 것을 덜어낸다", () => {
    useLocaleStore.setState({ locale: "en" });
    renderCard({ command: "codex" }, "compact");

    expect(
      screen.queryByText(/no new CLI, just a subscription key/),
    ).toBeNull();
    expect(
      screen.queryByText(en["onboarding.startHere.vendors.dispatchLabel"]),
    ).toBeNull();
    expect(screen.getByText("codex").getAttribute("title")).toContain(
      "no new CLI, just a subscription key",
    );
    expect(
      screen
        .getByText(en["onboarding.startHere.vendors.status.ready"])
        .getAttribute("title"),
    ).toBe(en["onboarding.startHere.vendors.key.ready"]);
  });

  it("ready 문장은 두 밀도 모두에서 평상시 숨는다 — 배지가 상태를 말한다", () => {
    renderCard({});

    expect(
      screen.queryByText(
        new RegExp(ko["onboarding.startHere.vendors.key.ready"].slice(0, 12)),
      ),
    ).toBeNull();
    expect(
      screen
        .getByText(ko["onboarding.startHere.vendors.status.ready"])
        .getAttribute("title"),
    ).toBe(ko["onboarding.startHere.vendors.key.ready"]);
  });
});
