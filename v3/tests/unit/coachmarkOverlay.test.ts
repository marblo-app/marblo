// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CoachmarkOverlay,
  type CoachmarkOverlayProps,
} from "../../src/components/common/CoachmarkOverlay";

/**
 * 오버레이의 실제 DOM 계약 — 순수 규칙(coachmark.test.ts) 위에서 "정말 그려지고
 * 눌리는가" 만 본다. 이 파일만 jsdom 환경이다(파일 상단 docblock) — 나머지 유닛
 * 테스트의 node 환경은 그대로 둔다.
 *
 * 여기서 지키는 것:
 *  - ★사라진 앵커를 가리키는 스텝은 아예 안 뜬다(빈 사각형 스포트라이트 금지)
 *  - 다음/이전/건너뛰기/다시보지않기가 각각 약속된 콜백을 부른다
 *  - 마지막 스텝의 '다음' 은 onFinish 다(투어가 영원히 안 끝나면 그게 최악)
 *
 * JSX 를 쓰지 않는 이유: vitest include 가 `tests/**\/*.test.ts` 라 .tsx 는 아예
 * 안 잡힌다. createElement 로 쓰면 같은 파일 규약 안에 들어온다.
 */

function anchor(id: string, rect: Partial<DOMRect> = {}) {
  const el = document.createElement("div");
  el.setAttribute("data-coach", id);
  document.body.appendChild(el);
  el.getBoundingClientRect = () =>
    ({
      top: 100,
      left: 200,
      width: 300,
      height: 50,
      bottom: 150,
      right: 500,
      x: 200,
      y: 100,
      toJSON: () => ({}),
      ...rect,
    }) as DOMRect;
  return el;
}

function overlay(props: Partial<CoachmarkOverlayProps> = {}) {
  const merged: CoachmarkOverlayProps = {
    steps: [
      { id: "one", anchor: '[data-coach="one"]', title: "첫째", body: "본문1" },
      { id: "two", anchor: '[data-coach="two"]', title: "둘째", body: "본문2" },
    ],
    onFinish: vi.fn(),
    onSkip: vi.fn(),
    labels: {
      next: "다음",
      back: "이전",
      done: "시작하기",
      skip: "건너뛰기",
      never: "다시 보지 않기",
      progress: (c, t) => `${c}/${t}`,
    },
    testId: "tour",
    ...props,
  };
  return { ...render(createElement(CoachmarkOverlay, merged)), props: merged };
}

describe("CoachmarkOverlay", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(cleanup);

  it("첫 스텝을 그리고 대상에 스포트라이트를 판다", () => {
    anchor("one");
    anchor("two");
    overlay();
    expect(screen.getByTestId("tour").dataset.step).toBe("one");
    expect(screen.getByText("첫째")).toBeTruthy();
    const hole = screen.getByTestId("tour-spotlight") as HTMLElement;
    // 대상(top 100/left 200)을 pad 만큼 부풀린 자리에 서야 한다.
    expect(hole.style.top).toBe("94px");
    expect(hole.style.left).toBe("194px");
    expect(hole.style.boxShadow).toContain("9999px");
  });

  it("★앵커가 없는 스텝은 아예 빠진다 — 진행 표시도 남은 수로 센다", () => {
    anchor("two"); // one 은 없다
    overlay();
    expect(screen.getByTestId("tour").dataset.step).toBe("two");
    expect(screen.getByText("1/1")).toBeTruthy();
    // 하나뿐이므로 첫 화면부터 마지막이다.
    expect(screen.getByTestId("tour-next").textContent).toBe("시작하기");
  });

  it("다음 → 이전으로 스텝을 오간다", () => {
    anchor("one");
    anchor("two");
    overlay();
    expect(screen.getByText("1/2")).toBeTruthy();
    fireEvent.click(screen.getByTestId("tour-next"));
    expect(screen.getByTestId("tour").dataset.step).toBe("two");
    expect(screen.getByText("2/2")).toBeTruthy();
    fireEvent.click(screen.getByTestId("tour-back"));
    expect(screen.getByTestId("tour").dataset.step).toBe("one");
    // 첫 스텝엔 '이전' 이 없다.
    expect(screen.queryByTestId("tour-back")).toBeNull();
  });

  it("★마지막 스텝의 '시작하기' 는 onFinish(실제 스텝 수) 를 부른다", () => {
    anchor("one");
    anchor("two");
    const { props } = overlay();
    fireEvent.click(screen.getByTestId("tour-next"));
    fireEvent.click(screen.getByTestId("tour-next"));
    expect(props.onFinish).toHaveBeenCalledWith(2);
  });

  it("건너뛰기는 permanent=false, '다시 보지 않기' 는 true 로 보고한다", () => {
    anchor("one");
    anchor("two");
    const { props } = overlay();
    fireEvent.click(screen.getByTestId("tour-next"));
    fireEvent.click(screen.getByTestId("tour-skip"));
    expect(props.onSkip).toHaveBeenCalledWith(false, 1, 2);

    cleanup();
    const second = overlay();
    fireEvent.click(screen.getByTestId("tour-never"));
    expect(second.props.onSkip).toHaveBeenCalledWith(true, 0, 2);
  });

  it("Esc 는 건너뛰기, →/← 는 스텝 이동", () => {
    anchor("one");
    anchor("two");
    const { props } = overlay();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByTestId("tour").dataset.step).toBe("two");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByTestId("tour").dataset.step).toBe("one");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onSkip).toHaveBeenCalledWith(false, 0, 2);
  });

  it("스텝이 하나도 안 남으면 아무것도 그리지 않는다", () => {
    overlay(); // 앵커를 하나도 안 만들었다
    expect(screen.queryByTestId("tour")).toBeNull();
  });
});
