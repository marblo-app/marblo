/**
 * @vitest-environment jsdom
 *
 * 스토어 별점의 **실제 DOM 배선** 회귀 테스트.
 *
 * 산식(`registry-rating.test.ts`)과 정렬 규칙(`registryStoreRanking.test.ts`)을
 * 각각 고정해도, 그 값이 카드에 닿는 경로가 끊기면 아무 화면 변화도 없이
 * 조용히 옛 화면으로 돌아간다. 이 파일이 못박는 계약은 셋이다:
 *
 *   ① 메인이 내려준 별점이 **카드에 그려진다**(★ 개수까지)
 *   ② 목록이 **별점 내림차순**으로 그려진다(정렬 함수가 실제로 호출된다)
 *   ③ 근거가 **툴팁으로 읽힌다** — 근거 없는 별은 임의 별점과 구분이 안 된다
 *
 * ★그리고 별점이 없는 응답(옛 메인 프로세스)에서도 화면이 살아 있어야 한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../src/components/store/LocalModelsSection", () => ({
  LocalModelsSection: () => null,
}));

import { RegistryStoreSection } from "../../src/components/harness/RegistryStoreSection";

type Rating = NonNullable<RegistryStoreItem["rating"]>;

function rating(over: Partial<Rating> = {}): Rating {
  return {
    stars: 5,
    score: 0.97,
    formulaVersion: 1,
    upstreamStars: 165000,
    components: [],
    reasons: [
      { code: "stars", params: { stars: 165000 } },
      { code: "verifiedPin" },
      { code: "licenseOsi", params: { license: "MIT" } },
    ],
    snapshotAt: "2026-08-10T00:00:00Z",
    ...over,
  };
}

function storeItem(
  id: string,
  ratingValue: Rating | undefined,
  over: Partial<RegistryStoreItem> = {},
): RegistryStoreItem {
  return {
    schemaVersion: 1,
    id,
    name: id,
    type: "skill",
    version: "1.0.0",
    description: `${id} description`,
    tier: "community",
    publisherName: "acme",
    status: "active",
    permissions: [],
    permissionsDeclared: true,
    path: `skills/${id}`,
    commit: "a".repeat(40),
    install: null,
    installDerived: false,
    installState: "not-installable",
    rating: ratingValue,
    ...over,
  } as RegistryStoreItem;
}

function mountWith(items: RegistryStoreItem[]) {
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    registry: {
      index: vi.fn(async () => ({
        success: true,
        stale: false,
        available: true,
        items,
      })),
      install: vi.fn(),
      uninstall: vi.fn(),
    },
  };
  return render(createElement(RegistryStoreSection));
}

/** 카드 제목 순서 = 화면에 그려진 목록 순서. */
function renderedOrder(): string[] {
  return screen.getAllByText(/^rank-[a-z]+$/).map((el) => el.textContent ?? "");
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("스토어 카드의 별점 표시", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("① 메인이 내려준 ★ 개수가 그대로 그려진다", async () => {
    mountWith([storeItem("solo", rating({ stars: 3 }))]);
    const star = await screen.findByLabelText(/3/);
    // 채워진 별 3 + 빈 별 2 — 5칸 스케일이 눈에 보여야 "3점"이 읽힌다.
    expect(star.textContent).toBe("★★★☆☆");
  });

  it("② 목록이 별점 내림차순으로 그려진다", async () => {
    mountWith([
      storeItem("rank-low", rating({ stars: 2, score: 0.3 })),
      storeItem("rank-top", rating({ stars: 5, score: 0.97 })),
      storeItem("rank-mid", rating({ stars: 4, score: 0.9 })),
    ]);
    await screen.findByText("rank-top");
    expect(renderedOrder()).toEqual(["rank-top", "rank-mid", "rank-low"]);
  });

  it("③ 툴팁에 근거(스타 수·인증·라이선스)와 스냅샷 날짜가 들어간다", async () => {
    mountWith([storeItem("solo", rating())]);
    const star = await screen.findByLabelText(/5/);
    const tip = star.getAttribute("title") ?? "";
    expect(tip).toContain("165000");
    expect(tip).toContain("MIT");
    expect(tip).toContain("2026-08-10");
    // 산식 자체도 툴팁에 한 줄 들어간다 — "왜 이 별점" 이 카드 안에서 닫힌다.
    expect(tip).toMatch(/50|30|10/);
  });

  it("모르는 근거 코드는 조용히 버려진다 — 원문 i18n 키가 사용자에게 노출되지 않는다", async () => {
    mountWith([
      storeItem(
        "solo",
        rating({
          reasons: [
            { code: "someFutureSignal" },
            { code: "stars", params: { stars: 7 } },
          ],
        }),
      ),
    ]);
    const star = await screen.findByLabelText(/5/);
    const tip = star.getAttribute("title") ?? "";
    expect(tip).not.toContain("someFutureSignal");
    expect(tip).not.toContain("harness.store.registry.rating.reason");
    expect(tip).toContain("7");
  });

  it("★별점이 없는 응답에서도 카드는 그려진다(옛 메인 프로세스 호환)", async () => {
    mountWith([storeItem("unrated", undefined)]);
    expect(await screen.findByText("unrated")).toBeTruthy();
    expect(screen.queryByText("★★★★★")).toBeNull();
  });

  /**
   * ★별이 **말없이** 사라지는 것이 실제 장애 보고였다("별점이 안 나온다").
   * 원인은 렌더러만 새 코드이고 실행 중인 메인 프로세스가 별점 이전 빌드인
   * 것이었는데, 화면에는 아무 단서도 없어 아무도 거기에 도달하지 못했다.
   * 카드가 살아 있는 것(위 케이스)만으로는 부족하다 — 왜 별이 없는지가
   * 화면에 적혀야 조용한 퇴화가 진단 가능한 상태가 된다.
   */
  it("★별점이 하나도 안 온 응답에서는 원인·조치가 화면에 표시된다", async () => {
    mountWith([storeItem("a", undefined), storeItem("b", undefined)]);
    await screen.findByText("a");
    expect(document.body.textContent).toMatch(/재시작|[Rr]estart/);
  });

  it("별점이 하나라도 있으면 그 안내는 뜨지 않는다", async () => {
    mountWith([storeItem("a", rating()), storeItem("b", undefined)]);
    await screen.findByText("a");
    expect(document.body.textContent).not.toMatch(/재시작|[Rr]estart/);
  });

  it("별점 기준 패널은 접혀 있다가 눌러야 펼쳐진다", async () => {
    mountWith([storeItem("solo", rating())]);
    const toggle = await screen.findByRole("button", { name: /별점|rated/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    // 가중치가 화면에 실제로 적혀 있어야 한다 — 정렬 키의 근거를 앱 안에서
    // 못 읽으면 별점은 "우리가 정한 순서"로 읽힌다.
    expect(document.body.textContent).toMatch(/50%/);
  });
});
