/**
 * @vitest-environment jsdom
 *
 * Skeleton — 골격의 높이는 최종 높이와 같아야 한다(정본 §3-4 금지 ⑤).
 * 레이아웃이 튀면 로딩이 아니라 깜빡임이다. 그리고 `prefers-reduced-motion` 을 존중한다.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";

import { useLocaleStore } from "../../src/lib/i18n";
import { Skeleton } from "../../src/components/common/Skeleton";

beforeEach(() => {
  useLocaleStore.setState({ locale: "ko" });
});
afterEach(cleanup);

describe("Skeleton", () => {
  it("받은 높이를 정확히 차지한다(px 숫자)", () => {
    const { container } = render(createElement(Skeleton, { height: 240 }));
    const root = container.querySelector<HTMLElement>("[data-skeleton]")!;
    expect(root.style.height).toBe("240px");
    expect(root.style.minHeight).toBe("240px");
    expect(root.style.width).toBe("100%");
  });

  it("CSS 길이 문자열도 그대로 받는다(수치 칸: ch/em)", () => {
    const { container } = render(
      createElement(Skeleton, { height: "1.25em", width: "6ch", inline: true }),
    );
    const root = container.querySelector<HTMLElement>("[data-skeleton]")!;
    expect(root.style.height).toBe("1.25em");
    expect(root.style.width).toBe("6ch");
    expect(root.className).toContain("inline-flex");
  });

  it("lines 가 몇이든 바깥 높이는 같다 — 줄은 안에서 나눠 갖는다", () => {
    const { container } = render(
      createElement(Skeleton, { height: 120, lines: 4 }),
    );
    const root = container.querySelector<HTMLElement>("[data-skeleton]")!;
    expect(root.style.height).toBe("120px");
    const pieces = root.querySelectorAll<HTMLElement>('[aria-hidden="true"]');
    expect(pieces).toHaveLength(4);
    // (120 - 3*8) / 4 = 24 — 합이 120 이 되도록 calc 로 나눈다.
    // (jsdom 은 calc 산술을 접어 "calc(24px)" 로 돌려준다 — 두 형태 다 허용)
    expect(pieces[0]!.style.height).toMatch(
      /^calc\(\(120px - 24px\) \/ 4\)$|^calc\(24px\)$|^24px$/,
    );
  });

  it("prefers-reduced-motion 을 존중한다 — motion-reduce:animate-none", () => {
    const { container } = render(createElement(Skeleton, { height: 24 }));
    const piece = container.querySelector<HTMLElement>('[aria-hidden="true"]')!;
    expect(piece.className).toContain("animate-pulse");
    expect(piece.className).toContain("motion-reduce:animate-none");
    // 색은 토큰 하나.
    expect(piece.className).toContain("bg-surface-hover");
  });

  it("스크린리더에는 로딩 라벨 한 번, 조각은 aria-hidden", () => {
    const { container } = render(createElement(Skeleton, { height: 24 }));
    const root = container.querySelector<HTMLElement>("[data-skeleton]")!;
    expect(root.getAttribute("role")).toBe("status");
    expect(root.getAttribute("aria-busy")).toBe("true");
    expect(root.querySelector(".sr-only")?.textContent).toBe("로딩 중...");
  });
});
