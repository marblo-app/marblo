/**
 * @vitest-environment jsdom
 *
 * ★온보딩 문구의 `**강조**` — 별표가 화면에 보이면 안 된다.
 *
 * 사장님 프리뷰 테스트에서 신규 유저가 보는 **첫 문장**이 이렇게 나왔다:
 *   "Connect \*\*either\*\* Claude or Codex — just one."
 * 문구는 마크다운으로 쓰여 있는데 화면은 그걸 텍스트 노드로 그냥 꽂았다. 첫
 * 인상에 편집 흔적이 그대로 노출된 셈이라 사소한 결함이 아니다.
 *
 * 이 파일이 지키는 것:
 *   ① `emphasize` 가 `**...**` 를 진짜 <strong> 으로 쪼갠다 (별표 소멸)
 *   ② 강조가 든 실제 문구(en·ko 양쪽)를 그 렌더러로 그리면 별표가 없다
 *   ③ ★locales 의 beginner 네임스페이스에 `**` 를 새로 넣더라도, 그 문구를
 *      그리는 자리가 emphasize 를 타는지 사람이 다시 확인하게 만든다 —
 *      허용 목록을 여기 못박아 두고 벗어나면 실패시킨다.
 */
import { describe, expect, it } from "vitest";
import { createElement, type ReactNode } from "react";
import { render } from "@testing-library/react";

import { emphasize } from "../../src/components/beginner/beginnerUi";
import { beginner as enBeginner } from "../../src/locales/en/beginner";
import { beginner as koBeginner } from "../../src/locales/ko/beginner";

/**
 * `**` 를 쓰는 것이 **허용된** 키. 여기 없는 키에 별표가 들어오면 이 테스트가
 * 깨진다 — 그때 할 일은 목록에 줄을 더하는 게 아니라, 그 문구를 그리는 자리가
 * `emphasize` 를 타는지 먼저 확인하는 것이다.
 *
 *   beginner.connect.subtitle → BeginnerConnectStep
 *   beginner.funding.step2    → SubscriptionNeededModal
 */
const EMPHASIS_KEYS = ["beginner.connect.subtitle", "beginner.funding.step2"];

function textOf(nodes: ReactNode[]): string {
  const { container } = render(createElement("p", null, ...nodes));
  return container.textContent ?? "";
}

describe("emphasize — `**강조**` 를 <strong> 으로", () => {
  it("별표는 사라지고 강조된 말만 남는다", () => {
    const { container } = render(
      createElement("p", null, ...emphasize("Connect **either** Claude")),
    );

    expect(container.textContent).toBe("Connect either Claude");
    expect(container.textContent).not.toContain("*");
    expect(container.querySelector("strong")?.textContent).toBe("either");
  });

  it("한 문장에 둘 이상 있어도 각각 잡는다", () => {
    const { container } = render(
      createElement("p", null, ...emphasize("**A** 와 **B** 를 고르세요")),
    );

    expect(container.textContent).toBe("A 와 B 를 고르세요");
    expect(container.querySelectorAll("strong")).toHaveLength(2);
  });

  it("강조가 없는 문구는 그대로 지나간다", () => {
    expect(textOf(emphasize("그냥 평문입니다"))).toBe("그냥 평문입니다");
  });

  it("짝이 안 맞는 별표는 삼키지 않는다 (문구를 고치라는 신호로 남는다)", () => {
    expect(textOf(emphasize("반쪽 **강조 입니다"))).toBe("반쪽 **강조 입니다");
  });

  it("연달아 불러도 결과가 같다 (정규식 lastIndex 재사용 함정)", () => {
    const first = textOf(emphasize("**하나만** 연결하세요"));
    const second = textOf(emphasize("**하나만** 연결하세요"));
    expect(second).toBe(first);
    expect(second).not.toContain("*");
  });
});

describe("온보딩 문구 — 별표가 화면에 남지 않는다", () => {
  for (const key of EMPHASIS_KEYS) {
    it(`${key} — en/ko 둘 다 별표 없이 그려진다`, () => {
      for (const dict of [enBeginner, koBeginner] as Record<string, string>[]) {
        const raw = dict[key];
        expect(raw, `${key} 가 로케일에 없다`).toBeTruthy();
        expect(textOf(emphasize(raw))).not.toContain("*");
      }
    });
  }

  it("★beginner 문구에 `**` 를 쓰는 키는 허용 목록뿐이다", () => {
    const offenders: string[] = [];
    for (const dict of [enBeginner, koBeginner] as Record<string, string>[]) {
      for (const [key, value] of Object.entries(dict)) {
        if (value.includes("**") && !EMPHASIS_KEYS.includes(key)) {
          offenders.push(key);
        }
      }
    }
    // 새 키가 걸리면: 그 문구를 그리는 컴포넌트가 emphasize 를 타는지 확인한 뒤
    // EMPHASIS_KEYS 에 더한다. 확인 없이 목록만 늘리면 이 가드는 무의미해진다.
    expect(offenders).toEqual([]);
  });
});
